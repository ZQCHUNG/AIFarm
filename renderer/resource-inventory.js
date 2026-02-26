/**
 * resource-inventory.js — Multi-resource inventory for AIFarm 3.0.
 *
 * Manages WOOD, STONE, GOLD, and individual crop harvests.
 * Listens to EventBus for CROP_HARVESTED / TREE_CHOPPED / ROCK_MINED events.
 * State is synced from main process via IPC (persisted in farm-state.json).
 */

const ResourceInventory = (() => {
  // Resource types
  const TYPES = {
    WOOD:   'wood',
    STONE:  'stone',
    GOLD:   'gold',
    // Crop resources are stored by crop id: 'carrot', 'tomato', etc.
  };

  // Sell prices (resources → GOLD via shipping bin)
  const SELL_PRICES = {
    wood:       2,
    stone:      3,
    carrot:     5,
    sunflower:  8,
    watermelon: 15,
    tomato:     7,
    corn:       10,
    pumpkin:    12,
    flour:      18,
    plank:      8,
    feed:       5,
    fish:       12,
  };

  // Current inventory state
  let inventory = {};

  // Change animation queue (for HUD bounce effects)
  let changeQueue = []; // { resource, delta, timestamp }

  function init(savedState) {
    inventory = savedState || {};
    // Ensure defaults
    if (!inventory.wood) inventory.wood = 0;
    if (!inventory.stone) inventory.stone = 0;
    if (!inventory.gold) inventory.gold = 0;
  }

  function get(resource) {
    return inventory[resource] || 0;
  }

  function add(resource, amount) {
    if (!amount || amount <= 0) return;
    inventory[resource] = (inventory[resource] || 0) + amount;
    changeQueue.push({ resource, delta: amount, timestamp: Date.now() });
    if (typeof EventBus !== 'undefined') {
      EventBus.emit('RESOURCE_CHANGED', { resource, amount: inventory[resource], delta: amount });
    }
  }

  function spend(resource, amount) {
    if (!amount || amount <= 0) return false;
    const current = inventory[resource] || 0;
    if (current < amount) return false;
    inventory[resource] = current - amount;
    changeQueue.push({ resource, delta: -amount, timestamp: Date.now() });
    if (typeof EventBus !== 'undefined') {
      EventBus.emit('RESOURCE_CHANGED', { resource, amount: inventory[resource], delta: -amount });
    }
    return true;
  }

  function has(resource, amount) {
    return (inventory[resource] || 0) >= amount;
  }

  /** Sell a resource for GOLD via the shipping bin. Uses dynamic market pricing if available. */
  function sell(resource, quantity) {
    // Use dynamic market price if MarketEconomy is loaded, otherwise static
    const price = (typeof MarketEconomy !== 'undefined')
      ? MarketEconomy.getSellPrice(resource)
      : SELL_PRICES[resource];
    if (!price) return false;
    const qty = quantity || 1;
    if (!spend(resource, qty)) return false;
    add('gold', price * qty);
    if (typeof EventBus !== 'undefined') {
      EventBus.emit('RESOURCE_SOLD', { resource, quantity: qty, goldEarned: price * qty });
    }
    return true;
  }

  /** Get all inventory data for persistence / HUD. */
  function getState() {
    return { ...inventory };
  }

  /** Pop pending change animations (consumed by HUD renderer). */
  function popChanges() {
    const changes = changeQueue.splice(0);
    return changes;
  }

  /** Get display-friendly list of non-zero resources. */
  function getSummary() {
    const result = [];
    // Show core resources first, then crops
    const order = ['gold', 'wood', 'stone', 'flour', 'plank', 'feed', 'fish'];
    for (const key of order) {
      if (inventory[key] > 0) result.push({ id: key, amount: inventory[key] });
    }
    // Crop resources
    for (const [key, val] of Object.entries(inventory)) {
      if (!order.includes(key) && val > 0) {
        result.push({ id: key, amount: val });
      }
    }
    return result;
  }

  // ===== EventBus listeners (set up once) =====
  function setupListeners() {
    if (typeof EventBus === 'undefined') return;

    EventBus.on('CROP_HARVESTED', (data) => {
      const cropId = data.crop || 'carrot';
      add(cropId, data.amount || 1);
    });

    EventBus.on('TREE_CHOPPED', (data) => {
      add('wood', data.amount || 2);
    });

    EventBus.on('ROCK_MINED', (data) => {
      add('stone', data.amount || 1);
    });
  }

  return {
    TYPES,
    SELL_PRICES,
    init,
    get,
    add,
    spend,
    has,
    sell,
    getState,
    popChanges,
    getSummary,
    setupListeners,
  };
})();

if (typeof module !== 'undefined') module.exports = ResourceInventory;
