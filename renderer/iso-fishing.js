/**
 * iso-fishing.js — Fishing Mini-game for AIFarm 3.0 (Sprint 18 P2).
 *
 * When player stands near water and presses [E], enters FISHING state.
 * A bobber appears on the water. After a random wait, "!" appears.
 * Player must press [E] again within a short window to catch a fish.
 * Catch rewards FISH resource (sellable/processable).
 */
const IsoFishing = (() => {
  // State machine
  const STATE = {
    INACTIVE: 'inactive',   // not fishing
    CASTING: 'casting',     // cast animation (short)
    WAITING: 'waiting',     // waiting for bite
    BITE: 'bite',           // "!" — press E now!
    REELING: 'reeling',     // caught! reel in animation
    MISS: 'miss',           // missed timing, fail animation
  };

  let state = STATE.INACTIVE;
  let timer = 0;
  let bobberX = 0;        // screen position of bobber
  let bobberY = 0;
  let bobberCol = 0;       // grid position
  let bobberRow = 0;
  let catchQuality = 0;    // 0-2: small, medium, large
  let lastCatchTick = 0;

  // Timing
  const CAST_DURATION = 30;          // ~0.5s cast animation
  const WAIT_MIN = 120;              // min ~2s wait
  const WAIT_MAX = 360;              // max ~6s wait
  const BITE_WINDOW = 45;            // ~0.75s to press E
  const REEL_DURATION = 60;          // ~1s reel animation
  const MISS_DURATION = 40;          // ~0.7s fail animation

  // Fish types (weighted)
  const FISH_TYPES = [
    { name: 'Small Fish',  emoji: '\u{1F41F}', weight: 5, value: 1 },
    { name: 'Medium Fish', emoji: '\u{1F420}', weight: 3, value: 2 },
    { name: 'Large Fish',  emoji: '\u{1F421}', weight: 1, value: 3 },
  ];

  // Water tile positions on the home farm (from iso-farm.js)
  const WATER_TILES = [
    { col: 16, row: 12 }, { col: 17, row: 12 },
    { col: 16, row: 13 }, { col: 17, row: 13 },
  ];

  /** Check if player is adjacent to any water tile. */
  function isNearWater() {
    if (typeof Player === 'undefined') return false;
    const pt = Player.getTile();
    for (const wt of WATER_TILES) {
      const dx = Math.abs(pt.col - wt.col);
      const dy = Math.abs(pt.row - wt.row);
      if (dx <= 1 && dy <= 1) return true;
    }
    // Also check chunk-generated water tiles in adjacent positions
    if (typeof ChunkManager !== 'undefined') {
      for (let dc = -1; dc <= 1; dc++) {
        for (let dr = -1; dr <= 1; dr++) {
          const tile = ChunkManager.getTile(pt.col + dc, pt.row + dr);
          if (tile === 'water') return true;
        }
      }
    }
    return false;
  }

  /** Find the nearest water tile to place the bobber. */
  function findWaterTile() {
    if (typeof Player === 'undefined') return null;
    const pt = Player.getTile();
    let nearest = null;
    let nearestDist = Infinity;

    // Check home farm water
    for (const wt of WATER_TILES) {
      const dx = wt.col - pt.col;
      const dy = wt.row - pt.row;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = wt;
      }
    }
    // Check chunk water
    if (typeof ChunkManager !== 'undefined') {
      for (let dc = -2; dc <= 2; dc++) {
        for (let dr = -2; dr <= 2; dr++) {
          const c = pt.col + dc;
          const r = pt.row + dr;
          const tile = ChunkManager.getTile(c, r);
          if (tile === 'water') {
            const d = Math.sqrt(dc * dc + dr * dr);
            if (d < nearestDist) {
              nearestDist = d;
              nearest = { col: c, row: r };
            }
          }
        }
      }
    }
    return nearest;
  }

  /** Start fishing (called when player presses E near water). */
  function startFishing() {
    if (state !== STATE.INACTIVE) return false;
    if (!isNearWater()) return false;

    const waterTile = findWaterTile();
    if (!waterTile) return false;

    bobberCol = waterTile.col + 0.5 + (Math.random() - 0.5) * 0.4;
    bobberRow = waterTile.row + 0.5 + (Math.random() - 0.5) * 0.4;
    state = STATE.CASTING;
    timer = CAST_DURATION;

    if (typeof Farm !== 'undefined' && Farm.logEvent) {
      Farm.logEvent('\u{1F3A3}', 'Player started fishing');
    }
    return true;
  }

  /** Handle E key press during fishing. */
  function handleAction() {
    if (state === STATE.BITE) {
      // Caught!
      catchQuality = pickFishQuality();
      state = STATE.REELING;
      timer = REEL_DURATION;
      return true;
    }
    if (state === STATE.WAITING) {
      // Pressed too early — miss
      state = STATE.MISS;
      timer = MISS_DURATION;
      return true;
    }
    return false;
  }

  function pickFishQuality() {
    const totalWeight = FISH_TYPES.reduce((sum, f) => sum + f.weight, 0);
    let r = Math.random() * totalWeight;
    for (let i = 0; i < FISH_TYPES.length; i++) {
      r -= FISH_TYPES[i].weight;
      if (r <= 0) return i;
    }
    return 0;
  }

  /** Cancel fishing (e.g., player moves). */
  function cancel() {
    if (state === STATE.INACTIVE) return;
    state = STATE.INACTIVE;
    timer = 0;
  }

  /** Main update — called each frame. */
  function update(tick) {
    if (state === STATE.INACTIVE) return;

    timer--;

    switch (state) {
      case STATE.CASTING:
        if (timer <= 0) {
          state = STATE.WAITING;
          timer = WAIT_MIN + Math.floor(Math.random() * (WAIT_MAX - WAIT_MIN));
          // Splash effect
          if (typeof IsoEngine !== 'undefined') {
            IsoEngine.spawnHarvestParticles(bobberCol, bobberRow, '#4FC3F7', 4);
          }
        }
        break;

      case STATE.WAITING:
        // Random bobber movement (gentle drift)
        if (timer <= 0) {
          state = STATE.BITE;
          timer = BITE_WINDOW;
        }
        // Cancel if player walks away
        if (!isNearWater()) {
          cancel();
        }
        break;

      case STATE.BITE:
        if (timer <= 0) {
          // Missed!
          state = STATE.MISS;
          timer = MISS_DURATION;
        }
        break;

      case STATE.REELING:
        if (timer <= 0) {
          // Award fish
          const fish = FISH_TYPES[catchQuality];
          if (typeof ResourceInventory !== 'undefined') {
            ResourceInventory.add('fish', fish.value);
          }
          if (typeof IsoEffects !== 'undefined') {
            const screen = getScreenPos();
            IsoEffects.spawnFloatingText(screen.x, screen.y - 30,
              `${fish.emoji} ${fish.name}!`, '#4FC3F7');
          }
          if (typeof Farm !== 'undefined' && Farm.logEvent) {
            Farm.logEvent('\u{1F41F}', `Caught a ${fish.name}!`);
          }
          lastCatchTick = tick;
          state = STATE.INACTIVE;
        }
        break;

      case STATE.MISS:
        if (timer <= 0) {
          if (typeof IsoEffects !== 'undefined') {
            const screen = getScreenPos();
            IsoEffects.spawnFloatingText(screen.x, screen.y - 20, 'Too slow...', '#FF6B6B');
          }
          state = STATE.INACTIVE;
        }
        break;
    }
  }

  function getScreenPos() {
    if (typeof IsoEngine !== 'undefined') {
      return IsoEngine.gridToScreen(bobberCol, bobberRow, 0);
    }
    return { x: 0, y: 0 };
  }

  /** Draw fishing visuals (bobber, "!", rod line). */
  function draw(ctx, tick) {
    if (state === STATE.INACTIVE) return;

    const screen = getScreenPos();
    const sx = screen.x;
    const sy = screen.y;

    // Get player screen position for rod line
    let playerSX = sx;
    let playerSY = sy;
    if (typeof Player !== 'undefined' && typeof IsoEngine !== 'undefined') {
      const pt = Player.getTile();
      const ps = IsoEngine.gridToScreen(pt.col + 0.5, pt.row + 0.5, 0);
      playerSX = ps.x;
      playerSY = ps.y;
    }

    // Draw fishing line from player to bobber
    if (state !== STATE.CASTING) {
      ctx.strokeStyle = 'rgba(200, 200, 200, 0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(playerSX, playerSY - 12);
      ctx.quadraticCurveTo(
        (playerSX + sx) / 2, Math.min(playerSY, sy) - 15,
        sx, sy
      );
      ctx.stroke();
    }

    if (state === STATE.CASTING) {
      // Cast animation: bobber flying to water
      const progress = 1 - timer / CAST_DURATION;
      const castX = playerSX + (sx - playerSX) * progress;
      const castY = playerSY + (sy - playerSY) * progress - Math.sin(progress * Math.PI) * 20;
      // Bobber
      ctx.fillStyle = '#FF4444';
      ctx.beginPath();
      ctx.arc(castX, castY, 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (state === STATE.WAITING) {
      // Bobber floating with gentle bob
      const bob = Math.sin(tick * 0.08) * 1.5;
      ctx.fillStyle = '#FF4444';
      ctx.beginPath();
      ctx.arc(sx, sy + bob, 2.5, 0, Math.PI * 2);
      ctx.fill();
      // White float
      ctx.fillStyle = '#FFF';
      ctx.beginPath();
      ctx.arc(sx, sy + bob - 2, 1.5, 0, Math.PI * 2);
      ctx.fill();
      // Ripples
      if (tick % 30 === 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.ellipse(sx, sy + 2, 4, 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (state === STATE.BITE) {
      // "!" exclamation — urgent!
      const shake = Math.sin(tick * 0.5) * 2;
      // Bobber shaking
      ctx.fillStyle = '#FF4444';
      ctx.beginPath();
      ctx.arc(sx + shake, sy, 2.5, 0, Math.PI * 2);
      ctx.fill();
      // Big "!" above
      const flash = Math.sin(tick * 0.3) * 0.3 + 0.7;
      ctx.fillStyle = `rgba(255, 215, 0, ${flash.toFixed(2)})`;
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('!', sx, sy - 8);
      // Splash particles
      if (tick % 6 === 0 && typeof IsoEngine !== 'undefined') {
        IsoEngine.spawnHarvestParticles(bobberCol, bobberRow, '#4FC3F7', 2);
      }
    } else if (state === STATE.REELING) {
      // Reel animation: fish rising out of water
      const progress = 1 - timer / REEL_DURATION;
      const riseY = sy - progress * 20;
      const fish = FISH_TYPES[catchQuality];
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(fish.emoji, sx, riseY);
      // Golden sparkles
      if (tick % 4 === 0 && typeof IsoEngine !== 'undefined') {
        IsoEngine.spawnHarvestParticles(bobberCol, bobberRow, '#FFD700', 3);
      }
    } else if (state === STATE.MISS) {
      // Bobber sinks
      const progress = 1 - timer / MISS_DURATION;
      const sinkY = sy + progress * 8;
      ctx.globalAlpha = 1 - progress * 0.7;
      ctx.fillStyle = '#FF4444';
      ctx.beginPath();
      ctx.arc(sx, sinkY, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  /** Draw the fishing prompt HUD when near water. */
  function drawPrompt(ctx, canvasW, canvasH) {
    if (state !== STATE.INACTIVE) {
      // Show current state prompt
      let text = '';
      if (state === STATE.WAITING) text = 'Waiting for bite...';
      else if (state === STATE.BITE) text = 'Press [E] NOW!';
      else if (state === STATE.CASTING) text = 'Casting...';
      else if (state === STATE.REELING) text = 'Got one!';

      if (text) {
        ctx.font = 'bold 9px monospace';
        const tw = ctx.measureText(text).width;
        const px = (canvasW - tw) / 2 - 8;
        const py = canvasH - 42;
        ctx.fillStyle = state === STATE.BITE ? 'rgba(200, 50, 50, 0.9)' : 'rgba(20, 40, 60, 0.8)';
        // Simple rounded rect
        ctx.beginPath();
        ctx.roundRect(px, py, tw + 16, 18, 4);
        ctx.fill();
        ctx.fillStyle = state === STATE.BITE ? '#FFD700' : '#4FC3F7';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, canvasW / 2, py + 9);
      }
      return;
    }

    // Show "Press E to fish" when near water and not doing anything else
    if (!isNearWater()) return;
    if (typeof ShopUI !== 'undefined' && (ShopUI.isOpen() || ShopUI.isNearShop())) return;

    const text = '\u{1F3A3} Press [E] to fish';
    ctx.font = 'bold 9px monospace';
    const tw = ctx.measureText(text).width;
    const px = (canvasW - tw) / 2 - 8;
    const py = canvasH - 42;
    ctx.fillStyle = 'rgba(20, 40, 60, 0.8)';
    ctx.beginPath();
    ctx.roundRect(px, py, tw + 16, 18, 4);
    ctx.fill();
    ctx.fillStyle = '#4FC3F7';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvasW / 2, py + 9);
  }

  function isActive() { return state !== STATE.INACTIVE; }
  function getState() { return state; }

  return {
    STATE,
    startFishing,
    handleAction,
    cancel,
    update,
    draw,
    drawPrompt,
    isActive,
    isNearWater,
    getState,
  };
})();

if (typeof module !== 'undefined') module.exports = IsoFishing;
