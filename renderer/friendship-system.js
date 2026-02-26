/**
 * friendship-system.js — NPC Friendship & Gifting System (Sprint 29 P0).
 *
 * Adds emotional depth to NPC interactions:
 *   - 0-10 heart friendship levels per NPC
 *   - [G] key to gift items to nearby NPCs
 *   - Each NPC has loved/liked/disliked item preferences
 *   - Friendship milestones trigger dialogue & return gifts
 *   - Persisted via farm-state (friendship map)
 *
 * Hearts gained per gift:
 *   Loved item: +3 hearts, Liked item: +1, Neutral: +0.5, Disliked: -1
 */
const FriendshipSystem = (() => {
  const MAX_HEARTS = 10;
  const GIFT_RANGE = 2; // tiles
  const GIFT_COOLDOWN = 600; // 10 seconds between gifts to same NPC

  // Friendship data: { npcId → { hearts, lastGiftTick, giftsGiven } }
  let friendships = {};
  let initialized = false;

  // Item preference matrix by NPC tier
  const PREFERENCES = {
    newbie: {
      loved: ['strawberry', 'sunflower', 'carrot'],
      liked: ['wheat', 'corn', 'tomato'],
      disliked: ['stone', 'wood'],
    },
    veteran: {
      loved: ['bread', 'fish', 'pumpkin'],
      liked: ['watermelon', 'corn', 'gold'],
      disliked: ['carrot', 'wheat'],
    },
    sage: {
      loved: ['gold', 'crystal_shard', 'golden_apple'],
      liked: ['bread', 'fish', 'pumpkin'],
      disliked: ['stone', 'wood', 'carrot'],
    },
  };

  // Return gifts at friendship milestones
  const MILESTONE_GIFTS = {
    3:  { resource: 'gold', amount: 25, message: 'Thanks for being kind!' },
    5:  { resource: 'strawberry', amount: 5, message: 'I found these for you!' },
    7:  { resource: 'gold', amount: 100, message: 'You are a true friend.' },
    10: { resource: 'gold', amount: 500, message: 'My best friend forever!' },
  };

  // Dialogue lines by heart level
  const DIALOGUES = {
    0: ['...', 'Who are you?', 'Hmm.'],
    1: ['Hello.', 'Nice day.', 'Oh, hi.'],
    3: ['Good to see you!', 'How is the farm?', 'Want to chat?'],
    5: ['You are so kind!', 'Best farmer ever!', 'I love this place.'],
    7: ['We are great friends!', 'I trust you.', 'Anything you need!'],
    10: ['BFF!', 'You are legendary!', 'Forever grateful.'],
  };

  // Active gift animation / dialogue state
  let activeDialogue = null; // { npcId, text, timer, color }
  let giftAnimation = null;  // { npcId, col, row, timer, emoji }

  // ===== Init =====

  function init(savedState) {
    if (savedState && savedState.friendships) {
      friendships = savedState.friendships;
    }
    initialized = true;
  }

  // ===== Core Logic =====

  function getHearts(npcId) {
    return friendships[npcId] ? friendships[npcId].hearts : 0;
  }

  function getHeartLevel(npcId) {
    return Math.floor(getHearts(npcId));
  }

  function getFriendship(npcId) {
    if (!friendships[npcId]) {
      friendships[npcId] = { hearts: 0, lastGiftTick: -9999, giftsGiven: 0 };
    }
    return friendships[npcId];
  }

  /** Get item preference category for an NPC. */
  function getPreference(npcTier, item) {
    const prefs = PREFERENCES[npcTier] || PREFERENCES.newbie;
    if (prefs.loved.includes(item)) return 'loved';
    if (prefs.liked.includes(item)) return 'liked';
    if (prefs.disliked.includes(item)) return 'disliked';
    return 'neutral';
  }

  /** Try to gift the selected resource to the nearest NPC. Returns true if gift occurred. */
  function tryGift(tick) {
    if (typeof Player === 'undefined' || typeof NPCManager === 'undefined') return false;
    if (typeof ResourceInventory === 'undefined') return false;

    const pp = Player.getPosition();
    const npcs = NPCManager.getNPCs();
    if (!npcs || npcs.length === 0) return false;

    // Find nearest NPC in range
    let nearest = null;
    let nearDist = Infinity;
    for (const npc of npcs) {
      const dx = pp.x - npc.ai.col;
      const dy = pp.y - npc.ai.row;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < GIFT_RANGE && dist < nearDist) {
        nearest = npc;
        nearDist = dist;
      }
    }

    if (!nearest) {
      showFloatingText(pp.x, pp.y - 1, 'No one nearby...', '#AAA');
      return false;
    }

    // Check cooldown
    const fs = getFriendship(nearest.id);
    if (tick - fs.lastGiftTick < GIFT_COOLDOWN) {
      showFloatingText(nearest.ai.col, nearest.ai.row - 1.5, 'Already gifted recently', '#FF6666');
      return false;
    }

    // Pick best giftable resource from inventory
    const giftItem = pickBestGift(nearest.profile.tier);
    if (!giftItem) {
      showFloatingText(pp.x, pp.y - 1, 'Nothing to gift...', '#AAA');
      return false;
    }

    // Spend the resource
    if (!ResourceInventory.has(giftItem, 1)) return false;
    ResourceInventory.spend(giftItem, 1);

    // Calculate heart change
    const pref = getPreference(nearest.profile.tier, giftItem);
    const prevHearts = Math.floor(fs.hearts);
    let heartDelta = 0;
    let emoji = '';
    let color = '#FFF';

    switch (pref) {
      case 'loved':
        heartDelta = 3;
        emoji = '\u{2764}\u{FE0F}';
        color = '#FF4081';
        break;
      case 'liked':
        heartDelta = 1;
        emoji = '\u{1F60A}';
        color = '#FFD700';
        break;
      case 'neutral':
        heartDelta = 0.5;
        emoji = '\u{1F642}';
        color = '#AAA';
        break;
      case 'disliked':
        heartDelta = -1;
        emoji = '\u{1F61E}';
        color = '#666';
        break;
    }

    fs.hearts = Math.max(0, Math.min(MAX_HEARTS, fs.hearts + heartDelta));
    fs.lastGiftTick = tick;
    fs.giftsGiven++;

    // Visual feedback
    showFloatingText(nearest.ai.col, nearest.ai.row - 1.5, `${emoji} +${giftItem}`, color);
    giftAnimation = { npcId: nearest.id, col: nearest.ai.col, row: nearest.ai.row, timer: 60, emoji };

    if (typeof AudioManager !== 'undefined') AudioManager.playHarvestPop();

    // Check milestone
    const newHearts = Math.floor(fs.hearts);
    if (newHearts > prevHearts) {
      checkMilestone(nearest, prevHearts, newHearts);
    }

    // Emit event for tutorial / quest integration
    if (typeof EventBus !== 'undefined') {
      EventBus.emit('NPC_GIFT', { npcId: nearest.id, item: giftItem, pref, hearts: fs.hearts });
    }

    return true;
  }

  /** Pick the best gift from inventory (prefer items the nearest NPC would love). */
  function pickBestGift(npcTier) {
    const prefs = PREFERENCES[npcTier] || PREFERENCES.newbie;
    // Try loved first, then liked, then any resource with count > 0
    for (const item of prefs.loved) {
      if (ResourceInventory.has(item, 1)) return item;
    }
    for (const item of prefs.liked) {
      if (ResourceInventory.has(item, 1)) return item;
    }
    // Any non-gold, non-essential resource
    const all = ResourceInventory.getAll ? ResourceInventory.getAll() : {};
    for (const [res, count] of Object.entries(all)) {
      if (count > 0 && res !== 'gold' && !prefs.disliked.includes(res)) {
        return res;
      }
    }
    return null;
  }

  /** Check and reward friendship milestone. */
  function checkMilestone(npc, prevLevel, newLevel) {
    for (let level = prevLevel + 1; level <= newLevel; level++) {
      const gift = MILESTONE_GIFTS[level];
      if (gift) {
        // Return gift
        if (typeof ResourceInventory !== 'undefined') {
          ResourceInventory.add(gift.resource, gift.amount);
        }
        showFloatingText(npc.ai.col, npc.ai.row - 2, `\u{1F381} ${gift.message}`, '#FFD700');
        showFloatingText(npc.ai.col, npc.ai.row - 2.5, `+${gift.amount} ${gift.resource}`, '#4FC3F7');
        if (typeof AudioManager !== 'undefined') AudioManager.playLevelUp();
      }
    }

    // Heart level up announcement
    showFloatingText(npc.ai.col, npc.ai.row - 1, `\u{2764}\u{FE0F} ${newLevel}/${MAX_HEARTS}`, '#FF4081');
  }

  function showFloatingText(col, row, text, color) {
    if (typeof IsoEffects !== 'undefined') {
      IsoEffects.spawnText(col, row, text, { color, life: 90, rise: 0.3 });
    }
  }

  // ===== Dialogue =====

  function getDialogue(npcId) {
    const level = getHeartLevel(npcId);
    // Find highest matching dialogue tier
    let bestTier = 0;
    for (const tier of Object.keys(DIALOGUES).map(Number).sort((a, b) => b - a)) {
      if (level >= tier) { bestTier = tier; break; }
    }
    const lines = DIALOGUES[bestTier] || DIALOGUES[0];
    return lines[Math.floor(Math.random() * lines.length)];
  }

  // ===== Nearby NPC Detection =====

  function getNearbyNPC() {
    if (typeof Player === 'undefined' || typeof NPCManager === 'undefined') return null;
    const pp = Player.getPosition();
    const npcs = NPCManager.getNPCs();
    for (const npc of npcs) {
      const dx = pp.x - npc.ai.col;
      const dy = pp.y - npc.ai.row;
      if (Math.sqrt(dx * dx + dy * dy) <= GIFT_RANGE) return npc;
    }
    return null;
  }

  // ===== Update & Draw =====

  function update(tick) {
    if (!initialized) return;

    // Decay active animations
    if (giftAnimation) {
      giftAnimation.timer--;
      if (giftAnimation.timer <= 0) giftAnimation = null;
    }
    if (activeDialogue) {
      activeDialogue.timer--;
      if (activeDialogue.timer <= 0) activeDialogue = null;
    }
  }

  function draw(ctx, canvasW, canvasH, tick) {
    if (!initialized) return;

    // Draw gift prompt when near NPC
    drawGiftPrompt(ctx, canvasW, canvasH);

    // Draw heart indicators above NPCs
    drawHeartIndicators(ctx, tick);

    // Draw gift animation
    if (giftAnimation) {
      drawGiftAnim(ctx, tick);
    }
  }

  function drawGiftPrompt(ctx, canvasW, canvasH) {
    const nearby = getNearbyNPC();
    if (!nearby) return;

    const fs = getFriendship(nearby.id);
    const hearts = Math.floor(fs.hearts);
    const dialogue = getDialogue(nearby.id);

    ctx.save();
    ctx.font = '7px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Prompt box at bottom
    const boxW = 160;
    const boxH = 36;
    const boxX = (canvasW - boxW) / 2;
    const boxY = canvasH - 50;

    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = '#FF4081';
    ctx.lineWidth = 1;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    // NPC name + tier
    ctx.fillStyle = '#FFF';
    ctx.font = 'bold 7px monospace';
    ctx.textAlign = 'left';
    const name = nearby.profile.project.length > 14
      ? nearby.profile.project.slice(0, 13) + '..'
      : nearby.profile.project;
    ctx.fillText(name, boxX + 4, boxY + 8);

    // Hearts display
    ctx.font = '6px monospace';
    let heartsStr = '';
    for (let i = 0; i < MAX_HEARTS; i++) {
      heartsStr += i < hearts ? '\u{2764}\u{FE0F}' : '\u{1F5A4}';
    }
    ctx.fillText(heartsStr, boxX + 4, boxY + 18);

    // Dialogue
    ctx.fillStyle = '#F5E6C8';
    ctx.font = '6px monospace';
    const dialogText = `"${dialogue}"`;
    ctx.fillText(dialogText.length > 28 ? dialogText.slice(0, 27) + '..' : dialogText, boxX + 4, boxY + 28);

    // [G] Gift prompt
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 7px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('[G] Gift', boxX + boxW - 4, boxY + 8);

    ctx.restore();
  }

  function drawHeartIndicators(ctx, tick) {
    if (typeof IsoEngine === 'undefined' || typeof NPCManager === 'undefined') return;

    const npcs = NPCManager.getNPCs();
    for (const npc of npcs) {
      const hearts = getHeartLevel(npc.id);
      if (hearts <= 0) continue;

      const sx = IsoEngine.gridToScreenX(npc.ai.col, npc.ai.row);
      const sy = IsoEngine.gridToScreenY(npc.ai.col, npc.ai.row);
      if (sx === undefined || sy === undefined) continue;

      // Small heart icon above NPC (in zoomed space)
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.scale(IsoEngine.getZoom(), IsoEngine.getZoom());

      const pulse = 1 + Math.sin(tick * 0.06) * 0.1;
      ctx.font = `${Math.round(5 * pulse)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Show heart count as mini hearts
      if (hearts >= 7) {
        ctx.fillText('\u{1F49B}', sx, sy - 26); // gold heart
      } else if (hearts >= 3) {
        ctx.fillText('\u{2764}\u{FE0F}', sx, sy - 26); // red heart
      } else {
        ctx.fillText('\u{1F5A4}', sx, sy - 26); // black heart (low friendship)
      }

      ctx.restore();
    }
  }

  function drawGiftAnim(ctx, tick) {
    if (!giftAnimation || typeof IsoEngine === 'undefined') return;

    const sx = IsoEngine.gridToScreenX(giftAnimation.col, giftAnimation.row);
    const sy = IsoEngine.gridToScreenY(giftAnimation.col, giftAnimation.row);
    if (sx === undefined || sy === undefined) return;

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.scale(IsoEngine.getZoom(), IsoEngine.getZoom());

    const progress = 1 - giftAnimation.timer / 60;
    const rise = progress * 12;
    const alpha = 1 - progress;

    ctx.globalAlpha = alpha;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(giftAnimation.emoji, sx, sy - 20 - rise);

    ctx.restore();
  }

  // ===== Persistence =====

  function getState() {
    return { friendships };
  }

  // ===== Setup =====

  function setupListeners() {
    // NPC click shows friendship info (enhanced popup via NPCManager click)
  }

  return {
    init,
    update,
    draw,
    tryGift,
    getHearts,
    getHeartLevel,
    getNearbyNPC,
    getDialogue,
    getPreference,
    getState,
    setupListeners,
  };
})();
