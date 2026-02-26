/**
 * snapshot-v2.js — Milestone Snapshot 2.0 for AIFarm 3.0 (Sprint 21 P2).
 *
 * Enhances the screenshot system with:
 *   1. Auto-capture on milestone unlocks (with theater view pause)
 *   2. Decorative pixel-art frames around snapshots
 *   3. Milestone info overlay (milestone name, energy, date)
 *   4. Auto-download to user's Downloads folder
 *   5. Gallery of past milestone snapshots (in-memory)
 *
 * Listens for achievement and milestone events via EventBus.
 */

const SnapshotV2 = (() => {
  // ===== Configuration =====

  const THEATER_DURATION = 120;  // ticks (~2 seconds) for theater view
  const FRAME_PADDING = 12;
  const FRAME_COLOR = '#8B6B3E';   // wood-like frame
  const FRAME_INNER = '#DAA520';   // gold inner border
  const FRAME_CORNER_SIZE = 6;

  // Milestone thresholds that trigger auto-snapshot
  const AUTO_SNAPSHOT_MILESTONES = [50, 150, 300, 500, 800, 1200, 1800, 2500, 3500, 5000, 7500, 10000];

  // ===== State =====

  let theaterActive = false;
  let theaterTick = 0;
  let theaterInfo = null;  // { emoji, label, energy }
  let snapshotsTaken = new Set();  // milestone energies already captured
  let pendingSnapshot = null;  // delayed capture info
  let galleryCount = 0;

  // ===== Initialization =====

  function init() {
    setupListeners();
  }

  function setupListeners() {
    if (typeof EventBus === 'undefined') return;

    // Listen for milestone unlocks
    EventBus.on('MILESTONE_UNLOCKED', (data) => {
      if (data && data.energy && AUTO_SNAPSHOT_MILESTONES.includes(data.energy)) {
        triggerMilestoneSnapshot(data);
      }
    });

    // Listen for achievement unlocks (from main process)
    // These come via window.buddy.onAchievementUnlocked which is already handled in renderer.js
    // We'll hook into it via a secondary check
  }

  /**
   * Called when a milestone is unlocked. Can also be called manually.
   */
  function triggerMilestoneSnapshot(data) {
    if (!data) return;
    const energy = data.energy || 0;

    // Don't re-capture the same milestone
    if (snapshotsTaken.has(energy)) return;
    snapshotsTaken.add(energy);

    // Start theater mode
    theaterActive = true;
    theaterTick = 0;
    theaterInfo = {
      emoji: data.emoji || '\u{2B50}',
      label: data.label || `Milestone ${energy}`,
      energy,
    };

    // Schedule the actual screenshot capture a bit after theater starts
    // so the UI can render the theater frame first
    pendingSnapshot = {
      energy,
      captureAt: 30,  // capture at tick 30 of theater (0.5 sec in)
      captured: false,
    };
  }

  // ===== Update =====

  function update(tick) {
    if (!theaterActive) return;

    theaterTick++;

    // Capture snapshot at scheduled time
    if (pendingSnapshot && !pendingSnapshot.captured && theaterTick >= pendingSnapshot.captureAt) {
      captureWithFrame();
      pendingSnapshot.captured = true;
    }

    // End theater mode
    if (theaterTick >= THEATER_DURATION) {
      theaterActive = false;
      theaterInfo = null;
      pendingSnapshot = null;
    }
  }

  // ===== Drawing =====

  /**
   * Draw theater mode overlay (cinematic bars + milestone info).
   * Call after all normal rendering.
   */
  function drawTheater(ctx, canvasW, canvasH, tick) {
    if (!theaterActive || !theaterInfo) return;

    const progress = Math.min(1, theaterTick / 20);  // fade in over 20 ticks
    const fadeOut = theaterTick > THEATER_DURATION - 20
      ? (THEATER_DURATION - theaterTick) / 20 : 1;
    const alpha = progress * fadeOut;

    // Cinematic black bars (top and bottom)
    const barH = 30 * alpha;
    ctx.fillStyle = `rgba(0, 0, 0, ${(0.8 * alpha).toFixed(3)})`;
    ctx.fillRect(0, 0, canvasW, barH);
    ctx.fillRect(0, canvasH - barH, canvasW, barH);

    // Golden vignette corners
    ctx.save();
    ctx.globalAlpha = 0.15 * alpha;
    const vigGrad = ctx.createRadialGradient(canvasW / 2, canvasH / 2, canvasW * 0.3,
      canvasW / 2, canvasH / 2, canvasW * 0.7);
    vigGrad.addColorStop(0, 'transparent');
    vigGrad.addColorStop(1, '#DAA520');
    ctx.fillStyle = vigGrad;
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.restore();

    // Milestone info in bottom bar
    if (alpha > 0.3) {
      ctx.save();
      ctx.globalAlpha = alpha;

      // Emoji
      ctx.font = '14px monospace';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#FFD700';
      ctx.fillText(theaterInfo.emoji, canvasW / 2, canvasH - barH / 2);

      // Label
      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = '#FFF';
      ctx.fillText(theaterInfo.label, canvasW / 2, canvasH - barH / 2 + 14);

      // Energy badge (top bar)
      ctx.font = '8px monospace';
      ctx.fillStyle = '#DAA520';
      ctx.fillText(`\u{26A1} ${theaterInfo.energy} Energy`, canvasW / 2, barH / 2);

      // Date (top bar, right)
      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
      ctx.font = '7px monospace';
      ctx.fillStyle = '#AAA';
      ctx.textAlign = 'right';
      ctx.fillText(dateStr, canvasW - 10, barH / 2);

      // "AIFarm" branding (top bar, left)
      ctx.textAlign = 'left';
      ctx.fillStyle = '#888';
      ctx.fillText('\u{1F33E} AIFarm', 10, barH / 2);

      ctx.restore();
    }

    // Flash effect at capture moment
    if (pendingSnapshot && !pendingSnapshot.captured && theaterTick >= pendingSnapshot.captureAt - 3) {
      const flashAlpha = Math.max(0, 1 - (theaterTick - pendingSnapshot.captureAt + 3) / 6);
      if (flashAlpha > 0) {
        ctx.fillStyle = `rgba(255, 255, 255, ${(flashAlpha * 0.6).toFixed(3)})`;
        ctx.fillRect(0, 0, canvasW, canvasH);
      }
    }
  }

  // ===== Capture with decorative frame =====

  function captureWithFrame() {
    const canvas = document.getElementById('canvas');
    if (!canvas) return;

    const P = FRAME_PADDING;
    const snapW = canvas.width + P * 2;
    const snapH = canvas.height + P * 2;

    const snap = document.createElement('canvas');
    snap.width = snapW;
    snap.height = snapH;
    const sCtx = snap.getContext('2d');

    // Outer frame fill
    sCtx.fillStyle = FRAME_COLOR;
    sCtx.fillRect(0, 0, snapW, snapH);

    // Inner gold border
    sCtx.strokeStyle = FRAME_INNER;
    sCtx.lineWidth = 2;
    sCtx.strokeRect(P - 2, P - 2, canvas.width + 4, canvas.height + 4);

    // Corner decorations (small golden squares)
    sCtx.fillStyle = FRAME_INNER;
    const cs = FRAME_CORNER_SIZE;
    // Top-left
    sCtx.fillRect(P - cs - 1, P - cs - 1, cs, cs);
    // Top-right
    sCtx.fillRect(P + canvas.width + 1, P - cs - 1, cs, cs);
    // Bottom-left
    sCtx.fillRect(P - cs - 1, P + canvas.height + 1, cs, cs);
    // Bottom-right
    sCtx.fillRect(P + canvas.width + 1, P + canvas.height + 1, cs, cs);

    // Draw the actual farm canvas
    sCtx.drawImage(canvas, P, P);

    // Bottom info bar (inside frame, below canvas)
    const barY = P + canvas.height - 22;
    sCtx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    sCtx.fillRect(P, barY, canvas.width, 22);

    // Milestone label
    if (theaterInfo) {
      sCtx.fillStyle = '#FFD700';
      sCtx.font = 'bold 10px monospace';
      sCtx.textBaseline = 'middle';
      sCtx.textAlign = 'left';
      sCtx.fillText(theaterInfo.emoji + ' ' + theaterInfo.label, P + 6, barY + 11);

      sCtx.textAlign = 'right';
      sCtx.fillStyle = '#AAA';
      sCtx.font = '8px monospace';
      const now = new Date();
      const ts = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} | \u{26A1}${theaterInfo.energy}`;
      sCtx.fillText(ts, P + canvas.width - 6, barY + 11);
    }

    // Top branding bar
    sCtx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    sCtx.fillRect(P, P, canvas.width, 16);
    sCtx.fillStyle = '#DAA520';
    sCtx.font = '8px monospace';
    sCtx.textBaseline = 'middle';
    sCtx.textAlign = 'center';
    sCtx.fillText('\u{1F33E} AIFarm \u2014 Claude Buddy', P + canvas.width / 2, P + 8);

    // Save via IPC (avoids browser download dialog in Electron)
    const milestoneSlug = theaterInfo ? theaterInfo.label.replace(/\s+/g, '-').toLowerCase() : 'milestone';
    const fileName = `aifarm-${milestoneSlug}-${Date.now()}.png`;
    if (window.buddy && window.buddy.captureToFile) {
      window.buddy.captureToFile(`D:\\Mine\\claude-buddy\\Images\\${fileName}`);
    }

    galleryCount++;

    if (typeof Farm !== 'undefined' && Farm.logEvent) {
      Farm.logEvent('\u{1F4F7}', `Milestone postcard saved! (${milestoneSlug})`);
    }
  }

  // ===== Manual trigger (for testing or re-capture) =====

  function captureManual(label, emoji, energy) {
    theaterInfo = { label: label || 'Manual Snapshot', emoji: emoji || '\u{1F4F7}', energy: energy || 0 };
    captureWithFrame();
    theaterInfo = null;
  }

  // ===== Public API =====

  function isTheaterActive() { return theaterActive; }
  function getGalleryCount() { return galleryCount; }

  return {
    init,
    update,
    drawTheater,
    triggerMilestoneSnapshot,
    captureManual,
    isTheaterActive,
    getGalleryCount,
  };
})();

if (typeof module !== 'undefined') module.exports = SnapshotV2;
