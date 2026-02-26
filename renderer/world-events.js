/**
 * world-events.js — Global random event system (Sprint 28 P1).
 *
 * Spawns surprise world events at random intervals:
 *   - Meteor Strike: purple crystal at random location, rare resources on collect
 *   - Wandering Merchant: appears near a landmark, sells special items
 *   - Fairy Ring Bloom: mushroom circle glows, grants bonus XP
 *
 * Events are independent of webhooks (those go through OracleEffects).
 * Fires every 5-15 minutes of real game time.
 */
const WorldEvents = (() => {
  // Event types
  const EVENT_TYPES = ['meteor', 'merchant', 'fairy'];

  // Timing: check every 60 seconds, chance per check
  const CHECK_INTERVAL = 3600; // 60 seconds at 60fps
  const EVENT_CHANCE = 0.15;   // 15% chance per check (~1 event per 7 min avg)
  let lastCheckTick = 0;

  // Active events
  let activeEvent = null; // { type, col, row, timer, data }
  const EVENT_DURATION = 18000; // 5 minutes at 60fps

  // Collect range
  const COLLECT_RANGE = 2;

  // ===== Event Generation =====

  function checkForEvent(tick) {
    if (activeEvent) return; // only one at a time
    if (tick - lastCheckTick < CHECK_INTERVAL) return;
    lastCheckTick = tick;

    if (Math.random() > EVENT_CHANCE) return;

    const type = EVENT_TYPES[Math.floor(Math.random() * EVENT_TYPES.length)];
    spawnEvent(type);
  }

  function spawnEvent(type) {
    // Pick random location in loaded area (offset from player)
    const pp = (typeof Player !== 'undefined') ? Player.getPosition() : { x: 10, y: 10 };
    const ox = (Math.random() - 0.5) * 20;
    const oy = (Math.random() - 0.5) * 12;
    const col = Math.floor(pp.x + ox);
    const row = Math.floor(pp.y + oy);

    switch (type) {
      case 'meteor':
        activeEvent = {
          type: 'meteor',
          col, row,
          timer: EVENT_DURATION,
          collected: false,
          data: { resource: 'stone', amount: 30 + Math.floor(Math.random() * 20) },
        };
        // Impact effect
        if (typeof IsoEffects !== 'undefined') {
          for (let i = 0; i < 12; i++) {
            IsoEffects.spawnText(
              col + (Math.random() - 0.5) * 2,
              row + (Math.random() - 0.5) * 2,
              '\u{2728}',
              { color: '#9C27B0', life: 40 + Math.random() * 40, rise: 0.5 + Math.random() * 0.5 }
            );
          }
          IsoEffects.spawnText(col, row - 1.5, '\u{2604}\u{FE0F} Meteor Strike!',
            { color: '#CE93D8', life: 120, rise: 0.2 });
        }
        if (typeof AudioManager !== 'undefined') AudioManager.playLevelUp();
        break;

      case 'merchant':
        activeEvent = {
          type: 'merchant',
          col, row,
          timer: EVENT_DURATION,
          interacted: false,
          data: {
            items: [
              { name: 'Rare Seed', cost: 50, reward: 'pumpkin', amount: 5 },
              { name: 'Crystal Shard', cost: 30, reward: 'stone', amount: 15 },
              { name: 'Golden Apple', cost: 80, reward: 'gold', amount: 100 },
            ],
          },
        };
        if (typeof IsoEffects !== 'undefined') {
          IsoEffects.spawnText(col, row - 1.5, '\u{1F9D9} Wandering Merchant!',
            { color: '#4FC3F7', life: 120, rise: 0.2 });
        }
        break;

      case 'fairy':
        activeEvent = {
          type: 'fairy',
          col, row,
          timer: EVENT_DURATION,
          collected: false,
          data: { xpBonus: 50 },
        };
        if (typeof IsoEffects !== 'undefined') {
          IsoEffects.spawnText(col, row - 1.5, '\u{1F3B6} Fairy Ring Bloom!',
            { color: '#69F0AE', life: 120, rise: 0.2 });
        }
        break;
    }

    if (typeof Farm !== 'undefined' && Farm.logEvent) {
      const labels = { meteor: '\u{2604}\u{FE0F} Meteor Strike nearby!', merchant: '\u{1F9D9} A merchant appeared!', fairy: '\u{1F3B6} A fairy ring is glowing!' };
      Farm.logEvent('\u{2728}', labels[type] || 'Something happened!');
    }
  }

  // ===== Player Interaction =====

  function tryInteract() {
    if (!activeEvent || activeEvent.collected || activeEvent.interacted) return false;
    if (typeof Player === 'undefined') return false;

    const pp = Player.getPosition();
    const dx = pp.x - activeEvent.col;
    const dy = pp.y - activeEvent.row;
    if (Math.sqrt(dx * dx + dy * dy) > COLLECT_RANGE) return false;

    switch (activeEvent.type) {
      case 'meteor':
        activeEvent.collected = true;
        if (typeof ResourceInventory !== 'undefined') {
          ResourceInventory.add(activeEvent.data.resource, activeEvent.data.amount);
        }
        if (typeof IsoEffects !== 'undefined') {
          IsoEffects.spawnText(activeEvent.col, activeEvent.row - 1,
            `+${activeEvent.data.amount} ${activeEvent.data.resource}!`,
            { color: '#CE93D8', life: 90, rise: 0.3 });
        }
        if (typeof AudioManager !== 'undefined') AudioManager.playHarvestPop();
        activeEvent = null;
        return true;

      case 'merchant':
        activeEvent.interacted = true;
        // Give random item from merchant
        const item = activeEvent.data.items[Math.floor(Math.random() * activeEvent.data.items.length)];
        const hasGold = (typeof ResourceInventory !== 'undefined') && ResourceInventory.has('gold', item.cost);
        if (hasGold) {
          ResourceInventory.spend('gold', item.cost);
          ResourceInventory.add(item.reward, item.amount);
          if (typeof IsoEffects !== 'undefined') {
            IsoEffects.spawnText(activeEvent.col, activeEvent.row - 1,
              `Bought ${item.name}! +${item.amount} ${item.reward}`,
              { color: '#4FC3F7', life: 120, rise: 0.2 });
          }
        } else {
          if (typeof IsoEffects !== 'undefined') {
            IsoEffects.spawnText(activeEvent.col, activeEvent.row - 1,
              `Need ${item.cost}g...`, { color: '#FF6666', life: 60, rise: 0.3 });
          }
          activeEvent.interacted = false; // allow retry
          return false;
        }
        if (typeof AudioManager !== 'undefined') AudioManager.playHarvestPop();
        activeEvent = null;
        return true;

      case 'fairy':
        activeEvent.collected = true;
        if (typeof SkillSystem !== 'undefined') {
          SkillSystem.addXP('farming', activeEvent.data.xpBonus);
          SkillSystem.addXP('mining', activeEvent.data.xpBonus);
          SkillSystem.addXP('fishing', activeEvent.data.xpBonus);
        }
        if (typeof IsoEffects !== 'undefined') {
          IsoEffects.spawnText(activeEvent.col, activeEvent.row - 1,
            `+${activeEvent.data.xpBonus} XP to all skills!`,
            { color: '#69F0AE', life: 120, rise: 0.2 });
        }
        if (typeof AudioManager !== 'undefined') AudioManager.playLevelUp();
        activeEvent = null;
        return true;
    }
    return false;
  }

  // ===== Update & Draw =====

  function update(tick) {
    checkForEvent(tick);

    if (activeEvent) {
      activeEvent.timer--;
      if (activeEvent.timer <= 0) {
        // Event expired
        if (typeof IsoEffects !== 'undefined') {
          IsoEffects.spawnText(activeEvent.col, activeEvent.row - 1,
            'The event faded away...', { color: '#666', life: 60, rise: 0.3 });
        }
        activeEvent = null;
      }
    }
  }

  function draw(ctx, tick) {
    if (!activeEvent) return;
    if (typeof IsoEngine === 'undefined') return;

    const sx = IsoEngine.gridToScreenX(activeEvent.col, activeEvent.row);
    const sy = IsoEngine.gridToScreenY(activeEvent.col, activeEvent.row);
    if (sx === undefined || sy === undefined) return;

    ctx.save();

    // Pulsing glow circle
    const pulse = 0.4 + Math.sin(tick * 0.06) * 0.2;
    const colors = { meteor: '#9C27B0', merchant: '#4FC3F7', fairy: '#69F0AE' };
    const color = colors[activeEvent.type] || '#FFF';

    ctx.beginPath();
    ctx.arc(sx, sy, 12, 0, Math.PI * 2);
    ctx.fillStyle = color.replace(')', `, ${pulse * 0.3})`).replace('rgb', 'rgba').replace('#', '');
    // Simple approach: use globalAlpha
    ctx.globalAlpha = pulse * 0.3;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Icon
    const icons = { meteor: '\u{1F48E}', merchant: '\u{1F9D9}', fairy: '\u{1F3B6}' };
    const bounce = Math.sin(tick * 0.08) * 2;
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icons[activeEvent.type] || '\u{2728}', sx, sy - 8 + bounce);

    // Timer bar
    const remaining = activeEvent.timer / EVENT_DURATION;
    const barW = 20;
    const barH = 2;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(sx - barW / 2, sy + 6, barW, barH);
    ctx.fillStyle = color;
    ctx.fillRect(sx - barW / 2, sy + 6, barW * remaining, barH);

    // "[E] Collect" prompt when nearby
    if (typeof Player !== 'undefined') {
      const pp = Player.getPosition();
      const dx = pp.x - activeEvent.col;
      const dy = pp.y - activeEvent.row;
      if (Math.sqrt(dx * dx + dy * dy) <= COLLECT_RANGE) {
        ctx.font = '6px monospace';
        ctx.fillStyle = '#FFF';
        ctx.fillText('[E]', sx, sy + 14);
      }
    }

    ctx.restore();
  }

  function hasActiveEvent() { return activeEvent !== null; }
  function getActiveEvent() { return activeEvent; }

  return {
    update,
    draw,
    tryInteract,
    hasActiveEvent,
    getActiveEvent,
  };
})();
