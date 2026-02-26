/**
 * automation-logic.js — Automation Pipes for AIFarm 3.0 (Sprint 20 P0).
 *
 * Two automations purchasable from the shop:
 *   - Sprinkler: 3×3 auto-water coverage — speeds crop growth in radius
 *   - Auto-Collector: auto-harvests mature crops & auto-collects from processing
 *
 * Automation consumes GOLD maintenance every cycle (CTO decision).
 * Each device is placed at a fixed grid position and drawn as a pixel-art entity.
 */

const Automation = (() => {
  // ===== Configuration =====

  // Sprinkler config
  const SPRINKLER_COST = 60;       // GOLD to buy from shop
  const SPRINKLER_MAINTENANCE = 2;  // GOLD per cycle (every CYCLE_TICKS)
  const SPRINKLER_RADIUS = 1;       // 1 = 3×3 area around center
  const SPRINKLER_CYCLE = 300;      // ticks between auto-water (~5 seconds)

  // Auto-collector config
  const COLLECTOR_COST = 100;
  const COLLECTOR_MAINTENANCE = 3;
  const COLLECTOR_CYCLE = 360;      // ticks between auto-collect (~6 seconds)

  // Placement positions (fixed — appear near crop field)
  const SPRINKLER_POSITIONS = [
    { col: 5, row: 5 },   // center of left field section
    { col: 9, row: 5 },   // center of right field section
    { col: 5, row: 8 },   // lower left
    { col: 9, row: 8 },   // lower right
  ];

  const COLLECTOR_POSITION = { col: 7, row: 9 }; // path between fields

  // ===== State =====

  let sprinklers = [];       // { col, row, active, lastCycle }
  let collectorActive = false;
  let collectorLastCycle = 0;
  let tick = 0;

  // Track placed sprinkler count (unlock progressively with energy)
  let maxSprinklers = 0;
  let sprinklersPurchased = 0;
  let collectorPurchased = false;

  // Home offset helper for mega-map support
  function _off() {
    return (typeof IsoEngine !== 'undefined' && IsoEngine.getHomeOffset)
      ? IsoEngine.getHomeOffset() : { col: 0, row: 0 };
  }
  /** Get world col from local farm col. */
  function _wc(c) { return c + _off().col; }
  function _wr(r) { return r + _off().row; }

  // ===== Initialization =====

  function init() {
    setupListeners();
  }

  function setupListeners() {
    if (typeof EventBus === 'undefined') return;

    // Shop purchases unlock automation
    EventBus.on('SHOP_PURCHASE', (data) => {
      if (data.item === 'sprinkler') {
        purchaseSprinkler();
      } else if (data.item === 'auto_collector') {
        purchaseCollector();
      }
    });
  }

  function purchaseSprinkler() {
    if (sprinklersPurchased >= SPRINKLER_POSITIONS.length) return false;
    const pos = SPRINKLER_POSITIONS[sprinklersPurchased];
    sprinklers.push({
      col: _wc(pos.col),
      row: _wr(pos.row),
      active: true,
      lastCycle: tick,
    });
    sprinklersPurchased++;

    if (typeof Farm !== 'undefined' && Farm.logEvent) {
      Farm.logEvent('\u{1F4A6}', `Sprinkler #${sprinklersPurchased} installed!`);
    }

    // Spawn placement effect
    if (typeof IsoEffects !== 'undefined') {
      IsoEffects.spawnFloatingText(pos.col * 32, pos.row * 32 - 16,
        '\u{1F4A6} Sprinkler placed!', '#4FC3F7');
    }

    return true;
  }

  function purchaseCollector() {
    if (collectorPurchased) return false;
    collectorPurchased = true;
    collectorActive = true;
    collectorLastCycle = tick;

    if (typeof Farm !== 'undefined' && Farm.logEvent) {
      Farm.logEvent('\u{1F916}', 'Auto-Collector online!');
    }

    if (typeof IsoEffects !== 'undefined') {
      IsoEffects.spawnFloatingText(_wc(COLLECTOR_POSITION.col) * 32, _wr(COLLECTOR_POSITION.row) * 32 - 16,
        '\u{1F916} Auto-Collector active!', '#FFD700');
    }

    return true;
  }

  // ===== Update =====

  function update(currentTick) {
    tick = currentTick;

    // Update sprinklers
    for (const sprinkler of sprinklers) {
      if (!sprinkler.active) continue;
      if (tick - sprinkler.lastCycle >= SPRINKLER_CYCLE) {
        sprinkler.lastCycle = tick;
        runSprinklerCycle(sprinkler);
      }
    }

    // Update auto-collector
    if (collectorActive && collectorPurchased) {
      if (tick - collectorLastCycle >= COLLECTOR_CYCLE) {
        collectorLastCycle = tick;
        runCollectorCycle();
      }
    }
  }

  function runSprinklerCycle(sprinkler) {
    // Check maintenance cost
    if (typeof ResourceInventory !== 'undefined') {
      if (!ResourceInventory.has('gold', SPRINKLER_MAINTENANCE)) {
        sprinkler.active = false;
        if (typeof Farm !== 'undefined' && Farm.logEvent) {
          Farm.logEvent('\u{26A0}\u{FE0F}', 'Sprinkler ran out of gold!');
        }
        return;
      }
      ResourceInventory.spend('gold', SPRINKLER_MAINTENANCE);
    }

    // Water crops in 3×3 area
    if (typeof IsoFarm === 'undefined') return;
    const plots = IsoFarm.PLOT_POSITIONS;
    if (!plots) return;

    let watered = 0;
    for (let i = 0; i < plots.length; i++) {
      const p = plots[i];
      const plotWidth = p.width || 1;
      // Check if any tile of this plot is within sprinkler radius
      for (let tc = 0; tc < plotWidth; tc++) {
        const tileCol = p.col + tc;
        const tileRow = p.row;
        const dx = Math.abs(tileCol - sprinkler.col);
        const dy = Math.abs(tileRow - sprinkler.row);
        if (dx <= SPRINKLER_RADIUS && dy <= SPRINKLER_RADIUS) {
          watered++;
          break;
        }
      }
    }

    // Visual feedback: water particles in 3×3 area
    if (typeof IsoEngine !== 'undefined') {
      for (let dx = -SPRINKLER_RADIUS; dx <= SPRINKLER_RADIUS; dx++) {
        for (let dy = -SPRINKLER_RADIUS; dy <= SPRINKLER_RADIUS; dy++) {
          const tc = sprinkler.col + dx;
          const tr = sprinkler.row + dy;
          IsoEngine.spawnHarvestParticles(tc + 0.5, tr + 0.5, '#4FC3F7', 3);
        }
      }
    }

    // Emit water event for farm state to boost growth
    if (typeof EventBus !== 'undefined' && watered > 0) {
      EventBus.emit('AUTO_WATER', {
        col: sprinkler.col,
        row: sprinkler.row,
        radius: SPRINKLER_RADIUS,
        plotsWatered: watered,
      });
    }
  }

  function runCollectorCycle() {
    // Check maintenance cost
    if (typeof ResourceInventory !== 'undefined') {
      if (!ResourceInventory.has('gold', COLLECTOR_MAINTENANCE)) {
        collectorActive = false;
        if (typeof Farm !== 'undefined' && Farm.logEvent) {
          Farm.logEvent('\u{26A0}\u{FE0F}', 'Auto-Collector ran out of gold!');
        }
        return;
      }
      ResourceInventory.spend('gold', COLLECTOR_MAINTENANCE);
    }

    // Auto-harvest mature crops
    if (typeof IsoFarm !== 'undefined' && IsoFarm.getCropStage) {
      const plots = IsoFarm.PLOT_POSITIONS;
      if (plots) {
        let harvested = 0;
        for (let i = 0; i < plots.length; i++) {
          const stage = IsoFarm.getCropStage(i);
          if (stage >= 4) {
            harvested++;
            const p = plots[i];
            // Harvest particle effect
            if (typeof IsoEngine !== 'undefined') {
              IsoEngine.spawnHarvestParticles(p.col + 1, p.row, '#FFD700', 6);
            }
            if (typeof IsoEffects !== 'undefined') {
              IsoEffects.spawnText(p.col + 1, p.row - 0.5,
                '\u{1F916}\u{2714}\u{FE0F}', { color: '#4CAF50', life: 40, rise: 0.8 });
            }
          }
        }

        if (harvested > 0) {
          // Emit auto-harvest event → main process triggers actual harvest
          if (typeof EventBus !== 'undefined') {
            EventBus.emit('AUTO_HARVEST', { count: harvested });
          }
          if (typeof Farm !== 'undefined' && Farm.logEvent) {
            Farm.logEvent('\u{1F916}', `Auto-Collector harvested ${harvested} crop(s)`);
          }
        }
      }
    }

    // Auto-collect from processing buildings
    if (typeof Processing !== 'undefined' && Processing.collectReady) {
      const collected = Processing.collectReady();
      if (collected > 0 && typeof Farm !== 'undefined' && Farm.logEvent) {
        Farm.logEvent('\u{1F916}', `Auto-Collector picked up ${collected} product(s)`);
      }
    }

    // Collector visual pulse
    if (typeof IsoEngine !== 'undefined') {
      IsoEngine.spawnHarvestParticles(_wc(COLLECTOR_POSITION.col) + 0.5,
        _wr(COLLECTOR_POSITION.row) + 0.5, '#FFD700', 5);
    }
  }

  // ===== Drawing =====

  function draw(ctx, tick) {
    // Draw sprinklers
    for (const s of sprinklers) {
      const screen = IsoEngine.gridToScreen(s.col, s.row);
      if (!screen) continue;
      drawSprinkler(ctx, screen.x, screen.y, s.active, tick);
    }

    // Draw auto-collector
    if (collectorPurchased) {
      const screen = IsoEngine.gridToScreen(_wc(COLLECTOR_POSITION.col), _wr(COLLECTOR_POSITION.row));
      if (screen) {
        drawCollector(ctx, screen.x, screen.y, collectorActive, tick);
      }
    }
  }

  function drawSprinkler(ctx, sx, sy, active, tick) {
    // Base plate (metal circle)
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.beginPath();
    ctx.ellipse(sx, sy + 2, 8, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Metal body
    ctx.fillStyle = active ? '#4A90D9' : '#888';
    ctx.fillRect(sx - 4, sy - 6, 8, 8);

    // Nozzle top
    ctx.fillStyle = active ? '#5BA0E9' : '#999';
    ctx.fillRect(sx - 2, sy - 9, 4, 4);

    // Rotating arm when active
    if (active) {
      const angle = (tick * 0.08) % (Math.PI * 2);
      const armLen = 5;
      ctx.strokeStyle = '#6BB0F0';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx, sy - 7);
      ctx.lineTo(sx + Math.cos(angle) * armLen, sy - 7 + Math.sin(angle) * armLen * 0.5);
      ctx.stroke();

      // Water droplet animation (every 20 ticks)
      if (tick % 20 < 5) {
        ctx.fillStyle = 'rgba(79, 195, 247, 0.6)';
        const dropAngle = angle + Math.PI / 4;
        ctx.fillRect(
          sx + Math.cos(dropAngle) * 7 - 1,
          sy - 7 + Math.sin(dropAngle) * 3 - 1,
          2, 3
        );
      }
    }

    // Status LED
    ctx.fillStyle = active ? '#4CAF50' : '#FF4444';
    ctx.fillRect(sx + 3, sy - 5, 2, 2);
  }

  function drawCollector(ctx, sx, sy, active, tick) {
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.beginPath();
    ctx.ellipse(sx, sy + 3, 10, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Robot body
    ctx.fillStyle = active ? '#FFD700' : '#888';
    ctx.fillRect(sx - 7, sy - 10, 14, 12);

    // Face panel
    ctx.fillStyle = active ? '#FFF8DC' : '#CCC';
    ctx.fillRect(sx - 5, sy - 8, 10, 6);

    // Eyes (LED dots)
    const blink = tick % 60 < 5;
    ctx.fillStyle = active ? (blink ? '#333' : '#4CAF50') : '#666';
    ctx.fillRect(sx - 3, sy - 6, 2, 2);
    ctx.fillRect(sx + 1, sy - 6, 2, 2);

    // Mouth (small line)
    ctx.fillStyle = active ? '#333' : '#666';
    ctx.fillRect(sx - 2, sy - 3, 4, 1);

    // Antenna
    ctx.fillStyle = '#888';
    ctx.fillRect(sx - 1, sy - 13, 2, 3);
    // Antenna tip (pulses when active)
    if (active) {
      const pulse = Math.sin(tick * 0.15) * 0.5 + 0.5;
      ctx.fillStyle = `rgba(255, 0, 0, ${0.5 + pulse * 0.5})`;
    } else {
      ctx.fillStyle = '#FF4444';
    }
    ctx.fillRect(sx - 1, sy - 14, 2, 2);

    // Arms (little grabbers on sides)
    const armBob = active ? Math.sin(tick * 0.1) * 1.5 : 0;
    ctx.fillStyle = active ? '#DAA520' : '#777';
    ctx.fillRect(sx - 9, sy - 6 + armBob, 3, 4);
    ctx.fillRect(sx + 6, sy - 6 - armBob, 3, 4);

    // Wheels
    ctx.fillStyle = '#555';
    ctx.fillRect(sx - 6, sy + 1, 4, 3);
    ctx.fillRect(sx + 2, sy + 1, 4, 3);

    // Label
    if (active) {
      ctx.fillStyle = '#4A2800';
      ctx.font = '4px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('AUTO', sx, sy + 6);
    }
  }

  // ===== State persistence =====

  function getState() {
    return {
      sprinklers: sprinklers.map(s => ({
        col: s.col, row: s.row, active: s.active,
      })),
      sprinklersPurchased,
      collectorPurchased,
      collectorActive,
    };
  }

  function loadState(state) {
    if (!state) return;
    if (state.sprinklersPurchased) sprinklersPurchased = state.sprinklersPurchased;
    if (state.collectorPurchased) collectorPurchased = state.collectorPurchased;
    if (state.collectorActive !== undefined) collectorActive = state.collectorActive;
    if (state.sprinklers && Array.isArray(state.sprinklers)) {
      sprinklers = state.sprinklers.map(s => ({
        col: s.col, row: s.row, active: s.active !== false, lastCycle: 0,
      }));
    }
  }

  // Reactivate if enough gold
  function reactivateAll() {
    if (typeof ResourceInventory === 'undefined') return;
    for (const s of sprinklers) {
      if (!s.active && ResourceInventory.has('gold', SPRINKLER_MAINTENANCE)) {
        s.active = true;
      }
    }
    if (!collectorActive && collectorPurchased && ResourceInventory.has('gold', COLLECTOR_MAINTENANCE)) {
      collectorActive = true;
    }
  }

  // ===== Public info =====

  function getSprinklerCount() { return sprinklersPurchased; }
  function getMaxSprinklers() { return SPRINKLER_POSITIONS.length; }
  function isCollectorActive() { return collectorActive; }
  function isCollectorPurchased() { return collectorPurchased; }

  return {
    SPRINKLER_COST,
    COLLECTOR_COST,
    init,
    setupListeners,
    update,
    draw,
    getState,
    loadState,
    reactivateAll,
    getSprinklerCount,
    getMaxSprinklers,
    isCollectorActive,
    isCollectorPurchased,
    SPRINKLER_POSITIONS,
    COLLECTOR_POSITION,
  };
})();

if (typeof module !== 'undefined') module.exports = Automation;
