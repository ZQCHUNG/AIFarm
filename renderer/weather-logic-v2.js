/**
 * weather-logic-v2.js — Weather Impact & Hazards v2 (Sprint 29 P1).
 *
 * Makes weather a gameplay factor:
 *   - Lightning: random strikes during rain, turns trees to charcoal resource
 *   - Crop growth modifiers: rain +25% (auto-irrigate), drought -100% (summer random)
 *   - Cozy buff: resting indoors during rain restores a "cozy" bonus
 *
 * Integrates with IsoWeather (weather state), IsoFarm (crop growth),
 * SceneManager (indoor detection), IsoEffects (particles).
 */
const WeatherLogicV2 = (() => {
  // Lightning config
  const LIGHTNING_CHECK_INTERVAL = 300; // check every 5 seconds
  const LIGHTNING_CHANCE = 0.15; // 15% chance per check during rain
  const LIGHTNING_FLASH_DURATION = 8;
  let lightningTimer = 0;
  let flashTimer = 0;
  let flashAlpha = 0;
  let lastStrikeCol = 0;
  let lastStrikeRow = 0;

  // Drought config
  const DROUGHT_CHECK_INTERVAL = 18000; // 5 minutes
  const DROUGHT_CHANCE = 0.2; // 20% chance in summer
  const DROUGHT_DURATION = 10800; // 3 minutes
  let droughtActive = false;
  let droughtTimer = 0;
  let droughtCheckTimer = 0;

  // Cozy buff
  const COZY_TICK_INTERVAL = 300; // grant buff every 5 seconds indoors during rain
  let cozyTimer = 0;
  let cozyActive = false;

  // Growth modifier (queried by other systems)
  let growthMultiplier = 1.0;

  // ===== Update =====

  function update(tick) {
    if (typeof IsoWeather === 'undefined') return;

    const weather = IsoWeather.getWeather();
    const isRain = IsoWeather.isRaining();
    const season = IsoWeather.getSeason();

    // Calculate growth multiplier
    updateGrowthModifier(isRain);

    // Lightning during rain
    if (isRain) {
      updateLightning(tick);
    }

    // Drought in summer
    if (season === 'summer' && !isRain) {
      updateDrought(tick);
    } else if (droughtActive && isRain) {
      // Rain ends drought
      endDrought();
    }

    // Lightning flash decay
    if (flashTimer > 0) {
      flashTimer--;
      flashAlpha = flashTimer / LIGHTNING_FLASH_DURATION;
    }

    // Cozy buff (indoors during rain)
    updateCozy(tick, isRain);
  }

  function updateGrowthModifier(isRain) {
    if (droughtActive) {
      growthMultiplier = 0; // crops stop growing
    } else if (isRain) {
      growthMultiplier = 1.25; // +25% growth
    } else {
      growthMultiplier = 1.0;
    }
  }

  // ===== Lightning =====

  function updateLightning(tick) {
    lightningTimer++;
    if (lightningTimer < LIGHTNING_CHECK_INTERVAL) return;
    lightningTimer = 0;

    if (Math.random() > LIGHTNING_CHANCE) return;

    // Strike location: random within player viewport area
    const pp = (typeof Player !== 'undefined') ? Player.getPosition() : { x: 10, y: 10 };
    const ox = (Math.random() - 0.5) * 16;
    const oy = (Math.random() - 0.5) * 10;
    const col = Math.floor(pp.x + ox);
    const row = Math.floor(pp.y + oy);

    lastStrikeCol = col;
    lastStrikeRow = row;

    // Flash effect
    flashTimer = LIGHTNING_FLASH_DURATION;
    flashAlpha = 1;

    // Sound
    if (typeof AudioManager !== 'undefined') AudioManager.playLevelUp();

    // Check if tree tile → convert to charcoal
    if (typeof IsoEngine !== 'undefined') {
      const tile = IsoEngine.getTile(col, row);
      if (tile === 'tree' || tile === 'pine') {
        // Convert tree to empty + drop charcoal resource
        IsoEngine.setTile(col, row, 'grass');
        if (typeof ResourceInventory !== 'undefined') {
          ResourceInventory.add('wood', 5);
        }
        if (typeof IsoEffects !== 'undefined') {
          // Fire/spark particles
          for (let i = 0; i < 8; i++) {
            IsoEffects.spawnText(
              col + (Math.random() - 0.5),
              row + (Math.random() - 0.5),
              '\u{1F525}',
              { color: '#FF6600', life: 30 + Math.random() * 30, rise: 0.4 + Math.random() * 0.3 }
            );
          }
          IsoEffects.spawnText(col, row - 1, '+5 wood (charcoal)', { color: '#FFB74D', life: 90, rise: 0.3 });
        }
        if (typeof Farm !== 'undefined' && Farm.logEvent) {
          Farm.logEvent('\u{26A1}', 'Lightning struck a tree!');
        }
      } else {
        // Visual-only strike (ground scorch)
        if (typeof IsoEffects !== 'undefined') {
          for (let i = 0; i < 5; i++) {
            IsoEffects.spawnText(
              col + (Math.random() - 0.5) * 0.5,
              row + (Math.random() - 0.5) * 0.5,
              '\u{26A1}',
              { color: '#FFF', life: 15 + Math.random() * 15, rise: 0.6 }
            );
          }
        }
      }
    }
  }

  // ===== Drought =====

  function updateDrought(tick) {
    if (droughtActive) {
      droughtTimer--;
      if (droughtTimer <= 0) endDrought();
      return;
    }

    droughtCheckTimer++;
    if (droughtCheckTimer < DROUGHT_CHECK_INTERVAL) return;
    droughtCheckTimer = 0;

    if (Math.random() > DROUGHT_CHANCE) return;

    // Start drought
    droughtActive = true;
    droughtTimer = DROUGHT_DURATION;

    if (typeof IsoEffects !== 'undefined') {
      const pp = (typeof Player !== 'undefined') ? Player.getPosition() : { x: 10, y: 10 };
      IsoEffects.spawnText(pp.x, pp.y - 2, '\u{2600}\u{FE0F} Drought! Crops paused!',
        { color: '#FF8C00', life: 120, rise: 0.2 });
    }
    if (typeof Farm !== 'undefined' && Farm.logEvent) {
      Farm.logEvent('\u{2600}\u{FE0F}', 'A summer drought has begun!');
    }
  }

  function endDrought() {
    if (!droughtActive) return;
    droughtActive = false;
    droughtTimer = 0;

    if (typeof IsoEffects !== 'undefined') {
      const pp = (typeof Player !== 'undefined') ? Player.getPosition() : { x: 10, y: 10 };
      IsoEffects.spawnText(pp.x, pp.y - 2, '\u{1F4A7} Drought ended!',
        { color: '#4FC3F7', life: 90, rise: 0.3 });
    }
  }

  // ===== Cozy Buff =====

  function updateCozy(tick, isRain) {
    const isIndoors = (typeof SceneManager !== 'undefined') && !SceneManager.isOverworld();

    if (isRain && isIndoors) {
      cozyTimer++;
      if (cozyTimer >= COZY_TICK_INTERVAL) {
        cozyTimer = 0;
        cozyActive = true;
        // Grant a small gold bonus as "cozy" reward
        if (typeof ResourceInventory !== 'undefined') {
          ResourceInventory.add('gold', 2);
        }
        if (typeof IsoEffects !== 'undefined') {
          const pp = (typeof Player !== 'undefined') ? Player.getPosition() : { x: 5, y: 5 };
          IsoEffects.spawnText(pp.x, pp.y - 1, '\u{2615} Cozy +2g',
            { color: '#FFCC80', life: 60, rise: 0.2 });
        }
      }
    } else {
      cozyTimer = 0;
      cozyActive = false;
    }
  }

  // ===== Draw =====

  function draw(ctx, canvasW, canvasH, tick) {
    // Lightning flash overlay
    if (flashTimer > 0) {
      ctx.save();
      ctx.globalAlpha = flashAlpha * 0.4;
      ctx.fillStyle = '#FFF';
      ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.restore();
    }

    // Drought indicator (orange tint)
    if (droughtActive) {
      ctx.save();
      ctx.globalAlpha = 0.06 + Math.sin(tick * 0.02) * 0.02;
      ctx.fillStyle = '#FF6600';
      ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.restore();

      // Drought timer HUD
      const remaining = droughtTimer / DROUGHT_DURATION;
      drawDroughtHUD(ctx, canvasW, canvasH, remaining, tick);
    }

    // Cozy indicator
    if (cozyActive) {
      ctx.save();
      ctx.globalAlpha = 0.04;
      ctx.fillStyle = '#FFD700';
      ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.restore();
    }
  }

  function drawDroughtHUD(ctx, canvasW, canvasH, remaining, tick) {
    ctx.save();
    ctx.font = '7px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';

    const x = canvasW - 10;
    const y = 30;

    // Drought label with pulsing sun
    const pulse = Math.sin(tick * 0.08) > 0;
    ctx.fillStyle = pulse ? '#FF8C00' : '#FFA726';
    ctx.fillText('\u{2600}\u{FE0F} DROUGHT', x, y);

    // Timer bar
    const barW = 40;
    const barH = 3;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x - barW, y + 10, barW, barH);
    ctx.fillStyle = '#FF8C00';
    ctx.fillRect(x - barW, y + 10, barW * remaining, barH);

    ctx.restore();
  }

  // ===== Public API =====

  function getGrowthMultiplier() { return growthMultiplier; }
  function isDrought() { return droughtActive; }
  function isCozy() { return cozyActive; }

  /** Add isStormy to IsoWeather if not present (heavy rain = stormy). */
  function isStormy() {
    if (typeof IsoWeather === 'undefined') return false;
    return IsoWeather.isRaining() && Math.random() < 0.01; // rare storm flashes
  }

  return {
    update,
    draw,
    getGrowthMultiplier,
    isDrought,
    isCozy,
    isStormy,
  };
})();
