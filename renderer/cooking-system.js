/**
 * cooking-system.js — Culinary Arts for AIFarm 3.0 (Sprint 23 P1).
 *
 * Fireplace cooking inside the cabin. Recipes consume resources,
 * produce food items with buffs (stamina restore, speed boost, pet buff).
 * Modal UI opened by pressing [E] near the fireplace in interior mode.
 */
const CookingSystem = (() => {
  // ===== Recipes =====
  const RECIPES = [
    {
      id: 'roasted_fish',
      name: 'Roasted Fish',
      icon: '\u{1F41F}', // 🐟
      desc: 'Restore 100% stamina',
      ingredients: [{ resource: 'fish', amount: 1 }, { resource: 'wood', amount: 1 }],
      effect: { type: 'stamina_restore', value: 1.0 },
    },
    {
      id: 'artisan_bread',
      name: 'Artisan Bread',
      icon: '\u{1F35E}', // 🍞
      desc: '+15% speed, half stamina drain (3 min)',
      ingredients: [{ resource: 'flour', amount: 2 }],
      effect: { type: 'buff', buffId: 'well_fed', duration: 3 * 60 * 60, speedMod: 1.15, staminaMod: 0.5 },
    },
    {
      id: 'dog_treat',
      name: 'Premium Dog Treat',
      icon: '\u{1F9B4}', // 🦴
      desc: 'Dog finds rare items for 5 min',
      ingredients: [{ resource: 'fish', amount: 1 }, { resource: 'flour', amount: 1 }],
      effect: { type: 'pet_buff', buffId: 'treat_boost', duration: 5 * 60 * 60 },
    },
  ];

  // ===== Modal state =====
  let isOpenFlag = false;
  let selectedIndex = 0;
  let animTick = 0;

  // ===== Cooking animation =====
  let cookingAnim = null; // { recipe, startTick, duration }
  const COOK_DURATION = 90; // ~1.5s at 60fps

  // ===== Active buffs =====
  let buffs = {}; // buffId → { remaining, ...effect }

  // ===== Open / Close =====

  function open() {
    if (isOpenFlag) return;
    if (cookingAnim) return; // don't open during cooking
    isOpenFlag = true;
    selectedIndex = 0;
    animTick = 0;
  }

  function close() {
    isOpenFlag = false;
  }

  function isOpen() { return isOpenFlag; }

  // ===== Proximity check =====

  /** Check if player is near fireplace in cabin interior. */
  function isNearFireplace() {
    if (typeof SceneManager === 'undefined' || !SceneManager.isInterior()) return false;
    if (SceneManager.getInteriorId() !== 'cabin') return false;
    if (typeof Player === 'undefined') return false;
    const pt = Player.getTile();
    // Fireplace is at col:1, row:1 in cabin
    return Math.abs(pt.col - 1) <= 1 && Math.abs(pt.row - 1) <= 1;
  }

  // ===== Cooking logic =====

  function canCook(recipe) {
    if (typeof ResourceInventory === 'undefined') return false;
    for (const ing of recipe.ingredients) {
      if (!ResourceInventory.has(ing.resource, ing.amount)) return false;
    }
    return true;
  }

  function cook(recipe, tick) {
    if (!canCook(recipe)) return false;

    // Spend ingredients
    for (const ing of recipe.ingredients) {
      ResourceInventory.spend(ing.resource, ing.amount);
    }

    // Close menu and start cooking animation
    close();
    cookingAnim = { recipe, startTick: tick, duration: COOK_DURATION };
    return true;
  }

  function finishCooking(tick) {
    if (!cookingAnim) return;
    const recipe = cookingAnim.recipe;
    cookingAnim = null;

    // Apply effect
    applyEffect(recipe.effect, tick);

    // Event for audio system
    if (typeof EventBus !== 'undefined') {
      EventBus.emit('FOOD_COOKED', { recipe: recipe.id, name: recipe.name, icon: recipe.icon });
    }

    // Log
    if (typeof Farm !== 'undefined' && Farm.logEvent) {
      Farm.logEvent(recipe.icon, `Cooked ${recipe.name}!`);
    }

    // Skill XP for cooking (farming XP)
    if (typeof SkillSystem !== 'undefined') {
      SkillSystem.addXp('farming', 5);
    }
  }

  function applyEffect(effect, tick) {
    if (effect.type === 'stamina_restore') {
      // Instant full stamina restore
      if (typeof Player !== 'undefined' && Player.restoreStamina) {
        Player.restoreStamina(effect.value);
      }
    } else if (effect.type === 'buff') {
      buffs[effect.buffId] = {
        remaining: effect.duration,
        speedMod: effect.speedMod || 1.0,
        staminaMod: effect.staminaMod || 1.0,
      };
    } else if (effect.type === 'pet_buff') {
      buffs[effect.buffId] = {
        remaining: effect.duration,
      };
      // Notify pet AI
      if (typeof PetAI !== 'undefined' && PetAI.applyTreatBuff) {
        PetAI.applyTreatBuff(effect.duration);
      }
    }
  }

  // ===== Buff management =====

  function updateBuffs() {
    for (const [id, buff] of Object.entries(buffs)) {
      buff.remaining--;
      if (buff.remaining <= 0) {
        delete buffs[id];
      }
    }
  }

  /** Get combined speed modifier from active buffs. */
  function getSpeedMod() {
    let mod = 1.0;
    for (const buff of Object.values(buffs)) {
      if (buff.speedMod) mod *= buff.speedMod;
    }
    return mod;
  }

  /** Get combined stamina drain modifier from active buffs. */
  function getStaminaMod() {
    let mod = 1.0;
    for (const buff of Object.values(buffs)) {
      if (buff.staminaMod) mod *= buff.staminaMod;
    }
    return mod;
  }

  /** Check if pet treat buff is active. */
  function hasTreatBuff() {
    return !!buffs['treat_boost'];
  }

  /** Get active buff list for HUD display. */
  function getActiveBuffs() {
    const result = [];
    if (buffs['well_fed']) {
      const secs = Math.ceil(buffs['well_fed'].remaining / 60);
      result.push({ id: 'well_fed', icon: '\u{1F35E}', label: 'Well Fed', remaining: secs });
    }
    if (buffs['treat_boost']) {
      const secs = Math.ceil(buffs['treat_boost'].remaining / 60);
      result.push({ id: 'treat_boost', icon: '\u{1F9B4}', label: 'Dog Treat', remaining: secs });
    }
    return result;
  }

  // ===== Key handling =====

  function handleKey(key, tick) {
    if (!isOpenFlag) return false;

    if (key === 'Escape' || key === 'e' || key === 'E') {
      close();
      return true;
    }
    if (key === 'ArrowUp' || key === 'w' || key === 'W') {
      selectedIndex = (selectedIndex - 1 + RECIPES.length) % RECIPES.length;
      if (typeof AudioManager !== 'undefined') AudioManager.playUIClick();
      return true;
    }
    if (key === 'ArrowDown' || key === 's' || key === 'S') {
      selectedIndex = (selectedIndex + 1) % RECIPES.length;
      if (typeof AudioManager !== 'undefined') AudioManager.playUIClick();
      return true;
    }
    if (key === 'Enter' || key === ' ') {
      const recipe = RECIPES[selectedIndex];
      if (canCook(recipe)) {
        cook(recipe, tick);
      } else {
        if (typeof AudioManager !== 'undefined') AudioManager.playErrorBuzzer();
      }
      return true;
    }
    return true; // consume all keys when open
  }

  // ===== Update =====

  function update(tick) {
    if (isOpenFlag) animTick++;

    // Update cooking animation
    if (cookingAnim) {
      const elapsed = tick - cookingAnim.startTick;
      if (elapsed >= cookingAnim.duration) {
        finishCooking(tick);
      }
    }

    // Update buff timers
    updateBuffs();
  }

  // ===== Drawing =====

  function draw(ctx, canvasW, canvasH, tick) {
    // Draw cooking animation (steam particles above fireplace)
    if (cookingAnim) {
      drawCookingAnim(ctx, canvasW, canvasH, tick);
    }

    // Draw buff icons on HUD
    drawBuffHUD(ctx, canvasW, canvasH, tick);

    // Draw fireplace prompt
    if (!isOpenFlag && !cookingAnim && isNearFireplace()) {
      drawPrompt(ctx, canvasW, canvasH);
    }

    // Draw cooking menu modal
    if (isOpenFlag) {
      drawModal(ctx, canvasW, canvasH, tick);
    }
  }

  function drawPrompt(ctx, canvasW, canvasH) {
    const text = '\u{2668}\u{FE0F} Press [E] to Cook';
    ctx.font = 'bold 9px monospace';
    const tw = ctx.measureText(text).width;
    const px = (canvasW - tw) / 2 - 8;
    const py = canvasH - 58;

    ctx.fillStyle = 'rgba(60, 20, 10, 0.85)';
    ctx.beginPath();
    ctx.roundRect(px, py, tw + 16, 18, 4);
    ctx.fill();

    ctx.fillStyle = '#FF9944';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvasW / 2, py + 9);
  }

  function drawModal(ctx, canvasW, canvasH, tick) {
    // Dim background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Modal panel
    const panelW = Math.min(canvasW - 20, 280);
    const panelH = Math.min(canvasH - 30, 200);
    const px = (canvasW - panelW) / 2;
    const py = (canvasH - panelH) / 2;

    // Entrance bounce
    const bounce = animTick < 12 ? (1 - Math.pow(1 - animTick / 12, 3)) : 1;
    ctx.save();
    ctx.translate(canvasW / 2, canvasH / 2);
    ctx.scale(bounce, bounce);
    ctx.translate(-canvasW / 2, -canvasH / 2);

    // Background
    ctx.fillStyle = '#2A1510';
    ctx.beginPath();
    ctx.roundRect(px, py, panelW, panelH, 6);
    ctx.fill();

    // Border
    ctx.strokeStyle = '#8B4513';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(px, py, panelW, panelH, 6);
    ctx.stroke();

    // Title
    ctx.fillStyle = '#FF9944';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('\u{2668}\u{FE0F} Cooking Menu', canvasW / 2, py + 6);

    // Recipe list
    let rowY = py + 24;
    for (let i = 0; i < RECIPES.length; i++) {
      const recipe = RECIPES[i];
      const selected = i === selectedIndex;
      const affordable = canCook(recipe);

      // Row background
      ctx.fillStyle = selected ? 'rgba(139, 69, 19, 0.6)' : 'rgba(42, 21, 16, 0.4)';
      ctx.fillRect(px + 4, rowY, panelW - 8, 44);
      if (selected) {
        ctx.strokeStyle = '#FFD700';
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 4, rowY, panelW - 8, 44);
      }

      // Icon
      ctx.font = '14px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(recipe.icon, px + 10, rowY + 14);

      // Name
      ctx.font = 'bold 8px monospace';
      ctx.fillStyle = affordable ? '#FFF' : '#666';
      ctx.fillText(recipe.name, px + 30, rowY + 10);

      // Description
      ctx.font = '6px monospace';
      ctx.fillStyle = affordable ? '#CCC' : '#555';
      ctx.fillText(recipe.desc, px + 30, rowY + 21);

      // Ingredients
      ctx.font = '6px monospace';
      const ingParts = recipe.ingredients.map(ing => {
        const have = typeof ResourceInventory !== 'undefined' ? ResourceInventory.get(ing.resource) : 0;
        const enough = have >= ing.amount;
        return { text: `${ing.resource} ${have}/${ing.amount}`, enough };
      });

      let ingX = px + 30;
      for (const part of ingParts) {
        ctx.fillStyle = part.enough ? '#8BC34A' : '#FF5555';
        ctx.fillText(part.text, ingX, rowY + 32);
        ingX += ctx.measureText(part.text).width + 8;
      }

      // Cook button hint (selected + affordable)
      if (selected && affordable) {
        ctx.fillStyle = '#FFD700';
        ctx.font = 'bold 7px monospace';
        ctx.textAlign = 'right';
        ctx.fillText('[Enter] Cook', px + panelW - 10, rowY + 14);
        ctx.textAlign = 'left';
      }

      rowY += 48;
    }

    // Close hint
    ctx.fillStyle = '#666';
    ctx.font = '6px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('[E/Esc] close  |  [\u2191\u2193] select  |  [Enter] cook', canvasW / 2, py + panelH - 8);

    ctx.restore();
  }

  function drawCookingAnim(ctx, canvasW, canvasH, tick) {
    if (!cookingAnim) return;
    const elapsed = tick - cookingAnim.startTick;
    const progress = elapsed / cookingAnim.duration;

    // Steam particles rising from center of screen
    const cx = canvasW / 2;
    const baseY = canvasH / 2 + 10;

    ctx.save();
    for (let i = 0; i < 8; i++) {
      const age = (elapsed + i * 11) % 40;
      const alpha = 1 - age / 40;
      const offsetX = Math.sin((elapsed + i * 17) * 0.15) * 12;
      const offsetY = -age * 1.5;
      ctx.globalAlpha = alpha * 0.6;
      ctx.fillStyle = '#FFF';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('\u{2668}\u{FE0F}', cx + offsetX, baseY + offsetY);
    }

    // Food popup at end
    if (progress > 0.7) {
      const popAlpha = (progress - 0.7) / 0.3;
      ctx.globalAlpha = popAlpha;
      ctx.font = 'bold 16px monospace';
      ctx.fillStyle = '#FFD700';
      ctx.textAlign = 'center';
      ctx.fillText(cookingAnim.recipe.icon, cx, baseY - 50);
      ctx.font = 'bold 10px monospace';
      ctx.fillText('+1 ' + cookingAnim.recipe.name, cx, baseY - 35);
    }
    ctx.restore();
  }

  function drawBuffHUD(ctx, canvasW, canvasH, tick) {
    const active = getActiveBuffs();
    if (active.length === 0) return;

    // Draw buff icons in top-right area
    let bx = canvasW - 8;
    const by = 8;

    ctx.save();
    for (const buff of active) {
      const iconW = 32;
      bx -= iconW;

      // Background
      ctx.fillStyle = 'rgba(20, 10, 5, 0.7)';
      ctx.beginPath();
      ctx.roundRect(bx, by, iconW, 20, 3);
      ctx.fill();

      // Icon
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(buff.icon, bx + 10, by + 10);

      // Timer
      const mins = Math.floor(buff.remaining / 60);
      const secs = buff.remaining % 60;
      ctx.font = '5px monospace';
      ctx.fillStyle = '#FFD700';
      ctx.fillText(`${mins}:${secs.toString().padStart(2, '0')}`, bx + 24, by + 10);

      bx -= 4; // gap
    }
    ctx.restore();
  }

  // ===== Public API =====

  return {
    RECIPES,
    open,
    close,
    isOpen,
    isNearFireplace,
    canCook,
    handleKey,
    update,
    draw,
    getSpeedMod,
    getStaminaMod,
    hasTreatBuff,
    getActiveBuffs,
    isCooking: () => !!cookingAnim,
  };
})();

if (typeof module !== 'undefined') module.exports = CookingSystem;
