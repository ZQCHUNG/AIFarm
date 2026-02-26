/**
 * skill-system.js — Skill Progression System (Sprint 23 P0).
 *
 * Three skill branches: Farming, Mining, Fishing.
 * XP gained from player actions, levels unlock perks.
 * State persisted via IPC to farm-state.json.
 */
const SkillSystem = (() => {
  // ===== Skill definitions =====
  const SKILLS = {
    farming: {
      name: 'Farming',
      icon: '\u{1F33E}',
      description: 'Grow crops, harvest bounties',
    },
    mining: {
      name: 'Mining',
      icon: '\u{26CF}',
      description: 'Break rocks, find gems',
    },
    fishing: {
      name: 'Fishing',
      icon: '\u{1F3A3}',
      description: 'Catch fish, master the rod',
    },
  };

  // XP required per level (cumulative thresholds)
  // Level 1→2: 100 XP, 2→3: 250, 3→4: 500, etc.
  const LEVEL_THRESHOLDS = [0, 100, 250, 500, 850, 1300, 1900, 2700, 3800, 5200, 7000];
  const MAX_LEVEL = LEVEL_THRESHOLDS.length - 1;

  // Perks unlocked at each level per skill
  const PERKS = {
    farming: {
      2: { id: 'green_thumb', name: 'Green Thumb', desc: 'Crops grow 10% faster' },
      4: { id: 'bountiful', name: 'Bountiful Harvest', desc: '+1 crop per harvest' },
      6: { id: 'master_farmer', name: 'Master Farmer', desc: 'Rare crop chance +15%' },
      8: { id: 'golden_fields', name: 'Golden Fields', desc: 'Crops sell for 20% more' },
    },
    mining: {
      2: { id: 'keen_eye', name: 'Keen Eye', desc: '+10% gem chance from rocks' },
      4: { id: 'deep_strike', name: 'Deep Strike', desc: '+1 stone per mine' },
      6: { id: 'geologist', name: 'Geologist', desc: 'Rare ore discovery chance' },
      8: { id: 'master_miner', name: 'Master Miner', desc: 'Double mining yields' },
    },
    fishing: {
      2: { id: 'patience', name: 'Patience', desc: '+15 frames reaction window' },
      4: { id: 'lucky_hook', name: 'Lucky Hook', desc: 'Better fish quality odds' },
      6: { id: 'deep_cast', name: 'Deep Cast', desc: 'Faster bite chance' },
      8: { id: 'master_angler', name: 'Master Angler', desc: 'Rare fish chance +25%' },
    },
  };

  // ===== State =====
  let skills = {
    farming: { level: 1, xp: 0 },
    mining:  { level: 1, xp: 0 },
    fishing: { level: 1, xp: 0 },
  };

  // ===== Core API =====

  function init(savedState) {
    if (savedState) {
      for (const key of Object.keys(SKILLS)) {
        if (savedState[key]) {
          skills[key] = {
            level: savedState[key].level || 1,
            xp: savedState[key].xp || 0,
          };
        }
      }
    }
  }

  function addXp(skillId, amount) {
    const skill = skills[skillId];
    if (!skill) return;
    if (skill.level >= MAX_LEVEL) return; // already maxed

    skill.xp += amount;

    // Check for level-ups (can gain multiple levels at once)
    while (skill.level < MAX_LEVEL && skill.xp >= LEVEL_THRESHOLDS[skill.level]) {
      skill.level++;
      const perk = PERKS[skillId] && PERKS[skillId][skill.level];

      if (typeof EventBus !== 'undefined') {
        EventBus.emit('SKILL_LEVELUP', {
          skill: skillId,
          newLevel: skill.level,
          perk: perk || null,
        });
      }

      // Show level-up notification
      if (typeof Farm !== 'undefined' && Farm.logEvent) {
        const def = SKILLS[skillId];
        const perkText = perk ? ` — ${perk.name}!` : '';
        Farm.logEvent(def.icon, `${def.name} Level ${skill.level}${perkText}`);
      }
    }

    // Persist skills state after XP change
    _saveState();
  }

  /** Debounced save to main process. */
  let _saveTimer = null;
  function _saveState() {
    if (_saveTimer) return; // already scheduled
    _saveTimer = setTimeout(() => {
      _saveTimer = null;
      if (typeof window !== 'undefined' && window.buddy && window.buddy.saveSkills) {
        window.buddy.saveSkills(getState());
      }
    }, 2000); // batch saves: max once every 2s
  }

  function getLevel(skillId) {
    return skills[skillId] ? skills[skillId].level : 1;
  }

  function getXp(skillId) {
    return skills[skillId] ? skills[skillId].xp : 0;
  }

  /** Get XP progress toward next level as 0..1 ratio. */
  function getProgress(skillId) {
    const skill = skills[skillId];
    if (!skill || skill.level >= MAX_LEVEL) return 1;
    const prevThreshold = LEVEL_THRESHOLDS[skill.level - 1] || 0;
    const nextThreshold = LEVEL_THRESHOLDS[skill.level];
    const range = nextThreshold - prevThreshold;
    if (range <= 0) return 1;
    return Math.min(1, (skill.xp - prevThreshold) / range);
  }

  /** Get XP needed for next level. */
  function getXpToNext(skillId) {
    const skill = skills[skillId];
    if (!skill || skill.level >= MAX_LEVEL) return 0;
    return LEVEL_THRESHOLDS[skill.level] - skill.xp;
  }

  /** Check if a specific perk is unlocked. */
  function hasPerk(skillId, perkId) {
    const skillPerks = PERKS[skillId];
    if (!skillPerks) return false;
    const level = getLevel(skillId);
    for (const [lvl, perk] of Object.entries(skillPerks)) {
      if (perk.id === perkId && level >= parseInt(lvl)) return true;
    }
    return false;
  }

  /** Get all unlocked perks for a skill. */
  function getUnlockedPerks(skillId) {
    const skillPerks = PERKS[skillId];
    if (!skillPerks) return [];
    const level = getLevel(skillId);
    const result = [];
    for (const [lvl, perk] of Object.entries(skillPerks)) {
      if (level >= parseInt(lvl)) {
        result.push({ ...perk, unlockedAt: parseInt(lvl) });
      }
    }
    return result;
  }

  /** Get all perks (unlocked + locked) for UI display. */
  function getAllPerks(skillId) {
    const skillPerks = PERKS[skillId];
    if (!skillPerks) return [];
    const level = getLevel(skillId);
    const result = [];
    for (const [lvl, perk] of Object.entries(skillPerks)) {
      result.push({
        ...perk,
        requiredLevel: parseInt(lvl),
        unlocked: level >= parseInt(lvl),
      });
    }
    return result;
  }

  /** Get full state for persistence. */
  function getState() {
    return JSON.parse(JSON.stringify(skills));
  }

  // ===== EventBus integration =====

  function setupListeners() {
    if (typeof EventBus === 'undefined') return;

    // Farming XP from crop harvests
    EventBus.on('CROP_HARVESTED', (data) => {
      const baseXp = 3;
      addXp('farming', baseXp * (data.amount || 1));
    });

    // Mining XP from rocks
    EventBus.on('ROCK_MINED', (data) => {
      addXp('mining', 5 * (data.amount || 1));
    });

    // Fishing XP from catches
    EventBus.on('FISH_CAUGHT', (data) => {
      // Better quality fish = more XP
      const qualityBonus = (data.quality || 0) + 1;
      addXp('fishing', 4 * qualityBonus);
    });

    // Bonus farming XP from tree chopping
    EventBus.on('TREE_CHOPPED', (data) => {
      addXp('farming', 1);
    });
  }

  return {
    SKILLS,
    PERKS,
    LEVEL_THRESHOLDS,
    MAX_LEVEL,
    init,
    addXp,
    getLevel,
    getXp,
    getProgress,
    getXpToNext,
    hasPerk,
    getUnlockedPerks,
    getAllPerks,
    getState,
    setupListeners,
  };
})();

if (typeof module !== 'undefined') module.exports = SkillSystem;
