// Farm configuration — all constants for the farming simulation.
// CommonJS module, used only in main process.

const ENERGY_PER_EVENT = {
  tool_use: 3,
  thinking: 2,
  text: 1,
  bash_progress: 2,
  mcp_progress: 2,
  user: 0,
};

// Collaboration bonus: 3+ active buddies → ×1.5
const COLLAB_THRESHOLD = 3;
const COLLAB_MULTIPLIER = 1.5;

// Crops: ordered by unlock energy
const CROPS = [
  { id: 'carrot',    unlock: 50,   growCost: 15, color: '#FF8C00' },
  { id: 'sunflower', unlock: 150,  growCost: 20, color: '#FFD700' },
  { id: 'watermelon',unlock: 300,  growCost: 30, color: '#2E8B57' },
  { id: 'tomato',    unlock: 500,  growCost: 20, color: '#FF4444' },
  { id: 'corn',      unlock: 800,  growCost: 25, color: '#F0E68C' },
  { id: 'pumpkin',   unlock: 1200, growCost: 35, color: '#FF7518' },
];

// 5 growth stages: 0=empty, 1=seed, 2=sprout, 3=growing, 4=mature (harvest flash → replant)
const GROWTH_STAGES = 5;

// 12 plots, unlocked in batches
const TOTAL_PLOTS = 12;
const PLOT_UNLOCK = [
  { energy: 0,    start: 0, end: 3 },   // plots 0-2
  { energy: 500,  start: 3, end: 6 },   // plots 3-5
  { energy: 1800, start: 6, end: 9 },   // plots 6-8
  { energy: 5000, start: 9, end: 12 },  // plots 9-11
];

// Animals: ordered by unlock energy
const ANIMALS = [
  { id: 'chicken', unlock: 500,  w: 5, h: 4 },
  { id: 'cow',     unlock: 800,  w: 7, h: 5 },
  { id: 'pig',     unlock: 1200, w: 6, h: 4 },
  { id: 'sheep',   unlock: 1800, w: 6, h: 5 },
  { id: 'cat',     unlock: 2500, w: 4, h: 4 },
  { id: 'dog',     unlock: 3500, w: 5, h: 4 },
];

// Buildings: ordered by unlock energy, placed left to right
const BUILDINGS = [
  { id: 'well',     unlock: 1200, w: 6,  h: 7 },
  { id: 'barn',     unlock: 1800, w: 14, h: 10 },
  { id: 'windmill', unlock: 2500, w: 10, h: 12 },
  { id: 'market',   unlock: 3500, w: 12, h: 7 },
  { id: 'clock',    unlock: 5000, w: 8,  h: 14 },
  { id: 'townhall', unlock: 7500, w: 16, h: 11 },
  { id: 'statue',   unlock: 10000,w: 5,  h: 8 },
];

// Milestones — each threshold unlocks content (for display/notification)
const MILESTONES = [
  { energy: 50,    emoji: '\u{1F955}', label: 'First Seed' },
  { energy: 150,   emoji: '\u{1F33B}', label: 'Gardener' },
  { energy: 300,   emoji: '\u{1F349}', label: 'Green Thumb' },
  { energy: 500,   emoji: '\u{1F345}', label: 'Farmer' },
  { energy: 800,   emoji: '\u{1F33D}', label: 'Rancher' },
  { energy: 1200,  emoji: '\u{1F383}', label: 'Pioneer' },
  { energy: 1800,  emoji: '\u{1F411}', label: 'Villager' },
  { energy: 2500,  emoji: '\u{1F431}', label: 'Town Founder' },
  { energy: 3500,  emoji: '\u{1F415}', label: 'Thriving Town' },
  { energy: 5000,  emoji: '\u{1F550}', label: 'Prosperous Village' },
  { energy: 7500,  emoji: '\u{1F3DB}', label: 'Metropolis' },
  { energy: 10000, emoji: '\u{1F5FF}', label: 'Legend' },
];

const SAVE_PATH = require('path').join(__dirname, 'farm-state.json');
const AUTO_SAVE_INTERVAL = 30000; // 30 seconds

module.exports = {
  ENERGY_PER_EVENT,
  COLLAB_THRESHOLD,
  COLLAB_MULTIPLIER,
  CROPS,
  GROWTH_STAGES,
  TOTAL_PLOTS,
  PLOT_UNLOCK,
  ANIMALS,
  BUILDINGS,
  MILESTONES,
  SAVE_PATH,
  AUTO_SAVE_INTERVAL,
};
