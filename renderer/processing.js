/**
 * processing.js — Processing Buildings for AIFarm 3.0 (Sprint 17 P0).
 *
 * Mill: Corn (2) → Flour (1) — sell price 10g×2=20g input → 18g output + time value
 * Workshop: Wood (3) → Plank (1) — sell price 2g×3=6g input → 8g output + time value
 *
 * Buildings unlock via energy milestones (farm-config.js) or shop permits.
 * Processing is automatic when building is unlocked and resources are available.
 */
const Processing = (() => {
  // Processing recipes
  const RECIPES = {
    mill: {
      name: 'Mill',
      icon: '\u{1F33E}',
      input: 'corn',
      inputAmount: 2,
      output: 'flour',
      outputAmount: 1,
      duration: 600, // ~10 seconds at 60fps
    },
    workshop: {
      name: 'Workshop',
      icon: '\u{1FA93}',
      input: 'wood',
      inputAmount: 3,
      output: 'plank',
      outputAmount: 1,
      duration: 480, // ~8 seconds at 60fps
    },
  };

  // Processing state per building
  const state = {
    mill: { processing: false, progress: 0, totalProcessed: 0 },
    workshop: { processing: false, progress: 0, totalProcessed: 0 },
  };

  /** Check if a processing building is unlocked (via energy milestone or permit). */
  function isUnlocked(id) {
    const farmState = (typeof Farm !== 'undefined') ? Farm.getState() : null;
    return farmState && farmState.buildings && farmState.buildings[id];
  }

  /** Main update — runs each frame. */
  function update() {
    if (typeof ResourceInventory === 'undefined') return;

    for (const [id, recipe] of Object.entries(RECIPES)) {
      if (!isUnlocked(id)) continue;

      const s = state[id];
      if (s.processing) {
        s.progress++;
        if (s.progress >= recipe.duration) {
          // Processing complete — add output
          ResourceInventory.add(recipe.output, recipe.outputAmount);
          s.processing = false;
          s.progress = 0;
          s.totalProcessed++;

          if (typeof EventBus !== 'undefined') {
            EventBus.emit('PROCESSING_COMPLETE', {
              building: id,
              output: recipe.output,
              amount: recipe.outputAmount,
            });
          }
        }
      } else {
        // Try to start processing (auto-feed when resources available)
        if (ResourceInventory.has(recipe.input, recipe.inputAmount)) {
          ResourceInventory.spend(recipe.input, recipe.inputAmount);
          s.processing = true;
          s.progress = 0;
        }
      }
    }
  }

  /** Get processing progress 0-1 for a building. */
  function getProgress(id) {
    const s = state[id];
    if (!s || !s.processing) return 0;
    const recipe = RECIPES[id];
    return s.progress / recipe.duration;
  }

  /** Check if currently processing. */
  function isProcessing(id) {
    const s = state[id];
    return s && s.processing;
  }

  /** Get recipe info for a building. */
  function getRecipe(id) {
    return RECIPES[id] || null;
  }

  /** Handle shop permit purchase. */
  function handlePermit(itemId) {
    if (itemId === 'mill_permit') {
      if (typeof window !== 'undefined' && window.buddy && window.buddy.unlockBuilding) {
        window.buddy.unlockBuilding('mill');
      }
    } else if (itemId === 'workshop_permit') {
      if (typeof window !== 'undefined' && window.buddy && window.buddy.unlockBuilding) {
        window.buddy.unlockBuilding('workshop');
      }
    }
  }

  return {
    RECIPES,
    update,
    getProgress,
    isProcessing,
    isUnlocked,
    getRecipe,
    handlePermit,
  };
})();

if (typeof module !== 'undefined') module.exports = Processing;
