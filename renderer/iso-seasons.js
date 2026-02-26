/**
 * iso-seasons.js — Four Seasons System for AIFarm 3.0 (Sprint 21 P0).
 *
 * Enhances the existing IsoWeather seasonal system with:
 *   1. Summer firefly particles (night-only glowing bugs)
 *   2. Seasonal tree color palettes (spring blossoms, autumn orange, winter bare)
 *   3. Snow overlay on buildings/tiles in winter
 *   4. Crop season restrictions (some crops grow slower out of season)
 *   5. Season transition effects (smooth palette blending)
 *
 * Reads IsoWeather.getSeason() and provides visual modifiers that
 * iso-engine.js and iso-farm.js consume.
 */

const IsoSeasons = (() => {
  // ===== Seasonal tree color palettes =====
  // Each season defines 3 canopy layers: dark, mid, light
  const TREE_PALETTES = {
    spring: {
      trunk: '#8B6B3E',
      canopy: ['#4EA84E', '#6ECC6E', '#8EE08E'],   // fresh green
      accent: '#FFB7C5',  // pink blossom spots
      accentChance: 0.3,
    },
    summer: {
      trunk: '#8B6B3E',
      canopy: ['#3A8A2A', '#4EAA3A', '#5CBC48'],   // deep green (original)
      accent: null,
      accentChance: 0,
    },
    autumn: {
      trunk: '#7A5C30',
      canopy: ['#C85A17', '#E07020', '#F0A030'],   // orange/gold
      accent: '#D35400',  // red leaf spots
      accentChance: 0.25,
    },
    winter: {
      trunk: '#6E5530',
      canopy: ['#6A7A6A', '#8A9A8A', '#A0B0A0'],   // muted gray-green (sparse)
      accent: '#E8E8F0',  // snow on branches
      accentChance: 0.4,
    },
  };

  // ===== Crop season affinity =====
  // Each crop has a preferred season(s). Out-of-season crops grow at reduced rate.
  const CROP_SEASONS = {
    carrot:     { best: ['spring', 'autumn'], penalty: 0.5 },
    sunflower:  { best: ['summer'],           penalty: 0.4 },
    watermelon: { best: ['summer'],           penalty: 0.3 },
    tomato:     { best: ['summer', 'autumn'], penalty: 0.5 },
    corn:       { best: ['summer', 'autumn'], penalty: 0.5 },
    pumpkin:    { best: ['autumn'],           penalty: 0.4 },
    strawberry: { best: ['spring', 'summer'], penalty: 0.5 },
    wheat:      { best: ['autumn', 'spring'], penalty: 0.6 },
  };

  // ===== Summer firefly config =====
  const FIREFLY_MAX = 25;
  const FIREFLY_SPAWN_RATE = 0.04;  // per tick, night only
  const fireflyParticles = [];

  // ===== Winter snow overlay config =====
  const SNOW_ACCUMULATION_RATE = 0.001;  // per tick
  const SNOW_MELT_RATE = 0.003;
  let snowCoverage = 0;  // 0-1 how much snow is on the ground

  // ===== Season transition =====
  let prevSeason = null;
  let transitionProgress = 1;  // 0 = just switched, 1 = fully blended
  const TRANSITION_SPEED = 0.005;  // ~200 ticks (~3.3 seconds) for full transition
  let seasonSent = false;  // track if we notified main process

  // ===== Update =====

  function update(tick, canvasW, canvasH) {
    if (typeof IsoWeather === 'undefined') return;

    const season = IsoWeather.getSeason();

    // Detect season change → trigger transition
    if (prevSeason !== null && prevSeason !== season) {
      transitionProgress = 0;
      seasonSent = false;
      // Log season change
      if (typeof Farm !== 'undefined' && Farm.logEvent) {
        const emoji = { spring: '\u{1F338}', summer: '\u{2600}\u{FE0F}', autumn: '\u{1F342}', winter: '\u{2744}\u{FE0F}' };
        const name = { spring: 'Spring', summer: 'Summer', autumn: 'Autumn', winter: 'Winter' };
        Farm.logEvent(emoji[season] || '\u{1F33F}', `${name[season]} has arrived!`);
      }

      // Emit season change event
      if (typeof EventBus !== 'undefined') {
        EventBus.emit('SEASON_CHANGED', { from: prevSeason, to: season });
      }
    }
    prevSeason = season;

    // Notify main process of current season for crop growth multiplier
    if (!seasonSent && typeof window !== 'undefined' && window.buddy && window.buddy.setSeason) {
      window.buddy.setSeason(season);
      seasonSent = true;
    }

    // Advance transition
    if (transitionProgress < 1) {
      transitionProgress = Math.min(1, transitionProgress + TRANSITION_SPEED);
    }

    // Summer fireflies (night only)
    if (season === 'summer') {
      updateFireflies(tick, canvasW, canvasH);
    } else {
      // Fade out remaining fireflies
      for (let i = fireflyParticles.length - 1; i >= 0; i--) {
        fireflyParticles[i].life -= 2;
        if (fireflyParticles[i].life <= 0) fireflyParticles.splice(i, 1);
      }
    }

    // Winter snow accumulation
    if (season === 'winter') {
      snowCoverage = Math.min(1, snowCoverage + SNOW_ACCUMULATION_RATE);
    } else {
      snowCoverage = Math.max(0, snowCoverage - SNOW_MELT_RATE);
    }
  }

  // ===== Fireflies (summer nights) =====

  function updateFireflies(tick, canvasW, canvasH) {
    const isNight = typeof IsoWeather !== 'undefined' && IsoWeather.isNight();
    const isDusk = typeof IsoWeather !== 'undefined' && IsoWeather.isDusk();

    // Spawn during dusk and night
    if ((isNight || isDusk) && fireflyParticles.length < FIREFLY_MAX) {
      if (Math.random() < FIREFLY_SPAWN_RATE) {
        fireflyParticles.push({
          x: Math.random() * canvasW,
          y: canvasH * 0.2 + Math.random() * canvasH * 0.6,
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.2,
          size: 1.5 + Math.random() * 1.5,
          life: 200 + Math.floor(Math.random() * 150),
          maxLife: 0,
          phase: Math.random() * Math.PI * 2,
          glowRadius: 4 + Math.random() * 4,
          color: Math.random() > 0.3 ? '#CCFF66' : '#FFEE88',
        });
        const ff = fireflyParticles[fireflyParticles.length - 1];
        ff.maxLife = ff.life;
      }
    }

    // Update physics
    for (const ff of fireflyParticles) {
      // Lazy wandering motion
      ff.vx += (Math.random() - 0.5) * 0.02;
      ff.vy += (Math.random() - 0.5) * 0.015;
      ff.vx = Math.max(-0.5, Math.min(0.5, ff.vx));
      ff.vy = Math.max(-0.3, Math.min(0.3, ff.vy));
      ff.x += ff.vx + Math.sin(ff.life * 0.03 + ff.phase) * 0.3;
      ff.y += ff.vy + Math.cos(ff.life * 0.04 + ff.phase) * 0.2;
      ff.life--;
    }

    // Remove dead
    for (let i = fireflyParticles.length - 1; i >= 0; i--) {
      if (fireflyParticles[i].life <= 0) fireflyParticles.splice(i, 1);
    }
  }

  // ===== Drawing =====

  /** Draw fireflies (call after weather overlay, before HUD). */
  function drawFireflies(ctx, canvasW, canvasH, tick) {
    if (fireflyParticles.length === 0) return;

    ctx.save();
    for (const ff of fireflyParticles) {
      // Pulsating glow
      const pulse = Math.sin(tick * 0.08 + ff.phase) * 0.4 + 0.6;
      const fadeIn = Math.min(1, (ff.maxLife - ff.life) / 30);
      const fadeOut = Math.min(1, ff.life / 40);
      const alpha = pulse * fadeIn * fadeOut;

      // Outer glow
      ctx.globalAlpha = alpha * 0.2;
      const grad = ctx.createRadialGradient(ff.x, ff.y, 0, ff.x, ff.y, ff.glowRadius);
      grad.addColorStop(0, ff.color);
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(ff.x, ff.y, ff.glowRadius, 0, Math.PI * 2);
      ctx.fill();

      // Core dot
      ctx.globalAlpha = alpha * 0.9;
      ctx.fillStyle = ff.color;
      ctx.beginPath();
      ctx.arc(ff.x, ff.y, ff.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Draw snow overlay on the ground (winter). */
  function drawSnowOverlay(ctx, canvasW, canvasH, tick) {
    if (snowCoverage < 0.01) return;

    ctx.save();
    // General snow tint on the ground
    ctx.fillStyle = `rgba(240, 245, 255, ${(snowCoverage * 0.15).toFixed(3)})`;
    ctx.fillRect(0, canvasH * 0.4, canvasW, canvasH * 0.6);

    // Snow patches (subtle white blobs scattered)
    ctx.globalAlpha = snowCoverage * 0.3;
    ctx.fillStyle = '#F0F5FF';
    const patchSeed = 73;
    const patchCount = Math.floor(12 * snowCoverage);
    for (let i = 0; i < patchCount; i++) {
      const px = ((patchSeed * (i + 1) * 13.7) % canvasW);
      const py = canvasH * 0.45 + ((patchSeed * (i + 1) * 7.3) % (canvasH * 0.5));
      const pw = 15 + (i * 7) % 25;
      const ph = 6 + (i * 3) % 10;
      ctx.beginPath();
      ctx.ellipse(px, py, pw, ph, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ===== Tree palette helper =====

  /**
   * Get tree canopy colors for the current season.
   * Returns { trunk, canopy: [dark, mid, light], accent, accentChance }.
   * Can be used by drawIsoTree to vary colors seasonally.
   */
  function getTreePalette() {
    if (typeof IsoWeather === 'undefined') return TREE_PALETTES.summer;
    const season = IsoWeather.getSeason();
    return TREE_PALETTES[season] || TREE_PALETTES.summer;
  }

  // ===== Crop season check =====

  /**
   * Get the growth multiplier for a crop in the current season.
   * Returns 1.0 for in-season, penalty value for out-of-season.
   * Can be 1.2 for "best season" bonus.
   */
  function getCropGrowthMultiplier(cropId) {
    if (typeof IsoWeather === 'undefined') return 1.0;
    const season = IsoWeather.getSeason();
    const info = CROP_SEASONS[cropId];
    if (!info) return 1.0;

    if (info.best.includes(season)) {
      return 1.2;  // 20% bonus in best season
    }
    // Winter is harshest for all crops
    if (season === 'winter') {
      return info.penalty * 0.7;
    }
    return info.penalty;
  }

  /**
   * Check if a crop is in its best season.
   */
  function isCropInSeason(cropId) {
    if (typeof IsoWeather === 'undefined') return true;
    const season = IsoWeather.getSeason();
    const info = CROP_SEASONS[cropId];
    if (!info) return true;
    return info.best.includes(season);
  }

  /**
   * Get a short season label for HUD display.
   */
  function getSeasonLabel() {
    if (typeof IsoWeather === 'undefined') return 'Summer';
    const season = IsoWeather.getSeason();
    return { spring: 'Spring', summer: 'Summer', autumn: 'Autumn', winter: 'Winter' }[season] || 'Summer';
  }

  /**
   * Get season emoji for HUD.
   */
  function getSeasonEmoji() {
    if (typeof IsoWeather === 'undefined') return '\u{2600}\u{FE0F}';
    const season = IsoWeather.getSeason();
    return {
      spring: '\u{1F338}',
      summer: '\u{2600}\u{FE0F}',
      autumn: '\u{1F342}',
      winter: '\u{2744}\u{FE0F}',
    }[season] || '\u{2600}\u{FE0F}';
  }

  /**
   * Get current snow coverage (0-1) for building rendering.
   */
  function getSnowCoverage() { return snowCoverage; }

  /**
   * Get transition progress (0-1) for smooth blending.
   */
  function getTransitionProgress() { return transitionProgress; }

  /**
   * Get crop season info for shop/tooltip display.
   */
  function getCropSeasonInfo(cropId) {
    const info = CROP_SEASONS[cropId];
    if (!info) return { seasons: ['all'], inSeason: true, multiplier: 1.0 };
    return {
      seasons: info.best,
      inSeason: isCropInSeason(cropId),
      multiplier: getCropGrowthMultiplier(cropId),
    };
  }

  return {
    update,
    drawFireflies,
    drawSnowOverlay,
    getTreePalette,
    getCropGrowthMultiplier,
    isCropInSeason,
    getSeasonLabel,
    getSeasonEmoji,
    getSnowCoverage,
    getTransitionProgress,
    getCropSeasonInfo,
    TREE_PALETTES,
    CROP_SEASONS,
  };
})();

if (typeof module !== 'undefined') module.exports = IsoSeasons;
