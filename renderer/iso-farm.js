// Top-Down Farm — Harvest Moon style layout.
// Maps crop plots, animals, buildings, and buddies onto the rectangular grid.
// Reads Farm.getState() each frame and updates IsoEngine + IsoEntityManager.
const IsoFarm = (() => {
  const MAP_W = 20;
  const MAP_H = 18;
  let initialized = false;
  let lastStateHash = '';
  let prevPlotStates = []; // Track previous crop states for harvest detection

  // ===== Grid layout (Harvest Moon style) =====
  //
  //  Row 0-1:   Grass border (top) + decorative trees
  //  Row 2:     Dirt border (top of field)
  //  Row 3-8:   Crop field: left section (col 4-6) + center path (col 7) + right section (col 8-10)
  //  Row 9:     Dirt border (bottom of field)
  //  Row 10-11: Path + character area
  //  Row 12-14: Pasture (animals)
  //  Row 15-17: Town / buildings

  // Crop plots: 12 plots arranged as 6 rows × 2 sections
  // Each plot is a ROW of 3 tiles (like Harvest Moon's dense crop rows)
  // Left section: cols 4-6, Right section: cols 8-10
  const PLOT_WIDTH = 3;
  const PLOT_POSITIONS = [];
  for (let r = 0; r < 6; r++) {
    PLOT_POSITIONS.push({ col: 4, row: 3 + r, width: PLOT_WIDTH }); // Left
    PLOT_POSITIONS.push({ col: 8, row: 3 + r, width: PLOT_WIDTH }); // Right
  }
  // Reorder: [0]=left r3, [1]=right r3, [2]=left r4, [3]=right r4, ...

  // Field bounds (for terrain painting)
  const FIELD = { minCol: 3, maxCol: 11, minRow: 2, maxRow: 9 };

  // Pasture zone (animals roam)
  const PASTURE_ZONE = { minCol: 1, maxCol: 18, minRow: 11, maxRow: 14 };

  // Animal home positions
  const ANIMAL_HOMES = {
    chicken: { col: 3,  row: 12 },
    cow:     { col: 7,  row: 13 },
    pig:     { col: 11, row: 12 },
    sheep:   { col: 15, row: 13 },
    cat:     { col: 5,  row: 14 },
    dog:     { col: 13, row: 14 },
  };

  // Building positions (town row)
  const BUILDING_POSITIONS = {
    well:     { col: 2,  row: 15 },
    barn:     { col: 5,  row: 15 },
    windmill: { col: 8,  row: 15 },
    market:   { col: 11, row: 15 },
    clock:    { col: 14, row: 15 },
    townhall: { col: 4,  row: 17 },
    statue:   { col: 15, row: 17 },
  };

  // Tree positions (decorative border)
  const TREE_POSITIONS = [
    [0, 0], [1, 0], [13, 0], [14, 0], [18, 0], [19, 0],
    [0, 1], [19, 1],
    [0, 10], [1, 10], [13, 10], [19, 10],
    [0, 14], [19, 14],
    [0, 17], [1, 17], [18, 17], [19, 17],
  ];

  // Flower/bush decorations
  const FLOWER_POSITIONS = [
    [1, 2], [13, 2], [14, 3], [1, 8], [13, 8],
    [15, 5], [16, 4], [17, 6], [18, 5], [12, 4], [12, 7],
  ];

  const HOODIE_COLOR_NAMES = ['blue', 'red', 'green', 'purple', 'orange', 'teal', 'pink', 'yellow'];

  const CROP_COLORS = {
    carrot:     '#FF8C00',
    sunflower:  '#FFD700',
    watermelon: '#2E8B57',
    tomato:     '#FF4444',
    corn:       '#F0E68C',
    pumpkin:    '#FF7518',
  };

  // Tracked entity references
  let animalEntities = new Map();
  let cropEntities = [];
  let buildingEntities = [];
  let buddyEntities = new Map();
  let decorEntities = [];

  // ===== Initialization =====

  function init() {
    if (initialized) return;
    initialized = true;

    IsoEngine.initMap(MAP_W, MAP_H, 'grass');

    // -- Paint terrain --

    // Crop field: two soil sections with center path
    for (let r = 3; r <= 8; r++) {
      // Left section
      for (let c = 4; c <= 6; c++) IsoEngine.setTile(c, r, 'soil');
      // Center walking path
      IsoEngine.setTile(7, r, 'path');
      // Right section
      for (let c = 8; c <= 10; c++) IsoEngine.setTile(c, r, 'soil');
    }

    // Dirt border around field
    for (let c = FIELD.minCol; c <= FIELD.maxCol; c++) {
      IsoEngine.setTile(c, FIELD.minRow, 'dirt');
      IsoEngine.setTile(c, FIELD.maxRow, 'dirt');
    }
    for (let r = FIELD.minRow; r <= FIELD.maxRow; r++) {
      IsoEngine.setTile(FIELD.minCol, r, 'dirt');
      IsoEngine.setTile(FIELD.maxCol, r, 'dirt');
    }

    // Path running horizontally below field
    for (let c = 0; c < MAP_W; c++) {
      IsoEngine.setTile(c, 10, 'path');
      IsoEngine.setTile(c, 11, 'path');
    }

    // Small pond in pasture
    IsoEngine.setTile(16, 12, 'water');
    IsoEngine.setTile(17, 12, 'water');
    IsoEngine.setTile(16, 13, 'water');
    IsoEngine.setTile(17, 13, 'water');
    // Sand around pond
    IsoEngine.setTile(15, 12, 'sand');
    IsoEngine.setTile(15, 13, 'sand');
    IsoEngine.setTile(18, 12, 'sand');
    IsoEngine.setTile(18, 13, 'sand');
    IsoEngine.setTile(16, 11, 'sand');
    IsoEngine.setTile(17, 11, 'sand');
    IsoEngine.setTile(16, 14, 'sand');
    IsoEngine.setTile(17, 14, 'sand');

    // Town area: stone ground
    for (let r = 15; r < MAP_H; r++) {
      for (let c = 0; c < MAP_W; c++) {
        IsoEngine.setTile(c, r, 'stone');
      }
    }

    // -- Static decorations --
    // Trees
    for (const [c, r] of TREE_POSITIONS) {
      const ent = IsoEntityManager.add(IsoEntityManager.createStatic(c, r,
        (ctx, sx, sy, tick) => IsoEngine.drawIsoTree(ctx, sx, sy, tick)
      ));
      decorEntities.push(ent);
    }

    // Flowers/bushes
    for (const [c, r] of FLOWER_POSITIONS) {
      const ent = IsoEntityManager.add(IsoEntityManager.createStatic(c, r,
        (ctx, sx, sy, tick) => drawFlower(ctx, sx, sy, tick, c + r)
      ));
      decorEntities.push(ent);
    }

    // Bulletin board (usage data sign, right of crop fields)
    const boardEnt = IsoEntityManager.add(IsoEntityManager.createStatic(12, 5,
      (ctx, sx, sy, tick) => drawBulletinBoard(ctx, sx, sy, tick),
      { signType: 'bulletin' }
    ));
    decorEntities.push(boardEnt);

    // Center camera on the crop area (tightly zoomed)
    IsoEngine.setZoom(1.8);
    IsoEngine.centerOnTile(7, 5, 660, 500);
  }

  // Draw a small flower bush
  function drawFlower(ctx, sx, sy, tick, seed) {
    const colors = ['#E84393', '#FFD700', '#FF6B8A', '#9B59B6', '#E8734A'];
    const color = colors[seed % colors.length];
    const sway = Math.sin(tick * 0.03 + seed) * 1;

    // Green base
    ctx.fillStyle = '#5AAE45';
    ctx.beginPath();
    ctx.ellipse(sx + sway, sy - 2, 6, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Flower dots
    for (let i = 0; i < 3; i++) {
      const fx = sx + Math.cos(seed * 2.3 + i * 2.1) * 4 + sway;
      const fy = sy - 3 + Math.sin(seed * 1.7 + i * 1.9) * 3;
      ctx.fillStyle = colors[(seed + i) % colors.length];
      ctx.fillRect(Math.round(fx) - 1, Math.round(fy) - 1, 3, 3);
    }
  }

  // Bulletin board — wooden sign showing usage data
  function drawBulletinBoard(ctx, sx, sy, tick) {
    // Wooden post
    ctx.fillStyle = '#6B4226';
    ctx.fillRect(sx - 2, sy - 28, 4, 28);

    // Board frame (wooden)
    ctx.fillStyle = '#8B5A2B';
    ctx.fillRect(sx - 14, sy - 38, 28, 14);
    // Board face
    ctx.fillStyle = '#D4A460';
    ctx.fillRect(sx - 12, sy - 36, 24, 10);

    // Text on board (tiny "INFO")
    ctx.fillStyle = '#4A2800';
    ctx.font = 'bold 6px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('INFO', sx, sy - 31);

    // Small blinking indicator
    if (((tick / 40) | 0) % 2 === 0) {
      ctx.fillStyle = '#FFD700';
      ctx.fillRect(sx + 10, sy - 37, 3, 3);
    }
  }

  // ===== Sync farm state to world =====

  function syncState() {
    const state = (typeof Farm !== 'undefined') ? Farm.getState() : null;
    if (!state) return;

    const hash = `${state.totalEnergy}-${state.milestoneReached}-${(state.plots || []).map(p => `${p.crop}${p.stage}`).join(',')}`;
    if (hash === lastStateHash) return;
    lastStateHash = hash;

    syncCrops(state);
    syncAnimals(state);
    syncBuildings(state);
  }

  function syncCrops(state) {
    for (const ent of cropEntities) IsoEntityManager.remove(ent);
    cropEntities = [];

    if (!state.plots) return;

    const energy = state.totalEnergy || 0;

    for (let i = 0; i < state.plots.length && i < PLOT_POSITIONS.length; i++) {
      const plot = state.plots[i];
      const pos = PLOT_POSITIONS[i];
      const plotWidth = pos.width || 1;

      // Detect harvest: previous stage was 4 (mature) and now reset to lower stage
      const prev = prevPlotStates[i];
      if (prev && prev.stage === 4 && plot.stage < prev.stage) {
        const harvestColor = CROP_COLORS[prev.crop] || '#FFD700';
        // Spawn particles at each tile of the plot row
        for (let tc = 0; tc < plotWidth; tc++) {
          IsoEngine.spawnHarvestParticles(pos.col + tc, pos.row, harvestColor, 8);
          // Also spawn golden sparkles
          IsoEngine.spawnHarvestParticles(pos.col + tc, pos.row, '#FFD700', 4);
        }
      }

      // Check if plot is unlocked
      let unlocked = false;
      if (i < 3) unlocked = energy >= 50;
      else if (i < 6) unlocked = energy >= 500;
      else if (i < 9) unlocked = energy >= 1800;
      else unlocked = energy >= 5000;

      // Each plot spans multiple tiles (a crop row)
      for (let tc = 0; tc < plotWidth; tc++) {
        const tileCol = pos.col + tc;
        const tileRow = pos.row;

        if (!unlocked) {
          IsoEngine.setTile(tileCol, tileRow, 'dirt');
          continue;
        }

        IsoEngine.setTile(tileCol, tileRow, plot.crop ? 'soilwet' : 'soil');

        if (plot.crop && plot.stage > 0) {
          const cropType = plot.crop;
          const stage = plot.stage;
          const isMature = stage >= 4;
          const cropSpriteId = `crop_${cropType}`;
          const ent = IsoEntityManager.add(IsoEntityManager.createStatic(tileCol, tileRow,
            (ctx, sx, sy, tick) => {
              // Mature glow aura (drawn BEHIND the crop)
              if (isMature) {
                IsoEngine.drawMatureGlow(ctx, sx, sy, tick, CROP_COLORS[cropType]);
              }
              if (typeof SpriteManager !== 'undefined' && SpriteManager.has(cropSpriteId)) {
                SpriteManager.drawStatic(ctx, cropSpriteId, sx, sy, Math.min(stage - 1, 3));
              } else {
                IsoEngine.drawIsoCrop(ctx, sx, sy, stage, cropType, tick);
              }
            },
            { spriteId: null }
          ));
          cropEntities.push(ent);
        }
      }
    }

    // Save current state for next harvest detection
    prevPlotStates = state.plots.map(p => ({ crop: p.crop, stage: p.stage }));
  }

  function syncAnimals(state) {
    if (!state.animals) return;

    const animalTypes = ['chicken', 'cow', 'pig', 'sheep', 'cat', 'dog'];
    for (const type of animalTypes) {
      const info = state.animals[type];
      const isUnlocked = info && info.unlocked;
      const exists = animalEntities.has(type);

      if (isUnlocked && !exists) {
        const home = ANIMAL_HOMES[type];
        const ent = IsoEntityManager.add(IsoEntityManager.createAnimal(type, home.col, home.row, {
          wanderRadius: 2.5,
          minCol: PASTURE_ZONE.minCol,
          maxCol: PASTURE_ZONE.maxCol,
          minRow: PASTURE_ZONE.minRow,
          maxRow: PASTURE_ZONE.maxRow,
        }));
        animalEntities.set(type, ent);
      } else if (!isUnlocked && exists) {
        IsoEntityManager.remove(animalEntities.get(type));
        animalEntities.delete(type);
      }
    }

    // Sync vibe mood
    const vibe = (typeof Farm !== 'undefined') ? Farm.getVibe() : null;
    const mood = (vibe && vibe.atmosphere && vibe.atmosphere.animalMood) || 'calm';
    IsoEntityManager.setAnimalMood(mood);
  }

  function syncBuildings(state) {
    if (!state.buildings) return;

    for (const ent of buildingEntities) IsoEntityManager.remove(ent);
    buildingEntities = [];

    const buildingTypes = ['well', 'barn', 'windmill', 'market', 'clock', 'townhall', 'statue'];
    for (const bld of buildingTypes) {
      if (!state.buildings[bld]) continue;
      const pos = BUILDING_POSITIONS[bld];
      if (!pos) continue;

      const ent = IsoEntityManager.add(IsoEntityManager.createStatic(pos.col, pos.row,
        (ctx, sx, sy, tick) => drawBuilding(ctx, sx, sy, bld, tick),
        { z: 0 }
      ));
      buildingEntities.push(ent);
    }
  }

  // ===== Buddy management =====

  function syncBuddy(sessionId, project, colorIndex, state) {
    if (!buddyEntities.has(sessionId)) {
      const slotCol = 4 + buddyEntities.size * 2;
      const hoodieColors = ['#5B8DD9','#E8734A','#6AB04C','#9B59B6','#F39C12','#1ABC9C','#E84393','#F1C40F'];
      const color = hoodieColors[colorIndex % hoodieColors.length];
      const colorName = HOODIE_COLOR_NAMES[colorIndex % HOODIE_COLOR_NAMES.length];

      const ent = IsoEntityManager.add(IsoEntityManager.createCharacter(
        Math.min(slotCol, MAP_W - 2), 10, {
          hoodieColor: color,
          name: project,
          direction: 'down',
          spriteId: `char_${colorName}`,
        }
      ));
      buddyEntities.set(sessionId, ent);
    }
  }

  function removeBuddy(sessionId) {
    if (buddyEntities.has(sessionId)) {
      IsoEntityManager.remove(buddyEntities.get(sessionId));
      buddyEntities.delete(sessionId);
    }
  }

  // ===== Building drawing (top-down Harvest Moon style) =====

  function drawBuilding(ctx, sx, sy, type, tick) {
    const spriteId = `building_${type}`;
    if (typeof SpriteManager !== 'undefined' && SpriteManager.has(spriteId)) {
      SpriteManager.drawStatic(ctx, spriteId, sx, sy);
      if (type === 'windmill') drawWindmillBlades(ctx, sx, sy, tick);
      return;
    }

    switch (type) {
      case 'well': drawWell(ctx, sx, sy, tick); break;
      case 'barn': drawBarn(ctx, sx, sy, tick); break;
      case 'windmill': drawWindmill(ctx, sx, sy, tick); break;
      case 'market': drawMarket(ctx, sx, sy, tick); break;
      case 'clock': drawClock(ctx, sx, sy, tick); break;
      case 'townhall': drawTownhall(ctx, sx, sy, tick); break;
      case 'statue': drawStatue(ctx, sx, sy, tick); break;
    }
  }

  function drawWell(ctx, sx, sy, tick) {
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(sx - 10, sy + 3, 20, 8);
    ctx.fillStyle = '#A0A0A0';
    ctx.beginPath();
    ctx.ellipse(sx, sy - 4, 12, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#808080';
    ctx.beginPath();
    ctx.ellipse(sx, sy - 4, 8, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4A90D9';
    ctx.beginPath();
    ctx.ellipse(sx, sy - 4, 6, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#B04838';
    ctx.fillRect(sx - 10, sy - 18, 20, 4);
    ctx.fillStyle = '#8B6B3E';
    ctx.fillRect(sx - 9, sy - 18, 3, 16);
    ctx.fillRect(sx + 6, sy - 18, 3, 16);
    if ((tick / 15 | 0) % 3 === 0) {
      ctx.fillStyle = '#88D0F0';
      ctx.fillRect(sx - 1, sy - 5, 2, 2);
    }
  }

  function drawBarn(ctx, sx, sy, tick) {
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(sx - 16, sy + 5, 32, 10);
    ctx.fillStyle = '#D05050';
    ctx.fillRect(sx - 14, sy - 16, 28, 22);
    ctx.fillStyle = '#C04040';
    ctx.fillRect(sx - 12, sy - 14, 24, 18);
    ctx.fillStyle = '#8B4040';
    ctx.fillRect(sx - 16, sy - 22, 32, 6);
    ctx.fillStyle = '#8B6B3E';
    ctx.fillRect(sx - 4, sy - 2, 8, 8);
    ctx.fillStyle = '#FFE0A0';
    ctx.fillRect(sx - 10, sy - 10, 5, 4);
    ctx.fillRect(sx + 6, sy - 10, 5, 4);
    ctx.strokeStyle = '#6B5030';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx - 3, sy - 1); ctx.lineTo(sx + 3, sy + 5);
    ctx.moveTo(sx + 3, sy - 1); ctx.lineTo(sx - 3, sy + 5);
    ctx.stroke();
  }

  function drawWindmill(ctx, sx, sy, tick) {
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(sx - 8, sy + 5, 16, 8);
    ctx.fillStyle = '#E8D8C0';
    ctx.fillRect(sx - 6, sy - 22, 12, 24);
    ctx.fillStyle = '#D8C8B0';
    ctx.fillRect(sx - 4, sy - 20, 8, 20);
    ctx.fillStyle = '#B04838';
    ctx.fillRect(sx - 7, sy - 26, 14, 4);
    ctx.fillStyle = '#8B6B3E';
    ctx.fillRect(sx - 2, sy - 2, 5, 5);
    drawWindmillBlades(ctx, sx, sy - 16, tick);
  }

  function drawWindmillBlades(ctx, sx, sy, tick) {
    const angle = (tick * 0.03) % (Math.PI * 2);
    const bladeLen = 20;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(angle);
    ctx.fillStyle = '#C8A870';
    for (let i = 0; i < 4; i++) {
      ctx.save();
      ctx.rotate(i * Math.PI / 2);
      ctx.fillRect(-1, 0, 4, bladeLen);
      ctx.fillStyle = '#D8B880';
      ctx.fillRect(0, 2, 3, bladeLen - 4);
      ctx.restore();
    }
    ctx.restore();
    ctx.fillStyle = '#666';
    ctx.beginPath();
    ctx.arc(sx, sy, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawMarket(ctx, sx, sy, tick) {
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(sx - 14, sy + 3, 28, 8);
    ctx.fillStyle = '#C8A060';
    ctx.fillRect(sx - 12, sy - 4, 24, 10);
    const stripeColors = ['#E84040', '#FFD700', '#4A90D9', '#6AB04C'];
    for (let i = 0; i < 24; i++) {
      ctx.fillStyle = stripeColors[i % stripeColors.length];
      ctx.fillRect(sx - 12 + i, sy - 12, 1, 5);
    }
    ctx.fillStyle = '#FFF';
    ctx.fillRect(sx - 12, sy - 7, 24, 3);
    ctx.fillStyle = '#8B6B3E';
    ctx.fillRect(sx - 12, sy - 12, 2, 14);
    ctx.fillRect(sx + 10, sy - 12, 2, 14);
    ctx.fillStyle = '#FF8C00';
    ctx.fillRect(sx - 7, sy - 3, 4, 4);
    ctx.fillStyle = '#FF4444';
    ctx.fillRect(sx - 1, sy - 3, 4, 4);
    ctx.fillStyle = '#2E8B57';
    ctx.fillRect(sx + 5, sy - 3, 4, 4);
  }

  function drawClock(ctx, sx, sy, tick) {
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(sx - 6, sy + 5, 12, 5);
    ctx.fillStyle = '#D0C0A0';
    ctx.fillRect(sx - 6, sy - 28, 12, 30);
    ctx.fillStyle = '#C8B898';
    ctx.fillRect(sx - 5, sy - 26, 10, 26);
    ctx.fillStyle = '#8B4040';
    ctx.fillRect(sx - 7, sy - 32, 14, 4);
    ctx.fillRect(sx - 5, sy - 34, 10, 3);
    ctx.fillStyle = '#FFF8E0';
    ctx.beginPath();
    ctx.arc(sx, sy - 18, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#8B6B3E';
    ctx.lineWidth = 1;
    ctx.stroke();
    const hourA = (tick * 0.002) % (Math.PI * 2);
    const minA = (tick * 0.02) % (Math.PI * 2);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx, sy - 18);
    ctx.lineTo(sx + Math.cos(hourA) * 3, sy - 18 + Math.sin(hourA) * 3);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx, sy - 18);
    ctx.lineTo(sx + Math.cos(minA) * 4, sy - 18 + Math.sin(minA) * 4);
    ctx.stroke();
  }

  function drawTownhall(ctx, sx, sy, tick) {
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(sx - 18, sy + 5, 36, 10);
    ctx.fillStyle = '#D8C8B8';
    ctx.fillRect(sx - 16, sy - 18, 32, 22);
    ctx.fillStyle = '#C0B0A0';
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(sx - 12 + i * 8, sy - 16, 3, 18);
    }
    ctx.fillStyle = '#A08878';
    ctx.fillRect(sx - 18, sy - 24, 36, 6);
    ctx.fillRect(sx - 14, sy - 26, 28, 3);
    ctx.fillStyle = '#8B6B3E';
    ctx.fillRect(sx - 4, sy - 4, 8, 8);
    const wave = ((tick / 10) | 0) % 2;
    ctx.fillStyle = '#8B6B3E';
    ctx.fillRect(sx, sy - 32, 2, 10);
    ctx.fillStyle = '#E84040';
    ctx.fillRect(sx + 2 + wave, sy - 32, 8, 5);
  }

  function drawStatue(ctx, sx, sy, tick) {
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(sx - 6, sy + 3, 12, 5);
    ctx.fillStyle = '#A0A0A0';
    ctx.fillRect(sx - 6, sy - 4, 12, 8);
    ctx.fillStyle = '#B0B0B0';
    ctx.fillRect(sx - 5, sy - 3, 10, 6);
    ctx.fillStyle = '#C8C8C0';
    ctx.fillRect(sx - 3, sy - 16, 6, 12);
    ctx.fillRect(sx - 2, sy - 19, 4, 3);
    ctx.fillRect(sx + 3, sy - 16, 3, 8);
    ctx.fillRect(sx + 5, sy - 19, 2, 3);
    const sparkle = ((tick / 8) | 0) % 4;
    if (sparkle === 0) {
      ctx.fillStyle = '#FFD700';
      ctx.fillRect(sx + 5, sy - 21, 2, 2);
    }
    if (sparkle === 2) {
      ctx.fillStyle = '#FFF8D0';
      ctx.fillRect(sx - 4, sy - 20, 2, 2);
    }
  }

  // ===== HUD — Harvest Moon style =====

  function drawHUD(ctx, canvasW, canvasH, tick) {
    const state = (typeof Farm !== 'undefined') ? Farm.getState() : null;
    if (!state) return;

    const energy = state.totalEnergy || 0;
    const vibe = (typeof Farm !== 'undefined') ? Farm.getVibe() : null;

    // Top-left: Energy (like stamina)
    drawEnergyBar(ctx, 8, 8, energy);

    // Top-right: Status panel (date/milestone/currency)
    drawStatusPanel(ctx, canvasW - 158, 8, energy, state, tick);

    // Bottom-left: Animal/crop count
    const animalCount = animalEntities.size;
    const cropCount = cropEntities.length;
    if (animalCount > 0 || cropCount > 0) {
      ctx.fillStyle = 'rgba(20, 20, 40, 0.7)';
      roundRect(ctx, 8, canvasH - 26, 130, 20, 4);
      ctx.fill();
      ctx.fillStyle = '#FFF';
      ctx.font = '9px monospace';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(`\u{1F43E}${animalCount}  \u{1F33E}${cropCount}`, 14, canvasH - 16);
    }

    // Vibe indicator (bottom-right)
    if (vibe) {
      drawVibeIndicator(ctx, canvasW - 110, canvasH - 26, vibe);
    }
  }

  function drawEnergyBar(ctx, x, y, energy) {
    const barW = 100;
    const barH = 14;

    ctx.fillStyle = 'rgba(20, 20, 40, 0.75)';
    roundRect(ctx, x, y, barW + 40, barH + 8, 4);
    ctx.fill();

    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 11px monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('\u26A1', x + 4, y + barH / 2 + 4);

    ctx.fillStyle = '#FFF';
    ctx.font = 'bold 10px monospace';
    ctx.fillText(formatEnergy(energy), x + 18, y + barH / 2 + 4);

    const barX = x + 55;
    const barY = y + 5;
    ctx.fillStyle = '#333';
    roundRect(ctx, barX, barY, barW - 20, barH - 2, 3);
    ctx.fill();

    const ms = findMilestone(energy);
    const milestoneEnergies = [50, 150, 300, 500, 800, 1200, 1800, 2500, 3500, 5000, 7500, 10000];
    let progress = 0;
    if (ms) {
      const idx = milestoneEnergies.indexOf(ms.energy);
      const nextE = milestoneEnergies[idx + 1] || ms.energy * 1.5;
      progress = Math.min(1, (energy - ms.energy) / (nextE - ms.energy));
    } else {
      progress = Math.min(1, energy / 50);
    }
    const fillW = Math.max(2, (barW - 22) * progress);
    const barColor = energy >= 5000 ? '#FFD700' : energy >= 2500 ? '#6AB04C' : energy >= 800 ? '#4A90D9' : '#E8734A';
    ctx.fillStyle = barColor;
    roundRect(ctx, barX + 1, barY + 1, fillW, barH - 4, 2);
    ctx.fill();
  }

  function drawStatusPanel(ctx, x, y, energy, state, tick) {
    const panelW = 150;
    const panelH = 38;

    ctx.fillStyle = 'rgba(20, 20, 40, 0.75)';
    roundRect(ctx, x, y, panelW, panelH, 4);
    ctx.fill();

    const ms = findMilestone(energy);
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 10px monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(ms ? `${ms.emoji} ${ms.label}` : '\u{1F331} Starting', x + 6, y + 12);

    ctx.fillStyle = '#CCC';
    ctx.font = '9px monospace';
    const harvests = state.totalHarvests || 0;
    ctx.fillText(`\u{1F33E}${harvests} harvests`, x + 6, y + 28);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#FFD700';
    ctx.fillText(`${formatEnergy(energy)}G`, x + panelW - 6, y + 28);
    ctx.textAlign = 'left';
  }

  function drawVibeIndicator(ctx, x, y, vibe) {
    ctx.fillStyle = 'rgba(20, 20, 40, 0.7)';
    roundRect(ctx, x, y, 102, 20, 4);
    ctx.fill();

    const moodEmoji = { productive: '\u{1F525}', focused: '\u{1F3AF}', exploring: '\u{1F50D}', debugging: '\u{1F41B}', working: '\u{2699}', idle: '\u{1F4A4}' };
    const emoji = moodEmoji[vibe.mood] || '\u{2699}';
    ctx.fillStyle = '#FFF';
    ctx.font = '9px monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(`${emoji} ${vibe.mood}`, x + 4, y + 10);

    const score = vibe.vibeScore || 0;
    const barColor = score >= 0.75 ? '#FFD700' : score >= 0.5 ? '#6AB04C' : '#4A90D9';
    ctx.fillStyle = '#333';
    ctx.fillRect(x + 70, y + 5, 26, 6);
    ctx.fillStyle = barColor;
    ctx.fillRect(x + 70, y + 5, Math.floor(26 * score), 6);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  function formatEnergy(n) {
    if (n >= 10000) return (n / 1000).toFixed(1) + 'k';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }

  function findMilestone(energy) {
    const milestones = [
      { energy: 50,    emoji: '\u{1F955}', label: 'Seed' },
      { energy: 150,   emoji: '\u{1F33B}', label: 'Gardener' },
      { energy: 300,   emoji: '\u{1F349}', label: 'Green' },
      { energy: 500,   emoji: '\u{1F345}', label: 'Farmer' },
      { energy: 800,   emoji: '\u{1F33D}', label: 'Rancher' },
      { energy: 1200,  emoji: '\u{1F383}', label: 'Pioneer' },
      { energy: 1800,  emoji: '\u{1F411}', label: 'Villager' },
      { energy: 2500,  emoji: '\u{1F431}', label: 'Founder' },
      { energy: 3500,  emoji: '\u{1F415}', label: 'Thriving' },
      { energy: 5000,  emoji: '\u{1F550}', label: 'Prosper' },
      { energy: 7500,  emoji: '\u{1F3DB}', label: 'Metro' },
      { energy: 10000, emoji: '\u{1F5FF}', label: 'Legend' },
    ];
    let best = null;
    for (const m of milestones) if (energy >= m.energy) best = m;
    return best;
  }

  return {
    MAP_W, MAP_H,
    FIELD, PASTURE_ZONE,
    PLOT_POSITIONS, BUILDING_POSITIONS, ANIMAL_HOMES,
    init, syncState, syncBuddy, removeBuddy, drawHUD,
  };
})();
