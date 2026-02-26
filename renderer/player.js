/**
 * player.js — Player-controlled character for AIFarm 3.0.
 *
 * The player exists in world-pixel coordinates and moves with
 * velocity + friction for a smooth "Stardew Valley" feel.
 * Tile-based sliding collision prevents walking through solid tiles.
 *
 * Sprint 16: State machine — IDLE / WALK / SPRINT / EXHAUSTED
 * Hold Shift to sprint. Stamina depletes while sprinting; when empty,
 * player enters EXHAUSTED (half speed). Recovery starts after a delay.
 */

const Player = (() => {
  // Movement tuning
  const ACCEL = 0.6;           // pixels/frame² acceleration
  const FRICTION = 0.78;       // velocity multiplier each frame
  const WALK_SPEED = 3.2;      // pixels/frame cap (walk)
  const SPRINT_SPEED = 5.5;    // pixels/frame cap (sprint)
  const EXHAUSTED_SPEED = 1.6; // pixels/frame cap (exhausted)
  const HITBOX_W = 12;
  const HITBOX_H = 8;

  // Stamina tuning
  const STAMINA_MAX = 100;
  const STAMINA_DRAIN = 0.8;     // per frame while sprinting
  const STAMINA_RECOVER = 0.4;   // per frame while recovering
  const RECOVERY_DELAY = 60;     // frames after sprint stops before recovery begins

  // State machine
  const STATE = { IDLE: 0, WALK: 1, SPRINT: 2, EXHAUSTED: 3 };
  let state = STATE.IDLE;
  let stamina = STAMINA_MAX;
  let recoveryTimer = 0; // frames since sprint stopped

  // World position (pixels)
  let wx = 0;
  let wy = 0;
  let vx = 0;
  let vy = 0;

  // Direction: 0=down, 1=left, 2=right, 3=up
  let dir = 0;
  let animFrame = 0;
  let animTimer = 0;
  const ANIM_SPEED_WALK = 8;
  const ANIM_SPEED_SPRINT = 5;   // faster animation while sprinting
  let moving = false;
  let sprinting = false;

  // Dirt particle callback (set by renderer to call IsoEffects)
  let dirtParticleFn = null;
  let dirtTimer = 0;

  // Reference to collision checker
  let collisionFn = null;

  // Solid tile types (null/undefined are NOT solid — the fence perimeter
  // and ChunkManager's 'mountain' out-of-world-bounds handle boundaries)
  const SOLID_TILES = new Set(['water', 'fence', 'tree', 'mountain', 'empty']);

  // ===== Public API =====

  function init(col, row, opts) {
    const TILE_W = 32;
    const TILE_H = 32;
    wx = col * TILE_W + TILE_W / 2;
    wy = row * TILE_H + TILE_H / 2;
    vx = 0;
    vy = 0;
    dir = 0;
    state = STATE.IDLE;
    stamina = STAMINA_MAX;
    recoveryTimer = 0;
    if (opts && opts.collisionFn) collisionFn = opts.collisionFn;
    if (opts && opts.dirtParticleFn) dirtParticleFn = opts.dirtParticleFn;
  }

  function setCollisionFn(fn) { collisionFn = fn; }
  function setDirtParticleFn(fn) { dirtParticleFn = fn; }

  /**
   * Update player position based on input keys.
   * @param {Object} keys — map of key names to booleans
   */
  function update(keys) {
    if (!keys) keys = {};
    // Gather input direction
    let ix = 0;
    let iy = 0;
    if (keys['ArrowLeft']  || keys['a'] || keys['A']) ix -= 1;
    if (keys['ArrowRight'] || keys['d'] || keys['D']) ix += 1;
    if (keys['ArrowUp']    || keys['w'] || keys['W']) iy -= 1;
    if (keys['ArrowDown']  || keys['s'] || keys['S']) iy += 1;

    // Normalize diagonal
    if (ix !== 0 && iy !== 0) {
      const inv = 1 / Math.SQRT2;
      ix *= inv;
      iy *= inv;
    }

    const wantsSprint = !!(keys['Shift'] || keys['ShiftLeft'] || keys['ShiftRight']);
    const hasInput = ix !== 0 || iy !== 0;

    // ===== State machine transitions =====
    if (state === STATE.EXHAUSTED) {
      // Stay exhausted until stamina recovers past 30%
      if (stamina >= STAMINA_MAX * 0.3) {
        state = hasInput ? STATE.WALK : STATE.IDLE;
      }
    } else if (hasInput && wantsSprint && stamina > 0) {
      state = STATE.SPRINT;
    } else if (hasInput) {
      state = STATE.WALK;
    } else {
      state = STATE.IDLE;
    }

    // ===== Stamina management =====
    sprinting = state === STATE.SPRINT;
    const staminaMod = (typeof CookingSystem !== 'undefined') ? CookingSystem.getStaminaMod() : 1.0;
    if (sprinting) {
      stamina = Math.max(0, stamina - STAMINA_DRAIN * staminaMod);
      recoveryTimer = 0;
      if (stamina <= 0) {
        state = STATE.EXHAUSTED;
        sprinting = false;
      }
    } else {
      recoveryTimer++;
      if (recoveryTimer >= RECOVERY_DELAY && stamina < STAMINA_MAX) {
        stamina = Math.min(STAMINA_MAX, stamina + STAMINA_RECOVER);
      }
    }

    // ===== Speed cap based on state =====
    const speedMod = (typeof CookingSystem !== 'undefined') ? CookingSystem.getSpeedMod() : 1.0;
    let maxSpeed;
    if (state === STATE.SPRINT) maxSpeed = SPRINT_SPEED * speedMod;
    else if (state === STATE.EXHAUSTED) maxSpeed = EXHAUSTED_SPEED;
    else maxSpeed = WALK_SPEED * speedMod;

    // Apply acceleration
    vx += ix * ACCEL;
    vy += iy * ACCEL;

    // Clamp speed
    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed > maxSpeed) {
      vx = (vx / speed) * maxSpeed;
      vy = (vy / speed) * maxSpeed;
    }

    // Apply friction
    vx *= FRICTION;
    vy *= FRICTION;

    // Kill tiny velocities
    if (Math.abs(vx) < 0.05) vx = 0;
    if (Math.abs(vy) < 0.05) vy = 0;

    moving = Math.abs(vx) > 0.1 || Math.abs(vy) > 0.1;

    // Sliding collision with corner assist
    // When blocked, try nudging perpendicular by a few pixels to slide
    // past tile corners (prevents the "stuck walking back" problem).
    const nextX = wx + vx;
    const nextY = wy + vy;
    const NUDGE = 1.5;

    if (!isBlocked(nextX, wy)) {
      wx = nextX;
    } else if (!isBlocked(nextX, wy - NUDGE) && !isBlocked(wx, wy - NUDGE)) {
      wx = nextX; wy -= NUDGE;
    } else if (!isBlocked(nextX, wy + NUDGE) && !isBlocked(wx, wy + NUDGE)) {
      wx = nextX; wy += NUDGE;
    } else {
      vx = 0;
    }
    if (!isBlocked(wx, nextY)) {
      wy = nextY;
    } else if (!isBlocked(wx - NUDGE, nextY) && !isBlocked(wx - NUDGE, wy)) {
      wy = nextY; wx -= NUDGE;
    } else if (!isBlocked(wx + NUDGE, nextY) && !isBlocked(wx + NUDGE, wy)) {
      wy = nextY; wx += NUDGE;
    } else {
      vy = 0;
    }

    // Update facing direction
    if (moving) {
      if (Math.abs(vx) > Math.abs(vy)) {
        dir = vx < 0 ? 1 : 2;
      } else {
        dir = vy < 0 ? 3 : 0;
      }
    }

    // Animate walk cycle — speed proportional to velocity
    const currentSpeed = Math.sqrt(vx * vx + vy * vy);
    // Map speed to anim ticks: faster movement = fewer ticks between frames
    // At WALK_SPEED (3.2) → ~8 ticks, at SPRINT_SPEED (5.5) → ~5 ticks
    const animSpeed = moving ? Math.max(3, Math.round(25 / (currentSpeed + 0.1))) : ANIM_SPEED_WALK;
    if (moving) {
      animTimer++;
      if (animTimer >= animSpeed) {
        animTimer = 0;
        animFrame = (animFrame + 1) % 3;
      }
    } else {
      animFrame = 0;  // Force standing frame when idle (no mid-stride freeze)
      animTimer = 0;
    }

    // Dirt particles while sprinting
    if (sprinting && moving && dirtParticleFn) {
      dirtTimer++;
      if (dirtTimer >= 3) { // every 3 frames
        dirtTimer = 0;
        const col = wx / 32;
        const row = wy / 32;
        const currentSpeed = Math.sqrt(vx * vx + vy * vy);
        dirtParticleFn(col, row, currentSpeed);
      }
    } else {
      dirtTimer = 0;
    }
  }

  function isBlocked(px, py) {
    if (!collisionFn) return false;
    const hw = HITBOX_W / 2;
    const hh = HITBOX_H / 2;
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

  function getEntity() {
    const TILE_W = 32;
    const TILE_H = 32;
    const col = wx / TILE_W;
    const row = wy / TILE_H;
    const direction = DIR_NAMES[dir] || 'down';
    const currentState = state;
    const currentStamina = stamina;
    const isSprinting = sprinting;

    return {
      col,
      row,
      z: 0,
      spriteId: null,
      direction,
      frame: animFrame,
      type: 'player',
      draw: (ctx, sx, sy, tick) => {
        if (typeof IsoEngine !== 'undefined' && IsoEngine.drawIsoCharacter) {
          IsoEngine.drawIsoCharacter(ctx, sx, sy, direction, animFrame, PLAYER_COLOR, tick);

          // Draw equipped accessories (hat, backpack)
          if (typeof PlayerAccessories !== 'undefined') {
            const bob = Math.sin(tick * 0.15 + animFrame) * 1.2;
            PlayerAccessories.drawAccessories(ctx, sx, sy, direction, tick, bob);
          }

          // Player indicator arrow above head
          ctx.save();
          const arrowColor = isSprinting ? '#FF6600' : '#FFD700';
          ctx.fillStyle = arrowColor;
          // More aggressive bounce when sprinting
          const bounceAmp = isSprinting ? 4 : 2;
          const bounceFreq = isSprinting ? 0.2 : 0.08;
          ctx.globalAlpha = 0.7 + Math.sin(tick * 0.1) * 0.3;
          const arrowY = sy - 22 + Math.sin(tick * bounceFreq) * bounceAmp;
          ctx.beginPath();
          ctx.moveTo(sx, arrowY + 5);
          ctx.lineTo(sx - 4, arrowY);
          ctx.lineTo(sx + 4, arrowY);
          ctx.closePath();
          ctx.fill();
          ctx.restore();

          // Stamina bar (only show when not full)
          if (currentStamina < STAMINA_MAX) {
            drawStaminaBar(ctx, sx, sy, currentStamina, currentState);
          }
        }
      },
    };
  }

  function drawStaminaBar(ctx, sx, sy, stam, st) {
    const BAR_W = 18;
    const BAR_H = 3;
    const bx = sx - BAR_W / 2;
    const by = sy - 28; // above the arrow

    ctx.save();
    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(bx - 1, by - 1, BAR_W + 2, BAR_H + 2);

    // Fill
    const ratio = stam / STAMINA_MAX;
    let color;
    if (st === STATE.EXHAUSTED) color = '#FF4444';
    else if (ratio < 0.3) color = '#FF8800';
    else color = '#44DD44';
    ctx.fillStyle = color;
    ctx.fillRect(bx, by, BAR_W * ratio, BAR_H);
    ctx.restore();
  }

  /** Restore stamina by a ratio (1.0 = full). */
  function restoreStamina(ratio) {
    stamina = Math.min(STAMINA_MAX, stamina + STAMINA_MAX * ratio);
    if (state === STATE.EXHAUSTED && stamina >= STAMINA_MAX * 0.3) {
      state = STATE.IDLE;
    }
  }

  function setPosition(x, y) { wx = x; wy = y; vx = 0; vy = 0; }
  function getPosition() { return { x: wx, y: wy }; }
  function getTile() {
    return { col: Math.floor(wx / 32), row: Math.floor(wy / 32) };
  }
  function getDirection() { return dir; }
  function isMoving() { return moving; }
  function isSprinting() { return sprinting; }
  function getStamina() { return stamina; }
  function getState() { return state; }

  return {
    init,
    setPosition,
    setCollisionFn,
    setDirtParticleFn,
    update,
    restoreStamina,
    getEntity,
    getPosition,
    getTile,
    getDirection,
    isMoving,
    isSprinting,
    getStamina,
    getState,
    SOLID_TILES,
    STATE,
    STAMINA_MAX,
  };
})();

if (typeof module !== 'undefined') module.exports = Player;
