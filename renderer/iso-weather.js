// Iso Weather — vibe-driven particle effects for the isometric view.
// Maps coding vibe moods to atmospheric particles:
//   productive → sunflower glow particles
//   debugging  → rain clouds with droplets
//   focused    → soft sparkle trail behind buddy
//   exploring  → leaf/wind particles
//   idle       → firefly particles (night mode)
const IsoWeather = (() => {
  // Particle pool (reused for performance)
  const MAX_PARTICLES = 60;
  const particles = [];

  // Rain droplets (separate pool for density)
  const MAX_RAIN = 80;
  const rainDrops = [];

  // Current mood (synced from Farm.getVibe())
  let currentMood = 'idle';
  let moodIntensity = 0; // vibeScore 0-1

  // Cloud positions (for debugging rain)
  const clouds = [];
  const MAX_CLOUDS = 3;

  // ===== Mood sync =====

  function setMood(mood, intensity) {
    currentMood = mood || 'idle';
    moodIntensity = intensity || 0;
  }

  // ===== Update =====

  function update(tick, canvasW, canvasH) {
    switch (currentMood) {
      case 'productive': updateProductive(tick, canvasW, canvasH); break;
      case 'focused':    updateFocused(tick, canvasW, canvasH); break;
      case 'debugging':  updateDebugging(tick, canvasW, canvasH); break;
      case 'exploring':  updateExploring(tick, canvasW, canvasH); break;
      default:           updateIdle(tick, canvasW, canvasH); break;
    }

    // Age and remove dead particles
    for (let i = particles.length - 1; i >= 0; i--) {
      particles[i].life--;
      if (particles[i].life <= 0) particles.splice(i, 1);
    }
    for (let i = rainDrops.length - 1; i >= 0; i--) {
      rainDrops[i].life--;
      if (rainDrops[i].life <= 0) rainDrops.splice(i, 1);
    }
  }

  // ===== Productive: golden glow particles rising from crops =====

  function updateProductive(tick, canvasW, canvasH) {
    if (particles.length < MAX_PARTICLES && Math.random() < 0.08 * moodIntensity) {
      particles.push({
        x: Math.random() * canvasW,
        y: canvasH * 0.4 + Math.random() * canvasH * 0.4,
        vx: (Math.random() - 0.5) * 0.3,
        vy: -0.5 - Math.random() * 0.5,
        size: 2 + Math.random() * 3,
        color: Math.random() > 0.5 ? '#FFD700' : '#FFA500',
        alpha: 0.6 + Math.random() * 0.4,
        life: 60 + Math.floor(Math.random() * 40),
        type: 'glow',
      });
    }
    // Update positions
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.alpha *= 0.99;
      p.vx += (Math.random() - 0.5) * 0.05; // slight drift
    }
  }

  // ===== Focused: sparkle trail =====

  function updateFocused(tick, canvasW, canvasH) {
    if (particles.length < MAX_PARTICLES && Math.random() < 0.05 * moodIntensity) {
      particles.push({
        x: canvasW * 0.3 + Math.random() * canvasW * 0.4,
        y: canvasH * 0.3 + Math.random() * canvasH * 0.3,
        vx: 0,
        vy: 0,
        size: 1 + Math.random() * 2,
        color: '#B9F2FF',
        alpha: 0.8,
        life: 20 + Math.floor(Math.random() * 20),
        type: 'sparkle',
      });
    }
    for (const p of particles) {
      p.alpha *= 0.95;
    }
  }

  // ===== Debugging: rain clouds + droplets =====

  function updateDebugging(tick, canvasW, canvasH) {
    // Manage clouds
    while (clouds.length < MAX_CLOUDS) {
      clouds.push({
        x: Math.random() * canvasW,
        y: canvasH * 0.1 + Math.random() * canvasH * 0.15,
        width: 40 + Math.random() * 30,
        speed: 0.2 + Math.random() * 0.3,
      });
    }
    for (const cloud of clouds) {
      cloud.x += cloud.speed;
      if (cloud.x > canvasW + cloud.width) cloud.x = -cloud.width;
    }

    // Spawn rain droplets from clouds
    if (rainDrops.length < MAX_RAIN && Math.random() < 0.15 * moodIntensity) {
      const cloud = clouds[Math.floor(Math.random() * clouds.length)];
      rainDrops.push({
        x: cloud.x + Math.random() * cloud.width - cloud.width / 2,
        y: cloud.y + 10,
        vy: 2 + Math.random() * 2,
        life: 40 + Math.floor(Math.random() * 20),
      });
    }
    for (const drop of rainDrops) {
      drop.y += drop.vy;
      drop.x -= 0.3; // slight wind
    }
  }

  // ===== Exploring: leaf/wind particles =====

  function updateExploring(tick, canvasW, canvasH) {
    if (particles.length < MAX_PARTICLES && Math.random() < 0.06 * moodIntensity) {
      const colors = ['#5AAE45', '#8BC34A', '#F0E68C', '#FF8C00'];
      particles.push({
        x: -10,
        y: canvasH * 0.2 + Math.random() * canvasH * 0.5,
        vx: 1 + Math.random() * 1.5,
        vy: Math.sin(tick * 0.1) * 0.5,
        size: 2 + Math.random() * 2,
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: 0.7,
        life: 80 + Math.floor(Math.random() * 40),
        type: 'leaf',
        rot: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.1,
      });
    }
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy + Math.sin(p.life * 0.1) * 0.3;
      if (p.rot !== undefined) p.rot += p.rotSpeed;
    }
  }

  // ===== Idle: firefly particles =====

  function updateIdle(tick, canvasW, canvasH) {
    if (particles.length < 20 && Math.random() < 0.02) {
      particles.push({
        x: Math.random() * canvasW,
        y: canvasH * 0.3 + Math.random() * canvasH * 0.5,
        vx: (Math.random() - 0.5) * 0.2,
        vy: (Math.random() - 0.5) * 0.2,
        size: 2,
        color: '#FFFF80',
        alpha: 0,
        life: 100 + Math.floor(Math.random() * 60),
        type: 'firefly',
        phase: Math.random() * Math.PI * 2,
      });
    }
    for (const p of particles) {
      p.x += p.vx + Math.sin(p.life * 0.05 + p.phase) * 0.2;
      p.y += p.vy + Math.cos(p.life * 0.07) * 0.1;
      // Pulse alpha
      p.alpha = 0.3 + Math.sin(p.life * 0.08 + (p.phase || 0)) * 0.3;
    }
  }

  // ===== Draw =====

  function draw(ctx, canvasW, canvasH, tick) {
    // Draw clouds (debugging mode)
    if (currentMood === 'debugging') {
      for (const cloud of clouds) {
        drawCloud(ctx, cloud.x, cloud.y, cloud.width);
      }
      // Draw rain
      ctx.save();
      ctx.strokeStyle = 'rgba(150, 180, 220, 0.4)';
      ctx.lineWidth = 1;
      for (const drop of rainDrops) {
        ctx.beginPath();
        ctx.moveTo(drop.x, drop.y);
        ctx.lineTo(drop.x - 1, drop.y + 4);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Draw particles
    for (const p of particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);

      if (p.type === 'glow') {
        // Radial glow
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        grad.addColorStop(0, p.color);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2);
        ctx.fill();
        // Core
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 0.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'sparkle') {
        // Cross sparkle
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - 1, p.y - p.size, 2, p.size * 2);
        ctx.fillRect(p.x - p.size, p.y - 1, p.size * 2, 2);
      } else if (p.type === 'leaf') {
        // Rotated ellipse
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot || 0);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size, p.size * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'firefly') {
        // Glowing dot
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        // Glow halo
        ctx.globalAlpha = p.alpha * 0.3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  function drawCloud(ctx, x, y, width) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#6B7B8F';
    // Cloud shape (overlapping circles)
    const r = width * 0.3;
    ctx.beginPath();
    ctx.arc(x - r * 0.5, y, r * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y - r * 0.3, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + r * 0.6, y, r * 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  return {
    setMood,
    update,
    draw,
  };
})();
