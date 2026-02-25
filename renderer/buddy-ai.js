// BuddyAI — controls buddy movement and farming/tending actions.
// When a Claude Code session is active, the buddy walks to crop plots
// or animal pastures and performs work animations.
const BuddyAI = (() => {
  // States
  const STATE = {
    IDLE: 'idle',
    WALKING: 'walking',
    PICKUP_TOOL: 'pickup_tool', // stopping at tool shed
    FARMING: 'farming',         // watering/hoeing at crop plot
    TENDING: 'tending',         // feeding animals in pasture
    HARVESTING: 'harvesting',   // picking mature crops
    SOCIAL: 'social',           // chatting with nearby buddy
  };

  // Movement speed (grid units per tick)
  const WALK_SPEED = 0.06;
  // Action duration (ticks)
  const FARM_DURATION = 120;   // ~2 seconds at 60fps
  const TEND_DURATION = 100;
  const HARVEST_DURATION = 90; // ~1.5 seconds — squat, pull, celebrate
  const PICKUP_DURATION = 30;  // ~0.5 seconds at tool shed
  const IDLE_LINGER = 180;     // stay idle before picking next task
  const SOCIAL_DURATION = 60;  // ~1 second chat
  const SOCIAL_DISTANCE = 1.5; // grid units to trigger
  const SOCIAL_COOLDOWN = 600; // ~10 seconds between chats per pair

  // Tool shed location (near field entrance on path row)
  const TOOL_SHED_COL = 2;
  const TOOL_SHED_ROW = 10;

  // Per-buddy AI state (keyed by sessionId)
  const buddyAI = new Map();

  // Track which plots are currently targeted (avoid crowding)
  const claimedPlots = new Set();

  // Social cooldown: tracks last chat tick per buddy pair (key = sorted id pair)
  const socialCooldowns = new Map();

  // Chat emoji pairs (both buddies show one each)
  const CHAT_EMOJIS = [
    ['\u{1F44B}', '\u{1F60A}'], // wave + smile
    ['\u{2615}',  '\u{1F4AC}'], // coffee + speech
    ['\u{1F31F}', '\u{1F44D}'], // star + thumbsup
    ['\u{1F3B5}', '\u{1F3B6}'], // music notes
    ['\u{1F4AA}', '\u{1F525}'], // muscle + fire
    ['\u{1F331}', '\u{2728}'],  // seedling + sparkles
    ['\u{1F60E}', '\u{1F389}'], // cool + party
    ['\u{1F917}', '\u{2764}\u{FE0F}'], // hug + heart
  ];

  // ===== Public API =====

  function onActivity(sessionId, eventType) {
    let ai = buddyAI.get(sessionId);
    if (!ai) {
      ai = createAI(sessionId);
      buddyAI.set(sessionId, ai);
    }

    // Action locking: ignore new events during walking or active animation
    if (ai.state === STATE.FARMING || ai.state === STATE.TENDING || ai.state === STATE.WALKING || ai.state === STATE.HARVESTING || ai.state === STATE.PICKUP_TOOL || ai.state === STATE.SOCIAL) return;

    // Map event type to farm action
    if (eventType === 'tool_use' || eventType === 'text' || eventType === 'bash_progress') {
      assignFarmTarget(ai, sessionId);
    } else if (eventType === 'thinking' || eventType === 'mcp_progress') {
      assignTendTarget(ai, sessionId);
    }
    // idle/sleeping → walk home handled in update
  }

  function onStateChange(sessionId, buddyState) {
    let ai = buddyAI.get(sessionId);
    if (!ai) {
      ai = createAI(sessionId);
      buddyAI.set(sessionId, ai);
    }

    if (buddyState === 'idle' || buddyState === 'sleeping') {
      // If currently doing action, let it finish; otherwise walk home
      if (ai.state === STATE.FARMING || ai.state === STATE.TENDING || ai.state === STATE.HARVESTING || ai.state === STATE.PICKUP_TOOL || ai.state === STATE.SOCIAL) return;
      assignHomeTarget(ai, sessionId);
    }
  }

  function update(tick) {
    // Check for social interactions between walking buddies
    checkSocialProximity(tick);

    for (const [sessionId, ai] of buddyAI) {
      const ent = getBuddyEntity(sessionId);
      if (!ent) continue;

      switch (ai.state) {
        case STATE.WALKING:
          updateWalking(ai, ent, tick);
          break;
        case STATE.PICKUP_TOOL:
          updatePickupTool(ai, ent, tick);
          break;
        case STATE.FARMING:
          updateFarming(ai, ent, tick);
          break;
        case STATE.TENDING:
          updateTending(ai, ent, tick);
          break;
        case STATE.HARVESTING:
          updateHarvesting(ai, ent, tick);
          break;
        case STATE.SOCIAL:
          updateSocial(ai, ent, tick);
          break;
        case STATE.IDLE:
          updateIdle(ai, ent, tick);
          break;
      }
    }
  }

  function remove(sessionId) {
    const ai = buddyAI.get(sessionId);
    if (ai && ai.claimedPlotKey) claimedPlots.delete(ai.claimedPlotKey);
    buddyAI.delete(sessionId);
  }

  // ===== Internal =====

  function createAI(sessionId) {
    return {
      state: STATE.IDLE,
      targetCol: 0,
      targetRow: 0,
      action: null,         // 'watering' | 'feeding' | 'harvesting' | null
      actionTimer: 0,
      idleTimer: 0,
      homeCol: 0,
      homeRow: 0,
      claimedPlotKey: null, // 'col,row' of claimed plot
      bobPhase: Math.random() * Math.PI * 2, // per-buddy bob offset
      // Pending target: stored when routing through tool shed
      pendingAction: null,
      pendingTargetCol: 0,
      pendingTargetRow: 0,
      // Social: stored action to resume after chat
      socialPartner: null,
      socialEmoji: null,
      preSocialState: null,
      preSocialAction: null,
    };
  }

  function getBuddyEntity(sessionId) {
    if (typeof IsoFarm !== 'undefined' && IsoFarm.getBuddyEntity) {
      return IsoFarm.getBuddyEntity(sessionId);
    }
    return null;
  }

  function assignFarmTarget(ai, sessionId) {
    if (typeof IsoFarm === 'undefined') return;
    const plots = IsoFarm.PLOT_POSITIONS;
    if (!plots || plots.length === 0) return;

    // Pick a random unoccupied plot
    const available = [];
    for (let i = 0; i < plots.length; i++) {
      const p = plots[i];
      const key = `${p.col},${p.row}`;
      if (!claimedPlots.has(key)) {
        available.push({ index: i, ...p });
      }
    }
    if (available.length === 0) {
      const p = plots[Math.floor(Math.random() * plots.length)];
      setWalkTarget(ai, p.col + 1, p.row + 0.3, 'watering');
      return;
    }

    // Prefer mature plots for harvesting (more visually interesting)
    let maturePlots = [];
    if (IsoFarm.getCropStage) {
      maturePlots = available.filter(p => IsoFarm.getCropStage(p.index) >= 4);
    }
    const chosen = maturePlots.length > 0
      ? maturePlots[Math.floor(Math.random() * maturePlots.length)]
      : available[Math.floor(Math.random() * available.length)];

    // Release previous claim
    if (ai.claimedPlotKey) claimedPlots.delete(ai.claimedPlotKey);
    const key = `${chosen.col},${chosen.row}`;
    claimedPlots.add(key);
    ai.claimedPlotKey = key;

    // Detect mature crop → harvesting action vs watering
    const stage = IsoFarm.getCropStage ? IsoFarm.getCropStage(chosen.index) : 0;
    const action = stage >= 4 ? 'harvesting' : 'watering';

    const offsetCol = (chosen.width || 1) * 0.5 + (Math.random() - 0.5) * 0.4;
    const offsetRow = 0.3 + Math.random() * 0.2;
    // Route through tool shed first (if not already near it)
    routeViaShed(ai, chosen.col + offsetCol, chosen.row + offsetRow, action);
  }

  function assignTendTarget(ai, sessionId) {
    if (typeof IsoFarm === 'undefined') return;
    const pasture = IsoFarm.PASTURE_ZONE;
    if (!pasture) return;

    // Pick a random spot in the pasture zone
    const col = pasture.minCol + 1 + Math.random() * (pasture.maxCol - pasture.minCol - 2);
    const row = pasture.minRow + Math.random() * (pasture.maxRow - pasture.minRow);
    // Route through tool shed first
    routeViaShed(ai, col + (Math.random() - 0.5) * 0.4, row, 'feeding');
  }

  function assignHomeTarget(ai, sessionId) {
    const ent = getBuddyEntity(sessionId);
    if (!ent) return;
    // Home = initial spawn position (row 10 area)
    if (ai.homeCol === 0 && ai.homeRow === 0) {
      ai.homeCol = ent.gridX;
      ai.homeRow = 10;
    }
    // Release plot claim
    if (ai.claimedPlotKey) {
      claimedPlots.delete(ai.claimedPlotKey);
      ai.claimedPlotKey = null;
    }
    setWalkTarget(ai, ai.homeCol + (Math.random() - 0.5) * 0.3, ai.homeRow, null);
  }

  function setWalkTarget(ai, col, row, action) {
    ai.targetCol = col;
    ai.targetRow = row;
    ai.action = action;
    ai.state = STATE.WALKING;
    ai.actionTimer = 0;
  }

  function routeViaShed(ai, destCol, destRow, action) {
    // Store the real destination
    ai.pendingAction = action;
    ai.pendingTargetCol = destCol;
    ai.pendingTargetRow = destRow;
    // Walk to tool shed first (with slight random offset so buddies don't stack)
    const shedX = TOOL_SHED_COL + 0.5 + (Math.random() - 0.5) * 0.6;
    const shedY = TOOL_SHED_ROW + 0.3;
    setWalkTarget(ai, shedX, shedY, 'pickup');
  }

  // ===== Update functions =====

  function updateWalking(ai, ent, tick) {
    const dx = ai.targetCol - ent.gridX;
    const dy = ai.targetRow - ent.gridY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 0.2) {
      // Arrived at target
      ent.gridX = ai.targetCol;
      ent.gridY = ai.targetRow;
      if (ai.action === 'pickup') {
        ai.state = STATE.PICKUP_TOOL;
        ai.actionTimer = PICKUP_DURATION;
        spawnActionEffect(ent, 'pickup');
      } else if (ai.action === 'harvesting') {
        ai.state = STATE.HARVESTING;
        ai.actionTimer = HARVEST_DURATION;
        spawnActionEffect(ent, 'harvest');
      } else if (ai.action === 'watering') {
        ai.state = STATE.FARMING;
        ai.actionTimer = FARM_DURATION;
        spawnActionEffect(ent, 'water');
      } else if (ai.action === 'feeding') {
        ai.state = STATE.TENDING;
        ai.actionTimer = TEND_DURATION;
        spawnActionEffect(ent, 'feed');
      } else {
        ai.state = STATE.IDLE;
        ai.idleTimer = IDLE_LINGER;
      }
      return;
    }

    // Move toward target
    const step = Math.min(WALK_SPEED, dist);
    ent.gridX += (dx / dist) * step;
    ent.gridY += (dy / dist) * step;

    // Update direction based on movement
    if (Math.abs(dx) >= Math.abs(dy)) {
      ent.direction = dx > 0 ? 'right' : 'left';
    } else {
      ent.direction = dy > 0 ? 'down' : 'up';
    }

    // Walking animation frame
    ent.frame = ((tick / 8) | 0) % 4;

    // Dust puffs at feet while walking
    if (tick % 12 === 0 && typeof IsoEngine !== 'undefined') {
      IsoEngine.spawnHarvestParticles(ent.gridX, ent.gridY + 0.1, '#C8B896', 1);
    }
  }

  function updatePickupTool(ai, ent, tick) {
    ai.actionTimer--;

    // Reach toward shed: lean forward, grab tool
    const progress = 1 - ai.actionTimer / PICKUP_DURATION;
    if (progress < 0.5) {
      // Reaching in
      ent.z = -progress * 2;
      ent.frame = 0;
    } else {
      // Pulling out with tool
      ent.z = -(1 - progress) * 2;
      ent.frame = 1;
    }

    // Face the shed
    ent.direction = 'left';

    // Tool sparkle at midpoint
    if (ai.actionTimer === Math.floor(PICKUP_DURATION / 2) && typeof IsoEffects !== 'undefined') {
      const toolEmojis = ['\u{1F527}', '\u{1FAA3}', '\u{1F4A7}']; // wrench, bucket, droplet
      const emoji = ai.pendingAction === 'feeding' ? '\u{1F33E}' : toolEmojis[Math.floor(Math.random() * toolEmojis.length)];
      IsoEffects.spawnText(ent.gridX, ent.gridY - 0.6, emoji, { color: '#FFD700', life: 40, rise: 0.8 });
    }

    if (ai.actionTimer <= 0) {
      ent.z = 0;
      // Log the pickup
      if (typeof Farm !== 'undefined' && Farm.logEvent) {
        Farm.logEvent('\u{1F6E0}', `Buddy grabbed tools`);
      }
      // Now walk to the real destination
      setWalkTarget(ai, ai.pendingTargetCol, ai.pendingTargetRow, ai.pendingAction);
      ai.pendingAction = null;
    }
  }

  function updateFarming(ai, ent, tick) {
    ai.actionTimer--;

    // Watering bob animation
    const bounce = Math.sin(tick * 0.15 + ai.bobPhase) * 2;
    ent.z = Math.max(0, bounce);

    // Water drop particles — spray forward from hand position
    if (ai.actionTimer % 15 === 0 && typeof IsoEngine !== 'undefined') {
      const dropX = ent.gridX + (Math.random() - 0.5) * 0.6;
      const dropY = ent.gridY + 0.3 + Math.random() * 0.3;
      IsoEngine.spawnHarvestParticles(dropX, dropY, '#4FC3F7', 2);
      IsoEngine.spawnHarvestParticles(dropX, dropY, '#81D4FA', 1);
    }

    // Floating water icon every 40 ticks
    if (ai.actionTimer % 40 === 0 && typeof IsoEffects !== 'undefined') {
      IsoEffects.spawnText(ent.gridX + (Math.random() - 0.5) * 0.4,
        ent.gridY - 0.3, '\u{1F4A7}', { color: '#4FC3F7', life: 40, rise: 0.8 });
    }

    // Face the crop
    ent.direction = 'down';
    ent.frame = ((tick / 10) | 0) % 2;

    // Character-specific accessory (orange → engineering hat)
    drawAccessory(ent, tick, 'watering');

    if (ai.actionTimer <= 0) {
      ent.z = 0;
      if (ai.claimedPlotKey) {
        claimedPlots.delete(ai.claimedPlotKey);
        ai.claimedPlotKey = null;
      }
      // Completion burst
      if (typeof IsoEffects !== 'undefined') {
        IsoEffects.spawnText(ent.gridX, ent.gridY - 0.5, '\u{2714}\u{FE0F}', { color: '#4CAF50', life: 60 });
      }
      if (typeof IsoEngine !== 'undefined') {
        IsoEngine.spawnHarvestParticles(ent.gridX, ent.gridY, '#4FC3F7', 8);
      }
      if (typeof Farm !== 'undefined' && Farm.logEvent) {
        Farm.logEvent('\u{1F4A7}', `Buddy watered crops`);
      }
      ai.state = STATE.IDLE;
      ai.idleTimer = IDLE_LINGER;
    }
  }

  function updateTending(ai, ent, tick) {
    ai.actionTimer--;

    // Feeding bob animation
    const bounce = Math.sin(tick * 0.12 + ai.bobPhase) * 1.5;
    ent.z = Math.max(0, bounce);

    // Feed scatter particles
    if (ai.actionTimer % 20 === 0 && typeof IsoEngine !== 'undefined') {
      const scatterX = ent.gridX + (Math.random() - 0.5) * 0.8;
      const scatterY = ent.gridY + Math.random() * 0.4;
      IsoEngine.spawnHarvestParticles(scatterX, scatterY, '#FFD54F', 2);
      IsoEngine.spawnHarvestParticles(scatterX, scatterY, '#FFF176', 1);
    }

    // Floating hearts every 35 ticks
    if (ai.actionTimer % 35 === 0 && typeof IsoEffects !== 'undefined') {
      IsoEffects.spawnText(ent.gridX + (Math.random() - 0.5) * 0.5,
        ent.gridY - 0.4, '\u{2764}\u{FE0F}', { color: '#E91E63', life: 50, rise: 0.7 });
    }

    ent.frame = ((tick / 12) | 0) % 2;

    if (ai.actionTimer <= 0) {
      ent.z = 0;
      // Completion burst
      if (typeof IsoEffects !== 'undefined') {
        IsoEffects.spawnText(ent.gridX, ent.gridY - 0.5, '\u{1F33E}', { color: '#8BC34A', life: 60 });
      }
      if (typeof IsoEngine !== 'undefined') {
        IsoEngine.spawnHarvestParticles(ent.gridX, ent.gridY, '#FFD54F', 8);
      }
      if (typeof Farm !== 'undefined' && Farm.logEvent) {
        Farm.logEvent('\u{2764}\u{FE0F}', `Buddy fed animals`);
      }
      ai.state = STATE.IDLE;
      ai.idleTimer = IDLE_LINGER;
    }
  }

  function updateHarvesting(ai, ent, tick) {
    ai.actionTimer--;

    // 3-phase animation: squat down → pull up → celebrate
    // Phase 1 (ticks 90-60): squat down to reach crop
    // Phase 2 (ticks 60-30): pull up with crop
    // Phase 3 (ticks 30-0):  celebrate with crop above head

    if (ai.actionTimer > 60) {
      // Phase 1: Squatting down
      const progress = (HARVEST_DURATION - ai.actionTimer) / 30;
      ent.z = -progress * 3; // dip down
      ent.frame = 0;
      // Reaching particles
      if (ai.actionTimer % 10 === 0 && typeof IsoEngine !== 'undefined') {
        IsoEngine.spawnHarvestParticles(ent.gridX + (Math.random() - 0.5) * 0.3,
          ent.gridY + 0.2, '#8B6B3E', 1);
      }
    } else if (ai.actionTimer > 30) {
      // Phase 2: Pull up — rising motion
      const progress = (60 - ai.actionTimer) / 30;
      ent.z = -3 + progress * 6; // -3 → +3 (lifting motion)
      ent.frame = 1;
      // Dirt + leaf particles while pulling
      if (ai.actionTimer % 5 === 0 && typeof IsoEngine !== 'undefined') {
        IsoEngine.spawnHarvestParticles(ent.gridX, ent.gridY + 0.2, '#8B6B3E', 2);
        IsoEngine.spawnHarvestParticles(ent.gridX, ent.gridY, '#6AB04C', 1);
      }
      // Crop pops out at peak
      if (ai.actionTimer === 31 && typeof IsoEffects !== 'undefined') {
        IsoEffects.spawnText(ent.gridX, ent.gridY - 0.6,
          '\u{1F33E}', { color: '#FFD700', life: 60, rise: 1.2 });
      }
    } else {
      // Phase 3: Celebrate — holding crop up, gentle bob
      ent.z = Math.max(0, Math.sin((30 - ai.actionTimer) / 30 * Math.PI) * 2);
      ent.frame = ((tick / 8) | 0) % 2;
      // Golden sparkles
      if (ai.actionTimer % 6 === 0 && typeof IsoEngine !== 'undefined') {
        const rx = ent.gridX + (Math.random() - 0.5) * 0.8;
        const ry = ent.gridY + (Math.random() - 0.5) * 0.4;
        IsoEngine.spawnHarvestParticles(rx, ry, '#FFD700', 2);
      }
    }

    ent.direction = 'down';

    // Character-specific accessory (blue → ripple particles)
    drawAccessory(ent, tick, 'harvesting');

    if (ai.actionTimer <= 0) {
      ent.z = 0;
      if (ai.claimedPlotKey) {
        claimedPlots.delete(ai.claimedPlotKey);
        ai.claimedPlotKey = null;
      }
      // Big completion burst
      if (typeof IsoEffects !== 'undefined') {
        IsoEffects.spawnText(ent.gridX, ent.gridY - 0.5,
          '\u{2714}\u{FE0F}', { color: '#4CAF50', life: 60 });
        IsoEffects.spawnText(ent.gridX + 0.3, ent.gridY - 0.7,
          '\u{2B50}', { color: '#FFD700', life: 50, rise: 1.0 });
      }
      if (typeof IsoEngine !== 'undefined') {
        IsoEngine.spawnHarvestParticles(ent.gridX, ent.gridY, '#FFD700', 12);
        IsoEngine.spawnHarvestParticles(ent.gridX, ent.gridY, '#8BC34A', 6);
      }
      if (typeof Farm !== 'undefined' && Farm.logEvent) {
        Farm.logEvent('\u{1F33E}', `Buddy harvested crops`);
      }
      ai.state = STATE.IDLE;
      ai.idleTimer = IDLE_LINGER;
    }
  }

  function updateIdle(ai, ent, tick) {
    ai.idleTimer--;
    ent.z = 0;
    ent.frame = 0;

    // Slight sway when idle
    if (ai.idleTimer <= 0) {
      // Pick a new nearby wander point (small radius)
      const wanderCol = ent.gridX + (Math.random() - 0.5) * 2;
      const wanderRow = ent.gridY + (Math.random() - 0.5) * 1;
      // Clamp to world bounds
      const clampedCol = Math.max(1, Math.min(wanderCol, (typeof IsoFarm !== 'undefined' ? IsoFarm.MAP_W : 20) - 2));
      const clampedRow = Math.max(1, Math.min(wanderRow, (typeof IsoFarm !== 'undefined' ? IsoFarm.MAP_H : 18) - 2));
      setWalkTarget(ai, clampedCol, clampedRow, null);
    }
  }

  // ===== Social interactions =====

  function checkSocialProximity(tick) {
    const entries = [...buddyAI.entries()];
    for (let i = 0; i < entries.length; i++) {
      const [idA, aiA] = entries[i];
      if (aiA.state !== STATE.WALKING && aiA.state !== STATE.IDLE) continue;
      const entA = getBuddyEntity(idA);
      if (!entA) continue;

      for (let j = i + 1; j < entries.length; j++) {
        const [idB, aiB] = entries[j];
        if (aiB.state !== STATE.WALKING && aiB.state !== STATE.IDLE) continue;
        const entB = getBuddyEntity(idB);
        if (!entB) continue;

        // Check distance
        const dx = entA.gridX - entB.gridX;
        const dy = entA.gridY - entB.gridY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist >= SOCIAL_DISTANCE) continue;

        // Check cooldown
        const pairKey = idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
        const lastChat = socialCooldowns.get(pairKey) || 0;
        if (tick - lastChat < SOCIAL_COOLDOWN) continue;

        // Trigger social interaction!
        socialCooldowns.set(pairKey, tick);
        const emojis = CHAT_EMOJIS[Math.floor(Math.random() * CHAT_EMOJIS.length)];

        // Save current state so we can resume after chat
        aiA.preSocialState = aiA.state;
        aiA.preSocialAction = aiA.action;
        aiB.preSocialState = aiB.state;
        aiB.preSocialAction = aiB.action;

        aiA.state = STATE.SOCIAL;
        aiA.actionTimer = SOCIAL_DURATION;
        aiA.socialPartner = idB;
        aiA.socialEmoji = emojis[0];

        aiB.state = STATE.SOCIAL;
        aiB.actionTimer = SOCIAL_DURATION;
        aiB.socialPartner = idA;
        aiB.socialEmoji = emojis[1];

        // Face each other
        entA.direction = dx > 0 ? 'left' : 'right';
        entB.direction = dx > 0 ? 'right' : 'left';

        // Initial greeting sparkle
        if (typeof IsoEngine !== 'undefined') {
          const midX = (entA.gridX + entB.gridX) / 2;
          const midY = (entA.gridY + entB.gridY) / 2;
          IsoEngine.spawnHarvestParticles(midX, midY, '#FFD700', 4);
        }
        break; // one social event per tick is enough
      }
    }
  }

  function updateSocial(ai, ent, tick) {
    ai.actionTimer--;

    // Gentle bob while chatting
    ent.z = Math.sin(tick * 0.2 + ai.bobPhase) * 0.5;
    ent.frame = 0;

    // Show emoji bubble at start and midpoint
    if ((ai.actionTimer === SOCIAL_DURATION - 1 || ai.actionTimer === Math.floor(SOCIAL_DURATION / 2))
        && typeof IsoEffects !== 'undefined' && ai.socialEmoji) {
      IsoEffects.spawnText(ent.gridX, ent.gridY - 0.8, ai.socialEmoji,
        { color: '#FFF', life: 45, rise: 0.6 });
    }

    // Small heart at end
    if (ai.actionTimer === 5 && typeof IsoEffects !== 'undefined') {
      IsoEffects.spawnText(ent.gridX, ent.gridY - 0.6, '\u{2764}\u{FE0F}',
        { color: '#E91E63', life: 30, rise: 0.4 });
    }

    if (ai.actionTimer <= 0) {
      ent.z = 0;
      // Log the social event (only from one side to avoid double logging)
      if (ai.socialPartner && ai.socialPartner > '') {
        const partnerEnt = getBuddyEntity(ai.socialPartner);
        if (partnerEnt && typeof Farm !== 'undefined' && Farm.logEvent) {
          // Only log from the buddy whose entity name comes first alphabetically
          if (!partnerEnt.name || ent.name <= partnerEnt.name) {
            Farm.logEvent('\u{1F4AC}', `Buddies had a chat`);
          }
        }
      }

      // Resume previous activity — go back to idle (will pick up next task naturally)
      ai.socialPartner = null;
      ai.socialEmoji = null;
      ai.state = STATE.IDLE;
      ai.idleTimer = 30; // short pause before next action
    }
  }

  // ===== Character-specific accessories =====
  // Orange buddy (#F39C12): engineering hat icon while watering
  // Blue buddy (#5B8DD9): blue ripple particles while harvesting

  const ACCESSORY_COLORS = {
    '#F39C12': 'orange',  // engineering hat
    '#5B8DD9': 'blue',    // blue ripples
  };

  function drawAccessory(ent, tick, action) {
    const role = ACCESSORY_COLORS[ent.hoodieColor];
    if (!role) return;

    if (role === 'orange' && action === 'watering') {
      // Engineering hat — float a hard hat emoji above head every 60 ticks
      if (tick % 60 === 0 && typeof IsoEffects !== 'undefined') {
        IsoEffects.spawnText(ent.gridX, ent.gridY - 0.9, '\u{1F477}',
          { color: '#F39C12', life: 55, rise: 0.15, scale: 0.8 });
      }
    } else if (role === 'blue' && action === 'harvesting') {
      // Blue ripple particles at feet every 8 ticks
      if (tick % 8 === 0 && typeof IsoEngine !== 'undefined') {
        const rx = ent.gridX + (Math.random() - 0.5) * 0.6;
        const ry = ent.gridY + 0.15 + Math.random() * 0.2;
        IsoEngine.spawnHarvestParticles(rx, ry, '#5B8DD9', 2);
        IsoEngine.spawnHarvestParticles(rx, ry, '#87CEEB', 1);
      }
    }
  }

  // ===== Effects =====

  function spawnActionEffect(ent, type) {
    if (typeof IsoEffects !== 'undefined') {
      if (type === 'water') {
        IsoEffects.spawnText(ent.gridX, ent.gridY - 0.6, '\u{1F4A6}', { color: '#4FC3F7', life: 50, rise: 0.9 });
      } else if (type === 'feed') {
        IsoEffects.spawnText(ent.gridX, ent.gridY - 0.6, '\u{1F331}', { color: '#8BC34A', life: 50, rise: 0.9 });
      } else if (type === 'harvest') {
        IsoEffects.spawnText(ent.gridX, ent.gridY - 0.6, '\u{270A}', { color: '#FF8C00', life: 50, rise: 0.9 });
      } else if (type === 'pickup') {
        IsoEffects.spawnText(ent.gridX, ent.gridY - 0.6, '\u{1F3E0}', { color: '#8B6B3E', life: 30, rise: 0.5 });
      }
    }
    if (typeof IsoEngine !== 'undefined') {
      const color = type === 'water' ? '#4FC3F7' : type === 'pickup' ? '#C8A870' : '#FFD54F';
      IsoEngine.spawnHarvestParticles(ent.gridX, ent.gridY, color, type === 'pickup' ? 4 : 8);
      if (type !== 'pickup') {
        IsoEngine.spawnHarvestParticles(ent.gridX, ent.gridY, '#FFFFFF', 3);
      }
    }
  }

  return {
    STATE,
    onActivity,
    onStateChange,
    update,
    remove,
  };
})();
