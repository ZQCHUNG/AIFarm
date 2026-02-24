// Iso Farm — bridges farm-state data to the isometric engine.
// Maps crop plots, animals, buildings, and buddies onto the iso grid.
// Reads Farm.getState() each frame and updates IsoEngine + IsoEntityManager.
const IsoFarm = (() => {
  const MAP_W = 16;
  const MAP_H = 16;
  let initialized = false;
  let lastStateHash = '';

  // ===== Grid layout zones =====
  // Crops: rows 2-5, cols 1-13 (12 plots in 2 rows of 6)
  const PLOT_POSITIONS = [
    { col: 2, row: 3 }, { col: 3, row: 3 }, { col: 4, row: 3 },
    { col: 5, row: 3 }, { col: 6, row: 3 }, { col: 7, row: 3 },
    { col: 2, row: 5 }, { col: 3, row: 5 }, { col: 4, row: 5 },
    { col: 5, row: 5 }, { col: 6, row: 5 }, { col: 7, row: 5 },
  ];

  // Pasture: rows 9-12 (animals roam here)
  const PASTURE_ZONE = { minCol: 1, maxCol: 14, minRow: 9, maxRow: 13 };

  // Animal home positions
  const ANIMAL_HOMES = {
    chicken: { col: 3,  row: 10 },
    cow:     { col: 7,  row: 11 },
    pig:     { col: 11, row: 10 },
    sheep:   { col: 5,  row: 12 },
    cat:     { col: 9,  row: 12 },
    dog:     { col: 13, row: 11 },
  };

  // Buildings: row 14-15 area
  const BUILDING_POSITIONS = {
    well:     { col: 1,  row: 14 },
    barn:     { col: 4,  row: 14 },
    windmill: { col: 7,  row: 14 },
    market:   { col: 10, row: 14 },
    clock:    { col: 13, row: 14 },
    townhall: { col: 3,  row: 15 },
    statue:   { col: 12, row: 15 },
  };

  // Path: runs through rows 7-8
  const PATH_ROWS = [7, 8];

  // Tree positions (border decoration)
  const TREE_POSITIONS = [
    [0,0],[1,1],[14,0],[15,1],[0,7],[15,7],
    [0,14],[15,14],[8,0],[9,0],
  ];

  // Hoodie color names matching SPRITE_CONFIG and Character.HOODIE_COLORS order
  const HOODIE_COLOR_NAMES = ['blue', 'red', 'green', 'purple', 'orange', 'teal', 'pink', 'yellow'];

  // Crop colors matching farm.js
  const CROP_COLORS = {
    carrot:     '#FF8C00',
    sunflower:  '#FFD700',
    watermelon: '#2E8B57',
    tomato:     '#FF4444',
    corn:       '#F0E68C',
    pumpkin:    '#FF7518',
  };

  // Tracked entity references for updates
  let animalEntities = new Map();
  let cropEntities = [];
  let buildingEntities = [];
  let buddyEntities = new Map();

  // ===== Initialization =====

  function init() {
    if (initialized) return;
    initialized = true;

    // Initialize the tile map
    IsoEngine.initMap(MAP_W, MAP_H, 'grass');

    // Paint permanent features
    // Path
    for (let c = 0; c < MAP_W; c++) {
      for (const r of PATH_ROWS) {
        IsoEngine.setTile(c, r, 'path');
      }
    }

    // Soil for crop plots (initially all soil, even if locked)
    for (const pos of PLOT_POSITIONS) {
      IsoEngine.setTile(pos.col, pos.row, 'soil');
      // Also set the row above/below for visual padding
      IsoEngine.setTile(pos.col, pos.row - 1, 'soil');
    }

    // Pond (decorative)
    for (let r = 10; r <= 12; r++) {
      for (let c = 9; c <= 10; c++) {
        IsoEngine.setTile(c, r, 'water');
      }
    }
    // Sand border around pond
    IsoEngine.setTile(8, 10, 'sand');
    IsoEngine.setTile(8, 11, 'sand');
    IsoEngine.setTile(8, 12, 'sand');
    IsoEngine.setTile(11, 10, 'sand');
    IsoEngine.setTile(11, 11, 'sand');
    IsoEngine.setTile(11, 12, 'sand');
    IsoEngine.setTile(9, 9, 'sand');
    IsoEngine.setTile(10, 9, 'sand');
    IsoEngine.setTile(9, 13, 'sand');
    IsoEngine.setTile(10, 13, 'sand');

    // Town area ground
    for (let r = 14; r < MAP_H; r++) {
      for (let c = 0; c < MAP_W; c++) {
        if (IsoEngine.getTile(c, r) === 'grass') {
          IsoEngine.setTile(c, r, 'stone');
        }
      }
    }

    // Trees (static entities)
    for (const [c, r] of TREE_POSITIONS) {
      IsoEntityManager.add(IsoEntityManager.createStatic(c, r,
        (ctx, sx, sy, tick) => IsoEngine.drawIsoTree(ctx, sx, sy, tick)
      ));
    }

    // Center camera
    IsoEngine.centerOnTile(8, 8, 640, 480);
  }

  // ===== Sync farm state to iso world =====

  function syncState() {
    const state = (typeof Farm !== 'undefined') ? Farm.getState() : null;
    if (!state) return;

    // Quick hash to detect changes
    const hash = `${state.totalEnergy}-${state.milestoneReached}-${(state.plots || []).map(p => `${p.crop}${p.stage}`).join(',')}`;
    if (hash === lastStateHash) return;
    lastStateHash = hash;

    syncCrops(state);
    syncAnimals(state);
    syncBuildings(state);
  }

  function syncCrops(state) {
    // Remove old crop entities
    for (const ent of cropEntities) {
      IsoEntityManager.remove(ent);
    }
    cropEntities = [];

    if (!state.plots) return;

    for (let i = 0; i < state.plots.length && i < PLOT_POSITIONS.length; i++) {
      const plot = state.plots[i];
      const pos = PLOT_POSITIONS[i];

      // Check if plot is unlocked
      const energy = state.totalEnergy || 0;
      let unlocked = false;
      if (i < 3) unlocked = energy >= 50;
      else if (i < 6) unlocked = energy >= 500;
      else if (i < 9) unlocked = energy >= 1800;
      else unlocked = energy >= 5000;

      if (!unlocked) {
        // Mark locked soil darker
        IsoEngine.setTile(pos.col, pos.row, 'dirt');
        continue;
      }

      IsoEngine.setTile(pos.col, pos.row, 'soil');

      if (plot.crop && plot.stage > 0) {
        const color = CROP_COLORS[plot.crop] || '#5AAE45';
        const stage = plot.stage;
        const cropSpriteId = `crop_${plot.crop}`;
        const ent = IsoEntityManager.add(IsoEntityManager.createStatic(pos.col, pos.row,
          (ctx, sx, sy, tick) => {
            // Try sprite-based crop rendering (variant = stage - 1 for 0-indexed)
            if (typeof SpriteManager !== 'undefined' && SpriteManager.has(cropSpriteId)) {
              SpriteManager.drawStatic(ctx, cropSpriteId, sx, sy, Math.min(stage - 1, 3));
            } else {
              IsoEngine.drawIsoCrop(ctx, sx, sy, stage, color, tick);
            }
          },
          { spriteId: null } // draw fn handles sprite check internally
        ));
        cropEntities.push(ent);
      }
    }
  }

  function syncAnimals(state) {
    if (!state.animals) return;

    const animalTypes = ['chicken', 'cow', 'pig', 'sheep', 'cat', 'dog'];
    for (const type of animalTypes) {
      const info = state.animals[type];
      const isUnlocked = info && info.unlocked;
      const exists = animalEntities.has(type);

      if (isUnlocked && !exists) {
        // Spawn new animal
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
        // Remove animal
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

    // Remove old building entities
    for (const ent of buildingEntities) {
      IsoEntityManager.remove(ent);
    }
    buildingEntities = [];

    const buildingTypes = ['well', 'barn', 'windmill', 'market', 'clock', 'townhall', 'statue'];
    for (const bld of buildingTypes) {
      if (!state.buildings[bld]) continue;
      const pos = BUILDING_POSITIONS[bld];
      if (!pos) continue;

      const ent = IsoEntityManager.add(IsoEntityManager.createStatic(pos.col, pos.row,
        (ctx, sx, sy, tick) => drawIsoBuilding(ctx, sx, sy, bld, tick),
        { z: 0 }
      ));
      buildingEntities.push(ent);
    }
  }

  // ===== Buddy management =====

  function syncBuddy(sessionId, project, colorIndex, state) {
    // Position buddies along the path (row 7)
    if (!buddyEntities.has(sessionId)) {
      const slotCol = 3 + buddyEntities.size * 2;
      const hoodieColors = ['#5B8DD9','#E8734A','#6AB04C','#9B59B6','#F39C12','#1ABC9C','#E84393','#F1C40F'];
      const color = hoodieColors[colorIndex % hoodieColors.length];

      const colorName = HOODIE_COLOR_NAMES[colorIndex % HOODIE_COLOR_NAMES.length];
      const ent = IsoEntityManager.add(IsoEntityManager.createCharacter(
        Math.min(slotCol, MAP_W - 2), 7, {
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

  // ===== Procedural iso building drawing =====

  function drawIsoBuilding(ctx, sx, sy, type, tick) {
    // Try sprite-based rendering first
    const spriteId = `building_${type}`;
    if (typeof SpriteManager !== 'undefined' && SpriteManager.has(spriteId)) {
      SpriteManager.drawStatic(ctx, spriteId, sx, sy);
      // Still draw animated overlays for windmill/clock on top of sprite
      if (type === 'windmill') drawWindmillBlades(ctx, sx, sy, tick);
      return;
    }
    // Procedural fallback
    switch (type) {
      case 'well':     drawIsoWell(ctx, sx, sy, tick); break;
      case 'barn':     drawIsoBarn(ctx, sx, sy, tick); break;
      case 'windmill': drawIsoWindmill(ctx, sx, sy, tick); break;
      case 'market':   drawIsoMarket(ctx, sx, sy, tick); break;
      case 'clock':    drawIsoClock(ctx, sx, sy, tick); break;
      case 'townhall': drawIsoTownhall(ctx, sx, sy, tick); break;
      case 'statue':   drawIsoStatue(ctx, sx, sy, tick); break;
    }
  }

  function drawWindmillBlades(ctx, sx, sy, tick) {
    const angle = (tick * 0.03) % (Math.PI * 2);
    const bladeLen = 14;
    ctx.save();
    ctx.strokeStyle = '#8B6B3E';
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const a = angle + i * Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy - 20);
      ctx.lineTo(sx + Math.cos(a) * bladeLen, sy - 20 + Math.sin(a) * bladeLen);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawIsoWell(ctx, sx, sy, tick) {
    // Stone base
    ctx.fillStyle = '#A0A0A0';
    ctx.fillRect(sx - 6, sy - 8, 12, 8);
    ctx.fillStyle = '#808080';
    ctx.fillRect(sx - 5, sy - 6, 10, 5);
    // Roof
    ctx.fillStyle = '#B04838';
    ctx.fillRect(sx - 7, sy - 14, 14, 3);
    // Posts
    ctx.fillStyle = '#8B6B3E';
    ctx.fillRect(sx - 5, sy - 14, 2, 8);
    ctx.fillRect(sx + 3, sy - 14, 2, 8);
    // Water sparkle
    if ((tick / 15 | 0) % 3 === 0) {
      ctx.fillStyle = '#88C0E0';
      ctx.fillRect(sx - 1, sy - 4, 2, 2);
    }
  }

  function drawIsoBarn(ctx, sx, sy, tick) {
    // Main body
    ctx.fillStyle = '#D05050';
    ctx.fillRect(sx - 12, sy - 18, 24, 16);
    ctx.fillStyle = '#C04040';
    ctx.fillRect(sx - 10, sy - 16, 20, 12);
    // Roof
    ctx.fillStyle = '#8B4040';
    ctx.fillRect(sx - 14, sy - 22, 28, 4);
    // Door
    ctx.fillStyle = '#8B6B3E';
    ctx.fillRect(sx - 3, sy - 8, 6, 8);
    // Windows
    ctx.fillStyle = '#FFE0A0';
    ctx.fillRect(sx - 9, sy - 12, 4, 3);
    ctx.fillRect(sx + 5, sy - 12, 4, 3);
  }

  function drawIsoWindmill(ctx, sx, sy, tick) {
    // Tower
    ctx.fillStyle = '#E8D8C0';
    ctx.fillRect(sx - 5, sy - 20, 10, 18);
    ctx.fillStyle = '#D8C8B0';
    ctx.fillRect(sx - 3, sy - 18, 6, 14);
    // Roof
    ctx.fillStyle = '#B04838';
    ctx.fillRect(sx - 6, sy - 24, 12, 4);
    // Rotating blades
    const angle = (tick * 0.03) % (Math.PI * 2);
    const bladeLen = 14;
    ctx.save();
    ctx.strokeStyle = '#8B6B3E';
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const a = angle + i * Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy - 20);
      ctx.lineTo(sx + Math.cos(a) * bladeLen, sy - 20 + Math.sin(a) * bladeLen);
      ctx.stroke();
    }
    ctx.restore();
    // Hub
    ctx.fillStyle = '#666';
    ctx.fillRect(sx - 2, sy - 22, 4, 4);
  }

  function drawIsoMarket(ctx, sx, sy, tick) {
    // Counter
    ctx.fillStyle = '#C8A060';
    ctx.fillRect(sx - 10, sy - 8, 20, 6);
    // Awning stripes
    const colors = ['#E84040', '#FFD700', '#4A90D9', '#E84040'];
    for (let i = 0; i < 20; i++) {
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(sx - 10 + i, sy - 14, 1, 3);
      ctx.fillStyle = colors[(i + 1) % colors.length];
      ctx.fillRect(sx - 10 + i, sy - 11, 1, 3);
    }
    // Poles
    ctx.fillStyle = '#8B6B3E';
    ctx.fillRect(sx - 10, sy - 14, 2, 12);
    ctx.fillRect(sx + 8, sy - 14, 2, 12);
    // Goods
    ctx.fillStyle = '#FF8C00';
    ctx.fillRect(sx - 6, sy - 8, 2, 2);
    ctx.fillStyle = '#FF4444';
    ctx.fillRect(sx - 1, sy - 8, 2, 2);
    ctx.fillStyle = '#2E8B57';
    ctx.fillRect(sx + 4, sy - 8, 2, 2);
  }

  function drawIsoClock(ctx, sx, sy, tick) {
    // Tower
    ctx.fillStyle = '#D0C0A0';
    ctx.fillRect(sx - 5, sy - 26, 10, 24);
    ctx.fillStyle = '#C8B898';
    ctx.fillRect(sx - 4, sy - 24, 8, 20);
    // Roof
    ctx.fillStyle = '#8B4040';
    ctx.fillRect(sx - 6, sy - 30, 12, 4);
    // Clock face
    ctx.fillStyle = '#FFF8E0';
    ctx.fillRect(sx - 3, sy - 20, 6, 6);
    // Clock hands
    const hourA = (tick * 0.002) % (Math.PI * 2);
    const minA = (tick * 0.02) % (Math.PI * 2);
    ctx.save();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx, sy - 17);
    ctx.lineTo(sx + Math.cos(hourA) * 2, sy - 17 + Math.sin(hourA) * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx, sy - 17);
    ctx.lineTo(sx + Math.cos(minA) * 3, sy - 17 + Math.sin(minA) * 3);
    ctx.stroke();
    ctx.restore();
  }

  function drawIsoTownhall(ctx, sx, sy, tick) {
    // Main body
    ctx.fillStyle = '#D8C8B8';
    ctx.fillRect(sx - 14, sy - 18, 28, 16);
    // Columns
    ctx.fillStyle = '#C8B8A8';
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(sx - 11 + i * 7, sy - 16, 2, 14);
    }
    // Roof/pediment
    ctx.fillStyle = '#A08878';
    ctx.fillRect(sx - 16, sy - 22, 32, 4);
    ctx.fillStyle = '#B09888';
    ctx.fillRect(sx - 10, sy - 24, 20, 2);
    // Door
    ctx.fillStyle = '#8B6B3E';
    ctx.fillRect(sx - 3, sy - 8, 6, 8);
    // Flag
    const wave = ((tick / 10) | 0) % 2;
    ctx.fillStyle = '#8B6B3E';
    ctx.fillRect(sx, sy - 30, 2, 8);
    ctx.fillStyle = '#E84040';
    ctx.fillRect(sx + 2 + wave, sy - 30, 6, 4);
  }

  function drawIsoStatue(ctx, sx, sy, tick) {
    // Pedestal
    ctx.fillStyle = '#A0A0A0';
    ctx.fillRect(sx - 4, sy - 6, 8, 6);
    ctx.fillStyle = '#888';
    ctx.fillRect(sx - 3, sy - 5, 6, 4);
    // Figure
    ctx.fillStyle = '#C0C0C0';
    ctx.fillRect(sx - 1, sy - 14, 2, 2); // head
    ctx.fillStyle = '#B0B0B0';
    ctx.fillRect(sx - 2, sy - 12, 4, 6); // body
    ctx.fillRect(sx - 4, sy - 10, 2, 2); // arm
    ctx.fillRect(sx + 2, sy - 12, 2, 4); // raised arm
    // Sparkle
    if ((tick / 8 | 0) % 4 === 0) {
      ctx.fillStyle = '#FFD700';
      ctx.fillRect(sx + 3, sy - 14, 2, 2);
    }
    if ((tick / 8 | 0) % 4 === 2) {
      ctx.fillStyle = '#FFF8D0';
      ctx.fillRect(sx - 1, sy - 16, 2, 2);
    }
  }

  // ===== Draw HUD overlay (energy meter, vibe badge) =====

  function drawHUD(ctx, canvasW, canvasH, tick) {
    const state = (typeof Farm !== 'undefined') ? Farm.getState() : null;
    if (!state) return;

    const energy = state.totalEnergy || 0;

    // Energy meter (top-right)
    const meterX = canvasW - 170;
    const meterY = 8;

    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(meterX, meterY, 162, 24);

    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 11px monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('\u26A1 ' + formatEnergy(energy), meterX + 6, meterY + 12);

    // Milestone
    const ms = findMilestone(state.milestoneReached || energy);
    if (ms) {
      ctx.fillStyle = '#CCC';
      ctx.font = '9px monospace';
      ctx.fillText(ms.emoji + ' ' + ms.label, meterX + 80, meterY + 12);
    }

    // Vibe badge
    const vibe = (typeof Farm !== 'undefined') ? Farm.getVibe() : null;
    if (vibe) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(meterX, meterY + 26, 162, 18);

      const moodEmoji = { productive: '\u{1F525}', focused: '\u{1F3AF}', exploring: '\u{1F50D}', debugging: '\u{1F41B}', working: '\u{2699}', idle: '\u{1F4A4}' };
      const emoji = moodEmoji[vibe.mood] || '\u{2699}';
      ctx.fillStyle = '#FFF';
      ctx.font = '9px monospace';
      ctx.fillText(emoji + ' ' + vibe.mood, meterX + 6, meterY + 35);

      // Vibe bar
      const score = vibe.vibeScore || 0;
      let barColor = score >= 0.75 ? '#FFD700' : score >= 0.5 ? '#6AB04C' : score >= 0.3 ? '#4A90D9' : '#FF4444';
      ctx.fillStyle = '#333';
      ctx.fillRect(meterX + 80, meterY + 31, 70, 6);
      ctx.fillStyle = barColor;
      ctx.fillRect(meterX + 80, meterY + 31, Math.floor(70 * score), 6);
    }

    // Animal count
    const animalCount = animalEntities.size;
    if (animalCount > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(meterX, meterY + (vibe ? 46 : 26), 162, 14);
      ctx.fillStyle = '#AAA';
      ctx.font = '8px monospace';
      ctx.fillText(`\u{1F43E} ${animalCount} animals | ${cropEntities.length} crops`, meterX + 6, meterY + (vibe ? 53 : 33));
    }
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

  // ===== Public API =====

  return {
    MAP_W,
    MAP_H,
    init,
    syncState,
    syncBuddy,
    removeBuddy,
    drawHUD,
  };
})();
