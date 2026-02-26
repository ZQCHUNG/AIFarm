/**
 * post-processing.js — Visual post-processing filters (Sprint 28 P2).
 *
 * Applies optional full-screen visual effects after all rendering:
 *   - CRT Retro: scanlines + slight barrel distortion + vignette
 *   - Warm Sunset: orange/amber color tint overlay
 *   - None: no filter (default)
 *
 * Toggle with [F9] key. Cycles through: None → CRT → Warm → None.
 */
const PostProcessing = (() => {
  const FILTERS = ['none', 'crt', 'warm'];
  let currentFilter = 0; // index into FILTERS

  function getFilter() { return FILTERS[currentFilter]; }

  function cycleFilter() {
    currentFilter = (currentFilter + 1) % FILTERS.length;
    const name = FILTERS[currentFilter];
    if (typeof IsoEffects !== 'undefined') {
      const labels = { none: 'Filter: Off', crt: 'Filter: CRT Retro', warm: 'Filter: Warm Sunset' };
      IsoEffects.spawnText(
        (typeof Player !== 'undefined') ? Player.getPosition().x : 10,
        (typeof Player !== 'undefined') ? Player.getPosition().y - 1 : 9,
        labels[name],
        { color: '#FFF', life: 60, rise: 0.3 }
      );
    }
    return name;
  }

  function draw(ctx, canvasW, canvasH, tick) {
    const filter = FILTERS[currentFilter];
    if (filter === 'none') return;

    ctx.save();

    if (filter === 'crt') {
      drawCRT(ctx, canvasW, canvasH, tick);
    } else if (filter === 'warm') {
      drawWarm(ctx, canvasW, canvasH);
    }

    ctx.restore();
  }

  // ===== CRT Retro Filter =====

  function drawCRT(ctx, canvasW, canvasH, tick) {
    // Scanlines
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    for (let y = 0; y < canvasH; y += 3) {
      ctx.fillRect(0, y, canvasW, 1);
    }

    // Vignette (dark corners)
    const grd = ctx.createRadialGradient(
      canvasW / 2, canvasH / 2, canvasW * 0.3,
      canvasW / 2, canvasH / 2, canvasW * 0.7
    );
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Slight green/blue tint (CRT phosphor feel)
    ctx.globalAlpha = 0.03;
    ctx.fillStyle = '#00FF88';
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.globalAlpha = 1;

    // Occasional scan flicker
    if (Math.random() < 0.005) {
      ctx.globalAlpha = 0.04;
      ctx.fillStyle = '#FFF';
      const flickerY = Math.random() * canvasH;
      ctx.fillRect(0, flickerY, canvasW, 2);
      ctx.globalAlpha = 1;
    }
  }

  // ===== Warm Sunset Filter =====

  function drawWarm(ctx, canvasW, canvasH) {
    // Warm amber overlay
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = '#FF8C00';
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Subtle vignette
    const grd = ctx.createRadialGradient(
      canvasW / 2, canvasH / 2, canvasW * 0.35,
      canvasW / 2, canvasH / 2, canvasW * 0.65
    );
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(60,20,0,0.15)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, canvasW, canvasH);
  }

  return {
    getFilter,
    cycleFilter,
    draw,
  };
})();
