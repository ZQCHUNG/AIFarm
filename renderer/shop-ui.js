/**
 * shop-ui.js — General Store / Tool Shed shop for AIFarm 3.0.
 *
 * Player walks to Tool Shed and presses E to open a shop modal.
 * Buy seeds, potions, and farm expansion permits with GOLD.
 */

const ShopUI = (() => {
  // Tool shed position (must match iso-farm.js entity placement)
  const SHOP_COL = 2;
  const SHOP_ROW = 10;

  // Modal state
  let modalOpen = false;
  let modalAge = 0;
  let modalClosing = false;
  let closeAge = 0;
  let selectedIndex = 0;
  let purchaseFlash = null; // { index, startTick }

  const BOUNCE_DURATION = 12;
  const CLOSE_DURATION = 6;

  // Shop catalog
  const CATALOG = [
    {
      id: 'seed_strawberry',
      name: 'Strawberry Seed',
      icon: '\u{1F353}', // 🍓
      price: 20,
      description: 'Sweet summer berry',
      type: 'seed',
    },
    {
      id: 'seed_wheat',
      name: 'Wheat Seed',
      icon: '\u{1F33E}', // 🌾
      price: 15,
      description: 'Staple grain crop',
      type: 'seed',
    },
    {
      id: 'speed_potion',
      name: 'Speed Potion',
      icon: '\u{1F3C3}', // 🏃
      price: 30,
      description: '+50% walk speed (60s)',
      type: 'potion',
    },
    {
      id: 'field_permit',
      name: 'Field Permit',
      icon: '\u{1F4DC}', // 📜
      price: 50,
      description: 'Unlock +2 crop plots',
      type: 'permit',
    },
    {
      id: 'mill_permit',
      name: 'Mill Permit',
      icon: '\u{1F33E}', // 🌾
      price: 80,
      description: 'Corn \u2192 Flour (1.8x)',
      type: 'permit',
    },
    {
      id: 'workshop_permit',
      name: 'Workshop',
      icon: '\u{1FA93}', // 🪓
      price: 120,
      description: 'Wood \u2192 Plank (1.3x)',
      type: 'permit',
    },
  ];

  // ===== Proximity check =====

  let playerNearShop = false;

  function updateProximity() {
    if (typeof Player === 'undefined') { playerNearShop = false; return; }
    const pt = Player.getTile();
    const dx = Math.abs(pt.col - SHOP_COL);
    const dy = Math.abs(pt.row - SHOP_ROW);
    playerNearShop = dx <= 1 && dy <= 1;
  }

  function isNearShop() { return playerNearShop; }

  // ===== Open / Close =====

  function open() {
    if (modalOpen) { close(); return; }
    if (!playerNearShop) return;
    modalOpen = true;
    modalClosing = false;
    modalAge = 0;
    selectedIndex = 0;
    purchaseFlash = null;
  }

  function close() {
    if (!modalOpen) return;
    modalClosing = true;
    closeAge = 0;
  }

  function isOpen() { return modalOpen; }

  // ===== Purchase =====

  function purchase(tick) {
    if (!modalOpen) return false;
    const item = CATALOG[selectedIndex];
    if (!item) return false;
    if (typeof ResourceInventory === 'undefined') return false;

    if (!ResourceInventory.has('gold', item.price)) return false;

    ResourceInventory.spend('gold', item.price);
    purchaseFlash = { index: selectedIndex, startTick: tick };

    // Apply item effect
    if (typeof EventBus !== 'undefined') {
      EventBus.emit('SHOP_PURCHASE', { item: item.id, type: item.type });
    }

    return true;
  }

  // ===== Input handling =====

  function handleKey(key, tick) {
    if (!modalOpen) return false;

    if (key === 'ArrowUp' || key === 'w' || key === 'W') {
      selectedIndex = Math.max(0, selectedIndex - 1);
      return true;
    }
    if (key === 'ArrowDown' || key === 's' || key === 'S') {
      selectedIndex = Math.min(CATALOG.length - 1, selectedIndex + 1);
      return true;
    }
    if (key === 'Enter' || key === ' ') {
      purchase(tick);
      return true;
    }
    if (key === 'Escape' || key === 'e' || key === 'E') {
      close();
      return true;
    }
    return false;
  }

  // ===== Update =====

  function update() {
    updateProximity();

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
      const t = modalAge / BOUNCE_DURATION;
      scale = t < 0.5 ? t * 2 * 1.15 : 1.15 - (t - 0.5) * 2 * 0.15;
    } else {
      scale = 1;
    }
    if (scale <= 0) return;

    const alpha = modalClosing
      ? Math.max(0, 1 - closeAge / CLOSE_DURATION)
      : Math.min(1, modalAge / 6);

    // Background dim
    ctx.save();
    ctx.globalAlpha = alpha * 0.5;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.restore();

    // Panel
    const panelW = Math.min(220, canvasW - 30);
    const panelH = Math.min(200, canvasH - 30);
    const cx = canvasW / 2;
    const cy = canvasH / 2;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);

    const px = Math.floor(cx - panelW / 2);
    const py = Math.floor(cy - panelH / 2);

    // Wood frame
    drawFrame(ctx, px, py, panelW, panelH);

    // Content
    drawContent(ctx, px, py, panelW, panelH, tick);

    ctx.restore();
  }

  function drawFrame(ctx, x, y, w, h) {
    // Outer border
    ctx.fillStyle = '#6B4226';
    roundRect(ctx, x, y, w, h, 4);
    ctx.fill();
    // Inner border
    ctx.fillStyle = '#8B5A2B';
    roundRect(ctx, x + 2, y + 2, w - 4, h - 4, 3);
    ctx.fill();
    // Interior
    ctx.fillStyle = '#F5E6C8';
    roundRect(ctx, x + 4, y + 4, w - 8, h - 8, 2);
    ctx.fill();
  }

  function drawContent(ctx, px, py, pw, ph, tick) {
    const MARGIN = 10;
    const LEFT = px + MARGIN;
    let y = py + MARGIN;

    // Title
    ctx.fillStyle = '#4A2800';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('\u{1F6D2} General Store', px + pw / 2, y);
    y += 16;

    // Gold balance
    const gold = (typeof ResourceInventory !== 'undefined') ? ResourceInventory.get('gold') : 0;
    ctx.font = '8px monospace';
    ctx.fillStyle = '#DAA520';
    ctx.fillText('\u{1FA99} ' + gold + ' gold', px + pw / 2, y);
    y += 14;

    // Separator
    ctx.strokeStyle = '#C8A060';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(LEFT, y);
    ctx.lineTo(px + pw - MARGIN, y);
    ctx.stroke();
    y += 6;

    // Item list
    ctx.textAlign = 'left';
    const itemH = 28;

    for (let i = 0; i < CATALOG.length; i++) {
      const item = CATALOG[i];
      const iy = y + i * itemH;
      const selected = i === selectedIndex;
      const canAfford = gold >= item.price;

      // Selection highlight
      if (selected) {
        ctx.fillStyle = 'rgba(255, 215, 0, 0.2)';
        roundRect(ctx, LEFT, iy - 2, pw - MARGIN * 2, itemH - 2, 2);
        ctx.fill();
        // Arrow indicator
        ctx.fillStyle = '#FFD700';
        ctx.font = '8px monospace';
        ctx.fillText('\u25B6', LEFT + 2, iy + 6); // ▶
      }

      // Purchase flash
      if (purchaseFlash && purchaseFlash.index === i) {
        const elapsed = tick - purchaseFlash.startTick;
        if (elapsed < 20) {
          ctx.fillStyle = `rgba(255, 215, 0, ${0.3 * (1 - elapsed / 20)})`;
          roundRect(ctx, LEFT, iy - 2, pw - MARGIN * 2, itemH - 2, 2);
          ctx.fill();
        } else {
          purchaseFlash = null;
        }
      }

      // Icon + Name
      ctx.font = '9px monospace';
      ctx.fillStyle = canAfford ? '#4A2800' : '#AAA';
      ctx.fillText(item.icon + ' ' + item.name, LEFT + 12, iy + 6);

      // Price
      ctx.font = '7px monospace';
      ctx.fillStyle = canAfford ? '#DAA520' : '#C88';
      ctx.textAlign = 'right';
      ctx.fillText(item.price + 'g', px + pw - MARGIN - 4, iy + 6);
      ctx.textAlign = 'left';

      // Description
      ctx.fillStyle = '#888';
      ctx.font = '7px monospace';
      ctx.fillText(item.description, LEFT + 12, iy + 16);
    }

    // Controls hint
    y = py + ph - MARGIN - 4;
    ctx.textAlign = 'center';
    ctx.font = '7px monospace';
    ctx.fillStyle = '#AAA';
    ctx.fillText('[W/S] Select  [Enter] Buy  [E] Close', px + pw / 2, y);
  }

  // Draw "shop" prompt when player is nearby (called from drawHUD)
  function drawShopPrompt(ctx, canvasW, canvasH) {
    if (!playerNearShop || modalOpen) return;

    const text = 'Press [E] to shop';
    ctx.font = 'bold 9px monospace';
    const tw = ctx.measureText(text).width;
    const px = (canvasW - tw) / 2 - 8;
    const py = canvasH - 42;
    ctx.fillStyle = 'rgba(20, 20, 40, 0.8)';
    roundRect(ctx, px, py, tw + 16, 18, 4);
    ctx.fill();
    ctx.fillStyle = '#5BEF5B';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvasW / 2, py + 9);
  }

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
    SHOP_COL, SHOP_ROW,
    open,
    close,
    isOpen,
    isNearShop,
    handleKey,
    update,
    draw,
    drawShopPrompt,
    purchase,
  };
})();

if (typeof module !== 'undefined') module.exports = ShopUI;
