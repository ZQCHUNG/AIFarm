/**
 * database-adapter.js — SQLite state persistence layer.
 *
 * Replaces farm-state.json with SQLite for efficient partial updates.
 * Tables: farm_meta, plots, animals, buildings, crops, sessions,
 *         achievements, skills, construction.
 *
 * Uses better-sqlite3 for synchronous access (Electron main process).
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'farm-state.db');

class DatabaseAdapter {
  constructor() {
    this.db = null;
  }

  open() {
    this.db = new Database(DB_PATH);
    this.db.pragma('journal_mode = WAL'); // faster concurrent reads
    this.db.pragma('synchronous = NORMAL');
    this._createTables();
    return this;
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // ===== Schema =====

  _createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS farm_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS plots (
        id INTEGER PRIMARY KEY,
        crop TEXT,
        stage INTEGER DEFAULT 0,
        growth_progress INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS animals (
        id TEXT PRIMARY KEY,
        unlocked INTEGER DEFAULT 0,
        home_x INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS buildings (
        id TEXT PRIMARY KEY,
        unlocked INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS unlocked_crops (
        id TEXT PRIMARY KEY
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project TEXT,
        start_time INTEGER,
        end_time INTEGER,
        duration INTEGER,
        color_index INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS construction_sites (
        id TEXT PRIMARY KEY,
        current_tokens INTEGER DEFAULT 0,
        completed INTEGER DEFAULT 0
      );
    `);
  }

  // ===== Migration: JSON → SQLite =====

  /**
   * Import existing farm-state.json into SQLite.
   * Only runs once (checks for migration marker in farm_meta).
   */
  migrateFromJson(jsonPath) {
    const migrated = this._getMeta('migrated_from_json');
    if (migrated) return false;

    if (!fs.existsSync(jsonPath)) {
      this._setMeta('migrated_from_json', 'no_source');
      return false;
    }

    try {
      const raw = fs.readFileSync(jsonPath, 'utf8');
      const state = JSON.parse(raw);

      const tx = this.db.transaction(() => {
        // Meta values
        this._setMeta('version', String(state.version || 1));
        this._setMeta('total_energy', String(state.totalEnergy || 0));
        this._setMeta('pending_growth', String(state.pendingGrowth || 0));
        this._setMeta('last_saved', state.lastSaved || '');
        this._setMeta('total_harvests', String((state.stats && state.stats.totalHarvests) || 0));
        this._setMeta('peak_buddies', String((state.stats && state.stats.peakBuddies) || 0));
        this._setMeta('milestone_reached', String(state.milestoneReached || 0));
        this._setMeta('current_generation', String(state.currentGeneration || 1));

        // Plots
        const upsertPlot = this.db.prepare(
          'INSERT OR REPLACE INTO plots (id, crop, stage, growth_progress) VALUES (?, ?, ?, ?)'
        );
        if (state.plots) {
          for (let i = 0; i < state.plots.length; i++) {
            const p = state.plots[i];
            upsertPlot.run(i, p.crop, p.stage, p.growthProgress);
          }
        }

        // Animals
        const upsertAnimal = this.db.prepare(
          'INSERT OR REPLACE INTO animals (id, unlocked, home_x) VALUES (?, ?, ?)'
        );
        if (state.animals) {
          for (const [id, a] of Object.entries(state.animals)) {
            upsertAnimal.run(id, a.unlocked ? 1 : 0, a.homeX || 0);
          }
        }

        // Buildings
        const upsertBuilding = this.db.prepare(
          'INSERT OR REPLACE INTO buildings (id, unlocked) VALUES (?, ?)'
        );
        if (state.buildings) {
          for (const [id, val] of Object.entries(state.buildings)) {
            upsertBuilding.run(id, val ? 1 : 0);
          }
        }

        // Unlocked crops
        const upsertCrop = this.db.prepare(
          'INSERT OR REPLACE INTO unlocked_crops (id) VALUES (?)'
        );
        if (state.unlockedCrops) {
          for (const crop of state.unlockedCrops) {
            upsertCrop.run(crop);
          }
        }

        // Sessions
        const upsertSession = this.db.prepare(
          'INSERT OR REPLACE INTO sessions (id, project, start_time, end_time, duration, color_index) VALUES (?, ?, ?, ?, ?, ?)'
        );
        if (state.sessionHistory) {
          for (const s of state.sessionHistory) {
            upsertSession.run(s.id, s.project, s.startTime, s.endTime, s.duration, s.colorIndex || 0);
          }
        }

        // Construction
        if (state.construction && state.construction.sites) {
          const upsertSite = this.db.prepare(
            'INSERT OR REPLACE INTO construction_sites (id, current_tokens, completed) VALUES (?, ?, ?)'
          );
          for (const [id, site] of Object.entries(state.construction.sites)) {
            upsertSite.run(id, site.currentTokens || 0, site.completed ? 1 : 0);
          }
          this._setMeta('construction_total_burned', String(state.construction.totalTokensBurned || 0));
        }

        // Skills (store as JSON blob — complex nested structure)
        if (state.skills) {
          this._setMeta('skills', JSON.stringify(state.skills));
        }

        // Achievements (store as JSON blob — complex nested structure)
        if (state.achievements) {
          this._setMeta('achievements', JSON.stringify(state.achievements));
        }

        this._setMeta('migrated_from_json', new Date().toISOString());
      });

      tx();
      console.log('[DB] Migration from JSON complete');
      return true;
    } catch (err) {
      console.error('[DB] Migration error:', err.message);
      return false;
    }
  }

  // ===== Meta key-value store =====

  _getMeta(key) {
    const row = this.db.prepare('SELECT value FROM farm_meta WHERE key = ?').get(key);
    return row ? row.value : null;
  }

  _setMeta(key, value) {
    this.db.prepare('INSERT OR REPLACE INTO farm_meta (key, value) VALUES (?, ?)').run(key, value);
  }

  getMetaInt(key, defaultVal = 0) {
    const v = this._getMeta(key);
    return v !== null ? parseInt(v, 10) : defaultVal;
  }

  getMetaString(key, defaultVal = '') {
    return this._getMeta(key) || defaultVal;
  }

  setMeta(key, value) {
    this._setMeta(key, String(value));
  }

  // ===== Load full state (for FarmState compatibility) =====

  loadState() {
    const state = {
      version: this.getMetaInt('version', 1),
      totalEnergy: this.getMetaInt('total_energy', 0),
      pendingGrowth: this.getMetaInt('pending_growth', 0),
      lastSaved: this.getMetaString('last_saved'),
      stats: {
        totalHarvests: this.getMetaInt('total_harvests', 0),
        peakBuddies: this.getMetaInt('peak_buddies', 0),
      },
      milestoneReached: this.getMetaInt('milestone_reached', 0),
      currentGeneration: this.getMetaInt('current_generation', 1),

      // Plots
      plots: this._loadPlots(),

      // Animals
      animals: this._loadAnimals(),

      // Buildings
      buildings: this._loadBuildings(),

      // Unlocked crops
      unlockedCrops: this._loadUnlockedCrops(),

      // Sessions
      sessionHistory: this._loadSessions(),

      // Skills (JSON blob)
      skills: this._loadJsonMeta('skills'),

      // Construction
      construction: this._loadConstruction(),

      // Achievements (JSON blob)
      achievements: this._loadJsonMeta('achievements'),
    };

    return state;
  }

  _loadPlots() {
    const rows = this.db.prepare('SELECT * FROM plots ORDER BY id').all();
    const plots = [];
    for (const r of rows) {
      plots[r.id] = { crop: r.crop, stage: r.stage, growthProgress: r.growth_progress };
    }
    return plots;
  }

  _loadAnimals() {
    const rows = this.db.prepare('SELECT * FROM animals').all();
    const animals = {};
    for (const r of rows) {
      animals[r.id] = { unlocked: !!r.unlocked, homeX: r.home_x };
    }
    return animals;
  }

  _loadBuildings() {
    const rows = this.db.prepare('SELECT * FROM buildings').all();
    const buildings = {};
    for (const r of rows) {
      buildings[r.id] = !!r.unlocked;
    }
    return buildings;
  }

  _loadUnlockedCrops() {
    return this.db.prepare('SELECT id FROM unlocked_crops').all().map(r => r.id);
  }

  _loadSessions() {
    return this.db.prepare('SELECT * FROM sessions ORDER BY start_time DESC LIMIT 50').all().map(r => ({
      id: r.id,
      project: r.project,
      startTime: r.start_time,
      endTime: r.end_time,
      duration: r.duration,
      colorIndex: r.color_index,
    }));
  }

  _loadConstruction() {
    const rows = this.db.prepare('SELECT * FROM construction_sites').all();
    if (rows.length === 0) return null;
    const sites = {};
    for (const r of rows) {
      sites[r.id] = { currentTokens: r.current_tokens, completed: !!r.completed };
    }
    return {
      sites,
      totalTokensBurned: this.getMetaInt('construction_total_burned', 0),
    };
  }

  _loadJsonMeta(key) {
    const raw = this._getMeta(key);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  // ===== Partial save methods (only write what changed) =====

  saveMeta(updates) {
    const tx = this.db.transaction(() => {
      for (const [key, value] of Object.entries(updates)) {
        this._setMeta(key, String(value));
      }
    });
    tx();
  }

  savePlot(index, crop, stage, growthProgress) {
    this.db.prepare(
      'INSERT OR REPLACE INTO plots (id, crop, stage, growth_progress) VALUES (?, ?, ?, ?)'
    ).run(index, crop, stage, growthProgress);
  }

  savePlots(plots) {
    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO plots (id, crop, stage, growth_progress) VALUES (?, ?, ?, ?)'
    );
    const tx = this.db.transaction(() => {
      for (let i = 0; i < plots.length; i++) {
        const p = plots[i];
        stmt.run(i, p.crop, p.stage, p.growthProgress);
      }
    });
    tx();
  }

  saveAnimal(id, unlocked, homeX) {
    this.db.prepare(
      'INSERT OR REPLACE INTO animals (id, unlocked, home_x) VALUES (?, ?, ?)'
    ).run(id, unlocked ? 1 : 0, homeX);
  }

  saveBuilding(id, unlocked) {
    this.db.prepare(
      'INSERT OR REPLACE INTO buildings (id, unlocked) VALUES (?, ?)'
    ).run(id, unlocked ? 1 : 0);
  }

  saveUnlockedCrop(cropId) {
    this.db.prepare('INSERT OR IGNORE INTO unlocked_crops (id) VALUES (?)').run(cropId);
  }

  saveSession(session) {
    this.db.prepare(
      'INSERT OR REPLACE INTO sessions (id, project, start_time, end_time, duration, color_index) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(session.id, session.project, session.startTime, session.endTime, session.duration, session.colorIndex || 0);

    // Cap at 50 sessions
    this.db.prepare(
      'DELETE FROM sessions WHERE id NOT IN (SELECT id FROM sessions ORDER BY start_time DESC LIMIT 50)'
    ).run();
  }

  saveConstructionSite(id, currentTokens, completed) {
    this.db.prepare(
      'INSERT OR REPLACE INTO construction_sites (id, current_tokens, completed) VALUES (?, ?, ?)'
    ).run(id, currentTokens, completed ? 1 : 0);
  }

  saveSkills(skillsState) {
    this._setMeta('skills', JSON.stringify(skillsState));
  }

  saveAchievements(achievementsState) {
    this._setMeta('achievements', JSON.stringify(achievementsState));
  }

  // ===== Full save (for compatibility during transition) =====

  saveFullState(state) {
    const tx = this.db.transaction(() => {
      this._setMeta('version', String(state.version || 1));
      this._setMeta('total_energy', String(state.totalEnergy || 0));
      this._setMeta('pending_growth', String(state.pendingGrowth || 0));
      this._setMeta('last_saved', state.lastSaved || new Date().toISOString());
      this._setMeta('total_harvests', String((state.stats && state.stats.totalHarvests) || 0));
      this._setMeta('peak_buddies', String((state.stats && state.stats.peakBuddies) || 0));
      this._setMeta('milestone_reached', String(state.milestoneReached || 0));
      this._setMeta('current_generation', String(state.currentGeneration || 1));

      this.savePlots(state.plots || []);

      for (const [id, a] of Object.entries(state.animals || {})) {
        this.saveAnimal(id, a.unlocked, a.homeX);
      }

      for (const [id, val] of Object.entries(state.buildings || {})) {
        this.saveBuilding(id, val);
      }

      // Sync unlocked crops (clear + re-insert)
      this.db.prepare('DELETE FROM unlocked_crops').run();
      for (const crop of (state.unlockedCrops || [])) {
        this.saveUnlockedCrop(crop);
      }

      if (state.sessionHistory) {
        for (const s of state.sessionHistory) {
          this.saveSession(s);
        }
      }

      if (state.skills) {
        this.saveSkills(state.skills);
      }

      if (state.construction) {
        if (state.construction.sites) {
          for (const [id, site] of Object.entries(state.construction.sites)) {
            this.saveConstructionSite(id, site.currentTokens || 0, site.completed);
          }
        }
        this._setMeta('construction_total_burned', String(state.construction.totalTokensBurned || 0));
      }

      if (state.achievements) {
        this.saveAchievements(state.achievements);
      }
    });
    tx();
  }
}

module.exports = DatabaseAdapter;
