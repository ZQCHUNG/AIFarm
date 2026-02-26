// Iso Entity Manager — unified container for all isometric entities.
// Manages IsoCharacter, IsoAnimal, and IsoStatic with automatic
// screenX/Y + depthKey updates from logicalGridX/Y each frame.
// Ports AnimalAI's 1D behavior tree to 2D isometric grid movement.
const IsoEntityManager = (() => {
  // ===== Entity types =====
  const TYPE = {
    CHARACTER: 'character',
    ANIMAL: 'animal',
    STATIC: 'static',
  };

  // All managed entities
  let entities = [];

  // Current vibe mood (from data-exporter atmosphere)
  let animalMood = 'calm';

  // Reuse AnimalAI constants for personality + vibe effects
  const TRAITS = (typeof AnimalAI !== 'undefined') ? AnimalAI.TRAITS : {
    chicken: { speed: 0.06, restChance: 0.008, wanderRange: 20, reactStyle: 'scatter', restDuration: [60, 120] },
    cow:     { speed: 0.02, restChance: 0.005, wanderRange: 12, reactStyle: 'slow',    restDuration: [100, 200] },
    pig:     { speed: 0.03, restChance: 0.006, wanderRange: 15, reactStyle: 'huddle',   restDuration: [80, 160] },
    sheep:   { speed: 0.025,restChance: 0.007, wanderRange: 14, reactStyle: 'flock',    restDuration: [90, 180] },
    cat:     { speed: 0.015,restChance: 0.012, wanderRange: 10, reactStyle: 'loaf',     restDuration: [150, 300] },
    dog:     { speed: 0.05, restChance: 0.004, wanderRange: 25, reactStyle: 'excited',  restDuration: [40, 80] },
  };

  const VIBE_EFFECTS = {
    happy:    { reactChance: 0.02, reactBehavior: 'play',    reactDuration: [60, 120],  speedMod: 1.3 },
    calm:     { reactChance: 0.0,  reactBehavior: null,      reactDuration: [0, 0],     speedMod: 1.0 },
    cautious: { reactChance: 0.01, reactBehavior: 'shelter', reactDuration: [80, 150],  speedMod: 0.7 },
    huddled:  { reactChance: 0.03, reactBehavior: 'huddle',  reactDuration: [100, 200], speedMod: 0.5 },
  };

  // Behavior states (mirrors AnimalAI.STATE)
  const STATE = { WANDER: 'wander', REST: 'rest', REACT: 'react' };

  // Growth stages
  const GROWTH = { BABY: 'baby', ADULT: 'adult' };
  const BABY_SCALE = 0.6;
  const BABY_DURATION = 3600;       // ~1 min to grow up
  const BREED_CHANCE = 0.0005;      // per tick when conditions met
  const BREED_COOLDOWN = 7200;      // ~2 min between breeds
  const FEED_BOOST = 3;             // 3x chance with feed
  const MAX_PER_SPECIES = 4;        // max same-species animals

  // Breeding cooldown per species
  const breedCooldowns = {};

  // ===== 4-direction detection for isometric view =====
  // In iso: +col = screen right+down (east), +row = screen left+down (south)
  // Direction is determined by the dominant movement axis on the grid.
  function getDirection(dx, dy) {
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return null;
    if (Math.abs(dx) >= Math.abs(dy)) {
      return dx > 0 ? 'right' : 'left';
    }
    return dy > 0 ? 'down' : 'up';
  }

  // ===== Factory: create animal entity =====
  function createAnimal(type, homeCol, homeRow, opts) {
    const traits = TRAITS[type] || TRAITS.chicken;
    const wanderRadius = (opts && opts.wanderRadius) || traits.wanderRange / 5;
    const bounds = opts || {};

    return {
      entityType: TYPE.ANIMAL,
      type,
      // Logical grid position (float, sub-tile precision)
      gridX: homeCol,
      gridY: homeRow,
      z: 0,
      // Home / anchor
      homeCol,
      homeRow,
      // 2D wander target
      targetCol: homeCol,
      targetRow: homeRow,
      wanderRadius,
      // World bounds (grid coords)
      minCol: bounds.minCol || 0,
      maxCol: bounds.maxCol || 15,
      minRow: bounds.minRow || 0,
      maxRow: bounds.maxRow || 15,
      // Behavior state
      state: STATE.WANDER,
      stateTimer: 0,
      restTimer: 0,
      reactTimer: 0,
      reactBehavior: null,
      // Visual
      direction: 'down',
      frame: 0,
      spriteId: `animal_${type}`,
      // Z-axis jump animation
      jumpZ: 0,
      jumpVelocity: 0,
      isJumping: false,
      // Growth & breeding
      growthStage: (opts && opts.baby) ? GROWTH.BABY : GROWTH.ADULT,
      growthTimer: (opts && opts.baby) ? BABY_DURATION : 0,
      scale: (opts && opts.baby) ? BABY_SCALE : 1.0,
      // Social (nearest neighbor)
      nearestDist: 999,
      nearestDirX: 0,
      nearestDirY: 0,
      // Screen position (auto-updated)
      screenX: 0,
      screenY: 0,
      depth: 0,
    };
  }

  // ===== Factory: create character entity =====
  function createCharacter(col, row, opts) {
    const o = opts || {};
    return {
      entityType: TYPE.CHARACTER,
      gridX: col,
      gridY: row,
      z: 0,
      screenX: 0,
      screenY: 0,
      depth: 0,
      direction: o.direction || 'down',
      frame: 0,
      hoodieColor: o.hoodieColor || '#5B8DD9',
      name: o.name || '',
      spriteId: o.spriteId || null,
      // Path following (array of {col, row, dir})
      path: o.path || null,
      pathIndex: 0,
      pathTimer: 0,
      pathInterval: o.pathInterval || 30,
    };
  }

  // ===== Factory: create static entity (tree, building, crop) =====
  function createStatic(col, row, drawFn, opts) {
    const o = opts || {};
    return {
      entityType: TYPE.STATIC,
      gridX: col,
      gridY: row,
      z: o.z || 0,
      screenX: 0,
      screenY: 0,
      depth: 0,
      direction: null,
      frame: 0,
      draw: drawFn,
      spriteId: o.spriteId || null,
      signType: o.signType || null,
    };
  }

  // ===== Entity management =====

  function add(entity) {
    entities.push(entity);
    return entity;
  }

  function remove(entity) {
    const idx = entities.indexOf(entity);
    if (idx >= 0) entities.splice(idx, 1);
  }

  function clear() {
    entities = [];
  }

  function getAll() {
    return entities;
  }

  function getByType(type) {
    return entities.filter(e => e.entityType === type);
  }

  function setAnimalMood(mood) {
    animalMood = mood || 'calm';
  }

  // ===== Main update (called each tick) =====

  function update(tick) {
    const animals = [];
    for (const ent of entities) {
      if (ent.entityType === TYPE.ANIMAL) {
        updateAnimal(ent, tick);
        updateGrowth(ent, tick);
        animals.push(ent);
      } else if (ent.entityType === TYPE.CHARACTER && ent.path) {
        updateCharacterPath(ent, tick);
      }
    }

    // Social: nearest-neighbor for flocking/huddling
    if (animals.length > 1) {
      updateSocial(animals);
    }

    // Breeding check (every 60 ticks for performance)
    if (tick % 60 === 0 && animals.length > 1) {
      updateBreeding(animals, tick);
    }

    // Sync screen positions + depth for ALL entities
    syncScreenPositions();
  }

  // ===== Growth: baby → adult timer =====
  function updateGrowth(ent, tick) {
    if (ent.growthStage !== GROWTH.BABY) return;
    ent.growthTimer--;
    if (ent.growthTimer <= 0) {
      ent.growthStage = GROWTH.ADULT;
      ent.scale = 1.0;
      // Growth celebration particles
      if (typeof IsoEffects !== 'undefined') {
        IsoEffects.spawnFloatingText(ent.screenX, ent.screenY - 20, '\u{2B50} Grew up!', '#FFD700');
      }
    }
  }

  // ===== Breeding: two same-species adults nearby + happy mood =====
  function updateBreeding(animals, tick) {
    // Group adults by species
    const speciesMap = {};
    for (const a of animals) {
      if (a.growthStage !== GROWTH.ADULT) continue;
      if (!speciesMap[a.type]) speciesMap[a.type] = [];
      speciesMap[a.type].push(a);
    }

    for (const [species, adults] of Object.entries(speciesMap)) {
      if (adults.length < 2) continue;

      // Check species cooldown
      if (breedCooldowns[species] && breedCooldowns[species] > tick) continue;

      // Count total of this species (including babies)
      const totalOfSpecies = animals.filter(a => a.type === species).length;
      if (totalOfSpecies >= MAX_PER_SPECIES) continue;

      // Check if any pair is close enough (within 3 grid units)
      let breedPair = null;
      for (let i = 0; i < adults.length && !breedPair; i++) {
        for (let j = i + 1; j < adults.length; j++) {
          const dx = adults[i].gridX - adults[j].gridX;
          const dy = adults[i].gridY - adults[j].gridY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 3.0) {
            breedPair = [adults[i], adults[j]];
            break;
          }
        }
      }
      if (!breedPair) continue;

      // Mood check: only breed when happy
      if (animalMood !== 'happy') continue;

      // Calculate chance with feed boost
      let chance = BREED_CHANCE;
      if (typeof ResourceInventory !== 'undefined' && ResourceInventory.has('feed', 1)) {
        chance *= FEED_BOOST;
      }

      if (Math.random() < chance) {
        // Breed! Spawn baby between parents
        const midCol = (breedPair[0].gridX + breedPair[1].gridX) / 2;
        const midRow = (breedPair[0].gridY + breedPair[1].gridY) / 2;

        // Consume feed if available
        if (typeof ResourceInventory !== 'undefined' && ResourceInventory.has('feed', 1)) {
          ResourceInventory.spend('feed', 1);
        }

        const baby = createAnimal(species, midCol, midRow, {
          baby: true,
          minCol: breedPair[0].minCol,
          maxCol: breedPair[0].maxCol,
          minRow: breedPair[0].minRow,
          maxRow: breedPair[0].maxRow,
          wanderRadius: breedPair[0].wanderRadius * 0.7,
        });
        add(baby);

        // Set cooldown
        breedCooldowns[species] = tick + BREED_COOLDOWN;

        // Heart particles on parents
        if (typeof IsoEffects !== 'undefined') {
          IsoEffects.spawnFloatingText(breedPair[0].screenX, breedPair[0].screenY - 16, '\u{2764}\u{FE0F}', '#FF6B6B');
          IsoEffects.spawnFloatingText(breedPair[1].screenX, breedPair[1].screenY - 16, '\u{2764}\u{FE0F}', '#FF6B6B');
          IsoEffects.spawnFloatingText(
            (breedPair[0].screenX + breedPair[1].screenX) / 2,
            Math.min(breedPair[0].screenY, breedPair[1].screenY) - 24,
            '\u{1F423} Baby!', '#FFD700'
          );
        }

        // Log event
        if (typeof Farm !== 'undefined' && Farm.logEvent) {
          Farm.logEvent('\u{1F423}', `A baby ${species} was born!`);
        }
      }
    }
  }

  // ===== Sync to IsoEngine =====
  // Push all managed entities into IsoEngine's entity list for depth-sorted rendering.

  function syncToEngine() {
    if (typeof IsoEngine === 'undefined') return;
    IsoEngine.clearEntities();

    for (const ent of entities) {
      const totalZ = (ent.z || 0) + (ent.jumpZ || 0);

      if (ent.entityType === TYPE.STATIC) {
        // Static entities: use draw function or spriteId
        // baseRow = gridY (ground contact — trees sort by trunk base)
        // NPCs use static type but need character-like depth sorting
        const isNPC = ent.isNPC === true;
        IsoEngine.addEntity({
          col: ent.gridX,
          row: ent.gridY,
          z: totalZ,
          baseRow: ent.gridY,
          baseCol: ent.gridX,
          isStatic: !isNPC,
          spriteId: ent.spriteId,
          direction: ent.direction,
          frame: ent.frame,
          draw: ent.draw,
        });
      } else if (ent.entityType === TYPE.CHARACTER) {
        // Characters: baseRow = gridY (feet position)
        IsoEngine.addEntity({
          col: ent.gridX,
          row: ent.gridY,
          z: totalZ,
          baseRow: ent.gridY,
          baseCol: ent.gridX,
          isStatic: false,
          spriteId: ent.spriteId,
          direction: ent.direction,
          frame: ent.frame,
          draw: (ctx, sx, sy, tick) => {
            IsoEngine.drawIsoCharacter(ctx, sx, sy, ent.direction, ent.frame, ent.hoodieColor, tick);
          },
        });
      } else if (ent.entityType === TYPE.ANIMAL) {
        // Animals: baseRow = gridY (feet position, unaffected by jumpZ)
        IsoEngine.addEntity({
          col: ent.gridX,
          row: ent.gridY,
          z: totalZ,
          baseRow: ent.gridY,
          baseCol: ent.gridX,
          isStatic: false,
          spriteId: ent.spriteId,
          direction: ent.direction,
          frame: ent.frame,
          draw: (ctx, sx, sy, tick) => {
            const isBaby = ent.growthStage === GROWTH.BABY;
            if (isBaby) {
              ctx.save();
              ctx.translate(sx, sy);
              ctx.scale(BABY_SCALE, BABY_SCALE);
              ctx.translate(-sx, -sy);
            }
            if (typeof IsoEngine !== 'undefined' && IsoEngine.drawAnimal) {
              IsoEngine.drawAnimal(ctx, sx, sy, ent.type, ent.frame, tick);
            } else {
              drawIsoAnimal(ctx, sx, sy, ent, tick);
            }
            if (isBaby) {
              ctx.restore();
              // Baby indicator: tiny bouncing star
              const bobY = Math.sin(tick * 0.1) * 2;
              ctx.fillStyle = '#FFD700';
              ctx.font = '5px monospace';
              ctx.textAlign = 'center';
              ctx.fillText('\u{2B50}', sx, sy - 10 + bobY);
            }
            // State indicators (ZZZ for resting, sparkles for playing)
            if (ent.state === STATE.REST) {
              const zzz = ((tick / 20) | 0) % 3;
              ctx.fillStyle = 'rgba(255,255,255,0.5)';
              ctx.font = '6px monospace';
              ctx.textAlign = 'center';
              ctx.fillText('z', sx + 4 + zzz * 2, sy - 12 - zzz);
            } else if (ent.state === STATE.REACT && ent.reactBehavior === 'play') {
              const sparkX = sx + Math.sin(tick * 0.3) * 5;
              const sparkY = sy - 14 + Math.cos(tick * 0.2) * 3;
              ctx.fillStyle = '#FFD700';
              ctx.fillRect(sparkX - 1, sparkY - 1, 2, 2);
            }
          },
        });
      }
    }
  }

  // ===== Screen position sync =====

  function syncScreenPositions() {
    if (typeof IsoEngine === 'undefined') return;
    for (const ent of entities) {
      const totalZ = (ent.z || 0) + (ent.jumpZ || 0);
      const screen = IsoEngine.gridToScreen(ent.gridX, ent.gridY, totalZ);
      // Pixel-snapping to prevent sub-pixel gaps at non-integer zoom (CTO request)
      ent.screenX = Math.round(screen.x);
      ent.screenY = Math.round(screen.y);
      // Depth uses ground position (pivotY), not elevated Z
      const priority = ent.entityType === TYPE.STATIC ? 0.3 : 0.5;
      ent.depth = IsoEngine.depthKey(ent.gridX, ent.gridY, 0, priority);
    }
  }

  // ===== 2D Animal Behavior Tree =====

  function updateAnimal(ent, tick) {
    const traits = TRAITS[ent.type] || TRAITS.chicken;
    const vibeEffect = VIBE_EFFECTS[animalMood] || VIBE_EFFECTS.calm;
    ent.stateTimer++;

    switch (ent.state) {
      case STATE.WANDER: animalWander(ent, traits, vibeEffect, tick); break;
      case STATE.REST:   animalRest(ent, traits, vibeEffect, tick); break;
      case STATE.REACT:  animalReact(ent, traits, vibeEffect, tick); break;
    }

    // Clamp to bounds
    ent.gridX = Math.max(ent.minCol, Math.min(ent.maxCol, ent.gridX));
    ent.gridY = Math.max(ent.minRow, Math.min(ent.maxRow, ent.gridY));

    // Animation frame (walking or playing = animate, otherwise idle)
    if (ent.state === STATE.WANDER || (ent.state === STATE.REACT && ent.reactBehavior === 'play')) {
      ent.frame = ((tick / 14) | 0) % 2;
    } else {
      ent.frame = 0;
    }

    // Z-axis jump physics
    updateJump(ent, traits, vibeEffect, tick);
  }

  function animalWander(ent, traits, vibeEffect, tick) {
    const speed = traits.speed * vibeEffect.speedMod;
    const dx = ent.targetCol - ent.gridX;
    const dy = ent.targetRow - ent.gridY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 0.3) {
      // Reached target — pick new target or rest
      if (Math.random() < traits.restChance * 3) {
        animalTransition(ent, STATE.REST, traits);
        return;
      }
      pickNewTarget2D(ent, traits);
    } else {
      // Move toward target
      const step = Math.min(speed, dist);
      ent.gridX += (dx / dist) * step;
      ent.gridY += (dy / dist) * step;
      // Update direction from movement vector
      const dir = getDirection(dx, dy);
      if (dir) ent.direction = dir;
    }

    // Check for vibe reaction
    if (vibeEffect.reactBehavior && Math.random() < vibeEffect.reactChance) {
      animalTransitionReact(ent, vibeEffect);
      return;
    }

    // Random rest
    if (Math.random() < traits.restChance) {
      animalTransition(ent, STATE.REST, traits);
    }
  }

  function animalRest(ent, traits, vibeEffect, tick) {
    ent.restTimer--;
    if (ent.restTimer <= 0) {
      if (vibeEffect.reactBehavior && Math.random() < vibeEffect.reactChance * 5) {
        animalTransitionReact(ent, vibeEffect);
      } else {
        animalTransition(ent, STATE.WANDER, traits);
        pickNewTarget2D(ent, traits);
      }
    }
  }

  function animalReact(ent, traits, vibeEffect, tick) {
    ent.reactTimer--;

    if (ent.reactBehavior === 'play') {
      // Excited bouncing — faster random movement
      const speed = traits.speed * 1.8;
      const dx = ent.targetCol - ent.gridX;
      const dy = ent.targetRow - ent.gridY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 0.5) {
        // Pick wild target within 1.5x radius
        const angle = Math.random() * Math.PI * 2;
        const r = Math.random() * ent.wanderRadius * 1.5;
        ent.targetCol = Math.max(ent.minCol, Math.min(ent.maxCol, ent.homeCol + Math.cos(angle) * r));
        ent.targetRow = Math.max(ent.minRow, Math.min(ent.maxRow, ent.homeRow + Math.sin(angle) * r));
      } else {
        const step = Math.min(speed, dist);
        ent.gridX += (dx / dist) * step;
        ent.gridY += (dy / dist) * step;
        const dir = getDirection(dx, dy);
        if (dir) ent.direction = dir;
      }
    } else if (ent.reactBehavior === 'shelter') {
      // Move toward home position
      const dx = ent.homeCol - ent.gridX;
      const dy = ent.homeRow - ent.gridY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0.5) {
        const step = traits.speed * 0.8;
        ent.gridX += (dx / dist) * step;
        ent.gridY += (dy / dist) * step;
        const dir = getDirection(dx, dy);
        if (dir) ent.direction = dir;
      }
    } else if (ent.reactBehavior === 'huddle') {
      // Move toward nearest neighbor (flock together)
      if (ent.nearestDist > 1.5) {
        const step = traits.speed * 0.6;
        ent.gridX += ent.nearestDirX * step;
        ent.gridY += ent.nearestDirY * step;
        const dir = getDirection(ent.nearestDirX, ent.nearestDirY);
        if (dir) ent.direction = dir;
      }
    }

    if (ent.reactTimer <= 0) {
      animalTransition(ent, STATE.WANDER, traits);
      pickNewTarget2D(ent, traits);
    }
  }

  // ===== State transitions =====

  function animalTransition(ent, newState, traits) {
    ent.state = newState;
    ent.stateTimer = 0;
    if (newState === STATE.REST) {
      const [min, max] = traits.restDuration;
      ent.restTimer = min + Math.floor(Math.random() * (max - min));
    }
  }

  function animalTransitionReact(ent, vibeEffect) {
    ent.state = STATE.REACT;
    ent.stateTimer = 0;
    ent.reactBehavior = vibeEffect.reactBehavior;
    const [min, max] = vibeEffect.reactDuration;
    ent.reactTimer = min + Math.floor(Math.random() * (max - min));
  }

  // ===== 2D target picking (diamond-shaped wander area) =====
  // Diamond constraint: |dx| + |dy| <= wanderRadius

  function pickNewTarget2D(ent, traits) {
    const r = ent.wanderRadius;
    // Pick random point within diamond around home
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * r;
    let dx = Math.cos(angle) * dist;
    let dy = Math.sin(angle) * dist;
    // Enforce diamond: scale down if |dx|+|dy| exceeds radius
    const manhattan = Math.abs(dx) + Math.abs(dy);
    if (manhattan > r) {
      const scale = r / manhattan;
      dx *= scale;
      dy *= scale;
    }
    ent.targetCol = Math.max(ent.minCol, Math.min(ent.maxCol, ent.homeCol + dx));
    ent.targetRow = Math.max(ent.minRow, Math.min(ent.maxRow, ent.homeRow + dy));
  }

  // ===== Z-axis jump =====
  // CTO request: animals can "jump" — z oscillates. Chickens jump when vibe is high.

  function updateJump(ent, traits, vibeEffect, tick) {
    if (ent.isJumping) {
      // Simple physics: velocity -= gravity, z += velocity
      ent.jumpZ += ent.jumpVelocity;
      ent.jumpVelocity -= 0.015;
      if (ent.jumpZ <= 0) {
        ent.jumpZ = 0;
        ent.jumpVelocity = 0;
        ent.isJumping = false;
      }
    } else {
      // Trigger jump: chickens jump frequently when happy, others rarely
      let jumpChance = 0;
      if (ent.type === 'chicken' && animalMood === 'happy') {
        jumpChance = 0.008;
      } else if (ent.type === 'dog' && animalMood === 'happy') {
        jumpChance = 0.005;
      } else if (ent.state === STATE.REACT && ent.reactBehavior === 'play') {
        jumpChance = 0.003;
      }
      if (jumpChance > 0 && Math.random() < jumpChance) {
        ent.isJumping = true;
        ent.jumpVelocity = 0.08 + Math.random() * 0.04;
      }
    }
  }

  // ===== Social: 2D nearest-neighbor =====

  function updateSocial(animals) {
    for (let i = 0; i < animals.length; i++) {
      let minDist = 999;
      let dirX = 0;
      let dirY = 0;
      for (let j = 0; j < animals.length; j++) {
        if (i === j) continue;
        const dx = animals[j].gridX - animals[i].gridX;
        const dy = animals[j].gridY - animals[i].gridY;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < minDist) {
          minDist = d;
          if (d > 0.01) {
            dirX = dx / d;
            dirY = dy / d;
          }
        }
      }
      animals[i].nearestDist = minDist;
      animals[i].nearestDirX = dirX;
      animals[i].nearestDirY = dirY;
    }
  }

  // ===== Character path following =====

  function updateCharacterPath(ent, tick) {
    if (!ent.path || ent.path.length === 0) return;
    ent.pathTimer++;
    if (ent.pathTimer >= ent.pathInterval) {
      ent.pathTimer = 0;
      ent.pathIndex = (ent.pathIndex + 1) % ent.path.length;
      const wp = ent.path[ent.pathIndex];
      ent.gridX = wp.col;
      ent.gridY = wp.row;
      if (wp.dir) {
        ent.direction = wp.dir;
      } else {
        // Auto-detect direction from movement
        const prevIdx = (ent.pathIndex - 1 + ent.path.length) % ent.path.length;
        const prev = ent.path[prevIdx];
        const dir = getDirection(wp.col - prev.col, wp.row - prev.row);
        if (dir) ent.direction = dir;
      }
      ent.frame++;
    }
  }

  // ===== Procedural animal drawing (fallback when no sprites loaded) =====

  function drawIsoAnimal(ctx, sx, sy, ent, tick) {
    const bob = ent.frame % 2 === 0 ? 0 : -1;
    const baseY = sy + bob;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.ellipse(sx, sy + 2, 5, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();

    switch (ent.type) {
      case 'chicken': drawIsoChicken(ctx, sx, baseY, ent, tick); break;
      case 'cow':     drawIsoCow(ctx, sx, baseY, ent, tick); break;
      case 'pig':     drawIsoPig(ctx, sx, baseY, ent, tick); break;
      case 'sheep':   drawIsoSheep(ctx, sx, baseY, ent, tick); break;
      case 'cat':     drawIsoCat(ctx, sx, baseY, ent, tick); break;
      case 'dog':     drawIsoDog(ctx, sx, baseY, ent, tick); break;
    }

    // State indicators
    if (ent.state === STATE.REST) {
      // ZZZ
      const zzz = ((tick / 20) | 0) % 3;
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '6px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('z', sx + 4 + zzz * 2, baseY - 12 - zzz);
    } else if (ent.state === STATE.REACT && ent.reactBehavior === 'play') {
      // Sparkles
      const sparkX = sx + Math.sin(tick * 0.3) * 5;
      const sparkY = baseY - 14 + Math.cos(tick * 0.2) * 3;
      ctx.fillStyle = '#FFD700';
      ctx.fillRect(sparkX - 1, sparkY - 1, 2, 2);
    }
  }

  function drawIsoChicken(ctx, sx, sy, ent, tick) {
    const flip = ent.direction === 'left' || ent.direction === 'up' ? -1 : 1;
    // Body
    ctx.fillStyle = '#FFF8E0';
    ctx.fillRect(sx - 3, sy - 6, 6, 4);
    // Head
    ctx.fillStyle = '#FFF8E0';
    ctx.fillRect(sx + flip * 3, sy - 8, 3 * flip, 3);
    // Comb
    ctx.fillStyle = '#FF4444';
    ctx.fillRect(sx + flip * 4, sy - 10, 2, 2);
    // Beak
    ctx.fillStyle = '#FF8800';
    ctx.fillRect(sx + flip * 5, sy - 6, 2 * flip, 1);
    // Eye
    ctx.fillStyle = '#222';
    ctx.fillRect(sx + flip * 4, sy - 7, 1, 1);
    // Legs
    ctx.fillStyle = '#FF8800';
    ctx.fillRect(sx - 2, sy - 2, 1, 2);
    ctx.fillRect(sx + 1, sy - 2, 1, 2);
  }

  function drawIsoCow(ctx, sx, sy, ent, tick) {
    const flip = ent.direction === 'left' || ent.direction === 'up' ? -1 : 1;
    // Body
    ctx.fillStyle = '#FFF';
    ctx.fillRect(sx - 5, sy - 8, 10, 5);
    // Spots
    ctx.fillStyle = '#333';
    ctx.fillRect(sx - 2, sy - 7, 2, 2);
    ctx.fillRect(sx + 2, sy - 6, 2, 2);
    // Head
    ctx.fillStyle = '#FFF';
    ctx.fillRect(sx + flip * 5, sy - 9, 4 * flip, 3);
    // Nose
    ctx.fillStyle = '#FFB0B0';
    ctx.fillRect(sx + flip * 7, sy - 8, 1, 2);
    // Eye
    ctx.fillStyle = '#222';
    ctx.fillRect(sx + flip * 6, sy - 8, 1, 1);
    // Horns
    ctx.fillStyle = '#C8A060';
    ctx.fillRect(sx + flip * 5, sy - 11, 1, 2);
    // Legs
    ctx.fillStyle = '#CCC';
    ctx.fillRect(sx - 4, sy - 3, 1, 3);
    ctx.fillRect(sx - 1, sy - 3, 1, 3);
    ctx.fillRect(sx + 2, sy - 3, 1, 3);
  }

  function drawIsoPig(ctx, sx, sy, ent, tick) {
    const flip = ent.direction === 'left' || ent.direction === 'up' ? -1 : 1;
    // Body
    ctx.fillStyle = '#FFB0B0';
    ctx.fillRect(sx - 4, sy - 7, 8, 4);
    // Snout
    ctx.fillStyle = '#FF8888';
    ctx.fillRect(sx + flip * 4, sy - 6, 2 * flip, 2);
    // Eye
    ctx.fillStyle = '#222';
    ctx.fillRect(sx + flip * 3, sy - 6, 1, 1);
    // Ears
    ctx.fillStyle = '#FF9090';
    ctx.fillRect(sx + flip * 2, sy - 9, 2, 2);
    // Legs
    ctx.fillStyle = '#FF9090';
    ctx.fillRect(sx - 3, sy - 3, 1, 2);
    ctx.fillRect(sx + 2, sy - 3, 1, 2);
    // Curly tail
    ctx.fillStyle = '#FF9090';
    ctx.fillRect(sx - flip * 5, sy - 7, 1, 1);
    ctx.fillRect(sx - flip * 5, sy - 8, 1, 1);
  }

  function drawIsoSheep(ctx, sx, sy, ent, tick) {
    const flip = ent.direction === 'left' || ent.direction === 'up' ? -1 : 1;
    // Fluffy body
    ctx.fillStyle = '#F0F0F0';
    ctx.fillRect(sx - 4, sy - 8, 8, 5);
    ctx.fillRect(sx - 5, sy - 7, 10, 3);
    // Head
    ctx.fillStyle = '#333';
    ctx.fillRect(sx + flip * 4, sy - 8, 3 * flip, 3);
    // Eye
    ctx.fillStyle = '#FFF';
    ctx.fillRect(sx + flip * 5, sy - 7, 1, 1);
    // Legs
    ctx.fillStyle = '#333';
    ctx.fillRect(sx - 3, sy - 3, 1, 2);
    ctx.fillRect(sx + 2, sy - 3, 1, 2);
  }

  function drawIsoCat(ctx, sx, sy, ent, tick) {
    const flip = ent.direction === 'left' || ent.direction === 'up' ? -1 : 1;
    const sitting = ent.state === STATE.REST;
    // Body
    ctx.fillStyle = '#FF8C44';
    ctx.fillRect(sx - 3, sy - 6, 6, 3);
    // Head
    ctx.fillStyle = '#FF8C44';
    ctx.fillRect(sx + flip * 2, sy - 9, 4 * flip, 3);
    // Ears
    ctx.fillStyle = '#FF8C44';
    ctx.fillRect(sx + flip * 2, sy - 11, 1, 2);
    ctx.fillRect(sx + flip * 4, sy - 11, 1, 2);
    // Eyes
    ctx.fillStyle = sitting ? '#2E2' : '#222';
    ctx.fillRect(sx + flip * 3, sy - 8, 1, 1);
    // Tail
    ctx.fillStyle = '#FF8C44';
    if (sitting) {
      ctx.fillRect(sx - flip * 3, sy - 4, 1, 2);
    } else {
      ctx.fillRect(sx - flip * 4, sy - 7, 1, 1);
      ctx.fillRect(sx - flip * 5, sy - 8, 1, 1);
    }
    // Legs
    ctx.fillStyle = '#E07830';
    ctx.fillRect(sx - 2, sy - 3, 1, 2);
    ctx.fillRect(sx + 1, sy - 3, 1, 2);
  }

  function drawIsoDog(ctx, sx, sy, ent, tick) {
    const flip = ent.direction === 'left' || ent.direction === 'up' ? -1 : 1;
    // Body
    ctx.fillStyle = '#C88850';
    ctx.fillRect(sx - 4, sy - 7, 8, 4);
    // Head
    ctx.fillStyle = '#C88850';
    ctx.fillRect(sx + flip * 3, sy - 9, 4 * flip, 3);
    // Ear
    ctx.fillStyle = '#A06838';
    ctx.fillRect(sx + flip * 5, sy - 11, 2, 2);
    // Eye
    ctx.fillStyle = '#222';
    ctx.fillRect(sx + flip * 5, sy - 8, 1, 1);
    // Nose
    ctx.fillStyle = '#333';
    ctx.fillRect(sx + flip * 6, sy - 9, 1, 1);
    // Legs
    ctx.fillStyle = '#A06838';
    ctx.fillRect(sx - 3, sy - 3, 1, 2);
    ctx.fillRect(sx + 2, sy - 3, 1, 2);
    // Tail (wagging)
    const tailUp = ((tick / 8) | 0) % 2 === 0;
    ctx.fillStyle = '#C88850';
    ctx.fillRect(sx - flip * 5, sy - (tailUp ? 8 : 7), 1, 2);
  }

  // ===== Public API =====

  return {
    TYPE,
    STATE,
    GROWTH,
    getDirection,
    createAnimal,
    createCharacter,
    createStatic,
    add,
    remove,
    clear,
    getAll,
    getByType,
    setAnimalMood,
    update,
    syncToEngine,
    syncScreenPositions,
  };
})();
