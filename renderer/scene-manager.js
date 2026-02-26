/**
 * scene-manager.js — Interior Scene System (Sprint 22 P1b).
 *
 * Manages transitions between overworld and interior scenes.
 * DoorTrigger zones near buildings → fade transition → interior render mode.
 * Interior has its own tile layout, camera lock, and entity list.
 *
 * Flow: Press [E] near door → Fade Out → Switch Scene → Fade In
 */
const SceneManager = (() => {
  // ===== Scene states =====
  const SCENE = {
    OVERWORLD: 'overworld',
    INTERIOR: 'interior',
  };

  let currentScene = SCENE.OVERWORLD;

  // ===== Fade transition =====
  const FADE_DURATION = 30; // ticks (~0.5s)
  let fadeAlpha = 0;        // 0 = clear, 1 = black
  let fadeDirection = null;  // 'out' | 'in' | null
  let fadeTimer = 0;
  let fadeCallback = null;   // called when fade-out completes
  let inputLocked = false;

  // ===== Active interior data =====
  let activeInterior = null; // interior definition
  let interiorId = null;     // which interior we're in
  let overworldPlayerPos = null; // saved position for return

  // ===== Door Triggers (overworld, local farm coords) =====
  const DOOR_TRIGGERS = [
    {
      id: 'cabin',
      col: 2, row: 9,   // near tool shed (cabin entrance)
      targetInterior: 'cabin',
      prompt: 'Press [E] to enter Cabin',
    },
  ];

  // ===== Interior Definitions =====
  const INTERIORS = {
    cabin: {
      name: 'The Cabin',
      width: 8,
      height: 8,
      // Tile layout: wood floor, stone walls
      tiles: generateCabinLayout(),
      door: { col: 4, row: 7 },         // exit door position (inside)
      playerSpawn: { col: 4, row: 5 },   // where player appears inside
      furniture: [
        // { col, row, type, draw }
        { col: 1, row: 1, type: 'fireplace' },
        { col: 6, row: 1, type: 'bed' },
        { col: 3, row: 1, type: 'shelf' },
      ],
    },
  };

  function generateCabinLayout() {
    const W = 8, H = 8;
    const tiles = [];
    for (let r = 0; r < H; r++) {
      tiles[r] = [];
      for (let c = 0; c < W; c++) {
        // Walls on edges
        if (r === 0 || c === 0 || c === W - 1) {
          tiles[r][c] = 'stone';
        }
        // Back row: wall except door
        else if (r === H - 1) {
          tiles[r][c] = (c === 4) ? 'path' : 'stone'; // door at col 4
        }
        // Floor
        else {
          tiles[r][c] = 'dirt'; // wood-like floor (dirt tile = brown)
        }
      }
    }
    // Rug in center
    tiles[3][3] = 'soil';
    tiles[3][4] = 'soil';
    tiles[4][3] = 'soil';
    tiles[4][4] = 'soil';
    return tiles;
  }

  // ===== Home offset helper =====
  function _off() {
    return (typeof IsoEngine !== 'undefined' && IsoEngine.getHomeOffset)
      ? IsoEngine.getHomeOffset() : { col: 0, row: 0 };
  }

  // ===== Door trigger proximity =====

  /** Check if player is near any door trigger. Returns trigger or null. */
  function getNearDoor() {
    if (currentScene !== SCENE.OVERWORLD) return null;
    if (typeof Player === 'undefined') return null;
    const pt = Player.getTile();
    const off = _off();

    for (const trigger of DOOR_TRIGGERS) {
      const dx = Math.abs(pt.col - (trigger.col + off.col));
      const dy = Math.abs(pt.row - (trigger.row + off.row));
      if (dx <= 1 && dy <= 1) return trigger;
    }
    return null;
  }

  /** Check if player is near the exit door (interior). */
  function isNearExitDoor() {
    if (currentScene !== SCENE.INTERIOR || !activeInterior) return false;
    if (typeof Player === 'undefined') return false;
    const pt = Player.getTile();
    const door = activeInterior.door;
    const dx = Math.abs(pt.col - door.col);
    const dy = Math.abs(pt.row - door.row);
    return dx <= 1 && dy <= 1;
  }

  // ===== Scene transitions =====

  /** Enter an interior scene with fade transition. */
  function enterInterior(triggerId) {
    const interior = INTERIORS[triggerId];
    if (!interior) return false;
    if (inputLocked) return false;

    // Save overworld position
    if (typeof Player !== 'undefined') {
      const pt = Player.getTile();
      overworldPlayerPos = { col: pt.col, row: pt.row };
    }

    // Start fade-out
    startFade('out', () => {
      // Switch to interior
      activeInterior = interior;
      interiorId = triggerId;
      currentScene = SCENE.INTERIOR;

      // Set up interior tiles in IsoEngine
      setupInteriorTiles(interior);

      // Move player to interior spawn
      if (typeof Player !== 'undefined') {
        Player.setPosition(
          interior.playerSpawn.col * IsoEngine.TILE_W + IsoEngine.TILE_W / 2,
          interior.playerSpawn.row * IsoEngine.TILE_H + IsoEngine.TILE_H / 2
        );
      }

      // Center camera on room (locked, no follow)
      if (typeof IsoEngine !== 'undefined') {
        IsoEngine.centerOnTile(
          Math.floor(interior.width / 2),
          Math.floor(interior.height / 2)
        );
      }

      // Clear overworld entities from render
      if (typeof IsoEngine !== 'undefined') {
        IsoEngine.clearEntities();
      }

      // Spawn interior furniture entities
      spawnInteriorEntities(interior);

      if (typeof Farm !== 'undefined' && Farm.logEvent) {
        Farm.logEvent('\u{1F6AA}', `Entered ${interior.name}`);
      }

      // Start fade-in
      startFade('in', null);
    });

    return true;
  }

  /** Exit interior, return to overworld. */
  function exitInterior() {
    if (currentScene !== SCENE.INTERIOR) return false;
    if (inputLocked) return false;

    startFade('out', () => {
      // Restore overworld
      currentScene = SCENE.OVERWORLD;
      activeInterior = null;
      interiorId = null;

      // Exit interior render mode in engine
      if (typeof IsoEngine !== 'undefined') {
        IsoEngine.exitInteriorMode();
      }

      // Restore player position
      if (typeof Player !== 'undefined' && overworldPlayerPos) {
        Player.setPosition(
          overworldPlayerPos.col * IsoEngine.TILE_W + IsoEngine.TILE_W / 2,
          overworldPlayerPos.row * IsoEngine.TILE_H + IsoEngine.TILE_H / 2
        );
      }

      // Re-initialize overworld map (reloads chunk data)
      if (typeof IsoFarm !== 'undefined' && IsoFarm.reloadMap) {
        IsoFarm.reloadMap();
      }

      if (typeof Farm !== 'undefined' && Farm.logEvent) {
        Farm.logEvent('\u{1F6AA}', 'Returned to overworld');
      }

      startFade('in', null);
    });

    return true;
  }

  // ===== Fade helpers =====

  function startFade(direction, callback) {
    fadeDirection = direction;
    fadeTimer = FADE_DURATION;
    fadeCallback = callback;
    inputLocked = true;
    if (direction === 'out') {
      fadeAlpha = 0;
    } else {
      fadeAlpha = 1;
    }
  }

  function updateFade() {
    if (!fadeDirection) return;

    fadeTimer--;
    const progress = 1 - fadeTimer / FADE_DURATION;

    if (fadeDirection === 'out') {
      fadeAlpha = progress; // 0 → 1
    } else {
      fadeAlpha = 1 - progress; // 1 → 0
    }

    if (fadeTimer <= 0) {
      if (fadeDirection === 'out') {
        fadeAlpha = 1;
        if (fadeCallback) {
          fadeCallback();
          fadeCallback = null;
          return; // fade-in started in callback
        }
      } else {
        fadeAlpha = 0;
        inputLocked = false;
      }
      fadeDirection = null;
    }
  }

  // ===== Interior tile setup =====

  function setupInteriorTiles(interior) {
    if (typeof IsoEngine === 'undefined') return;

    // Switch engine to interior render mode (uses interior tile array directly)
    IsoEngine.enterInteriorMode(interior.tiles, interior.width, interior.height);
  }

  function spawnInteriorEntities(interior) {
    if (typeof IsoEntityManager === 'undefined') return;
    IsoEntityManager.clear();

    for (const furn of interior.furniture) {
      const drawFn = getFurnitureDrawFn(furn.type);
      if (drawFn) {
        IsoEntityManager.add(IsoEntityManager.createStatic(
          furn.col, furn.row, drawFn, { z: 0 }
        ));
      }
    }
  }

  // ===== Furniture drawing =====

  function getFurnitureDrawFn(type) {
    switch (type) {
      case 'fireplace': return drawFireplace;
      case 'bed': return drawBed;
      case 'shelf': return drawShelf;
      default: return null;
    }
  }

  function drawFireplace(ctx, sx, sy, tick) {
    // Stone base
    ctx.fillStyle = '#8B8B8B';
    ctx.fillRect(sx - 8, sy - 14, 16, 14);
    // Opening
    ctx.fillStyle = '#333';
    ctx.fillRect(sx - 5, sy - 10, 10, 10);
    // Fire glow
    const flicker = Math.sin(tick * 0.2) * 0.3 + 0.7;
    ctx.fillStyle = `rgba(255, 120, 20, ${flicker.toFixed(2)})`;
    ctx.fillRect(sx - 3, sy - 7, 6, 5);
    // Ember
    ctx.fillStyle = '#FFD700';
    ctx.fillRect(sx - 1, sy - 5, 2, 2);
    // Chimney top
    ctx.fillStyle = '#777';
    ctx.fillRect(sx - 3, sy - 18, 6, 4);
  }

  function drawBed(ctx, sx, sy, tick) {
    // Frame
    ctx.fillStyle = '#8B6B3E';
    ctx.fillRect(sx - 7, sy - 10, 14, 10);
    // Mattress
    ctx.fillStyle = '#F5F5DC';
    ctx.fillRect(sx - 6, sy - 9, 12, 6);
    // Pillow
    ctx.fillStyle = '#FFF';
    ctx.fillRect(sx - 5, sy - 8, 4, 3);
    // Blanket
    ctx.fillStyle = '#4A90D9';
    ctx.fillRect(sx - 1, sy - 8, 7, 5);
  }

  function drawShelf(ctx, sx, sy, tick) {
    // Back panel
    ctx.fillStyle = '#8B6B3E';
    ctx.fillRect(sx - 6, sy - 16, 12, 16);
    // Shelves
    ctx.fillStyle = '#A0824A';
    ctx.fillRect(sx - 5, sy - 12, 10, 1);
    ctx.fillRect(sx - 5, sy - 7, 10, 1);
    // Items on shelves
    ctx.fillStyle = '#FF6B6B';
    ctx.fillRect(sx - 3, sy - 15, 3, 3);  // book
    ctx.fillStyle = '#4FC3F7';
    ctx.fillRect(sx + 1, sy - 14, 2, 2);  // jar
    ctx.fillStyle = '#FFD700';
    ctx.fillRect(sx - 2, sy - 10, 2, 3);  // potion
    ctx.fillStyle = '#8BC34A';
    ctx.fillRect(sx + 2, sy - 10, 2, 3);  // herb
  }

  // ===== Drawing =====

  /** Draw fade overlay. Called last in render pipeline. */
  function drawFade(ctx, canvasW, canvasH) {
    if (fadeAlpha <= 0) return;
    ctx.fillStyle = `rgba(0, 0, 0, ${fadeAlpha.toFixed(3)})`;
    ctx.fillRect(0, 0, canvasW, canvasH);
  }

  /** Draw door proximity prompt (overworld or interior). */
  function drawPrompt(ctx, canvasW, canvasH) {
    if (inputLocked) return;

    let text = null;

    if (currentScene === SCENE.OVERWORLD) {
      const trigger = getNearDoor();
      if (trigger) {
        // Don't show if shop or other UI is open
        if (typeof ShopUI !== 'undefined' && (ShopUI.isOpen() || ShopUI.isNearShop())) return;
        text = '\u{1F6AA} ' + trigger.prompt;
      }
    } else if (currentScene === SCENE.INTERIOR) {
      if (isNearExitDoor()) {
        text = '\u{1F6AA} Press [E] to exit';
      }
    }

    if (!text) return;

    ctx.font = 'bold 9px monospace';
    const tw = ctx.measureText(text).width;
    const px = (canvasW - tw) / 2 - 8;
    const py = canvasH - 42;

    ctx.fillStyle = 'rgba(20, 40, 60, 0.8)';
    ctx.beginPath();
    ctx.roundRect(px, py, tw + 16, 18, 4);
    ctx.fill();

    ctx.fillStyle = '#FFD700';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvasW / 2, py + 9);
  }

  // ===== Update =====

  function update(tick) {
    updateFade();
  }

  // ===== Action handler (E key) =====

  /** Handle E key press. Returns true if consumed. */
  function handleAction() {
    if (inputLocked) return false;

    if (currentScene === SCENE.OVERWORLD) {
      const trigger = getNearDoor();
      if (trigger) {
        enterInterior(trigger.targetInterior);
        return true;
      }
    } else if (currentScene === SCENE.INTERIOR) {
      if (isNearExitDoor()) {
        exitInterior();
        return true;
      }
    }

    return false;
  }

  // ===== Public API =====

  function isOverworld() { return currentScene === SCENE.OVERWORLD; }
  function isInterior() { return currentScene === SCENE.INTERIOR; }
  function isInputLocked() { return inputLocked; }
  function getScene() { return currentScene; }
  function getInteriorId() { return interiorId; }
  function getActiveInterior() { return activeInterior; }

  return {
    SCENE,
    update,
    handleAction,
    drawFade,
    drawPrompt,
    isOverworld,
    isInterior,
    isInputLocked,
    getScene,
    getInteriorId,
    getActiveInterior,
    getNearDoor,
  };
})();

if (typeof module !== 'undefined') module.exports = SceneManager;
