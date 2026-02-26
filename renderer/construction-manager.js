/**
 * construction-manager.js — Progressive Construction System (Sprint 24 P0/P1).
 *
 * Buildings are constructed incrementally: each token burned adds fractional
 * progress. 4 visual stages: Foundation (0-25%), Scaffolding (25-75%),
 * Framing (75-99%), Complete (100%). [T] key simulates token burn for testing.
 *
 * Listens to TOKEN_BURNED events from farm-energy-tick or [T] key simulator.
 * Construction sites are rendered as IsoEngine entities with progress bars.
 */
const ConstructionManager = (() => {
  // ===== Construction blueprints =====
  // These define what can be built and at what token thresholds
  const BLUEPRINTS = [
    { id: 'well',     name: 'Well',        targetTokens: 200,   col: 2,  row: 15, icon: '\u{1F6B0}' },
    { id: 'barn',     name: 'Barn',        targetTokens: 500,   col: 5,  row: 15, icon: '\u{1F3DA}' },
    { id: 'windmill', name: 'Windmill',    targetTokens: 800,   col: 8,  row: 15, icon: '\u{1F3E1}' },
    { id: 'market',   name: 'Market',      targetTokens: 1200,  col: 11, row: 15, icon: '\u{1F3EA}' },
    { id: 'clock',    name: 'Clock Tower', targetTokens: 1800,  col: 14, row: 15, icon: '\u{1F554}' },
    { id: 'townhall', name: 'Town Hall',   targetTokens: 2500,  col: 4,  row: 17, icon: '\u{1F3DB}' },
    { id: 'museum',   name: 'Museum',      targetTokens: 3500,  col: 8,  row: 17, icon: '\u{1F3DB}' },
    { id: 'statue',   name: 'Statue',      targetTokens: 5000,  col: 15, row: 17, icon: '\u{1F5FF}' },
  ];

  // ===== State =====
  // sites: Map<id, { blueprint, currentTokens, stage, entity, completed }>
  let sites = new Map();
  let initialized = false;
  let totalTokensBurned = 0;

  // Current active site (the one receiving tokens)
  let activeSiteId = null;

  // ===== Stage definitions =====
  const STAGES = {
    FOUNDATION:  { min: 0,    max: 0.25, label: 'Foundation' },
    SCAFFOLDING: { min: 0.25, max: 0.75, label: 'Scaffolding' },
    FRAMING:     { min: 0.75, max: 1.0,  label: 'Framing' },
    COMPLETE:    { min: 1.0,  max: 1.0,  label: 'Complete' },
  };

  function getStage(progress) {
    if (progress >= 1.0) return 'COMPLETE';
    if (progress >= 0.75) return 'FRAMING';
    if (progress >= 0.25) return 'SCAFFOLDING';
    return 'FOUNDATION';
  }

  // ===== Home offset helper =====
  function _off() {
    return (typeof IsoEngine !== 'undefined' && IsoEngine.getHomeOffset)
      ? IsoEngine.getHomeOffset() : { col: 0, row: 0 };
  }

  // ===== Initialization =====

  function init(savedState) {
    if (initialized) return;
    initialized = true;

    // Load saved progress
    if (savedState && savedState.sites) {
      for (const [id, data] of Object.entries(savedState.sites)) {
        const bp = BLUEPRINTS.find(b => b.id === id);
        if (!bp) continue;
        sites.set(id, {
          blueprint: bp,
          currentTokens: data.currentTokens || 0,
          completed: data.completed || false,
          entity: null,
        });
      }
      totalTokensBurned = savedState.totalTokensBurned || 0;
    }

    // Ensure all blueprints have sites
    for (const bp of BLUEPRINTS) {
      if (!sites.has(bp.id)) {
        sites.set(bp.id, {
          blueprint: bp,
          currentTokens: 0,
          completed: false,
          entity: null,
        });
      }
    }

    // Find first incomplete site as active
    updateActiveSite();

    // Spawn entities for in-progress sites
    spawnEntities();
  }

  function updateActiveSite() {
    activeSiteId = null;
    for (const [id, site] of sites) {
      if (!site.completed) {
        activeSiteId = id;
        break;
      }
    }
  }

  // ===== Token burning =====

  /** Add tokens to the currently active construction site. */
  function addTokens(amount) {
    if (!activeSiteId) return;
    const site = sites.get(activeSiteId);
    if (!site || site.completed) return;

    const prevStage = getStage(site.currentTokens / site.blueprint.targetTokens);

    site.currentTokens = Math.min(site.blueprint.targetTokens, site.currentTokens + amount);
    totalTokensBurned += amount;

    const progress = site.currentTokens / site.blueprint.targetTokens;
    const newStage = getStage(progress);

    // Stage transition effects
    if (newStage !== prevStage) {
      if (typeof AudioManager !== 'undefined') AudioManager.playUIClick();
      if (typeof Farm !== 'undefined' && Farm.logEvent) {
        Farm.logEvent('\u{1F3D7}\u{FE0F}', `${site.blueprint.name}: ${STAGES[newStage].label}`);
      }
    }

    // Completion!
    if (progress >= 1.0 && !site.completed) {
      completeBuilding(site);
    }

    // Persist state (debounced)
    _saveState();

    // Notify builders
    if (typeof EventBus !== 'undefined') {
      EventBus.emit('CONSTRUCTION_PROGRESS', {
        siteId: activeSiteId,
        progress,
        stage: newStage,
        col: site.blueprint.col,
        row: site.blueprint.row,
      });
    }
  }

  function completeBuilding(site) {
    site.completed = true;

    // Remove construction entity
    if (site.entity && typeof IsoEntityManager !== 'undefined') {
      IsoEntityManager.remove(site.entity);
      site.entity = null;
    }

    // Mark building as unlocked in farm state
    if (typeof EventBus !== 'undefined') {
      EventBus.emit('BUILDING_CONSTRUCTED', {
        id: site.blueprint.id,
        name: site.blueprint.name,
      });
    }

    // Unlock building in farm state
    if (typeof window !== 'undefined' && window.buddy && window.buddy.unlockBuilding) {
      window.buddy.unlockBuilding(site.blueprint.id);
    }

    // Celebration effects
    if (typeof AudioManager !== 'undefined') AudioManager.playLevelUp();

    // Firework particles
    const off = _off();
    const wx = (off.col + site.blueprint.col) * 32 + 16;
    const wy = (off.row + site.blueprint.row) * 32;
    if (typeof IsoEffects !== 'undefined') {
      for (let i = 0; i < 12; i++) {
        const colors = ['#FFD700', '#FF6B6B', '#5BEF5B', '#4FC3F7', '#FF9944'];
        IsoEffects.spawnFloatingText(
          wx / 32 + (Math.random() - 0.5) * 3,
          wy / 32 - Math.random() * 2,
          '\u{2728}',
          colors[i % colors.length]
        );
      }
    }

    if (typeof Farm !== 'undefined' && Farm.logEvent) {
      Farm.logEvent(site.blueprint.icon, `${site.blueprint.name} completed!`);
    }

    // Skill XP for building
    if (typeof SkillSystem !== 'undefined') {
      SkillSystem.addXp('farming', 10);
    }

    // Move to next site
    updateActiveSite();
    spawnEntities();
  }

  // ===== Entity management =====

  function spawnEntities() {
    if (typeof IsoEntityManager === 'undefined') return;
    const off = _off();

    for (const [id, site] of sites) {
      // Remove old entity
      if (site.entity) {
        IsoEntityManager.remove(site.entity);
        site.entity = null;
      }

      // Skip completed buildings (handled by iso-farm syncBuildings)
      if (site.completed) continue;

      // Skip sites with 0 progress (not started yet)
      if (site.currentTokens <= 0) continue;

      // Create construction site entity
      const bp = site.blueprint;
      site.entity = IsoEntityManager.add(IsoEntityManager.createStatic(
        off.col + bp.col, off.row + bp.row,
        (ctx, sx, sy, tick) => drawConstructionSite(ctx, sx, sy, tick, site),
        { z: 0 }
      ));
    }
  }

  // ===== Drawing =====

  function drawConstructionSite(ctx, sx, sy, tick, site) {
    const progress = site.currentTokens / site.blueprint.targetTokens;
    const stage = getStage(progress);

    sx = Math.round(sx);
    sy = Math.round(sy);

    switch (stage) {
      case 'FOUNDATION':
        drawFoundation(ctx, sx, sy, tick, progress / 0.25);
        break;
      case 'SCAFFOLDING':
        drawScaffolding(ctx, sx, sy, tick, (progress - 0.25) / 0.5);
        break;
      case 'FRAMING':
        drawFraming(ctx, sx, sy, tick, (progress - 0.75) / 0.25);
        break;
    }

    // Progress bar above
    drawProgressBar(ctx, sx, sy - 24, progress, site.blueprint.name);

    // Construction dust particles
    if (tick % 20 === 0 && progress < 1) {
      if (typeof IsoEffects !== 'undefined') {
        IsoEffects.spawnText(
          (sx) / 32 / (typeof IsoEngine !== 'undefined' ? IsoEngine.getZoom() : 1),
          (sy) / 32 / (typeof IsoEngine !== 'undefined' ? IsoEngine.getZoom() : 1),
          '\u{1F4A8}', { color: '#AAA', life: 15, rise: 0.3 }
        );
      }
    }
  }

  /** Stage 1: Foundation — ground stakes, rope outline. */
  function drawFoundation(ctx, sx, sy, tick, stageProgress) {
    // Ground dirt mound
    ctx.fillStyle = '#8B6B3E';
    ctx.fillRect(sx - 10, sy - 4, 20, 4);

    // Stakes
    ctx.fillStyle = '#654321';
    const numStakes = Math.ceil(stageProgress * 4);
    const positions = [[-8, -6], [8, -6], [-8, -2], [8, -2]];
    for (let i = 0; i < numStakes; i++) {
      ctx.fillRect(sx + positions[i][0], sy + positions[i][1], 2, 6);
    }

    // Rope lines between stakes
    if (numStakes >= 2) {
      ctx.strokeStyle = '#D2B48C';
      ctx.lineWidth = 0.5;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      for (let i = 0; i < numStakes; i++) {
        const p = positions[i];
        if (i === 0) ctx.moveTo(sx + p[0] + 1, sy + p[1]);
        else ctx.lineTo(sx + p[0] + 1, sy + p[1]);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /** Stage 2: Scaffolding — wooden frame, half-height walls. */
  function drawScaffolding(ctx, sx, sy, tick, stageProgress) {
    // Foundation base
    ctx.fillStyle = '#8B8B8B';
    ctx.fillRect(sx - 10, sy - 3, 20, 3);

    // Scaffolding frame
    ctx.fillStyle = '#A0824A';
    // Left pole
    ctx.fillRect(sx - 9, sy - 3 - 12 * stageProgress, 2, 12 * stageProgress);
    // Right pole
    ctx.fillRect(sx + 7, sy - 3 - 12 * stageProgress, 2, 12 * stageProgress);

    // Cross braces
    if (stageProgress > 0.3) {
      ctx.strokeStyle = '#A0824A';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx - 8, sy - 3);
      ctx.lineTo(sx + 8, sy - 3 - 10 * stageProgress);
      ctx.stroke();
    }

    // Half wall (bricks)
    const wallH = Math.floor(8 * stageProgress);
    if (wallH > 0) {
      ctx.fillStyle = '#B8825A';
      ctx.fillRect(sx - 7, sy - 3 - wallH, 14, wallH);
      // Brick lines
      ctx.strokeStyle = '#8B6B3E';
      ctx.lineWidth = 0.5;
      for (let i = 0; i < wallH; i += 3) {
        ctx.beginPath();
        ctx.moveTo(sx - 7, sy - 3 - i);
        ctx.lineTo(sx + 7, sy - 3 - i);
        ctx.stroke();
      }
    }
  }

  /** Stage 3: Framing — roof skeleton, mostly-formed building. */
  function drawFraming(ctx, sx, sy, tick, stageProgress) {
    // Full walls
    ctx.fillStyle = '#B8825A';
    ctx.fillRect(sx - 8, sy - 14, 16, 14);

    // Brick pattern
    ctx.strokeStyle = '#8B6B3E';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 14; i += 3) {
      ctx.beginPath();
      ctx.moveTo(sx - 8, sy - i);
      ctx.lineTo(sx + 8, sy - i);
      ctx.stroke();
    }

    // Door opening
    ctx.fillStyle = '#333';
    ctx.fillRect(sx - 2, sy - 6, 4, 6);

    // Roof frame (progressively fills in)
    const roofProgress = stageProgress;
    ctx.fillStyle = '#654321';
    // Roof skeleton beams
    ctx.beginPath();
    ctx.moveTo(sx, sy - 14 - 8 * roofProgress);
    ctx.lineTo(sx - 10, sy - 14);
    ctx.lineTo(sx + 10, sy - 14);
    ctx.closePath();
    ctx.stroke();

    if (roofProgress > 0.5) {
      // Fill in roof tiles
      ctx.fillStyle = '#8B4513';
      ctx.beginPath();
      ctx.moveTo(sx, sy - 14 - 8);
      ctx.lineTo(sx - 10, sy - 14);
      ctx.lineTo(sx + 10, sy - 14);
      ctx.closePath();
      ctx.globalAlpha = (roofProgress - 0.5) * 2;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  /** Progress bar above construction site. */
  function drawProgressBar(ctx, sx, y, progress, name) {
    const BAR_W = 24;
    const BAR_H = 3;
    const bx = sx - BAR_W / 2;
    const by = y;

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(bx - 1, by - 1, BAR_W + 2, BAR_H + 2);

    // Fill
    let color;
    if (progress >= 0.75) color = '#5BEF5B';
    else if (progress >= 0.25) color = '#FFD700';
    else color = '#FF9944';
    ctx.fillStyle = color;
    ctx.fillRect(bx, by, BAR_W * Math.min(1, progress), BAR_H);

    // Percentage text
    ctx.fillStyle = '#FFF';
    ctx.font = '5px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${Math.floor(progress * 100)}%`, sx, by - 2);

    // Name
    ctx.fillStyle = '#CCC';
    ctx.font = '5px monospace';
    ctx.fillText(name, sx, by - 8);
  }

  // ===== Debounced save =====
  let _saveTimer = null;
  function _saveState() {
    if (_saveTimer) return;
    _saveTimer = setTimeout(() => {
      _saveTimer = null;
      if (typeof window !== 'undefined' && window.buddy && window.buddy.saveConstruction) {
        window.buddy.saveConstruction(getState());
      }
    }, 3000);
  }

  // ===== [T] key Token simulator =====

  let simulating = false;

  function setSimulating(active) { simulating = active; }

  function updateSimulator() {
    if (!simulating) return;
    // Simulate 50 tokens per frame
    addTokens(50);
  }

  // ===== Update =====

  function update(tick) {
    updateSimulator();
  }

  // ===== State persistence =====

  function getState() {
    const sitesState = {};
    for (const [id, site] of sites) {
      sitesState[id] = {
        currentTokens: site.currentTokens,
        completed: site.completed,
      };
    }
    return { sites: sitesState, totalTokensBurned };
  }

  // ===== EventBus integration =====

  function setupListeners() {
    if (typeof EventBus === 'undefined') return;

    // Real token burning from energy ticks
    EventBus.on('TOKEN_BURNED', (data) => {
      addTokens(data.amount || 1);
    });
  }

  // ===== Queries =====

  function getActiveSite() {
    if (!activeSiteId) return null;
    const site = sites.get(activeSiteId);
    if (!site) return null;
    return {
      id: activeSiteId,
      name: site.blueprint.name,
      progress: site.currentTokens / site.blueprint.targetTokens,
      stage: getStage(site.currentTokens / site.blueprint.targetTokens),
      col: site.blueprint.col,
      row: site.blueprint.row,
    };
  }

  function hasActiveConstruction() {
    return !!activeSiteId && sites.has(activeSiteId) && !sites.get(activeSiteId).completed;
  }

  function getSiteProgress(siteId) {
    const site = sites.get(siteId);
    if (!site) return 0;
    return site.currentTokens / site.blueprint.targetTokens;
  }

  // ===== Public API =====

  return {
    BLUEPRINTS,
    STAGES,
    init,
    addTokens,
    update,
    setupListeners,
    getState,
    getActiveSite,
    hasActiveConstruction,
    getSiteProgress,
    setSimulating,
    getStage,
  };
})();

if (typeof module !== 'undefined') module.exports = ConstructionManager;
