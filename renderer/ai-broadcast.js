/**
 * ai-broadcast.js — AI Broadcast Board (TBD Backlog P3).
 *
 * NPCs comment on the player's activities in real-time:
 *   - Git commits trigger NPC commentary bubbles
 *   - Farm events (harvests, sales, buildings) generate gossip
 *   - Periodic random village announcements
 *
 * Messages scroll on a bulletin board accessible via [B] key.
 * NPCs near the board will display speech bubbles with recent news.
 */
const AIBroadcast = (() => {
  // Message types
  const MSG_TYPES = {
    commit:     { prefix: '\u{1F4BB}', color: '#4FC3F7' },
    harvest:    { prefix: '\u{1F33E}', color: '#66BB6A' },
    sale:       { prefix: '\u{1F4B0}', color: '#FFD700' },
    build:      { prefix: '\u{1F3D7}\u{FE0F}', color: '#FF9800' },
    fish:       { prefix: '\u{1F41F}', color: '#29B6F6' },
    weather:    { prefix: '\u{26C5}', color: '#90A4AE' },
    social:     { prefix: '\u{1F4AC}', color: '#CE93D8' },
    announce:   { prefix: '\u{1F4E2}', color: '#EF5350' },
  };

  // NPC commentary templates
  const COMMIT_COMMENTS = [
    'The lord just made changes to the realm!',
    'New code deployed! The village grows stronger.',
    'Another commit — progress never stops!',
    'The lord works tirelessly on the kingdom.',
    'I heard new features are coming!',
    'The digital winds bring change...',
  ];

  const HARVEST_COMMENTS = [
    'What a bountiful harvest today!',
    'The fields are generous this season.',
    'Fresh crops! The market will be lively.',
    'Another successful harvest — well done!',
  ];

  const SALE_COMMENTS = [
    'Business is booming at the market!',
    'Gold coins flowing — prosperity!',
    'The lord drives a hard bargain.',
    'Trade makes the village thrive.',
  ];

  const FISH_COMMENTS = [
    'Fresh catch from the river!',
    'The fish are biting today!',
    'A fine day for fishing.',
  ];

  const RANDOM_ANNOUNCEMENTS = [
    'Beautiful day in the village!',
    'Remember to water your crops!',
    'The market opens at dawn.',
    'Rumor: rare fish spotted downstream.',
    'Village meeting tomorrow at the square.',
    'Has anyone seen the wandering merchant?',
    'The seasons change, but friendship endures.',
    'Tech tree upgrades available at the shed!',
  ];

  // State
  const MAX_MESSAGES = 30;
  let messages = [];
  let boardOpen = false;
  let scrollY = 0;
  let lastAnnounceTick = 0;
  const ANNOUNCE_INTERVAL = 3600; // ~1 min
  let initialized = false;

  // ===== Init =====

  function init() {
    initialized = true;
    addMessage('announce', 'Welcome to AIFarm village!');
  }

  function setupListeners() {
    if (typeof EventBus === 'undefined') return;

    EventBus.on('CROP_HARVESTED', (data) => {
      const crop = (data && data.crop) || 'crops';
      addMessage('harvest', `Harvested ${crop}!`);
      queueNPCComment(pickRandom(HARVEST_COMMENTS));
    });

    EventBus.on('RESOURCE_SOLD', (data) => {
      addMessage('sale', 'Resources sold at the market.');
      queueNPCComment(pickRandom(SALE_COMMENTS));
    });

    EventBus.on('FISH_CAUGHT', (data) => {
      const fish = (data && data.fish) || 'a fish';
      addMessage('fish', `Caught ${fish}!`);
      queueNPCComment(pickRandom(FISH_COMMENTS));
    });

    EventBus.on('CONSTRUCTION_COMPLETE', (data) => {
      const building = (data && data.name) || 'a building';
      addMessage('build', `${building} construction complete!`);
    });

    EventBus.on('WEATHER_CHANGE', (data) => {
      const weather = (data && data.weather) || 'changing';
      addMessage('weather', `Weather update: ${weather}`);
    });

    EventBus.on('NPC_GIFT', () => {
      addMessage('social', 'A gift was given — friendship grows!');
    });

    // Git commit events (from IPC or buddy system)
    EventBus.on('GIT_COMMIT', (data) => {
      const msg = (data && data.message) || 'new changes';
      addMessage('commit', `Commit: ${msg}`);
      queueNPCComment(pickRandom(COMMIT_COMMENTS));
    });

    EventBus.on('BUDDY_ACTIVITY', (data) => {
      if (data && data.type === 'commit') {
        addMessage('commit', `Buddy activity: ${data.message || 'coding'}`);
        queueNPCComment(pickRandom(COMMIT_COMMENTS));
      }
    });
  }

  // ===== Messages =====

  function addMessage(type, text) {
    const now = Date.now();
    messages.unshift({ type, text, time: now });
    if (messages.length > MAX_MESSAGES) messages.pop();
  }

  function queueNPCComment(text) {
    if (typeof NPCManager === 'undefined') return;
    const npcs = NPCManager.getNearby ? NPCManager.getNearby(5) : [];
    if (npcs.length > 0) {
      const npc = npcs[Math.floor(Math.random() * npcs.length)];
      if (typeof SpeechBubble !== 'undefined') {
        SpeechBubble.show(npc.name || 'Villager', text, 120);
      }
    }
  }

  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // ===== Update =====

  function update(tick) {
    // Random announcements
    if (tick - lastAnnounceTick >= ANNOUNCE_INTERVAL) {
      lastAnnounceTick = tick;
      if (Math.random() < 0.3) {
        addMessage('announce', pickRandom(RANDOM_ANNOUNCEMENTS));
      }
    }
  }

  // ===== UI =====

  function toggle() { boardOpen = !boardOpen; scrollY = 0; }
  function isOpen() { return boardOpen; }

  function handleKey(key) {
    if (!boardOpen) return false;
    if (key === 'Escape' || key === 'b' || key === 'B') { boardOpen = false; return true; }
    if (key === 'ArrowDown' || key === 's' || key === 'S') { scrollY = Math.min(scrollY + 1, Math.max(0, messages.length - 8)); return true; }
    if (key === 'ArrowUp' || key === 'w' || key === 'W') { scrollY = Math.max(0, scrollY - 1); return true; }
    return false;
  }

  function draw(ctx, canvasW, canvasH, tick) {
    if (!boardOpen) return;

    ctx.save();

    // Board panel
    const pw = 200;
    const ph = 150;
    const px = (canvasW - pw) / 2;
    const py = (canvasH - ph) / 2;

    ctx.fillStyle = 'rgba(20, 15, 10, 0.93)';
    ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = '#CE93D8';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(px, py, pw, ph);

    // Title
    ctx.font = 'bold 9px monospace';
    ctx.fillStyle = '#CE93D8';
    ctx.textAlign = 'center';
    ctx.fillText('\u{1F4E2} VILLAGE BULLETIN', px + pw / 2, py + 14);

    // Messages
    ctx.textAlign = 'left';
    const visibleCount = 8;
    const startIdx = scrollY;
    let y = py + 28;

    for (let i = startIdx; i < Math.min(startIdx + visibleCount, messages.length); i++) {
      const msg = messages[i];
      const msgDef = MSG_TYPES[msg.type] || MSG_TYPES.announce;

      // Time ago
      const ago = formatTimeAgo(msg.time);

      ctx.font = '7px monospace';
      ctx.fillStyle = msgDef.color;
      ctx.fillText(`${msgDef.prefix} ${msg.text}`, px + 6, y);

      ctx.fillStyle = '#555';
      ctx.textAlign = 'right';
      ctx.fillText(ago, px + pw - 6, y);
      ctx.textAlign = 'left';

      y += 14;
    }

    // Empty state
    if (messages.length === 0) {
      ctx.font = '7px monospace';
      ctx.fillStyle = '#666';
      ctx.textAlign = 'center';
      ctx.fillText('No news yet...', px + pw / 2, py + 70);
    }

    // Scroll indicator
    if (messages.length > visibleCount) {
      ctx.font = '6px monospace';
      ctx.fillStyle = '#555';
      ctx.textAlign = 'center';
      ctx.fillText(`${scrollY + 1}-${Math.min(scrollY + visibleCount, messages.length)} of ${messages.length}`, px + pw / 2, py + ph - 18);
    }

    // Controls
    ctx.font = '6px monospace';
    ctx.fillStyle = '#666';
    ctx.textAlign = 'center';
    ctx.fillText('[W/S] Scroll  [B/ESC] Close', px + pw / 2, py + ph - 6);

    ctx.restore();
  }

  function formatTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    return `${Math.floor(minutes / 60)}h`;
  }

  // ===== HUD Badge =====

  function drawBadge(ctx, x, y, tick) {
    // Small notification badge for recent messages (last 30s)
    const recent = messages.filter(m => Date.now() - m.time < 30000).length;
    if (recent === 0) return;

    ctx.save();
    ctx.font = '6px monospace';
    ctx.fillStyle = '#CE93D8';
    ctx.textAlign = 'center';
    const pulse = Math.sin(tick * 0.1) * 0.3 + 0.7;
    ctx.globalAlpha = pulse;
    ctx.fillText(`\u{1F4E2}${recent}`, x, y);
    ctx.restore();
  }

  // ===== Persistence =====

  function getState() {
    // Only persist last 10 messages
    return { messages: messages.slice(0, 10) };
  }

  function loadState(savedState) {
    if (savedState && savedState.messages) {
      messages = savedState.messages;
    }
  }

  return {
    init,
    setupListeners,
    update,
    toggle,
    isOpen,
    handleKey,
    draw,
    drawBadge,
    getState,
    loadState,
    addMessage,
  };
})();
