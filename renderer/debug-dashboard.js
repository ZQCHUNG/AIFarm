/**
 * debug-dashboard.js — Engine Performance & Debug Dashboard (Sprint 29 P2).
 *
 * [F3] toggles a semi-transparent overlay showing real-time engine stats:
 *   - Player coordinates (WorldX, WorldY) and current Chunk ID
 *   - Active entity count and estimated memory usage
 *   - Current audio levels and economy volatility
 *   - WebSocket connection status
 *   - FPS counter, weather state, season
 *   - Growth multiplier (weather logic v2)
 *
 * Intended for developers and advanced players to monitor performance.
 */
const DebugDashboard = (() => {
  let visible = false;

  // FPS tracking
  let frameCount = 0;
  let lastFPSTime = 0;
  let fps = 0;

  // ===== Toggle =====

  function toggle() {
    visible = !visible;
    if (typeof IsoEffects !== 'undefined') {
      const pp = (typeof Player !== 'undefined') ? Player.getPosition() : { x: 10, y: 10 };
      IsoEffects.spawnText(pp.x, pp.y - 1,
        visible ? 'Debug: ON' : 'Debug: OFF',
        { color: '#0F0', life: 40, rise: 0.3 });
    }
  }

  function isVisible() { return visible; }

  // ===== Update =====

  function update(tick) {
    if (!visible) return;

    // FPS calculation
    frameCount++;
    const now = performance.now();
    if (now - lastFPSTime >= 1000) {
      fps = frameCount;
      frameCount = 0;
      lastFPSTime = now;
    }
  }

  // ===== Draw =====

  function draw(ctx, canvasW, canvasH, tick) {
    if (!visible) return;

    ctx.save();

    // Semi-transparent background panel
    const panelW = 170;
    const panelH = 200;
    const px = 6;
    const py = 6;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(px, py, panelW, panelH);
    ctx.strokeStyle = '#0F0';
    ctx.lineWidth = 1;
    ctx.strokeRect(px, py, panelW, panelH);

    // Title
    ctx.font = 'bold 8px monospace';
    ctx.fillStyle = '#0F0';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('ENGINE DASHBOARD [F3]', px + 4, py + 4);

    // Stats
    ctx.font = '7px monospace';
    let y = py + 18;
    const lineH = 11;

    // FPS
    const fpsColor = fps >= 55 ? '#0F0' : (fps >= 30 ? '#FFD700' : '#FF4444');
    drawStat(ctx, px + 4, y, 'FPS', `${fps}`, fpsColor);
    y += lineH;

    // Player position
    if (typeof Player !== 'undefined') {
      const pp = Player.getPosition();
      drawStat(ctx, px + 4, y, 'Pos', `${pp.x.toFixed(1)}, ${pp.y.toFixed(1)}`, '#0FF');
      y += lineH;

      // Chunk ID
      if (typeof ChunkManager !== 'undefined' && ChunkManager.getPlayerChunk) {
        const chunk = ChunkManager.getPlayerChunk();
        drawStat(ctx, px + 4, y, 'Chunk', chunk || 'N/A', '#0FF');
      } else {
        const pt = Player.getTile();
        drawStat(ctx, px + 4, y, 'Tile', `${pt.col},${pt.row}`, '#0FF');
      }
      y += lineH;
    }

    // Entity count
    if (typeof IsoEntityManager !== 'undefined') {
      const count = IsoEntityManager.getCount ? IsoEntityManager.getCount() : '?';
      drawStat(ctx, px + 4, y, 'Entities', `${count}`, '#FFF');
      y += lineH;
    }

    // Weather & Season
    if (typeof IsoWeather !== 'undefined') {
      const weather = IsoWeather.getWeather();
      const season = IsoWeather.getSeason();
      const hour = IsoWeather.getHour ? IsoWeather.getHour().toFixed(1) : '?';
      drawStat(ctx, px + 4, y, 'Weather', weather, '#87CEEB');
      y += lineH;
      drawStat(ctx, px + 4, y, 'Season', `${season} ${hour}h`, '#87CEEB');
      y += lineH;
    }

    // Growth multiplier
    if (typeof WeatherLogicV2 !== 'undefined') {
      const mult = WeatherLogicV2.getGrowthMultiplier();
      const drought = WeatherLogicV2.isDrought();
      const mColor = drought ? '#FF4444' : (mult > 1 ? '#0F0' : '#FFF');
      drawStat(ctx, px + 4, y, 'Growth', `x${mult.toFixed(2)}${drought ? ' DROUGHT' : ''}`, mColor);
      y += lineH;
    }

    // Market economy
    if (typeof MarketEconomy !== 'undefined' && MarketEconomy.getVolatility) {
      drawStat(ctx, px + 4, y, 'Market', MarketEconomy.getVolatility(), '#FFD700');
      y += lineH;
    }

    // Network status
    if (typeof NetworkClient !== 'undefined') {
      const connected = NetworkClient.isConnected();
      drawStat(ctx, px + 4, y, 'Network',
        connected ? 'Connected' : 'Offline',
        connected ? '#0F0' : '#FF4444');
      y += lineH;
    }

    // Post-processing filter
    if (typeof PostProcessing !== 'undefined') {
      drawStat(ctx, px + 4, y, 'Filter', PostProcessing.getFilter(), '#AAA');
      y += lineH;
    }

    // NPC count
    if (typeof NPCManager !== 'undefined') {
      drawStat(ctx, px + 4, y, 'NPCs', `${NPCManager.getNPCCount()}`, '#AAA');
      y += lineH;
    }

    // Tick
    drawStat(ctx, px + 4, y, 'Tick', `${tick}`, '#666');

    ctx.restore();
  }

  function drawStat(ctx, x, y, label, value, valueColor) {
    ctx.fillStyle = '#888';
    ctx.fillText(label + ':', x, y);
    ctx.fillStyle = valueColor || '#FFF';
    ctx.fillText(String(value), x + 60, y);
  }

  return {
    toggle,
    isVisible,
    update,
    draw,
  };
})();
