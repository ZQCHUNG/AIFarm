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

  // Error ring buffer (max 5 entries)
  const MAX_ERRORS = 5;
  const errorRing = [];
  let errorFlashTick = 0; // >0 means warning icon is flashing

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

  /** Log a caught error to the ring buffer. */
  function logError(source, message) {
    const now = new Date();
    const ts = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
    errorRing.push({ ts, source, message: String(message).slice(0, 60) });
    if (errorRing.length > MAX_ERRORS) errorRing.shift();
    errorFlashTick = 180; // flash for 3 seconds (60fps)
  }

  function getErrorCount() { return errorRing.length; }

  // ===== Update =====

  function update(tick) {
    // Always count FPS and decrement flash (even when hidden, for accuracy)
    frameCount++;
    if (errorFlashTick > 0) errorFlashTick--;
    const now = performance.now();
    if (now - lastFPSTime >= 1000) {
      fps = frameCount;
      frameCount = 0;
      lastFPSTime = now;
    }
  }

  // ===== Draw =====

  function draw(ctx, canvasW, canvasH, tick) {
    // Show pulsing red dot even when dashboard hidden (if errors exist)
    if (!visible && errorRing.length > 0 && errorFlashTick > 0) {
      ctx.save();
      const alpha = 0.4 + Math.sin(tick * 0.2) * 0.4;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#FF4444';
      ctx.beginPath();
      ctx.arc(14, 14, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.font = 'bold 7px monospace';
      ctx.fillStyle = '#FF4444';
      ctx.textAlign = 'center';
      ctx.fillText(String(errorRing.length), 14, 28);
      ctx.restore();
    }
    if (!visible) return;

    ctx.save();

    // Semi-transparent background panel (expand for error section)
    const panelW = 200;
    const errH = errorRing.length > 0 ? 20 + errorRing.length * 18 : 0;
    const panelH = 210 + errH;
    const px = 6;
    const py = 6;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(px, py, panelW, panelH);
    ctx.strokeStyle = errorRing.length > 0 ? '#FF4444' : '#0F0';
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
    y += lineH;

    // Error ring buffer section
    if (errorRing.length > 0) {
      y += 2;
      // Separator line
      ctx.strokeStyle = '#FF4444';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px + 4, y);
      ctx.lineTo(px + panelW - 4, y);
      ctx.stroke();
      y += 4;

      // Flashing warning icon
      const showIcon = errorFlashTick > 0 && Math.floor(errorFlashTick / 10) % 2 === 0;
      ctx.fillStyle = showIcon ? '#FF4444' : '#FF8800';
      ctx.font = 'bold 8px monospace';
      ctx.fillText(`ERRORS (${errorRing.length})`, px + 4, y);
      y += 10;

      // Error entries
      ctx.font = '6px monospace';
      for (const err of errorRing) {
        ctx.fillStyle = '#FF6666';
        ctx.fillText(`${err.ts} [${err.source}]`, px + 4, y);
        y += 8;
        ctx.fillStyle = '#FFAAAA';
        ctx.fillText(err.message, px + 8, y);
        y += 10;
      }
    }

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
    logError,
    getErrorCount,
  };
})();
