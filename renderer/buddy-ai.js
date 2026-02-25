// BuddyAI — controls buddy movement and farming/tending actions.
// When a Claude Code session is active, the buddy walks to crop plots
// or animal pastures and performs work animations.
const BuddyAI = (() => {
  // States
  const STATE = {
    IDLE: 'idle',
    WALKING: 'walking',
    FARMING: 'farming',   // watering/hoeing at crop plot
    TENDING: 'tending',   // feeding animals in pasture
  };

  // Movement speed (grid units per tick)
  const WALK_SPEED = 0.06;
  // Action duration (ticks)
  const FARM_DURATION = 120;   // ~2 seconds at 60fps
  const TEND_DURATION = 100;
  const IDLE_LINGER = 180;     // stay idle before picking next task

  // Per-buddy AI state (keyed by sessionId)
  const buddyAI = new Map();

  // Track which plots are currently targeted (avoid crowding)
  const claimedPlots = new Set();

  // ===== Public API =====

  function onActivity(sessionId, eventType) {
    let ai = buddyAI.get(sessionId);
    if (!ai) {
      ai = createAI(sessionId);
      buddyAI.set(sessionId, ai);
    }

    // Action locking: ignore new events during walking or active animation
    if (ai.state === STATE.FARMING || ai.state === STATE.TENDING || ai.state === STATE.WALKING) return;

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
      if (ai.state === STATE.FARMING || ai.state === STATE.TENDING) return;
      assignHomeTarget(ai, sessionId);
    }
  }

  function update(tick) {
    for (const [sessionId, ai] of buddyAI) {
      const ent = getBuddyEntity(sessionId);
      if (!ent) continue;

      switch (ai.state) {
        case STATE.WALKING:
          updateWalking(ai, ent, tick);
          break;
        case STATE.FARMING:
          updateFarming(ai, ent, tick);
          break;
        case STATE.TENDING:
          updateTending(ai, ent, tick);
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
      action: null,         // 'watering' | 'feeding' | null
      actionTimer: 0,
      idleTimer: 0,
      homeCol: 0,
      homeRow: 0,
      claimedPlotKey: null, // 'col,row' of claimed plot
      bobPhase: Math.random() * Math.PI * 2, // per-buddy bob offset
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
      // All plots occupied — just pick random
      const p = plots[Math.floor(Math.random() * plots.length)];
      setWalkTarget(ai, p.col + 1, p.row + 0.3, 'watering');
      return;
    }

    const chosen = available[Math.floor(Math.random() * available.length)];
    // Release previous claim
    if (ai.claimedPlotKey) claimedPlots.delete(ai.claimedPlotKey);
    const key = `${chosen.col},${chosen.row}`;
    claimedPlots.add(key);
    ai.claimedPlotKey = key;

    // Target: center of plot, slightly in front (+0.3 row for Z-sorting)
    const offsetCol = (chosen.width || 1) * 0.5 + (Math.random() - 0.5) * 0.4;
    const offsetRow = 0.3 + Math.random() * 0.2; // CTO: +0.1 minimum for Z-sort
    setWalkTarget(ai, chosen.col + offsetCol, chosen.row + offsetRow, 'watering');
  }

  function assignTendTarget(ai, sessionId) {
    if (typeof IsoFarm === 'undefined') return;
    const pasture = IsoFarm.PASTURE_ZONE;
    if (!pasture) return;

    // Pick a random spot in the pasture zone
    const col = pasture.minCol + 1 + Math.random() * (pasture.maxCol - pasture.minCol - 2);
    const row = pasture.minRow + Math.random() * (pasture.maxRow - pasture.minRow);
    // CTO: ±0.2 random offset to avoid overlapping
    setWalkTarget(ai, col + (Math.random() - 0.5) * 0.4, row, 'feeding');
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

  // ===== Update functions =====

  function updateWalking(ai, ent, tick) {
    const dx = ai.targetCol - ent.gridX;
    const dy = ai.targetRow - ent.gridY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 0.2) {
      // Arrived at target
      ent.gridX = ai.targetCol;
      ent.gridY = ai.targetRow;
      if (ai.action === 'watering') {
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

  // ===== Effects =====

  function spawnActionEffect(ent, type) {
    if (typeof IsoEffects !== 'undefined') {
      if (type === 'water') {
        IsoEffects.spawnText(ent.gridX, ent.gridY - 0.6, '\u{1F4A6}', { color: '#4FC3F7', life: 50, rise: 0.9 });
      } else if (type === 'feed') {
        IsoEffects.spawnText(ent.gridX, ent.gridY - 0.6, '\u{1F331}', { color: '#8BC34A', life: 50, rise: 0.9 });
      }
    }
    if (typeof IsoEngine !== 'undefined') {
      const color = type === 'water' ? '#4FC3F7' : '#FFD54F';
      IsoEngine.spawnHarvestParticles(ent.gridX, ent.gridY, color, 8);
      // Extra burst to make arrival visible
      IsoEngine.spawnHarvestParticles(ent.gridX, ent.gridY, '#FFFFFF', 3);
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
