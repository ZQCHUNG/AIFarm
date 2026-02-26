// Farm state manager — energy tracking, growth, milestones, persistence.
const fs = require('fs');
const writeFileAtomic = require('write-file-atomic');
const cfg = require('./farm-config');
const AchievementManager = require('./achievement-manager');

class FarmState {
  constructor() {
    this._dirty = false;
    this._timer = null;
    this._weatherMultiplier = 1.0;
    this._currentSeason = 'summer';
    this.state = this._defaultState();
    this.achievements = new AchievementManager();
  }

  setWeatherMultiplier(m) {
    this._weatherMultiplier = m;
  }

  setSeason(s) {
    this._currentSeason = s || 'summer';
  }

  _defaultState() {
    return {
      version: 1,
      totalEnergy: 0,
      pendingGrowth: 0,
      lastSaved: null,
      stats: { totalHarvests: 0, peakBuddies: 0 },
      plots: Array.from({ length: cfg.TOTAL_PLOTS }, () => ({
        crop: null, stage: 0, growthProgress: 0,
      })),
      animals: {},
      buildings: {},
      unlockedCrops: [],
      milestoneReached: 0,
      currentGeneration: 1,
      sessionHistory: [], // Historical sessions for NPC system
      skills: null, // Skill progression state (farming/mining/fishing)
      construction: null, // Progressive construction state
    };
  }

  load() {
    try {
      if (fs.existsSync(cfg.SAVE_PATH)) {
        const raw = fs.readFileSync(cfg.SAVE_PATH, 'utf8');
        const saved = JSON.parse(raw);
        // Merge saved over defaults (handles new fields gracefully)
        this.state = { ...this._defaultState(), ...saved };
        // Ensure plots array has correct length
        while (this.state.plots.length < cfg.TOTAL_PLOTS) {
          this.state.plots.push({ crop: null, stage: 0, growthProgress: 0 });
        }
        // Load achievements
        this.achievements.load(this.state.achievements || null);
        console.log(`[Farm] Loaded: ${this.state.totalEnergy} energy, milestone ${this.state.milestoneReached}`);
      } else {
        console.log('[Farm] No save file, starting fresh');
      }
    } catch (err) {
      console.error('[Farm] Load error, starting fresh:', err.message);
      this.state = this._defaultState();
    }
  }

  save() {
    try {
      this.state.lastSaved = new Date().toISOString();
      this.state.achievements = this.achievements.getSaveState();
      writeFileAtomic.sync(cfg.SAVE_PATH, JSON.stringify(this.state, null, 2), 'utf8');
      this._dirty = false;
    } catch (err) {
      console.error('[Farm] Save error:', err.message);
    }
  }

  startAutoSave() {
    this._timer = setInterval(() => {
      if (this._dirty) this.save();
    }, cfg.AUTO_SAVE_INTERVAL);
  }

  stopAutoSave() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  // Add energy from a Claude Code event. Returns the energy delta.
  addEnergy(eventType, activeBuddyCount) {
    const base = cfg.ENERGY_PER_EVENT[eventType] || 0;
    if (base === 0) return 0;

    const multiplier = activeBuddyCount >= cfg.COLLAB_THRESHOLD ? cfg.COLLAB_MULTIPLIER : 1;
    const pts = Math.round(base * multiplier);

    this.state.totalEnergy += pts;
    this.state.pendingGrowth += pts;

    // Track peak buddies
    if (activeBuddyCount > this.state.stats.peakBuddies) {
      this.state.stats.peakBuddies = activeBuddyCount;
    }

    this._checkMilestones();
    this._checkGeneration();
    this._processGrowth();
    this._dirty = true;

    return pts;
  }

  _checkMilestones() {
    const energy = this.state.totalEnergy;

    // Unlock crops
    for (const crop of cfg.CROPS) {
      if (energy >= crop.unlock && !this.state.unlockedCrops.includes(crop.id)) {
        this.state.unlockedCrops.push(crop.id);
        console.log(`[Farm] Unlocked crop: ${crop.id}`);
      }
    }

    // Unlock plot batches
    for (const batch of cfg.PLOT_UNLOCK) {
      if (energy >= batch.energy) {
        for (let i = batch.start; i < batch.end; i++) {
          const plot = this.state.plots[i];
          // Plant something if empty and we have crops
          if (plot.stage === 0 && !plot.crop && this.state.unlockedCrops.length > 0) {
            this._plantRandom(i);
          }
        }
      }
    }

    // Unlock animals
    for (const animal of cfg.ANIMALS) {
      if (energy >= animal.unlock && !this.state.animals[animal.id]) {
        this.state.animals[animal.id] = { unlocked: true, homeX: 10 + Object.keys(this.state.animals).length * 15 };
        console.log(`[Farm] Unlocked animal: ${animal.id}`);
      }
    }

    // Unlock buildings
    for (const bld of cfg.BUILDINGS) {
      if (energy >= bld.unlock && !this.state.buildings[bld.id]) {
        this.state.buildings[bld.id] = true;
        console.log(`[Farm] Unlocked building: ${bld.id}`);
      }
    }

    // Update milestone marker
    for (const ms of cfg.MILESTONES) {
      if (energy >= ms.energy) {
        this.state.milestoneReached = Math.max(this.state.milestoneReached, ms.energy);
      }
    }
  }

  _checkGeneration() {
    const gen = cfg.getGeneration(this.state.totalEnergy);
    if (gen.gen > this.state.currentGeneration) {
      const oldGen = this.state.currentGeneration;
      this.state.currentGeneration = gen.gen;
      console.log(`[Farm] GENERATION UP! ${oldGen} → ${gen.gen}: ${gen.label}`);
      // Emit prestige event (will be sent to renderer via IPC)
      this._pendingPrestige = {
        fromGen: oldGen,
        toGen: gen.gen,
        label: gen.label,
        worldWidth: gen.worldWidth,
      };
    }
  }

  // Pop pending prestige event (called by main.js)
  popPrestigeEvent() {
    const evt = this._pendingPrestige;
    this._pendingPrestige = null;
    return evt;
  }

  _processGrowth() {
    if (this.state.pendingGrowth <= 0) return;

    // Distribute pending growth across active plots
    const activePlots = [];
    for (let i = 0; i < this.state.plots.length; i++) {
      const p = this.state.plots[i];
      if (p.crop && p.stage > 0 && p.stage < cfg.GROWTH_STAGES - 1) {
        activePlots.push(i);
      }
    }

    if (activePlots.length === 0) {
      // Try planting on empty unlocked plots
      this._tryPlantEmptyPlots();
      this.state.pendingGrowth = 0;
      return;
    }

    // Spread growth evenly across active plots (weather multiplier applied)
    const perPlot = Math.max(1, Math.floor(this.state.pendingGrowth * this._weatherMultiplier / activePlots.length));

    for (const idx of activePlots) {
      const plot = this.state.plots[idx];
      const cropDef = cfg.CROPS.find(c => c.id === plot.crop);
      if (!cropDef) continue;

      // Apply per-crop seasonal growth multiplier
      const seasonMult = this._getCropSeasonMultiplier(plot.crop);
      plot.growthProgress += Math.max(1, Math.floor(perPlot * seasonMult));

      // Check for stage advancement
      while (plot.growthProgress >= cropDef.growCost && plot.stage < cfg.GROWTH_STAGES - 1) {
        plot.growthProgress -= cropDef.growCost;
        plot.stage++;
        if (plot.stage >= cfg.GROWTH_STAGES - 1) {
          // Mature! Will be harvested and replanted next cycle
          this._harvestAndReplant(idx);
          break;
        }
      }
    }

    this.state.pendingGrowth = 0;
  }

  // Crop season affinity — matches IsoSeasons.CROP_SEASONS
  _getCropSeasonMultiplier(cropId) {
    const CROP_SEASONS = {
      carrot:     { best: ['spring', 'autumn'], penalty: 0.5 },
      sunflower:  { best: ['summer'],           penalty: 0.4 },
      watermelon: { best: ['summer'],           penalty: 0.3 },
      tomato:     { best: ['summer', 'autumn'], penalty: 0.5 },
      corn:       { best: ['summer', 'autumn'], penalty: 0.5 },
      pumpkin:    { best: ['autumn'],           penalty: 0.4 },
      strawberry: { best: ['spring', 'summer'], penalty: 0.5 },
      wheat:      { best: ['autumn', 'spring'], penalty: 0.6 },
    };
    const info = CROP_SEASONS[cropId];
    if (!info) return 1.0;
    if (info.best.includes(this._currentSeason)) return 1.2;
    if (this._currentSeason === 'winter') return info.penalty * 0.7;
    return info.penalty;
  }

  _tryPlantEmptyPlots() {
    if (this.state.unlockedCrops.length === 0) return;
    const energy = this.state.totalEnergy;
    for (const batch of cfg.PLOT_UNLOCK) {
      if (energy >= batch.energy) {
        for (let i = batch.start; i < batch.end; i++) {
          const p = this.state.plots[i];
          if (!p.crop || p.stage === 0) {
            this._plantRandom(i);
          }
        }
      }
    }
  }

  _plantRandom(plotIndex) {
    if (this.state.unlockedCrops.length === 0) return;
    const crops = this.state.unlockedCrops;
    const crop = crops[Math.floor(Math.random() * crops.length)];
    this.state.plots[plotIndex] = { crop, stage: 1, growthProgress: 0 };
  }

  _harvestAndReplant(plotIndex) {
    this.state.stats.totalHarvests++;
    console.log(`[Farm] Harvest #${this.state.stats.totalHarvests} from plot ${plotIndex}`);
    // Mark as mature briefly (renderer shows flash), then replant
    this.state.plots[plotIndex].stage = cfg.GROWTH_STAGES - 1;
    // Auto-replant after a short delay (next growth cycle)
    setTimeout(() => {
      this._plantRandom(plotIndex);
      this._dirty = true;
    }, 3000);
  }

  // Get serializable state for renderer
  /** Record a session ending — for NPC system. */
  recordSession(sessionData) {
    if (!this.state.sessionHistory) this.state.sessionHistory = [];
    // Avoid duplicates (same sessionId)
    const existing = this.state.sessionHistory.findIndex(s => s.id === sessionData.id);
    if (existing !== -1) {
      this.state.sessionHistory[existing] = sessionData;
    } else {
      this.state.sessionHistory.push(sessionData);
    }
    // Cap at 50 most recent sessions
    if (this.state.sessionHistory.length > 50) {
      this.state.sessionHistory = this.state.sessionHistory.slice(-50);
    }
    this._dirty = true;
  }

  getRendererState() {
    return {
      totalEnergy: this.state.totalEnergy,
      plots: this.state.plots,
      animals: this.state.animals,
      buildings: this.state.buildings,
      unlockedCrops: this.state.unlockedCrops,
      milestoneReached: this.state.milestoneReached,
      currentGeneration: this.state.currentGeneration,
      worldWidth: cfg.getGeneration(this.state.totalEnergy).worldWidth,
      totalHarvests: this.state.stats.totalHarvests,
      sessionHistory: this.state.sessionHistory || [],
      skills: this.state.skills || null,
      construction: this.state.construction || null,
      achievements: this.achievements.getRendererState(),
    };
  }
}

module.exports = FarmState;
