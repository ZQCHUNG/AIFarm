/**
 * pet-ai.js — Loyal Dog Companion for AIFarm 3.0 (Sprint 20 P1).
 *
 * A dog that follows the player character:
 *   - Runs to keep up when player moves, walks when close
 *   - Rests/sits when player is idle
 *   - Barks when near undiscovered landmarks (detector)
 *   - Tail wag animation, 4-direction pixel art sprite
 *   - Unlocks at 3500 energy (same as dog animal unlock)
 */

const PetAI = (() => {
  // ===== States =====
  const STATE = {
    FOLLOWING: 'following',    // running/walking to catch up with player
    SITTING: 'sitting',        // player idle, dog sits nearby
    SNIFFING: 'sniffing',      // detected something interesting
    BARKING: 'barking',        // alerting player to landmark
    PLAYING: 'playing',        // occasional play animation
  };

  // ===== Tuning =====
  const FOLLOW_DISTANCE = 1.8;   // grid units behind player
  const RUN_SPEED = 0.12;        // grid units/tick (faster than buddy AI)
  const WALK_SPEED = 0.06;
  const SIT_DELAY = 120;         // ticks idle before sitting
  const BARK_RANGE = 4;          // grid units to detect landmarks
  const BARK_COOLDOWN = 600;     // ticks between barks for same landmark
  const PLAY_CHANCE = 0.001;     // chance per tick to start playing

  // Pet color
  const FUR_COLOR = '#C68642';    // golden retriever
  const FUR_DARK = '#A0682E';
  const BELLY_COLOR = '#E8C88A';
  const NOSE_COLOR = '#333';

  // ===== State =====
  let active = false;
  let state = STATE.FOLLOWING;
  let wx = 0, wy = 0;            // world position (pixels)
  let dir = 'down';               // facing direction
  let animFrame = 0;
  let animTimer = 0;
  let stateTimer = 0;
  let idleTicks = 0;
  let tailWag = 0;
  let lastBarkTick = 0;
  let barkedLandmarks = new Map(); // landmarkId → lastBarkTick
  let barkEmoji = null;
  let barkTimer = 0;

  // ===== Initialization =====

  function init() {
    if (typeof EventBus === 'undefined') return;
    // Auto-activate when dog is unlocked
    EventBus.on('RESOURCE_CHANGED', checkActivation);
  }

  function checkActivation() {
    // Already active
    if (active) return;
    // Check if player has enough energy (dog unlocks at 3500)
    const farmState = (typeof Farm !== 'undefined') ? Farm.getState() : null;
    if (farmState && (farmState.totalEnergy || 0) >= 3500) {
      activate();
    }
  }

  function activate() {
    if (active) return;
    active = true;

    // Spawn near player
    if (typeof Player !== 'undefined') {
      const pp = Player.getPosition();
      wx = pp.x + 32;
      wy = pp.y + 32;
    } else {
      wx = 9 * 32;
      wy = 8 * 32;
    }

    state = STATE.FOLLOWING;
    idleTicks = 0;

    if (typeof Farm !== 'undefined' && Farm.logEvent) {
      Farm.logEvent('\u{1F415}', 'Your loyal dog has arrived!');
    }
    if (typeof IsoEffects !== 'undefined') {
      IsoEffects.spawnFloatingText(wx, wy - 16, '\u{1F415} Woof!', '#FFD700');
    }
  }

  function setActive(val) { active = val; }
  function isActive() { return active; }

  // ===== Update =====

  function update(tick) {
    if (!active) {
      checkActivation();
      return;
    }
    if (typeof Player === 'undefined') return;

    const pp = Player.getPosition();
    const dx = pp.x - wx;
    const dy = pp.y - wy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const playerMoving = Player.isMoving();

    tailWag = (tailWag + 0.15) % (Math.PI * 2);

    switch (state) {
      case STATE.FOLLOWING:
        updateFollowing(dx, dy, dist, playerMoving, tick);
        break;
      case STATE.SITTING:
        updateSitting(dx, dy, dist, playerMoving, tick);
        break;
      case STATE.BARKING:
        updateBarking(tick);
        break;
      case STATE.PLAYING:
        updatePlaying(tick);
        break;
      case STATE.SNIFFING:
        updateSniffing(tick);
        break;
    }

    // Check for nearby landmarks (in any state except barking)
    if (state !== STATE.BARKING && tick % 30 === 0) {
      checkNearbyLandmarks(tick);
    }

    // Random play (when sitting)
    if (state === STATE.SITTING && Math.random() < PLAY_CHANCE) {
      state = STATE.PLAYING;
      stateTimer = 90;
      if (typeof IsoEffects !== 'undefined') {
        IsoEffects.spawnText(wx / 32, wy / 32 - 0.5, '\u{1F43E}',
          { color: '#C68642', life: 30, rise: 0.5 });
      }
    }
  }

  function updateFollowing(dx, dy, dist, playerMoving, tick) {
    if (dist < FOLLOW_DISTANCE * 32) {
      // Close enough — slow down or idle
      if (!playerMoving) {
        idleTicks++;
        if (idleTicks >= SIT_DELAY) {
          state = STATE.SITTING;
          stateTimer = 0;
          animFrame = 0;
          return;
        }
      } else {
        idleTicks = 0;
      }

      // Slow wander near player
      if (dist > FOLLOW_DISTANCE * 32 * 0.5) {
        moveToward(dx, dy, dist, WALK_SPEED * 32);
      }
    } else {
      // Too far — run to catch up
      idleTicks = 0;
      const speed = dist > FOLLOW_DISTANCE * 32 * 3 ? RUN_SPEED * 1.5 : RUN_SPEED;
      moveToward(dx, dy, dist, speed * 32);
    }

    // Walk animation
    animTimer++;
    const animSpeed = dist > FOLLOW_DISTANCE * 32 * 2 ? 5 : 8;
    if (animTimer >= animSpeed) {
      animTimer = 0;
      animFrame = (animFrame + 1) % 4;
    }
  }

  function updateSitting(dx, dy, dist, playerMoving, tick) {
    animFrame = 0;

    // Player started moving — follow again
    if (playerMoving || dist > FOLLOW_DISTANCE * 32 * 2) {
      state = STATE.FOLLOWING;
      idleTicks = 0;
      return;
    }

    // Gentle look toward player
    updateDirection(dx, dy);
  }

  function updateBarking(tick) {
    stateTimer--;
    animFrame = ((tick / 6) | 0) % 2;

    // Jump animation
    if (stateTimer > 20) {
      // Bark emoji above head
      barkTimer = stateTimer;
    }

    if (stateTimer <= 0) {
      state = STATE.FOLLOWING;
      barkEmoji = null;
      idleTicks = 0;
    }
  }

  function updatePlaying(tick) {
    stateTimer--;
    // Spin / jump animation
    animFrame = ((tick / 5) | 0) % 4;

    // Occasionally spawn paw prints
    if (tick % 15 === 0 && typeof IsoEngine !== 'undefined') {
      IsoEngine.spawnHarvestParticles(wx / 32, wy / 32 + 0.1, '#C8B896', 2);
    }

    if (stateTimer <= 0) {
      state = STATE.SITTING;
      idleTicks = 0;
    }
  }

  function updateSniffing(tick) {
    stateTimer--;
    animFrame = 0;

    // Nose twitch (rapid small movement)
    if (tick % 4 === 0 && typeof IsoEffects !== 'undefined') {
      // Tiny sniff particles
    }

    if (stateTimer <= 0) {
      state = STATE.FOLLOWING;
      idleTicks = 0;
    }
  }

  function moveToward(dx, dy, dist, speed) {
    if (dist < 1) return;
    const nx = dx / dist;
    const ny = dy / dist;

    // Offset to walk slightly behind and to the side
    const offsetAngle = Math.atan2(ny, nx) + 0.5;
    const targetX = wx + nx * speed;
    const targetY = wy + ny * speed;

    wx = targetX;
    wy = targetY;

    updateDirection(dx, dy);
  }

  function updateDirection(dx, dy) {
    if (Math.abs(dx) > Math.abs(dy)) {
      dir = dx > 0 ? 'right' : 'left';
    } else {
      dir = dy > 0 ? 'down' : 'up';
    }
  }

  // ===== Landmark detection =====

  function checkNearbyLandmarks(tick) {
    if (typeof LandmarkGenerator === 'undefined') return;
    if (!LandmarkGenerator.getDiscoveredLandmarks) return;

    // Check for unclaimed landmarks nearby
    const nearbyLandmark = LandmarkGenerator.getNearbyLandmark
      ? LandmarkGenerator.getNearbyLandmark(wx / 32, wy / 32, BARK_RANGE)
      : null;

    if (nearbyLandmark && !nearbyLandmark.claimed) {
      const lmKey = `${nearbyLandmark.col},${nearbyLandmark.row}`;
      const lastBarked = barkedLandmarks.get(lmKey) || 0;
      if (tick - lastBarked >= BARK_COOLDOWN) {
        barkedLandmarks.set(lmKey, tick);
        startBarking(tick);
      }
    }
  }

  function startBarking(tick) {
    state = STATE.BARKING;
    stateTimer = 60;
    barkEmoji = '\u{2757}'; // ❗

    if (typeof IsoEffects !== 'undefined') {
      IsoEffects.spawnText(wx / 32, wy / 32 - 0.8, '\u{1F415}\u{2757}',
        { color: '#FF6600', life: 50, rise: 0.8 });
    }
    if (typeof Farm !== 'undefined' && Farm.logEvent) {
      Farm.logEvent('\u{1F415}', 'Your dog found something!');
    }
  }

  // ===== Drawing =====

  function getEntity() {
    if (!active) return null;

    const col = wx / 32;
    const row = wy / 32;

    return {
      col,
      row,
      z: 0,
      type: 'pet',
      draw: (ctx, sx, sy, tick) => {
        drawDog(ctx, sx, sy, tick);
      },
    };
  }

  function drawDog(ctx, sx, sy, tick) {
    const isSitting = state === STATE.SITTING;
    const isBarking = state === STATE.BARKING;
    const isPlaying = state === STATE.PLAYING;

    // Jump offset for barking/playing
    let jumpY = 0;
    if (isBarking) {
      jumpY = -Math.abs(Math.sin(tick * 0.3)) * 3;
    } else if (isPlaying) {
      jumpY = -Math.abs(Math.sin(tick * 0.2)) * 2;
    }

    // Bob while walking
    const walkBob = (state === STATE.FOLLOWING && animFrame % 2 === 1) ? -1 : 0;

    const by = sy + jumpY + walkBob;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.beginPath();
    ctx.ellipse(sx, sy + 2, 6, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    if (isSitting) {
      drawDogSitting(ctx, sx, by);
    } else {
      drawDogWalking(ctx, sx, by, tick);
    }

    // Tail wag
    const tailAngle = Math.sin(tailWag) * 0.4;
    ctx.fillStyle = FUR_COLOR;
    const tailDir = dir === 'left' ? 1 : dir === 'right' ? -1 : 0;
    if (dir === 'up') {
      // Tail visible on top
      ctx.fillRect(sx - 1 + tailAngle * 4, by - 10, 2, 4);
    } else if (dir !== 'down' || isSitting) {
      // Side tail
      const tailX = sx + tailDir * 6 + tailAngle * 3;
      ctx.fillRect(tailX, by - 6, 2, 3);
    }

    // Bark emoji
    if (isBarking && barkEmoji && stateTimer > 10) {
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#FF6600';
      ctx.fillText(barkEmoji, sx + 8, by - 14);
    }

    // Heart when near player and sitting
    if (isSitting && tick % 90 < 15) {
      ctx.fillStyle = '#E91E63';
      ctx.font = '6px serif';
      ctx.textAlign = 'center';
      ctx.fillText('\u{2764}\u{FE0F}', sx + 6, by - 12);
    }
  }

  function drawDogSitting(ctx, sx, sy) {
    // Body (compact sitting pose)
    ctx.fillStyle = FUR_COLOR;
    ctx.fillRect(sx - 5, sy - 6, 10, 8);

    // Belly
    ctx.fillStyle = BELLY_COLOR;
    ctx.fillRect(sx - 3, sy - 3, 6, 5);

    // Head
    ctx.fillStyle = FUR_COLOR;
    ctx.fillRect(sx - 4, sy - 11, 8, 6);

    // Ears (floppy)
    ctx.fillStyle = FUR_DARK;
    ctx.fillRect(sx - 5, sy - 10, 2, 4);
    ctx.fillRect(sx + 3, sy - 10, 2, 4);

    // Face features based on direction
    if (dir === 'down' || dir === 'left' || dir === 'right') {
      // Eyes
      ctx.fillStyle = '#333';
      ctx.fillRect(sx - 2, sy - 9, 2, 2);
      ctx.fillRect(sx + 1, sy - 9, 2, 2);
      // Nose
      ctx.fillStyle = NOSE_COLOR;
      ctx.fillRect(sx - 1, sy - 7, 2, 1);
      // Tongue (happy panting)
      ctx.fillStyle = '#FF6B8A';
      ctx.fillRect(sx, sy - 6, 2, 2);
    }

    // Front paws
    ctx.fillStyle = BELLY_COLOR;
    ctx.fillRect(sx - 4, sy + 1, 3, 2);
    ctx.fillRect(sx + 1, sy + 1, 3, 2);
  }

  function drawDogWalking(ctx, sx, sy, tick) {
    const legPhase = animFrame;

    // Body
    ctx.fillStyle = FUR_COLOR;
    if (dir === 'left' || dir === 'right') {
      // Side view: longer body
      ctx.fillRect(sx - 7, sy - 6, 14, 6);
      // Belly
      ctx.fillStyle = BELLY_COLOR;
      ctx.fillRect(sx - 5, sy - 4, 10, 4);
    } else {
      // Front/back view
      ctx.fillRect(sx - 5, sy - 6, 10, 6);
      ctx.fillStyle = BELLY_COLOR;
      ctx.fillRect(sx - 3, sy - 4, 6, 4);
    }

    // Head
    ctx.fillStyle = FUR_COLOR;
    if (dir === 'left') {
      ctx.fillRect(sx - 10, sy - 10, 7, 6);
      ctx.fillStyle = FUR_DARK;
      ctx.fillRect(sx - 11, sy - 9, 2, 3);
      ctx.fillStyle = '#333';
      ctx.fillRect(sx - 9, sy - 9, 1, 1);
      ctx.fillStyle = NOSE_COLOR;
      ctx.fillRect(sx - 10, sy - 7, 1, 1);
    } else if (dir === 'right') {
      ctx.fillRect(sx + 3, sy - 10, 7, 6);
      ctx.fillStyle = FUR_DARK;
      ctx.fillRect(sx + 9, sy - 9, 2, 3);
      ctx.fillStyle = '#333';
      ctx.fillRect(sx + 8, sy - 9, 1, 1);
      ctx.fillStyle = NOSE_COLOR;
      ctx.fillRect(sx + 9, sy - 7, 1, 1);
    } else {
      ctx.fillRect(sx - 4, sy - 11, 8, 6);
      ctx.fillStyle = FUR_DARK;
      ctx.fillRect(sx - 5, sy - 10, 2, 4);
      ctx.fillRect(sx + 3, sy - 10, 2, 4);
      if (dir === 'down') {
        ctx.fillStyle = '#333';
        ctx.fillRect(sx - 2, sy - 9, 2, 2);
        ctx.fillRect(sx + 1, sy - 9, 2, 2);
        ctx.fillStyle = NOSE_COLOR;
        ctx.fillRect(sx - 1, sy - 7, 2, 1);
      }
    }

    // Legs (animated)
    ctx.fillStyle = FUR_DARK;
    const legOffset = Math.sin(tick * 0.2 + legPhase) * 2;
    if (dir === 'left' || dir === 'right') {
      // Side: 4 legs
      ctx.fillRect(sx - 5, sy, 2, 3 + legOffset);
      ctx.fillRect(sx - 2, sy, 2, 3 - legOffset);
      ctx.fillRect(sx + 1, sy, 2, 3 + legOffset);
      ctx.fillRect(sx + 4, sy, 2, 3 - legOffset);
    } else {
      // Front/back: 2 visible legs
      ctx.fillRect(sx - 4, sy, 3, 3 + legOffset);
      ctx.fillRect(sx + 1, sy, 3, 3 - legOffset);
    }
  }

  // ===== State persistence =====

  function getState() {
    return {
      active,
      wx, wy,
    };
  }

  function loadState(saved) {
    if (!saved) return;
    if (saved.active) {
      active = true;
      wx = saved.wx || 9 * 32;
      wy = saved.wy || 8 * 32;
    }
  }

  return {
    STATE,
    init,
    activate,
    setActive,
    isActive,
    update,
    getEntity,
    getState,
    loadState,
  };
})();

if (typeof module !== 'undefined') module.exports = PetAI;
