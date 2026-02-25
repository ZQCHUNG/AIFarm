/**
 * landmark-generator.js — Wilderness Landmark System for AIFarm 3.0 (Sprint 19 P0).
 *
 * Generates ancient altars, abandoned camps, stone circles in distant chunks.
 * Each landmark is a one-time discovery — click/press E to claim a rare reward.
 * CTO suggestion: Higher cumulative energy → higher rare landmark probability.
 *
 * Integrates with ChunkManager: when a new chunk loads, landmarks are seeded
 * deterministically. Player interaction triggers resource bursts + collection entry.
 */
const LandmarkGenerator = (() => {
  // ===== Landmark definitions =====
  const LANDMARK_TYPES = {
    ancient_altar: {
      name: 'Ancient Altar',
      icon: '\u{1F54A}',     // dove (mystical)
      rarity: 'rare',
      baseWeight: 1,
      minDistance: 3,         // minimum chunk distance from home
      rewards: [
        { resource: 'gold', min: 20, max: 50 },
        { resource: 'stone', min: 5, max: 15 },
      ],
      description: 'A weathered stone altar humming with ancient energy.',
      colors: { primary: '#8B7D6B', accent: '#C0A87D', glow: '#FFD700' },
    },
    abandoned_camp: {
      name: 'Abandoned Camp',
      icon: '\u{1F3D5}',     // camping
      rarity: 'common',
      baseWeight: 4,
      minDistance: 2,
      rewards: [
        { resource: 'wood', min: 8, max: 20 },
        { resource: 'stone', min: 3, max: 8 },
      ],
      description: 'Remnants of a traveler\'s camp, supplies left behind.',
      colors: { primary: '#A0522D', accent: '#DEB887', glow: '#FFA500' },
    },
    stone_circle: {
      name: 'Stone Circle',
      icon: '\u{2B55}',      // circle
      rarity: 'uncommon',
      baseWeight: 2,
      minDistance: 2,
      rewards: [
        { resource: 'stone', min: 10, max: 25 },
        { resource: 'gold', min: 5, max: 15 },
      ],
      description: 'Mysterious standing stones arranged in a perfect circle.',
      colors: { primary: '#808080', accent: '#A9A9A9', glow: '#87CEEB' },
    },
    crystal_cave: {
      name: 'Crystal Cave',
      icon: '\u{1F48E}',     // gem
      rarity: 'legendary',
      baseWeight: 0.3,
      minDistance: 4,
      rewards: [
        { resource: 'gold', min: 50, max: 100 },
        { resource: 'stone', min: 10, max: 20 },
      ],
      description: 'A hidden cave entrance glittering with rare crystals.',
      colors: { primary: '#4B0082', accent: '#9370DB', glow: '#FF00FF' },
    },
    fairy_ring: {
      name: 'Fairy Ring',
      icon: '\u{1F344}',     // mushroom
      rarity: 'uncommon',
      baseWeight: 2,
      minDistance: 3,
      rewards: [
        { resource: 'gold', min: 10, max: 30 },
      ],
      description: 'A ring of glowing mushrooms — the fae were here.',
      colors: { primary: '#228B22', accent: '#98FB98', glow: '#7FFF00' },
    },
  };

  // Rarity tier multiplier from cumulative energy
  const RARITY_THRESHOLDS = [
    { energy: 0,     rareMult: 1.0 },
    { energy: 2000,  rareMult: 1.5 },
    { energy: 5000,  rareMult: 2.0 },
    { energy: 10000, rareMult: 3.0 },
    { energy: 20000, rareMult: 5.0 },
  ];

  // Base chance of a landmark spawning in a chunk (before distance/energy modifiers)
  const BASE_SPAWN_CHANCE = 0.15;  // 15% base per chunk

  // Discovered landmarks: Set of "cx,cy" keys that have been claimed
  let discoveredLandmarks = new Set();
  // Active landmarks in loaded chunks: Map of "cx,cy" → landmark data
  let activeLandmarks = new Map();
  // Collection catalog: array of { type, cx, cy, timestamp }
  let collection = [];

  // Current cumulative energy (synced from farm state)
  let cumulativeEnergy = 0;

  // ===== Deterministic seeding =====

  function hashSeed(cx, cy, salt) {
    let h = (cx * 73856093) ^ (cy * 19349663) ^ (salt * 83492791);
    h = ((h >> 16) ^ h) * 0x45d9f3b;
    h = ((h >> 16) ^ h) * 0x45d9f3b;
    h = (h >> 16) ^ h;
    return (h & 0x7FFFFFFF) / 0x7FFFFFFF;
  }

  /** Chunk distance from home (0,0). */
  function chunkDistance(cx, cy) {
    return Math.abs(cx) + Math.abs(cy); // Manhattan distance
  }

  /** Get rarity multiplier based on cumulative energy. */
  function getRarityMultiplier() {
    let mult = 1.0;
    for (const t of RARITY_THRESHOLDS) {
      if (cumulativeEnergy >= t.energy) mult = t.rareMult;
    }
    return mult;
  }

  // ===== Landmark generation for a chunk =====

  /**
   * Check if a chunk should have a landmark and generate it.
   * Called when ChunkManager loads/generates a new chunk.
   * Returns null if no landmark, or a landmark object.
   */
  function generateForChunk(cx, cy) {
    const key = `${cx},${cy}`;
    // Already generated
    if (activeLandmarks.has(key)) return activeLandmarks.get(key);

    const dist = chunkDistance(cx, cy);
    // Home area: no landmarks
    if (dist < 2) return null;

    // Spawn roll — deterministic per chunk
    const roll = hashSeed(cx, cy, 42);
    // Distance bonus: farther chunks have higher chance
    const distBonus = Math.min(0.3, (dist - 1) * 0.05);
    const spawnChance = BASE_SPAWN_CHANCE + distBonus;

    if (roll > spawnChance) return null;

    // Pick landmark type (weighted, energy-adjusted)
    const rareMult = getRarityMultiplier();
    const candidates = [];
    let totalWeight = 0;
    for (const [typeId, def] of Object.entries(LANDMARK_TYPES)) {
      if (dist < def.minDistance) continue;
      let weight = def.baseWeight;
      // Boost rare/legendary with energy multiplier
      if (def.rarity === 'rare' || def.rarity === 'legendary') {
        weight *= rareMult;
      }
      candidates.push({ typeId, weight });
      totalWeight += weight;
    }

    if (candidates.length === 0 || totalWeight === 0) return null;

    // Deterministic type selection
    const typeRoll = hashSeed(cx, cy, 137) * totalWeight;
    let cumulative = 0;
    let selectedType = candidates[0].typeId;
    for (const c of candidates) {
      cumulative += c.weight;
      if (typeRoll <= cumulative) {
        selectedType = c.typeId;
        break;
      }
    }

    // Position within chunk (avoid edges)
    const CHUNK_SIZE = 16;
    const localCol = 3 + Math.floor(hashSeed(cx, cy, 271) * (CHUNK_SIZE - 6));
    const localRow = 3 + Math.floor(hashSeed(cx, cy, 389) * (CHUNK_SIZE - 6));
    const worldCol = cx * CHUNK_SIZE + localCol;
    const worldRow = cy * CHUNK_SIZE + localRow;

    const landmark = {
      type: selectedType,
      def: LANDMARK_TYPES[selectedType],
      cx, cy,
      worldCol,
      worldRow,
      claimed: discoveredLandmarks.has(key),
      key,
    };

    activeLandmarks.set(key, landmark);
    return landmark;
  }

  // ===== Player interaction =====

  /**
   * Check if player is near any unclaimed landmark.
   * Returns the landmark if within 2 tiles, null otherwise.
   */
  function getNearbyLandmark() {
    if (typeof Player === 'undefined') return null;
    const pt = Player.getTile();

    for (const [, lm] of activeLandmarks) {
      if (lm.claimed) continue;
      const dx = Math.abs(pt.col - lm.worldCol);
      const dy = Math.abs(pt.row - lm.worldRow);
      if (dx <= 2 && dy <= 2) return lm;
    }
    return null;
  }

  /**
   * Claim a landmark — award rewards, mark as discovered.
   * Returns reward summary or null.
   */
  function claimLandmark(landmark) {
    if (!landmark || landmark.claimed) return null;

    landmark.claimed = true;
    discoveredLandmarks.add(landmark.key);

    // Calculate rewards
    const rewards = [];
    for (const r of landmark.def.rewards) {
      const amount = r.min + Math.floor(Math.random() * (r.max - r.min + 1));
      rewards.push({ resource: r.resource, amount });
      if (typeof ResourceInventory !== 'undefined') {
        ResourceInventory.add(r.resource, amount);
      }
    }

    // Add to collection
    collection.push({
      type: landmark.type,
      name: landmark.def.name,
      rarity: landmark.def.rarity,
      cx: landmark.cx,
      cy: landmark.cy,
      timestamp: Date.now(),
    });

    // Visual effects
    if (typeof IsoEffects !== 'undefined') {
      // Floating discovery text
      const screen = getScreenPos(landmark.worldCol, landmark.worldRow);
      IsoEffects.spawnFloatingText(screen.x, screen.y - 30,
        `${landmark.def.icon} ${landmark.def.name} discovered!`, landmark.def.colors.glow);
      // Reward texts
      let yOff = -15;
      for (const r of rewards) {
        IsoEffects.spawnFloatingText(screen.x, screen.y + yOff,
          `+${r.amount} ${r.resource}`, '#FFD700');
        yOff += 12;
      }
    }

    // Particles
    if (typeof IsoEngine !== 'undefined') {
      IsoEngine.spawnHarvestParticles(landmark.worldCol, landmark.worldRow,
        landmark.def.colors.glow, 20);
    }

    // Log
    if (typeof Farm !== 'undefined' && Farm.logEvent) {
      Farm.logEvent(landmark.def.icon, `Discovered ${landmark.def.name}!`);
    }

    // Emit event for collection system
    if (typeof EventBus !== 'undefined') {
      EventBus.emit('LANDMARK_DISCOVERED', {
        type: landmark.type,
        name: landmark.def.name,
        rarity: landmark.def.rarity,
        rewards,
      });
    }

    return rewards;
  }

  /**
   * Handle E key press — try to claim nearby landmark.
   */
  function handleAction() {
    const lm = getNearbyLandmark();
    if (lm) {
      claimLandmark(lm);
      return true;
    }
    return false;
  }

  function getScreenPos(col, row) {
    if (typeof IsoEngine !== 'undefined') {
      return IsoEngine.gridToScreen(col + 0.5, row + 0.5, 0);
    }
    return { x: 0, y: 0 };
  }

  // ===== Rendering =====

  /**
   * Draw all active landmarks on screen.
   * Called during the zoomed rendering pass.
   */
  function draw(ctx, tick) {
    for (const [, lm] of activeLandmarks) {
      drawLandmark(ctx, lm, tick);
    }
  }

  function drawLandmark(ctx, lm, tick) {
    const screen = getScreenPos(lm.worldCol, lm.worldRow);
    const sx = screen.x;
    const sy = screen.y;

    // Frustum culling (rough)
    if (sx < -100 || sx > 2000 || sy < -100 || sy > 2000) return;

    const def = lm.def;
    const claimed = lm.claimed;

    switch (lm.type) {
      case 'ancient_altar':  drawAltar(ctx, sx, sy, def, claimed, tick); break;
      case 'abandoned_camp': drawCamp(ctx, sx, sy, def, claimed, tick); break;
      case 'stone_circle':   drawStoneCircle(ctx, sx, sy, def, claimed, tick); break;
      case 'crystal_cave':   drawCrystalCave(ctx, sx, sy, def, claimed, tick); break;
      case 'fairy_ring':     drawFairyRing(ctx, sx, sy, def, claimed, tick); break;
    }

    // Unclaimed indicator: pulsing glow + "?" or "!"
    if (!claimed) {
      const pulse = 0.4 + Math.sin(tick * 0.06) * 0.3;
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = def.colors.glow;
      ctx.beginPath();
      ctx.ellipse(sx, sy - 8, 18, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // "!" marker
      const bounce = Math.sin(tick * 0.08) * 3;
      ctx.fillStyle = def.colors.glow;
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('!', sx, sy - 22 + bounce);

      // Sparkle particles
      if (tick % 15 === 0 && typeof IsoEngine !== 'undefined') {
        IsoEngine.spawnHarvestParticles(lm.worldCol + 0.5, lm.worldRow + 0.5,
          def.colors.glow, 2);
      }
    }
  }

  // ===== Individual landmark drawings =====

  function drawAltar(ctx, sx, sy, def, claimed, tick) {
    // Stone base
    ctx.fillStyle = def.colors.primary;
    ctx.fillRect(sx - 10, sy - 4, 20, 8);
    ctx.fillRect(sx - 8, sy - 10, 16, 6);
    // Pillar
    ctx.fillStyle = def.colors.accent;
    ctx.fillRect(sx - 3, sy - 20, 6, 10);
    // Top ornament
    ctx.fillStyle = claimed ? '#666' : def.colors.glow;
    ctx.beginPath();
    ctx.arc(sx, sy - 22, 4, 0, Math.PI * 2);
    ctx.fill();
    // Carvings (decorative lines)
    ctx.strokeStyle = def.colors.accent;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(sx - 7, sy - 8);
    ctx.lineTo(sx + 7, sy - 8);
    ctx.stroke();
    if (!claimed) {
      // Altar fire
      const flicker = Math.sin(tick * 0.2) * 2;
      ctx.fillStyle = '#FF6600';
      ctx.fillRect(sx - 2 + flicker, sy - 26, 4, 4);
      ctx.fillStyle = '#FFAA00';
      ctx.fillRect(sx - 1, sy - 28 + flicker, 2, 3);
    }
  }

  function drawCamp(ctx, sx, sy, def, claimed, tick) {
    // Tent (triangle)
    ctx.fillStyle = def.colors.accent;
    ctx.beginPath();
    ctx.moveTo(sx, sy - 18);
    ctx.lineTo(sx - 12, sy + 2);
    ctx.lineTo(sx + 12, sy + 2);
    ctx.closePath();
    ctx.fill();
    // Tent opening
    ctx.fillStyle = '#5A3A1A';
    ctx.beginPath();
    ctx.moveTo(sx, sy - 10);
    ctx.lineTo(sx - 4, sy + 2);
    ctx.lineTo(sx + 4, sy + 2);
    ctx.closePath();
    ctx.fill();
    // Campfire (left side)
    if (!claimed) {
      ctx.fillStyle = '#FF4400';
      const flicker = Math.sin(tick * 0.15) * 1.5;
      ctx.beginPath();
      ctx.arc(sx - 10, sy + 4 + flicker, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFAA00';
      ctx.beginPath();
      ctx.arc(sx - 10, sy + 2, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    // Logs
    ctx.fillStyle = def.colors.primary;
    ctx.fillRect(sx - 14, sy + 4, 8, 2);
    ctx.fillRect(sx + 6, sy + 3, 6, 2);
    // Backpack
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(sx + 8, sy - 4, 5, 6);
  }

  function drawStoneCircle(ctx, sx, sy, def, claimed, tick) {
    const STONES = 6;
    const RADIUS = 12;
    for (let i = 0; i < STONES; i++) {
      const angle = (i / STONES) * Math.PI * 2 - Math.PI / 2;
      const stoneX = sx + Math.cos(angle) * RADIUS;
      const stoneY = sy + Math.sin(angle) * RADIUS * 0.6; // squashed for perspective
      const h = 6 + (i % 3) * 2;
      ctx.fillStyle = i % 2 === 0 ? def.colors.primary : def.colors.accent;
      ctx.fillRect(stoneX - 2, stoneY - h, 4, h);
      // Stone top
      ctx.fillStyle = '#999';
      ctx.fillRect(stoneX - 3, stoneY - h - 1, 6, 2);
    }
    // Center glow
    if (!claimed) {
      const pulse = 0.2 + Math.sin(tick * 0.05) * 0.15;
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = def.colors.glow;
      ctx.beginPath();
      ctx.ellipse(sx, sy, RADIUS - 2, (RADIUS - 2) * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // Rune marking in center
    ctx.fillStyle = claimed ? '#555' : def.colors.glow;
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('\u{2726}', sx, sy); // star symbol
  }

  function drawCrystalCave(ctx, sx, sy, def, claimed, tick) {
    // Cave mouth (dark arc)
    ctx.fillStyle = '#1A1A2E';
    ctx.beginPath();
    ctx.ellipse(sx, sy, 12, 8, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(sx - 12, sy - 1, 24, 6);
    // Rock frame
    ctx.fillStyle = '#4A4A4A';
    ctx.fillRect(sx - 14, sy - 2, 4, 8);
    ctx.fillRect(sx + 10, sy - 2, 4, 8);
    ctx.fillStyle = '#5A5A5A';
    ctx.fillRect(sx - 10, sy - 6, 20, 4);
    // Crystals
    if (!claimed) {
      const shimmer = Math.sin(tick * 0.1);
      const colors = ['#FF00FF', '#9370DB', '#00FFFF', '#FF69B4'];
      for (let i = 0; i < 4; i++) {
        const cx = sx - 6 + i * 4;
        const h = 4 + (i % 2) * 3;
        ctx.fillStyle = colors[i];
        ctx.globalAlpha = 0.7 + shimmer * 0.2;
        ctx.fillRect(cx, sy - 6 - h, 2, h);
        ctx.globalAlpha = 1;
      }
    } else {
      // Dimmed crystals
      ctx.fillStyle = '#333';
      for (let i = 0; i < 4; i++) {
        ctx.fillRect(sx - 6 + i * 4, sy - 8, 2, 3);
      }
    }
  }

  function drawFairyRing(ctx, sx, sy, def, claimed, tick) {
    const MUSHROOMS = 8;
    const RADIUS = 10;
    for (let i = 0; i < MUSHROOMS; i++) {
      const angle = (i / MUSHROOMS) * Math.PI * 2;
      const mx = sx + Math.cos(angle) * RADIUS;
      const my = sy + Math.sin(angle) * RADIUS * 0.5;
      // Stem
      ctx.fillStyle = '#F5F5DC';
      ctx.fillRect(mx - 1, my - 3, 2, 4);
      // Cap
      ctx.fillStyle = claimed ? '#8B4513' : (i % 2 === 0 ? '#FF4444' : '#FF6600');
      ctx.beginPath();
      ctx.arc(mx, my - 4, 3, Math.PI, 0);
      ctx.fill();
      // White dots on cap
      if (!claimed) {
        ctx.fillStyle = '#FFF';
        ctx.fillRect(mx - 1, my - 5, 1, 1);
        ctx.fillRect(mx + 1, my - 4, 1, 1);
      }
    }
    // Center glow
    if (!claimed) {
      const pulse = 0.15 + Math.sin(tick * 0.07) * 0.1;
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = def.colors.glow;
      ctx.beginPath();
      ctx.ellipse(sx, sy, RADIUS - 1, (RADIUS - 1) * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // Tiny floating sparkles
      for (let i = 0; i < 3; i++) {
        const sparkAngle = tick * 0.03 + i * 2.1;
        const sparkR = 6 + Math.sin(tick * 0.05 + i) * 2;
        const spx = sx + Math.cos(sparkAngle) * sparkR;
        const spy = sy - 6 + Math.sin(sparkAngle * 0.7) * 3;
        ctx.fillStyle = `rgba(127, 255, 0, ${0.3 + Math.sin(tick * 0.1 + i) * 0.2})`;
        ctx.fillRect(spx - 1, spy - 1, 2, 2);
      }
    }
  }

  /**
   * Draw the interaction prompt HUD when near an unclaimed landmark.
   */
  function drawPrompt(ctx, canvasW, canvasH) {
    const lm = getNearbyLandmark();
    if (!lm) return;

    const text = `${lm.def.icon} Press [E] to investigate`;
    ctx.font = 'bold 9px monospace';
    const tw = ctx.measureText(text).width;
    const px = (canvasW - tw) / 2 - 8;
    const py = canvasH - 58;
    ctx.fillStyle = 'rgba(20, 40, 60, 0.85)';
    ctx.beginPath();
    ctx.roundRect(px, py, tw + 16, 18, 4);
    ctx.fill();
    ctx.fillStyle = lm.def.colors.glow;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvasW / 2, py + 9);

    // Description below
    ctx.font = '7px monospace';
    ctx.fillStyle = '#AAA';
    ctx.fillText(lm.def.description, canvasW / 2, py + 24);
  }

  // ===== Update: generate landmarks for visible chunks =====

  function update(tick) {
    if (typeof ChunkManager === 'undefined') return;
    if (typeof Player === 'undefined') return;

    const pt = Player.getTile();
    const CHUNK_SIZE = ChunkManager.CHUNK_SIZE;
    const { cx: pcx, cy: pcy } = ChunkManager.worldToChunk(pt.col, pt.row);

    // Check 3x3 chunk neighborhood around player
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cx = pcx + dx;
        const cy = pcy + dy;
        if (ChunkManager.isLoaded(cx, cy)) {
          generateForChunk(cx, cy);
        }
      }
    }
  }

  // ===== State persistence =====

  function setCumulativeEnergy(energy) {
    cumulativeEnergy = energy || 0;
  }

  function getState() {
    return {
      discovered: Array.from(discoveredLandmarks),
      collection: collection,
    };
  }

  function loadState(state) {
    if (!state) return;
    if (state.discovered) {
      discoveredLandmarks = new Set(state.discovered);
      // Mark loaded landmarks as claimed
      for (const [key, lm] of activeLandmarks) {
        if (discoveredLandmarks.has(key)) {
          lm.claimed = true;
        }
      }
    }
    if (state.collection) {
      collection = state.collection;
    }
  }

  function getCollection() {
    return collection;
  }

  function getDiscoveredCount() {
    return discoveredLandmarks.size;
  }

  function getLandmarkTypes() {
    return LANDMARK_TYPES;
  }

  return {
    LANDMARK_TYPES,
    generateForChunk,
    getNearbyLandmark,
    claimLandmark,
    handleAction,
    draw,
    drawPrompt,
    update,
    setCumulativeEnergy,
    getState,
    loadState,
    getCollection,
    getDiscoveredCount,
    getLandmarkTypes,
  };
})();

if (typeof module !== 'undefined') module.exports = LandmarkGenerator;
