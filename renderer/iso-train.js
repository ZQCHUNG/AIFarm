// Iso Train — diagonal train arrival/departure in isometric coordinates.
// Train moves along a grid-aligned rail path, stops at the station,
// buddy disembarks, then train departs.
const IsoTrain = (() => {
  // Rail path: train enters from top-right, moves diagonally to station
  // Path follows decreasing col along row 7 (the path row)
  const STATION_COL = 14;
  const STATION_ROW = 7;
  const RAIL_ROW = 7;

  // Train visual size (in grid units)
  const TRAIN_LENGTH = 3; // 3 tiles long (loco + 2 cars)

  // Animation phases
  const PHASE = {
    APPROACHING: 'approaching',
    STOPPING: 'stopping',
    DISEMBARKING: 'disembarking',
    DEPARTING: 'departing',
    DONE: 'done',
  };

  // Speed (grid units per tick)
  const APPROACH_SPEED = 0.04;
  const DEPART_SPEED = 0.06;
  const WALK_SPEED = 0.02;
  const STOP_DURATION = 60; // ticks

  // Queue of train arrivals
  const arrivals = [];
  let stationBuilt = false;

  // ===== Public API =====

  function setStationBuilt(built) {
    stationBuilt = built;
  }

  function queueArrival(buddyName, colorIndex) {
    if (!stationBuilt) return;
    arrivals.push({
      buddyName,
      colorIndex: colorIndex || 0,
      phase: PHASE.APPROACHING,
      // Train head position (grid coords, float)
      trainCol: STATION_COL + 8, // start off-screen
      trainRow: RAIL_ROW,
      stopCol: STATION_COL,
      // Disembarking buddy position
      buddyCol: 0,
      buddyRow: 0,
      buddyTargetCol: 0,
      buddyTargetRow: 0,
      stopTick: 0,
      startTick: 0,
    });
  }

  function isAnimating() {
    return arrivals.length > 0;
  }

  // ===== Update =====

  function update(tick) {
    for (let i = arrivals.length - 1; i >= 0; i--) {
      const a = arrivals[i];
      if (a.startTick === 0) a.startTick = tick;

      switch (a.phase) {
        case PHASE.APPROACHING:
          a.trainCol -= APPROACH_SPEED;
          if (a.trainCol <= a.stopCol) {
            a.trainCol = a.stopCol;
            a.phase = PHASE.STOPPING;
            a.stopTick = tick;
          }
          break;

        case PHASE.STOPPING:
          if (tick - a.stopTick > STOP_DURATION) {
            a.phase = PHASE.DISEMBARKING;
            a.buddyCol = a.trainCol - 1;
            a.buddyRow = a.trainRow;
            a.buddyTargetCol = a.trainCol - 3;
            a.buddyTargetRow = a.trainRow + 1;
          }
          break;

        case PHASE.DISEMBARKING:
          // Buddy walks away from train
          const bDx = a.buddyTargetCol - a.buddyCol;
          const bDy = a.buddyTargetRow - a.buddyRow;
          const bDist = Math.sqrt(bDx * bDx + bDy * bDy);
          if (bDist > 0.3) {
            a.buddyCol += (bDx / bDist) * WALK_SPEED;
            a.buddyRow += (bDy / bDist) * WALK_SPEED;
          } else {
            a.phase = PHASE.DEPARTING;
            a.stopTick = tick;
          }
          break;

        case PHASE.DEPARTING:
          // Train departs to the left (decreasing col)
          a.trainCol -= DEPART_SPEED;
          if (a.trainCol < -TRAIN_LENGTH - 2) {
            a.phase = PHASE.DONE;
          }
          break;

        case PHASE.DONE:
          arrivals.splice(i, 1);
          break;
      }
    }
  }

  // ===== Draw =====

  function draw(ctx, tick) {
    if (!stationBuilt || typeof IsoEngine === 'undefined') return;

    // Draw rail track along the rail row
    drawRails(ctx, tick);

    // Draw station platform
    drawStation(ctx, tick);

    // Draw active arrivals
    for (const a of arrivals) {
      if (a.phase !== PHASE.DONE) {
        drawTrain(ctx, a.trainCol, a.trainRow, a.colorIndex, tick);

        if (a.phase === PHASE.DISEMBARKING) {
          drawMiniBuddy(ctx, a.buddyCol, a.buddyRow, a.colorIndex, tick);
        }
      }
    }
  }

  // ===== Rail tracks =====

  function drawRails(ctx, tick) {
    // Draw sleepers and rails along the path row
    for (let c = 0; c < 20; c++) {
      const { x, y } = IsoEngine.gridToScreen(c, RAIL_ROW);

      // Sleepers (diagonal lines across the diamond)
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = '#6B5030';
      ctx.lineWidth = 1;
      const hw = IsoEngine.TILE_W / 2;
      const hh = IsoEngine.TILE_H / 2;
      // Draw subtle rail marks on path tiles
      ctx.beginPath();
      ctx.moveTo(x - hw * 0.3, y - hh * 0.3);
      ctx.lineTo(x + hw * 0.3, y + hh * 0.3);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - hw * 0.5, y + hh * 0.1);
      ctx.lineTo(x + hw * 0.5, y - hh * 0.1);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ===== Station platform =====

  function drawStation(ctx, tick) {
    const { x, y } = IsoEngine.gridToScreen(STATION_COL, STATION_ROW);

    // Platform (raised diamond)
    const hw = IsoEngine.TILE_W / 2 + 4;
    const hh = IsoEngine.TILE_H / 2 + 2;

    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y - hh);
    ctx.lineTo(x + hw, y);
    ctx.lineTo(x, y + hh);
    ctx.lineTo(x - hw, y);
    ctx.closePath();
    ctx.fillStyle = '#B0A090';
    ctx.fill();
    ctx.strokeStyle = '#8B7355';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // Sign post
    ctx.fillStyle = '#8B6B3E';
    ctx.fillRect(x + 8, y - 18, 2, 14);
    // Sign
    ctx.fillStyle = '#E8D0A8';
    ctx.fillRect(x + 2, y - 20, 14, 6);
    ctx.fillStyle = '#333';
    ctx.font = '5px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('STATION', x + 9, y - 17);
  }

  // ===== Train sprite =====

  function drawTrain(ctx, trainCol, trainRow, colorIndex, tick) {
    const hoodieColors = ['#5B8DD9','#E8734A','#6AB04C','#9B59B6','#F39C12','#1ABC9C','#E84393','#F1C40F'];
    const color = hoodieColors[colorIndex % hoodieColors.length];

    // Draw 3 cars: loco at trainCol, cars at trainCol+1, trainCol+2
    for (let i = 0; i < TRAIN_LENGTH; i++) {
      const col = trainCol + i;
      const { x, y } = IsoEngine.gridToScreen(col, trainRow);

      if (i === 0) {
        // Locomotive
        drawLocomotive(ctx, x, y, color, tick);
      } else {
        // Passenger car
        drawCar(ctx, x, y, color, tick);
      }

      // Coupler between cars
      if (i < TRAIN_LENGTH - 1) {
        const nextPos = IsoEngine.gridToScreen(col + 0.5, trainRow);
        ctx.fillStyle = '#888';
        ctx.fillRect(nextPos.x - 1, nextPos.y - 2, 2, 2);
      }
    }

    // Steam puffs from locomotive
    const { x: locoX, y: locoY } = IsoEngine.gridToScreen(trainCol, trainRow);
    const puff = ((tick / 6) | 0) % 4;
    ctx.save();
    ctx.globalAlpha = 0.6 - puff * 0.15;
    ctx.fillStyle = '#DDD';
    ctx.beginPath();
    ctx.arc(locoX - 2 - puff * 3, locoY - 16 - puff * 2, 2 + puff, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawLocomotive(ctx, x, y, color, tick) {
    // Body (dark metal)
    ctx.fillStyle = '#444';
    ctx.fillRect(x - 8, y - 10, 16, 8);
    ctx.fillStyle = '#555';
    ctx.fillRect(x - 6, y - 8, 12, 5);

    // Cabin (hoodie color)
    ctx.fillStyle = color;
    ctx.fillRect(x + 3, y - 14, 6, 6);
    // Cabin window
    ctx.fillStyle = '#88C0E0';
    ctx.fillRect(x + 4, y - 13, 4, 3);
    // Driver silhouette
    ctx.fillStyle = '#222';
    ctx.fillRect(x + 5, y - 12, 2, 2);

    // Smokestack
    ctx.fillStyle = '#333';
    ctx.fillRect(x - 4, y - 14, 3, 4);
    ctx.fillStyle = '#444';
    ctx.fillRect(x - 5, y - 15, 5, 2);

    // Wheels
    ctx.fillStyle = '#222';
    const spin = ((tick / 4) | 0) % 2;
    for (let w = -6; w <= 6; w += 4) {
      ctx.fillRect(x + w, y - 2, 3, 3);
      if (spin) {
        ctx.fillStyle = '#555';
        ctx.fillRect(x + w + 1, y - 1, 1, 1);
        ctx.fillStyle = '#222';
      }
    }

    // Cowcatcher
    ctx.fillStyle = '#888';
    ctx.fillRect(x - 10, y - 4, 3, 3);
  }

  function drawCar(ctx, x, y, color, tick) {
    // Car body
    ctx.fillStyle = color;
    ctx.fillRect(x - 7, y - 10, 14, 8);
    // Lighter top
    ctx.fillStyle = adjustColor(color, 30);
    ctx.fillRect(x - 6, y - 9, 12, 3);

    // Windows
    ctx.fillStyle = '#88C0E0';
    for (let w = -4; w <= 4; w += 3) {
      ctx.fillRect(x + w, y - 8, 2, 2);
    }

    // Roof
    ctx.fillStyle = adjustColor(color, -30);
    ctx.fillRect(x - 8, y - 11, 16, 2);

    // Wheels
    ctx.fillStyle = '#222';
    for (let w = -5; w <= 5; w += 4) {
      ctx.fillRect(x + w, y - 2, 3, 3);
    }
  }

  // ===== Mini buddy (disembarking) =====

  function drawMiniBuddy(ctx, col, row, colorIndex, tick) {
    const { x, y } = IsoEngine.gridToScreen(col, row);
    const hoodieColors = ['#5B8DD9','#E8734A','#6AB04C','#9B59B6','#F39C12','#1ABC9C','#E84393','#F1C40F'];
    const color = hoodieColors[colorIndex % hoodieColors.length];
    const bob = ((tick / 10) | 0) % 2;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.ellipse(x, y + 1, 4, 2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Head
    ctx.fillStyle = '#4A3728';
    ctx.fillRect(x - 3, y - 12 - bob, 6, 2);
    ctx.fillStyle = '#FFD5B8';
    ctx.fillRect(x - 3, y - 10 - bob, 6, 4);
    // Eyes
    ctx.fillStyle = '#2C2C2C';
    ctx.fillRect(x - 2, y - 9 - bob, 2, 1);
    ctx.fillRect(x + 1, y - 9 - bob, 2, 1);

    // Body (hoodie)
    ctx.fillStyle = color;
    ctx.fillRect(x - 4, y - 6 - bob, 8, 5);

    // Legs
    ctx.fillStyle = '#5B7DAF';
    ctx.fillRect(x - 3, y - 1 - bob, 3, 2);
    ctx.fillRect(x + 1, y - 1 - bob, 3, 2);

    // Suitcase
    ctx.fillStyle = '#8B6B3E';
    ctx.fillRect(x + 5, y - 4 - bob, 3, 4);
    ctx.fillStyle = '#9A7A4E';
    ctx.fillRect(x + 5, y - 5 - bob, 3, 1);
  }

  // ===== Helpers =====

  function adjustColor(hex, amount) {
    const r = Math.min(255, Math.max(0, parseInt(hex.slice(1, 3), 16) + amount));
    const g = Math.min(255, Math.max(0, parseInt(hex.slice(3, 5), 16) + amount));
    const b = Math.min(255, Math.max(0, parseInt(hex.slice(5, 7), 16) + amount));
    return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
  }

  return {
    setStationBuilt,
    queueArrival,
    isAnimating,
    update,
    draw,
    STATION_COL,
    STATION_ROW,
  };
})();
