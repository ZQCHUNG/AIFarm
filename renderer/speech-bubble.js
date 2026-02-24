/**
 * Speech bubble drawn on canvas above the character.
 */
const SpeechBubble = (() => {
  const PADDING = 4;
  const FONT_SIZE = 11;
  const MAX_WIDTH = 140;
  const TRIANGLE_SIZE = 5;
  const RADIUS = 6;

  /**
   * Draw a speech bubble with text at position (cx, bubbleBottom).
   * cx = horizontal center, bubbleBottom = bottom of bubble (above triangle).
   */
  function draw(ctx, text, cx, bubbleBottom) {
    if (!text) return;

    ctx.font = `${FONT_SIZE}px monospace`;

    // Truncate long text
    let display = text;
    if (ctx.measureText(display).width > MAX_WIDTH - PADDING * 2) {
      while (display.length > 3 && ctx.measureText(display + '...').width > MAX_WIDTH - PADDING * 2) {
        display = display.slice(0, -1);
      }
      display += '...';
    }

    const textWidth = ctx.measureText(display).width;
    const boxW = Math.min(MAX_WIDTH, textWidth + PADDING * 2);
    const boxH = FONT_SIZE + PADDING * 2;
    const boxX = Math.max(0, Math.min(cx - boxW / 2, 200 - boxW));
    const boxY = bubbleBottom - boxH - TRIANGLE_SIZE;

    // Bubble background
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(boxX + RADIUS, boxY);
    ctx.lineTo(boxX + boxW - RADIUS, boxY);
    ctx.arcTo(boxX + boxW, boxY, boxX + boxW, boxY + RADIUS, RADIUS);
    ctx.lineTo(boxX + boxW, boxY + boxH - RADIUS);
    ctx.arcTo(boxX + boxW, boxY + boxH, boxX + boxW - RADIUS, boxY + boxH, RADIUS);
    ctx.lineTo(boxX + RADIUS, boxY + boxH);
    ctx.arcTo(boxX, boxY + boxH, boxX, boxY + boxH - RADIUS, RADIUS);
    ctx.lineTo(boxX, boxY + RADIUS);
    ctx.arcTo(boxX, boxY, boxX + RADIUS, boxY, RADIUS);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Triangle pointer
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.moveTo(cx - TRIANGLE_SIZE, boxY + boxH);
    ctx.lineTo(cx, boxY + boxH + TRIANGLE_SIZE);
    ctx.lineTo(cx + TRIANGLE_SIZE, boxY + boxH);
    ctx.closePath();
    ctx.fill();
    // Triangle border (only the two slanted sides)
    ctx.beginPath();
    ctx.moveTo(cx - TRIANGLE_SIZE, boxY + boxH);
    ctx.lineTo(cx, boxY + boxH + TRIANGLE_SIZE);
    ctx.lineTo(cx + TRIANGLE_SIZE, boxY + boxH);
    ctx.stroke();

    // Text
    ctx.fillStyle = '#333333';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(display, boxX + boxW / 2, boxY + boxH / 2 + 1);
  }

  return { draw };
})();
