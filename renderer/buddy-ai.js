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
    SHELTER: 'shelter',         // seeking shelter from weather
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

  // Tool shed location (near field entrance on path row — local farm coords)
  const TOOL_SHED_COL = 2;
  const TOOL_SHED_ROW = 10;

  // Home offset helper for mega-map support
  function _off() {
    return (typeof IsoEngine !== 'undefined' && IsoEngine.getHomeOffset)
      ? IsoEngine.getHomeOffset() : { col: 0, row: 0 };
  }

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

  // Social event types (weighted selection)
  const SOCIAL_EVENTS = [
    { type: 'chat',  weight: 5, duration: 60,  log: '\u{1F4AC} Buddies had a chat' },
    { type: 'dance', weight: 2, duration: 90,  log: '\u{1F57A} Buddies danced together!' },
    { type: 'slack', weight: 2, duration: 120, log: '\u{1F634} Buddies took a break together' },
    { type: 'highfive', weight: 1, duration: 40, log: '\u{1F91A} Buddies high-fived!' },
  ];

  // Context-aware emojis — chosen based on recent farm events
  const CONTEXT_EMOJIS = {
    rain:    [['\u{2614}', '\u{1F327}\u{FE0F}'], ['\u{1F4A7}', '\u{1F32A}\u{FE0F}']],
    harvest: [['\u{1F33E}', '\u{1F389}'], ['\u{1F955}', '\u{2B50}']],
    sell:    [['\u{1FA99}', '\u{1F4B0}'], ['\u{1F911}', '\u{1F4B8}']],
    breed:   [['\u{1F423}', '\u{2764}\u{FE0F}'], ['\u{1F425}', '\u{1F31F}']],
    night:   [['\u{1F319}', '\u{2B50}'], ['\u{1F30C}', '\u{1F634}']],
  };

  // Track recent context events (last 30 seconds)
  let recentContext = []; // { type, tick }

  // Shelter positions (near buildings)
  const SHELTER_POSITIONS = [
    { col: 5,  row: 15 },  // barn
    { col: 2,  row: 10 },  // tool shed
    { col: 11, row: 15 },  // market
    { col: 4,  row: 17 },  // townhall
  ];

  function addContext(type, tick) {
    recentContext.push({ type, tick });
    // Trim old entries (keep last 1800 ticks = ~30 seconds)
    recentContext = recentContext.filter(c => tick - c.tick < 1800);
  }

  function getContextEmojis(tick) {
    // Check weather first
    if (typeof IsoWeather !== 'undefined' && IsoWeather.isRaining && IsoWeather.isRaining()) {
      const set = CONTEXT_EMOJIS.rain;
      return set[Math.floor(Math.random() * set.length)];
    }
    // Check recent context
    for (const ctx of recentContext.slice().reverse()) {
      if (CONTEXT_EMOJIS[ctx.type]) {
        const set = CONTEXT_EMOJIS[ctx.type];
        return set[Math.floor(Math.random() * set.length)];
      }
    }
    // Check time of day
    if (typeof IsoWeather !== 'undefined') {
      const isNight = (IsoWeather.isNight && IsoWeather.isNight()) || (IsoWeather.isDusk && IsoWeather.isDusk());
      if (isNight) {
        const set = CONTEXT_EMOJIS.night;
        return set[Math.floor(Math.random() * set.length)];
      }
    }
    return null; // fallback to regular CHAT_EMOJIS
  }

  function pickSocialEvent() {
    const totalWeight = SOCIAL_EVENTS.reduce((sum, e) => sum + e.weight, 0);
    let r = Math.random() * totalWeight;
    for (const evt of SOCIAL_EVENTS) {
      r -= evt.weight;
      if (r <= 0) return evt;
    }
    return SOCIAL_EVENTS[0];
  }

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
        case STATE.SHELTER:
          updateShelter(ai, ent, tick);
          break;
        case STATE.IDLE:
          updateIdle(ai, ent, tick);
          break;
      }

      // Weather check: if raining/foggy and idle/walking, seek shelter (low chance per tick)
      if (tick % 120 === 0 && (ai.state === STATE.IDLE || ai.state === STATE.WALKING)) {
        checkWeatherShelter(ai, ent, tick);
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
      socialType: null,
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
    const off = _off();

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
      setWalkTarget(ai, off.col + p.col + 1, off.row + p.row + 0.3, 'watering');
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
    // Route through tool shed first (offset to world coords)
    routeViaShed(ai, off.col + chosen.col + offsetCol, off.row + chosen.row + offsetRow, action);
  }

  function assignTendTarget(ai, sessionId) {
    if (typeof IsoFarm === 'undefined') return;
    const pasture = IsoFarm.PASTURE_ZONE;
    if (!pasture) return;
    const off = _off();

    // Pick a random spot in the pasture zone (offset to world coords)
    const col = off.col + pasture.minCol + 1 + Math.random() * (pasture.maxCol - pasture.minCol - 2);
    const row = off.row + pasture.minRow + Math.random() * (pasture.maxRow - pasture.minRow);
    // Route through tool shed first
    routeViaShed(ai, col + (Math.random() - 0.5) * 0.4, row, 'feeding');
  }

  function assignHomeTarget(ai, sessionId) {
    const ent = getBuddyEntity(sessionId);
    if (!ent) return;
    // Home = initial spawn position (row 10 area, offset to world coords)
    if (ai.homeCol === 0 && ai.homeRow === 0) {
      ai.homeCol = ent.gridX;
      ai.homeRow = _off().row + 10;
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
    const off = _off();
    const shedX = off.col + TOOL_SHED_COL + 0.5 + (Math.random() - 0.5) * 0.6;
    const shedY = off.row + TOOL_SHED_ROW + 0.3;
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

    // Walking animation frame — speed proportional to movement
    // At WALK_SPEED 0.06, step ≈ 0.06 → ticksPerFrame ≈ 5
    const ticksPerFrame = Math.max(3, Math.round(0.3 / (step + 0.01)));
    ent.frame = ((tick / ticksPerFrame) | 0) % 4;

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
      // Clamp to home farm bounds (offset to world coords)
      const off = _off();
      const farmW = (typeof IsoFarm !== 'undefined' ? IsoFarm.MAP_W : 20);
      const farmH = (typeof IsoFarm !== 'undefined' ? IsoFarm.MAP_H : 18);
      const clampedCol = Math.max(off.col + 1, Math.min(wanderCol, off.col + farmW - 2));
      const clampedRow = Math.max(off.row + 1, Math.min(wanderRow, off.row + farmH - 2));
      setWalkTarget(ai, clampedCol, clampedRow, null);
    }
  }

  // ===== Weather shelter =====

  function checkWeatherShelter(ai, ent, tick) {
    if (typeof IsoWeather === 'undefined') return;
    const isRaining = IsoWeather.isRaining && IsoWeather.isRaining();
    const isFoggy = IsoWeather.isFoggy && IsoWeather.isFoggy();
    if (!isRaining && !isFoggy) return;

    // 30% chance to seek shelter per check (every 120 ticks ~ 2s)
    if (Math.random() > 0.3) return;

    // Find nearest shelter (offset to world coords)
    const off = _off();
    let nearestDist = Infinity;
    let nearestShelter = null;
    for (const s of SHELTER_POSITIONS) {
      const dx = (off.col + s.col) - ent.gridX;
      const dy = (off.row + s.row) - ent.gridY;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < nearestDist) {
        nearestDist = d;
        nearestShelter = s;
      }
    }
    if (!nearestShelter || nearestDist < 1.5) return; // already sheltered

    ai.state = STATE.SHELTER;
    ai.targetCol = off.col + nearestShelter.col + (Math.random() - 0.5) * 0.5;
    ai.targetRow = off.row + nearestShelter.row + (Math.random() - 0.5) * 0.3;
    ai.actionTimer = 600; // shelter for ~10 seconds

    // Rain emoji
    if (typeof IsoEffects !== 'undefined') {
      IsoEffects.spawnText(ent.gridX, ent.gridY - 0.6, '\u{2614}', { color: '#4FC3F7', life: 40, rise: 0.5 });
    }
  }

  function updateShelter(ai, ent, tick) {
    // Walk toward shelter
    const dx = ai.targetCol - ent.gridX;
    const dy = ai.targetRow - ent.gridY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 0.2) {
      // Still walking to shelter
      const step = Math.min(WALK_SPEED * 1.3, dist); // walk faster in rain
      ent.gridX += (dx / dist) * step;
      ent.gridY += (dy / dist) * step;
      if (Math.abs(dx) >= Math.abs(dy)) {
        ent.direction = dx > 0 ? 'right' : 'left';
      } else {
        ent.direction = dy > 0 ? 'down' : 'up';
      }
      const shelterTicksPerFrame = Math.max(3, Math.round(0.3 / (step + 0.01)));
      ent.frame = ((tick / shelterTicksPerFrame) | 0) % 4;
    } else {
      // Arrived at shelter — huddle animation
      ent.z = 0;
      ent.frame = 0;
      // Shivering bob
      if (tick % 30 === 0 && typeof IsoEffects !== 'undefined') {
        const weatherEmojis = ['\u{1F327}\u{FE0F}', '\u{2614}', '\u{1F4A8}', '\u{1F32C}\u{FE0F}'];
        IsoEffects.spawnText(ent.gridX, ent.gridY - 0.6,
          weatherEmojis[Math.floor(Math.random() * weatherEmojis.length)],
          { color: '#90CAF9', life: 30, rise: 0.4 });
      }
    }

    ai.actionTimer--;
    if (ai.actionTimer <= 0) {
      // Weather passed or done sheltering
      ai.state = STATE.IDLE;
      ai.idleTimer = 60;
      if (typeof Farm !== 'undefined' && Farm.logEvent) {
        Farm.logEvent('\u{2614}', `Buddy waited out the weather`);
      }
    }

    // Early exit if weather clears
    if (typeof IsoWeather !== 'undefined') {
      const stillBad = (IsoWeather.isRaining && IsoWeather.isRaining()) ||
                       (IsoWeather.isFoggy && IsoWeather.isFoggy());
      if (!stillBad) {
        ai.state = STATE.IDLE;
        ai.idleTimer = 30;
      }
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

        // Pick social event type
        const socialEvent = pickSocialEvent();
        socialCooldowns.set(pairKey, tick);

        // Get context-aware emojis or fallback to CHAT_EMOJIS
        const contextEmojis = getContextEmojis(tick);
        const emojis = contextEmojis || CHAT_EMOJIS[Math.floor(Math.random() * CHAT_EMOJIS.length)];

        // Save current state so we can resume after
        aiA.preSocialState = aiA.state;
        aiA.preSocialAction = aiA.action;
        aiB.preSocialState = aiB.state;
        aiB.preSocialAction = aiB.action;

        aiA.state = STATE.SOCIAL;
        aiA.actionTimer = socialEvent.duration;
        aiA.socialPartner = idB;
        aiA.socialEmoji = emojis[0];
        aiA.socialType = socialEvent.type;

        aiB.state = STATE.SOCIAL;
        aiB.actionTimer = socialEvent.duration;
        aiB.socialPartner = idA;
        aiB.socialEmoji = emojis[1];
        aiB.socialType = socialEvent.type;

        // Face each other
        entA.direction = dx > 0 ? 'left' : 'right';
        entB.direction = dx > 0 ? 'right' : 'left';

        // Initial effect based on event type
        if (typeof IsoEngine !== 'undefined') {
          const midX = (entA.gridX + entB.gridX) / 2;
          const midY = (entA.gridY + entB.gridY) / 2;
          if (socialEvent.type === 'dance') {
            IsoEngine.spawnHarvestParticles(midX, midY, '#FF69B4', 6);
          } else if (socialEvent.type === 'highfive') {
            IsoEngine.spawnHarvestParticles(midX, midY, '#FFD700', 8);
          } else {
            IsoEngine.spawnHarvestParticles(midX, midY, '#FFD700', 4);
          }
        }
        break; // one social event per tick is enough
      }
    }
  }

  function updateSocial(ai, ent, tick) {
    ai.actionTimer--;
    const socialType = ai.socialType || 'chat';
    const totalDuration = (SOCIAL_EVENTS.find(e => e.type === socialType) || SOCIAL_EVENTS[0]).duration;

    if (socialType === 'dance') {
      // Dance: bouncy movement with spin
      ent.z = Math.abs(Math.sin(tick * 0.25 + ai.bobPhase)) * 2;
      ent.frame = ((tick / 6) | 0) % 4;
      // Music note particles
      if (tick % 20 === 0 && typeof IsoEffects !== 'undefined') {
        const notes = ['\u{1F3B5}', '\u{1F3B6}', '\u{266A}'];
        IsoEffects.spawnText(ent.gridX + (Math.random() - 0.5) * 0.4,
          ent.gridY - 0.8, notes[Math.floor(Math.random() * notes.length)],
          { color: '#FF69B4', life: 35, rise: 0.8 });
      }
    } else if (socialType === 'slack') {
      // Slack: sit still, occasional ZZZ
      ent.z = -1; // crouching
      ent.frame = 0;
      if (tick % 40 === 0 && typeof IsoEffects !== 'undefined') {
        IsoEffects.spawnText(ent.gridX, ent.gridY - 0.6, '\u{1F4A4}',
          { color: '#90CAF9', life: 30, rise: 0.4 });
      }
    } else if (socialType === 'highfive') {
      // High five: quick approach + burst
      const progress = 1 - ai.actionTimer / totalDuration;
      if (progress < 0.5) {
        ent.z = progress * 3; // raise hand
      } else {
        ent.z = (1 - progress) * 3; // lower
      }
      ent.frame = progress < 0.5 ? 1 : 0;
      // Impact sparkles at midpoint
      if (ai.actionTimer === Math.floor(totalDuration / 2) && typeof IsoEffects !== 'undefined') {
        IsoEffects.spawnText(ent.gridX, ent.gridY - 0.8, '\u{1F91A}\u{2728}',
          { color: '#FFD700', life: 40, rise: 0.8 });
      }
    } else {
      // Chat: gentle bob (original behavior)
      ent.z = Math.sin(tick * 0.2 + ai.bobPhase) * 0.5;
      ent.frame = 0;
    }

    // Show emoji bubble at start and midpoint
    if ((ai.actionTimer === totalDuration - 1 || ai.actionTimer === Math.floor(totalDuration / 2))
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
          if (!partnerEnt.name || ent.name <= partnerEnt.name) {
            const evt = SOCIAL_EVENTS.find(e => e.type === socialType);
            Farm.logEvent(socialType === 'dance' ? '\u{1F57A}' : '\u{1F4AC}', evt ? evt.log : 'Buddies interacted');
          }
        }
      }

      // Resume — go back to idle
      ai.socialPartner = null;
      ai.socialEmoji = null;
      ai.socialType = null;
      ai.state = STATE.IDLE;
      ai.idleTimer = 30;
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
    addContext,
  };
})();
