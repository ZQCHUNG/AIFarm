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

  // Extension zone — reserved for future features (fishing pond, village expansion, etc.)
  const EXTENSION_ZONE = { minCol: 12, maxCol: 19, minRow: 0, maxRow: 9 };

  // Shipping bin position
  const SHIPPING_BIN_COL = 1;
  const SHIPPING_BIN_ROW = 10;

  // Animal home positions
  const ANIMAL_HOMES = {
    chicken: { col: 3,  row: 12 },
    cow:     { col: 7,  row: 13 },
    pig:     { col: 11, row: 12 },
    sheep:   { col: 15, row: 13 },
    cat:     { col: 5,  row: 14 },
    dog:     { col: 13, row: 14 },
  };

  // Building positions (town row + processing zone)
  const BUILDING_POSITIONS = {
    well:     { col: 2,  row: 15 },
    barn:     { col: 5,  row: 15 },
    mill:     { col: 14, row: 4 },
    windmill: { col: 8,  row: 15 },
    workshop: { col: 17, row: 4 },
    market:   { col: 11, row: 15 },
    clock:    { col: 14, row: 15 },
    townhall: { col: 4,  row: 17 },
    statue:   { col: 15, row: 17 },
    museum:   { col: 8,  row: 17 },
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

  // Token burning pulse indicator state
  let tokenBurnTicks = [];     // timestamps of recent energy ticks
  let tokenBurnFloats = [];    // floating "-X" text animations
  let tokenBurnRate = 0;       // smoothed ticks per second
  let lastFieldPhase = -1;
  let lastPasturePhase = -1;

  // ===== Startup camera animation =====
  let startupAnim = null; // { startCamX, startCamY, endCamX, endCamY, tick, duration }
  const STARTUP_DURATION = 120; // ~2 seconds at 60fps

  // ===== Initialization =====

  // Home offset: converts local farm coords (0-19, 0-17) to world coords
  let _oC = 0; // homeOffsetCol
  let _oR = 0; // homeOffsetRow

  /** Convert local farm col to world col. */
  function wc(col) { return col + _oC; }
  /** Convert local farm row to world row. */
  function wr(row) { return row + _oR; }
  /** Set tile using local farm coordinates. */
  function farmSetTile(col, row, type) { IsoEngine.setTile(wc(col), wr(row), type); }
  /** Create static entity at local farm coordinates. */
  function farmStatic(col, row, drawFn, opts) {
    return IsoEntityManager.createStatic(wc(col), wr(row), drawFn, opts);
  }
  /** Create animal at local farm coordinates. */
  function farmAnimal(type, col, row, opts) {
    return IsoEntityManager.createAnimal(type, wc(col), wr(row), opts);
  }

  function init() {
    if (initialized) return;
    initialized = true;

    IsoEngine.initMap(MAP_W, MAP_H, 'grass');

    // Get home offset from engine (set by ChunkManager mega-map)
    const off = IsoEngine.getHomeOffset ? IsoEngine.getHomeOffset() : { col: 0, row: 0 };
    _oC = off.col;
    _oR = off.row;

    // -- Paint terrain --
    // NOTE: Crop field soil/dirt/fences are painted dynamically in syncTerrain()
    // based on energy milestones (progressive field expansion)

    // Path running horizontally below field
    for (let c = 0; c < MAP_W; c++) {
      farmSetTile(c, 10, 'path');
      farmSetTile(c, 11, 'path');
    }

    // Shipping bin tile (solid — player can't walk through)
    farmSetTile(SHIPPING_BIN_COL, SHIPPING_BIN_ROW, 'fence');

    // Small pond in pasture
    farmSetTile(16, 12, 'water');
    farmSetTile(17, 12, 'water');
    farmSetTile(16, 13, 'water');
    farmSetTile(17, 13, 'water');
    // Sand around pond
    farmSetTile(15, 12, 'sand');
    farmSetTile(15, 13, 'sand');
    farmSetTile(18, 12, 'sand');
    farmSetTile(18, 13, 'sand');
    farmSetTile(16, 11, 'sand');
    farmSetTile(17, 11, 'sand');
    farmSetTile(16, 14, 'sand');
    farmSetTile(17, 14, 'sand');

    // Town area: stone ground
    for (let r = 15; r < MAP_H; r++) {
      for (let c = 0; c < MAP_W; c++) {
        farmSetTile(c, r, 'stone');
      }
    }

    // -- Static decorations --
    // Trees
    for (const [c, r] of TREE_POSITIONS) {
      const ent = IsoEntityManager.add(farmStatic(c, r,
        (ctx, sx, sy, tick) => IsoEngine.drawIsoTree(ctx, sx, sy, tick)
      ));
      decorEntities.push(ent);
    }

    // Flowers/bushes
    for (const [c, r] of FLOWER_POSITIONS) {
      const ent = IsoEntityManager.add(farmStatic(c, r,
        (ctx, sx, sy, tick) => drawFlower(ctx, sx, sy, tick, c + r)
      ));
      decorEntities.push(ent);
    }

    // Rocks
    for (const [c, r] of ROCK_POSITIONS) {
      const seed = c * 7 + r * 13;
      const ent = IsoEntityManager.add(farmStatic(c, r,
        (ctx, sx, sy, tick) => drawRock(ctx, sx, sy, tick, seed)
      ));
      decorEntities.push(ent);
    }

    // NOTE: Field fences + pasture fences are created dynamically in syncTerrain()

    // Dirt path connecting main road to town
    for (let r = 11; r <= 14; r++) {
      farmSetTile(9, r, 'path');
      farmSetTile(10, r, 'path');
    }

    // Bulletin board (usage data sign, right of crop fields)
    const boardEnt = IsoEntityManager.add(farmStatic(12, 5,
      (ctx, sx, sy, tick) => drawBulletinBoard(ctx, sx, sy, tick),
      { signType: 'bulletin' }
    ));
    decorEntities.push(boardEnt);

    // Tool shed (buddies stop here to pick up tools before farming)
    const shedEnt = IsoEntityManager.add(farmStatic(2, 10,
      (ctx, sx, sy, tick) => drawToolShed(ctx, sx, sy, tick)
    ));
    decorEntities.push(shedEnt);

    // Lamp posts along the path (light up at night)
    const LAMP_POSITIONS = [[3, 10], [7, 10], [11, 10], [15, 10]];
    for (const [c, r] of LAMP_POSITIONS) {
      const ent = IsoEntityManager.add(farmStatic(c, r,
        (ctx, sx, sy, tick) => drawLampPost(ctx, sx, sy, tick)
      ));
      decorEntities.push(ent);
    }

    // Shipping bin (resource → GOLD, at path edge near farm)
    const shippingBinEnt = IsoEntityManager.add(farmStatic(1, 10,
      (ctx, sx, sy, tick) => drawShippingBin(ctx, sx, sy, tick),
      { z: 0 }
    ));
    decorEntities.push(shippingBinEnt);

    // Startup camera animation: start at train station, pan to farm center
    // Skip animation if tutorial is already complete (returning player)
    // Scale zoom proportionally to canvas height so the visible world area
    // stays consistent across screen sizes. Baseline: 351px → zoom 1.8
    const c = document.getElementById('canvas') || document.getElementById('isoCanvas') || document.getElementById('farm-canvas');
    const cw = c ? c.width : 660;
    const ch = c ? c.height : 500;
    const baseZoom = 1.8 * (ch / 351);
    IsoEngine.setZoom(Math.max(1.0, Math.min(3.0, baseZoom)));

    const tutDone = typeof TutorialManager !== 'undefined' && TutorialManager.isComplete();
    if (tutDone) {
      // Returning player — skip fly-in, camera will snap to player on first frame
      IsoEngine.centerOnTile(9, 7, cw, ch);
      startupAnim = null;
    } else {
      // New player — cinematic fly-in from train station to farm center
      IsoEngine.centerOnTile(14, 7, cw, ch);
      const startCamState = IsoEngine.getCameraState();

      IsoEngine.centerOnTile(9, 7, cw, ch);
      const endCamState = IsoEngine.getCameraState();

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

  // Shipping bin — wooden crate for selling resources → GOLD
  // Stardew Valley style: drop items in, get gold
  let shippingBinBounce = 0; // bounce animation timer
  let shippingBinGoldFloat = null; // { amount, startTick }

  function drawShippingBin(ctx, sx, sy, tick) {
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.beginPath();
    ctx.ellipse(sx, sy + 4, 12, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Bounce animation
    let bounceY = 0;
    if (shippingBinBounce > 0) {
      bounceY = -Math.sin(shippingBinBounce / 15 * Math.PI) * 4;
      shippingBinBounce--;
    }

    // Crate body (wooden box)
    const bx = sx - 10;
    const by = sy - 14 + bounceY;
    ctx.fillStyle = '#8B6B3E';
    ctx.fillRect(bx, by, 20, 14);

    // Wood grain stripes
    ctx.fillStyle = '#7A5A2E';
    ctx.fillRect(bx, by + 3, 20, 2);
    ctx.fillRect(bx, by + 8, 20, 2);

    // Side panels (darker edges)
    ctx.fillStyle = '#6B4A1E';
    ctx.fillRect(bx, by, 2, 14);
    ctx.fillRect(bx + 18, by, 2, 14);

    // Lid (slightly wider, angled)
    ctx.fillStyle = '#A07840';
    ctx.fillRect(bx - 2, by - 4, 24, 5);
    ctx.fillStyle = '#8B6830';
    ctx.fillRect(bx - 2, by - 4, 24, 1);

    // Metal clasp/handle
    ctx.fillStyle = '#C0C0C0';
    ctx.fillRect(sx - 3, by - 3, 6, 3);
    ctx.fillStyle = '#888';
    ctx.fillRect(sx - 2, by - 2, 4, 1);

    // Gold star emblem on front
    ctx.fillStyle = '#FFD700';
    ctx.font = '7px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('\u2605', sx, by + 7); // ★

    // Label "SELL"
    ctx.fillStyle = '#FFE0A0';
    ctx.font = 'bold 5px monospace';
    ctx.fillText('SELL', sx, sy + 8 + bounceY);

    // Floating gold earned animation
    if (shippingBinGoldFloat) {
      const elapsed = tick - shippingBinGoldFloat.startTick;
      if (elapsed < 60) {
        const floatY = -elapsed * 0.5;
        const alpha = 1 - elapsed / 60;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#FFD700';
        ctx.font = 'bold 8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('+' + shippingBinGoldFloat.amount + 'g', sx, by - 8 + floatY);
        ctx.restore();
      } else {
        shippingBinGoldFloat = null;
      }
    }
  }

  // Check if player is near shipping bin and draw sell prompt
  function updateShippingBin(tick) {
    if (typeof Player === 'undefined' || typeof ResourceInventory === 'undefined') return;
    const pt = Player.getTile();
    const dx = Math.abs(pt.col - wc(SHIPPING_BIN_COL));
    const dy = Math.abs(pt.row - wr(SHIPPING_BIN_ROW));
    // Player is adjacent (within 1.5 tiles)
    if (dx <= 1 && dy <= 1) {
      shippingBinNearby = true;
    } else {
      shippingBinNearby = false;
    }
  }

  let shippingBinNearby = false;

  function sellAllCrops(tick) {
    if (!shippingBinNearby) return 0; // Must be near the bin
    if (typeof ResourceInventory === 'undefined') return 0;
    const sellable = ['carrot', 'sunflower', 'watermelon', 'tomato', 'corn', 'pumpkin', 'wood', 'stone', 'flour', 'plank', 'feed', 'fish'];
    let totalGold = 0;
    for (const res of sellable) {
      const amount = ResourceInventory.get(res);
      if (amount > 0) {
        const price = ResourceInventory.SELL_PRICES[res] || 0;
        if (price > 0 && ResourceInventory.sell(res, amount)) {
          totalGold += price * amount;
        }
      }
    }
    if (totalGold > 0) {
      shippingBinBounce = 15;
      shippingBinGoldFloat = { amount: totalGold, startTick: tick };
    }
    return totalGold;
  }

  // Draw sell prompt when player is near shipping bin (called from drawHUD)
  function drawSellPrompt(ctx, canvasW, canvasH) {
    if (!shippingBinNearby) return;
    // Don't show sell prompt when shop prompt is also active (shop takes priority)
    if (typeof ShopUI !== 'undefined' && ShopUI.isNearShop()) return;
    // Check if there's anything to sell
    if (typeof ResourceInventory === 'undefined') return;
    const sellable = ['carrot', 'sunflower', 'watermelon', 'tomato', 'corn', 'pumpkin', 'wood', 'stone', 'flour', 'plank', 'feed', 'fish'];
    let hasItems = false;
    for (const res of sellable) {
      if (ResourceInventory.get(res) > 0) { hasItems = true; break; }
    }
    if (!hasItems) return;

    // Draw "Press E to sell" prompt at bottom center
    const text = 'Press [E] to sell';
    ctx.font = 'bold 9px monospace';
    const tw = ctx.measureText(text).width;
    const px = (canvasW - tw) / 2 - 8;
    const py = canvasH - 42;
    ctx.fillStyle = 'rgba(20, 20, 40, 0.8)';
    roundRect(ctx, px, py, tw + 16, 18, 4);
    ctx.fill();
    ctx.fillStyle = '#FFD700';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvasW / 2, py + 9);
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
        farmSetTile(c, r, 'grass');
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
      for (let c = 4; c <= 6; c++) farmSetTile(c, r, 'soil');
      farmSetTile(7, r, 'path');
      for (let c = 8; c <= 10; c++) farmSetTile(c, r, 'soil');
    }

    // Dirt border around active field
    const borderTop = rowMin - 1;
    const borderBot = rowMax + 1;
    for (let c = 3; c <= 11; c++) {
      farmSetTile(c, borderTop, 'dirt');
      farmSetTile(c, borderBot, 'dirt');
    }
    for (let r = borderTop; r <= borderBot; r++) {
      farmSetTile(3, r, 'dirt');
      farmSetTile(11, r, 'dirt');
    }

    // Build fences around the active field area
    for (let c = 3; c <= 11; c++) {
      fieldFenceEntities.push(IsoEntityManager.add(farmStatic(c, borderTop,
        (ctx, sx, sy, tick) => drawFence(ctx, sx, sy, tick, 'h'))));
      fieldFenceEntities.push(IsoEntityManager.add(farmStatic(c, borderBot,
        (ctx, sx, sy, tick) => drawFence(ctx, sx, sy, tick, 'h'))));
    }
    for (let r = borderTop; r <= borderBot; r++) {
      fieldFenceEntities.push(IsoEntityManager.add(farmStatic(3, r,
        (ctx, sx, sy, tick) => drawFence(ctx, sx, sy, tick, 'v'))));
      fieldFenceEntities.push(IsoEntityManager.add(farmStatic(11, r,
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
      pastureFenceEntities.push(IsoEntityManager.add(farmStatic(c, zone.maxRow,
        (ctx, sx, sy, tick) => drawFence(ctx, sx, sy, tick, 'h'))));
    }
    // Left/right fences (shorter)
    for (let r = zone.minRow; r <= zone.maxRow; r++) {
      pastureFenceEntities.push(IsoEntityManager.add(farmStatic(zone.minCol, r,
        (ctx, sx, sy, tick) => drawFence(ctx, sx, sy, tick, 'v'))));
      pastureFenceEntities.push(IsoEntityManager.add(farmStatic(zone.maxCol, r,
        (ctx, sx, sy, tick) => drawFence(ctx, sx, sy, tick, 'v'))));
    }

    // Pasture decorations (phase 2+): water trough + hay bale
    if (phase >= 2) {
      const troughCol = zone.minCol + 2;
      const troughRow = zone.minRow + 1;
      pastureDecorEntities.push(IsoEntityManager.add(farmStatic(troughCol, troughRow,
        (ctx, sx, sy, tick) => drawWaterTrough(ctx, sx, sy, tick))));

      const baleCol = zone.maxCol - 2;
      const baleRow = zone.maxRow - 1;
      pastureDecorEntities.push(IsoEntityManager.add(farmStatic(baleCol, baleRow,
        (ctx, sx, sy, tick) => drawHayBale(ctx, sx, sy, tick))));
    }
    // Extra hay bale for bigger pastures
    if (phase >= 3) {
      const bale2Col = Math.floor((zone.minCol + zone.maxCol) / 2);
      const bale2Row = zone.maxRow - 1;
      pastureDecorEntities.push(IsoEntityManager.add(farmStatic(bale2Col, bale2Row,
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

  // ===== Auto-Pan idle camera tour =====

  const AUTO_PAN_IDLE_THRESHOLD = 3600; // ~60 seconds at 60fps before auto-pan starts
  const AUTO_PAN_MOVE_DURATION = 180;  // ~3 seconds to glide between waypoints
  const AUTO_PAN_PAUSE_DURATION = 240; // ~4 seconds pause at each waypoint

  // Waypoints: key farm locations for the camera tour
  const AUTO_PAN_WAYPOINTS = [
    { col: 7,  row: 5,  label: 'crops' },      // Farm center (crop fields)
    { col: 14, row: 7,  label: 'station' },     // Train station
    { col: 10, row: 13, label: 'pasture' },     // Animal pasture
    { col: 8,  row: 16, label: 'town' },        // Buildings/town
    { col: 17, row: 2,  label: 'monument' },    // Monument (upper-right meadow)
    { col: 3,  row: 10, label: 'toolshed' },    // Tool shed area
  ];

  let autoPanActive = false;
  let autoPanIdleTicks = 0;
  let autoPanWaypointIdx = 0;
  let autoPanPhase = 'idle';   // 'idle' | 'moving' | 'pausing'
  let autoPanProgress = 0;     // 0-1 progress through current phase
  let autoPanStartX = 0, autoPanStartY = 0;
  let autoPanEndX = 0, autoPanEndY = 0;

  function resetAutoPan() {
    autoPanActive = false;
    autoPanIdleTicks = 0;
    autoPanPhase = 'idle';
    autoPanProgress = 0;
  }

  function interruptAutoPan() {
    if (autoPanActive) {
      autoPanActive = false;
      autoPanPhase = 'idle';
    }
    autoPanIdleTicks = 0;
  }

  function updateAutoPan() {
    // Don't run during startup animation or modal
    if (startupAnim) return;
    if (typeof IsoUI !== 'undefined' && IsoUI.isOpen()) return;

    if (!autoPanActive) {
      // Count idle ticks
      autoPanIdleTicks++;
      if (autoPanIdleTicks >= AUTO_PAN_IDLE_THRESHOLD) {
        // Start auto-pan tour
        autoPanActive = true;
        autoPanPhase = 'pausing'; // Brief pause before first move
        autoPanProgress = 0;
        // Start from the waypoint nearest to current camera position
        const cam = IsoEngine.getCameraState();
        let bestDist = Infinity;
        for (let i = 0; i < AUTO_PAN_WAYPOINTS.length; i++) {
          const wp = AUTO_PAN_WAYPOINTS[i];
          IsoEngine.centerOnTile(wp.col, wp.row);
          const wpCam = IsoEngine.getCameraState();
          const dx = wpCam.x - cam.x;
          const dy = wpCam.y - cam.y;
          const dist = dx * dx + dy * dy;
          if (dist < bestDist) {
            bestDist = dist;
            autoPanWaypointIdx = i;
          }
        }
        // Restore camera position
        IsoEngine.setCamera(cam.x, cam.y);
      }
      return;
    }

    // Auto-pan is active — advance through waypoints
    autoPanProgress++;

    if (autoPanPhase === 'pausing') {
      if (autoPanProgress >= AUTO_PAN_PAUSE_DURATION) {
        // Move to next waypoint
        autoPanPhase = 'moving';
        autoPanProgress = 0;
        autoPanWaypointIdx = (autoPanWaypointIdx + 1) % AUTO_PAN_WAYPOINTS.length;
        // Save current camera as start
        const cam = IsoEngine.getCameraState();
        autoPanStartX = cam.x;
        autoPanStartY = cam.y;
        // Compute target by centering on waypoint tile, then reading camera state
        const wp = AUTO_PAN_WAYPOINTS[autoPanWaypointIdx];
        IsoEngine.centerOnTile(wp.col, wp.row);
        const target = IsoEngine.getCameraState();
        autoPanEndX = target.x;
        autoPanEndY = target.y;
        // Restore camera to start (smooth interpolation will move it)
        IsoEngine.setCamera(autoPanStartX, autoPanStartY);
      }
    } else if (autoPanPhase === 'moving') {
      const t = Math.min(1, autoPanProgress / AUTO_PAN_MOVE_DURATION);
      // Smooth ease-in-out
      const ease = t < 0.5
        ? 2 * t * t
        : 1 - Math.pow(-2 * t + 2, 2) / 2;

      const cx = autoPanStartX + (autoPanEndX - autoPanStartX) * ease;
      const cy = autoPanStartY + (autoPanEndY - autoPanStartY) * ease;
      IsoEngine.setCamera(cx, cy);

      if (t >= 1) {
        autoPanPhase = 'pausing';
        autoPanProgress = 0;
      }
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
          IsoEngine.spawnHarvestParticles(pos.col + tc, pos.row, '#FFD700', 4);
        }
        // Emit harvest event for resource system
        if (typeof EventBus !== 'undefined') {
          EventBus.emit('CROP_HARVESTED', { crop: prev.crop, amount: 1, plotIndex: i });
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
          farmSetTile(tileCol, tileRow, 'dirt');
          continue;
        }

        farmSetTile(tileCol, tileRow, plot.crop ? 'soilwet' : 'soil');

        if (plot.crop && plot.stage > 0) {
          const cropType = plot.crop;
          const stage = plot.stage;
          const isMature = stage >= 4;
          const cropSpriteId = `crop_${cropType}`;
          const ent = IsoEntityManager.add(farmStatic(tileCol, tileRow,
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
        const ent = IsoEntityManager.add(farmAnimal(type, home.col, home.row, {
          wanderRadius: 2.5,
          minCol: wc(PASTURE_ZONE.minCol),
          maxCol: wc(PASTURE_ZONE.maxCol),
          minRow: wr(PASTURE_ZONE.minRow),
          maxRow: wr(PASTURE_ZONE.maxRow),
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

    const buildingTypes = ['well', 'barn', 'mill', 'windmill', 'workshop', 'market', 'clock', 'townhall', 'statue', 'museum'];
    for (const bld of buildingTypes) {
      if (!state.buildings[bld]) continue;
      const pos = BUILDING_POSITIONS[bld];
      if (!pos) continue;

      const ent = IsoEntityManager.add(farmStatic(pos.col, pos.row,
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
        wc(Math.min(slotCol, MAP_W - 2)), wr(10), {
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
    mill:     { w: 80,  h: 24 },
    windmill: { w: 100, h: 28 },
    workshop: { w: 80,  h: 22 },
    market:   { w: 140, h: 24 },
    clock:    { w: 56,  h: 18 },
    townhall: { w: 140, h: 32 },
    statue:   { w: 56,  h: 18 },
    museum:   { w: 120, h: 28 },
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
      case 'barn': drawBarn(ctx, sx, sy, tick); drawProcessingBar(ctx, sx, sy - 24, 'barn', tick); break;
      case 'mill': drawMill(ctx, sx, sy, tick); break;
      case 'windmill': drawWindmill(ctx, sx, sy, tick); break;
      case 'workshop': drawWorkshop(ctx, sx, sy, tick); break;
      case 'market': drawMarket(ctx, sx, sy, tick); break;
      case 'clock': drawClock(ctx, sx, sy, tick); break;
      case 'townhall': drawTownhall(ctx, sx, sy, tick); break;
      case 'statue': drawStatue(ctx, sx, sy, tick); break;
      case 'museum': drawMuseum(ctx, sx, sy, tick); break;
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

  function drawMill(ctx, sx, sy, tick) {
    // Stone mill building — converts corn → flour
    // Base shadow
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.beginPath();
    ctx.ellipse(sx, sy + 5, 16, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Stone circular base
    ctx.fillStyle = '#B0A090';
    ctx.beginPath();
    ctx.ellipse(sx, sy - 2, 14, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#A09080';
    ctx.beginPath();
    ctx.ellipse(sx, sy - 2, 12, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    // Stone texture lines
    ctx.strokeStyle = '#908070';
    ctx.lineWidth = 0.5;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(sx - 10, sy - 2 + i * 4);
      ctx.lineTo(sx + 10, sy - 2 + i * 4);
      ctx.stroke();
    }

    // Conical roof
    ctx.fillStyle = '#8B5A2B';
    ctx.beginPath();
    ctx.moveTo(sx, sy - 22);
    ctx.lineTo(sx - 15, sy - 8);
    ctx.lineTo(sx + 15, sy - 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#7A4A1B';
    ctx.beginPath();
    ctx.moveTo(sx, sy - 22);
    ctx.lineTo(sx - 8, sy - 8);
    ctx.lineTo(sx + 8, sy - 8);
    ctx.closePath();
    ctx.fill();

    // Door
    ctx.fillStyle = '#5A3818';
    ctx.fillRect(sx - 4, sy - 2, 8, 8);
    ctx.fillStyle = '#4A2808';
    ctx.fillRect(sx - 3, sy - 1, 6, 6);

    // Millstone wheel (rotating)
    const angle = (tick * 0.04) % (Math.PI * 2);
    ctx.save();
    ctx.translate(sx + 12, sy - 10);
    ctx.rotate(angle);
    ctx.fillStyle = '#888';
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#666';
    ctx.fillRect(-1, -5, 2, 10);
    ctx.fillRect(-5, -1, 10, 2);
    ctx.restore();

    // Grain sack at entrance
    ctx.fillStyle = '#D4B896';
    ctx.fillRect(sx + 6, sy + 1, 5, 4);
    ctx.fillStyle = '#C4A886';
    ctx.fillRect(sx + 7, sy, 3, 1);

    // Label
    ctx.fillStyle = '#FFF';
    ctx.font = 'bold 6px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('MILL', sx, sy + 10);

    // Processing progress bar
    drawProcessingBar(ctx, sx, sy - 26, 'mill', tick);
  }

  function drawWorkshop(ctx, sx, sy, tick) {
    // Wooden workshop/sawmill — converts wood → plank
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.beginPath();
    ctx.ellipse(sx, sy + 5, 15, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Main structure (wooden)
    ctx.fillStyle = '#8B6B3E';
    ctx.fillRect(sx - 12, sy - 14, 24, 18);
    ctx.fillStyle = '#A07840';
    ctx.fillRect(sx - 10, sy - 12, 20, 14);

    // Wood plank lines on walls
    ctx.strokeStyle = '#6B4226';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(sx - 10, sy - 10 + i * 4);
      ctx.lineTo(sx + 10, sy - 10 + i * 4);
      ctx.stroke();
    }

    // Roof (dark wood, sloped)
    ctx.fillStyle = '#5A3418';
    ctx.fillRect(sx - 14, sy - 18, 28, 5);
    ctx.fillStyle = '#6B4226';
    ctx.fillRect(sx - 13, sy - 19, 26, 2);

    // Open front (work area)
    ctx.fillStyle = '#3A2010';
    ctx.fillRect(sx - 6, sy - 6, 12, 10);

    // Saw blade (animated)
    const sawAngle = (tick * 0.08) % (Math.PI * 2);
    ctx.save();
    ctx.translate(sx, sy - 2);
    ctx.rotate(sawAngle);
    ctx.fillStyle = '#C0C0C0';
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    // Teeth
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 3, Math.sin(a) * 3);
      ctx.lineTo(Math.cos(a) * 5, Math.sin(a) * 5);
      ctx.stroke();
    }
    ctx.restore();

    // Wood logs stacked on the side
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#8B6B3E' : '#7A5A2E';
      ctx.fillRect(sx - 14, sy + i * 2 - 2, 3, 2);
    }

    // Planks leaning on wall
    ctx.fillStyle = '#C8A060';
    ctx.fillRect(sx + 11, sy - 8, 2, 10);
    ctx.fillRect(sx + 13, sy - 6, 2, 8);

    // Label
    ctx.fillStyle = '#FFF';
    ctx.font = 'bold 5px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('WORKSHOP', sx, sy + 10);

    // Processing progress bar
    drawProcessingBar(ctx, sx, sy - 24, 'workshop', tick);
  }

  /** Draw processing progress bar above a building. */
  function drawProcessingBar(ctx, sx, sy, buildingId, tick) {
    if (typeof Processing === 'undefined') return;
    if (!Processing.isUnlocked(buildingId)) return;

    const recipe = Processing.getRecipe(buildingId);
    if (!recipe) return;

    const progress = Processing.getProgress(buildingId);
    const isActive = Processing.isProcessing(buildingId);
    const barW = 24;
    const barH = 4;
    const bx = sx - barW / 2;
    const by = sy;

    if (isActive) {
      // Background
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      roundRect(ctx, bx - 1, by - 1, barW + 2, barH + 2, 2);
      ctx.fill();

      // Progress fill
      ctx.fillStyle = buildingId === 'mill' ? '#F0E68C' : '#C8A060';
      ctx.fillRect(bx, by, Math.floor(barW * progress), barH);

      // Shimmer on progress bar
      const shimmerX = bx + (tick * 0.5 % barW);
      if (shimmerX < bx + barW * progress) {
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.fillRect(shimmerX, by, 2, barH);
      }
    } else {
      // Idle indicator — small icon
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.font = '6px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const pulse = Math.sin(tick * 0.05) * 0.2 + 0.8;
      ctx.globalAlpha = pulse;
      ctx.fillText('\u{1F4A4}', sx, by + 2); // 💤 idle
      ctx.globalAlpha = 1;
    }
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

  // ===== Museum building =====

  function drawMuseum(ctx, sx, sy, tick) {
    // Stone foundation
    ctx.fillStyle = '#8B8680';
    ctx.fillRect(sx - 18, sy - 2, 36, 8);
    // Main building body
    ctx.fillStyle = '#D2C8B0';
    ctx.fillRect(sx - 16, sy - 22, 32, 20);
    // Roof (classical pediment triangle)
    ctx.fillStyle = '#B04838';
    ctx.beginPath();
    ctx.moveTo(sx - 20, sy - 22);
    ctx.lineTo(sx, sy - 34);
    ctx.lineTo(sx + 20, sy - 22);
    ctx.closePath();
    ctx.fill();
    // Roof outline
    ctx.strokeStyle = '#8B3828';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(sx - 20, sy - 22);
    ctx.lineTo(sx, sy - 34);
    ctx.lineTo(sx + 20, sy - 22);
    ctx.stroke();
    // Columns (4)
    ctx.fillStyle = '#E8E0D0';
    for (let i = 0; i < 4; i++) {
      const cx = sx - 12 + i * 8;
      ctx.fillRect(cx - 1, sy - 20, 3, 18);
    }
    // Door
    ctx.fillStyle = '#5A3A1A';
    ctx.fillRect(sx - 4, sy - 12, 8, 10);
    // Door handle
    ctx.fillStyle = '#FFD700';
    ctx.fillRect(sx + 2, sy - 8, 1, 1);
    // Windows (2)
    ctx.fillStyle = '#87CEEB';
    ctx.fillRect(sx - 12, sy - 16, 5, 5);
    ctx.fillRect(sx + 7, sy - 16, 5, 5);
    // Window frames
    ctx.strokeStyle = '#8B8680';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(sx - 12, sy - 16, 5, 5);
    ctx.strokeRect(sx + 7, sy - 16, 5, 5);
    // Museum sign
    ctx.fillStyle = '#FFD700';
    ctx.font = '5px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('MUSEUM', sx, sy + 8);
    // Collection progress indicator
    if (typeof CollectionUI !== 'undefined') {
      const pct = CollectionUI.getCompletionPercent();
      if (pct > 0) {
        ctx.fillStyle = '#FFD700';
        ctx.font = '6px monospace';
        ctx.fillText(`${pct}%`, sx, sy - 26);
      }
    }
    // Sparkle at top when collection > 50%
    if (typeof CollectionUI !== 'undefined' && CollectionUI.getCompletionPercent() > 50) {
      const sparkle = Math.sin(tick * 0.08) * 0.4 + 0.6;
      ctx.fillStyle = `rgba(255, 215, 0, ${sparkle})`;
      ctx.fillRect(sx - 1, sy - 36, 2, 2);
    }
  }

  // ===== Lamp post (lights up at night) =====

  function drawLampPost(ctx, sx, sy, tick) {
    const night = (typeof IsoWeather !== 'undefined') ? IsoWeather.isNight() || IsoWeather.isDusk() : false;

    // Post
    ctx.fillStyle = '#555';
    ctx.fillRect(sx - 1, sy - 20, 2, 20);

    // Lamp head
    ctx.fillStyle = '#666';
    ctx.fillRect(sx - 4, sy - 22, 8, 3);

    if (night) {
      // Warm glow
      ctx.save();
      const grad = ctx.createRadialGradient(sx, sy - 18, 2, sx, sy - 10, 28);
      grad.addColorStop(0, 'rgba(255, 220, 100, 0.5)');
      grad.addColorStop(0.4, 'rgba(255, 200, 80, 0.2)');
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(sx, sy - 10, 28, 0, Math.PI * 2);
      ctx.fill();

      // Bright bulb
      ctx.fillStyle = '#FFDD66';
      ctx.beginPath();
      ctx.arc(sx, sy - 20, 3, 0, Math.PI * 2);
      ctx.fill();

      // Flicker
      if (tick % 120 < 3) {
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = '#FFF';
        ctx.beginPath();
        ctx.arc(sx, sy - 20, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    } else {
      // Daytime: dull bulb
      ctx.fillStyle = '#AAA';
      ctx.beginPath();
      ctx.arc(sx, sy - 20, 2, 0, Math.PI * 2);
      ctx.fill();
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

    goldenBirdEntity = IsoEntityManager.add(farmStatic(
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

    monumentEntity = IsoEntityManager.add(farmStatic(17, 2,
      (ctx, sx, sy, tick) => {
        // Use MonumentV2 if available, fallback to v1
        if (typeof MonumentV2 !== 'undefined') {
          MonumentV2.draw(ctx, sx, sy, tick);
        } else {
          drawMonument(ctx, sx, sy, tick, state);
        }
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

  // ===== Resource HUD bar =====

  // Resource icon emoji map
  const RESOURCE_ICONS = {
    gold: '\u{1FA99}',        // 🪙
    wood: '\u{1FAB5}',        // 🪵
    stone: '\u{1FAA8}',       // 🪨
    carrot: '\u{1F955}',      // 🥕
    sunflower: '\u{1F33B}',   // 🌻
    watermelon: '\u{1F349}',  // 🍉
    tomato: '\u{1F345}',      // 🍅
    corn: '\u{1F33D}',        // 🌽
    pumpkin: '\u{1F383}',     // 🎃
    flour: '\u{1F35E}',       // 🍞
    plank: '\u{1FA9C}',       // 🪜 (close enough)
    feed: '\u{1F963}',        // 🥣
    fish: '\u{1F41F}',        // 🐟
  };

  // Bounce animations for resource changes
  let resourceBounces = {}; // { resourceId: { startTick, delta } }

  function drawResourceBar(ctx, x, y, tick) {
    const summary = ResourceInventory.getSummary();
    if (summary.length === 0) return;

    // Process pending change animations
    const changes = ResourceInventory.popChanges();
    for (const ch of changes) {
      resourceBounces[ch.resource] = { startTick: tick, delta: ch.delta };
    }

    // Background panel
    const itemW = 44;
    const barW = Math.min(summary.length * itemW + 12, 230);
    const barH = 18;
    ctx.fillStyle = 'rgba(20, 20, 40, 0.7)';
    roundRect(ctx, x, y, barW, barH, 4);
    ctx.fill();

    // Draw each resource
    ctx.font = '8px monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    let dx = x + 6;
    for (const item of summary) {
      if (dx > x + barW - 10) break; // overflow guard

      const icon = RESOURCE_ICONS[item.id] || '\u{1F4E6}'; // 📦 fallback
      const bounce = resourceBounces[item.id];
      let offsetY = 0;
      let scale = 1;

      // Bounce animation (30 frames)
      if (bounce) {
        const elapsed = tick - bounce.startTick;
        if (elapsed < 30) {
          offsetY = -Math.sin(elapsed / 30 * Math.PI) * 3;
          scale = 1 + Math.sin(elapsed / 30 * Math.PI) * 0.15;
        } else {
          delete resourceBounces[item.id];
        }
      }

      // Icon
      ctx.save();
      if (scale !== 1) {
        ctx.translate(dx + 4, y + barH / 2 + offsetY);
        ctx.scale(scale, scale);
        ctx.translate(-(dx + 4), -(y + barH / 2 + offsetY));
      }
      ctx.fillStyle = '#FFF';
      ctx.fillText(icon, dx, y + barH / 2 + offsetY);
      ctx.restore();

      // Count
      ctx.fillStyle = bounce && (tick - bounce.startTick) < 15 ? '#FFD700' : '#FFF';
      ctx.fillText(String(item.amount), dx + 12, y + barH / 2 + offsetY);

      dx += itemW;
    }
  }

  function drawHUD(ctx, canvasW, canvasH, tick) {
    // Update shipping bin proximity
    updateShippingBin(tick);

    // Update golden bird random event
    updateGoldenBird(tick);

    const state = (typeof Farm !== 'undefined') ? Farm.getState() : null;
    if (!state) return;

    const energy = state.totalEnergy || 0;
    const vibe = (typeof Farm !== 'undefined') ? Farm.getVibe() : null;

    // Top-left: Energy (like stamina)
    drawEnergyBar(ctx, 8, 8, energy);

    // Token burning indicator (right of energy bar)
    drawTokenBurnIndicator(ctx, 150, 8, tick);

    // Top-left (below energy): Resource inventory bar
    if (typeof ResourceInventory !== 'undefined') {
      drawResourceBar(ctx, 8, 32, tick);
    }

    // Top-right: Status panel (date/milestone/currency)
    drawStatusPanel(ctx, canvasW - 158, 8, energy, state, tick);

    // Bottom-left: Season + Animal/crop count
    const animalCount = animalEntities.size;
    const cropCount = cropEntities.length;
    const seasonEmoji = { spring: '\u{1F338}', summer: '\u{2600}\u{FE0F}', autumn: '\u{1F341}', winter: '\u{2744}\u{FE0F}' };
    const season = (typeof IsoWeather !== 'undefined') ? IsoWeather.getSeason() : null;
    const seasonBadge = season ? (seasonEmoji[season] || '') + season.charAt(0).toUpperCase() + season.slice(1) : '';
    const weather = (typeof IsoWeather !== 'undefined') ? IsoWeather.getWeather() : null;
    const weatherEmoji = { clear: '\u{2600}\u{FE0F}', cloudy: '\u{2601}\u{FE0F}', rain: '\u{1F327}\u{FE0F}', fog: '\u{1F32B}\u{FE0F}' };
    const weatherBadge = weather ? ' ' + (weatherEmoji[weather] || '') : '';
    {
      const label = seasonBadge + weatherBadge + (animalCount > 0 || cropCount > 0 ? `  \u{1F43E}${animalCount}  \u{1F33E}${cropCount}` : '');
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

    // Snapshot camera button (bottom-right, above vibe)
    drawSnapshotButton(ctx, canvasW - 32, canvasH - 52, tick, canvasW, canvasH);

    // Minimap (top-right corner)
    if (typeof Minimap !== 'undefined') {
      Minimap.draw(ctx, canvasW, canvasH, tick);
    }

    // Shipping bin sell prompt (when player is nearby)
    drawSellPrompt(ctx, canvasW, canvasH);
  }

  // ===== Snapshot button =====

  let snapshotFlash = 0; // flash animation counter

  function drawSnapshotButton(ctx, x, y, tick, canvasW, canvasH) {
    // Track canvas size for hit testing
    snapshotCanvasW = canvasW || 0;
    snapshotCanvasH = canvasH || 0;

    // Button background
    ctx.fillStyle = snapshotFlash > 0 ? 'rgba(255, 255, 255, 0.9)' : 'rgba(20, 20, 40, 0.7)';
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.fill();

    // Camera icon
    ctx.fillStyle = snapshotFlash > 0 ? '#333' : '#FFF';
    ctx.font = '12px monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText('\u{1F4F7}', x, y);

    if (snapshotFlash > 0) snapshotFlash--;
  }

  // Snapshot button hit test (called from handleFarmClick or separate handler)
  let snapshotBtnX = 0, snapshotBtnY = 0, snapshotCanvasW = 0, snapshotCanvasH = 0;

  function handleSnapshotClick(screenX, screenY, canvas) {
    // Check if click is on the snapshot button (screen coords)
    const btnX = (snapshotCanvasW || 900) - 32;
    const btnY = (snapshotCanvasH || 700) - 52;
    const dx = screenX - btnX;
    const dy = screenY - btnY;
    if (Math.sqrt(dx * dx + dy * dy) > 14) return false;

    // Trigger snapshot
    snapshotFlash = 15;
    captureSnapshot(canvas);
    return true;
  }

  function captureSnapshot(canvas) {
    if (!canvas) {
      canvas = document.getElementById('farm-canvas') || document.getElementById('canvas');
    }
    if (!canvas) return;

    // Create a temporary canvas for the snapshot with watermark
    const snap = document.createElement('canvas');
    snap.width = canvas.width;
    snap.height = canvas.height;
    const sCtx = snap.getContext('2d');
    sCtx.drawImage(canvas, 0, 0);

    // Add watermark border
    sCtx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    sCtx.fillRect(0, snap.height - 24, snap.width, 24);
    sCtx.fillStyle = '#FFD700';
    sCtx.font = 'bold 10px monospace';
    sCtx.textBaseline = 'middle';
    sCtx.textAlign = 'left';
    sCtx.fillText('\u{1F33E} AIFarm — Claude Buddy', 8, snap.height - 12);

    // Timestamp
    const now = new Date();
    const ts = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    sCtx.textAlign = 'right';
    sCtx.fillStyle = '#AAA';
    sCtx.font = '9px monospace';
    sCtx.fillText(ts, snap.width - 8, snap.height - 12);

    // Download
    const link = document.createElement('a');
    link.download = `aifarm-snapshot-${Date.now()}.png`;
    link.href = snap.toDataURL('image/png');
    link.click();

    // Farm log
    if (typeof Farm !== 'undefined' && Farm.logEvent) {
      Farm.logEvent('\u{1F4F7}', 'Farm snapshot saved!');
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

  /** Re-initialize the overworld map after returning from interior scene. */
  function reloadMap() {
    initialized = false;
    init();
    syncState();
  }

  // --- Token Burning Pulse Indicator ---

  /** Called by renderer when an energy tick arrives. */
  function notifyEnergyTick(pts) {
    const now = Date.now();
    tokenBurnTicks.push(now);
    // Floating "-X" text
    tokenBurnFloats.push({ pts, born: now, alpha: 1.0 });
    // Keep only last 30s of ticks
    while (tokenBurnTicks.length > 0 && now - tokenBurnTicks[0] > 30000) {
      tokenBurnTicks.shift();
    }
    // Smooth rate: ticks in last 10 seconds
    const recent = tokenBurnTicks.filter(t => now - t < 10000).length;
    tokenBurnRate = recent / 10; // ticks per second
  }

  function drawTokenBurnIndicator(ctx, x, y, tick) {
    const activeSessions = buddyEntities.size;
    const now = Date.now();

    // Clean expired floating texts (older than 2s)
    tokenBurnFloats = tokenBurnFloats.filter(f => now - f.born < 2000);

    // Update smoothed rate
    const recent = tokenBurnTicks.filter(t => now - t < 10000).length;
    tokenBurnRate = recent / 10;

    const isActive = activeSessions > 0 || tokenBurnRate > 0;
    if (!isActive) return;

    // Background pill
    const pillW = activeSessions > 0 ? 72 : 50;
    ctx.fillStyle = 'rgba(20, 20, 40, 0.75)';
    roundRect(ctx, x, y, pillW, 18, 4);
    ctx.fill();

    // Pulsing flame icon
    const pulsePhase = Math.sin(tick * 0.15) * 0.3 + 0.7; // 0.4 to 1.0
    const flameScale = tokenBurnRate > 0 ? 1.0 + Math.sin(tick * 0.2) * 0.15 : 0.8;
    ctx.save();
    ctx.globalAlpha = pulsePhase;
    ctx.fillStyle = tokenBurnRate > 0 ? '#FF6B35' : '#888';
    ctx.font = `bold ${Math.round(11 * flameScale)}px monospace`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('\u{1F525}', x + 3, y + 10); // 🔥
    ctx.restore();

    // Session count
    if (activeSessions > 0) {
      ctx.fillStyle = '#FFF';
      ctx.font = 'bold 9px monospace';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(activeSessions + ' active', x + 16, y + 10);
    }

    // Rate indicator (ticks/sec)
    if (tokenBurnRate > 0) {
      const rateText = tokenBurnRate.toFixed(1) + '/s';
      ctx.fillStyle = '#FF9F43';
      ctx.font = '8px monospace';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const rateX = activeSessions > 0 ? x + 50 : x + 16;
      ctx.fillText(rateText, rateX, y + 10);
    }

    // Floating "-X" texts
    for (const f of tokenBurnFloats) {
      const age = (now - f.born) / 2000; // 0 to 1 over 2 seconds
      const floatY = y - 4 - age * 16;   // drift upward 16px
      f.alpha = 1.0 - age;
      ctx.save();
      ctx.globalAlpha = Math.max(0, f.alpha);
      ctx.fillStyle = '#FF6B35';
      ctx.font = 'bold 8px monospace';
      ctx.textBaseline = 'bottom';
      ctx.textAlign = 'center';
      ctx.fillText('+' + f.pts, x + pillW / 2, floatY);
      ctx.restore();
    }
  }

  return {
    MAP_W, MAP_H,
    FIELD, PASTURE_ZONE, EXTENSION_ZONE,
    PLOT_POSITIONS, BUILDING_POSITIONS, ANIMAL_HOMES,
    init, syncState, syncBuddy, removeBuddy, drawHUD, handleFarmClick, handleSnapshotClick,
    getBuddyEntity, getCropStage, updateStartupAnimation,
    isStartupAnimating: () => !!startupAnim,
    updateAutoPan, interruptAutoPan, resetAutoPan,
    sellAllCrops, reloadMap, notifyEnergyTick,
  };
})();
