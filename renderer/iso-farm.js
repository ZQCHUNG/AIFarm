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

  // Flower/bush decorations (expanded to fill empty areas)
  const FLOWER_POSITIONS = [
    [1, 2], [13, 2], [14, 3], [1, 8], [13, 8],
    [15, 5], [16, 4], [17, 6], [18, 5], [12, 4], [12, 7],
    // Right side meadow flowers
    [14, 5], [15, 7], [16, 2], [17, 4], [18, 7], [13, 6],
    [15, 3], [17, 8], [14, 9], [18, 3], [16, 9],
    // Pasture flowers
    [2, 12], [6, 13], [10, 12], [14, 11], [4, 11],
  ];

  // Small rocks (scattered on grass areas)
  const ROCK_POSITIONS = [
    [12, 3], [15, 6], [17, 2], [18, 8], [13, 9],
    [16, 5], [19, 4], [14, 7], [2, 13], [8, 14],
    [12, 12], [18, 14],
  ];

  // NOTE: Fences are now created dynamically in rebuildFieldTerrain/rebuildPastureTerrain

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
  let fieldFenceEntities = [];
  let pastureFenceEntities = [];
  let pastureDecorEntities = [];
  let lastFieldPhase = -1;
  let lastPasturePhase = -1;

  // ===== Startup camera animation =====
  let startupAnim = null; // { startCamX, startCamY, endCamX, endCamY, tick, duration }
  const STARTUP_DURATION = 120; // ~2 seconds at 60fps

  // ===== Initialization =====

  function init() {
    if (initialized) return;
    initialized = true;

    IsoEngine.initMap(MAP_W, MAP_H, 'grass');

    // -- Paint terrain --
    // NOTE: Crop field soil/dirt/fences are painted dynamically in syncTerrain()
    // based on energy milestones (progressive field expansion)

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

    // Rocks
    for (const [c, r] of ROCK_POSITIONS) {
      const seed = c * 7 + r * 13;
      const ent = IsoEntityManager.add(IsoEntityManager.createStatic(c, r,
        (ctx, sx, sy, tick) => drawRock(ctx, sx, sy, tick, seed)
      ));
      decorEntities.push(ent);
    }

    // NOTE: Field fences + pasture fences are created dynamically in syncTerrain()

    // Dirt path connecting main road to town
    for (let r = 11; r <= 14; r++) {
      IsoEngine.setTile(9, r, 'path');
      IsoEngine.setTile(10, r, 'path');
    }

    // Bulletin board (usage data sign, right of crop fields)
    const boardEnt = IsoEntityManager.add(IsoEntityManager.createStatic(12, 5,
      (ctx, sx, sy, tick) => drawBulletinBoard(ctx, sx, sy, tick),
      { signType: 'bulletin' }
    ));
    decorEntities.push(boardEnt);

    // Tool shed (buddies stop here to pick up tools before farming)
    const shedEnt = IsoEntityManager.add(IsoEntityManager.createStatic(2, 10,
      (ctx, sx, sy, tick) => drawToolShed(ctx, sx, sy, tick)
    ));
    decorEntities.push(shedEnt);

    // Startup camera animation: start at train station, pan to farm center
    IsoEngine.setZoom(1.8);
    const c = document.getElementById('canvas') || document.getElementById('isoCanvas') || document.getElementById('farm-canvas');
    const cw = c ? c.width : 660;
    const ch = c ? c.height : 500;

    // Start camera at train station
    IsoEngine.centerOnTile(14, 7, cw, ch);
    const startCamState = IsoEngine.getCameraState();

    // Calculate end position (farm center)
    IsoEngine.centerOnTile(9, 7, cw, ch);
    const endCamState = IsoEngine.getCameraState();

    // Reset to start position and begin animation
    IsoEngine.setCamera(startCamState.x, startCamState.y);
    startupAnim = {
      startX: startCamState.x,
      startY: startCamState.y,
      endX: endCamState.x,
      endY: endCamState.y,
      tick: 0,
      duration: STARTUP_DURATION,
    };
  }

  // Draw a small rock
  function drawRock(ctx, sx, sy, tick, seed) {
    const shades = ['#9E9E9E', '#8B8B8B', '#A8A8A8', '#7A7A7A'];
    const shade = shades[seed % shades.length];
    const size = 3 + (seed % 3);

    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.ellipse(sx, sy, size, size * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Highlight
    ctx.fillStyle = '#BFBFBF';
    ctx.fillRect(sx - size / 2, sy - size * 0.4, size * 0.5, size * 0.3);
  }

  // Draw a fence post segment
  function drawFence(ctx, sx, sy, tick, orientation) {
    const woodColor = '#8B6B3E';
    const darkWood = '#6B4226';

    if (orientation === 'h') {
      // Horizontal fence rail
      ctx.fillStyle = darkWood;
      ctx.fillRect(sx - 14, sy - 4, 28, 3);
      ctx.fillStyle = woodColor;
      ctx.fillRect(sx - 14, sy - 6, 28, 3);
      // Posts at ends
      ctx.fillStyle = darkWood;
      ctx.fillRect(sx - 14, sy - 10, 3, 12);
      ctx.fillRect(sx + 11, sy - 10, 3, 12);
    } else {
      // Vertical fence rail
      ctx.fillStyle = darkWood;
      ctx.fillRect(sx - 1, sy - 12, 3, 14);
      ctx.fillStyle = woodColor;
      ctx.fillRect(sx - 2, sy - 6, 3, 2);
      ctx.fillRect(sx - 2, sy - 2, 3, 2);
    }
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
  // Goes golden when GOAT achievement is unlocked.
  function drawBulletinBoard(ctx, sx, sy, tick) {
    const goat = (typeof Farm !== 'undefined') && Farm.isGOAT();

    // Golden glow aura (GOAT only)
    if (goat) {
      ctx.save();
      ctx.globalAlpha = 0.3 + Math.sin(tick * 0.06) * 0.15;
      const glow = ctx.createRadialGradient(sx, sy - 28, 2, sx, sy - 28, 24);
      glow.addColorStop(0, '#FFD700');
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.fillRect(sx - 24, sy - 48, 48, 40);
      ctx.restore();
    }

    // Wooden post
    ctx.fillStyle = goat ? '#B8860B' : '#6B4226';
    ctx.fillRect(sx - 2, sy - 28, 4, 28);

    // Board frame
    ctx.fillStyle = goat ? '#FFD700' : '#8B5A2B';
    ctx.fillRect(sx - 14, sy - 38, 28, 14);
    // Board face
    ctx.fillStyle = goat ? '#FFF8DC' : '#D4A460';
    ctx.fillRect(sx - 12, sy - 36, 24, 10);

    // Text on board
    ctx.fillStyle = goat ? '#B8860B' : '#4A2800';
    ctx.font = 'bold 6px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(goat ? 'GOAT' : 'INFO', sx, sy - 31);

    // Blinking indicator (gold pulsing for GOAT)
    if (goat || ((tick / 40) | 0) % 2 === 0) {
      ctx.fillStyle = '#FFD700';
      ctx.fillRect(sx + 10, sy - 37, 3, 3);
    }

    // Trophy badge (GOAT only)
    if (goat) {
      ctx.font = '8px monospace';
      ctx.fillText('\u{1F3C6}', sx, sy - 42);
    }
  }

  // ===== Progressive expansion helpers =====

  function getFieldPhase(energy) {
    if (energy >= 5000) return 4;  // full field (rows 3-8)
    if (energy >= 1800) return 3;  // rows 3-7
    if (energy >= 500) return 2;   // rows 3-5
    if (energy >= 50) return 1;    // rows 3-4
    return 0;                       // no field
  }

  function getPasturePhase(animalCount) {
    if (animalCount >= 5) return 4;
    if (animalCount >= 3) return 3;
    if (animalCount >= 1) return 2;
    return 0;
  }

  function syncTerrain(state) {
    const energy = state.totalEnergy || 0;

    // -- Field terrain expansion --
    const fieldPhase = getFieldPhase(energy);
    if (fieldPhase !== lastFieldPhase) {
      lastFieldPhase = fieldPhase;
      rebuildFieldTerrain(fieldPhase);
    }

    // -- Pasture expansion --
    const animalCount = state.animals
      ? Object.values(state.animals).filter(a => a && a.unlocked).length : 0;
    const pasturePhase = getPasturePhase(animalCount);
    if (pasturePhase !== lastPasturePhase) {
      lastPasturePhase = pasturePhase;
      rebuildPastureTerrain(pasturePhase);
    }
  }

  function rebuildFieldTerrain(phase) {
    // Reset entire potential field area to grass
    for (let r = 2; r <= 9; r++) {
      for (let c = 3; c <= 11; c++) {
        IsoEngine.setTile(c, r, 'grass');
      }
    }

    // Remove old field fences
    for (const ent of fieldFenceEntities) IsoEntityManager.remove(ent);
    fieldFenceEntities = [];

    if (phase === 0) return; // No field yet

    // Determine active row range
    const rowMin = 3;
    const rowMax = phase === 1 ? 4 : phase === 2 ? 5 : phase === 3 ? 7 : 8;

    // Paint soil for active crop rows
    for (let r = rowMin; r <= rowMax; r++) {
      for (let c = 4; c <= 6; c++) IsoEngine.setTile(c, r, 'soil');
      IsoEngine.setTile(7, r, 'path');
      for (let c = 8; c <= 10; c++) IsoEngine.setTile(c, r, 'soil');
    }

    // Dirt border around active field
    const borderTop = rowMin - 1;
    const borderBot = rowMax + 1;
    for (let c = 3; c <= 11; c++) {
      IsoEngine.setTile(c, borderTop, 'dirt');
      IsoEngine.setTile(c, borderBot, 'dirt');
    }
    for (let r = borderTop; r <= borderBot; r++) {
      IsoEngine.setTile(3, r, 'dirt');
      IsoEngine.setTile(11, r, 'dirt');
    }

    // Build fences around the active field area
    for (let c = 3; c <= 11; c++) {
      fieldFenceEntities.push(IsoEntityManager.add(IsoEntityManager.createStatic(c, borderTop,
        (ctx, sx, sy, tick) => drawFence(ctx, sx, sy, tick, 'h'))));
      fieldFenceEntities.push(IsoEntityManager.add(IsoEntityManager.createStatic(c, borderBot,
        (ctx, sx, sy, tick) => drawFence(ctx, sx, sy, tick, 'h'))));
    }
    for (let r = borderTop; r <= borderBot; r++) {
      fieldFenceEntities.push(IsoEntityManager.add(IsoEntityManager.createStatic(3, r,
        (ctx, sx, sy, tick) => drawFence(ctx, sx, sy, tick, 'v'))));
      fieldFenceEntities.push(IsoEntityManager.add(IsoEntityManager.createStatic(11, r,
        (ctx, sx, sy, tick) => drawFence(ctx, sx, sy, tick, 'v'))));
    }

    // Expansion particles at new edges
    if (typeof IsoEngine !== 'undefined') {
      for (let c = 4; c <= 10; c++) {
        IsoEngine.spawnHarvestParticles(c, rowMax, '#8BC34A', 2);
      }
    }
  }

  function rebuildPastureTerrain(phase) {
    // Remove old pasture fences + decorations
    for (const ent of pastureFenceEntities) IsoEntityManager.remove(ent);
    pastureFenceEntities = [];
    for (const ent of pastureDecorEntities) IsoEntityManager.remove(ent);
    pastureDecorEntities = [];

    if (phase === 0) return; // No pasture yet

    // Determine pasture bounds based on animal count
    let zone;
    if (phase >= 4) {
      zone = { minCol: 1, maxCol: 18, minRow: 11, maxRow: 14 };
    } else if (phase >= 3) {
      zone = { minCol: 2, maxCol: 16, minRow: 11, maxRow: 14 };
    } else {
      zone = { minCol: 4, maxCol: 12, minRow: 12, maxRow: 13 };
    }

    // Update the shared PASTURE_ZONE (referenced by buddy-ai and animal wander)
    PASTURE_ZONE.minCol = zone.minCol;
    PASTURE_ZONE.maxCol = zone.maxCol;
    PASTURE_ZONE.minRow = zone.minRow;
    PASTURE_ZONE.maxRow = zone.maxRow;

    // Bottom + side fences for pasture
    for (let c = zone.minCol; c <= zone.maxCol; c++) {
      pastureFenceEntities.push(IsoEntityManager.add(IsoEntityManager.createStatic(c, zone.maxRow,
        (ctx, sx, sy, tick) => drawFence(ctx, sx, sy, tick, 'h'))));
    }
    // Left/right fences (shorter)
    for (let r = zone.minRow; r <= zone.maxRow; r++) {
      pastureFenceEntities.push(IsoEntityManager.add(IsoEntityManager.createStatic(zone.minCol, r,
        (ctx, sx, sy, tick) => drawFence(ctx, sx, sy, tick, 'v'))));
      pastureFenceEntities.push(IsoEntityManager.add(IsoEntityManager.createStatic(zone.maxCol, r,
        (ctx, sx, sy, tick) => drawFence(ctx, sx, sy, tick, 'v'))));
    }

    // Pasture decorations (phase 2+): water trough + hay bale
    if (phase >= 2) {
      const troughCol = zone.minCol + 2;
      const troughRow = zone.minRow + 1;
      pastureDecorEntities.push(IsoEntityManager.add(IsoEntityManager.createStatic(troughCol, troughRow,
        (ctx, sx, sy, tick) => drawWaterTrough(ctx, sx, sy, tick))));

      const baleCol = zone.maxCol - 2;
      const baleRow = zone.maxRow - 1;
      pastureDecorEntities.push(IsoEntityManager.add(IsoEntityManager.createStatic(baleCol, baleRow,
        (ctx, sx, sy, tick) => drawHayBale(ctx, sx, sy, tick))));
    }
    // Extra hay bale for bigger pastures
    if (phase >= 3) {
      const bale2Col = Math.floor((zone.minCol + zone.maxCol) / 2);
      const bale2Row = zone.maxRow - 1;
      pastureDecorEntities.push(IsoEntityManager.add(IsoEntityManager.createStatic(bale2Col, bale2Row,
        (ctx, sx, sy, tick) => drawHayBale(ctx, sx, sy, tick))));
    }

    // Expansion particles
    if (typeof IsoEngine !== 'undefined') {
      const cx = (zone.minCol + zone.maxCol) / 2;
      IsoEngine.spawnHarvestParticles(cx, zone.maxRow, '#A8D5A2', 4);
    }
  }

  // ===== Startup camera animation update =====

  function updateStartupAnimation() {
    if (!startupAnim) return;

    startupAnim.tick++;
    const t = Math.min(1, startupAnim.tick / startupAnim.duration);

    // Ease-in-out cubic
    const ease = t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;

    const cx = startupAnim.startX + (startupAnim.endX - startupAnim.startX) * ease;
    const cy = startupAnim.startY + (startupAnim.endY - startupAnim.startY) * ease;
    IsoEngine.setCamera(cx, cy);

    if (t >= 1) {
      startupAnim = null; // Animation complete
    }
  }

  // ===== Pasture decorations =====

  function drawWaterTrough(ctx, sx, sy, tick) {
    // Wooden trough body
    ctx.fillStyle = '#6B4226';
    ctx.fillRect(sx - 10, sy - 4, 20, 8);
    ctx.fillStyle = '#8B5A2B';
    ctx.fillRect(sx - 9, sy - 3, 18, 6);
    // Water inside
    ctx.fillStyle = '#5BA0D9';
    ctx.fillRect(sx - 7, sy - 2, 14, 4);
    // Water shimmer
    const shimmer = Math.sin(tick * 0.08) * 0.3;
    ctx.fillStyle = `rgba(136, 208, 240, ${0.4 + shimmer})`;
    ctx.fillRect(sx - 5, sy - 1, 4, 2);
    // Legs
    ctx.fillStyle = '#5A3418';
    ctx.fillRect(sx - 9, sy + 3, 3, 3);
    ctx.fillRect(sx + 6, sy + 3, 3, 3);
  }

  function drawHayBale(ctx, sx, sy, tick) {
    // Round hay bale shadow
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.beginPath();
    ctx.ellipse(sx, sy + 3, 9, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    // Bale body (cylinder from top-down)
    ctx.fillStyle = '#D4A843';
    ctx.beginPath();
    ctx.ellipse(sx, sy - 2, 8, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    // Straw texture lines
    ctx.strokeStyle = '#C49633';
    ctx.lineWidth = 0.5;
    for (let i = -3; i <= 3; i += 2) {
      ctx.beginPath();
      ctx.moveTo(sx - 6, sy - 2 + i);
      ctx.lineTo(sx + 6, sy - 2 + i);
      ctx.stroke();
    }
    // Top highlight
    ctx.fillStyle = '#E0B850';
    ctx.beginPath();
    ctx.ellipse(sx - 1, sy - 4, 4, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    // Stray straw pieces
    const sway = Math.sin(tick * 0.04 + sx * 0.1) * 0.8;
    ctx.fillStyle = '#D4A843';
    ctx.fillRect(sx + 7 + sway, sy - 4, 3, 1);
    ctx.fillRect(sx - 9 + sway, sy - 1, 3, 1);
  }

  function drawToolShed(ctx, sx, sy, tick) {
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.ellipse(sx, sy + 4, 14, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Shed body (wooden walls)
    ctx.fillStyle = '#8B6B3E';
    ctx.fillRect(sx - 12, sy - 16, 24, 18);
    // Front face (lighter)
    ctx.fillStyle = '#A07840';
    ctx.fillRect(sx - 10, sy - 14, 20, 14);
    // Wood plank lines
    ctx.strokeStyle = '#6B4226';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 4; i++) {
      const ly = sy - 12 + i * 4;
      ctx.beginPath();
      ctx.moveTo(sx - 10, ly);
      ctx.lineTo(sx + 10, ly);
      ctx.stroke();
    }

    // Roof (darker, overhanging)
    ctx.fillStyle = '#6B4226';
    ctx.fillRect(sx - 14, sy - 20, 28, 5);
    ctx.fillStyle = '#5A3418';
    ctx.fillRect(sx - 13, sy - 21, 26, 2);

    // Door opening (dark)
    ctx.fillStyle = '#3A2010';
    ctx.fillRect(sx - 4, sy - 8, 8, 10);

    // Tools leaning against wall
    // Hoe handle
    ctx.fillStyle = '#8B6B3E';
    ctx.fillRect(sx + 10, sy - 18, 2, 16);
    ctx.fillStyle = '#888';
    ctx.fillRect(sx + 9, sy - 18, 4, 3);
    // Watering can
    ctx.fillStyle = '#4A90D9';
    ctx.fillRect(sx - 11, sy - 4, 5, 4);
    ctx.fillStyle = '#3A80C0';
    ctx.fillRect(sx - 9, sy - 7, 2, 3);

    // Small sign above door
    ctx.fillStyle = '#D4A460';
    ctx.fillRect(sx - 6, sy - 12, 12, 4);
    ctx.fillStyle = '#4A2800';
    ctx.font = '5px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TOOLS', sx, sy - 10);
  }

  function getCropStage(plotIndex) {
    const state = (typeof Farm !== 'undefined') ? Farm.getState() : null;
    if (!state || !state.plots || plotIndex >= state.plots.length) return 0;
    return state.plots[plotIndex].stage || 0;
  }

  // ===== Sync farm state to world =====

  function syncState() {
    const state = (typeof Farm !== 'undefined') ? Farm.getState() : null;
    if (!state) return;

    // Always check terrain expansion (phase-based, fast early-out)
    syncTerrain(state);

    const hash = `${state.totalEnergy}-${state.milestoneReached}-${(state.plots || []).map(p => `${p.crop}${p.stage}`).join(',')}`;
    if (hash === lastStateHash) return;
    lastStateHash = hash;

    syncCrops(state);
    syncAnimals(state);
    syncBuildings(state);
    syncMonument(state);
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

  // Shadow sizes (width, height) for each building type — proportional to sprite footprint
  const BUILDING_SHADOWS = {
    well:     { w: 64,  h: 20 },
    barn:     { w: 140, h: 32 },
    windmill: { w: 100, h: 28 },
    market:   { w: 140, h: 24 },
    clock:    { w: 56,  h: 18 },
    townhall: { w: 140, h: 32 },
    statue:   { w: 56,  h: 18 },
  };

  function drawBuildingShadow(ctx, sx, sy, type) {
    const shadow = BUILDING_SHADOWS[type];
    if (!shadow) return;
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.beginPath();
    ctx.ellipse(sx, sy + 2, shadow.w / 2, shadow.h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawBuilding(ctx, sx, sy, type, tick) {
    // Draw ground shadow first
    drawBuildingShadow(ctx, sx, sy, type);

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

  // ===== Golden Bird (hidden visitor random event) =====

  let goldenBirdEntity = null;
  let goldenBirdCol = -1;
  let goldenBirdRow = -1;
  let lastBirdCheck = 0;
  const BIRD_CHECK_INTERVAL = 36000; // ~10 minutes at 60fps
  const BIRD_SPAWN_CHANCE = 0.05;    // 5%
  const BIRD_LIFETIME = 1800;        // ~30 seconds before flying away
  let birdLifeTimer = 0;

  // Possible fence positions for the bird to land on
  function getBirdFenceSpots() {
    // Top fence of field area (row 2, cols 3-11)
    const spots = [];
    for (let c = 3; c <= 11; c += 2) spots.push([c, 2]);
    // Pasture fence posts
    for (let c = 1; c <= 18; c += 3) spots.push([c, 11]);
    return spots;
  }

  function updateGoldenBird(tick) {
    // Check for bird despawn (timeout)
    if (goldenBirdEntity) {
      birdLifeTimer--;
      if (birdLifeTimer <= 0) {
        despawnBird(false);
      }
      return;
    }

    // Check for bird spawn
    if (tick - lastBirdCheck < BIRD_CHECK_INTERVAL) return;
    lastBirdCheck = tick;

    if (Math.random() >= BIRD_SPAWN_CHANCE) return;

    // Spawn golden bird on a random fence spot
    const spots = getBirdFenceSpots();
    const spot = spots[Math.floor(Math.random() * spots.length)];
    goldenBirdCol = spot[0];
    goldenBirdRow = spot[1];
    birdLifeTimer = BIRD_LIFETIME;

    goldenBirdEntity = IsoEntityManager.add(IsoEntityManager.createStatic(
      goldenBirdCol, goldenBirdRow,
      (ctx, sx, sy, tick) => drawGoldenBird(ctx, sx, sy, tick),
      { signType: 'goldenbird' }
    ));

    // Log appearance
    if (typeof Farm !== 'undefined' && Farm.logEvent) {
      Farm.logEvent('\u{1F426}', 'A golden bird appeared!');
    }
  }

  function drawGoldenBird(ctx, sx, sy, tick) {
    const bob = Math.sin(tick * 0.1) * 1.5;
    const wingFlap = Math.sin(tick * 0.3) > 0 ? 1 : 0;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.ellipse(sx, sy + 2, 5, 2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body (golden)
    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.ellipse(sx, sy - 6 + bob, 4, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Wing
    ctx.fillStyle = '#FFC000';
    if (wingFlap) {
      ctx.fillRect(sx + 3, sy - 9 + bob, 3, 2);
    } else {
      ctx.fillRect(sx + 3, sy - 7 + bob, 3, 2);
    }

    // Head
    ctx.fillStyle = '#FFE066';
    ctx.beginPath();
    ctx.arc(sx - 3, sy - 9 + bob, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Eye
    ctx.fillStyle = '#333';
    ctx.fillRect(sx - 4, sy - 10 + bob, 1, 1);

    // Beak
    ctx.fillStyle = '#FF8C00';
    ctx.fillRect(sx - 6, sy - 9 + bob, 2, 1);

    // Tail feathers
    ctx.fillStyle = '#FFAA00';
    ctx.fillRect(sx + 4, sy - 7 + bob, 2, 1);
    ctx.fillRect(sx + 5, sy - 6 + bob, 2, 1);

    // Golden sparkle aura
    const sparkle = ((tick / 10) | 0) % 4;
    ctx.fillStyle = '#FFF8DC';
    const sparkPos = [[-6, -13], [5, -11], [-4, -3], [6, -4]];
    if (sparkle < sparkPos.length) {
      ctx.fillRect(sx + sparkPos[sparkle][0], sy + sparkPos[sparkle][1] + bob, 2, 2);
    }
  }

  function handleFarmClick(col, row) {
    if (!goldenBirdEntity) return false;

    // Check if click is near the golden bird (1.5 tile radius)
    const dx = col - goldenBirdCol;
    const dy = row - goldenBirdRow;
    if (Math.sqrt(dx * dx + dy * dy) > 1.5) return false;

    despawnBird(true);
    return true;
  }

  function despawnBird(clicked) {
    if (!goldenBirdEntity) return;

    if (clicked) {
      // Big sparkle celebration
      if (typeof IsoEngine !== 'undefined') {
        IsoEngine.spawnHarvestParticles(goldenBirdCol, goldenBirdRow, '#FFD700', 16);
        IsoEngine.spawnHarvestParticles(goldenBirdCol, goldenBirdRow, '#FFF8DC', 8);
        IsoEngine.spawnHarvestParticles(goldenBirdCol, goldenBirdRow, '#FF8C00', 6);
      }
      if (typeof IsoEffects !== 'undefined') {
        IsoEffects.spawnText(goldenBirdCol, goldenBirdRow - 0.5, '\u{2728}',
          { color: '#FFD700', life: 60, rise: 1.0 });
        IsoEffects.spawnText(goldenBirdCol + 0.3, goldenBirdRow - 0.8, '\u{1F426}',
          { color: '#FFD700', life: 50, rise: 1.2 });
      }
      if (typeof Farm !== 'undefined' && Farm.logEvent) {
        Farm.logEvent('\u{2728}', 'Caught the golden bird!');
      }
    } else {
      // Bird flew away — small particle puff
      if (typeof IsoEngine !== 'undefined') {
        IsoEngine.spawnHarvestParticles(goldenBirdCol, goldenBirdRow, '#FFD700', 4);
      }
      if (typeof Farm !== 'undefined' && Farm.logEvent) {
        Farm.logEvent('\u{1F426}', 'The golden bird flew away...');
      }
    }

    IsoEntityManager.remove(goldenBirdEntity);
    goldenBirdEntity = null;
    goldenBirdCol = -1;
    goldenBirdRow = -1;
  }

  // ===== Monument (upper-right, unlocked at 10k energy) =====

  let monumentEntity = null;

  function syncMonument(state) {
    const energy = state.totalEnergy || 0;
    if (energy < 10000) {
      if (monumentEntity) {
        IsoEntityManager.remove(monumentEntity);
        monumentEntity = null;
      }
      return;
    }
    if (monumentEntity) return; // already placed

    monumentEntity = IsoEntityManager.add(IsoEntityManager.createStatic(17, 2,
      (ctx, sx, sy, tick) => {
        drawMonument(ctx, sx, sy, tick, state);
      },
      { spriteId: null }
    ));
  }

  function drawMonument(ctx, sx, sy, tick, state) {
    const usage = (typeof Farm !== 'undefined') ? Farm.getUsage() : null;

    // Stone pedestal
    ctx.fillStyle = '#888';
    ctx.fillRect(sx - 14, sy - 6, 28, 10);
    ctx.fillStyle = '#A0A0A0';
    ctx.fillRect(sx - 12, sy - 8, 24, 8);
    ctx.fillStyle = '#B8B8B0';
    ctx.fillRect(sx - 10, sy - 10, 20, 4);

    // Crystal body (glowing pixel crystal)
    const pulse = Math.sin(tick * 0.05) * 0.15 + 0.85;
    const glowR = 8 + Math.sin(tick * 0.03) * 2;

    // Crystal glow aura
    ctx.save();
    ctx.globalAlpha = 0.3 * pulse;
    const grad = ctx.createRadialGradient(sx, sy - 22, 2, sx, sy - 22, glowR * 2);
    grad.addColorStop(0, '#DA70D6');
    grad.addColorStop(0.5, '#9B59B6');
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fillRect(sx - glowR * 2, sy - 22 - glowR * 2, glowR * 4, glowR * 4);
    ctx.restore();

    // Crystal shape (diamond/gem)
    ctx.fillStyle = `rgba(180, 100, 220, ${(0.7 + pulse * 0.3).toFixed(2)})`;
    // Bottom half (wider)
    ctx.beginPath();
    ctx.moveTo(sx, sy - 12);
    ctx.lineTo(sx - 6, sy - 20);
    ctx.lineTo(sx, sy - 28);
    ctx.lineTo(sx + 6, sy - 20);
    ctx.closePath();
    ctx.fill();

    // Crystal highlight
    ctx.fillStyle = `rgba(220, 180, 255, ${(0.4 + pulse * 0.2).toFixed(2)})`;
    ctx.beginPath();
    ctx.moveTo(sx - 1, sy - 14);
    ctx.lineTo(sx - 4, sy - 20);
    ctx.lineTo(sx - 1, sy - 26);
    ctx.lineTo(sx + 1, sy - 20);
    ctx.closePath();
    ctx.fill();

    // Sparkle particles
    const sparkPhase = ((tick / 6) | 0) % 5;
    const sparkOffsets = [[-5, -24], [4, -18], [-3, -14], [6, -22], [0, -28]];
    if (sparkPhase < sparkOffsets.length) {
      ctx.fillStyle = '#FFF';
      ctx.fillRect(sx + sparkOffsets[sparkPhase][0], sy + sparkOffsets[sparkPhase][1], 2, 2);
    }

    // Stats text below pedestal
    ctx.font = '7px monospace';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#DA70D6';

    if (usage && usage.totalOutput) {
      const totalMB = (usage.totalOutput / 1000000).toFixed(1);
      ctx.fillText(`${totalMB}M tok`, sx, sy + 6);
    }

    // "LEGEND" title above crystal
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 7px monospace';
    ctx.fillText('LEGEND', sx, sy - 33);
  }

  // ===== HUD — Harvest Moon style =====

  function drawHUD(ctx, canvasW, canvasH, tick) {
    // Update golden bird random event
    updateGoldenBird(tick);

    const state = (typeof Farm !== 'undefined') ? Farm.getState() : null;
    if (!state) return;

    const energy = state.totalEnergy || 0;
    const vibe = (typeof Farm !== 'undefined') ? Farm.getVibe() : null;

    // Top-left: Energy (like stamina)
    drawEnergyBar(ctx, 8, 8, energy);

    // Top-right: Status panel (date/milestone/currency)
    drawStatusPanel(ctx, canvasW - 158, 8, energy, state, tick);

    // Bottom-left: Season + Animal/crop count
    const animalCount = animalEntities.size;
    const cropCount = cropEntities.length;
    const seasonEmoji = { spring: '\u{1F338}', summer: '\u{2600}\u{FE0F}', autumn: '\u{1F341}', winter: '\u{2744}\u{FE0F}' };
    const season = (typeof IsoWeather !== 'undefined') ? IsoWeather.getSeason() : null;
    const seasonBadge = season ? (seasonEmoji[season] || '') + season.charAt(0).toUpperCase() + season.slice(1) : '';
    {
      const label = seasonBadge + (animalCount > 0 || cropCount > 0 ? `  \u{1F43E}${animalCount}  \u{1F33E}${cropCount}` : '');
      ctx.fillStyle = 'rgba(20, 20, 40, 0.7)';
      roundRect(ctx, 8, canvasH - 26, 140, 20, 4);
      ctx.fill();
      ctx.fillStyle = '#FFF';
      ctx.font = '9px monospace';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(label, 14, canvasH - 16);
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

  function getBuddyEntity(sessionId) {
    return buddyEntities.get(sessionId) || null;
  }

  return {
    MAP_W, MAP_H,
    FIELD, PASTURE_ZONE,
    PLOT_POSITIONS, BUILDING_POSITIONS, ANIMAL_HOMES,
    init, syncState, syncBuddy, removeBuddy, drawHUD, handleFarmClick,
    getBuddyEntity, getCropStage, updateStartupAnimation,
  };
})();
