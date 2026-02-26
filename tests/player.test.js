/**
 * player.test.js — Unit tests for Player module (collision, movement, stamina)
 */
const Player = require('../renderer/player');

// Player.init needs a collision function
const noCollision = () => false; // Nothing is blocked
const wallAt = (bx, by) => (x, y) => {
  // Block a specific tile (32x32 grid)
  const col = Math.floor(x / 32);
  const row = Math.floor(y / 32);
  return col === bx && row === by;
};

beforeEach(() => {
  Player.init(5, 5, { collisionFn: noCollision });
});

describe('Player', () => {
  describe('init', () => {
    test('sets position from tile coordinates', () => {
      Player.init(10, 8, { collisionFn: noCollision });
      const pos = Player.getPosition();
      // World coords = tile * 32 + 16 (center of tile)
      expect(pos.x).toBe(10 * 32 + 16);
      expect(pos.y).toBe(8 * 32 + 16);
    });

    test('getTile returns correct tile', () => {
      Player.init(7, 3, { collisionFn: noCollision });
      const tile = Player.getTile();
      expect(tile.col).toBe(7);
      expect(tile.row).toBe(3);
    });
  });

  describe('movement', () => {
    test('moves right when D pressed', () => {
      const startX = Player.getPosition().x;
      // Run several frames with D key held
      for (let i = 0; i < 10; i++) {
        Player.update({ d: true });
      }
      expect(Player.getPosition().x).toBeGreaterThan(startX);
    });

    test('moves left when A pressed', () => {
      const startX = Player.getPosition().x;
      for (let i = 0; i < 10; i++) {
        Player.update({ a: true });
      }
      expect(Player.getPosition().x).toBeLessThan(startX);
    });

    test('moves up when W pressed', () => {
      const startY = Player.getPosition().y;
      for (let i = 0; i < 10; i++) {
        Player.update({ w: true });
      }
      expect(Player.getPosition().y).toBeLessThan(startY);
    });

    test('moves down when S pressed', () => {
      const startY = Player.getPosition().y;
      for (let i = 0; i < 10; i++) {
        Player.update({ s: true });
      }
      expect(Player.getPosition().y).toBeGreaterThan(startY);
    });

    test('diagonal movement is normalized', () => {
      Player.init(50, 50, { collisionFn: noCollision });
      const startPos = Player.getPosition();

      // Move diagonally for 20 frames
      for (let i = 0; i < 20; i++) {
        Player.update({ d: true, s: true });
      }
      const diagDist = Math.sqrt(
        (Player.getPosition().x - startPos.x) ** 2 +
        (Player.getPosition().y - startPos.y) ** 2
      );

      // Reset and move horizontally for same frames
      Player.init(50, 50, { collisionFn: noCollision });
      for (let i = 0; i < 20; i++) {
        Player.update({ d: true });
      }
      const horizDist = Player.getPosition().x - (50 * 32 + 16);

      // Diagonal distance should be similar to horizontal (within 20%)
      expect(diagDist).toBeGreaterThan(horizDist * 0.8);
      expect(diagDist).toBeLessThan(horizDist * 1.2);
    });

    test('stops moving with friction when no input', () => {
      // Build up speed
      for (let i = 0; i < 10; i++) {
        Player.update({ d: true });
      }
      // Release all keys — should slow down
      const posAfterRelease = Player.getPosition().x;
      for (let i = 0; i < 30; i++) {
        Player.update({});
      }
      // Should have moved a little more (momentum) but eventually stopped
      const finalPos = Player.getPosition().x;
      expect(finalPos).toBeGreaterThan(posAfterRelease);
      // Velocity should be near zero now
      // Run another frame and check position barely changes
      const before = Player.getPosition().x;
      Player.update({});
      const after = Player.getPosition().x;
      expect(Math.abs(after - before)).toBeLessThan(0.1);
    });
  });

  describe('collision', () => {
    test('stops at solid tile', () => {
      // Put a wall at tile (6, 5) — one tile to the right of player at (5, 5)
      Player.init(5, 5, { collisionFn: wallAt(6, 5) });
      const startX = Player.getPosition().x;

      // Try to walk right for many frames
      for (let i = 0; i < 60; i++) {
        Player.update({ d: true });
      }

      // Should not have passed into tile 6
      const tile = Player.getTile();
      expect(tile.col).toBeLessThanOrEqual(5);
    });

    test('can slide along walls (corner assist)', () => {
      // Wall at (6, 5) — player at (5, 5) tries to go right+down
      // Corner assist should allow sliding past
      Player.init(5, 5, { collisionFn: wallAt(6, 5) });

      // Walk right+down — should slide along the wall
      for (let i = 0; i < 30; i++) {
        Player.update({ d: true, s: true });
      }

      // Should have moved down even if blocked right
      expect(Player.getPosition().y).toBeGreaterThan(5 * 32 + 16);
    });
  });

  describe('stamina', () => {
    test('sprinting depletes stamina', () => {
      const initialStamina = Player.getStamina();
      for (let i = 0; i < 30; i++) {
        Player.update({ d: true, Shift: true });
      }
      expect(Player.getStamina()).toBeLessThan(initialStamina);
    });

    test('stamina recovers after sprint stops', () => {
      // Sprint until depleted
      for (let i = 0; i < 200; i++) {
        Player.update({ d: true, Shift: true });
      }
      const depleted = Player.getStamina();

      // Wait for recovery (idle for many frames)
      for (let i = 0; i < 300; i++) {
        Player.update({});
      }
      expect(Player.getStamina()).toBeGreaterThan(depleted);
    });

    test('exhausted state limits speed', () => {
      // Sprint until exhausted
      for (let i = 0; i < 200; i++) {
        Player.update({ d: true, Shift: true });
      }

      // Try to walk right — should be slow
      const posBefore = Player.getPosition().x;
      for (let i = 0; i < 10; i++) {
        Player.update({ d: true });
      }
      const exhaustedDist = Player.getPosition().x - posBefore;

      // Reset with full stamina
      Player.init(50, 50, { collisionFn: noCollision });
      const startX = Player.getPosition().x;
      for (let i = 0; i < 10; i++) {
        Player.update({ d: true });
      }
      const normalDist = Player.getPosition().x - startX;

      // Exhausted speed should be less than normal walk speed
      expect(exhaustedDist).toBeLessThan(normalDist);
    });
  });

  describe('edge cases', () => {
    test('update with empty keys does not crash', () => {
      expect(() => Player.update({})).not.toThrow();
    });

    test('update with undefined keys does not crash', () => {
      expect(() => Player.update(undefined)).not.toThrow();
    });

    test('getPosition returns numbers', () => {
      const pos = Player.getPosition();
      expect(typeof pos.x).toBe('number');
      expect(typeof pos.y).toBe('number');
      expect(isNaN(pos.x)).toBe(false);
      expect(isNaN(pos.y)).toBe(false);
    });

    test('NaN collision function does not crash player', () => {
      Player.init(5, 5, { collisionFn: () => NaN });
      // NaN is falsy, so player should move freely
      for (let i = 0; i < 10; i++) {
        Player.update({ d: true });
      }
      expect(isNaN(Player.getPosition().x)).toBe(false);
    });
  });
});
