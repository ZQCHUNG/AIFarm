/**
 * oracle-effects.js — Visual effects for external webhook (oracle) events.
 *
 * Listens for oracle_event messages from NetworkClient and triggers
 * world-wide visual effects:
 *   - gold_rain: Golden particle shower + flash
 *   - data_crystal: Spawn glowing crystal entity near monument
 *   - announcement: Scrolling banner text at top of screen
 *
 * Integrates with IsoWeather, IsoEffects, IsoEngine.
 */
const OracleEffects = (() => {
  // Active effects
  let goldRainTimer = 0;
  let goldRainIntensity = 0;
  let crystalSpawned = false;
  let announcement = null; // { text, timer, color }

  // Data crystals collected
  let dataCrystals = 0;

  // ===== Event handler =====

  function onOracleEvent(event) {
    console.log(`[Oracle] Event: ${event.event} from ${event.source}`);

    switch (event.event) {
      case 'gold_rain':
        triggerGoldRain(event.message);
        break;
      case 'data_crystal':
        spawnDataCrystal(event.data);
        break;
      case 'announcement':
        showAnnouncement(event.message, event.data);
        break;
      case 'bull_market':
        // Forward to MarketEconomy (handled via EventBus)
        showAnnouncement(event.message || 'Bull Market! All prices +50%!', { color: '#00E676' });
        break;
      default:
        // Generic event — show announcement
        showAnnouncement(event.message || `Event: ${event.event}`, {});
        break;
    }
  }

  // ===== Gold Rain =====

  function triggerGoldRain(message) {
    goldRainTimer = 600; // 10 seconds at 60fps
    goldRainIntensity = 1.0;

    // Flash effect
    if (typeof IsoEffects !== 'undefined') {
      IsoEffects.spawnText(10, 8, '\u{1F4B0} GOLD RAIN! \u{1F4B0}',
        { color: '#FFD700', life: 120, rise: 0.3 });
    }

    // Sound
    if (typeof AudioManager !== 'undefined') AudioManager.playLevelUp();

    // Log
    if (typeof Farm !== 'undefined' && Farm.logEvent) {
      Farm.logEvent('\u{1F4B0}', message || 'Gold Rain from the Oracle!');
    }

    // Bonus energy
    if (typeof EventBus !== 'undefined') {
      EventBus.emit('TOKEN_BURNED', { amount: 50 });
    }
  }

  // ===== Data Crystal =====

  function spawnDataCrystal(data) {
    dataCrystals++;

    // Spawn floating crystal near monument area
    if (typeof IsoEffects !== 'undefined') {
      const cx = 15 + (Math.random() - 0.5) * 4;
      const cy = 17 + (Math.random() - 0.5) * 2;

      // Crystal sparkle burst
      for (let i = 0; i < 8; i++) {
        IsoEffects.spawnText(
          cx + (Math.random() - 0.5) * 1.5,
          cy - Math.random() * 1.5,
          '\u{1F48E}',
          { color: '#4FC3F7', life: 60 + Math.random() * 60, rise: 0.3 + Math.random() * 0.5 }
        );
      }

      // Label
      IsoEffects.spawnText(cx, cy - 2,
        `Data Crystal #${dataCrystals}`,
        { color: '#4FC3F7', life: 150, rise: 0.15 });
    }

    if (typeof AudioManager !== 'undefined') AudioManager.playHarvestPop();

    if (typeof Farm !== 'undefined' && Farm.logEvent) {
      Farm.logEvent('\u{1F48E}', `Data Crystal #${dataCrystals} appeared!`);
    }

    // Add resources
    if (typeof ResourceInventory !== 'undefined') {
      ResourceInventory.add('gold', 100);
    }
  }

  // ===== Announcement banner =====

  function showAnnouncement(text, data) {
    announcement = {
      text: String(text).slice(0, 100),
      timer: 300, // 5 seconds
      color: (data && data.color) || '#FFD700',
    };
  }

  // ===== Update & Draw =====

  function update(tick) {
    // Gold rain particles
    if (goldRainTimer > 0) {
      goldRainTimer--;
      goldRainIntensity = goldRainTimer / 600;

      // Spawn gold particles across visible area
      if (tick % 3 === 0 && typeof IsoEngine !== 'undefined') {
        const cx = (typeof Player !== 'undefined') ? Player.getPosition().x : 10;
        const cy = (typeof Player !== 'undefined') ? Player.getPosition().y : 10;
        for (let i = 0; i < 3; i++) {
          const rx = cx + (Math.random() - 0.5) * 20;
          const ry = cy + (Math.random() - 0.5) * 12;
          IsoEngine.spawnHarvestParticles(rx, ry, '#FFD700', 1);
          if (Math.random() < 0.3) {
            IsoEngine.spawnHarvestParticles(rx, ry, '#FFA500', 1);
          }
        }
      }

      // Floating coin emojis
      if (tick % 15 === 0 && typeof IsoEffects !== 'undefined') {
        const cx = (typeof Player !== 'undefined') ? Player.getPosition().x : 10;
        const cy = (typeof Player !== 'undefined') ? Player.getPosition().y : 10;
        const coins = ['\u{1FA99}', '\u{1F4B0}', '\u{2728}'];
        IsoEffects.spawnText(
          cx + (Math.random() - 0.5) * 15,
          cy + (Math.random() - 0.5) * 10,
          coins[Math.floor(Math.random() * coins.length)],
          { color: '#FFD700', life: 30, rise: 0.6 }
        );
      }
    }

    // Announcement timer
    if (announcement) {
      announcement.timer--;
      if (announcement.timer <= 0) announcement = null;
    }
  }

  function draw(ctx, canvasW, canvasH) {
    // Gold rain overlay tint
    if (goldRainTimer > 0) {
      ctx.save();
      ctx.globalAlpha = goldRainIntensity * 0.08;
      ctx.fillStyle = '#FFD700';
      ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.restore();
    }

    // Announcement banner
    if (announcement) {
      const fadeIn = Math.min(1, (300 - announcement.timer) / 30);
      const fadeOut = Math.min(1, announcement.timer / 30);
      const alpha = Math.min(fadeIn, fadeOut);

      ctx.save();
      ctx.globalAlpha = alpha;

      // Banner background
      const bannerH = 24;
      const bannerY = 30;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(0, bannerY, canvasW, bannerH);

      // Gold border lines
      ctx.fillStyle = announcement.color;
      ctx.fillRect(0, bannerY, canvasW, 1);
      ctx.fillRect(0, bannerY + bannerH - 1, canvasW, 1);

      // Text
      ctx.fillStyle = announcement.color;
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`\u{2728} ${announcement.text} \u{2728}`, canvasW / 2, bannerY + bannerH / 2);

      ctx.restore();
    }

    // Crystal count HUD (if any collected)
    if (dataCrystals > 0) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(canvasW - 70, 5, 65, 16);
      ctx.fillStyle = '#4FC3F7';
      ctx.font = '9px monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(`\u{1F48E} ${dataCrystals}`, canvasW - 10, 13);
      ctx.restore();
    }
  }

  // ===== Setup =====

  function setupListeners() {
    // Listen for oracle events from NetworkClient
    if (typeof EventBus !== 'undefined') {
      EventBus.on('ORACLE_EVENT', onOracleEvent);
    }
  }

  return {
    onOracleEvent,
    setupListeners,
    update,
    draw,
  };
})();
