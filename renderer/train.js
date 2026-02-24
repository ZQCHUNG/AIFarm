// Train system — pixel train arrives when new buddies join.
// Draws train station + animated train arrivals.
const Train = (() => {
  const PX = 3; // must match Scene.PX

  function px(ctx, x, y, c) { ctx.fillStyle = c; ctx.fillRect(x * PX, y * PX, PX, PX); }
  function rect(ctx, x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x * PX, y * PX, w * PX, h * PX); }

  // Station position (in the town area, between pasture and buildings)
  const STATION_X = 85;  // logical X — will be drawn in world space
  const TRACK_Y = 77;    // Y for the train tracks (between pasture and town)
  const PLATFORM_Y = 75; // Y for the platform (above tracks)

  // Train dimensions
  const TRAIN_W = 22;    // locomotive + car
  const TRAIN_H = 5;

  // Animation state
  const arrivals = [];    // queue of { buddyName, colorIndex, phase, trainX, walkX, walkY, tick }
  let stationBuilt = false;

  // Phases: 'approaching' → 'stopping' → 'disembarking' → 'walking' → 'done'
  const APPROACH_SPEED = 0.8;
  const WALK_SPEED = 0.3;
  const STOP_DURATION = 40;  // ticks to wait at station

  // ===== Public API =====

  function setStationBuilt(built) {
    stationBuilt = built;
  }

  function queueArrival(buddyName, colorIndex) {
    arrivals.push({
      buddyName,
      colorIndex: colorIndex || 0,
      phase: 'approaching',
      trainX: 140,         // start off-screen right
      stopX: STATION_X - 2,  // where to stop
      walkX: 0,            // set during disembark
      walkTargetX: 0,      // set during disembark
      walkY: PLATFORM_Y,
      stopTick: 0,
      startTick: 0,
    });
  }

  function isAnimating() {
    return arrivals.length > 0;
  }

  // Get buddy names currently in arrival animation (not yet at their slot)
  function getArrivingBuddies() {
    return arrivals.filter(a => a.phase !== 'done').map(a => a.buddyName);
  }

  // ===== Update & Draw =====

  function update(tick) {
    for (let i = arrivals.length - 1; i >= 0; i--) {
      const a = arrivals[i];
      if (a.startTick === 0) a.startTick = tick;

      switch (a.phase) {
        case 'approaching':
          a.trainX -= APPROACH_SPEED;
          if (a.trainX <= a.stopX) {
            a.trainX = a.stopX;
            a.phase = 'stopping';
            a.stopTick = tick;
          }
          break;

        case 'stopping':
          if (tick - a.stopTick > STOP_DURATION) {
            a.phase = 'disembarking';
            a.walkX = a.trainX + 6; // buddy exits from middle of train
            a.walkY = PLATFORM_Y;
          }
          break;

        case 'disembarking':
          // Buddy walks up from platform and fades out (arrives at village slot)
          a.walkY -= 0.12;
          a.walkX -= 0.08;
          if (a.walkY <= PLATFORM_Y - 8) {
            a.phase = 'departing';
            a.stopTick = tick;
          }
          break;

        case 'departing':
          // Train leaves to the left
          a.trainX -= APPROACH_SPEED * 1.2;
          if (a.trainX < -TRAIN_W - 5) {
            a.phase = 'done';
          }
          break;

        case 'done':
          arrivals.splice(i, 1);
          break;
      }
    }
  }

  function draw(ctx, logW, tick) {
    if (!stationBuilt) return;

    // Draw train tracks (always visible)
    drawTracks(ctx, logW);

    // Draw station building
    drawStation(ctx, tick);

    // Draw active train arrivals
    for (const a of arrivals) {
      if (a.phase !== 'done') {
        drawTrain(ctx, Math.floor(a.trainX), TRACK_Y - TRAIN_H, a.colorIndex, tick);

        // Draw disembarking buddy
        if (a.phase === 'disembarking' || a.phase === 'departing') {
          drawMiniBuddy(ctx, Math.floor(a.walkX), Math.floor(a.walkY), a.colorIndex, tick);
        }
      }
    }
  }

  // ===== Train tracks =====

  function drawTracks(ctx, logW) {
    // Rails
    rect(ctx, 0, TRACK_Y, logW, 1, '#8B7355');
    rect(ctx, 0, TRACK_Y + 1, logW, 1, '#7A6345');

    // Sleepers (cross ties)
    for (let x = 2; x < logW; x += 4) {
      rect(ctx, x, TRACK_Y - 1, 2, 3, '#6B5030');
    }
  }

  // ===== Train station building =====

  function drawStation(ctx, tick) {
    const sx = STATION_X;
    const sy = PLATFORM_Y - 10;

    // Platform
    rect(ctx, sx - 3, PLATFORM_Y, 20, 2, '#A09080');
    rect(ctx, sx - 3, PLATFORM_Y, 20, 1, '#B0A090');

    // Station building
    rect(ctx, sx, sy + 2, 14, 8, '#E8D0A8');
    rect(ctx, sx + 1, sy + 2, 12, 7, '#DCC098');

    // Roof
    rect(ctx, sx - 2, sy, 18, 2, '#B04838');
    rect(ctx, sx - 1, sy + 1, 16, 1, '#C05848');

    // Door
    rect(ctx, sx + 5, sy + 6, 4, 4, '#8B6B3E');
    px(ctx, sx + 8, sy + 8, '#FFD700'); // door handle

    // Windows
    rect(ctx, sx + 1, sy + 4, 3, 2, '#88C0E0');
    rect(ctx, sx + 10, sy + 4, 3, 2, '#88C0E0');

    // Sign: "STATION"
    ctx.fillStyle = '#FFF8E0';
    ctx.font = '6px monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const signX = (sx + 7) * PX;
    const signY = (sy + 1) * PX + 2;
    ctx.fillText('STATION', signX, signY);

    // Bench on platform
    rect(ctx, sx - 2, PLATFORM_Y - 2, 4, 1, '#C8A060');
    px(ctx, sx - 2, PLATFORM_Y - 1, '#9A7540');
    px(ctx, sx + 1, PLATFORM_Y - 1, '#9A7540');

    // Lamp post
    px(ctx, sx + 15, PLATFORM_Y - 5, '#666');
    px(ctx, sx + 15, PLATFORM_Y - 4, '#666');
    px(ctx, sx + 15, PLATFORM_Y - 3, '#666');
    px(ctx, sx + 15, PLATFORM_Y - 2, '#666');
    px(ctx, sx + 15, PLATFORM_Y - 1, '#666');
    // Lamp glow
    px(ctx, sx + 14, PLATFORM_Y - 5, '#FFE080');
    px(ctx, sx + 16, PLATFORM_Y - 5, '#FFE080');
    px(ctx, sx + 15, PLATFORM_Y - 6, '#FFE080');
  }

  // ===== Train sprite =====

  function drawTrain(ctx, x, y, colorIndex, tick) {
    const hc = Character.HOODIE_COLORS[colorIndex % Character.HOODIE_COLORS.length];

    // === Locomotive ===
    // Body
    rect(ctx, x, y + 1, 10, 3, '#444');
    rect(ctx, x + 1, y + 1, 8, 2, '#555');

    // Cabin
    rect(ctx, x + 6, y - 1, 4, 3, hc.o);
    rect(ctx, x + 7, y - 1, 2, 2, '#88C0E0'); // window
    px(ctx, x + 7, y, '#222'); // driver silhouette

    // Smokestack
    rect(ctx, x + 2, y - 1, 2, 2, '#333');
    px(ctx, x + 2, y - 2, '#666');
    // Steam puffs
    const puff = ((tick / 6) | 0) % 3;
    if (puff < 2) px(ctx, x + 2 - puff, y - 3 - puff, '#CCC');
    if (puff < 1) px(ctx, x + 3, y - 4, '#DDD');

    // Wheels
    px(ctx, x + 1, y + 4, '#222');
    px(ctx, x + 4, y + 4, '#222');
    px(ctx, x + 7, y + 4, '#222');
    px(ctx, x + 9, y + 4, '#222');
    // Wheel animation (rotation hint)
    const spin = ((tick / 4) | 0) % 2;
    if (spin) {
      px(ctx, x + 1, y + 4, '#444');
      px(ctx, x + 7, y + 4, '#444');
    }

    // Cowcatcher
    px(ctx, x - 1, y + 3, '#666');
    px(ctx, x - 1, y + 4, '#888');

    // === Passenger car ===
    rect(ctx, x + 11, y + 1, 10, 3, hc.O);
    rect(ctx, x + 12, y + 1, 8, 2, hc.o);
    // Windows
    px(ctx, x + 13, y + 1, '#88C0E0');
    px(ctx, x + 15, y + 1, '#88C0E0');
    px(ctx, x + 17, y + 1, '#88C0E0');
    px(ctx, x + 19, y + 1, '#88C0E0');

    // Car wheels
    px(ctx, x + 12, y + 4, '#222');
    px(ctx, x + 15, y + 4, '#222');
    px(ctx, x + 18, y + 4, '#222');
    px(ctx, x + 20, y + 4, '#222');

    // Coupler
    px(ctx, x + 10, y + 3, '#888');
  }

  // ===== Mini buddy (disembarking) =====

  function drawMiniBuddy(ctx, x, y, colorIndex, tick) {
    const hc = Character.HOODIE_COLORS[colorIndex % Character.HOODIE_COLORS.length];
    const bob = ((tick / 10) | 0) % 2;

    // Head
    px(ctx, x, y - 2 - bob, '#4A3728'); // hair
    px(ctx, x + 1, y - 2 - bob, '#4A3728');
    px(ctx, x, y - 1 - bob, '#FFD5B8'); // face
    px(ctx, x + 1, y - 1 - bob, '#FFD5B8');
    px(ctx, x, y - 1 - bob, '#2C2C2C'); // eye

    // Body (hoodie)
    px(ctx, x, y - bob, hc.o);
    px(ctx, x + 1, y - bob, hc.o);
    px(ctx, x, y + 1 - bob, hc.O);
    px(ctx, x + 1, y + 1 - bob, hc.O);

    // Legs
    px(ctx, x, y + 2 - bob, '#5B7DAF');
    px(ctx, x + 1, y + 2 - bob, '#5B7DAF');

    // Suitcase
    px(ctx, x + 2, y + 1 - bob, '#8B6B3E');
    px(ctx, x + 2, y - bob, '#9A7A4E');
  }

  return {
    setStationBuilt,
    queueArrival,
    isAnimating,
    getArrivingBuddies,
    update,
    draw,
    STATION_X,
    TRACK_Y,
    PLATFORM_Y,
  };
})();
