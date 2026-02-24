// Compact pixel art character with per-buddy hoodie color.
const Character = (() => {
  const PX = 3;

  // Base palette
  const P = {
    skin: '#FFD5B8', skinDk: '#E8B796',
    hair: '#4A3728', hairDk: '#362818',
    eye: '#2C2C2C', eyeW: '#FFFFFF',
    mouth: '#C85A32', blush: '#F0A0A0',
    pants: '#5B7DAF', pantsDk: '#486A96',
    shoe: '#3C3C3C',
  };

  // Hoodie color palette — each buddy gets a unique one
  const HOODIE_COLORS = [
    { o: '#E8734A', O: '#C85A32' },  // Claude orange
    { o: '#4A90D9', O: '#3570B0' },  // blue
    { o: '#6AB04C', O: '#4E8A38' },  // green
    { o: '#DA70D6', O: '#B050A8' },  // purple
    { o: '#E8C840', O: '#C0A030' },  // gold
    { o: '#40C4AA', O: '#30A088' },  // teal
    { o: '#E85080', O: '#C03860' },  // pink
    { o: '#C88850', O: '#A06838' },  // brown
  ];

  function px(ctx, x, y, c) { ctx.fillStyle = c; ctx.fillRect(x * PX, y * PX, PX, PX); }
  function rect(ctx, x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x * PX, y * PX, w * PX, h * PX); }

  // Sprite char → color, with hoodie colors injected per buddy
  function makeMap(hoodieLight, hoodieDark) {
    return {
      '.': null,
      'h': P.hair, 'H': P.hairDk, 's': P.skin, 'S': P.skinDk,
      'e': P.eye, 'w': P.eyeW, 'b': P.blush, 'm': P.mouth,
      'o': hoodieLight, 'O': hoodieDark,
      'p': P.pants, 'P': P.pantsDk, 'x': P.shoe,
    };
  }

  function drawSprite(ctx, ox, oy, rows, map) {
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y];
      for (let x = 0; x < row.length; x++) {
        const c = map[row[x]];
        if (c) px(ctx, ox + x, oy + y, c);
      }
    }
  }

  function getHoodie(colorIndex) {
    return HOODIE_COLORS[colorIndex % HOODIE_COLORS.length];
  }

  // ====== Working pose (sitting at desk) ======
  const WORK = [
    '..hhhh..',
    '.hhhhhh.',
    '.Hssss..',
    '.sweswe.',
    '.bssssb.',
    '..smms..',
    '...ss...',
    '.oooooo.',
    'soooooos',
    'OooooooO',
    '.pppppp.',
    '.pPppPp.',
  ];
  const WORK_BLINK = [
    '..hhhh..',
    '.hhhhhh.',
    '.Hssss..',
    '.sessse.',
    '.bssssb.',
    '..smms..',
    '...ss...',
    '.oooooo.',
    'soooooos',
    'OooooooO',
    '.pppppp.',
    '.pPppPp.',
  ];

  function drawWorking(ctx, sx, state, frame, tick, hc) {
    const map = makeMap(hc.o, hc.O);
    const gy = Scene.GROUND_Y;
    const cx = sx + 5;
    const cy = gy - 13;
    const blink = frame === 1;
    drawSprite(ctx, cx, cy, blink ? WORK_BLINK : WORK, map);

    const af = frame % 2;
    px(ctx, cx, cy + 8 + af, P.skin);
    px(ctx, cx + 7, cy + 8 + af, P.skin);

    const mx = sx + 14, my = gy - 6;
    switch (state) {
      case 'thinking':
        px(ctx, cx + 9, cy, '#DDD');
        px(ctx, cx + 10, cy - 1, '#EEE');
        rect(ctx, cx + 9, cy - 4, 4, 2, '#FFF');
        px(ctx, cx + 10, cy - 3, '#888');
        px(ctx, cx + 11, cy - 4, '#888');
        break;
      case 'writing':
        px(ctx, mx, my, '#88CCFF'); px(ctx, mx + 1, my, '#AAE0AA');
        if (af === 0) px(ctx, mx + 2, my + 1, '#FFF');
        break;
      case 'reading':
        px(ctx, cx + 9, cy + 1 + af, '#6CA6CD');
        px(ctx, cx + 10, cy + 1 + af, '#6CA6CD');
        px(ctx, cx + 10, cy + 3 + af, '#8B7355');
        break;
      case 'bash':
        px(ctx, mx, my, '#0F0'); px(ctx, mx + 1, my, '#0F0');
        if (af === 0) px(ctx, mx + 2, my, '#0F0');
        break;
      case 'browsing':
        px(ctx, mx, my, '#4A90D9'); px(ctx, mx + 1, my, '#6AB04C');
        px(ctx, mx + 2, my, '#4A90D9');
        break;
      case 'tasking':
        // Mini clone in same hoodie color
        px(ctx, cx - 3, cy + 4 + af, P.hair);
        px(ctx, cx - 2, cy + 4 + af, P.hair);
        px(ctx, cx - 3, cy + 5 + af, hc.o);
        px(ctx, cx - 2, cy + 5 + af, hc.o);
        if (frame % 3 === 0) px(ctx, cx - 1, cy + 4, '#FFD700');
        break;
    }
  }

  // ====== Idle pose (sitting on bench) ======
  const IDLE = [
    '..hhhh..',
    '.hhhhhh.',
    '.Hssss..',
    '.sweswe.',
    '.bssssb.',
    '..smms..',
    '...ss...',
    '.oooooo.',
    'soooooos',
    'soooooos',
    '.pppppp.',
    '.pp..pp.',
    '.xx..xx.',
  ];
  const IDLE_BLINK = [
    '..hhhh..',
    '.hhhhhh.',
    '.Hssss..',
    '.sessse.',
    '.bssssb.',
    '..sSS...',
    '...ss...',
    '.oooooo.',
    'soooooos',
    'soooooos',
    '.pppppp.',
    '.pp..pp.',
    '.xx..xx.',
  ];

  function drawIdle(ctx, sx, frame, tick, hc) {
    const map = makeMap(hc.o, hc.O);
    const gy = Scene.GROUND_Y;
    const cx = sx + 6;
    const cy = gy - 12;
    const blink = (tick % 240) > 230;
    drawSprite(ctx, cx, cy, blink ? IDLE_BLINK : IDLE, map);

    const phase = (tick / 120 | 0) % 4;
    if (phase < 2) {
      px(ctx, cx - 1, cy + 7, P.skin);
      rect(ctx, cx - 3, cy + 6, 3, 3, '#F0E8D8');
      px(ctx, cx - 3, cy + 7, '#BBB');
      px(ctx, cx - 2, cy + 8, '#CCC');
    } else if (phase === 2) {
      px(ctx, cx, cy + 8, P.skin);
      px(ctx, cx + 7, cy + 8, P.skin);
    } else {
      px(ctx, cx + 8, cy + 2, P.skin);
      px(ctx, cx, cy + 8, P.skin);
    }
  }

  // ====== Sleeping pose (lying on ground with colored blanket) ======

  function drawSleeping(ctx, sx, frame, tick, hc) {
    const gy = Scene.GROUND_Y;
    const cx = sx + 14;
    const cy = gy - 2;
    const breathe = (tick / 45 | 0) % 2;

    // Head on pillow
    px(ctx, cx, cy - 2, P.hair); px(ctx, cx + 1, cy - 2, P.hair);
    px(ctx, cx + 2, cy - 2, P.hair); px(ctx, cx + 2, cy - 3, P.hair);
    px(ctx, cx - 1, cy - 1, P.skin); px(ctx, cx, cy - 1, P.skin);
    px(ctx, cx + 1, cy - 1, P.skin); px(ctx, cx + 2, cy - 1, P.skin);
    px(ctx, cx, cy, P.skin); px(ctx, cx + 1, cy, P.skin);
    px(ctx, cx, cy - 1, P.eye);
    px(ctx, cx, cy, P.blush);
    px(ctx, cx + 1, cy, P.mouth);
    // Shoulder in hoodie color
    px(ctx, cx - 2, cy - 1, hc.o);
    px(ctx, cx - 2, cy, hc.o);

    // Blanket in hoodie color (so you can tell who's sleeping)
    rect(ctx, sx + 3, cy + breathe, 10, 2, hc.o);
    rect(ctx, sx + 3, cy + breathe, 10, 1, hc.O);

    // ZZZ
    const zp = (tick / 25 | 0) % 6;
    if (zp < 5) { px(ctx, cx + 4, cy - 4, '#8888CC'); px(ctx, cx + 5, cy - 4, '#8888CC'); px(ctx, cx + 5, cy - 3, '#8888CC'); px(ctx, cx + 4, cy - 2, '#8888CC'); }
    if (zp < 3) { px(ctx, cx + 6, cy - 6, '#9999DD'); px(ctx, cx + 7, cy - 6, '#9999DD'); }
    if (zp < 1) { px(ctx, cx + 7, cy - 8, '#AAAAEE'); }
  }

  // ====== Public API ======

  // ====== Celebrating pose (standing, arms up, particles) ======

  const CELEBRATE = [
    '..hhhh..',
    '.hhhhhh.',
    '.Hssss..',
    '.sweswe.',
    '.bssssb.',
    '..smms..',
    '...ss...',
    '.oooooo.',
    'soooooos',
    'OooooooO',
    '.pppppp.',
    '.pp..pp.',
    '.xx..xx.',
  ];

  function drawCelebrating(ctx, sx, frame, tick, hc) {
    const map = makeMap(hc.o, hc.O);
    const gy = Scene.GROUND_Y;
    const cx = sx + 6;
    const cy = gy - 12;
    drawSprite(ctx, cx, cy, CELEBRATE, map);

    // Arms raised!
    const wave = ((tick / 6) | 0) % 2;
    px(ctx, cx - 1, cy + 6 - wave, P.skin);
    px(ctx, cx - 1, cy + 5 - wave, P.skin);
    px(ctx, cx + 8, cy + 6 - wave, P.skin);
    px(ctx, cx + 8, cy + 5 - wave, P.skin);

    // Mini confetti particles around the character
    const colors = ['#FFD700', '#FF6B8A', '#4A90D9', '#6AB04C', '#DA70D6'];
    for (let i = 0; i < 4; i++) {
      const px_x = cx + Math.sin(tick * 0.15 + i * 1.8) * 6;
      const px_y = cy - 2 + Math.cos(tick * 0.12 + i * 2.3) * 4;
      px(ctx, Math.round(px_x), Math.round(px_y), colors[i % colors.length]);
    }
  }

  // ====== Public API ======

  function draw(ctx, slotX, state, frame, tick, colorIndex) {
    const hc = getHoodie(colorIndex || 0);
    if (state === 'sleeping') drawSleeping(ctx, slotX, frame, tick, hc);
    else if (state === 'celebrating') drawCelebrating(ctx, slotX, frame, tick, hc);
    else if (state === 'idle') drawIdle(ctx, slotX, frame, tick, hc);
    else drawWorking(ctx, slotX, state, frame, tick, hc);
  }

  return { draw, PX, HOODIE_COLORS };
})();
