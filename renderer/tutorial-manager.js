/**
 * tutorial-manager.js — New player onboarding & tutorial system (Sprint 28 P0).
 *
 * Guides new players through basic farm mechanics:
 *   Step 1: Welcome dialog from Sage NPC at spawn
 *   Step 2: Walk to the farm plot (highlight + arrow)
 *   Step 3: Wait for a crop to be harvested
 *   Step 4: Walk to shipping bin and sell (highlight + arrow)
 *   Step 5: Visit the shop
 *   Step 6: Tutorial complete — celebrate!
 *
 * Persisted via farm-state (tutorialComplete flag).
 * Renders bouncing arrows and highlight circles over targets.
 */
const TutorialManager = (() => {
  // Tutorial steps
  const STEPS = [
    { id: 'welcome',  text: 'Welcome to AIFarm! I am the Sage. Let me show you around.',                    target: null },
    { id: 'walk',     text: 'Use WASD or arrow keys to walk. Head to the farm plots!',                      target: { col: 5, row: 10 }, radius: 3 },
    { id: 'harvest',  text: 'Your buddies plant crops automatically. Wait for one to be harvested!',         target: { col: 6, row: 11 }, event: 'CROP_HARVESTED' },
    { id: 'sell',     text: 'Great! Now walk to the shipping bin and press [E] to sell your crops.',         target: { col: 2, row: 13 }, radius: 2, event: 'RESOURCE_SOLD' },
    { id: 'shop',     text: 'Nice! Visit the tool shed (the red building) and press [E] to open the shop.', target: { col: 15, row: 5 }, radius: 2, event: 'SHOP_PURCHASE' },
    { id: 'done',     text: 'You\'re all set! Explore, build, and watch your farm grow. Have fun!',          target: null },
  ];

  let currentStep = 0;
  let active = false;
  let completed = false;
  let dialogTimer = 0;        // ticks showing current dialog
  let dialogDismissed = false; // player pressed key to advance
  let arrowBounce = 0;        // animation tick for bouncing arrow

  const DIALOG_MIN_TIME = 120; // 2 seconds before allowing dismiss
  const DIALOG_AUTO_ADVANCE = 600; // 10 seconds auto-advance

  // ===== Init =====

  function init(tutorialState) {
    if (tutorialState && tutorialState.completed) {
      completed = true;
      active = false;
      return;
    }
    // Start tutorial for new players
    completed = false;
    active = true;
    currentStep = 0;
    dialogTimer = 0;
    dialogDismissed = false;
  }

  function isActive() { return active && !completed; }
  function isComplete() { return completed; }

  // ===== Update =====

  function update(tick) {
    if (!active || completed) return;

    arrowBounce = tick;
    dialogTimer++;

    const step = STEPS[currentStep];
    if (!step) { complete(); return; }

    // Auto-advance dialog after timeout
    if (dialogTimer > DIALOG_AUTO_ADVANCE) {
      advanceStep();
    }
  }

  function advanceStep() {
    currentStep++;
    dialogTimer = 0;
    dialogDismissed = false;

    if (currentStep >= STEPS.length) {
      complete();
    }
  }

  function complete() {
    active = false;
    completed = true;
    if (typeof window !== 'undefined' && window.buddy && window.buddy.saveTutorial) {
      window.buddy.saveTutorial(getState());
    }
    // Celebrate
    if (typeof IsoEffects !== 'undefined') {
      const pp = (typeof Player !== 'undefined') ? Player.getPosition() : { x: 10, y: 10 };
      IsoEffects.spawnText(pp.x, pp.y - 2, '\u{1F389} Tutorial Complete!',
        { color: '#FFD700', life: 150, rise: 0.3 });
    }
    if (typeof AudioManager !== 'undefined') AudioManager.playLevelUp();
    // Save state
    if (typeof EventBus !== 'undefined') {
      EventBus.emit('TUTORIAL_COMPLETE', {});
    }
  }

  // ===== Event handling =====

  function onEvent(eventName) {
    if (!active || completed) return;
    const step = STEPS[currentStep];
    if (step && step.event === eventName) {
      advanceStep();
    }
  }

  // ===== Key handling =====

  function handleKey(key) {
    if (!active || completed) return false;
    const step = STEPS[currentStep];

    // Allow dismiss/advance on Enter or E
    if ((key === 'Enter' || key === 'e' || key === 'E' || key === ' ') && dialogTimer > DIALOG_MIN_TIME) {
      if (!step.event) {
        // Dialog-only step — advance on key press
        advanceStep();
        return true;
      }
      dialogDismissed = true;
      return false; // don't consume key — let it pass through for gameplay
    }
    return false;
  }

  // ===== Drawing =====

  function draw(ctx, canvasW, canvasH, tick) {
    if (!active || completed) return;
    const step = STEPS[currentStep];
    if (!step) return;

    // Draw dialog box at bottom of screen
    drawDialog(ctx, canvasW, canvasH, step.text, tick);

    // Draw bouncing arrow + highlight on target
    if (step.target && typeof IsoEngine !== 'undefined') {
      drawTargetIndicator(ctx, step.target, step.radius || 1, tick);
    }
  }

  function drawDialog(ctx, canvasW, canvasH, text, tick) {
    ctx.save();

    // Dialog box
    const boxH = 50;
    const boxY = canvasH - boxH - 10;
    const boxX = 20;
    const boxW = canvasW - 40;

    // Fade in
    const fadeIn = Math.min(1, dialogTimer / 20);
    ctx.globalAlpha = fadeIn;

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(boxX, boxY, boxW, boxH);

    // Border
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    // Sage icon
    ctx.font = '16px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#FFF';
    ctx.fillText('\u{1F9D9}', boxX + 8, boxY + boxH / 2);

    // Text
    ctx.font = '9px monospace';
    ctx.fillStyle = '#F5E6C8';
    ctx.textAlign = 'left';

    // Word wrap
    const maxWidth = boxW - 50;
    const words = text.split(' ');
    let line = '';
    let lineY = boxY + 16;
    for (const word of words) {
      const test = line + word + ' ';
      if (ctx.measureText(test).width > maxWidth && line.length > 0) {
        ctx.fillText(line.trim(), boxX + 34, lineY);
        line = word + ' ';
        lineY += 12;
      } else {
        line = test;
      }
    }
    ctx.fillText(line.trim(), boxX + 34, lineY);

    // "Press Enter" hint (only after min time)
    if (dialogTimer > DIALOG_MIN_TIME) {
      const blink = Math.sin(tick * 0.1) > 0;
      if (blink) {
        ctx.font = '7px monospace';
        ctx.fillStyle = '#AAA';
        ctx.textAlign = 'right';
        const step = STEPS[currentStep];
        const hint = step.event ? '(waiting for action...)' : '[Enter] to continue';
        ctx.fillText(hint, boxX + boxW - 8, boxY + boxH - 8);
      }
    }

    ctx.restore();
  }

  function drawTargetIndicator(ctx, target, radius, tick) {
    const sx = IsoEngine.gridToScreenX(target.col, target.row);
    const sy = IsoEngine.gridToScreenY(target.col, target.row);
    if (sx === undefined || sy === undefined) return;

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.scale(IsoEngine.getZoom(), IsoEngine.getZoom());

    // Highlight circle (pulsing)
    const pulse = 0.3 + Math.sin(tick * 0.05) * 0.15;
    const r = radius * 16; // approximate tile size in screen pixels
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 215, 0, ${pulse * 0.15})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(255, 215, 0, ${pulse})`;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Bouncing arrow above target
    const bounce = Math.sin(tick * 0.08) * 4;
    const arrowY = sy - r - 12 + bounce;

    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.moveTo(sx, arrowY + 8);
    ctx.lineTo(sx - 4, arrowY);
    ctx.lineTo(sx + 4, arrowY);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  // ===== Setup =====

  function setupListeners() {
    if (typeof EventBus !== 'undefined') {
      EventBus.on('CROP_HARVESTED', () => onEvent('CROP_HARVESTED'));
      EventBus.on('RESOURCE_SOLD', () => onEvent('RESOURCE_SOLD'));
      EventBus.on('SHOP_PURCHASE', () => onEvent('SHOP_PURCHASE'));
    }
  }

  /** Get state for persistence. */
  function getState() {
    return { completed };
  }

  return {
    init,
    isActive,
    isComplete,
    update,
    handleKey,
    draw,
    setupListeners,
    getState,
  };
})();
