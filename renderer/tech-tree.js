/**
 * tech-tree.js — Tool Efficiency Tech Tree (TBD Backlog P1).
 *
 * Research upgrades for tools across 3 branches:
 *   - Farming: faster crop growth, higher harvest yield
 *   - Mining: more stone/wood per action, faster gathering
 *   - Fishing: shorter catch timer, rarer fish chance
 *
 * Each branch has 5 levels. Research points (RP) earned from activities.
 * Spend RP at the tool shed to unlock upgrades.
 * Persisted via farm-state.
 */
const TechTree = (() => {
  const BRANCHES = {
    farming: {
      name: 'Farming',
      emoji: '\u{1F33E}',
      levels: [
        { name: 'Iron Hoe', cost: 10, bonus: { growthSpeed: 1.1 } },
        { name: 'Steel Hoe', cost: 25, bonus: { growthSpeed: 1.2 } },
        { name: 'Gold Hoe', cost: 50, bonus: { growthSpeed: 1.35, yieldBonus: 1.1 } },
        { name: 'Mithril Hoe', cost: 100, bonus: { growthSpeed: 1.5, yieldBonus: 1.25 } },
        { name: 'Legendary Hoe', cost: 200, bonus: { growthSpeed: 2.0, yieldBonus: 1.5 } },
      ],
    },
    mining: {
      name: 'Mining',
      emoji: '\u{26CF}\u{FE0F}',
      levels: [
        { name: 'Iron Pickaxe', cost: 10, bonus: { resourceMult: 1.1 } },
        { name: 'Steel Pickaxe', cost: 25, bonus: { resourceMult: 1.25 } },
        { name: 'Gold Pickaxe', cost: 50, bonus: { resourceMult: 1.4 } },
        { name: 'Mithril Pickaxe', cost: 100, bonus: { resourceMult: 1.6 } },
        { name: 'Legendary Pickaxe', cost: 200, bonus: { resourceMult: 2.0 } },
      ],
    },
    fishing: {
      name: 'Fishing',
      emoji: '\u{1F3A3}',
      levels: [
        { name: 'Bamboo Rod', cost: 10, bonus: { catchSpeed: 1.1 } },
        { name: 'Fiberglass Rod', cost: 25, bonus: { catchSpeed: 1.2, rareChance: 1.1 } },
        { name: 'Carbon Rod', cost: 50, bonus: { catchSpeed: 1.35, rareChance: 1.2 } },
        { name: 'Titanium Rod', cost: 100, bonus: { catchSpeed: 1.5, rareChance: 1.4 } },
        { name: 'Legendary Rod', cost: 200, bonus: { catchSpeed: 2.0, rareChance: 2.0 } },
      ],
    },
  };

  // State
  let researchPoints = 0;
  let levels = { farming: 0, mining: 0, fishing: 0 };
  let initialized = false;

  // UI state
  let menuOpen = false;
  let selectedBranch = 0;
  const branchKeys = ['farming', 'mining', 'fishing'];

  // RP earn rate from activities
  const RP_PER_HARVEST = 1;
  const RP_PER_FISH = 2;
  const RP_PER_LANDMARK = 3;
  const RP_PER_SELL = 0.5;
  let rpAccum = 0;

  // ===== Init =====

  function init(savedState) {
    if (savedState) {
      researchPoints = savedState.rp || 0;
      levels = savedState.levels || { farming: 0, mining: 0, fishing: 0 };
    }
    initialized = true;
  }

  // ===== RP Earning =====

  function setupListeners() {
    if (typeof EventBus === 'undefined') return;
    EventBus.on('CROP_HARVESTED', () => addRP(RP_PER_HARVEST));
    EventBus.on('FISH_CAUGHT', () => addRP(RP_PER_FISH));
    EventBus.on('LANDMARK_EXPLORED', () => addRP(RP_PER_LANDMARK));
    EventBus.on('RESOURCE_SOLD', () => { rpAccum += RP_PER_SELL; if (rpAccum >= 1) { addRP(Math.floor(rpAccum)); rpAccum -= Math.floor(rpAccum); } });
  }

  function addRP(amount) {
    researchPoints += amount;
    if (typeof IsoEffects !== 'undefined') {
      const pp = (typeof Player !== 'undefined') ? Player.getPosition() : { x: 10, y: 10 };
      IsoEffects.spawnText(pp.x, pp.y - 1, `+${amount} RP`, { color: '#4FC3F7', life: 40, rise: 0.3 });
    }
  }

  // ===== Upgrade =====

  function tryUpgrade(branch) {
    const level = levels[branch] || 0;
    const branchDef = BRANCHES[branch];
    if (!branchDef || level >= branchDef.levels.length) return false;

    const nextLevel = branchDef.levels[level];
    if (researchPoints < nextLevel.cost) {
      if (typeof IsoEffects !== 'undefined') {
        const pp = (typeof Player !== 'undefined') ? Player.getPosition() : { x: 10, y: 10 };
        IsoEffects.spawnText(pp.x, pp.y - 1, `Need ${nextLevel.cost} RP`, { color: '#FF6666', life: 60, rise: 0.3 });
      }
      return false;
    }

    researchPoints -= nextLevel.cost;
    levels[branch] = level + 1;

    if (typeof IsoEffects !== 'undefined') {
      const pp = (typeof Player !== 'undefined') ? Player.getPosition() : { x: 10, y: 10 };
      IsoEffects.spawnText(pp.x, pp.y - 1.5, `\u{1F52C} ${nextLevel.name} unlocked!`, { color: '#FFD700', life: 90, rise: 0.2 });
    }
    if (typeof AudioManager !== 'undefined') AudioManager.playLevelUp();

    return true;
  }

  // ===== Bonus Queries =====

  function getBonus(branch) {
    const level = levels[branch] || 0;
    if (level === 0) return {};
    return BRANCHES[branch].levels[level - 1].bonus;
  }

  function getGrowthSpeedMult() { return (getBonus('farming').growthSpeed || 1); }
  function getYieldMult() { return (getBonus('farming').yieldBonus || 1); }
  function getResourceMult() { return (getBonus('mining').resourceMult || 1); }
  function getCatchSpeedMult() { return (getBonus('fishing').catchSpeed || 1); }
  function getRareChanceMult() { return (getBonus('fishing').rareChance || 1); }

  // ===== UI =====

  function toggle() { menuOpen = !menuOpen; selectedBranch = 0; }
  function isOpen() { return menuOpen; }

  function handleKey(key) {
    if (!menuOpen) return false;
    if (key === 'Escape' || key === 'r' || key === 'R') { menuOpen = false; return true; }
    if (key === 'ArrowUp' || key === 'w' || key === 'W') { selectedBranch = Math.max(0, selectedBranch - 1); return true; }
    if (key === 'ArrowDown' || key === 's' || key === 'S') { selectedBranch = Math.min(branchKeys.length - 1, selectedBranch + 1); return true; }
    if (key === 'Enter' || key === 'e' || key === 'E') { tryUpgrade(branchKeys[selectedBranch]); return true; }
    return false;
  }

  function draw(ctx, canvasW, canvasH, tick) {
    if (!menuOpen) return;

    ctx.save();

    // Background
    const pw = 180;
    const ph = 160;
    const px = (canvasW - pw) / 2;
    const py = (canvasH - ph) / 2;

    ctx.fillStyle = 'rgba(20, 15, 10, 0.92)';
    ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = '#4FC3F7';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(px, py, pw, ph);

    // Title
    ctx.font = 'bold 9px monospace';
    ctx.fillStyle = '#4FC3F7';
    ctx.textAlign = 'center';
    ctx.fillText('\u{1F52C} TECH TREE', px + pw / 2, py + 14);

    // RP display
    ctx.font = '7px monospace';
    ctx.fillStyle = '#FFF';
    ctx.textAlign = 'right';
    ctx.fillText(`RP: ${Math.floor(researchPoints)}`, px + pw - 6, py + 14);

    // Branches
    ctx.textAlign = 'left';
    let y = py + 30;
    for (let i = 0; i < branchKeys.length; i++) {
      const key = branchKeys[i];
      const branch = BRANCHES[key];
      const level = levels[key] || 0;
      const isSelected = i === selectedBranch;
      const maxed = level >= branch.levels.length;

      // Selection highlight
      if (isSelected) {
        ctx.fillStyle = 'rgba(79, 195, 247, 0.15)';
        ctx.fillRect(px + 4, y - 4, pw - 8, 36);
      }

      // Branch name + emoji
      ctx.font = 'bold 8px monospace';
      ctx.fillStyle = isSelected ? '#4FC3F7' : '#AAA';
      ctx.fillText(`${branch.emoji} ${branch.name}`, px + 8, y + 6);

      // Current level
      ctx.font = '7px monospace';
      ctx.fillStyle = maxed ? '#FFD700' : '#888';
      const currentName = level > 0 ? branch.levels[level - 1].name : 'None';
      ctx.fillText(`Lv${level}: ${currentName}`, px + 8, y + 17);

      // Next upgrade info
      if (!maxed) {
        const next = branch.levels[level];
        ctx.fillStyle = researchPoints >= next.cost ? '#0F0' : '#FF6666';
        ctx.fillText(`Next: ${next.name} (${next.cost} RP)`, px + 8, y + 27);
      } else {
        ctx.fillStyle = '#FFD700';
        ctx.fillText('MAX LEVEL', px + 8, y + 27);
      }

      y += 40;
    }

    // Controls hint
    ctx.font = '6px monospace';
    ctx.fillStyle = '#666';
    ctx.textAlign = 'center';
    ctx.fillText('[W/S] Select  [Enter] Upgrade  [R/ESC] Close', px + pw / 2, py + ph - 6);

    ctx.restore();
  }

  // ===== Persistence =====

  function getState() {
    return { rp: researchPoints, levels };
  }

  return {
    init,
    setupListeners,
    toggle,
    isOpen,
    handleKey,
    draw,
    getState,
    getGrowthSpeedMult,
    getYieldMult,
    getResourceMult,
    getCatchSpeedMult,
    getRareChanceMult,
    addRP,
  };
})();
