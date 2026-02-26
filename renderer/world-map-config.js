/**
 * world-map-config.js — Deterministic Mega-World Configuration (Sprint 22 P0).
 *
 * Defines the world layout: 256x256 tiles (16x16 chunks), fixed landmarks,
 * biome zones, and mountain wall borders.
 *
 * Design principles (from Joe):
 *   1. Terrain is deterministic — same walk, same view every time
 *   2. Map is large with discoverable landmarks (hot springs, ruins, etc.)
 *   3. Borders are natural mountain walls, not void
 */
const WorldMapConfig = (() => {
  // ===== World dimensions =====
  const WORLD_CHUNKS_W = 16;   // 16 chunks wide
  const WORLD_CHUNKS_H = 16;   // 16 chunks tall
  const CHUNK_SIZE = 16;        // tiles per chunk side
  const WORLD_TILES_W = WORLD_CHUNKS_W * CHUNK_SIZE; // 256
  const WORLD_TILES_H = WORLD_CHUNKS_H * CHUNK_SIZE; // 256

  // Global seed for deterministic terrain
  const WORLD_SEED = 42;

  // ===== Biome definitions =====
  // Each biome has terrain weights and tree density
  const BIOMES = {
    plains: {
      name: 'Plains',
      tiles: { grass: 0.55, darkgrass: 0.20, dirt: 0.10, path: 0.08, sand: 0.05, stone: 0.02 },
      treeDensity: 0.08,
      waterChance: 0.02,
    },
    forest: {
      name: 'Forest',
      tiles: { darkgrass: 0.40, grass: 0.25, dirt: 0.15, path: 0.10, stone: 0.05, sand: 0.05 },
      treeDensity: 0.22,
      waterChance: 0.03,
    },
    desert: {
      name: 'Desert',
      tiles: { sand: 0.55, dirt: 0.20, stone: 0.10, path: 0.08, grass: 0.05, darkgrass: 0.02 },
      treeDensity: 0.02,
      waterChance: 0.01,
    },
    wetland: {
      name: 'Wetland',
      tiles: { darkgrass: 0.35, grass: 0.25, dirt: 0.20, sand: 0.10, path: 0.05, stone: 0.05 },
      treeDensity: 0.12,
      waterChance: 0.15,
    },
    rocky: {
      name: 'Rocky Hills',
      tiles: { stone: 0.40, dirt: 0.20, darkgrass: 0.15, grass: 0.10, sand: 0.10, path: 0.05 },
      treeDensity: 0.05,
      waterChance: 0.01,
    },
    mountain_border: {
      name: 'Mountain',
      tiles: { stone: 0.70, dirt: 0.20, darkgrass: 0.10 },
      treeDensity: 0,
      waterChance: 0,
      impassable: true,  // all tiles become mountain walls
    },
  };

  // ===== Biome map =====
  // Defines which biome each chunk (cx, cy) belongs to.
  // Uses a simple zone system based on distance/direction from center.
  function getBiome(cx, cy) {
    // Border: 1-tile-thick ring of mountain chunks
    if (cx <= 0 || cx >= WORLD_CHUNKS_W - 1 || cy <= 0 || cy >= WORLD_CHUNKS_H - 1) {
      return 'mountain_border';
    }

    // Center area (home farm) — plains
    const centerX = WORLD_CHUNKS_W / 2;  // 8
    const centerY = WORLD_CHUNKS_H / 2;  // 8
    const dx = cx - centerX;
    const dy = cy - centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Immediate home area: plains
    if (dist <= 2) return 'plains';

    // Quadrant-based biome distribution (deterministic)
    // NW: forest, NE: rocky, SW: wetland, SE: desert
    // With blending at borders based on angle
    const angle = Math.atan2(dy, dx); // -PI to PI
    const norm = (angle + Math.PI) / (2 * Math.PI); // 0 to 1

    // Near-mountain transition (ring just inside border)
    if (cx <= 1 || cx >= WORLD_CHUNKS_W - 2 || cy <= 1 || cy >= WORLD_CHUNKS_H - 2) {
      return 'rocky';
    }

    // Use a deterministic hash to add some variety
    const biomeHash = _simpleSeed(cx * 7 + cy * 13 + WORLD_SEED);

    if (norm < 0.25) {
      // East: mix of plains and desert
      return biomeHash < 0.4 ? 'desert' : 'plains';
    } else if (norm < 0.5) {
      // South: wetland
      return biomeHash < 0.3 ? 'plains' : 'wetland';
    } else if (norm < 0.75) {
      // West: forest
      return biomeHash < 0.3 ? 'plains' : 'forest';
    } else {
      // North: rocky + forest mix
      return biomeHash < 0.5 ? 'rocky' : 'forest';
    }
  }

  // Simple deterministic 0-1 value from integer input
  function _simpleSeed(n) {
    let h = n;
    h = ((h >> 16) ^ h) * 0x45d9f3b;
    h = ((h >> 16) ^ h) * 0x45d9f3b;
    h = (h >> 16) ^ h;
    return (h & 0x7FFFFFFF) / 0x7FFFFFFF;
  }

  // ===== Fixed Landmark Registry =====
  // Hand-placed landmarks at specific chunk coordinates.
  // When a chunk loads, if it's in this registry, the prefab is stamped.
  const LANDMARKS = {
    // Home Farm — chunk (8, 8), the existing farm layout
    'home_farm': {
      cx: 8, cy: 8,
      name: 'Home Farm',
      icon: '\u{1F3E0}',
      description: 'Your cozy home farm — where it all began.',
      type: 'home',
    },
    // Hot Spring — NW forest
    'hot_spring': {
      cx: 4, cy: 4,
      name: 'Hot Spring',
      icon: '\u{2668}',
      description: 'A natural hot spring hidden in the forest. Restores stamina.',
      type: 'hot_spring',
      // Prefab: 5x5 area of special tiles centered in chunk
      prefab: generateHotSpringPrefab(),
      interactable: true,
      effect: { staminaRecoveryMult: 3.0 },
    },
    // Ancient Ruins — SE desert
    'ancient_ruins': {
      cx: 12, cy: 10,
      name: 'Ancient Ruins',
      icon: '\u{1F3DB}',
      description: 'Crumbling pillars of a forgotten civilization.',
      type: 'ruins',
      prefab: generateRuinsPrefab(),
      interactable: true,
      effect: { goldBonus: 50 },
    },
    // Fairy Grove — W forest
    'fairy_grove': {
      cx: 3, cy: 8,
      name: 'Fairy Grove',
      icon: '\u{1F33F}',
      description: 'Glowing mushrooms and floating lights. Magical.',
      type: 'fairy_grove',
      prefab: generateFairyGrovePrefab(),
      interactable: true,
    },
    // Fishing Lake — S wetland
    'fishing_lake': {
      cx: 8, cy: 12,
      name: 'Crystal Lake',
      icon: '\u{1F41F}',
      description: 'A crystal-clear lake teeming with fish.',
      type: 'lake',
      prefab: generateLakePrefab(),
      interactable: true,
    },
    // Mountain Lookout — N rocky
    'mountain_lookout': {
      cx: 8, cy: 3,
      name: 'Mountain Lookout',
      icon: '\u{26F0}',
      description: 'A high vantage point. You can see the whole valley.',
      type: 'lookout',
      prefab: generateLookoutPrefab(),
      interactable: true,
    },
    // Oasis — E desert
    'desert_oasis': {
      cx: 13, cy: 8,
      name: 'Desert Oasis',
      icon: '\u{1F334}',
      description: 'A lush oasis in the arid desert. Water and shade.',
      type: 'oasis',
      prefab: generateOasisPrefab(),
      interactable: true,
      effect: { staminaRecoveryMult: 2.0 },
    },
  };

  // Build quick lookup: "cx,cy" → landmark
  const LANDMARK_BY_CHUNK = {};
  for (const [id, lm] of Object.entries(LANDMARKS)) {
    LANDMARK_BY_CHUNK[`${lm.cx},${lm.cy}`] = { ...lm, id };
  }

  // ===== Prefab generators =====
  // Each returns a { tiles: string[][], offsetCol, offsetRow, width, height }
  // that gets stamped onto the chunk.

  function generateHotSpringPrefab() {
    const W = 6, H = 6;
    const tiles = [];
    for (let r = 0; r < H; r++) {
      tiles[r] = [];
      for (let c = 0; c < W; c++) {
        // Outer ring: stone path
        if (r === 0 || r === H - 1 || c === 0 || c === W - 1) {
          tiles[r][c] = 'stone';
        }
        // Inner: hot water
        else {
          tiles[r][c] = 'water';
        }
      }
    }
    // Decorative corners
    tiles[0][0] = 'darkgrass';
    tiles[0][W - 1] = 'darkgrass';
    tiles[H - 1][0] = 'darkgrass';
    tiles[H - 1][W - 1] = 'darkgrass';
    return { tiles, offsetCol: 5, offsetRow: 5, width: W, height: H };
  }

  function generateRuinsPrefab() {
    const W = 7, H = 7;
    const tiles = [];
    for (let r = 0; r < H; r++) {
      tiles[r] = [];
      for (let c = 0; c < W; c++) {
        tiles[r][c] = 'stone';
      }
    }
    // Inner dirt floor
    for (let r = 1; r < H - 1; r++) {
      for (let c = 1; c < W - 1; c++) {
        tiles[r][c] = 'dirt';
      }
    }
    // Central path
    tiles[3][0] = 'path';
    tiles[3][W - 1] = 'path';
    tiles[0][3] = 'path';
    tiles[H - 1][3] = 'path';
    return { tiles, offsetCol: 4, offsetRow: 4, width: W, height: H };
  }

  function generateFairyGrovePrefab() {
    const W = 5, H = 5;
    const tiles = [];
    for (let r = 0; r < H; r++) {
      tiles[r] = [];
      for (let c = 0; c < W; c++) {
        tiles[r][c] = 'darkgrass';
      }
    }
    // Center clearing
    tiles[2][2] = 'grass';
    tiles[1][2] = 'grass';
    tiles[2][1] = 'grass';
    tiles[2][3] = 'grass';
    tiles[3][2] = 'grass';
    return { tiles, offsetCol: 5, offsetRow: 5, width: W, height: H };
  }

  function generateLakePrefab() {
    const W = 8, H = 6;
    const tiles = [];
    for (let r = 0; r < H; r++) {
      tiles[r] = [];
      for (let c = 0; c < W; c++) {
        // Outer ring: sand beach
        if (r === 0 || r === H - 1 || c === 0 || c === W - 1) {
          tiles[r][c] = 'sand';
        } else {
          tiles[r][c] = 'water';
        }
      }
    }
    // Beach corners are grass
    tiles[0][0] = 'grass';
    tiles[0][W - 1] = 'grass';
    tiles[H - 1][0] = 'grass';
    tiles[H - 1][W - 1] = 'grass';
    return { tiles, offsetCol: 4, offsetRow: 5, width: W, height: H };
  }

  function generateLookoutPrefab() {
    const W = 5, H = 5;
    const tiles = [];
    for (let r = 0; r < H; r++) {
      tiles[r] = [];
      for (let c = 0; c < W; c++) {
        tiles[r][c] = 'stone';
      }
    }
    // Path leading to center
    tiles[2][0] = 'path';
    tiles[2][1] = 'path';
    tiles[2][2] = 'path';
    tiles[2][3] = 'path';
    tiles[2][4] = 'path';
    return { tiles, offsetCol: 5, offsetRow: 5, width: W, height: H };
  }

  function generateOasisPrefab() {
    const W = 6, H = 6;
    const tiles = [];
    for (let r = 0; r < H; r++) {
      tiles[r] = [];
      for (let c = 0; c < W; c++) {
        if (r === 0 || r === H - 1 || c === 0 || c === W - 1) {
          tiles[r][c] = 'grass'; // green ring in desert
        } else {
          tiles[r][c] = 'water';
        }
      }
    }
    // Sand approach paths
    tiles[0][2] = 'sand';
    tiles[0][3] = 'sand';
    tiles[H - 1][2] = 'sand';
    tiles[H - 1][3] = 'sand';
    return { tiles, offsetCol: 5, offsetRow: 5, width: W, height: H };
  }

  // ===== Mountain wall tile type =====
  // 'mountain' is an impassable tile rendered as a tall rock wall.
  const MOUNTAIN_TILE = 'mountain';

  // ===== Public API =====
  return {
    WORLD_CHUNKS_W,
    WORLD_CHUNKS_H,
    CHUNK_SIZE,
    WORLD_TILES_W,
    WORLD_TILES_H,
    WORLD_SEED,
    BIOMES,
    LANDMARKS,
    LANDMARK_BY_CHUNK,
    MOUNTAIN_TILE,
    getBiome,
  };
})();

if (typeof module !== 'undefined') module.exports = WorldMapConfig;
