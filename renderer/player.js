/**
 * player.js — Player-controlled character for AIFarm 3.0.
 *
 * The player exists in world-pixel coordinates and moves with
 * velocity + friction for a smooth "Stardew Valley" feel.
 * Tile-based sliding collision prevents walking through solid tiles.
 */

const Player = (() => {
  // Movement tuning
  const ACCEL = 0.6;       // pixels/frame² acceleration
  const FRICTION = 0.78;   // velocity multiplier each frame (< 1 = decelerate)
  const MAX_SPEED = 3.2;   // pixels/frame cap
  const HITBOX_W = 12;     // collision box width (centered on sprite)
  const HITBOX_H = 8;      // collision box height (at feet)

  // World position (pixels — top-left of the 32x32 tile the player occupies)
  let wx = 0;
  let wy = 0;
  let vx = 0;
  let vy = 0;

  // Direction: 0=down, 1=left, 2=right, 3=up (matches sprite sheet row order)
  let dir = 0;
  let animFrame = 0;
  let animTimer = 0;
  const ANIM_SPEED = 8; // frames between walk-cycle steps
  let moving = false;

  // Sprite key (SpriteManager name) — defaults to char_blue
  let spriteKey = 'char_blue';

  // Reference to collision checker (set via init)
  let collisionFn = null;

  // Solid tile types the player cannot walk through
  const SOLID_TILES = new Set(['water', 'fence', 'empty', null]);

  // ===== Public API =====

  /** Initialize player at a grid tile position. */
  function init(col, row, opts) {
    const TILE_W = 32;
    const TILE_H = 32;
    wx = col * TILE_W + TILE_W / 2;
    wy = row * TILE_H + TILE_H / 2;
    vx = 0;
    vy = 0;
    dir = 0;
    if (opts && opts.spriteKey) spriteKey = opts.spriteKey;
    if (opts && opts.collisionFn) collisionFn = opts.collisionFn;
  }

  /** Set the collision checker: fn(worldX, worldY) → boolean (true = blocked). */
  function setCollisionFn(fn) {
    collisionFn = fn;
  }

  /**
   * Update player position based on input keys.
   * @param {Object} keys — map of key names to booleans (e.g. { ArrowUp: true })
   */
  function update(keys) {
    // Gather input direction
    let ix = 0;
    let iy = 0;
    if (keys['ArrowLeft']  || keys['a'] || keys['A']) ix -= 1;
    if (keys['ArrowRight'] || keys['d'] || keys['D']) ix += 1;
    if (keys['ArrowUp']    || keys['w'] || keys['W']) iy -= 1;
    if (keys['ArrowDown']  || keys['s'] || keys['S']) iy += 1;

    // Normalize diagonal so it doesn't go faster
    if (ix !== 0 && iy !== 0) {
      const inv = 1 / Math.SQRT2;
      ix *= inv;
      iy *= inv;
    }

    // Apply acceleration
    vx += ix * ACCEL;
    vy += iy * ACCEL;

    // Clamp speed
    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed > MAX_SPEED) {
      vx = (vx / speed) * MAX_SPEED;
      vy = (vy / speed) * MAX_SPEED;
    }

    // Apply friction
    vx *= FRICTION;
    vy *= FRICTION;

    // Kill tiny velocities
    if (Math.abs(vx) < 0.05) vx = 0;
    if (Math.abs(vy) < 0.05) vy = 0;

    moving = Math.abs(vx) > 0.1 || Math.abs(vy) > 0.1;

    // Sliding collision: try X and Y axes independently
    const nextX = wx + vx;
    const nextY = wy + vy;

    if (!isBlocked(nextX, wy)) {
      wx = nextX;
    } else {
      vx = 0;
    }
    if (!isBlocked(wx, nextY)) {
      wy = nextY;
    } else {
      vy = 0;
    }

    // Update facing direction
    if (moving) {
      if (Math.abs(vx) > Math.abs(vy)) {
        dir = vx < 0 ? 1 : 2; // left : right
      } else {
        dir = vy < 0 ? 3 : 0; // up : down
      }
    }

    // Animate walk cycle
    if (moving) {
      animTimer++;
      if (animTimer >= ANIM_SPEED) {
        animTimer = 0;
        animFrame = (animFrame + 1) % 3;
      }
    } else {
      animFrame = 0;
      animTimer = 0;
    }
  }

  /** Check if position is blocked (using hitbox corners). */
  function isBlocked(px, py) {
    if (!collisionFn) return false;
    const hw = HITBOX_W / 2;
    const hh = HITBOX_H / 2;
    // Check 4 corners of hitbox (feet area)
    return (
      collisionFn(px - hw, py - hh) ||
      collisionFn(px + hw, py - hh) ||
      collisionFn(px - hw, py + hh) ||
      collisionFn(px + hw, py + hh)
    );
  }

  // Direction index → SpriteManager direction name
  const DIR_NAMES = ['down', 'left', 'right', 'up'];

  // Player hoodie color (gold = "lord" character, distinct from buddies)
  const PLAYER_COLOR = '#DAA520';

  /** Get player as an entity compatible with IsoEngine.addEntity(). */
  function getEntity() {
    const TILE_W = 32;
    const TILE_H = 32;
    const col = wx / TILE_W;
    const row = wy / TILE_H;
    const direction = DIR_NAMES[dir] || 'down';
    return {
      col,
      row,
      z: 0,
      // No spriteId — always use procedural gold draw so player is visually distinct
      spriteId: null,
      direction,
      frame: animFrame,
      type: 'player',
      draw: (ctx, sx, sy, tick) => {
        // Gold hoodie character — distinct from buddy NPCs
        if (typeof IsoEngine !== 'undefined' && IsoEngine.drawIsoCharacter) {
          IsoEngine.drawIsoCharacter(ctx, sx, sy, direction, animFrame, PLAYER_COLOR, tick);
          // Draw player indicator arrow above head
          ctx.save();
          ctx.fillStyle = '#FFD700';
          ctx.globalAlpha = 0.7 + Math.sin(tick * 0.1) * 0.3;
          const arrowY = sy - 22 + Math.sin(tick * 0.08) * 2;
          ctx.beginPath();
          ctx.moveTo(sx, arrowY + 5);
          ctx.lineTo(sx - 4, arrowY);
          ctx.lineTo(sx + 4, arrowY);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      },
    };
  }

  /** Get world pixel position. */
  function getPosition() {
    return { x: wx, y: wy };
  }

  /** Get grid tile position. */
  function getTile() {
    return {
      col: Math.floor(wx / 32),
      row: Math.floor(wy / 32),
    };
  }

  function getDirection() { return dir; }
  function isMoving() { return moving; }

  return {
    init,
    setCollisionFn,
    update,
    getEntity,
    getPosition,
    getTile,
    getDirection,
    isMoving,
    SOLID_TILES,
  };
})();

if (typeof module !== 'undefined') module.exports = Player;
