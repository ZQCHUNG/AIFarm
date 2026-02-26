/**
 * market-economy.js — Dynamic floating price economy (Sprint 27 P0).
 *
 * Implements mean-reversion price fluctuation for all tradeable resources:
 *   - Prices drift ±20% around base price via Ornstein-Uhlenbeck process
 *   - Oracle webhook "bull_market" event → +50% all prices for 10 minutes
 *   - Visual ticker board shows red/green arrows for price changes
 *
 * Integrates with ResourceInventory (price lookup) and OracleEffects (events).
 */
const MarketEconomy = (() => {
  // Base prices (copied from ResourceInventory.SELL_PRICES for reference)
  const BASE_PRICES = {
    wood: 2, stone: 3, carrot: 5, sunflower: 8, watermelon: 15,
    tomato: 7, corn: 10, pumpkin: 12, flour: 18, plank: 8, feed: 5, fish: 12,
  };

  // Current price multipliers: { resource: multiplier } (1.0 = base price)
  const multipliers = {};
  // Previous tick multipliers (for arrow direction)
  const prevMultipliers = {};

  // Mean reversion parameters (Ornstein-Uhlenbeck inspired)
  const MEAN = 1.0;        // target multiplier
  const THETA = 0.05;      // reversion speed (higher = faster snap back)
  const SIGMA = 0.03;      // volatility per update
  const MIN_MULT = 0.80;   // floor: -20%
  const MAX_MULT = 1.20;   // ceiling: +20%

  // Bull market state
  let bullMarketTimer = 0;     // ticks remaining
  const BULL_BONUS = 0.50;     // +50% during bull market
  const BULL_DURATION = 36000; // 10 minutes at 60fps

  // Price update interval (once per ~10 seconds at 60fps)
  const UPDATE_INTERVAL = 600;
  let lastUpdateTick = 0;

  // Ticker board entity position (village square area)
  const BOARD_COL = 13;
  const BOARD_ROW = 8;

  // Track which resources are shown on ticker
  const TICKER_RESOURCES = ['carrot', 'sunflower', 'watermelon', 'tomato', 'corn', 'pumpkin', 'wood', 'stone', 'fish'];

  // ===== Initialization =====

  function init() {
    // Start all multipliers at 1.0
    for (const res of Object.keys(BASE_PRICES)) {
      multipliers[res] = 1.0;
      prevMultipliers[res] = 1.0;
    }
  }

  // ===== Price Calculation =====

  /**
   * Get the current dynamic sell price for a resource.
   * This replaces static SELL_PRICES lookups.
   */
  function getSellPrice(resource) {
    const base = BASE_PRICES[resource];
    if (!base) return 0;
    let mult = multipliers[resource] || 1.0;
    if (bullMarketTimer > 0) mult += BULL_BONUS;
    return Math.max(1, Math.round(base * mult));
  }

  /**
   * Get the current multiplier for a resource (for display).
   * Returns value like 1.15 meaning +15% from base.
   */
  function getMultiplier(resource) {
    let mult = multipliers[resource] || 1.0;
    if (bullMarketTimer > 0) mult += BULL_BONUS;
    return mult;
  }

  /**
   * Get price change direction: 'up', 'down', or 'flat'.
   */
  function getTrend(resource) {
    const curr = multipliers[resource] || 1.0;
    const prev = prevMultipliers[resource] || 1.0;
    const diff = curr - prev;
    if (diff > 0.005) return 'up';
    if (diff < -0.005) return 'down';
    return 'flat';
  }

  function isBullMarket() { return bullMarketTimer > 0; }

  // ===== Update =====

  function update(tick) {
    // Bull market countdown
    if (bullMarketTimer > 0) {
      bullMarketTimer--;
      if (bullMarketTimer === 0) {
        if (typeof IsoEffects !== 'undefined') {
          IsoEffects.spawnText(BOARD_COL, BOARD_ROW - 2, 'Bull market ended',
            { color: '#FF6666', life: 90, rise: 0.3 });
        }
      }
    }

    // Periodic price fluctuation
    if (tick - lastUpdateTick >= UPDATE_INTERVAL) {
      lastUpdateTick = tick;
      updatePrices();
    }
  }

  function updatePrices() {
    for (const res of Object.keys(BASE_PRICES)) {
      prevMultipliers[res] = multipliers[res];

      // Ornstein-Uhlenbeck: dx = theta*(mean - x)*dt + sigma*dW
      const x = multipliers[res];
      const drift = THETA * (MEAN - x);
      const noise = SIGMA * (Math.random() * 2 - 1);
      const newX = x + drift + noise;

      multipliers[res] = Math.max(MIN_MULT, Math.min(MAX_MULT, newX));
    }
  }

  // ===== Bull Market Trigger =====

  function triggerBullMarket(message) {
    bullMarketTimer = BULL_DURATION;

    if (typeof IsoEffects !== 'undefined') {
      IsoEffects.spawnText(BOARD_COL, BOARD_ROW - 2,
        '\u{1F4C8} BULL MARKET! +50%',
        { color: '#00E676', life: 150, rise: 0.3 });
    }

    if (typeof AudioManager !== 'undefined') AudioManager.playLevelUp();

    if (typeof Farm !== 'undefined' && Farm.logEvent) {
      Farm.logEvent('\u{1F4C8}', message || 'Bull Market activated! Sell prices +50%!');
    }
  }

  // ===== Ticker Board Drawing =====

  function draw(ctx, tick) {
    if (typeof IsoEngine === 'undefined') return;

    // Convert board position to screen coords
    const sx = IsoEngine.gridToScreenX(BOARD_COL, BOARD_ROW);
    const sy = IsoEngine.gridToScreenY(BOARD_COL, BOARD_ROW);
    if (sx === undefined || sy === undefined) return;

    ctx.save();

    // Board background (wooden sign)
    const bw = 58;
    const bh = 72;
    const bx = sx - bw / 2;
    const by = sy - bh - 8;

    // Wooden post
    ctx.fillStyle = '#6B4226';
    ctx.fillRect(sx - 2, sy - 8, 4, 8);

    // Board frame
    ctx.fillStyle = '#4A2800';
    ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    ctx.fillStyle = '#1A1A2E';
    ctx.fillRect(bx, by, bw, bh);

    // Title bar
    const isBull = bullMarketTimer > 0;
    ctx.fillStyle = isBull ? '#00E676' : '#FFD700';
    ctx.font = 'bold 5px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(isBull ? '\u{1F4C8} BULL MKT' : '\u{1F4CA} MARKET', sx, by + 8);

    // Divider
    ctx.fillStyle = '#333';
    ctx.fillRect(bx + 2, by + 11, bw - 4, 1);

    // Price rows
    ctx.font = '4px monospace';
    ctx.textAlign = 'left';
    let rowY = by + 17;

    for (let i = 0; i < TICKER_RESOURCES.length; i++) {
      const res = TICKER_RESOURCES[i];
      const price = getSellPrice(res);
      const trend = getTrend(res);
      const mult = getMultiplier(res);

      // Resource name (abbreviated)
      ctx.fillStyle = '#AAA';
      ctx.fillText(res.slice(0, 4).toUpperCase(), bx + 3, rowY);

      // Price
      ctx.fillStyle = '#FFF';
      ctx.textAlign = 'right';
      ctx.fillText(`${price}g`, bx + bw - 12, rowY);

      // Trend arrow
      ctx.textAlign = 'center';
      if (trend === 'up') {
        ctx.fillStyle = '#00E676';
        ctx.fillText('\u25B2', bx + bw - 5, rowY);
      } else if (trend === 'down') {
        ctx.fillStyle = '#FF5252';
        ctx.fillText('\u25BC', bx + bw - 5, rowY);
      } else {
        ctx.fillStyle = '#666';
        ctx.fillText('\u25C6', bx + bw - 5, rowY);
      }

      ctx.textAlign = 'left';
      rowY += 7;
    }

    ctx.restore();
  }

  // ===== Event Listeners =====

  function setupListeners() {
    if (typeof EventBus !== 'undefined') {
      // Listen for oracle bull_market events
      EventBus.on('ORACLE_EVENT', (event) => {
        if (event.event === 'bull_market') {
          triggerBullMarket(event.message);
        }
      });
    }
  }

  // Initialize on load
  init();

  return {
    getSellPrice,
    getMultiplier,
    getTrend,
    isBullMarket,
    triggerBullMarket,
    update,
    draw,
    setupListeners,
    init,
    BASE_PRICES,
  };
})();
