/**
 * quest-board.js — NPC Request Board for AIFarm 3.0 (Sprint 21 P1).
 *
 * A bulletin board in the village center where NPCs post requests (orders).
 * Players complete orders by having the required resources, then turn them in
 * for GOLD + rare rewards (speed potions, expansion permits, etc.).
 *
 * Features:
 *   - 3 active quests at a time, refreshed when completed
 *   - NPC portraits and themed requests based on tier
 *   - Resource requirements scaled by NPC tier (sage → harder quests → better rewards)
 *   - Press [Q] near the board to open the quest panel
 *   - Auto-complete check when resources change
 */

const QuestBoard = (() => {
  // ===== Configuration =====

  const MAX_ACTIVE_QUESTS = 3;
  const BOARD_COL = 7;   // Center path in village
  const BOARD_ROW = 10;
  const INTERACT_RANGE = 2;

  // Quest templates by tier
  const QUEST_TEMPLATES = {
    newbie: [
      { name: 'Snack Time',        required: { carrot: 3 },      gold: 15, desc: 'Bring me some carrots!' },
      { name: 'Flower Bouquet',    required: { sunflower: 2 },   gold: 20, desc: 'I need sunflowers.' },
      { name: 'Basic Supplies',    required: { wood: 5 },        gold: 12, desc: 'Need wood for repairs.' },
      { name: 'Stone Collection',  required: { stone: 4 },       gold: 14, desc: 'Gathering building stones.' },
    ],
    veteran: [
      { name: 'Summer Feast',      required: { watermelon: 2, tomato: 3 }, gold: 40, desc: 'Planning a big feast!' },
      { name: 'Harvest Bundle',    required: { corn: 3, pumpkin: 2 },      gold: 45, desc: 'Autumn harvest order.' },
      { name: 'Builder Kit',       required: { wood: 8, stone: 6 },        gold: 35, desc: 'New construction project.' },
      { name: 'Crop Sampler',      required: { carrot: 2, sunflower: 2, tomato: 2 }, gold: 38, desc: 'One of each, please!' },
      { name: 'Farm Expansion',    required: { wood: 10, gold: 20 },       gold: 50, desc: 'Help me expand my farm.' },
    ],
    sage: [
      { name: 'Grand Banquet',     required: { watermelon: 3, pumpkin: 3, corn: 4 }, gold: 80, bonus: 'speed_potion', desc: 'A legendary feast awaits.' },
      { name: 'Master Builder',    required: { wood: 15, stone: 12 },                gold: 70, bonus: 'field_permit', desc: 'Building a monument.' },
      { name: 'Full Harvest',      required: { carrot: 4, sunflower: 3, tomato: 3, corn: 3 }, gold: 90, bonus: 'speed_potion', desc: 'I need everything!' },
      { name: 'Ancient Research',  required: { stone: 15, gold: 30 },                gold: 100, bonus: 'field_permit', desc: 'Rare materials for study.' },
    ],
  };

  // ===== State =====

  let activeQuests = [];  // { id, template, npcProfile, accepted, completed }
  let questIdCounter = 0;
  let modalOpen = false;
  let selectedIndex = 0;
  let playerNearBoard = false;
  let completionFlash = null;  // { questId, startTick }
  let totalCompleted = 0;

  // ===== Initialization =====

  function init() {
    setupListeners();
    // Generate initial quests
    if (activeQuests.length === 0) {
      refreshQuests();
    }
  }

  function setupListeners() {
    if (typeof EventBus === 'undefined') return;

    // Auto-check quest completion when resources change
    EventBus.on('RESOURCE_CHANGED', () => {
      checkCompletions();
    });
  }

  function refreshQuests() {
    // Fill up to MAX_ACTIVE_QUESTS
    while (activeQuests.length < MAX_ACTIVE_QUESTS) {
      const quest = generateQuest();
      if (quest) activeQuests.push(quest);
      else break;
    }
  }

  function generateQuest() {
    // Pick a random NPC tier (weighted: more newbie quests, fewer sage)
    const tierRoll = Math.random();
    let tier;
    if (tierRoll < 0.45) tier = 'newbie';
    else if (tierRoll < 0.85) tier = 'veteran';
    else tier = 'sage';

    const templates = QUEST_TEMPLATES[tier];
    if (!templates || templates.length === 0) return null;
    const template = templates[Math.floor(Math.random() * templates.length)];

    // Get an NPC profile for display (use NPC manager if available)
    let npcName = 'Villager';
    let npcColor = '#6B8EB0';
    if (typeof NPCManager !== 'undefined' && NPCManager.getNPCs) {
      const npcs = NPCManager.getNPCs();
      const tierNpcs = npcs.filter(n => n.profile && n.profile.tier === tier);
      if (tierNpcs.length > 0) {
        const npc = tierNpcs[Math.floor(Math.random() * tierNpcs.length)];
        npcName = npc.profile.project || 'Villager';
        npcColor = npc.profile.color || npcColor;
      }
    }

    questIdCounter++;
    return {
      id: questIdCounter,
      template,
      tier,
      npcName,
      npcColor,
      accepted: true, // auto-accepted for simplicity
      completed: false,
    };
  }

  // ===== Completion check =====

  function checkCompletions() {
    if (typeof ResourceInventory === 'undefined') return;

    for (const quest of activeQuests) {
      if (quest.completed) continue;
      let canComplete = true;
      for (const [res, amount] of Object.entries(quest.template.required)) {
        if (!ResourceInventory.has(res, amount)) {
          canComplete = false;
          break;
        }
      }
      quest.canComplete = canComplete;
    }
  }

  function completeQuest(index, tick) {
    const quest = activeQuests[index];
    if (!quest || quest.completed) return false;
    if (typeof ResourceInventory === 'undefined') return false;

    // Check resources again
    for (const [res, amount] of Object.entries(quest.template.required)) {
      if (!ResourceInventory.has(res, amount)) return false;
    }

    // Deduct resources
    for (const [res, amount] of Object.entries(quest.template.required)) {
      ResourceInventory.spend(res, amount);
    }

    // Award gold
    ResourceInventory.add('gold', quest.template.gold);

    // Award bonus item
    if (quest.template.bonus && typeof EventBus !== 'undefined') {
      EventBus.emit('SHOP_PURCHASE', { item: quest.template.bonus, free: true });
    }

    quest.completed = true;
    completionFlash = { questId: quest.id, startTick: tick };
    totalCompleted++;

    // Log
    if (typeof Farm !== 'undefined' && Farm.logEvent) {
      Farm.logEvent('\u{2705}', `Quest "${quest.template.name}" completed! +${quest.template.gold}g`);
    }

    if (typeof EventBus !== 'undefined') {
      EventBus.emit('QUEST_COMPLETED', { quest: quest.template.name, gold: quest.template.gold });
    }

    // Replace completed quest after short delay
    setTimeout(() => {
      activeQuests = activeQuests.filter(q => q.id !== quest.id);
      refreshQuests();
    }, 1000);

    return true;
  }

  // ===== Proximity =====

  function updateProximity() {
    if (typeof Player === 'undefined') { playerNearBoard = false; return; }
    const pt = Player.getTile();
    const off = (typeof IsoEngine !== 'undefined' && IsoEngine.getHomeOffset) ? IsoEngine.getHomeOffset() : { col: 0, row: 0 };
    const dx = Math.abs(pt.col - (BOARD_COL + off.col));
    const dy = Math.abs(pt.row - (BOARD_ROW + off.row));
    playerNearBoard = dx <= INTERACT_RANGE && dy <= INTERACT_RANGE;
  }

  function isNearBoard() { return playerNearBoard; }
  function isOpen() { return modalOpen; }

  function open() {
    if (modalOpen) return;
    modalOpen = true;
    selectedIndex = 0;
    checkCompletions();
  }

  function close() {
    modalOpen = false;
  }

  function toggle() {
    if (modalOpen) close();
    else open();
  }

  // ===== Input =====

  function handleKey(key, tick) {
    if (!modalOpen) return false;

    if (key === 'Escape' || key === 'q' || key === 'Q') {
      close();
      return true;
    }
    if (key === 'ArrowUp' || key === 'w' || key === 'W') {
      selectedIndex = Math.max(0, selectedIndex - 1);
      return true;
    }
    if (key === 'ArrowDown' || key === 's' || key === 'S') {
      selectedIndex = Math.min(activeQuests.length - 1, selectedIndex + 1);
      return true;
    }
    if (key === 'Enter' || key === ' ') {
      completeQuest(selectedIndex, tick);
      return true;
    }
    return false;
  }

  // ===== Update =====

  function update(tick) {
    updateProximity();
  }

  // ===== Drawing =====

  function draw(ctx, canvasW, canvasH, tick) {
    if (modalOpen) {
      drawModal(ctx, canvasW, canvasH, tick);
    }
  }

  function drawPrompt(ctx, canvasW, canvasH) {
    if (!playerNearBoard || modalOpen) return;
    // Check for any open modals
    if (typeof ShopUI !== 'undefined' && ShopUI.isOpen()) return;
    if (typeof IsoUI !== 'undefined' && IsoUI.isOpen()) return;
    if (typeof CollectionUI !== 'undefined' && CollectionUI.isOpen()) return;

    const text = 'Press [Q] for Quests';
    ctx.font = 'bold 9px monospace';
    const tw = ctx.measureText(text).width;
    const px = (canvasW - tw) / 2 - 8;
    const py = canvasH - 60;
    ctx.fillStyle = 'rgba(20, 20, 40, 0.8)';
    roundRect(ctx, px, py, tw + 16, 18, 4);
    ctx.fill();
    ctx.fillStyle = '#FFD700';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(text, canvasW / 2, py + 9);
  }

  function drawModal(ctx, canvasW, canvasH, tick) {
    const MARGIN = 10;
    const pw = Math.min(280, canvasW - 40);
    const ph = Math.min(220, canvasH - 40);
    const px = (canvasW - pw) / 2;
    const py = (canvasH - ph) / 2;

    // Backdrop
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Panel
    ctx.fillStyle = 'rgba(40, 30, 20, 0.95)';
    roundRect(ctx, px, py, pw, ph, 6);
    ctx.fill();

    // Border
    ctx.strokeStyle = '#DAA520';
    ctx.lineWidth = 2;
    roundRect(ctx, px, py, pw, ph, 6);
    ctx.stroke();

    // Title
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 11px monospace';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    ctx.fillText('\u{1F4CB} Quest Board', px + pw / 2, py + MARGIN);

    // Subtitle
    ctx.fillStyle = '#CCA050';
    ctx.font = '7px monospace';
    ctx.fillText(`Completed: ${totalCompleted}`, px + pw / 2, py + MARGIN + 14);

    // Quest list
    const LEFT = px + MARGIN;
    let y = py + MARGIN + 28;
    ctx.textAlign = 'left';
    const itemH = 55;

    for (let i = 0; i < activeQuests.length; i++) {
      const quest = activeQuests[i];
      const iy = y + i * itemH;
      const selected = i === selectedIndex;
      const canComplete = quest.canComplete;

      // Selection highlight
      if (selected) {
        ctx.fillStyle = 'rgba(255, 215, 0, 0.15)';
        roundRect(ctx, LEFT, iy - 2, pw - MARGIN * 2, itemH - 4, 3);
        ctx.fill();
        ctx.fillStyle = '#FFD700';
        ctx.font = '8px monospace';
        ctx.fillText('\u25B6', LEFT + 2, iy + 8);
      }

      // Completion flash
      if (completionFlash && completionFlash.questId === quest.id) {
        const elapsed = tick - completionFlash.startTick;
        if (elapsed < 30) {
          ctx.fillStyle = `rgba(76, 175, 80, ${0.4 * (1 - elapsed / 30)})`;
          roundRect(ctx, LEFT, iy - 2, pw - MARGIN * 2, itemH - 4, 3);
          ctx.fill();
        }
      }

      // Tier badge
      const tierEmoji = { newbie: '\u{1F31F}', veteran: '\u{1F393}', sage: '\u{1F9D9}' };
      ctx.font = '9px monospace';
      ctx.fillStyle = '#FFF';
      ctx.fillText((tierEmoji[quest.tier] || '') + ' ' + quest.template.name, LEFT + 12, iy + 8);

      // NPC name
      ctx.font = '7px monospace';
      ctx.fillStyle = '#AAA';
      ctx.fillText('from: ' + quest.npcName, LEFT + 12, iy + 18);

      // Requirements
      ctx.font = '7px monospace';
      const reqParts = [];
      for (const [res, amount] of Object.entries(quest.template.required)) {
        const has = (typeof ResourceInventory !== 'undefined') ? ResourceInventory.get(res) : 0;
        const color = has >= amount ? '#4CAF50' : '#E57373';
        reqParts.push({ text: `${res}:${has}/${amount}`, color });
      }

      let rx = LEFT + 12;
      for (const part of reqParts) {
        ctx.fillStyle = part.color;
        ctx.fillText(part.text, rx, iy + 28);
        rx += ctx.measureText(part.text).width + 8;
      }

      // Reward
      ctx.fillStyle = '#DAA520';
      ctx.textAlign = 'right';
      ctx.fillText('+' + quest.template.gold + 'g' + (quest.template.bonus ? ' +\u{1F381}' : ''), LEFT + pw - MARGIN * 2 - 4, iy + 8);
      ctx.textAlign = 'left';

      // Complete button hint (when selected and completable)
      if (selected && canComplete) {
        ctx.fillStyle = '#4CAF50';
        ctx.font = 'bold 7px monospace';
        ctx.fillText('[Enter] Turn In', LEFT + 12, iy + 40);
      } else if (selected && !canComplete) {
        ctx.fillStyle = '#888';
        ctx.font = '7px monospace';
        ctx.fillText('Not enough resources', LEFT + 12, iy + 40);
      }
    }

    if (activeQuests.length === 0) {
      ctx.fillStyle = '#888';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No quests available', px + pw / 2, py + ph / 2);
    }

    // Controls
    ctx.textAlign = 'center';
    ctx.font = '7px monospace';
    ctx.fillStyle = '#AAA';
    ctx.fillText('[W/S] Select  [Enter] Turn In  [Q] Close', px + pw / 2, py + ph - MARGIN - 2);
  }

  // Helper
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // ===== State persistence =====

  function getState() {
    return {
      activeQuests: activeQuests.map(q => ({
        id: q.id,
        template: q.template,
        tier: q.tier,
        npcName: q.npcName,
        completed: q.completed,
      })),
      questIdCounter,
      totalCompleted,
    };
  }

  function loadState(state) {
    if (!state) return;
    if (state.questIdCounter) questIdCounter = state.questIdCounter;
    if (state.totalCompleted) totalCompleted = state.totalCompleted;
    if (state.activeQuests && Array.isArray(state.activeQuests)) {
      activeQuests = state.activeQuests
        .filter(q => !q.completed)
        .map(q => ({
          ...q,
          canComplete: false,
        }));
    }
    refreshQuests();
  }

  return {
    init,
    update,
    draw,
    drawPrompt,
    handleKey,
    isOpen,
    isNearBoard,
    open,
    close,
    toggle,
    getState,
    loadState,
    BOARD_COL,
    BOARD_ROW,
  };
})();

if (typeof module !== 'undefined') module.exports = QuestBoard;
