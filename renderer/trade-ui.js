/**
 * trade-ui.js — Player-to-player trading system (Sprint 26 P1).
 *
 * Allows trading resources with nearby remote players:
 *   - [T] key near a ghost player opens trade request
 *   - Both players select items to offer
 *   - Both confirm → items swap atomically
 *
 * Trade protocol (via NetworkClient.sendTrade):
 *   trade_request  → { type, targetId }
 *   trade_accept   → { type, targetId }
 *   trade_reject   → { type, targetId }
 *   trade_offer    → { type, targetId, items: {resource: amount} }
 *   trade_confirm  → { type, targetId }
 *   trade_cancel   → { type, targetId }
 */
const TradeUI = (() => {
  // States: 'closed', 'waiting', 'trading', 'confirming'
  let state = 'closed';
  let partnerId = null;
  let partnerName = '';

  // Offers: { resource: amount }
  let myOffer = {};
  let theirOffer = {};
  let myConfirmed = false;
  let theirConfirmed = false;

  // UI animation
  let modalAge = 0;
  let closing = false;
  let closeAge = 0;
  const BOUNCE_DUR = 12;
  const CLOSE_DUR = 6;

  // Resource selection cursor
  let cursorIndex = 0;
  let cursorAmount = 1;

  // Available tradeable resources
  const TRADEABLE = ['wood', 'stone', 'gold', 'carrot', 'sunflower', 'watermelon',
    'pumpkin', 'blueberry', 'strawberry'];

  // Proximity threshold (grid units)
  const TRADE_RANGE = 3;

  // ===== Nearby player detection =====

  function getNearbyPlayer() {
    if (typeof Player === 'undefined' || typeof NetworkClient === 'undefined') return null;
    if (!NetworkClient.isConnected()) return null;

    const pp = Player.getPosition();
    const remotes = NetworkClient.getRemotePlayers();
    let closest = null;
    let closestDist = TRADE_RANGE;

    for (const [id, p] of remotes) {
      const dx = p.x - pp.x;
      const dy = p.y - pp.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < closestDist) {
        closestDist = dist;
        closest = { id, name: p.name, dist };
      }
    }
    return closest;
  }

  // ===== Open/Close =====

  function requestTrade() {
    const nearby = getNearbyPlayer();
    if (!nearby) return false;

    partnerId = nearby.id;
    partnerName = nearby.name;
    state = 'waiting';
    modalAge = 0;
    closing = false;

    NetworkClient.sendTrade({
      type: 'trade_request',
      targetId: partnerId,
    });

    return true;
  }

  function close() {
    if (state === 'closed') return;

    // Notify partner of cancellation
    if (partnerId && state !== 'waiting') {
      NetworkClient.sendTrade({
        type: 'trade_cancel',
        targetId: partnerId,
      });
    }

    closing = true;
    closeAge = 0;
  }

  function forceClose() {
    state = 'closed';
    partnerId = null;
    partnerName = '';
    myOffer = {};
    theirOffer = {};
    myConfirmed = false;
    theirConfirmed = false;
    cursorIndex = 0;
    cursorAmount = 1;
    closing = false;
    modalAge = 0;
  }

  function isOpen() { return state !== 'closed'; }

  // ===== Message handling =====

  function onTradeMessage(msg) {
    switch (msg.type) {
      case 'trade_request':
        // Someone wants to trade with us
        if (state !== 'closed') break; // busy
        partnerId = msg.fromId;
        partnerName = msg.fromName || 'Player';
        state = 'trading';
        modalAge = 0;
        closing = false;
        myOffer = {};
        theirOffer = {};
        myConfirmed = false;
        theirConfirmed = false;

        // Auto-accept
        NetworkClient.sendTrade({
          type: 'trade_accept',
          targetId: partnerId,
        });

        if (typeof IsoEffects !== 'undefined') {
          IsoEffects.spawnText(
            Player.getPosition().x, Player.getPosition().y - 1.5,
            `${partnerName} wants to trade!`,
            { color: '#5BEF5B', life: 90, rise: 0.3 }
          );
        }
        break;

      case 'trade_accept':
        if (state === 'waiting' && msg.fromId === partnerId) {
          state = 'trading';
          myOffer = {};
          theirOffer = {};
          myConfirmed = false;
          theirConfirmed = false;
        }
        break;

      case 'trade_reject':
        if (msg.fromId === partnerId) {
          if (typeof IsoEffects !== 'undefined') {
            IsoEffects.spawnText(
              Player.getPosition().x, Player.getPosition().y - 1,
              'Trade declined', { color: '#FF6666', life: 60, rise: 0.3 }
            );
          }
          forceClose();
        }
        break;

      case 'trade_offer':
        if (state === 'trading' && msg.fromId === partnerId) {
          theirOffer = msg.items || {};
          theirConfirmed = false; // reset on new offer
          myConfirmed = false;
        }
        break;

      case 'trade_confirm':
        if (msg.fromId === partnerId) {
          theirConfirmed = true;
          // Both confirmed → execute trade
          if (myConfirmed && theirConfirmed) {
            executeTrade();
          }
        }
        break;

      case 'trade_cancel':
        if (msg.fromId === partnerId) {
          if (typeof IsoEffects !== 'undefined') {
            IsoEffects.spawnText(
              Player.getPosition().x, Player.getPosition().y - 1,
              'Trade cancelled', { color: '#FF6666', life: 60, rise: 0.3 }
            );
          }
          forceClose();
        }
        break;
    }
  }

  function executeTrade() {
    if (typeof ResourceInventory === 'undefined') { forceClose(); return; }

    // Remove my offered items
    for (const [res, amt] of Object.entries(myOffer)) {
      if (amt > 0) ResourceInventory.spend(res, amt);
    }

    // Add their offered items
    for (const [res, amt] of Object.entries(theirOffer)) {
      if (amt > 0) ResourceInventory.add(res, amt);
    }

    // Success effect
    if (typeof IsoEffects !== 'undefined') {
      IsoEffects.spawnText(
        Player.getPosition().x, Player.getPosition().y - 1.5,
        'Trade complete!', { color: '#FFD700', life: 90, rise: 0.3 }
      );
    }
    if (typeof AudioManager !== 'undefined') AudioManager.playLevelUp();

    forceClose();
  }

  // ===== Keyboard =====

  function handleKey(key, tick) {
    if (state === 'closed') return false;

    // Escape or T to cancel
    if (key === 'Escape' || key === 't' || key === 'T') {
      close();
      return true;
    }

    if (state === 'waiting') return true; // absorb keys while waiting

    if (state === 'trading') {
      // Up/Down to navigate resources
      if (key === 'ArrowUp' || key === 'w' || key === 'W') {
        cursorIndex = Math.max(0, cursorIndex - 1);
        return true;
      }
      if (key === 'ArrowDown' || key === 's' || key === 'S') {
        cursorIndex = Math.min(TRADEABLE.length - 1, cursorIndex + 1);
        return true;
      }
      // Right/Left to adjust amount
      if (key === 'ArrowRight' || key === 'd' || key === 'D') {
        const res = TRADEABLE[cursorIndex];
        const have = (typeof ResourceInventory !== 'undefined') ? ResourceInventory.get(res) : 0;
        const current = myOffer[res] || 0;
        if (current < have) {
          myOffer[res] = current + 1;
          sendOffer();
        }
        return true;
      }
      if (key === 'ArrowLeft' || key === 'a' || key === 'A') {
        const res = TRADEABLE[cursorIndex];
        const current = myOffer[res] || 0;
        if (current > 0) {
          myOffer[res] = current - 1;
          if (myOffer[res] === 0) delete myOffer[res];
          sendOffer();
        }
        return true;
      }
      // Enter to confirm
      if (key === 'Enter') {
        myConfirmed = true;
        NetworkClient.sendTrade({
          type: 'trade_confirm',
          targetId: partnerId,
        });
        if (theirConfirmed) {
          executeTrade();
        }
        return true;
      }
    }

    return true; // absorb all keys when modal is open
  }

  function sendOffer() {
    myConfirmed = false;
    theirConfirmed = false;
    NetworkClient.sendTrade({
      type: 'trade_offer',
      targetId: partnerId,
      items: { ...myOffer },
    });
  }

  // ===== Update & Draw =====

  function update() {
    if (state === 'closed') return;
    if (closing) {
      closeAge++;
      if (closeAge >= CLOSE_DUR) forceClose();
    } else {
      modalAge++;
    }
  }

  function draw(ctx, canvasW, canvasH, tick) {
    if (state === 'closed') return;

    // Animation scale/alpha
    let scale = 1, alpha = 1;
    if (closing) {
      const t = closeAge / CLOSE_DUR;
      scale = 1 - t * 0.3;
      alpha = 1 - t;
    } else if (modalAge < BOUNCE_DUR) {
      const t = modalAge / BOUNCE_DUR;
      scale = t < 0.7 ? t / 0.7 * 1.1 : 1.1 - (t - 0.7) / 0.3 * 0.1;
      alpha = Math.min(1, t * 2);
    }

    const panelW = Math.min(260, canvasW - 30);
    const panelH = state === 'waiting' ? 60 : 200;
    const px = (canvasW - panelW) / 2;
    const py = (canvasH - panelH) / 2;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Center-scale transform
    ctx.translate(canvasW / 2, canvasH / 2);
    ctx.scale(scale, scale);
    ctx.translate(-canvasW / 2, -canvasH / 2);

    // Dim background
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Wood frame
    drawWoodFrame(ctx, px, py, panelW, panelH);

    const MARGIN = 10;
    const LEFT = px + MARGIN;
    let y = py + 8;

    if (state === 'waiting') {
      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = '#4A2800';
      ctx.textAlign = 'center';
      ctx.fillText(`Waiting for ${partnerName}...`, canvasW / 2, y + 14);
      const dots = '.'.repeat((Math.floor(tick / 20) % 3) + 1);
      ctx.font = '9px monospace';
      ctx.fillText(dots, canvasW / 2, y + 30);
    } else if (state === 'trading') {
      // Title
      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = '#4A2800';
      ctx.textAlign = 'center';
      ctx.fillText(`Trade with ${partnerName}`, canvasW / 2, y + 10);
      y += 22;

      // Divider
      ctx.fillStyle = '#8B5A2B';
      ctx.fillRect(LEFT, y, panelW - MARGIN * 2, 1);
      y += 6;

      // Two columns: My Offer | Their Offer
      const colW = (panelW - MARGIN * 3) / 2;
      const col1 = LEFT;
      const col2 = LEFT + colW + MARGIN;

      // Column headers
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#2E7D32';
      ctx.fillText('My Offer', col1 + colW / 2, y + 8);
      ctx.fillStyle = '#1565C0';
      ctx.fillText(`${partnerName}'s Offer`, col2 + colW / 2, y + 8);
      y += 14;

      // Resource list (my side — interactive)
      ctx.font = '7px monospace';
      ctx.textAlign = 'left';

      const visibleCount = Math.min(TRADEABLE.length, 7);
      const scrollStart = Math.max(0, cursorIndex - 3);

      for (let i = 0; i < visibleCount; i++) {
        const ri = scrollStart + i;
        if (ri >= TRADEABLE.length) break;
        const res = TRADEABLE[ri];
        const have = (typeof ResourceInventory !== 'undefined') ? ResourceInventory.get(res) : 0;
        const offering = myOffer[res] || 0;

        // Highlight cursor row
        if (ri === cursorIndex) {
          ctx.fillStyle = 'rgba(139,90,43,0.2)';
          ctx.fillRect(col1 - 2, y - 1, colW + 4, 12);
          ctx.fillStyle = '#4A2800';
          ctx.fillText('\u25B6', col1, y + 8);
        }

        // Resource name + amount
        ctx.fillStyle = offering > 0 ? '#2E7D32' : '#4A2800';
        const label = `${res.slice(0, 6).padEnd(7)} ${offering}/${have}`;
        ctx.fillText(label, col1 + 8, y + 8);

        y += 12;
      }

      // Their offer column
      let ty = py + 22 + 6 + 14;
      ctx.textAlign = 'left';
      const theirItems = Object.entries(theirOffer).filter(([, a]) => a > 0);
      if (theirItems.length === 0) {
        ctx.fillStyle = '#888';
        ctx.fillText('(nothing yet)', col2 + 4, ty + 8);
      } else {
        for (const [res, amt] of theirItems) {
          ctx.fillStyle = '#1565C0';
          ctx.fillText(`${res.slice(0, 8)}: ${amt}`, col2 + 4, ty + 8);
          ty += 12;
        }
      }

      // Confirm status bar
      const barY = py + panelH - 28;
      ctx.fillStyle = '#8B5A2B';
      ctx.fillRect(LEFT, barY, panelW - MARGIN * 2, 1);

      ctx.font = '8px monospace';
      ctx.textAlign = 'center';

      if (myConfirmed && theirConfirmed) {
        ctx.fillStyle = '#FFD700';
        ctx.fillText('Both confirmed! Trading...', canvasW / 2, barY + 14);
      } else if (myConfirmed) {
        ctx.fillStyle = '#2E7D32';
        ctx.fillText('You confirmed. Waiting...', canvasW / 2, barY + 14);
      } else {
        ctx.fillStyle = '#4A2800';
        ctx.fillText('\u2190\u2192 adjust  Enter=confirm  Esc=cancel', canvasW / 2, barY + 14);
      }
    }

    ctx.restore();
  }

  function drawWoodFrame(ctx, x, y, w, h) {
    // Outer border
    ctx.fillStyle = '#6B4226';
    ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
    // Inner border
    ctx.fillStyle = '#8B5A2B';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    // Parchment background
    ctx.fillStyle = '#F5E6C8';
    ctx.fillRect(x, y, w, h);
    // Corner rivets
    ctx.fillStyle = '#FFD700';
    const r = 2;
    for (const [cx, cy] of [[x + 3, y + 3], [x + w - 3, y + 3], [x + 3, y + h - 3], [x + w - 3, y + h - 3]]) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ===== Proximity prompt =====

  function drawPrompt(ctx, canvasW, canvasH) {
    if (state !== 'closed') return;
    const nearby = getNearbyPlayer();
    if (!nearby) return;

    ctx.save();
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    const text = `[T] Trade with ${nearby.name}`;
    const tw = ctx.measureText(text).width;

    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(canvasW / 2 - tw / 2 - 6, canvasH - 38, tw + 12, 16);
    ctx.fillStyle = '#5BEF5B';
    ctx.fillText(text, canvasW / 2, canvasH - 26);
    ctx.restore();
  }

  // ===== Setup =====

  function setupListeners() {
    if (typeof EventBus !== 'undefined') {
      EventBus.on('TRADE_MESSAGE', onTradeMessage);
    }
  }

  return {
    requestTrade,
    close,
    isOpen,
    handleKey,
    update,
    draw,
    drawPrompt,
    setupListeners,
    getNearbyPlayer,
  };
})();
