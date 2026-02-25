// Iso Effects — floating text, reward popups, and milestone notifications.
// Renders in zoomed (camera) space, anchored to grid positions.
// Complements IsoEngine's particle system with text-based effects.
const IsoEffects = (() => {
  // ===== Floating text pool =====
  const floatingTexts = [];
  const MAX_TEXTS = 30;

  /**
   * Spawn floating text at a grid position (e.g., "+1.2k Tokens").
   * Rises upward, fades out over its lifetime.
   * @param {number} col - Grid column
   * @param {number} row - Grid row
   * @param {string} text - Display text
   * @param {object} [opts] - Options
   * @param {string} [opts.color='#FFD700'] - Text color
   * @param {string} [opts.font='bold 8px monospace'] - Font
   * @param {number} [opts.life=80] - Lifetime in ticks
   * @param {number} [opts.rise=0.6] - Rise speed (pixels per tick)
   * @param {boolean} [opts.particles=false] - Emit gold particles alongside
   */
  function spawnText(col, row, text, opts) {
    if (floatingTexts.length >= MAX_TEXTS) return;
    const o = opts || {};
    const screenPos = (typeof IsoEngine !== 'undefined')
      ? IsoEngine.gridToScreen(col, row)
      : { x: col * 32, y: row * 32 };

    floatingTexts.push({
      x: screenPos.x + 16, // center of tile
      y: screenPos.y,
      text,
      color: o.color || '#FFD700',
      font: o.font || 'bold 8px monospace',
      life: o.life || 80,
      age: 0,
      rise: o.rise || 0.6,
      scale: 0, // starts at 0, pops to 1
    });

    // Optionally spawn gold particles
    if (o.particles && typeof IsoEngine !== 'undefined') {
      IsoEngine.spawnHarvestParticles(col, row, o.color || '#FFD700', 6);
    }
  }

  /**
   * Spawn a harvest reward text (convenience wrapper).
   * @param {number} col - Grid column
   * @param {number} row - Grid row
   * @param {number} tokens - Token amount
   */
  function spawnHarvestReward(col, row, tokens) {
    const fmt = tokens >= 1000000 ? (tokens / 1000000).toFixed(1) + 'M'
              : tokens >= 1000 ? (tokens / 1000).toFixed(1) + 'k'
              : String(tokens);
    spawnText(col, row, `+${fmt}`, {
      color: '#FFD700',
      font: 'bold 9px monospace',
      life: 90,
      rise: 0.5,
      particles: true,
    });
  }

  /**
   * Spawn a milestone notification (larger, centered on screen).
   * @param {string} text - Milestone text (e.g., "🌻 Gardener!")
   * @param {object} [opts]
   */
  function spawnMilestone(text, opts) {
    const o = opts || {};
    // Screen-centered, stored as negative col to flag as screen-space
    floatingTexts.push({
      x: -1, // marker for screen-space centering
      y: -1,
      text,
      color: o.color || '#FFD700',
      font: o.font || 'bold 11px monospace',
      life: o.life || 120,
      age: 0,
      rise: 0.3,
      scale: 0,
      screenSpace: true,
    });
  }

  // ===== Update =====

  function update() {
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
      const ft = floatingTexts[i];
      ft.age++;
      if (!ft.screenSpace) {
        ft.y -= ft.rise;
      }
      // Pop-in scale: 0→1.2→1 over first 8 ticks
      if (ft.age <= 4) {
        ft.scale = ft.age / 4 * 1.2;
      } else if (ft.age <= 8) {
        ft.scale = 1.2 - (ft.age - 4) / 4 * 0.2;
      } else {
        ft.scale = 1;
      }
      if (ft.age >= ft.life) {
        floatingTexts.splice(i, 1);
      }
    }
  }

  // ===== Draw =====

  /**
   * Draw all floating effects.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} canvasW - Canvas width (for screen-space centering)
   * @param {number} canvasH - Canvas height
   */
  function draw(ctx, canvasW, canvasH) {
    if (floatingTexts.length === 0) return;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const ft of floatingTexts) {
      const alpha = ft.age < 10 ? 1 : Math.max(0, 1 - (ft.age - 10) / (ft.life - 10));
      if (alpha <= 0) continue;

      ctx.globalAlpha = alpha;
      ctx.font = ft.font;

      let dx, dy;
      if (ft.screenSpace) {
        // Screen-space: centered horizontally, rises from center
        dx = canvasW / 2;
        dy = canvasH * 0.35 - ft.age * ft.rise;
      } else {
        dx = ft.x;
        dy = ft.y;
      }

      // Scale effect (pop-in)
      if (ft.scale !== 1) {
        ctx.save();
        ctx.translate(dx, dy);
        ctx.scale(ft.scale, ft.scale);
        dx = 0;
        dy = 0;
      }

      // Text shadow
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillText(ft.text, dx + 1, dy + 1);
      // Text
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, dx, dy);

      if (ft.scale !== 1) {
        ctx.restore();
      }
    }

    ctx.restore();
  }

  function clear() {
    floatingTexts.length = 0;
  }

  return {
    spawnText,
    spawnHarvestReward,
    spawnMilestone,
    update,
    draw,
    clear,
  };
})();
