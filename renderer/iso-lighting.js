/**
 * iso-lighting.js — Dynamic Lighting 2.0 for AIFarm 3.0 (Sprint 16 P1).
 *
 * Renders a darkness overlay with radial glow cutouts for light sources.
 * Uses an offscreen canvas with destination-out compositing for performance.
 * Replaces the simple IsoWeather.drawNightOverlay when loaded.
 *
 * Light sources: lamp posts, buildings with windows, player, monument.
 */
const IsoLighting = (() => {
  // Offscreen canvas for darkness mask
  let offCanvas = null;
  let offCtx = null;
  let lastW = 0;
  let lastH = 0;

  // Known light source positions (grid coordinates)
  const LAMP_POSITIONS = [[3, 10], [7, 10], [11, 10], [15, 10]];

  // Building light sources (buildings that glow at night)
  const BUILDING_LIGHTS = {
    well:     { col: 2,  row: 15, radius: 35, color: [100, 180, 255] },  // blue well glow
    barn:     { col: 5,  row: 15, radius: 40, color: [255, 200, 100] },  // warm barn
    windmill: { col: 8,  row: 15, radius: 45, color: [255, 220, 130] },  // windmill lantern
    market:   { col: 11, row: 15, radius: 50, color: [255, 180, 80] },   // market torches
    clock:    { col: 14, row: 15, radius: 40, color: [200, 220, 255] },  // clock face glow
    townhall: { col: 4,  row: 17, radius: 55, color: [255, 210, 120] },  // town hall windows
    statue:   { col: 15, row: 17, radius: 35, color: [255, 215, 0] },    // golden statue
  };

  // Tool shed / shipping bin area
  const SHOP_LIGHT = { col: 2, row: 10, radius: 35, color: [255, 200, 100] };

  function ensureCanvas(w, h) {
    if (offCanvas && lastW === w && lastH === h) return;
    offCanvas = document.createElement('canvas');
    offCanvas.width = w;
    offCanvas.height = h;
    offCtx = offCanvas.getContext('2d');
    lastW = w;
    lastH = h;
  }

  /**
   * Draw a radial light cutout on the offscreen darkness canvas.
   * Uses destination-out to "erase" darkness where light exists.
   */
  function cutLight(ctx, x, y, radius, r, g, b, intensity) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
    grad.addColorStop(0, `rgba(255, 255, 255, ${intensity})`);
    grad.addColorStop(0.4, `rgba(255, 255, 255, ${intensity * 0.6})`);
    grad.addColorStop(0.7, `rgba(255, 255, 255, ${intensity * 0.2})`);
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Add warm color tint back on top (lighter composite)
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    const tintGrad = ctx.createRadialGradient(x, y, 0, x, y, radius * 0.6);
    tintGrad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${intensity * 0.15})`);
    tintGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = tintGrad;
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * Draw the full dynamic lighting overlay.
   * Call this INSTEAD of IsoWeather.drawNightOverlay when IsoLighting is loaded.
   */
  function draw(ctx, canvasW, canvasH, tick) {
    if (typeof IsoWeather === 'undefined') return;
    const dp = IsoWeather.getDayPhase();
    if (dp.nightAlpha <= 0) return;

    ensureCanvas(canvasW, canvasH);

    // Step 1: Fill offscreen with night darkness
    offCtx.clearRect(0, 0, canvasW, canvasH);
    offCtx.globalCompositeOperation = 'source-over';
    offCtx.fillStyle = `rgba(10, 10, 50, ${(dp.nightAlpha * 0.6).toFixed(3)})`;
    offCtx.fillRect(0, 0, canvasW, canvasH);

    // Step 2: Draw stars on the darkness layer (deep night only)
    if (dp.phase === 'night') {
      offCtx.fillStyle = '#FFF';
      const starSeed = 42;
      for (let i = 0; i < 25; i++) {
        const sx = ((starSeed * (i + 1) * 7.3) % canvasW);
        const sy = ((starSeed * (i + 1) * 3.7) % (canvasH * 0.35));
        const twinkle = Math.sin(tick * 0.05 + i * 2.3) * 0.3 + 0.5;
        offCtx.globalAlpha = twinkle;
        const size = i % 5 === 0 ? 2 : 1;
        offCtx.fillRect(sx, sy, size, size);
      }
      offCtx.globalAlpha = 1;
    }

    // Intensity scales with nightAlpha (dusk = subtle, night = strong)
    const lightIntensity = Math.min(1, dp.nightAlpha * 3);

    // Need IsoEngine for grid-to-screen conversion
    if (typeof IsoEngine === 'undefined') {
      ctx.drawImage(offCanvas, 0, 0);
      return;
    }

    const zoom = IsoEngine.getZoom();

    // Step 3: Cut light holes for each source

    // 3a. Lamp posts — warm yellow glow
    for (const [col, row] of LAMP_POSITIONS) {
      const screen = IsoEngine.gridToScreen(col, row);
      const sx = screen.x * zoom + 16 * zoom;
      const sy = (screen.y - 10) * zoom;
      const r = 32 * zoom;
      // Flicker effect
      const flicker = 1 + Math.sin(tick * 0.08 + col * 3) * 0.08;
      cutLight(offCtx, sx, sy, r * flicker, 255, 220, 100, lightIntensity * 0.9);
    }

    // 3b. Buildings (only unlocked ones)
    if (typeof IsoFarm !== 'undefined' && IsoFarm.BUILDING_POSITIONS) {
      const farmState = (typeof Farm !== 'undefined') ? Farm.getState() : null;
      const unlockedBuildings = farmState ? (farmState.buildings || []) : [];

      for (const bld of unlockedBuildings) {
        const light = BUILDING_LIGHTS[bld];
        if (!light) continue;
        const screen = IsoEngine.gridToScreen(light.col, light.row);
        const sx = screen.x * zoom + 16 * zoom;
        const sy = screen.y * zoom;
        const r = light.radius * zoom;
        const [cr, cg, cb] = light.color;
        const flicker = 1 + Math.sin(tick * 0.06 + light.col * 2.5) * 0.05;
        cutLight(offCtx, sx, sy, r * flicker, cr, cg, cb, lightIntensity * 0.8);
      }
    }

    // 3c. Tool shed / shop area
    {
      const screen = IsoEngine.gridToScreen(SHOP_LIGHT.col, SHOP_LIGHT.row);
      const sx = screen.x * zoom + 16 * zoom;
      const sy = screen.y * zoom;
      const r = SHOP_LIGHT.radius * zoom;
      cutLight(offCtx, sx, sy, r, 255, 200, 100, lightIntensity * 0.7);
    }

    // 3d. Player character — subtle warm aura
    if (typeof Player !== 'undefined') {
      const pp = Player.getPosition();
      const pcol = pp.x / 32;
      const prow = pp.y / 32;
      const screen = IsoEngine.gridToScreen(pcol, prow);
      const sx = screen.x * zoom + 16 * zoom;
      const sy = screen.y * zoom;
      const playerRadius = (Player.isSprinting() ? 30 : 22) * zoom;
      cutLight(offCtx, sx, sy, playerRadius, 255, 215, 0, lightIntensity * 0.6);
    }

    // 3e. Monument (if unlocked — golden pulsing glow)
    if (typeof Farm !== 'undefined') {
      const st = Farm.getState();
      if (st && st.energy >= 10000) {
        const screen = IsoEngine.gridToScreen(10, 1);
        const sx = screen.x * zoom + 16 * zoom;
        const sy = screen.y * zoom;
        const pulse = 1 + Math.sin(tick * 0.04) * 0.15;
        const r = 50 * zoom * pulse;
        cutLight(offCtx, sx, sy, r, 255, 215, 0, lightIntensity * 0.9);
      }
    }

    // Step 4: Composite offscreen darkness onto main canvas
    ctx.drawImage(offCanvas, 0, 0);

    // Step 5: Add warm color wash on light sources (additive, screen-space)
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = lightIntensity * 0.08;

    // Warm glow halos on lamp positions
    for (const [col, row] of LAMP_POSITIONS) {
      const screen = IsoEngine.gridToScreen(col, row);
      const sx = screen.x * zoom + 16 * zoom;
      const sy = (screen.y - 8) * zoom;
      const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, 20 * zoom);
      grad.addColorStop(0, 'rgba(255, 200, 80, 0.4)');
      grad.addColorStop(1, 'rgba(255, 200, 80, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(sx, sy, 20 * zoom, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  return {
    draw,
  };
})();
