/**
 * global-balance.js — Global Economy & Speed Balance Pass (Sprint 30 P1).
 *
 * Final tuning layer for long-term gameplay:
 *   - Player movement speed boost for large worlds (256x256 comfort)
 *   - Market economy reversion speed calibration
 *   - Crop tier value rebalancing (low-tier crops stay relevant)
 *   - Stamina consumption tuning
 *
 * This module applies balance patches on init, modifying existing
 * system constants through their public APIs where possible.
 */
const GlobalBalance = (() => {
  let applied = false;

  // ===== Balance Constants =====

  // Movement: 256x256 world needs faster base speed
  const SPEED_BOOST = 1.15; // +15% walk/sprint speed for big world traversal

  // Economy: slow down mean-reversion so price swings feel meaningful longer
  const MARKET_THETA_OVERRIDE = 0.035; // was 0.05, slower snap-back
  const MARKET_SIGMA_OVERRIDE = 0.04;  // was 0.03, slightly more volatile

  // Crop value tiers (multiplier applied to base sell price)
  // Ensures low-tier crops aren't completely obsolete
  const CROP_VALUE_BALANCE = {
    carrot:     1.2,  // +20% (early game staple)
    sunflower:  1.15, // +15%
    watermelon: 1.0,  // baseline
    tomato:     1.0,  // baseline
    corn:       0.95, // slight nerf (too abundant)
    pumpkin:    1.1,  // +10% (seasonal premium)
    strawberry: 1.25, // +25% (rare seed purchase)
    wheat:      1.3,  // +30% (processing chain value)
  };

  // Stamina: slightly more generous for exploration
  const STAMINA_DRAIN_MULT = 0.85; // -15% drain rate

  // ===== Apply =====

  function apply() {
    if (applied) return;
    applied = true;

    applySpeedBoost();
    applyMarketTuning();
    applyCropBalance();
    applyStaminaTuning();

    console.log('[GlobalBalance] Balance pass applied');
  }

  function applySpeedBoost() {
    // Player speed: boost via speedMod if available
    if (typeof Player !== 'undefined' && Player.setSpeedMod) {
      Player.setSpeedMod(SPEED_BOOST);
    }
  }

  function applyMarketTuning() {
    // Market economy: tune volatility if setParams exists
    if (typeof MarketEconomy !== 'undefined' && MarketEconomy.setParams) {
      MarketEconomy.setParams({
        theta: MARKET_THETA_OVERRIDE,
        sigma: MARKET_SIGMA_OVERRIDE,
      });
    }
  }

  function applyCropBalance() {
    // Adjust base sell prices through ResourceInventory if available
    if (typeof ResourceInventory !== 'undefined' && ResourceInventory.adjustSellPrice) {
      for (const [crop, mult] of Object.entries(CROP_VALUE_BALANCE)) {
        ResourceInventory.adjustSellPrice(crop, mult);
      }
    }
  }

  function applyStaminaTuning() {
    // Reduce stamina drain rate if Player supports it
    if (typeof Player !== 'undefined' && Player.setStaminaDrainMult) {
      Player.setStaminaDrainMult(STAMINA_DRAIN_MULT);
    }
  }

  // ===== Query balance values =====

  function getSpeedBoost() { return SPEED_BOOST; }
  function getCropMultiplier(crop) { return CROP_VALUE_BALANCE[crop] || 1.0; }
  function isApplied() { return applied; }

  return {
    apply,
    getSpeedBoost,
    getCropMultiplier,
    isApplied,
  };
})();
