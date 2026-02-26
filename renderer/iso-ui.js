// Iso UI — modal overlays for the isometric farm view.
// Handles the bulletin board daily summary popup with bounce animation.
const IsoUI = (() => {
  const PF = "Consolas, 'MS Gothic', monospace";
  // ===== Modal state =====
  let modalOpen = false;
  let modalAge = 0;        // ticks since open
  let modalClosing = false;
  let closeAge = 0;

  const BOUNCE_DURATION = 12; // ticks for bounce-in
  const CLOSE_DURATION = 6;   // ticks for close

  // ===== Open / Close =====

  function openDailySummary() {
    if (modalOpen) { close(); return; } // toggle
    modalOpen = true;
    modalClosing = false;
    modalAge = 0;
  }

  function close() {
    if (!modalOpen) return;
    modalClosing = true;
    closeAge = 0;
  }

  function isOpen() { return modalOpen; }

  // ===== Click detection =====
  // Called from renderer's click handler with grid coords.
  // Returns true if click was consumed (bulletin board hit).

  function handleClick(col, row) {
    // Close modal if clicking outside
    if (modalOpen) {
      close();
      return true; // consume click
    }

    // Check golden bird click first (higher priority — rare event)
    if (typeof IsoFarm !== 'undefined' && IsoFarm.handleFarmClick) {
      if (IsoFarm.handleFarmClick(col, row)) return true;
    }

    // Check if clicking on bulletin board entity
    if (typeof IsoTooltip !== 'undefined') {
      const entity = IsoTooltip.findEntityAt(col, row);
      if (entity && entity.signType === 'bulletin') {
        openDailySummary();
        return true;
      }
    }
    return false;
  }

  // ===== Update =====

  function update() {
    if (!modalOpen) return;

    if (modalClosing) {
      closeAge++;
      if (closeAge >= CLOSE_DURATION) {
        modalOpen = false;
        modalClosing = false;
      }
    } else {
      modalAge++;
    }
  }

  // ===== Draw =====

  function draw(ctx, canvasW, canvasH, tick) {
    if (!modalOpen) return;

    // Scale animation
    let scale;
    if (modalClosing) {
      scale = 1 - closeAge / CLOSE_DURATION;
    } else if (modalAge < BOUNCE_DURATION) {
      // Bounce: overshoot then settle
      const t = modalAge / BOUNCE_DURATION;
      scale = t < 0.5
        ? t * 2 * 1.15          // 0→1.15
        : 1.15 - (t - 0.5) * 2 * 0.15; // 1.15→1.0
    } else {
      scale = 1;
    }
    if (scale <= 0) return;

    const alpha = modalClosing
      ? Math.max(0, 1 - closeAge / CLOSE_DURATION)
      : Math.min(1, modalAge / 6);

    // -- Background dim --
    ctx.save();
    ctx.globalAlpha = alpha * 0.5;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.restore();

    // -- Modal panel --
    const panelW = Math.min(280, canvasW - 40);
    const panelH = Math.min(320, canvasH - 40);
    const cx = canvasW / 2;
    const cy = canvasH / 2;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);

    const px = Math.floor(cx - panelW / 2);
    const py = Math.floor(cy - panelH / 2);

    // Wood frame background
    drawWoodFrame(ctx, px, py, panelW, panelH);

    // Content
    drawSummaryContent(ctx, px, py, panelW, panelH, tick);

    ctx.restore();
  }

  // ===== Wood frame (pixel-art style) =====

  function drawWoodFrame(ctx, x, y, w, h) {
    const BORDER = 4;

    // Outer wood border
    ctx.fillStyle = '#6B4226';
    roundRect(ctx, x, y, w, h, 4);
    ctx.fill();

    // Inner wood border (lighter)
    ctx.fillStyle = '#8B5A2B';
    roundRect(ctx, x + 2, y + 2, w - 4, h - 4, 3);
    ctx.fill();

    // Paper/parchment interior
    ctx.fillStyle = '#F5E6C8';
    roundRect(ctx, x + BORDER, y + BORDER, w - BORDER * 2, h - BORDER * 2, 2);
    ctx.fill();

    // Gold corner rivets
    ctx.fillStyle = '#FFD700';
    const rivetR = 3;
    for (const [rx, ry] of [[x + 6, y + 6], [x + w - 6, y + 6], [x + 6, y + h - 6], [x + w - 6, y + h - 6]]) {
      ctx.beginPath();
      ctx.arc(rx, ry, rivetR, 0, Math.PI * 2);
      ctx.fill();
    }
    // Rivet shine
    ctx.fillStyle = '#FFF8DC';
    for (const [rx, ry] of [[x + 6, y + 6], [x + w - 6, y + 6], [x + 6, y + h - 6], [x + w - 6, y + h - 6]]) {
      ctx.fillRect(rx - 1, ry - 1, 1, 1);
    }
  }

  // ===== Summary content =====

  function drawSummaryContent(ctx, px, py, pw, ph, tick) {
    const usage = (typeof Farm !== 'undefined') ? Farm.getUsage() : null;
    const farmState = (typeof Farm !== 'undefined') ? Farm.getState() : null;
    const vibe = (typeof Farm !== 'undefined') ? Farm.getVibe() : null;
    const MARGIN = 12;
    const LEFT = px + MARGIN;
    let y = py + MARGIN + 2;

    // Title
    ctx.fillStyle = '#4A2800';
    ctx.font = `bold 11px ${PF}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('\u{1F4CB} Daily Summary', px + pw / 2, y);
    y += 16;

    // Separator line
    ctx.strokeStyle = '#C8A060';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(LEFT, y);
    ctx.lineTo(px + pw - MARGIN, y);
    ctx.stroke();
    y += 6;

    ctx.textAlign = 'left';
    ctx.font = `9px ${PF}`;

    if (!usage) {
      ctx.fillStyle = '#888';
      ctx.fillText('No usage data yet...', LEFT, y);
      return;
    }

    const fmtK = (n) => {
      if (n == null) return '0';
      if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
      return String(n);
    };

    // -- Today's Stats --
    ctx.fillStyle = '#8B5A2B';
    ctx.font = `bold 9px ${PF}`;
    ctx.fillText('\u{26A1} Today', LEFT, y);
    y += 13;

    ctx.font = `8px ${PF}`;
    ctx.fillStyle = '#4A2800';
    const todayStats = [
      [`Tokens:  ${fmtK(usage.todayTokens || 0)}`, '#D35400'],
      [`Messages: ${usage.todayMessages || 0}`, '#2E86C1'],
    ];
    for (const [text, color] of todayStats) {
      ctx.fillStyle = color;
      ctx.fillText(text, LEFT + 4, y);
      y += 11;
    }
    y += 2;

    // -- Live Session --
    ctx.fillStyle = '#8B5A2B';
    ctx.font = `bold 9px ${PF}`;
    ctx.fillText('\u{1F4BB} Live Session', LEFT, y);
    y += 13;

    ctx.font = `8px ${PF}`;
    const liveStats = [
      [`Output:  ${fmtK(usage.liveOutput || 0)} tok`, '#27AE60'],
      [`Input:   ${fmtK(usage.liveInput || 0)} tok`, '#8E44AD'],
      [`Cache:   ${fmtK(usage.liveCacheRead || 0)}`, '#7F8C8D'],
      [`Msgs:    ${usage.liveMessages || 0}`, '#2E86C1'],
    ];
    for (const [text, color] of liveStats) {
      ctx.fillStyle = color;
      ctx.fillText(text, LEFT + 4, y);
      y += 11;
    }
    y += 2;

    // -- Farm Progress --
    if (farmState) {
      ctx.fillStyle = '#8B5A2B';
      ctx.font = `bold 9px ${PF}`;
      ctx.fillText('\u{1F33E} Farm', LEFT, y);
      y += 13;

      ctx.font = `8px ${PF}`;
      ctx.fillStyle = '#4A2800';
      ctx.fillText(`Energy: ${fmtK(farmState.totalEnergy || 0)}`, LEFT + 4, y);
      y += 11;
      ctx.fillText(`Harvests: ${farmState.totalHarvests || 0}`, LEFT + 4, y);
      y += 11;

      // Milestone progress bar
      const milestones = [50, 150, 300, 500, 800, 1200, 1800, 2500, 3500, 5000, 7500, 10000];
      const energy = farmState.totalEnergy || 0;
      let nextMs = milestones.find(m => m > energy);
      if (nextMs) {
        const prevMs = milestones[milestones.indexOf(nextMs) - 1] || 0;
        const pct = Math.min(1, (energy - prevMs) / (nextMs - prevMs));
        const barW = pw - MARGIN * 2 - 8;
        const barH = 6;
        const barX = LEFT + 4;

        // Bar background
        ctx.fillStyle = '#D4C4A8';
        ctx.fillRect(barX, y, barW, barH);
        // Bar fill
        ctx.fillStyle = '#FFD700';
        ctx.fillRect(barX, y, Math.floor(barW * pct), barH);
        // Bar border
        ctx.strokeStyle = '#8B5A2B';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(barX, y, barW, barH);
        y += barH + 3;

        ctx.fillStyle = '#888';
        ctx.font = `7px ${PF}`;
        ctx.fillText(`Next: ${fmtK(nextMs)} (${Math.floor(pct * 100)}%)`, LEFT + 4, y);
      }
    }

    // -- Farm Log (recent activity) --
    const log = (typeof Farm !== 'undefined' && Farm.getLog) ? Farm.getLog() : [];
    if (log.length > 0) {
      y += 6;
      ctx.fillStyle = '#8B5A2B';
      ctx.font = `bold 9px ${PF}`;
      ctx.fillText('\u{1F4DC} Activity', LEFT, y);
      y += 13;

      ctx.font = `8px ${PF}`;
      const now = Date.now();
      const maxShow = Math.min(log.length, 5); // show up to 5 in modal
      for (let i = 0; i < maxShow; i++) {
        const entry = log[i];
        const ago = Math.floor((now - entry.time) / 1000);
        const agoStr = ago < 60 ? `${ago}s` : `${Math.floor(ago / 60)}m`;
        ctx.fillStyle = '#4A2800';
        ctx.fillText(`${entry.emoji} ${entry.text}`, LEFT + 4, y);
        // Right-align timestamp
        ctx.textAlign = 'right';
        ctx.fillStyle = '#999';
        ctx.fillText(agoStr, px + pw - MARGIN, y);
        ctx.textAlign = 'left';
        y += 11;
      }
    }
    y += 4;

    // -- Vibe indicator (bottom right) --
    if (vibe && vibe.mood) {
      const moodEmoji = {
        productive: '\u{1F525}', focused: '\u{1F3AF}', creative: '\u{2728}',
        frustrated: '\u{1F4A2}', calm: '\u{1F343}', idle: '\u{1F4A4}',
      };
      const icon = moodEmoji[vibe.mood] || '\u{2699}\u{FE0F}';
      const score = Math.round((vibe.vibeScore || 0) * 100);
      ctx.textAlign = 'right';
      ctx.font = `8px ${PF}`;
      ctx.fillStyle = score >= 75 ? '#D35400' : score >= 40 ? '#2E86C1' : '#888';
      ctx.fillText(`${icon} Vibe ${score}%`, px + pw - MARGIN, py + ph - MARGIN);
      ctx.textAlign = 'left';
    }

    // -- Close hint --
    ctx.textAlign = 'center';
    ctx.font = `7px ${PF}`;
    ctx.fillStyle = '#AAA';
    ctx.fillText('Click anywhere to close', px + pw / 2, py + ph - MARGIN + 2);
  }

  // ===== Utility =====

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  return {
    openDailySummary,
    close,
    isOpen,
    handleClick,
    update,
    draw,
  };
})();
