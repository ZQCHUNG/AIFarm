/**
 * victory-monument.js — Legendary Victory Monument (Sprint 30 P0).
 *
 * The ultimate endgame reward:
 *   - Triggers when MonumentV2 reaches Grand Spire (stage 4) AND collection 100%
 *   - "Ascension Ceremony": monument becomes flowing gold, full-map fireworks
 *   - Unlocks "Legendary Lord" title, infinite stamina, instant teleport
 *   - One-time event, persisted in farm-state
 *
 * Integrates with MonumentV2 (stage check), CollectionUI (completion),
 * IsoEffects (fireworks), Player (buffs).
 */
const VictoryMonument = (() => {
  let triggered = false;
  let ceremonyActive = false;
  let ceremonyTimer = 0;
  const CEREMONY_DURATION = 3600; // 1 minute at 60fps

  // Firework particle pool
  const fireworks = [];
  const MAX_FIREWORKS = 50;

  // Title unlocked
  let legendaryUnlocked = false;

  // ===== Init =====

  function init(savedState) {
    if (savedState && savedState.victoryTriggered) {
      triggered = true;
      legendaryUnlocked = true;
    }
  }

  // ===== Update =====

  function update(tick) {
    // Check trigger conditions
    if (!triggered) {
      checkTrigger();
    }

    // Update ceremony
    if (ceremonyActive) {
      updateCeremony(tick);
    }

    // Apply legendary buffs
    if (legendaryUnlocked) {
      applyBuffs();
    }
  }

  function checkTrigger() {
    if (typeof MonumentV2 === 'undefined' || typeof CollectionUI === 'undefined') return;

    const stage = MonumentV2.getStage();
    const completion = CollectionUI.getCompletionPercent ? CollectionUI.getCompletionPercent() : 0;

    // Grand Spire (stage 4) + 100% collection
    if (stage >= 4 && completion >= 100) {
      trigger();
    }
  }

  function trigger() {
    triggered = true;
    ceremonyActive = true;
    ceremonyTimer = CEREMONY_DURATION;
    legendaryUnlocked = true;

    // Announcement
    if (typeof IsoEffects !== 'undefined') {
      const pp = (typeof Player !== 'undefined') ? Player.getPosition() : { x: 10, y: 10 };
      IsoEffects.spawnText(pp.x, pp.y - 3, '\u{1F3C6} ASCENSION CEREMONY!',
        { color: '#FFD700', life: 180, rise: 0.15 });
      IsoEffects.spawnText(pp.x, pp.y - 2, 'You are now a Legendary Lord!',
        { color: '#FFF', life: 150, rise: 0.2 });
    }

    if (typeof AudioManager !== 'undefined') AudioManager.playLevelUp();

    if (typeof Farm !== 'undefined' && Farm.logEvent) {
      Farm.logEvent('\u{1F3C6}', 'The Ascension Ceremony has begun! You are a Legend!');
    }

    if (typeof EventBus !== 'undefined') {
      EventBus.emit('VICTORY_ACHIEVED', { title: 'Legendary Lord' });
    }
  }

  function updateCeremony(tick) {
    ceremonyTimer--;

    // Spawn fireworks across the map
    if (tick % 3 === 0) {
      spawnFirework();
    }

    if (ceremonyTimer <= 0) {
      ceremonyActive = false;
      fireworks.length = 0;
    }

    // Update existing fireworks
    for (let i = fireworks.length - 1; i >= 0; i--) {
      const fw = fireworks[i];
      fw.timer--;
      fw.y -= fw.vy;
      fw.vy *= 0.97;

      // Explode phase
      if (fw.timer < fw.explodeAt && !fw.exploded) {
        fw.exploded = true;
        // Spawn explosion particles via IsoEffects
        if (typeof IsoEffects !== 'undefined') {
          const colors = ['#FF4444', '#FFD700', '#4FC3F7', '#69F0AE', '#FF69B4', '#FFA726'];
          for (let j = 0; j < 6; j++) {
            IsoEffects.spawnText(
              fw.col + (Math.random() - 0.5) * 3,
              fw.row + (Math.random() - 0.5) * 2,
              '\u{2728}',
              { color: colors[j % colors.length], life: 30 + Math.random() * 20, rise: 0.3 + Math.random() * 0.4 }
            );
          }
        }
      }

      if (fw.timer <= 0) {
        fireworks.splice(i, 1);
      }
    }
  }

  function spawnFirework() {
    if (fireworks.length >= MAX_FIREWORKS) return;

    const pp = (typeof Player !== 'undefined') ? Player.getPosition() : { x: 10, y: 10 };
    fireworks.push({
      col: pp.x + (Math.random() - 0.5) * 20,
      row: pp.y + (Math.random() - 0.5) * 12,
      y: 0,
      vy: 0.5 + Math.random() * 0.5,
      timer: 60 + Math.random() * 30,
      explodeAt: 20 + Math.random() * 10,
      exploded: false,
      color: `hsl(${Math.random() * 360}, 80%, 60%)`,
    });
  }

  function applyBuffs() {
    // Infinite stamina: reset stamina every frame
    if (typeof Player !== 'undefined' && Player.setStamina) {
      Player.setStamina(Player.MAX_STAMINA || 100);
    }
  }

  // ===== Draw =====

  function draw(ctx, canvasW, canvasH, tick) {
    // Golden monument glow (when legendary)
    if (legendaryUnlocked) {
      drawGoldenGlow(ctx, canvasW, canvasH, tick);
    }

    // Ceremony overlay
    if (ceremonyActive) {
      drawCeremony(ctx, canvasW, canvasH, tick);
    }

    // Legendary title in HUD
    if (legendaryUnlocked) {
      drawTitle(ctx, canvasW, canvasH, tick);
    }
  }

  function drawGoldenGlow(ctx, canvasW, canvasH, tick) {
    // Subtle golden vignette when legendary
    const pulse = 0.02 + Math.sin(tick * 0.03) * 0.01;
    ctx.save();
    ctx.globalAlpha = pulse;
    const grd = ctx.createRadialGradient(
      canvasW / 2, canvasH / 2, canvasW * 0.2,
      canvasW / 2, canvasH / 2, canvasW * 0.6
    );
    grd.addColorStop(0, 'transparent');
    grd.addColorStop(1, '#FFD700');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.restore();
  }

  function drawCeremony(ctx, canvasW, canvasH, tick) {
    // Golden flash overlay (fades over ceremony)
    const progress = 1 - ceremonyTimer / CEREMONY_DURATION;
    const flashAlpha = Math.max(0, 0.15 * (1 - progress));

    ctx.save();
    ctx.globalAlpha = flashAlpha;
    ctx.fillStyle = '#FFD700';
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.restore();

    // Ceremony text (pulsing)
    if (progress < 0.5) {
      ctx.save();
      const textAlpha = Math.sin(tick * 0.08) * 0.3 + 0.7;
      ctx.globalAlpha = textAlpha * (1 - progress * 2);
      ctx.font = 'bold 14px monospace';
      ctx.fillStyle = '#FFD700';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('\u{1F3C6} LEGENDARY LORD \u{1F3C6}', canvasW / 2, canvasH / 3);
      ctx.font = '9px monospace';
      ctx.fillStyle = '#FFF';
      ctx.fillText('The Ascension Ceremony', canvasW / 2, canvasH / 3 + 20);
      ctx.restore();
    }

    // Draw firework trails
    if (typeof IsoEngine !== 'undefined') {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.scale(IsoEngine.getZoom(), IsoEngine.getZoom());
      for (const fw of fireworks) {
        if (fw.exploded) continue;
        const sx = IsoEngine.gridToScreenX(fw.col, fw.row);
        const sy = IsoEngine.gridToScreenY(fw.col, fw.row);
        if (sx === undefined || sy === undefined) continue;
        ctx.fillStyle = fw.color;
        ctx.beginPath();
        ctx.arc(sx, sy - fw.y * 10, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawTitle(ctx, canvasW, canvasH, tick) {
    // Small legendary badge in top-right
    if (ceremonyActive) return; // Don't draw during ceremony

    ctx.save();
    ctx.font = '6px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#FFD700';
    const pulse = Math.sin(tick * 0.04) > 0 ? '\u{1F3C6}' : '\u{2B50}';
    ctx.fillText(`${pulse} Legendary Lord`, canvasW - 6, 4);
    ctx.restore();
  }

  // ===== Persistence =====

  function getState() {
    return { victoryTriggered: triggered };
  }

  function isLegendary() { return legendaryUnlocked; }
  function isCeremonyActive() { return ceremonyActive; }

  return {
    init,
    update,
    draw,
    getState,
    isLegendary,
    isCeremonyActive,
  };
})();
