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

  // ===== Resource pop-up sprites (fly from harvest to HUD) =====
  const resourcePopups = [];
  const MAX_POPUPS = 20;

  // Resource icon map (same as iso-farm HUD)
  const POPUP_ICONS = {
    gold: '\u{1FA99}',        // 🪙
    wood: '\u{1FAB5}',        // 🪵
    stone: '\u{1FAA8}',       // 🪨
    carrot: '\u{1F955}',      // 🥕
    sunflower: '\u{1F33B}',   // 🌻
    watermelon: '\u{1F349}',  // 🍉
    tomato: '\u{1F345}',      // 🍅
    corn: '\u{1F33D}',        // 🌽
    pumpkin: '\u{1F383}',     // 🎃
  };

  /**
   * Spawn a resource icon that flies from a grid position toward the top-left HUD.
   * @param {number} col - Grid column of harvest
   * @param {number} row - Grid row of harvest
   * @param {string} resource - Resource id ('carrot', 'wood', etc.)
   * @param {number} [amount=1] - Amount to display
   */
  function spawnResourcePopup(col, row, resource, amount) {
    if (resourcePopups.length >= MAX_POPUPS) return;
    const screenPos = (typeof IsoEngine !== 'undefined')
      ? IsoEngine.gridToScreen(col, row)
      : { x: col * 32, y: row * 32 };

    const icon = POPUP_ICONS[resource] || '\u{1F4E6}'; // 📦 fallback
    const FLIGHT_DURATION = 45; // ticks to reach HUD

    // HUD target — in pre-zoom camera space; will be adjusted at draw time
    const zoom = (typeof IsoEngine !== 'undefined') ? IsoEngine.getZoom() : 1;
    resourcePopups.push({
      startX: screenPos.x + 16,
      startY: screenPos.y,
      targetX: 20 / zoom,  // HUD resource bar approximate position
      targetY: 42 / zoom,
      icon,
      amount: amount || 1,
      resource,
      age: 0,
      life: FLIGHT_DURATION,
      rotation: 0,
    });

    // Also spawn harvest particles at origin
    if (typeof IsoEngine !== 'undefined') {
      const color = {
        carrot: '#FF8C00', sunflower: '#FFD700', watermelon: '#2E8B57',
        tomato: '#FF4444', corn: '#F0E68C', pumpkin: '#FF7518',
        wood: '#8B6B3E', stone: '#9E9E9E',
      }[resource] || '#FFD700';
      IsoEngine.spawnHarvestParticles(col, row, color, 4);
    }
  }

  function updateResourcePopups() {
    for (let i = resourcePopups.length - 1; i >= 0; i--) {
      const p = resourcePopups[i];
      p.age++;
      p.rotation += 0.15;
      if (p.age >= p.life) {
        resourcePopups.splice(i, 1);
      }
    }
  }

  function drawResourcePopups(ctx, canvasW, canvasH) {
    if (resourcePopups.length === 0) return;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const p of resourcePopups) {
      const t = p.age / p.life;
      // Ease-in-out flight curve
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

      // Arc path (rises up then curves to HUD)
      const midY = Math.min(p.startY, p.targetY) - 40; // peak of arc
      const x = p.startX + (p.targetX - p.startX) * ease;
      const y = p.startY + (midY - p.startY) * Math.sin(ease * Math.PI);
      const finalY = midY + (p.targetY - midY) * Math.max(0, (ease - 0.5) * 2);
      const drawY = ease < 0.5 ? y : finalY;

      // Scale: start big, shrink as it approaches HUD
      const scale = 1.5 - t * 0.8;

      // Alpha: fade at the end
      const alpha = t > 0.8 ? (1 - t) / 0.2 : 1;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, drawY);
      ctx.rotate(Math.sin(p.rotation) * 0.3);
      ctx.scale(scale, scale);

      // Icon
      ctx.font = '10px serif';
      ctx.fillText(p.icon, 0, 0);

      // Amount text (small, below icon)
      if (p.amount > 1) {
        ctx.font = 'bold 6px monospace';
        ctx.fillStyle = '#FFF';
        ctx.fillText('+' + p.amount, 0, 8);
      }

      ctx.restore();
    }

    ctx.restore();
  }

  // ===== EventBus integration for resource pop-ups =====
  function setupResourceListeners() {
    if (typeof EventBus === 'undefined') return;

    EventBus.on('CROP_HARVESTED', (data) => {
      const cropId = data.crop || 'carrot';
      const plotIndex = data.plotIndex;
      // Estimate grid position from plot index
      if (typeof IsoFarm !== 'undefined' && IsoFarm.PLOT_POSITIONS) {
        const pos = IsoFarm.PLOT_POSITIONS[plotIndex];
        if (pos) {
          spawnResourcePopup(pos.col + 1, pos.row, cropId, data.amount || 1);
          return;
        }
      }
      // Fallback: spawn at center of farm
      spawnResourcePopup(7, 6, cropId, data.amount || 1);
    });

    EventBus.on('TREE_CHOPPED', (data) => {
      const col = data.col || 5;
      const row = data.row || 1;
      spawnResourcePopup(col, row, 'wood', data.amount || 2);
    });

    EventBus.on('ROCK_MINED', (data) => {
      const col = data.col || 10;
      const row = data.row || 3;
      spawnResourcePopup(col, row, 'stone', data.amount || 1);
    });
  }

  // ===== Dirt particles (sprint dust) =====
  const dirtParticles = [];
  const MAX_DIRT = 40;

  /**
   * Spawn dirt/dust particles at player's feet while sprinting.
   * @param {number} col - Grid column (fractional)
   * @param {number} row - Grid row (fractional)
   * @param {number} speed - Current player speed (affects spread)
   */
  function spawnDirtParticles(col, row, speed) {
    if (dirtParticles.length >= MAX_DIRT) return;
    const screenPos = (typeof IsoEngine !== 'undefined')
      ? IsoEngine.gridToScreen(col, row)
      : { x: col * 32, y: row * 32 };

    // Speed-based tuning: faster = wider spread, longer life
    const speedRatio = Math.min(speed / 5.5, 1);
    const count = 2 + Math.floor(speedRatio * 2);

    for (let i = 0; i < count; i++) {
      const angle = Math.PI * 0.5 + (Math.random() - 0.5) * (1.2 + speedRatio * 0.8);
      const vel = 0.5 + Math.random() * (0.8 + speedRatio * 0.6);
      dirtParticles.push({
        x: screenPos.x + 16 + (Math.random() - 0.5) * 6,
        y: screenPos.y + 8,
        vx: Math.cos(angle) * vel,
        vy: -Math.sin(angle) * vel * 0.5,
        life: 15 + Math.floor(speedRatio * 12),
        age: 0,
        size: 1.5 + Math.random() * 1.5,
        color: Math.random() > 0.5 ? '#C4A06A' : '#A08050',
      });
    }
  }

  function updateDirtParticles() {
    for (let i = dirtParticles.length - 1; i >= 0; i--) {
      const p = dirtParticles[i];
      p.age++;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.02; // gravity
      if (p.age >= p.life) {
        dirtParticles.splice(i, 1);
      }
    }
  }

  function drawDirtParticles(ctx) {
    if (dirtParticles.length === 0) return;
    ctx.save();
    for (const p of dirtParticles) {
      const alpha = 1 - p.age / p.life;
      ctx.globalAlpha = alpha * 0.7;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 - p.age / p.life * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function clear() {
    floatingTexts.length = 0;
    resourcePopups.length = 0;
    dirtParticles.length = 0;
  }

  return {
    spawnText,
    spawnHarvestReward,
    spawnMilestone,
    spawnResourcePopup,
    spawnDirtParticles,
    setupResourceListeners,
    update: () => { update(); updateResourcePopups(); updateDirtParticles(); },
    draw: (ctx, canvasW, canvasH) => {
      draw(ctx, canvasW, canvasH);
      drawResourcePopups(ctx, canvasW, canvasH);
      drawDirtParticles(ctx);
    },
    clear,
  };
})();
