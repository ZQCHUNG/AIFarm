// Achievement manager — tracks progress, checks conditions, emits unlock events.
const { TIERS, ACHIEVEMENTS } = require('./achievement-config');

class AchievementManager {
  constructor() {
    // progress: { achievementId: { value: number, tier: 'silver'|'gold'|'diamond'|null, unlockedAt: {} } }
    this.progress = {};
    this._pendingNotifications = []; // newly unlocked achievements to display
    this._lastThinkState = {};       // per-session: last event was thinking?
    this._sessionFiles = {};          // per-session: Set of edited files
    this._sessionTokens = {};         // per-session: output tokens
    this._sessionStartTime = {};      // per-session: first activity time
    this._earlyBirdDays = new Set();  // dates we already counted early bird
    this._nightOwlDays = new Set();   // dates we already counted night owl
  }

  // Load from saved state
  load(savedProgress) {
    if (savedProgress) {
      this.progress = savedProgress;
      // Restore day sets from progress
      if (savedProgress._earlyBirdDays) this._earlyBirdDays = new Set(savedProgress._earlyBirdDays);
      if (savedProgress._nightOwlDays) this._nightOwlDays = new Set(savedProgress._nightOwlDays);
    }
    // Ensure all achievements have entries
    for (const ach of ACHIEVEMENTS) {
      if (!this.progress[ach.id]) {
        this.progress[ach.id] = { value: 0, tier: null, unlockedAt: {} };
      }
    }
  }

  // Get serializable state for saving
  getSaveState() {
    return {
      ...this.progress,
      _earlyBirdDays: [...this._earlyBirdDays],
      _nightOwlDays: [...this._nightOwlDays],
    };
  }

  // Get renderer-friendly state
  getRendererState() {
    const achievements = [];
    for (const def of ACHIEVEMENTS) {
      const prog = this.progress[def.id] || { value: 0, tier: null };
      const nextTier = this._getNextTier(def, prog.tier);
      achievements.push({
        id: def.id,
        title: def.title,
        icon: def.icon,
        currentTier: prog.tier,
        currentTierColor: prog.tier ? TIERS[prog.tier].color : null,
        value: prog.value,
        nextTier: nextTier ? nextTier.tier : null,
        nextThreshold: nextTier ? nextTier.threshold : null,
      });
    }
    return achievements;
  }

  // Pop pending notifications (newly unlocked achievements)
  popNotifications() {
    const notifs = this._pendingNotifications.splice(0);
    return notifs;
  }

  // Process a Claude Code event — called from main.js for each activity event
  onEvent(event, sessionId, farmState) {
    const now = new Date();

    // Track think→write cycles (Refiner)
    this._trackRefiner(event, sessionId);

    // Track files edited (Architect)
    this._trackArchitect(event, sessionId);

    // Track session tokens (Burner)
    this._trackBurner(event, sessionId);

    // Track session duration (Marathon)
    this._trackMarathon(sessionId);

    // Track time-of-day (Early Bird / Night Owl)
    this._trackTimeOfDay(now);

    // Track GOAT (1M tokens or 8h session)
    this._trackGOAT(sessionId);

    // Track farm-derived achievements
    if (farmState) {
      this._trackFromFarmState(farmState);
    }
  }

  // Called when buddies count changes
  onBuddyCountChange(count) {
    this._updateAchievement('collaborator', count, 'max');
  }

  // --- Internal trackers ---

  _trackRefiner(event, sessionId) {
    if (event.type === 'thinking') {
      this._lastThinkState[sessionId] = true;
    } else if ((event.type === 'tool_use') && this._lastThinkState[sessionId]) {
      const tool = event.tool || '';
      if (['Write', 'Edit', 'NotebookEdit'].includes(tool)) {
        this._updateAchievement('refiner', 1, 'counter');
      }
      this._lastThinkState[sessionId] = false;
    } else {
      this._lastThinkState[sessionId] = false;
    }
  }

  _trackArchitect(event, sessionId) {
    if (event.type === 'tool_use') {
      const tool = event.tool || '';
      if (['Write', 'Edit', 'NotebookEdit'].includes(tool) && event.detail) {
        if (!this._sessionFiles[sessionId]) this._sessionFiles[sessionId] = new Set();
        this._sessionFiles[sessionId].add(event.detail);
        this._updateAchievement('architect', this._sessionFiles[sessionId].size, 'max');
      }
    }
  }

  _trackBurner(event, sessionId) {
    if (event.outputTokens) {
      if (!this._sessionTokens[sessionId]) this._sessionTokens[sessionId] = 0;
      this._sessionTokens[sessionId] += event.outputTokens;
      this._updateAchievement('burner', this._sessionTokens[sessionId], 'max');
    }
  }

  _trackMarathon(sessionId) {
    if (!this._sessionStartTime[sessionId]) {
      this._sessionStartTime[sessionId] = Date.now();
    }
    const hours = (Date.now() - this._sessionStartTime[sessionId]) / (1000 * 60 * 60);
    this._updateAchievement('marathon', hours, 'max');
  }

  _trackTimeOfDay(now) {
    const hour = now.getHours();
    const dateKey = now.toISOString().slice(0, 10);

    // Early Bird: activity before 7am
    if (hour < 7 && !this._earlyBirdDays.has(dateKey)) {
      this._earlyBirdDays.add(dateKey);
      this._updateAchievement('earlyBird', 1, 'counter');
    }

    // Night Owl: activity after midnight (0-4am counts as late night)
    if (hour >= 0 && hour < 4 && !this._nightOwlDays.has(dateKey)) {
      this._nightOwlDays.add(dateKey);
      this._updateAchievement('nightOwl', 1, 'counter');
    }
  }

  _trackGOAT(sessionId) {
    const tokens = this._sessionTokens[sessionId] || 0;
    const startTime = this._sessionStartTime[sessionId];
    const hours = startTime ? (Date.now() - startTime) / (1000 * 60 * 60) : 0;
    if (tokens >= 1000000 || hours >= 8) {
      this._updateAchievement('goat', 1, 'flag');
    }
  }

  _trackFromFarmState(farmState) {
    // Town Builder: count unlocked buildings
    const buildingCount = Object.values(farmState.buildings || {}).filter(Boolean).length;
    this._updateAchievement('townBuilder', buildingCount, 'max');

    // Harvest Master: total harvests
    const harvests = (farmState.stats && farmState.stats.totalHarvests) || 0;
    this._updateAchievement('harvestMaster', harvests, 'max');
  }

  // Core update logic
  _updateAchievement(id, value, type) {
    const prog = this.progress[id];
    if (!prog) return;

    const def = ACHIEVEMENTS.find(a => a.id === id);
    if (!def) return;

    // Update value based on tracker type
    if (type === 'counter') {
      prog.value += value;
    } else if (type === 'max') {
      prog.value = Math.max(prog.value, value);
    }

    // Check tier upgrades
    const oldTier = prog.tier;
    for (const tierDef of def.tiers) {
      if (prog.value >= tierDef.threshold) {
        const tierRank = ['silver', 'gold', 'diamond'].indexOf(tierDef.tier);
        const currentRank = prog.tier ? ['silver', 'gold', 'diamond'].indexOf(prog.tier) : -1;
        if (tierRank > currentRank) {
          prog.tier = tierDef.tier;
          prog.unlockedAt[tierDef.tier] = new Date().toISOString();
        }
      }
    }

    // Emit notification if tier changed
    if (prog.tier !== oldTier) {
      const tierInfo = TIERS[prog.tier];
      console.log(`[Achievement] ${def.icon} ${def.title} — ${tierInfo.label}!`);
      this._pendingNotifications.push({
        id: def.id,
        title: def.title,
        icon: def.icon,
        tier: prog.tier,
        tierLabel: tierInfo.label,
        tierColor: tierInfo.color,
      });
    }
  }

  _getNextTier(def, currentTier) {
    const tiers = def.tiers;
    if (!currentTier) return tiers[0] || null;
    const idx = tiers.findIndex(t => t.tier === currentTier);
    return idx < tiers.length - 1 ? tiers[idx + 1] : null;
  }

  // Check if GOAT achievement has been unlocked
  isGOAT() {
    const prog = this.progress.goat;
    return prog && prog.tier === 'diamond';
  }

  // Clean up session tracking when a session is removed
  removeSession(sessionId) {
    delete this._lastThinkState[sessionId];
    delete this._sessionFiles[sessionId];
    delete this._sessionTokens[sessionId];
    delete this._sessionStartTime[sessionId];
  }
}

module.exports = AchievementManager;
