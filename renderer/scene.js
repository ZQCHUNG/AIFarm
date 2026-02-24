// Shared village scene — panoramic background with per-buddy slots.
const Scene = (() => {
  const PX = 3;
  const SLOT_W = 40;    // logical slot width per buddy
  const SKY_H = 38;     // logical sky height
  const GROUND_Y = 40;  // logical ground start

  function px(ctx, x, y, c) { ctx.fillStyle = c; ctx.fillRect(x * PX, y * PX, PX, PX); }
  function rect(ctx, x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x * PX, y * PX, w * PX, h * PX); }

  // ===== Shared background (drawn once across full width) =====

  // Parallax rates: 0 = fixed, 1 = full camera speed
  const PARALLAX_SKY = 0;       // sky doesn't move
  const PARALLAX_CLOUDS = 0.1;  // clouds drift very slowly with camera
  const PARALLAX_FAR_HILLS = 0.2;
  const PARALLAX_NEAR_HILLS = 0.35;
  const PARALLAX_GROUND = 0;    // village ground is fixed with buddies

  function drawBackground(ctx, canvasW, tick) {
    const logW = Math.ceil(canvasW / PX);
    const logH = 117;

    // Get camera offset for parallax (0 when Viewport not loaded)
    const camX = (typeof Viewport !== 'undefined') ? Viewport.getCameraX() : 0;

    // Sky (fixed — no parallax)
    rect(ctx, 0, 0, logW, 32, '#7EC8E3');
    rect(ctx, 0, 32, logW, 4, '#A8DCF0');
    rect(ctx, 0, 36, logW, 2, '#C4E8F6');

    // Sun (fixed)
    const sx = logW - 12, sy = 6;
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const d = Math.sqrt(dx*dx + dy*dy);
        if (d <= 3) px(ctx, sx+dx, sy+dy, d < 1.5 ? '#FFF8D0' : d < 2.5 ? '#FFE87C' : '#FFD74040');
      }
    if ((tick / 40 | 0) % 2 === 0) {
      px(ctx, sx, sy-4, '#FFF0A0'); px(ctx, sx-4, sy, '#FFF0A0'); px(ctx, sx+4, sy, '#FFF0A0');
    }

    // Clouds (very slow parallax + drift animation)
    const cloudOffset = Math.round(camX * PARALLAX_CLOUDS);
    const drift = (tick * 0.015) | 0;
    const cloudW = logW + 20;
    drawCloud(ctx, ((15 + drift - cloudOffset) % cloudW + cloudW) % cloudW - 10, 8);
    drawCloud(ctx, ((Math.floor(cloudW * 0.45) + drift - cloudOffset) % cloudW + cloudW) % cloudW - 10, 14);
    drawCloud(ctx, ((Math.floor(cloudW * 0.75) + drift - cloudOffset) % cloudW + cloudW) % cloudW - 10, 10);

    // Far hills (slow parallax)
    const farOffset = Math.round(camX * PARALLAX_FAR_HILLS);
    for (let x = 0; x < logW; x++) {
      const wx = x + farOffset; // world-space x for wave calculation
      const h1 = Math.sin(wx * 0.05) * 3 + Math.sin(wx * 0.11) * 1.5 + 4;
      const top1 = 34 - (h1 | 0);
      for (let y = top1; y < 38; y++) px(ctx, x, y, y === top1 ? '#8CD47E' : '#72C464');
    }

    // Near hills (medium parallax)
    const nearOffset = Math.round(camX * PARALLAX_NEAR_HILLS);
    for (let x = 0; x < logW; x++) {
      const wx = x + nearOffset;
      const h2 = Math.sin(wx * 0.08 + 1) * 2.5 + Math.cos(wx * 0.04) * 1.5 + 3;
      const top2 = 38 - (h2 | 0);
      for (let y = top2; y < GROUND_Y; y++) px(ctx, x, y, y === top2 ? '#6ABD55' : '#5AAE45');
    }

    // Ground (village area — fixed, no parallax)
    rect(ctx, 0, GROUND_Y, logW, 10, '#4EA040');
    rect(ctx, 0, GROUND_Y, logW, 1, '#5DB84E');

    // Dirt path
    rect(ctx, 0, GROUND_Y + 7, logW, 3, '#C8A870');
    rect(ctx, 0, GROUND_Y + 7, logW, 1, '#D4B880');

    // Grass tufts
    const sw = Math.sin(tick * 0.04);
    for (let gx = 3; gx < logW; gx += 11) {
      const s = sw > 0.3 ? 1 : 0;
      px(ctx, gx + s, GROUND_Y - 1, '#5DB84E');
      px(ctx, gx + 1 + s, GROUND_Y - 2, '#68C456');
    }

    // Decorative tree on far left
    drawTreeDecor(ctx, 2, 18, tick);
    // Decorative cottage on far right
    drawCottageDecor(ctx, logW - 22, 28, tick);
  }

  function drawCloud(ctx, x, y) {
    rect(ctx, x+1, y, 5, 1, '#FFF');
    rect(ctx, x, y+1, 7, 2, '#FFF');
    rect(ctx, x+1, y+3, 5, 1, '#EEF2F8');
  }

  function drawTreeDecor(ctx, tx, ty, tick) {
    rect(ctx, tx + 5, ty + 11, 3, 11, '#8B6B3E');
    const s = Math.sin(tick * 0.02) > 0 ? 1 : 0;
    rect(ctx, tx + 2 + s, ty, 9, 2, '#3EA832');
    rect(ctx, tx + 1 + s, ty + 2, 11, 2, '#4AB840');
    rect(ctx, tx + s, ty + 4, 13, 3, '#3EA832');
    rect(ctx, tx + 1 + s, ty + 7, 11, 2, '#34963A');
    rect(ctx, tx + 3 + s, ty + 9, 7, 2, '#2E8830');
    px(ctx, tx + 4 + s, ty + 1, '#58D050');
    px(ctx, tx + 3 + s, ty + 5, '#E84040');  // apple
    px(ctx, tx + 9 + s, ty + 7, '#E84040');
  }

  function drawCottageDecor(ctx, cx, cy, tick) {
    rect(ctx, cx, cy + 5, 18, 10, '#E8D0A8');
    rect(ctx, cx - 2, cy, 22, 2, '#B04838');
    rect(ctx, cx - 1, cy + 2, 20, 2, '#C05848');
    rect(ctx, cx, cy + 4, 18, 1, '#D06858');
    rect(ctx, cx + 7, cy + 9, 4, 6, '#8B6B3E');
    px(ctx, cx + 10, cy + 12, '#D4A020');
    rect(ctx, cx + 2, cy + 7, 4, 3, '#88C0E0');
    rect(ctx, cx + 13, cy + 7, 4, 3, '#88C0E0');
    rect(ctx, cx + 14, cy - 3, 3, 5, '#A08070');
    const sp = (tick / 18 | 0) % 4;
    if (sp < 3) px(ctx, cx + 15, cy - 4 - sp, '#CCC');
    if (sp < 2) px(ctx, cx + 14, cy - 5 - sp, '#BBB');
  }

  // ===== Per-slot station (drawn at each buddy's position) =====

  function drawStation(ctx, slotX, state, tick) {
    const isWorking = state !== 'idle' && state !== 'sleeping';
    const sx = slotX; // logical x of slot center-ish
    const gy = GROUND_Y;

    if (isWorking) {
      // Small desk
      rect(ctx, sx + 6, gy - 2, 16, 2, '#C8A060');
      rect(ctx, sx + 6, gy - 2, 16, 1, '#D4B070');
      rect(ctx, sx + 7, gy, 2, 4, '#9A7540');
      rect(ctx, sx + 19, gy, 2, 4, '#9A7540');
      // Monitor
      rect(ctx, sx + 13, gy - 7, 7, 5, '#333');
      rect(ctx, sx + 14, gy - 6, 5, 3, '#446688');
      rect(ctx, sx + 15, gy - 2, 3, 1, '#444');
      // Mug
      px(ctx, sx + 8, gy - 3, '#FFF');
      px(ctx, sx + 8, gy - 4, '#DDD');
      // Chair
      rect(ctx, sx + 3, gy - 4, 3, 5, '#8B6B3E');
      rect(ctx, sx + 2, gy + 1, 5, 1, '#7A5C32');
    } else if (state === 'sleeping') {
      // Blanket on ground
      rect(ctx, sx + 3, gy + 1, 14, 3, '#7BA7CC');
      rect(ctx, sx + 3, gy + 1, 14, 1, '#8BB8DC');
      // Pillow
      rect(ctx, sx + 15, gy, 4, 2, '#FFFFF0');
      px(ctx, sx + 16, gy, '#F0F0E4');
    } else {
      // Bench for idle
      rect(ctx, sx + 4, gy + 1, 14, 1, '#B89060');
      rect(ctx, sx + 4, gy + 1, 14, 1, '#C8A070');
      rect(ctx, sx + 5, gy + 2, 2, 3, '#9A7540');
      rect(ctx, sx + 15, gy + 2, 2, 3, '#9A7540');
    }

    // Small flowers near slot
    const f = (tick * 0.05 + sx) % 6.28;
    const s = Math.sin(f) > 0.3 ? 1 : 0;
    px(ctx, sx + 1 + s, gy, '#3A8A30');
    px(ctx, sx + 1 + s, gy - 1, ['#FF6B8A', '#FFD700', '#DA70D6'][(sx / 3 | 0) % 3]);
  }

  // ===== Nameplate =====

  function drawNameplate(ctx, slotCenterPx, name, hoodieColor) {
    if (!name) return;
    const canvasCtx = ctx;
    canvasCtx.font = 'bold 9px monospace';
    const tw = canvasCtx.measureText(name).width;
    const pw = Math.min(tw + 10, SLOT_W * PX - 4);
    const px_x = slotCenterPx - pw / 2;
    const py = 48 * PX;

    // Border in hoodie color for easy identification
    const borderColor = hoodieColor || '#8B6B3E';
    canvasCtx.fillStyle = borderColor;
    canvasCtx.fillRect(px_x, py, pw, 14);
    canvasCtx.fillStyle = '#FFF8F0';
    canvasCtx.fillRect(px_x + 1, py + 1, pw - 2, 12);

    // Colored dot + text
    canvasCtx.fillStyle = borderColor;
    canvasCtx.fillRect(px_x + 3, py + 5, 4, 4);

    canvasCtx.fillStyle = '#333';
    canvasCtx.textBaseline = 'middle';
    canvasCtx.textAlign = 'center';
    canvasCtx.fillText(name, slotCenterPx + 2, py + 7, pw - 14);
  }

  return {
    PX, SLOT_W, GROUND_Y,
    drawBackground, drawStation, drawNameplate,
  };
})();
