/**
 * collection-ui.js — Museum & Collections UI for AIFarm 3.0 (Sprint 19 P1).
 *
 * Full-screen catalog showing discovered landmarks, fish types, processed goods.
 * Opened by pressing [C] or clicking the museum building.
 * Tracks progress with visual completion bars per category.
 */
const CollectionUI = (() => {
  let isOpenFlag = false;
  let selectedTab = 0;    // 0=landmarks, 1=fish, 2=products, 3=crops
  let scrollY = 0;
  let animTick = 0;

  // ===== Collection definitions =====

  const TABS = [
    { id: 'landmarks', label: '\u{1F3DB} Landmarks', icon: '\u{1F3DB}' },
    { id: 'fish',      label: '\u{1F41F} Fish',      icon: '\u{1F41F}' },
    { id: 'products',  label: '\u{1F3ED} Products',  icon: '\u{1F3ED}' },
    { id: 'crops',     label: '\u{1F33E} Crops',     icon: '\u{1F33E}' },
    { id: 'skills',    label: '\u{26A1} Skills',     icon: '\u{26A1}' },
  ];

  // Fish catalog (matches iso-fishing.js)
  const FISH_CATALOG = [
    { id: 'small_fish',  name: 'Small Fish',  emoji: '\u{1F41F}', rarity: 'common' },
    { id: 'medium_fish', name: 'Medium Fish', emoji: '\u{1F420}', rarity: 'uncommon' },
    { id: 'large_fish',  name: 'Large Fish',  emoji: '\u{1F421}', rarity: 'rare' },
  ];

  // Product catalog (from processing.js)
  const PRODUCT_CATALOG = [
    { id: 'flour', name: 'Flour', emoji: '\u{1F35E}', source: 'Mill (corn)' },
    { id: 'plank', name: 'Plank', emoji: '\u{1FA9A}', source: 'Workshop (wood)' },
    { id: 'feed',  name: 'Feed',  emoji: '\u{1F963}', source: 'Barn (flour)' },
  ];

  // Crop catalog (from farm-config.js)
  const CROP_CATALOG = [
    { id: 'carrot',     name: 'Carrot',     emoji: '\u{1F955}', rarity: 'common' },
    { id: 'sunflower',  name: 'Sunflower',  emoji: '\u{1F33B}', rarity: 'common' },
    { id: 'watermelon', name: 'Watermelon', emoji: '\u{1F349}', rarity: 'uncommon' },
    { id: 'tomato',     name: 'Tomato',     emoji: '\u{1F345}', rarity: 'common' },
    { id: 'corn',       name: 'Corn',       emoji: '\u{1F33D}', rarity: 'uncommon' },
    { id: 'pumpkin',    name: 'Pumpkin',    emoji: '\u{1F383}', rarity: 'rare' },
  ];

  // Tracked discoveries (Set of ids)
  let discoveredFish = new Set();
  let discoveredProducts = new Set();
  let discoveredCrops = new Set();

  // Colors
  const RARITY_COLORS = {
    common:    '#AAA',
    uncommon:  '#4FC3F7',
    rare:      '#FFD700',
    legendary: '#FF00FF',
  };

  // ===== Open / Close =====

  function open() {
    if (isOpenFlag) return;
    isOpenFlag = true;
    scrollY = 0;
    animTick = 0;
  }

  function close() {
    isOpenFlag = false;
  }

  function toggle() {
    if (isOpenFlag) close();
    else open();
  }

  function isOpen() { return isOpenFlag; }

  // ===== Key handling =====

  function handleKey(key) {
    if (!isOpenFlag) return false;

    if (key === 'Escape' || key === 'c' || key === 'C') {
      close();
      return true;
    }
    if (key === 'ArrowLeft' || key === 'a' || key === 'A') {
      selectedTab = (selectedTab - 1 + TABS.length) % TABS.length;
      scrollY = 0;
      return true;
    }
    if (key === 'ArrowRight' || key === 'd' || key === 'D') {
      selectedTab = (selectedTab + 1) % TABS.length;
      scrollY = 0;
      return true;
    }
    if (key === 'ArrowUp' || key === 'w' || key === 'W') {
      scrollY = Math.max(0, scrollY - 30);
      return true;
    }
    if (key === 'ArrowDown' || key === 's' || key === 'S') {
      scrollY += 30;
      return true;
    }
    return true; // consume all keys when open
  }

  // ===== Discovery tracking =====

  function setupListeners() {
    if (typeof EventBus === 'undefined') return;

    // Track fish catches
    EventBus.on('RESOURCE_CHANGED', (data) => {
      if (data.resource === 'fish' && data.delta > 0) {
        // Determine fish quality from delta
        if (data.delta >= 3) discoveredFish.add('large_fish');
        else if (data.delta >= 2) discoveredFish.add('medium_fish');
        else discoveredFish.add('small_fish');
      }
    });

    // Track processed products
    EventBus.on('PROCESSING_COMPLETE', (data) => {
      if (data.output) discoveredProducts.add(data.output);
    });

    // Track crop harvests
    EventBus.on('CROP_HARVESTED', (data) => {
      if (data.crop) discoveredCrops.add(data.crop);
    });
  }

  // ===== State persistence =====

  function getState() {
    return {
      fish: Array.from(discoveredFish),
      products: Array.from(discoveredProducts),
      crops: Array.from(discoveredCrops),
    };
  }

  function loadState(state) {
    if (!state) return;
    if (state.fish) discoveredFish = new Set(state.fish);
    if (state.products) discoveredProducts = new Set(state.products);
    if (state.crops) discoveredCrops = new Set(state.crops);
  }

  // ===== Drawing =====

  function update() {
    if (!isOpenFlag) return;
    animTick++;
  }

  function draw(ctx, canvasW, canvasH, tick) {
    if (!isOpenFlag) return;

    // Dim background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Modal panel
    const panelW = Math.min(canvasW - 20, 360);
    const panelH = Math.min(canvasH - 20, 300);
    const px = (canvasW - panelW) / 2;
    const py = (canvasH - panelH) / 2;

    // Panel background
    ctx.fillStyle = '#1A2A3A';
    ctx.beginPath();
    ctx.roundRect(px, py, panelW, panelH, 6);
    ctx.fill();

    // Border
    ctx.strokeStyle = '#4A6A8A';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(px, py, panelW, panelH, 6);
    ctx.stroke();

    // Title
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('\u{1F3DB} Museum Collection', canvasW / 2, py + 6);

    // Tab bar
    const tabY = py + 22;
    const tabW = panelW / TABS.length;
    for (let i = 0; i < TABS.length; i++) {
      const tx = px + i * tabW;
      const active = i === selectedTab;
      ctx.fillStyle = active ? '#2A4A6A' : '#1A2A3A';
      ctx.fillRect(tx, tabY, tabW, 16);
      ctx.strokeStyle = '#4A6A8A';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(tx, tabY, tabW, 16);
      ctx.fillStyle = active ? '#FFD700' : '#8AAFCF';
      ctx.font = active ? 'bold 7px monospace' : '7px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(TABS[i].label, tx + tabW / 2, tabY + 8);
    }

    // Content area
    const contentY = tabY + 20;
    const contentH = panelH - (contentY - py) - 20;

    ctx.save();
    ctx.beginPath();
    ctx.rect(px + 4, contentY, panelW - 8, contentH);
    ctx.clip();

    switch (selectedTab) {
      case 0: drawLandmarkTab(ctx, px + 8, contentY - scrollY, panelW - 16, tick); break;
      case 1: drawCatalogTab(ctx, px + 8, contentY - scrollY, panelW - 16, tick,
                FISH_CATALOG, discoveredFish, 'Fish'); break;
      case 2: drawCatalogTab(ctx, px + 8, contentY - scrollY, panelW - 16, tick,
                PRODUCT_CATALOG, discoveredProducts, 'Products'); break;
      case 3: drawCatalogTab(ctx, px + 8, contentY - scrollY, panelW - 16, tick,
                CROP_CATALOG, discoveredCrops, 'Crops'); break;
      case 4: drawSkillsTab(ctx, px + 8, contentY - scrollY, panelW - 16, tick); break;
    }

    ctx.restore();

    // Progress bar at bottom
    const progress = getTotalProgress();
    const barY = py + panelH - 16;
    const barW = panelW - 20;
    const barX = px + 10;
    ctx.fillStyle = '#0A1A2A';
    ctx.fillRect(barX, barY, barW, 8);
    ctx.fillStyle = progress >= 1.0 ? '#FFD700' : '#4FC3F7';
    ctx.fillRect(barX, barY, barW * Math.min(1, progress), 8);
    ctx.strokeStyle = '#4A6A8A';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(barX, barY, barW, 8);
    ctx.fillStyle = '#FFF';
    ctx.font = '6px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Total: ${Math.round(progress * 100)}%`, canvasW / 2, barY + 4);

    // Close hint
    ctx.fillStyle = '#666';
    ctx.font = '6px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('[C] or [Esc] to close  |  [\u2190\u2192] tabs  |  [\u2191\u2193] scroll', canvasW / 2, py + panelH - 4);
  }

  function drawLandmarkTab(ctx, x, y, w, tick) {
    const landmarks = typeof LandmarkGenerator !== 'undefined'
      ? LandmarkGenerator.getLandmarkTypes() : {};
    const collection = typeof LandmarkGenerator !== 'undefined'
      ? LandmarkGenerator.getCollection() : [];
    const discoveredCount = typeof LandmarkGenerator !== 'undefined'
      ? LandmarkGenerator.getDiscoveredCount() : 0;

    // Header
    ctx.fillStyle = '#CCC';
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`Discovered: ${discoveredCount} / ${Object.keys(landmarks).length} types`, x, y + 4);

    let rowY = y + 18;
    for (const [typeId, def] of Object.entries(landmarks)) {
      const found = collection.find(c => c.type === typeId);
      const discovered = !!found;

      // Row background
      ctx.fillStyle = discovered ? 'rgba(40, 60, 80, 0.6)' : 'rgba(20, 30, 40, 0.4)';
      ctx.fillRect(x, rowY, w, 22);

      // Icon
      ctx.font = '10px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(discovered ? def.icon : '?', x + 4, rowY + 11);

      // Name
      ctx.font = '7px monospace';
      ctx.fillStyle = discovered ? '#FFF' : '#555';
      ctx.fillText(discovered ? def.name : '???', x + 18, rowY + 8);

      // Rarity badge
      ctx.fillStyle = RARITY_COLORS[def.rarity] || '#AAA';
      ctx.font = '5px monospace';
      ctx.fillText(def.rarity.toUpperCase(), x + 18, rowY + 17);

      // Discovery date
      if (discovered && found.timestamp) {
        const d = new Date(found.timestamp);
        ctx.fillStyle = '#666';
        ctx.font = '5px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(d.toLocaleDateString(), x + w - 4, rowY + 11);
        ctx.textAlign = 'left';
      }

      rowY += 24;
    }
  }

  function drawCatalogTab(ctx, x, y, w, tick, catalog, discovered, label) {
    // Header
    ctx.fillStyle = '#CCC';
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`${label}: ${discovered.size} / ${catalog.length}`, x, y + 4);

    // Progress bar
    const progress = catalog.length > 0 ? discovered.size / catalog.length : 0;
    ctx.fillStyle = '#0A1A2A';
    ctx.fillRect(x, y + 16, w, 6);
    ctx.fillStyle = progress >= 1.0 ? '#FFD700' : '#4FC3F7';
    ctx.fillRect(x, y + 16, w * progress, 6);

    let rowY = y + 28;
    for (const item of catalog) {
      const found = discovered.has(item.id);

      // Row background
      ctx.fillStyle = found ? 'rgba(40, 60, 80, 0.6)' : 'rgba(20, 30, 40, 0.4)';
      ctx.fillRect(x, rowY, w, 20);

      // Icon
      ctx.font = '10px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(found ? item.emoji : '?', x + 4, rowY + 10);

      // Name
      ctx.font = '7px monospace';
      ctx.fillStyle = found ? '#FFF' : '#555';
      ctx.fillText(found ? item.name : '???', x + 18, rowY + 7);

      // Rarity/source
      if (item.rarity) {
        ctx.fillStyle = RARITY_COLORS[item.rarity] || '#AAA';
        ctx.font = '5px monospace';
        ctx.fillText(item.rarity.toUpperCase(), x + 18, rowY + 15);
      } else if (item.source) {
        ctx.fillStyle = '#888';
        ctx.font = '5px monospace';
        ctx.fillText(item.source, x + 18, rowY + 15);
      }

      rowY += 22;
    }
  }

  function drawSkillsTab(ctx, x, y, w, tick) {
    if (typeof SkillSystem === 'undefined') {
      ctx.fillStyle = '#666';
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Skills not available', x + w / 2, y + 30);
      return;
    }

    const SKILL_COLORS = { farming: '#6EBF4E', mining: '#8B8B8B', fishing: '#4FC3F7' };
    let rowY = y + 4;

    for (const [skillId, def] of Object.entries(SkillSystem.SKILLS)) {
      const level = SkillSystem.getLevel(skillId);
      const progress = SkillSystem.getProgress(skillId);
      const xpToNext = SkillSystem.getXpToNext(skillId);
      const totalXp = SkillSystem.getXp(skillId);
      const color = SKILL_COLORS[skillId] || '#AAA';

      // Skill header row
      ctx.fillStyle = 'rgba(30, 45, 60, 0.7)';
      ctx.fillRect(x, rowY, w, 28);

      // Icon + name
      ctx.font = '10px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(def.icon, x + 4, rowY + 10);
      ctx.fillStyle = '#FFF';
      ctx.font = 'bold 8px monospace';
      ctx.fillText(def.name, x + 18, rowY + 8);

      // Level badge
      ctx.fillStyle = color;
      ctx.font = 'bold 7px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`Lv.${level}`, x + w - 4, rowY + 8);

      // XP progress bar
      const barX = x + 18;
      const barY = rowY + 17;
      const barW = w - 26;
      const barH = 6;
      ctx.fillStyle = '#0A1A2A';
      ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = color;
      ctx.fillRect(barX, barY, barW * progress, barH);
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(barX, barY, barW, barH);

      // XP text
      ctx.fillStyle = '#999';
      ctx.font = '5px monospace';
      ctx.textAlign = 'left';
      const xpText = level >= SkillSystem.MAX_LEVEL ? `${totalXp} XP (MAX)` : `${totalXp} XP — ${xpToNext} to next`;
      ctx.fillText(xpText, barX, barY + barH + 6);

      rowY += 34;

      // Perks for this skill
      const allPerks = SkillSystem.getAllPerks(skillId);
      for (const perk of allPerks) {
        ctx.fillStyle = perk.unlocked ? 'rgba(40, 65, 40, 0.5)' : 'rgba(20, 20, 30, 0.4)';
        ctx.fillRect(x + 8, rowY, w - 16, 16);

        // Lock/unlock icon
        ctx.font = '7px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = perk.unlocked ? '#5BEF5B' : '#444';
        ctx.fillText(perk.unlocked ? '\u2713' : '\u{1F512}', x + 12, rowY + 8);

        // Perk name
        ctx.fillStyle = perk.unlocked ? '#FFF' : '#555';
        ctx.font = '6px monospace';
        ctx.fillText(`Lv.${perk.requiredLevel} ${perk.name}`, x + 24, rowY + 6);

        // Perk description
        ctx.fillStyle = perk.unlocked ? '#AAA' : '#444';
        ctx.font = '5px monospace';
        ctx.fillText(perk.desc, x + 24, rowY + 13);

        rowY += 18;
      }

      rowY += 6; // gap between skills
    }
  }

  function getTotalProgress() {
    const landmarkTypes = typeof LandmarkGenerator !== 'undefined'
      ? Object.keys(LandmarkGenerator.getLandmarkTypes()).length : 5;
    const landmarkDiscovered = typeof LandmarkGenerator !== 'undefined'
      ? LandmarkGenerator.getDiscoveredCount() : 0;

    const totalItems = landmarkTypes + FISH_CATALOG.length + PRODUCT_CATALOG.length + CROP_CATALOG.length;
    const totalDiscovered = Math.min(landmarkDiscovered, landmarkTypes)
      + discoveredFish.size + discoveredProducts.size + discoveredCrops.size;

    return totalItems > 0 ? totalDiscovered / totalItems : 0;
  }

  function getCompletionPercent() {
    return Math.round(getTotalProgress() * 100);
  }

  return {
    open,
    close,
    toggle,
    isOpen,
    handleKey,
    setupListeners,
    getState,
    loadState,
    update,
    draw,
    getCompletionPercent,
  };
})();

if (typeof module !== 'undefined') module.exports = CollectionUI;
