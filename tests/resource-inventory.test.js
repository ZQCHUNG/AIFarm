/**
 * resource-inventory.test.js — Unit tests for ResourceInventory
 */
const ResourceInventory = require('../renderer/resource-inventory');

// Mock EventBus as global (ResourceInventory checks typeof EventBus)
global.EventBus = {
  emit: jest.fn(),
  on: jest.fn(),
};

beforeEach(() => {
  ResourceInventory.init({});
  ResourceInventory.popChanges(); // Drain any leftover changes
  jest.clearAllMocks();
});

describe('ResourceInventory', () => {
  describe('init', () => {
    test('initializes with default resources', () => {
      ResourceInventory.init({});
      expect(ResourceInventory.get('wood')).toBe(0);
      expect(ResourceInventory.get('stone')).toBe(0);
      expect(ResourceInventory.get('gold')).toBe(0);
    });

    test('restores saved state', () => {
      ResourceInventory.init({ wood: 50, stone: 30, gold: 100, carrot: 5 });
      expect(ResourceInventory.get('wood')).toBe(50);
      expect(ResourceInventory.get('stone')).toBe(30);
      expect(ResourceInventory.get('gold')).toBe(100);
      expect(ResourceInventory.get('carrot')).toBe(5);
    });
  });

  describe('add', () => {
    test('adds resources', () => {
      ResourceInventory.add('wood', 10);
      expect(ResourceInventory.get('wood')).toBe(10);
    });

    test('accumulates correctly', () => {
      ResourceInventory.add('wood', 10);
      ResourceInventory.add('wood', 5);
      expect(ResourceInventory.get('wood')).toBe(15);
    });

    test('ignores zero amount', () => {
      ResourceInventory.add('wood', 0);
      expect(ResourceInventory.get('wood')).toBe(0);
    });

    test('ignores negative amount', () => {
      ResourceInventory.add('wood', -5);
      expect(ResourceInventory.get('wood')).toBe(0);
    });

    test('emits RESOURCE_CHANGED event', () => {
      ResourceInventory.add('stone', 3);
      expect(global.EventBus.emit).toHaveBeenCalledWith('RESOURCE_CHANGED', {
        resource: 'stone', amount: 3, delta: 3,
      });
    });

    test('tracks changes in queue', () => {
      ResourceInventory.add('wood', 5);
      const changes = ResourceInventory.popChanges();
      expect(changes).toHaveLength(1);
      expect(changes[0].resource).toBe('wood');
      expect(changes[0].delta).toBe(5);
    });
  });

  describe('spend', () => {
    test('spends resources when sufficient', () => {
      ResourceInventory.add('gold', 100);
      const ok = ResourceInventory.spend('gold', 30);
      expect(ok).toBe(true);
      expect(ResourceInventory.get('gold')).toBe(70);
    });

    test('returns false when insufficient', () => {
      ResourceInventory.add('gold', 10);
      const ok = ResourceInventory.spend('gold', 20);
      expect(ok).toBe(false);
      expect(ResourceInventory.get('gold')).toBe(10);
    });

    test('returns false for zero amount', () => {
      ResourceInventory.add('gold', 10);
      expect(ResourceInventory.spend('gold', 0)).toBe(false);
    });

    test('returns false for negative amount', () => {
      ResourceInventory.add('gold', 10);
      expect(ResourceInventory.spend('gold', -5)).toBe(false);
    });

    test('spending unknown resource returns false', () => {
      expect(ResourceInventory.spend('mythril', 1)).toBe(false);
    });
  });

  describe('has', () => {
    test('returns true when sufficient', () => {
      ResourceInventory.add('wood', 10);
      expect(ResourceInventory.has('wood', 5)).toBe(true);
      expect(ResourceInventory.has('wood', 10)).toBe(true);
    });

    test('returns false when insufficient', () => {
      ResourceInventory.add('wood', 3);
      expect(ResourceInventory.has('wood', 5)).toBe(false);
    });

    test('unknown resource returns false', () => {
      expect(ResourceInventory.has('mythril', 1)).toBe(false);
    });
  });

  describe('sell', () => {
    test('sells resource for gold at static price', () => {
      ResourceInventory.add('carrot', 5);
      jest.clearAllMocks(); // Clear events from add
      const ok = ResourceInventory.sell('carrot', 3);
      expect(ok).toBe(true);
      expect(ResourceInventory.get('carrot')).toBe(2);
      expect(ResourceInventory.get('gold')).toBe(15); // 3 * 5g
    });

    test('sell defaults to quantity 1', () => {
      ResourceInventory.add('tomato', 2);
      ResourceInventory.sell('tomato');
      expect(ResourceInventory.get('tomato')).toBe(1);
      expect(ResourceInventory.get('gold')).toBe(7); // 1 * 7g
    });

    test('sell returns false for unknown resource', () => {
      expect(ResourceInventory.sell('mythril', 1)).toBe(false);
    });

    test('sell returns false when insufficient stock', () => {
      ResourceInventory.add('wood', 1);
      expect(ResourceInventory.sell('wood', 5)).toBe(false);
    });

    test('emits RESOURCE_SOLD event', () => {
      ResourceInventory.add('corn', 3);
      jest.clearAllMocks();
      ResourceInventory.sell('corn', 2);
      expect(global.EventBus.emit).toHaveBeenCalledWith('RESOURCE_SOLD', {
        resource: 'corn', quantity: 2, goldEarned: 20,
      });
    });
  });

  describe('getState', () => {
    test('returns shallow copy', () => {
      ResourceInventory.add('wood', 10);
      const state = ResourceInventory.getState();
      state.wood = 999; // Mutate copy
      expect(ResourceInventory.get('wood')).toBe(10); // Original unaffected
    });
  });

  describe('getSummary', () => {
    test('filters zero resources', () => {
      ResourceInventory.init({ wood: 0, stone: 5, gold: 10 });
      const summary = ResourceInventory.getSummary();
      expect(summary.find(s => s.id === 'wood')).toBeUndefined();
      expect(summary.find(s => s.id === 'stone')).toBeDefined();
    });

    test('core resources appear before crops', () => {
      ResourceInventory.init({ carrot: 5, gold: 10, wood: 3 });
      const summary = ResourceInventory.getSummary();
      const ids = summary.map(s => s.id);
      expect(ids.indexOf('gold')).toBeLessThan(ids.indexOf('carrot'));
    });
  });

  describe('popChanges', () => {
    test('drains queue', () => {
      ResourceInventory.add('wood', 5);
      ResourceInventory.add('stone', 3);
      const changes = ResourceInventory.popChanges();
      expect(changes).toHaveLength(2);
      expect(ResourceInventory.popChanges()).toHaveLength(0);
    });
  });
});
