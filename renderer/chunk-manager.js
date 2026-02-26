/**
 * chunk-manager.js — Deterministic Mega-Map Chunk System (Sprint 22 P0).
 *
 * Manages 16x16 tile chunks for a 256x256 tile world.
 * Uses WorldMapConfig for biome-based deterministic terrain, fixed landmarks,
 * and mountain wall borders.
 *
 * Key design: terrain is seeded & deterministic — same (x,y) always produces
 * the same tile. Landmarks are prefab-stamped at fixed chunk positions.
 * All chunks are pre-unlocked (no fog of war for the main world).
 *
 * Coordinate system:
 *   World: continuous integers (col, row across all chunks)
 *   Chunk: floor(world / CHUNK_SIZE) — identifies which chunk
 *   Local: world % CHUNK_SIZE (mod, always positive) — position within chunk
 */
const ChunkManager = (() => {
  const CHUNK_SIZE = 16;

  // Chunk storage: Map<"cx,cy", ChunkData>
  const chunks = new Map();

  // World bounds (fixed for mega-map)
  let worldMinCol = 0;
  let worldMinRow = 0;
  let worldMaxCol = 255;
  let worldMaxRow = 255;

  // Home farm offset: the original 20x18 farm is placed in the center of the world
  // Home chunk is at (8,8) in WorldMapConfig, so world offset = 8*16 = 128
  let homeOffsetCol = 0;
  let homeOffsetRow = 0;

  // Track which chunks have been loaded (all are "unlocked" in mega-map)
  // We keep this set for backward compatibility with isFog/isUnlocked
  let loadedChunks = new Set();

  // Legacy compat: token-based unlock (now just loads adjacent chunks)
  const TOKENS_PER_UNLOCK = 1000000;
  let lastUnlockTokens = 0;

  // ===== Coordinate helpers =====

  function worldToChunk(col, row) {
    return {
      cx: Math.floor(col / CHUNK_SIZE),
      cy: Math.floor(row / CHUNK_SIZE),
    };
  }

  function worldToLocal(col, row) {
    return {
      lx: ((col % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
      ly: ((row % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
    };
  }

  function chunkKey(cx, cy) { return `${cx},${cy}`; }

  // ===== Seed-based procedural generation (biome-aware) =====

  function hashSeed(cx, cy, x, y) {
    const SEED = (typeof WorldMapConfig !== 'undefined') ? WorldMapConfig.WORLD_SEED : 42;
    let h = (cx * 73856093) ^ (cy * 19349663) ^ (x * 83492791) ^ (y * 41729387) ^ (SEED * 12345);
    h = ((h >> 16) ^ h) * 0x45d9f3b;
    h = ((h >> 16) ^ h) * 0x45d9f3b;
    h = (h >> 16) ^ h;
    return (h & 0x7FFFFFFF) / 0x7FFFFFFF;
  }

  /** Generate terrain for a chunk using biome-based rules. */
  function generateChunk(cx, cy) {
    const tiles = [];
    const WMC = (typeof WorldMapConfig !== 'undefined') ? WorldMapConfig : null;

    // Get biome for this chunk
    const biomeName = WMC ? WMC.getBiome(cx, cy) : 'plains';
    const biome = WMC ? (WMC.BIOMES[biomeName] || WMC.BIOMES.plains) : null;

    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      tiles[ly] = [];
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const h = hashSeed(cx, cy, lx, ly);
        const h2 = hashSeed(cx + 100, cy + 100, lx, ly);

        let tile;

        // Mountain border chunks: all impassable mountain tiles
        if (biome && biome.impassable) {
          tile = 'mountain';
          tiles[ly][lx] = tile;
          continue;
        }

        // Biome-based terrain distribution
        if (biome) {
          let cumulative = 0;
          tile = 'grass'; // fallback
          for (const [tileType, weight] of Object.entries(biome.tiles)) {
            cumulative += weight;
            if (h < cumulative) {
              tile = tileType;
              break;
            }
          }

          // Trees based on biome tree density
          if (biome.treeDensity > 0 && h2 < biome.treeDensity) {
            // Don't place trees on path tiles
            if (tile !== 'path' && tile !== 'water') {
              tile = 'tree';
            }
          }

          // Water patches based on biome water chance
          if (biome.waterChance > 0 && h2 > (1 - biome.waterChance) && tile !== 'tree') {
            tile = 'water';
          }
        } else {
          // Legacy fallback: original terrain distribution
          if (h < 0.60) tile = 'grass';
          else if (h < 0.75) tile = 'darkgrass';
          else if (h < 0.85) tile = 'dirt';
          else if (h < 0.90) tile = 'stone';
          else if (h < 0.95) tile = 'sand';
          else tile = 'path';

          if (h2 > 0.92 && h > 0.5) tile = 'water';
        }

        tiles[ly][lx] = tile;
      }
    }

    // Path guarantee: break up dense tree clusters to prevent dead-ends.
    // Scan for any tree tile surrounded on 3+ sides by solid tiles;
    // if found, replace it with path to ensure walkable corridors.
    const SOLID_BLOCK = new Set(['tree', 'water', 'mountain', 'fence']);
    for (let ly = 1; ly < CHUNK_SIZE - 1; ly++) {
      for (let lx = 1; lx < CHUNK_SIZE - 1; lx++) {
        if (tiles[ly][lx] !== 'tree') continue;
        // Count solid neighbors (4-directional)
        let solidN = 0;
        if (SOLID_BLOCK.has(tiles[ly - 1][lx])) solidN++;
        if (SOLID_BLOCK.has(tiles[ly + 1][lx])) solidN++;
        if (SOLID_BLOCK.has(tiles[ly][lx - 1])) solidN++;
        if (SOLID_BLOCK.has(tiles[ly][lx + 1])) solidN++;
        // If surrounded on 3+ sides, this tree creates a dead-end — clear it
        if (solidN >= 3) {
          tiles[ly][lx] = 'grass';
        }
      }
    }

    // Stamp landmark prefab if this chunk has one
    if (WMC) {
      const key = chunkKey(cx, cy);
      const landmark = WMC.LANDMARK_BY_CHUNK[key];
      if (landmark && landmark.prefab) {
        const pf = landmark.prefab;
        for (let r = 0; r < pf.height; r++) {
          for (let c = 0; c < pf.width; c++) {
            const ly = pf.offsetRow + r;
            const lx = pf.offsetCol + c;
            if (ly >= 0 && ly < CHUNK_SIZE && lx >= 0 && lx < CHUNK_SIZE) {
              tiles[ly][lx] = pf.tiles[r][c];
            }
          }
        }
      }
    }

    return {
      tiles,
      entities: [],
      generated: true,
      locked: false,
    };
  }

  // ===== Home chunk initialization =====

  /**
   * Initialize home chunks with the existing farm layout.
   * In mega-map mode, the home farm is placed at the center of the world.
   */
  function initHome(existingTileMap, mapW, mapH) {
    const WMC = (typeof WorldMapConfig !== 'undefined') ? WorldMapConfig : null;

    if (WMC) {
      // Place home farm at the center chunk area
      // Home chunk (8,8) → world offset = 8*16 = 128
      homeOffsetCol = WMC.LANDMARKS.home_farm.cx * CHUNK_SIZE;
      homeOffsetRow = WMC.LANDMARKS.home_farm.cy * CHUNK_SIZE;
    } else {
      homeOffsetCol = 0;
      homeOffsetRow = 0;
    }

    // Create chunks that cover the home area
    const chunksNeeded = new Set();
    for (let r = 0; r < mapH; r++) {
      for (let c = 0; c < mapW; c++) {
        const wc = homeOffsetCol + c;
        const wr = homeOffsetRow + r;
        const { cx, cy } = worldToChunk(wc, wr);
        chunksNeeded.add(chunkKey(cx, cy));
      }
    }

    // Create blank chunks first, then fill with farm data
    for (const key of chunksNeeded) {
      const [cx, cy] = key.split(',').map(Number);
      // Generate biome-based terrain first
      const chunkData = generateChunk(cx, cy);
      chunks.set(key, chunkData);
      loadedChunks.add(key);
    }

    // Copy existing farm map data into chunks (overrides generated terrain)
    if (existingTileMap) {
      for (let r = 0; r < mapH; r++) {
        for (let c = 0; c < mapW; c++) {
          const wc = homeOffsetCol + c;
          const wr = homeOffsetRow + r;
          const { cx, cy } = worldToChunk(wc, wr);
          const { lx, ly } = worldToLocal(wc, wr);
          const key = chunkKey(cx, cy);
          const chunk = chunks.get(key);
          if (chunk && existingTileMap[r] && existingTileMap[r][c]) {
            chunk.tiles[ly][lx] = existingTileMap[r][c];
          }
        }
      }
    }

    // Set full world bounds
    if (WMC) {
      worldMinCol = 0;
      worldMinRow = 0;
      worldMaxCol = WMC.WORLD_TILES_W - 1;
      worldMaxRow = WMC.WORLD_TILES_H - 1;
    } else {
      worldMinCol = 0;
      worldMinRow = 0;
      worldMaxCol = mapW - 1;
      worldMaxRow = mapH - 1;
    }

    // Pre-load a 5x5 chunk area around home for smooth initial experience
    const homeCX = Math.floor(homeOffsetCol / CHUNK_SIZE);
    const homeCY = Math.floor(homeOffsetRow / CHUNK_SIZE);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        loadChunk(homeCX + dx, homeCY + dy);
      }
    }
  }

  /** Get the home farm world offset (for placing the player at start). */
  function getHomeOffset() {
    return { col: homeOffsetCol, row: homeOffsetRow };
  }

  // ===== Tile access =====

  function getTile(col, row) {
    // Out of world bounds → mountain
    if (col < 0 || col >= worldMaxCol + 1 || row < 0 || row >= worldMaxRow + 1) {
      return 'mountain';
    }
    const { cx, cy } = worldToChunk(col, row);
    const key = chunkKey(cx, cy);
    const chunk = chunks.get(key);
    if (!chunk) return null; // unloaded chunk
    const { lx, ly } = worldToLocal(col, row);
    if (ly >= 0 && ly < CHUNK_SIZE && lx >= 0 && lx < CHUNK_SIZE) {
      return chunk.tiles[ly][lx];
    }
    return null;
  }

  function setTile(col, row, type) {
    const { cx, cy } = worldToChunk(col, row);
    const key = chunkKey(cx, cy);
    let chunk = chunks.get(key);
    if (!chunk) return false;
    const { lx, ly } = worldToLocal(col, row);
    if (ly >= 0 && ly < CHUNK_SIZE && lx >= 0 && lx < CHUNK_SIZE) {
      chunk.tiles[ly][lx] = type;
      return true;
    }
    return false;
  }

  // ===== Chunk loading/unloading =====

  function isLoaded(cx, cy) {
    return chunks.has(chunkKey(cx, cy));
  }

  /** In mega-map mode, all chunks within world bounds are "unlocked". */
  function isUnlocked(cx, cy) {
    const WMC = (typeof WorldMapConfig !== 'undefined') ? WorldMapConfig : null;
    if (WMC) {
      return cx >= 0 && cx < WMC.WORLD_CHUNKS_W && cy >= 0 && cy < WMC.WORLD_CHUNKS_H;
    }
    return loadedChunks.has(chunkKey(cx, cy));
  }

  /** Load (generate) a chunk if not already loaded. */
  function loadChunk(cx, cy) {
    const key = chunkKey(cx, cy);
    if (chunks.has(key)) return;

    // Boundary check for mega-map
    const WMC = (typeof WorldMapConfig !== 'undefined') ? WorldMapConfig : null;
    if (WMC) {
      if (cx < 0 || cx >= WMC.WORLD_CHUNKS_W || cy < 0 || cy >= WMC.WORLD_CHUNKS_H) return;
    } else {
      if (!loadedChunks.has(key)) return;
    }

    const data = generateChunk(cx, cy);
    chunks.set(key, data);
    loadedChunks.add(key);
  }

  /** Unlock a specific chunk (legacy compat — in mega-map, just loads it). */
  function unlockChunk(cx, cy) {
    const key = chunkKey(cx, cy);
    if (chunks.has(key)) return false;
    loadChunk(cx, cy);
    if (chunks.has(key)) {
      if (typeof EventBus !== 'undefined') {
        EventBus.emit('CHUNK_UNLOCKED', { cx, cy });
      }
      console.log(`[ChunkManager] Explored Chunk (${cx}, ${cy})`);
      return true;
    }
    return false;
  }

  function getUnlockableDirections() {
    // In mega-map, return unloaded neighbor chunks within world bounds
    const dirs = [];
    const checked = new Set();
    for (const key of loadedChunks) {
      const [cx, cy] = key.split(',').map(Number);
      const neighbors = [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1]];
      for (const [nx, ny] of neighbors) {
        const nk = chunkKey(nx, ny);
        if (!chunks.has(nk) && !checked.has(nk) && isUnlocked(nx, ny)) {
          checked.add(nk);
          dirs.push({ cx: nx, cy: ny });
        }
      }
    }
    return dirs;
  }

  function checkPassiveUnlock(cumulativeTokens) {
    const unlockCount = Math.floor(cumulativeTokens / TOKENS_PER_UNLOCK);
    const prevCount = Math.floor(lastUnlockTokens / TOKENS_PER_UNLOCK);
    if (unlockCount > prevCount) {
      const dirs = getUnlockableDirections();
      if (dirs.length > 0) {
        const idx = Math.floor(Math.random() * dirs.length);
        const { cx, cy } = dirs[idx];
        unlockChunk(cx, cy);
      }
    }
    lastUnlockTokens = cumulativeTokens;
  }

  // ===== Edge detection & preloading =====

  const PRELOAD_DISTANCE = 3;
  const UNLOAD_DISTANCE = 4; // chunks beyond this from player are unloaded

  /** Update based on player position — preload adjacent chunks, unload distant ones. */
  function updatePlayerPosition(worldCol, worldRow) {
    const { cx: pcx, cy: pcy } = worldToChunk(worldCol, worldRow);

    // Load 3x3 (or 5x5 for smoother experience) chunk area around player
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        loadChunk(pcx + dx, pcy + dy);
      }
    }

    // Unload distant chunks to save memory (keep loaded within 5 chunks)
    for (const key of chunks.keys()) {
      const [cx, cy] = key.split(',').map(Number);
      if (Math.abs(cx - pcx) > UNLOAD_DISTANCE || Math.abs(cy - pcy) > UNLOAD_DISTANCE) {
        // Don't unload home farm chunks
        const homeKey = `${Math.floor(homeOffsetCol / CHUNK_SIZE)},${Math.floor(homeOffsetRow / CHUNK_SIZE)}`;
        const homeCX = Math.floor(homeOffsetCol / CHUNK_SIZE);
        const homeCY = Math.floor(homeOffsetRow / CHUNK_SIZE);
        if (Math.abs(cx - homeCX) <= 1 && Math.abs(cy - homeCY) <= 1) continue;
        // Explicitly clear tile data to help GC
        const chunk = chunks.get(key);
        if (chunk && chunk.tiles) {
          chunk.tiles.length = 0;
          chunk.tiles = null;
        }
        chunks.delete(key);
      }
    }
  }

  // ===== Visible bounds =====

  function getWorldBounds() {
    // Return bounds of loaded chunks only (for rendering efficiency)
    let minC = Infinity, minR = Infinity, maxC = -Infinity, maxR = -Infinity;
    for (const key of chunks.keys()) {
      const [cx, cy] = key.split(',').map(Number);
      const cMinCol = cx * CHUNK_SIZE;
      const cMinRow = cy * CHUNK_SIZE;
      minC = Math.min(minC, cMinCol);
      minR = Math.min(minR, cMinRow);
      maxC = Math.max(maxC, cMinCol + CHUNK_SIZE - 1);
      maxR = Math.max(maxR, cMinRow + CHUNK_SIZE - 1);
    }
    if (minC === Infinity) {
      return { minCol: 0, minRow: 0, maxCol: 0, maxRow: 0, width: 1, height: 1 };
    }
    return {
      minCol: minC,
      minRow: minR,
      maxCol: maxC,
      maxRow: maxR,
      width: maxC - minC + 1,
      height: maxR - minR + 1,
    };
  }

  /** Get full world size (for camera clamp). */
  function getFullWorldBounds() {
    return {
      minCol: worldMinCol,
      minRow: worldMinRow,
      maxCol: worldMaxCol,
      maxRow: worldMaxRow,
      width: worldMaxCol - worldMinCol + 1,
      height: worldMaxRow - worldMinRow + 1,
    };
  }

  // ===== Fog of War =====

  function isFog(col, row) {
    const { cx, cy } = worldToChunk(col, row);
    return !chunks.has(chunkKey(cx, cy));
  }

  // ===== Landmark interaction =====

  /** Get the nearest landmark to a world position. */
  function getNearLandmark(worldCol, worldRow, range) {
    const WMC = (typeof WorldMapConfig !== 'undefined') ? WorldMapConfig : null;
    if (!WMC) return null;
    range = range || 3;

    for (const [, lm] of Object.entries(WMC.LANDMARK_BY_CHUNK)) {
      if (!lm.interactable) continue;
      const pf = lm.prefab;
      if (!pf) continue;
      // Landmark center in world coords
      const lcx = lm.cx * CHUNK_SIZE + pf.offsetCol + Math.floor(pf.width / 2);
      const lcy = lm.cy * CHUNK_SIZE + pf.offsetRow + Math.floor(pf.height / 2);
      const dx = Math.abs(worldCol - lcx);
      const dy = Math.abs(worldRow - lcy);
      if (dx <= range && dy <= range) return lm;
    }
    return null;
  }

  // ===== Persistence =====

  function getState() {
    // Only persist chunks that differ from generated (i.e., have farm modifications)
    const homeChunkKeys = new Set();
    const homeCX = Math.floor(homeOffsetCol / CHUNK_SIZE);
    const homeCY = Math.floor(homeOffsetRow / CHUNK_SIZE);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        homeChunkKeys.add(chunkKey(homeCX + dx, homeCY + dy));
      }
    }

    const chunkStates = {};
    for (const [key, data] of chunks) {
      // Only persist home-area chunks (other chunks can be regenerated)
      if (homeChunkKeys.has(key)) {
        chunkStates[key] = {
          tiles: data.tiles,
          generated: data.generated,
        };
      }
    }
    return {
      unlocked: [], // legacy compat
      chunks: chunkStates,
      lastUnlockTokens,
      homeOffset: { col: homeOffsetCol, row: homeOffsetRow },
    };
  }

  function loadState(state) {
    if (!state) return;
    // Restore home offset
    if (state.homeOffset) {
      homeOffsetCol = state.homeOffset.col;
      homeOffsetRow = state.homeOffset.row;
    }
    if (state.chunks) {
      for (const [key, data] of Object.entries(state.chunks)) {
        // Migrate: convert 'fence' tiles to 'tree' outside the farm area.
        // Old code used 'fence' for procedurally generated trees — these had
        // no tree sprite, creating invisible walls. Farm fences (inside the
        // 20x18 farm area) stay as 'fence'.
        if (data.tiles) {
          const [cx, cy] = key.split(',').map(Number);
          const FARM_W = 20, FARM_H = 18;
          for (let ly = 0; ly < CHUNK_SIZE; ly++) {
            if (!data.tiles[ly]) continue;
            for (let lx = 0; lx < data.tiles[ly].length; lx++) {
              if (data.tiles[ly][lx] === 'fence') {
                // World coords of this tile
                const wc = cx * CHUNK_SIZE + lx;
                const wr = cy * CHUNK_SIZE + ly;
                // Is it inside the farm area? Farm fences stay as 'fence'.
                const inFarm = wc >= homeOffsetCol && wc < homeOffsetCol + FARM_W &&
                               wr >= homeOffsetRow && wr < homeOffsetRow + FARM_H;
                if (!inFarm) {
                  data.tiles[ly][lx] = 'tree';
                }
              }
            }
          }
        }
        chunks.set(key, {
          tiles: data.tiles,
          entities: [],
          generated: data.generated,
          locked: false,
        });
        loadedChunks.add(key);
      }
    }
    if (state.lastUnlockTokens) lastUnlockTokens = state.lastUnlockTokens;
  }

  return {
    CHUNK_SIZE,
    initHome,
    getHomeOffset,
    getTile,
    setTile,
    isLoaded,
    isUnlocked,
    loadChunk,
    unlockChunk,
    getUnlockableDirections,
    checkPassiveUnlock,
    updatePlayerPosition,
    getWorldBounds,
    getFullWorldBounds,
    isFog,
    getNearLandmark,
    getState,
    loadState,
    worldToChunk,
    worldToLocal,
    chunkKey,
  };
})();
