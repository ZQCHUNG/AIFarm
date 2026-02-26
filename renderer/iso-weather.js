// Iso Weather — vibe-driven particle effects + seasonal cycle for the isometric view.
// Maps coding vibe moods to atmospheric particles:
//   productive → sunflower glow particles
//   debugging  → rain clouds with droplets
//   focused    → soft sparkle trail behind buddy
//   exploring  → leaf/wind particles
//   idle       → firefly particles (night mode)
// Seasonal cycle based on system date modifies sky gradient and adds particles.
const IsoWeather = (() => {
  // Particle pool (reused for performance)
  const MAX_PARTICLES = 80;
  const particles = [];

  // Helper: check if particle is seasonal (skip in mood updaters)
  function isSeasonal(p) {
    return p.type === 'petal' || p.type === 'snow' || (p.type === 'leaf' && p.seasonal);
  }

  // Rain droplets (separate pool for density)
  const MAX_RAIN = 80;
  const rainDrops = [];

  // Current mood (synced from Farm.getVibe())
  let currentMood = 'idle';
  let moodIntensity = 0; // vibeScore 0-1

  // Cloud positions (for debugging rain)
  const clouds = [];
  const MAX_CLOUDS = 3;

  // ===== Seasonal cycle =====
  // Determined by system month. Can be overridden for testing.
  const SEASONS = {
    spring: {
      skyTop: '#87CEEB', skyMid: '#C8E6C9', grassTop: '#6EBF4E', grassBot: '#4E9E38',
      particle: 'petal', particleColors: ['#FFB7C5', '#FF9EB5', '#FFC1CC', '#FFF0F5'],
      spawnRate: 0.08, groundTint: null,
    },
    summer: {
      skyTop: '#5DADE2', skyMid: '#AED6F1', grassTop: '#5AAE45', grassBot: '#3D8B2F',
      particle: null, particleColors: [],  // fireflies handled by IsoSeasons
      spawnRate: 0, groundTint: null,
    },
    autumn: {
      skyTop: '#F0C27F', skyMid: '#DEB887', grassTop: '#C8A060', grassBot: '#A0784A',
      particle: 'leaf', particleColors: ['#D35400', '#E67E22', '#F39C12', '#C0392B', '#8B4513'],
      spawnRate: 0.08, groundTint: 'rgba(180, 120, 60, 0.12)',
    },
    winter: {
      skyTop: '#B0C4DE', skyMid: '#D6E4F0', grassTop: '#A8B8A0', grassBot: '#8FA888',
      particle: 'snow', particleColors: ['#FFF', '#E8E8E8', '#F0F8FF'],
      spawnRate: 0.10, groundTint: 'rgba(220, 230, 240, 0.15)',
    },
  };

  // ===== Dynamic Weather System (Sprint 17 P1) =====
  // Weather conditions independent of coding mood.
  // Conditions: clear, cloudy, rain, fog
  // Rain: +50% crop growth, rain particles
  // Fog: reduced visibility, muted colors
  const WEATHER_CONDITIONS = ['clear', 'clear', 'clear', 'cloudy', 'cloudy', 'rain', 'rain', 'fog'];
  const WEATHER_MIN_DURATION = 3600;   // ~1 minute at 60fps
  const WEATHER_MAX_DURATION = 10800;  // ~3 minutes at 60fps

  let currentWeather = 'clear';
  let weatherTimer = 0;
  let weatherDuration = WEATHER_MIN_DURATION;
  let weatherTransition = 0;  // 0-1 blend into new weather
  let prevWeather = 'clear';
  let weatherSent = false;    // track if we notified main process

  // Rain-specific state
  const weatherRain = [];
  const MAX_WEATHER_RAIN = 120;
  let lightningFlash = 0;
  let lightningCooldown = 0;

  // Fog-specific state
  let fogDensity = 0;

  function getWeather() { return currentWeather; }
  function isRaining() { return currentWeather === 'rain'; }
  function isFoggy() { return currentWeather === 'fog'; }

  function updateWeatherSystem(tick, canvasW, canvasH) {
    weatherTimer++;

    // Weather transition blend (smooth 60-frame transition)
    if (weatherTransition < 1) {
      weatherTransition = Math.min(1, weatherTransition + 1 / 60);
    }

    // Check for weather change
    if (weatherTimer >= weatherDuration) {
      prevWeather = currentWeather;
      currentWeather = WEATHER_CONDITIONS[Math.floor(Math.random() * WEATHER_CONDITIONS.length)];
      weatherTimer = 0;
      weatherDuration = WEATHER_MIN_DURATION + Math.floor(Math.random() * (WEATHER_MAX_DURATION - WEATHER_MIN_DURATION));
      weatherTransition = 0;
      weatherSent = false;

      // Night bias: more likely fog
      const h = getHour();
      if ((h < 6 || h > 20) && Math.random() < 0.3) {
        currentWeather = 'fog';
      }
    }

    // Notify main process of weather change for crop growth bonus
    if (!weatherSent && typeof window !== 'undefined' && window.buddy && window.buddy.setWeather) {
      window.buddy.setWeather(currentWeather);
      weatherSent = true;
    }

    // Update weather-specific effects
    if (currentWeather === 'rain' || (prevWeather === 'rain' && weatherTransition < 1)) {
      updateWeatherRain(tick, canvasW, canvasH);
    }
    if (currentWeather === 'fog' || (prevWeather === 'fog' && weatherTransition < 1)) {
      const targetDensity = currentWeather === 'fog' ? 0.25 : 0;
      fogDensity += (targetDensity - fogDensity) * 0.02;
    } else {
      fogDensity *= 0.98;
    }

    // Lightning (rare during rain)
    if (currentWeather === 'rain' && lightningCooldown <= 0 && Math.random() < 0.001) {
      lightningFlash = 8;
      lightningCooldown = 300; // ~5 second cooldown
    }
    if (lightningFlash > 0) lightningFlash--;
    if (lightningCooldown > 0) lightningCooldown--;

    // Clean up rain drops
    for (let i = weatherRain.length - 1; i >= 0; i--) {
      weatherRain[i].life--;
      if (weatherRain[i].life <= 0) weatherRain.splice(i, 1);
    }
  }

  function updateWeatherRain(tick, canvasW, canvasH) {
    // Spawn rain particles
    const intensity = currentWeather === 'rain' ? weatherTransition : (1 - weatherTransition);
    const spawnCount = Math.floor(3 * intensity);
    for (let i = 0; i < spawnCount && weatherRain.length < MAX_WEATHER_RAIN; i++) {
      weatherRain.push({
        x: Math.random() * (canvasW + 40) - 20,
        y: -5 - Math.random() * 20,
        vx: -1.5 - Math.random() * 0.5, // wind angle
        vy: 6 + Math.random() * 3,
        life: 50 + Math.floor(Math.random() * 30),
        length: 4 + Math.random() * 6,
      });
    }
    // Update rain physics
    for (const drop of weatherRain) {
      drop.x += drop.vx;
      drop.y += drop.vy;
    }
  }

  function drawWeatherEffects(ctx, canvasW, canvasH, tick) {
    // Rain rendering
    if (weatherRain.length > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(170, 200, 230, 0.35)';
      ctx.lineWidth = 1;
      for (const drop of weatherRain) {
        const alpha = Math.min(1, drop.life / 15);
        ctx.globalAlpha = alpha * 0.5;
        ctx.beginPath();
        ctx.moveTo(drop.x, drop.y);
        ctx.lineTo(drop.x + drop.vx * 0.5, drop.y + drop.length);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Rain darkening overlay
    if (currentWeather === 'rain') {
      ctx.save();
      ctx.fillStyle = `rgba(20, 30, 50, ${(0.12 * weatherTransition).toFixed(3)})`;
      ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.restore();
    }

    // Lightning flash
    if (lightningFlash > 0) {
      ctx.save();
      ctx.fillStyle = `rgba(255, 255, 255, ${(lightningFlash / 8 * 0.3).toFixed(3)})`;
      ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.restore();
    }

    // Fog overlay
    if (fogDensity > 0.01) {
      ctx.save();
      // Multiple fog layers for depth
      const fogColor = `rgba(200, 210, 220, ${(fogDensity * 0.8).toFixed(3)})`;
      ctx.fillStyle = fogColor;
      ctx.fillRect(0, 0, canvasW, canvasH);

      // Drifting fog wisps
      ctx.globalAlpha = fogDensity * 0.4;
      for (let i = 0; i < 5; i++) {
        const wx = ((tick * 0.3 + i * canvasW / 5) % (canvasW + 200)) - 100;
        const wy = canvasH * (0.3 + i * 0.12);
        const ww = 80 + i * 30;
        ctx.fillStyle = 'rgba(220, 225, 235, 0.3)';
        ctx.beginPath();
        ctx.ellipse(wx, wy, ww, 15 + i * 5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Cloudy overlay (subtle darkening)
    if (currentWeather === 'cloudy') {
      ctx.save();
      ctx.fillStyle = `rgba(100, 110, 130, ${(0.06 * weatherTransition).toFixed(3)})`;
      ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.restore();
    }
  }

  /** Draw weather indicator badge (called from HUD). */
  function drawWeatherBadge(ctx, x, y) {
    const weatherEmoji = {
      clear: '\u{2600}\u{FE0F}',   // ☀️
      cloudy: '\u{2601}\u{FE0F}',  // ☁️
      rain: '\u{1F327}\u{FE0F}',   // 🌧️
      fog: '\u{1F32B}\u{FE0F}',    // 🌫️
    };
    const emoji = weatherEmoji[currentWeather] || '\u{2600}\u{FE0F}';
    ctx.fillStyle = '#FFF';
    ctx.font = '9px monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(emoji, x, y);
  }

  let currentSeason = detectSeason();

  function detectSeason() {
    const month = new Date().getMonth(); // 0-11
    if (month >= 2 && month <= 4) return 'spring';
    if (month >= 5 && month <= 7) return 'summer';
    if (month >= 8 && month <= 10) return 'autumn';
    return 'winter';
  }

  function getSeason() { return currentSeason; }
  function setSeason(s) { if (SEASONS[s]) currentSeason = s; }

  // ===== Day/Night Cycle =====
  // Uses real system time by default. timeScale > 1 for accelerated demo.
  let timeScale = 1;     // 1 = real-time, 60 = 1 min/game-hour
  let timeOffset = 0;    // ticks since init (for accelerated mode)

  function setTimeScale(s) { timeScale = s; }

  /** Returns hour as float 0-24 (e.g., 14.5 = 2:30 PM). */
  function getHour() {
    if (timeScale === 1) {
      const now = new Date();
      return now.getHours() + now.getMinutes() / 60;
    }
    // Accelerated: timeOffset ticks at 60fps
    return (timeOffset / 60 / 60 * timeScale) % 24;
  }

  /** Returns day progress 0-1 (0=midnight, 0.5=noon). */
  function getDayProgress() { return getHour() / 24; }

  /** Returns phase info: { phase, nightAlpha, lightLevel }. */
  function getDayPhase() {
    const h = getHour();
    let phase, nightAlpha, lightLevel;
    if (h >= 5 && h < 7) {
      // Dawn
      const t = (h - 5) / 2;
      phase = 'dawn';
      nightAlpha = 0.25 * (1 - t);
      lightLevel = 0.4 + t * 0.6;
    } else if (h >= 7 && h < 18) {
      // Day
      phase = 'day';
      nightAlpha = 0;
      lightLevel = 1;
    } else if (h >= 18 && h < 20) {
      // Dusk
      const t = (h - 18) / 2;
      phase = 'dusk';
      nightAlpha = t * 0.3;
      lightLevel = 1 - t * 0.6;
    } else {
      // Night
      phase = 'night';
      nightAlpha = 0.3;
      lightLevel = 0.4;
    }
    return { phase, nightAlpha, lightLevel, hour: h };
  }

  function isNight() {
    const h = getHour();
    return h < 5 || h >= 20;
  }

  function isDusk() {
    const h = getHour();
    return h >= 18 && h < 20;
  }

  /** Get sky gradient colors for the current season + time of day. */
  function getSkyGradient() {
    const s = SEASONS[currentSeason] || SEASONS.summer;
    const dp = getDayPhase();

    // Night-time sky modification
    if (dp.nightAlpha > 0) {
      return {
        skyTop: blendColor(s.skyTop, '#0A0A2E', dp.nightAlpha * 2),
        skyMid: blendColor(s.skyMid, '#1A1A3E', dp.nightAlpha * 1.5),
        grassTop: blendColor(s.grassTop, '#2A3A20', dp.nightAlpha),
        grassBot: blendColor(s.grassBot, '#1A2A10', dp.nightAlpha),
      };
    }
    // Dawn tint (warm orange)
    if (dp.phase === 'dawn') {
      const t = (dp.hour - 5) / 2;
      return {
        skyTop: blendColor('#FF8C42', s.skyTop, t),
        skyMid: blendColor('#FFB366', s.skyMid, t),
        grassTop: s.grassTop,
        grassBot: s.grassBot,
      };
    }
    let result = { skyTop: s.skyTop, skyMid: s.skyMid, grassTop: s.grassTop, grassBot: s.grassBot };
    // Weather-based sky modification
    if (currentWeather === 'rain') {
      const t = weatherTransition * 0.3;
      result.skyTop = blendColor(result.skyTop, '#4A5568', t);
      result.skyMid = blendColor(result.skyMid, '#718096', t);
    } else if (currentWeather === 'cloudy') {
      const t = weatherTransition * 0.15;
      result.skyTop = blendColor(result.skyTop, '#A0AEC0', t);
      result.skyMid = blendColor(result.skyMid, '#CBD5E0', t);
    } else if (currentWeather === 'fog') {
      const t = weatherTransition * 0.25;
      result.skyTop = blendColor(result.skyTop, '#C8D0D8', t);
      result.skyMid = blendColor(result.skyMid, '#D0D8E0', t);
    }
    return result;
  }

  /** Blend two hex colors. t=0 returns a, t=1 returns b. */
  function blendColor(a, b, t) {
    t = Math.max(0, Math.min(1, t));
    const pa = hexToRgb(a), pb = hexToRgb(b);
    const r = Math.round(pa.r + (pb.r - pa.r) * t);
    const g = Math.round(pa.g + (pb.g - pa.g) * t);
    const bl = Math.round(pa.b + (pb.b - pa.b) * t);
    return `rgb(${r},${g},${bl})`;
  }

  function hexToRgb(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    return {
      r: parseInt(hex.substring(0, 2), 16),
      g: parseInt(hex.substring(2, 4), 16),
      b: parseInt(hex.substring(4, 6), 16),
    };
  }

  /** Get optional ground tint overlay color. */
  function getGroundTint() {
    const s = SEASONS[currentSeason] || SEASONS.summer;
    return s.groundTint;
  }

  // ===== Mood sync =====

  function setMood(mood, intensity) {
    currentMood = mood || 'idle';
    moodIntensity = intensity || 0;
  }

  // ===== Update =====

  function update(tick, canvasW, canvasH) {
    timeOffset = tick; // for accelerated time mode

    // Dynamic weather system
    updateWeatherSystem(tick, canvasW, canvasH);

    switch (currentMood) {
      case 'productive': updateProductive(tick, canvasW, canvasH); break;
      case 'focused':    updateFocused(tick, canvasW, canvasH); break;
      case 'debugging':  updateDebugging(tick, canvasW, canvasH); break;
      case 'exploring':  updateExploring(tick, canvasW, canvasH); break;
      default:           updateIdle(tick, canvasW, canvasH); break;
    }

    // Seasonal particles (on top of mood particles)
    updateSeasonalParticles(tick, canvasW, canvasH);

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

  // ===== Seasonal particle spawning =====

  function updateSeasonalParticles(tick, canvasW, canvasH) {
    const season = SEASONS[currentSeason];
    if (!season || !season.particle || season.spawnRate <= 0) return;
    if (particles.length >= MAX_PARTICLES) return;

    if (Math.random() < season.spawnRate) {
      const color = season.particleColors[Math.floor(Math.random() * season.particleColors.length)];

      if (season.particle === 'petal') {
        // Cherry blossom petals — drift diagonally
        particles.push({
          x: Math.random() * canvasW,
          y: -5,
          vx: 0.3 + Math.random() * 0.5,
          vy: 0.5 + Math.random() * 0.8,
          size: 3 + Math.random() * 3,
          color,
          alpha: 0.7 + Math.random() * 0.3,
          life: 180 + Math.floor(Math.random() * 80),
          type: 'petal',
          rot: Math.random() * Math.PI * 2,
          rotSpeed: (Math.random() - 0.5) * 0.08,
          swayPhase: Math.random() * Math.PI * 2,
        });
      } else if (season.particle === 'leaf') {
        // Autumn leaves — wind-blown
        particles.push({
          x: -10 + Math.random() * (canvasW + 20),
          y: -5,
          vx: 0.5 + Math.random() * 1.0,
          vy: 0.4 + Math.random() * 0.6,
          size: 3 + Math.random() * 4,
          color,
          alpha: 0.7 + Math.random() * 0.3,
          life: 140 + Math.floor(Math.random() * 60),
          type: 'leaf',
          seasonal: true,
          rot: Math.random() * Math.PI * 2,
          rotSpeed: (Math.random() - 0.5) * 0.12,
        });
      } else if (season.particle === 'snow') {
        // Snowflakes — gentle drift
        particles.push({
          x: Math.random() * canvasW,
          y: -3,
          vx: (Math.random() - 0.5) * 0.4,
          vy: 0.3 + Math.random() * 0.5,
          size: 2 + Math.random() * 3,
          color,
          alpha: 0.7 + Math.random() * 0.3,
          life: 200 + Math.floor(Math.random() * 80),
          type: 'snow',
          swayPhase: Math.random() * Math.PI * 2,
        });
      }
    }

    // Update seasonal particle physics
    for (const p of particles) {
      if (p.type === 'petal') {
        p.x += p.vx + Math.sin(p.life * 0.04 + p.swayPhase) * 0.4;
        p.y += p.vy;
        p.rot += p.rotSpeed;
      } else if (p.type === 'snow') {
        p.x += p.vx + Math.sin(p.life * 0.03 + p.swayPhase) * 0.3;
        p.y += p.vy;
      }
      // leaf physics already handled by updateExploring
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
    // Update positions (skip seasonal particles)
    for (const p of particles) {
      if (isSeasonal(p)) continue;
      p.x += p.vx;
      p.y += p.vy;
      p.alpha *= 0.99;
      p.vx += (Math.random() - 0.5) * 0.05;
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
      if (isSeasonal(p)) continue;
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
      if (isSeasonal(p)) continue;
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
      if (isSeasonal(p)) continue;
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
      } else if (p.type === 'petal') {
        // Cherry blossom petal — rotated oval
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot || 0);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size, p.size * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        // Center dot (pistil)
        ctx.fillStyle = '#FFE0E8';
        ctx.fillRect(-0.5, -0.5, 1, 1);
      } else if (p.type === 'snow') {
        // Snowflake — simple circle with soft glow
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        // Soft glow
        ctx.globalAlpha = p.alpha * 0.2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2);
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

  /** Draw a seasonal ground tint overlay. Call AFTER tile map but BEFORE particles. */
  function drawGroundTint(ctx, canvasW, canvasH) {
    const tint = getGroundTint();
    if (!tint) return;
    ctx.save();
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.restore();
  }

  /** Draw night overlay (dark blue tint over the scene). Call AFTER ground tint. */
  function drawNightOverlay(ctx, canvasW, canvasH, tick) {
    const dp = getDayPhase();
    if (dp.nightAlpha <= 0) return;

    // Dark overlay
    ctx.save();
    ctx.fillStyle = `rgba(10, 10, 40, ${(dp.nightAlpha * 0.6).toFixed(3)})`;
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Stars (only during deep night, phase === 'night')
    if (dp.phase === 'night') {
      ctx.fillStyle = '#FFF';
      const starSeed = 42;
      for (let i = 0; i < 25; i++) {
        const sx = ((starSeed * (i + 1) * 7.3) % canvasW);
        const sy = ((starSeed * (i + 1) * 3.7) % (canvasH * 0.35));
        const twinkle = Math.sin(tick * 0.05 + i * 2.3) * 0.3 + 0.5;
        ctx.globalAlpha = twinkle;
        const size = i % 5 === 0 ? 2 : 1;
        ctx.fillRect(sx, sy, size, size);
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  return {
    setMood,
    update,
    draw,
    drawGroundTint,
    drawNightOverlay,
    drawWeatherEffects,
    drawWeatherBadge,
    getSeason,
    setSeason,
    getSkyGradient,
    getGroundTint,
    getWeather,
    isRaining,
    isFoggy,
    setTimeScale,
    getHour,
    getDayPhase,
    getDayProgress,
    isNight,
    isDusk,
  };
})();
