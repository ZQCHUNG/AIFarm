/**
 * npc-manager.js — Historical Session NPCs for AIFarm 3.0.
 *
 * Converts past Claude Code sessions into NPC characters that wander
 * the village. Longer sessions = older/wiser NPCs.
 *
 * Evolution tiers (based on session duration):
 *   < 30 min   → Newbie (bright color, bouncy, fast walk)
 *   30m - 2hr  → Veteran (calm, glasses accessory, moderate speed)
 *   > 2hr      → Sage (white/gray, glow effect, slow walk, beard)
 */

const NPCManager = (() => {
  const MAX_NPCS = 8; // Max visible NPCs at once

  // Evolution tier thresholds (in milliseconds)
  const TIER_VETERAN = 30 * 60 * 1000;   // 30 minutes
  const TIER_SAGE    = 2 * 60 * 60 * 1000; // 2 hours

  // NPC wander zone (village/path area)
  const WANDER_ZONE = { minCol: 0, maxCol: 18, minRow: 10, maxRow: 16 };

  // NPC registry
  let npcs = []; // { id, profile, entity, ai }
  let initialized = false;
  let sessionHistory = [];

  // Tier definitions
  const TIERS = {
    newbie:  { speed: 0.025, restChance: 0.005, wanderRange: 4, label: 'Newbie' },
    veteran: { speed: 0.015, restChance: 0.01,  wanderRange: 5, label: 'Veteran' },
    sage:    { speed: 0.008, restChance: 0.02,  wanderRange: 3, label: 'Sage' },
  };

  // Hoodie colors for NPCs (muted versions)
  const NPC_COLORS = [
    '#6B8EB0', // muted blue
    '#B06B6B', // muted red
    '#6BB07A', // muted green
    '#8B6BB0', // muted purple
    '#B09B6B', // muted orange
    '#6BA8A0', // muted teal
    '#B08BAB', // muted pink
    '#A8A86B', // muted yellow
  ];

  /** Determine evolution tier from session duration. */
  function getTier(duration) {
    if (duration >= TIER_SAGE) return 'sage';
    if (duration >= TIER_VETERAN) return 'veteran';
    return 'newbie';
  }

  /** Convert session data to NPC profile. */
  function sessionToProfile(session) {
    const tier = getTier(session.duration || 0);
    const tierDef = TIERS[tier];
    const durationMin = Math.round((session.duration || 0) / 60000);
    const durationStr = durationMin >= 60
      ? `${Math.floor(durationMin / 60)}h ${durationMin % 60}m`
      : `${durationMin}m`;

    return {
      id: session.id,
      project: session.project || 'Unknown',
      tier,
      tierDef,
      colorIndex: session.colorIndex || 0,
      duration: session.duration || 0,
      durationStr,
      startTime: session.startTime,
      endTime: session.endTime,
      // Visual modifiers
      hasGlasses: tier === 'veteran',
      hasBeard: tier === 'sage',
      hasGlow: tier === 'sage',
      walkSpeed: tierDef.speed,
    };
  }

  /** Select which sessions become visible NPCs (most interesting mix). */
  function selectNPCs(history) {
    if (history.length <= MAX_NPCS) return history;
    // Prioritize: 1 sage (if any), then most recent, diverse tiers
    const sorted = [...history].sort((a, b) => (b.duration || 0) - (a.duration || 0));
    const sages = sorted.filter(s => getTier(s.duration) === 'sage').slice(0, 2);
    const veterans = sorted.filter(s => getTier(s.duration) === 'veteran').slice(0, 3);
    const newbies = sorted.filter(s => getTier(s.duration) === 'newbie').slice(0, 3);
    const selected = new Map();
    for (const s of [...sages, ...veterans, ...newbies]) {
      if (selected.size >= MAX_NPCS) break;
      selected.set(s.id, s);
    }
    // Fill remaining from most recent
    const recent = [...history].sort((a, b) => (b.endTime || 0) - (a.endTime || 0));
    for (const s of recent) {
      if (selected.size >= MAX_NPCS) break;
      selected.set(s.id, s);
    }
    return [...selected.values()];
  }

  // ===== NPC AI state machine =====
  const AI_STATE = { IDLE: 0, WALKING: 1, RESTING: 2 };

  function createAI(profile) {
    const zone = WANDER_ZONE;
    return {
      state: AI_STATE.IDLE,
      col: zone.minCol + Math.random() * (zone.maxCol - zone.minCol),
      row: zone.minRow + Math.random() * (zone.maxRow - zone.minRow),
      targetCol: 0,
      targetRow: 0,
      dir: 0, // 0=down, 1=left, 2=right, 3=up
      frame: 0,
      frameTick: 0,
      restTimer: 0,
      idleTimer: Math.random() * 120, // stagger initial idle
    };
  }

  function updateAI(npc, tick) {
    const ai = npc.ai;
    const prof = npc.profile;
    const zone = WANDER_ZONE;

    switch (ai.state) {
      case AI_STATE.IDLE:
        ai.idleTimer--;
        if (ai.idleTimer <= 0) {
          // Pick random target within wander range
          const range = prof.tierDef.wanderRange;
          ai.targetCol = Math.max(zone.minCol, Math.min(zone.maxCol,
            ai.col + (Math.random() - 0.5) * range * 2));
          ai.targetRow = Math.max(zone.minRow, Math.min(zone.maxRow,
            ai.row + (Math.random() - 0.5) * range * 2));
          ai.state = AI_STATE.WALKING;
        }
        break;

      case AI_STATE.WALKING: {
        const dx = ai.targetCol - ai.col;
        const dy = ai.targetRow - ai.row;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 0.1) {
          // Reached target — rest or idle
          ai.state = Math.random() < prof.tierDef.restChance * 10 ? AI_STATE.RESTING : AI_STATE.IDLE;
          ai.restTimer = 120 + Math.random() * 180;
          ai.idleTimer = 60 + Math.random() * 120;
          ai.frame = 0;
          break;
        }

        // Move toward target
        const speed = prof.walkSpeed;
        const nx = dx / dist;
        const ny = dy / dist;
        ai.col += nx * speed;
        ai.row += ny * speed;

        // Direction
        if (Math.abs(dx) > Math.abs(dy)) {
          ai.dir = dx < 0 ? 1 : 2;
        } else {
          ai.dir = dy < 0 ? 3 : 0;
        }

        // Walk animation
        ai.frameTick++;
        if (ai.frameTick >= (prof.tier === 'sage' ? 12 : 8)) {
          ai.frameTick = 0;
          ai.frame = (ai.frame + 1) % 3;
        }
        break;
      }

      case AI_STATE.RESTING:
        ai.restTimer--;
        ai.frame = 0;
        if (ai.restTimer <= 0) {
          ai.state = AI_STATE.IDLE;
          ai.idleTimer = 60 + Math.random() * 120;
        }
        break;
    }
  }

  // ===== Entity creation =====

  const DIR_NAMES = ['down', 'left', 'right', 'up'];

  function createNPCEntity(npc) {
    if (typeof IsoEntityManager === 'undefined') return null;

    const prof = npc.profile;
    const ai = npc.ai;

    return IsoEntityManager.add(IsoEntityManager.createStatic(
      Math.floor(ai.col), Math.floor(ai.row),
      (ctx, sx, sy, tick) => drawNPC(ctx, sx, sy, tick, npc),
      { z: 0 }
    ));
  }

  /** Draw NPC character with tier-specific visual modifiers. */
  function drawNPC(ctx, sx, sy, tick, npc) {
    const prof = npc.profile;
    const ai = npc.ai;
    const dir = DIR_NAMES[ai.dir] || 'down';
    const color = NPC_COLORS[prof.colorIndex % NPC_COLORS.length];

    // Sage glow effect
    if (prof.hasGlow) {
      ctx.save();
      ctx.globalAlpha = 0.2 + Math.sin(tick * 0.04) * 0.1;
      const glow = ctx.createRadialGradient(sx, sy - 8, 2, sx, sy - 8, 16);
      glow.addColorStop(0, '#FFD700');
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.fillRect(sx - 16, sy - 24, 32, 32);
      ctx.restore();
    }

    // Use IsoEngine's character drawing if available
    if (typeof IsoEngine !== 'undefined' && IsoEngine.drawIsoCharacter) {
      const drawColor = prof.tier === 'sage' ? '#C8C8C8' : color;
      IsoEngine.drawIsoCharacter(ctx, sx, sy, dir, ai.frame, drawColor, tick);
    }

    // Glasses (veteran)
    if (prof.hasGlasses) {
      ctx.fillStyle = '#333';
      ctx.fillRect(sx - 4, sy - 14, 3, 2);
      ctx.fillRect(sx + 1, sy - 14, 3, 2);
      ctx.fillRect(sx - 1, sy - 14, 2, 1); // bridge
    }

    // Beard (sage)
    if (prof.hasBeard) {
      ctx.fillStyle = '#DDD';
      ctx.beginPath();
      ctx.moveTo(sx - 3, sy - 8);
      ctx.lineTo(sx + 3, sy - 8);
      ctx.lineTo(sx + 2, sy - 4);
      ctx.lineTo(sx, sy - 2);
      ctx.lineTo(sx - 2, sy - 4);
      ctx.closePath();
      ctx.fill();
    }

    // Tier badge (small colored dot above head)
    const badgeColors = { newbie: '#5BEF5B', veteran: '#5B9BEF', sage: '#FFD700' };
    ctx.fillStyle = badgeColors[prof.tier] || '#FFF';
    ctx.beginPath();
    ctx.arc(sx, sy - 22, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // ===== Click detection for NPC info =====
  let hoveredNPC = null;
  let showingInfo = null; // { npc, startTick }

  function checkHover(col, row) {
    hoveredNPC = null;
    for (const npc of npcs) {
      const dx = Math.abs(col - npc.ai.col);
      const dy = Math.abs(row - npc.ai.row);
      if (dx < 1 && dy < 1) {
        hoveredNPC = npc;
        return true;
      }
    }
    return false;
  }

  function handleClick(col, row, tick) {
    for (const npc of npcs) {
      const dx = Math.abs(col - npc.ai.col);
      const dy = Math.abs(row - npc.ai.row);
      if (dx < 1 && dy < 1) {
        showingInfo = { npc, startTick: tick };
        return true;
      }
    }
    showingInfo = null;
    return false;
  }

  /** Draw NPC info popup when clicked. */
  function drawInfoPopup(ctx, canvasW, canvasH, tick) {
    if (!showingInfo) return;

    const elapsed = tick - showingInfo.startTick;
    if (elapsed > 300) { showingInfo = null; return; } // Auto-dismiss after 5s

    const npc = showingInfo.npc;
    const prof = npc.profile;
    const alpha = elapsed < 15 ? elapsed / 15 : (elapsed > 270 ? (300 - elapsed) / 30 : 1);

    ctx.save();
    ctx.globalAlpha = alpha;

    // Popup background
    const pw = 140;
    const ph = 52;
    const px = (canvasW - pw) / 2;
    const py = canvasH - 80;

    ctx.fillStyle = 'rgba(20, 20, 40, 0.85)';
    ctx.beginPath();
    ctx.moveTo(px + 4, py);
    ctx.arcTo(px + pw, py, px + pw, py + ph, 4);
    ctx.arcTo(px + pw, py + ph, px, py + ph, 4);
    ctx.arcTo(px, py + ph, px, py, 4);
    ctx.arcTo(px, py, px + pw, py, 4);
    ctx.fill();

    // Border
    const borderColor = { newbie: '#5BEF5B', veteran: '#5B9BEF', sage: '#FFD700' };
    ctx.strokeStyle = borderColor[prof.tier] || '#FFF';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px + 4, py);
    ctx.arcTo(px + pw, py, px + pw, py + ph, 4);
    ctx.arcTo(px + pw, py + ph, px, py + ph, 4);
    ctx.arcTo(px, py + ph, px, py, 4);
    ctx.arcTo(px, py, px + pw, py, 4);
    ctx.stroke();

    // Tier label
    ctx.fillStyle = borderColor[prof.tier] || '#FFF';
    ctx.font = 'bold 7px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(prof.tierDef.label.toUpperCase(), px + 6, py + 4);

    // Project name
    ctx.fillStyle = '#FFF';
    ctx.font = '8px monospace';
    const projText = prof.project.length > 18 ? prof.project.slice(0, 17) + '..' : prof.project;
    ctx.fillText(projText, px + 6, py + 16);

    // Duration
    ctx.fillStyle = '#AAA';
    ctx.font = '7px monospace';
    ctx.fillText('Session: ' + prof.durationStr, px + 6, py + 28);

    // Date
    const dateStr = prof.endTime ? new Date(prof.endTime).toLocaleDateString() : '';
    ctx.fillText(dateStr, px + 6, py + 38);

    ctx.restore();
  }

  // ===== Public API =====

  function init(history) {
    if (!history || history.length === 0) return;
    // Only re-init if history changed
    const histHash = history.map(h => h.id).join(',');
    const prevHash = sessionHistory.map(h => h.id).join(',');
    if (histHash === prevHash && initialized) return;

    sessionHistory = history;
    initialized = true;

    // Remove old entities
    for (const npc of npcs) {
      if (npc.entity && typeof IsoEntityManager !== 'undefined') {
        IsoEntityManager.remove(npc.entity);
      }
    }
    npcs = [];

    // Select and create NPCs
    const selected = selectNPCs(history);
    for (const session of selected) {
      const profile = sessionToProfile(session);
      const ai = createAI(profile);
      const npc = { id: session.id, profile, ai, entity: null };
      npc.entity = createNPCEntity(npc);
      npcs.push(npc);
    }

    console.log(`[NPCManager] Initialized ${npcs.length} NPCs from ${history.length} sessions`);
  }

  function update(tick) {
    for (const npc of npcs) {
      updateAI(npc, tick);
      // Sync entity position
      if (npc.entity) {
        npc.entity.col = npc.ai.col;
        npc.entity.row = npc.ai.row;
      }
    }
  }

  function draw(ctx, canvasW, canvasH, tick) {
    drawInfoPopup(ctx, canvasW, canvasH, tick);
  }

  function getNPCCount() { return npcs.length; }
  function getNPCs() { return npcs; }

  return {
    init,
    update,
    draw,
    checkHover,
    handleClick,
    getNPCCount,
    getNPCs,
    getTier,
  };
})();

if (typeof module !== 'undefined') module.exports = NPCManager;
