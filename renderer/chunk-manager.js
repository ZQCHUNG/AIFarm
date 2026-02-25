/**
 * chunk-manager.js — Infinite Map Chunk System for AIFarm 3.0 (Sprint 16 P0).
 *
 * Manages 16x16 tile chunks with lazy generation and persistence.
 * Home Chunk (0,0) contains the original 20x18 farm layout.
 * New chunks are procedurally generated with seed-based determinism.
 *
 * Coordinate system:
 *   World: continuous integers (col, row across all chunks)
 *   Chunk: floor(world / CHUNK_SIZE) — identifies which chunk
 *   Local: world % CHUNK_SIZE (mod, always positive) — position within chunk
 */
const ChunkManager = (() => {
  const CHUNK_SIZE = 16;

  // Chunk storage: Map<"cx,cy", ChunkData>
  // ChunkData = { tiles: string[][], entities: [], generated: boolean, locked: boolean }
  const chunks = new Map();

  // Track world bounds (expanded as chunks load)
  let worldMinCol = 0;
  let worldMinRow = 0;
  let worldMaxCol = 19; // home chunk default
  let worldMaxRow = 17;

  // Unlock state
  let unlockedChunks = new Set(); // Set of "cx,cy" strings
  const HOME_CHUNK = '0,0';
  const HOME_CHUNK_1 = '1,0'; // second chunk for 20-wide farm

  // Token threshold for passive unlock
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

  // ===== Seed-based procedural generation =====

  // Simple deterministic hash for chunk generation
  function hashSeed(cx, cy, x, y) {
    let h = (cx * 73856093) ^ (cy * 19349663) ^ (x * 83492791) ^ (y * 41729387);
    h = ((h >> 16) ^ h) * 0x45d9f3b;
    h = ((h >> 16) ^ h) * 0x45d9f3b;
    h = (h >> 16) ^ h;
    return (h & 0x7FFFFFFF) / 0x7FFFFFFF; // 0-1
  }

  /** Generate terrain for a new chunk. */
  function generateChunk(cx, cy) {
    const tiles = [];
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      tiles[ly] = [];
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const h = hashSeed(cx, cy, lx, ly);
        const h2 = hashSeed(cx + 100, cy + 100, lx, ly);

        // Terrain distribution:
        // 60% grass, 15% darkgrass, 10% dirt, 5% stone, 5% sand, 5% special
        let tile;
        if (h < 0.60) tile = 'grass';
        else if (h < 0.75) tile = 'darkgrass';
        else if (h < 0.85) tile = 'dirt';
        else if (h < 0.90) tile = 'stone';
        else if (h < 0.95) tile = 'sand';
        else tile = 'path';

        // Trees on edges (border chunks feel forested)
        if ((lx === 0 || lx === CHUNK_SIZE - 1 || ly === 0 || ly === CHUNK_SIZE - 1) && h2 < 0.3) {
          tile = 'fence'; // acts as obstacle (tree-like)
        }

        // Water patches (rare, clustered)
        if (h2 > 0.92 && h > 0.5) {
          tile = 'water';
        }

        tiles[ly][lx] = tile;
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
   * The original 20x18 map spans chunks (0,0) and (1,0).
   * @param {Function} farmInitFn - Called with setTile(col, row, type) to set up farm
   */
  function initHome(existingTileMap, mapW, mapH) {
    // Create chunks that cover the home area (20x18 → 2 chunks wide, 2 tall)
    const chunksNeeded = new Set();
    for (let r = 0; r < mapH; r++) {
      for (let c = 0; c < mapW; c++) {
        const { cx, cy } = worldToChunk(c, r);
        chunksNeeded.add(chunkKey(cx, cy));
      }
    }

    // Create blank chunks first
    for (const key of chunksNeeded) {
      const [cx, cy] = key.split(',').map(Number);
      const blank = { tiles: [], entities: [], generated: true, locked: false };
      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        blank.tiles[ly] = [];
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          blank.tiles[ly][lx] = 'grass';
        }
      }
      chunks.set(key, blank);
      unlockedChunks.add(key);
    }

    // Copy existing map data into chunks
    if (existingTileMap) {
      for (let r = 0; r < mapH; r++) {
        for (let c = 0; c < mapW; c++) {
          const { cx, cy } = worldToChunk(c, r);
          const { lx, ly } = worldToLocal(c, r);
          const key = chunkKey(cx, cy);
          const chunk = chunks.get(key);
          if (chunk && existingTileMap[r] && existingTileMap[r][c]) {
            chunk.tiles[ly][lx] = existingTileMap[r][c];
          }
        }
      }
    }

    worldMinCol = 0;
    worldMinRow = 0;
    worldMaxCol = mapW - 1;
    worldMaxRow = mapH - 1;
  }

  // ===== Tile access =====

  function getTile(col, row) {
    const { cx, cy } = worldToChunk(col, row);
    const key = chunkKey(cx, cy);
    const chunk = chunks.get(key);
    if (!chunk) return null; // unloaded/unlocked chunk
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

  /** Check if a chunk is loaded. */
  function isLoaded(cx, cy) {
    return chunks.has(chunkKey(cx, cy));
  }

  /** Check if a chunk is unlocked (player can enter). */
  function isUnlocked(cx, cy) {
    return unlockedChunks.has(chunkKey(cx, cy));
  }

  /** Load (generate) a chunk if not already loaded. */
  function loadChunk(cx, cy) {
    const key = chunkKey(cx, cy);
    if (chunks.has(key)) return;
    if (!unlockedChunks.has(key)) return; // don't generate locked chunks

    const data = generateChunk(cx, cy);
    chunks.set(key, data);

    // Expand world bounds
    const cMinCol = cx * CHUNK_SIZE;
    const cMinRow = cy * CHUNK_SIZE;
    const cMaxCol = cMinCol + CHUNK_SIZE - 1;
    const cMaxRow = cMinRow + CHUNK_SIZE - 1;
    worldMinCol = Math.min(worldMinCol, cMinCol);
    worldMinRow = Math.min(worldMinRow, cMinRow);
    worldMaxCol = Math.max(worldMaxCol, cMaxCol);
    worldMaxRow = Math.max(worldMaxRow, cMaxRow);
  }

  /** Unlock a specific chunk direction. */
  function unlockChunk(cx, cy) {
    const key = chunkKey(cx, cy);
    if (unlockedChunks.has(key)) return false;
    unlockedChunks.add(key);
    loadChunk(cx, cy);

    // Emit event
    if (typeof EventBus !== 'undefined') {
      EventBus.emit('CHUNK_UNLOCKED', { cx, cy });
    }
    console.log(`[ChunkManager] A new region has been discovered! Chunk (${cx}, ${cy})`);
    return true;
  }

  /** Get adjacent directions that could be unlocked. */
  function getUnlockableDirections() {
    const dirs = [];
    const checked = new Set();
    for (const key of unlockedChunks) {
      const [cx, cy] = key.split(',').map(Number);
      const neighbors = [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1]];
      for (const [nx, ny] of neighbors) {
        const nk = chunkKey(nx, ny);
        if (!unlockedChunks.has(nk) && !checked.has(nk)) {
          checked.add(nk);
          dirs.push({ cx: nx, cy: ny });
        }
      }
    }
    return dirs;
  }

  /** Check token threshold and auto-unlock a random adjacent chunk. */
  function checkPassiveUnlock(cumulativeTokens) {
    const unlockCount = Math.floor(cumulativeTokens / TOKENS_PER_UNLOCK);
    const prevCount = Math.floor(lastUnlockTokens / TOKENS_PER_UNLOCK);
    if (unlockCount > prevCount) {
      const dirs = getUnlockableDirections();
      if (dirs.length > 0) {
        // Pick random direction
        const idx = Math.floor(Math.random() * dirs.length);
        const { cx, cy } = dirs[idx];
        unlockChunk(cx, cy);
      }
    }
    lastUnlockTokens = cumulativeTokens;
  }

  // ===== Edge detection & preloading =====

  const PRELOAD_DISTANCE = 3; // tiles from chunk edge to trigger preload

  /** Update based on player position — preload adjacent chunks. */
  function updatePlayerPosition(worldCol, worldRow) {
    const { cx, cy } = worldToChunk(worldCol, worldRow);
    const { lx, ly } = worldToLocal(worldCol, worldRow);

    // Check proximity to chunk edges
    if (lx < PRELOAD_DISTANCE) loadChunk(cx - 1, cy);
    if (lx >= CHUNK_SIZE - PRELOAD_DISTANCE) loadChunk(cx + 1, cy);
    if (ly < PRELOAD_DISTANCE) loadChunk(cx, cy - 1);
    if (ly >= CHUNK_SIZE - PRELOAD_DISTANCE) loadChunk(cx, cy + 1);

    // Diagonal preload
    if (lx < PRELOAD_DISTANCE && ly < PRELOAD_DISTANCE) loadChunk(cx - 1, cy - 1);
    if (lx >= CHUNK_SIZE - PRELOAD_DISTANCE && ly < PRELOAD_DISTANCE) loadChunk(cx + 1, cy - 1);
    if (lx < PRELOAD_DISTANCE && ly >= CHUNK_SIZE - PRELOAD_DISTANCE) loadChunk(cx - 1, cy + 1);
    if (lx >= CHUNK_SIZE - PRELOAD_DISTANCE && ly >= CHUNK_SIZE - PRELOAD_DISTANCE) loadChunk(cx + 1, cy + 1);
  }

  // ===== Visible bounds =====

  function getWorldBounds() {
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

  /** Check if a tile position is in fog (chunk not unlocked). */
  function isFog(col, row) {
    const { cx, cy } = worldToChunk(col, row);
    return !unlockedChunks.has(chunkKey(cx, cy));
  }

  // ===== Persistence =====

  function getState() {
    const chunkStates = {};
    for (const [key, data] of chunks) {
      // Only persist non-home chunks that have been modified
      // Home chunk is always reconstructed from farm layout
      chunkStates[key] = {
        tiles: data.tiles,
        generated: data.generated,
      };
    }
    return {
      unlocked: Array.from(unlockedChunks),
      chunks: chunkStates,
      lastUnlockTokens,
    };
  }

  function loadState(state) {
    if (!state) return;
    if (state.unlocked) {
      for (const key of state.unlocked) {
        unlockedChunks.add(key);
      }
    }
    if (state.chunks) {
      for (const [key, data] of Object.entries(state.chunks)) {
        if (!chunks.has(key)) {
          chunks.set(key, {
            tiles: data.tiles,
            entities: [],
            generated: data.generated,
            locked: false,
          });
          // Update world bounds
          const [cx, cy] = key.split(',').map(Number);
          const cMinCol = cx * CHUNK_SIZE;
          const cMinRow = cy * CHUNK_SIZE;
          worldMinCol = Math.min(worldMinCol, cMinCol);
          worldMinRow = Math.min(worldMinRow, cMinRow);
          worldMaxCol = Math.max(worldMaxCol, cMinCol + CHUNK_SIZE - 1);
          worldMaxRow = Math.max(worldMaxRow, cMinRow + CHUNK_SIZE - 1);
        }
      }
    }
    if (state.lastUnlockTokens) lastUnlockTokens = state.lastUnlockTokens;
  }

  return {
    CHUNK_SIZE,
    initHome,
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
    isFog,
    getState,
    loadState,
    worldToChunk,
    worldToLocal,
    chunkKey,
  };
})();
