/**
 * trade-diplomacy.js — Cross-Project Trade & Diplomacy (TBD Backlog P4).
 *
 * Simulates trade relationships with virtual AI villages:
 *   - 3 neighboring villages with different specialties
 *   - Trade routes: exchange resources at varying rates
 *   - Diplomacy levels: trade, ally, rival (affects prices)
 *   - Trade events: caravans arrive periodically
 *
 * Accessed via [T] key when near the trade post.
 * Persisted via farm-state.
 */
const TradeDiplomacy = (() => {
  // Virtual villages
  const VILLAGES = {
    ironforge: {
      name: 'Ironforge',
      emoji: '\u{2692}\u{FE0F}',
      specialty: 'stone',
      wants: ['wheat', 'corn', 'fish'],
      baseRate: { stone: 0.5, wood: 1.2, gold: 1.5 },
      personality: 'industrial',
    },
    greenhollow: {
      name: 'Greenhollow',
      emoji: '\u{1F33F}',
      specialty: 'wood',
      wants: ['stone', 'gold', 'bread'],
      baseRate: { wood: 0.5, stone: 1.3, gold: 1.4 },
      personality: 'pastoral',
    },
    azurebay: {
      name: 'Azurebay',
      emoji: '\u{1F30A}',
      specialty: 'fish',
      wants: ['wood', 'stone', 'carrot'],
      baseRate: { fish: 0.5, gold: 1.1, stone: 1.5 },
      personality: 'maritime',
    },
  };

  const villageKeys = Object.keys(VILLAGES);

  // Diplomacy levels
  const DIPLO_LEVELS = ['rival', 'neutral', 'friendly', 'ally'];
  const DIPLO_RATE_MULT = { rival: 1.5, neutral: 1.0, friendly: 0.85, ally: 0.7 };
  const DIPLO_COLORS = { rival: '#EF5350', neutral: '#AAA', friendly: '#66BB6A', ally: '#FFD700' };

  // Trade resources
  const TRADEABLE = ['wood', 'stone', 'gold', 'wheat', 'corn', 'fish', 'carrot', 'bread'];

  // State
  let diplomacy = { ironforge: 1, greenhollow: 1, azurebay: 1 }; // index into DIPLO_LEVELS
  let tradeHistory = { ironforge: 0, greenhollow: 0, azurebay: 0 }; // total trades
  let caravanTimer = 0;
  const CARAVAN_INTERVAL = 7200; // ~2 min

  // UI
  let menuOpen = false;
  let selectedVillage = 0;
  let selectedResource = 0;
  let tradeAmount = 10;
  let initialized = false;

  // ===== Init =====

  function init(savedState) {
    if (savedState) {
      diplomacy = savedState.diplomacy || { ironforge: 1, greenhollow: 1, azurebay: 1 };
      tradeHistory = savedState.tradeHistory || { ironforge: 0, greenhollow: 0, azurebay: 0 };
    }
    initialized = true;
  }

  function setupListeners() {
    if (typeof EventBus === 'undefined') return;

    // Trading improves diplomacy
    EventBus.on('TRADE_COMPLETE', (data) => {
      if (data && data.village) {
        tradeHistory[data.village] = (tradeHistory[data.village] || 0) + 1;
        // Every 10 trades, improve diplomacy
        if (tradeHistory[data.village] % 10 === 0) {
          improveDiplomacy(data.village);
        }
      }
    });
  }

  // ===== Diplomacy =====

  function improveDiplomacy(village) {
    const current = diplomacy[village] || 1;
    if (current < DIPLO_LEVELS.length - 1) {
      diplomacy[village] = current + 1;
      const level = DIPLO_LEVELS[diplomacy[village]];

      if (typeof IsoEffects !== 'undefined') {
        const pp = (typeof Player !== 'undefined') ? Player.getPosition() : { x: 10, y: 10 };
        IsoEffects.spawnText(pp.x, pp.y - 1.5,
          `\u{1F91D} ${VILLAGES[village].name}: ${level}!`,
          { color: DIPLO_COLORS[level], life: 90, rise: 0.2 });
      }
    }
  }

  function getDiploLevel(village) {
    return DIPLO_LEVELS[diplomacy[village] || 1];
  }

  // ===== Trading =====

  function getExchangeRate(village, resource) {
    const v = VILLAGES[village];
    if (!v) return 1;
    const baseRate = v.baseRate[resource] || 1.0;
    const diploMult = DIPLO_RATE_MULT[getDiploLevel(village)];
    // Wanted items get better rates
    const wantBonus = v.wants.includes(resource) ? 0.8 : 1.0;
    return baseRate * diploMult * wantBonus;
  }

  function executeTrade(village, resource, amount) {
    if (typeof ResourceInventory === 'undefined') return false;

    const available = ResourceInventory.getResource(resource) || 0;
    const actual = Math.min(amount, available);
    if (actual <= 0) return false;

    const rate = getExchangeRate(village, resource);
    const goldReceived = Math.floor(actual / rate);
    if (goldReceived <= 0) return false;

    ResourceInventory.addResource(resource, -actual);
    ResourceInventory.addResource('gold', goldReceived);

    tradeHistory[village] = (tradeHistory[village] || 0) + 1;

    // Check diplomacy improvement
    if (tradeHistory[village] % 10 === 0) {
      improveDiplomacy(village);
    }

    if (typeof EventBus !== 'undefined') {
      EventBus.emit('TRADE_COMPLETE', { village, resource, amount: actual, gold: goldReceived });
    }

    if (typeof IsoEffects !== 'undefined') {
      const pp = (typeof Player !== 'undefined') ? Player.getPosition() : { x: 10, y: 10 };
      IsoEffects.spawnText(pp.x, pp.y - 1,
        `+${goldReceived}g from ${VILLAGES[village].emoji}`,
        { color: '#FFD700', life: 50, rise: 0.3 });
    }

    return true;
  }

  // ===== Caravan Events =====

  function update(tick) {
    caravanTimer++;
    if (caravanTimer >= CARAVAN_INTERVAL) {
      caravanTimer = 0;
      spawnCaravan();
    }
  }

  function spawnCaravan() {
    const village = villageKeys[Math.floor(Math.random() * villageKeys.length)];
    const v = VILLAGES[village];

    if (typeof IsoEffects !== 'undefined') {
      const pp = (typeof Player !== 'undefined') ? Player.getPosition() : { x: 10, y: 10 };
      IsoEffects.spawnText(pp.x, pp.y - 2,
        `${v.emoji} Caravan from ${v.name}!`,
        { color: '#FFD700', life: 120, rise: 0.15 });
    }

    // Caravan bonus: gift some of their specialty
    if (typeof ResourceInventory !== 'undefined') {
      const giftAmount = Math.floor(3 + Math.random() * 5);
      ResourceInventory.addResource(v.specialty, giftAmount);

      if (typeof IsoEffects !== 'undefined') {
        const pp = (typeof Player !== 'undefined') ? Player.getPosition() : { x: 10, y: 10 };
        IsoEffects.spawnText(pp.x, pp.y - 1,
          `+${giftAmount} ${v.specialty}`,
          { color: '#66BB6A', life: 60, rise: 0.3 });
      }
    }
  }

  // ===== UI =====

  function toggle() { menuOpen = !menuOpen; selectedVillage = 0; selectedResource = 0; tradeAmount = 10; }
  function isOpen() { return menuOpen; }

  function handleKey(key) {
    if (!menuOpen) return false;

    if (key === 'Escape' || key === 't' || key === 'T') { menuOpen = false; return true; }

    // Village selection
    if (key === 'ArrowLeft' || key === 'a' || key === 'A') {
      selectedVillage = (selectedVillage - 1 + villageKeys.length) % villageKeys.length;
      return true;
    }
    if (key === 'ArrowRight' || key === 'd' || key === 'D') {
      selectedVillage = (selectedVillage + 1) % villageKeys.length;
      return true;
    }

    // Resource selection
    if (key === 'ArrowUp' || key === 'w' || key === 'W') {
      selectedResource = (selectedResource - 1 + TRADEABLE.length) % TRADEABLE.length;
      return true;
    }
    if (key === 'ArrowDown' || key === 's' || key === 'S') {
      selectedResource = (selectedResource + 1) % TRADEABLE.length;
      return true;
    }

    // Amount adjustment
    if (key === 'q' || key === 'Q') { tradeAmount = Math.max(1, tradeAmount - 5); return true; }
    if (key === 'e' || key === 'E') { tradeAmount += 5; return true; }

    // Execute trade
    if (key === 'Enter') {
      executeTrade(villageKeys[selectedVillage], TRADEABLE[selectedResource], tradeAmount);
      return true;
    }

    return false;
  }

  function draw(ctx, canvasW, canvasH, tick) {
    if (!menuOpen) return;

    ctx.save();

    // Panel
    const pw = 220;
    const ph = 180;
    const px = (canvasW - pw) / 2;
    const py = (canvasH - ph) / 2;

    ctx.fillStyle = 'rgba(20, 15, 10, 0.93)';
    ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(px, py, pw, ph);

    // Title
    ctx.font = 'bold 9px monospace';
    ctx.fillStyle = '#FFD700';
    ctx.textAlign = 'center';
    ctx.fillText('\u{1F91D} TRADE & DIPLOMACY', px + pw / 2, py + 14);

    // Village tabs
    let tabX = px + 10;
    for (let i = 0; i < villageKeys.length; i++) {
      const key = villageKeys[i];
      const v = VILLAGES[key];
      const isSel = i === selectedVillage;

      ctx.font = isSel ? 'bold 8px monospace' : '7px monospace';
      ctx.fillStyle = isSel ? '#FFD700' : '#888';
      ctx.textAlign = 'center';

      const tabW = pw / 3;
      if (isSel) {
        ctx.fillStyle = 'rgba(255, 215, 0, 0.1)';
        ctx.fillRect(px + i * tabW, py + 20, tabW, 16);
      }

      ctx.fillStyle = isSel ? '#FFD700' : '#888';
      ctx.fillText(`${v.emoji} ${v.name}`, px + i * tabW + tabW / 2, py + 31);
    }

    // Selected village info
    const vKey = villageKeys[selectedVillage];
    const village = VILLAGES[vKey];
    const diploLevel = getDiploLevel(vKey);

    ctx.textAlign = 'left';
    ctx.font = '7px monospace';
    ctx.fillStyle = DIPLO_COLORS[diploLevel];
    ctx.fillText(`Diplomacy: ${diploLevel.toUpperCase()}`, px + 8, py + 50);
    ctx.fillStyle = '#888';
    ctx.fillText(`Trades: ${tradeHistory[vKey] || 0}  Specialty: ${village.specialty}`, px + 8, py + 62);

    // Resource list
    ctx.fillStyle = '#4FC3F7';
    ctx.font = 'bold 7px monospace';
    ctx.fillText('Resource', px + 8, py + 78);
    ctx.fillText('Rate', px + 90, py + 78);
    ctx.fillText('Have', px + 130, py + 78);

    let ry = py + 90;
    const visibleResources = 5;
    const startR = Math.max(0, selectedResource - Math.floor(visibleResources / 2));

    for (let i = startR; i < Math.min(startR + visibleResources, TRADEABLE.length); i++) {
      const res = TRADEABLE[i];
      const rate = getExchangeRate(vKey, res);
      const have = (typeof ResourceInventory !== 'undefined') ? (ResourceInventory.getResource(res) || 0) : 0;
      const isSel = i === selectedResource;

      if (isSel) {
        ctx.fillStyle = 'rgba(79, 195, 247, 0.15)';
        ctx.fillRect(px + 4, ry - 4, pw - 8, 12);
      }

      ctx.font = '7px monospace';
      ctx.fillStyle = isSel ? '#4FC3F7' : '#AAA';
      ctx.fillText(res, px + 8, ry + 4);

      // Rate (lower = better)
      ctx.fillStyle = rate < 1 ? '#66BB6A' : rate > 1.2 ? '#FF6666' : '#FFF';
      ctx.fillText(rate.toFixed(2), px + 90, ry + 4);

      ctx.fillStyle = '#888';
      ctx.fillText(String(have), px + 130, ry + 4);

      ry += 14;
    }

    // Trade amount & execute
    ctx.font = '7px monospace';
    ctx.fillStyle = '#FFF';
    ctx.fillText(`Trade: ${tradeAmount}x ${TRADEABLE[selectedResource]}`, px + 8, py + ph - 30);

    const expectedGold = Math.floor(tradeAmount / getExchangeRate(vKey, TRADEABLE[selectedResource]));
    ctx.fillStyle = '#FFD700';
    ctx.fillText(`\u{2192} ${expectedGold}g`, px + 130, py + ph - 30);

    // Controls
    ctx.font = '6px monospace';
    ctx.fillStyle = '#666';
    ctx.textAlign = 'center';
    ctx.fillText('[A/D] Village  [W/S] Resource  [Q/E] Amount  [Enter] Trade  [T/ESC] Exit',
      px + pw / 2, py + ph - 6);

    ctx.restore();
  }

  // ===== Persistence =====

  function getState() {
    return { diplomacy, tradeHistory };
  }

  return {
    init,
    setupListeners,
    update,
    toggle,
    isOpen,
    handleKey,
    draw,
    getState,
    executeTrade,
    getDiploLevel,
  };
})();
