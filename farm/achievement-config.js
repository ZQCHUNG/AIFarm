// Achievement definitions — titles, tiers, and conditions.
// CommonJS module, used only in main process.

// Tier levels: higher tiers have higher thresholds
const TIERS = {
  silver:  { label: 'Silver',  color: '#C0C0C0', multiplier: 1 },
  gold:    { label: 'Gold',    color: '#FFD700', multiplier: 2 },
  diamond: { label: 'Diamond', color: '#B9F2FF', multiplier: 5 },
};

// Achievement definitions
// Each has: id, title, description, icon, tiers (array of { tier, threshold, description })
// Tracker type: 'counter' (increment), 'flag' (one-time), 'max' (highest value)
const ACHIEVEMENTS = [
  {
    id: 'refiner',
    title: 'The Refiner',
    description: 'Thinking → writing cycles',
    icon: '\u{1F52C}', // microscope
    tracker: 'counter',
    tiers: [
      { tier: 'silver',  threshold: 10,  description: '10 think→write cycles' },
      { tier: 'gold',    threshold: 50,  description: '50 think→write cycles' },
      { tier: 'diamond', threshold: 200, description: '200 think→write cycles' },
    ],
  },
  {
    id: 'architect',
    title: 'The Architect',
    description: 'Files edited in a single session',
    icon: '\u{1F3D7}', // building construction
    tracker: 'max',
    tiers: [
      { tier: 'silver',  threshold: 5,   description: 'Edit 5 files in one session' },
      { tier: 'gold',    threshold: 15,  description: 'Edit 15 files in one session' },
      { tier: 'diamond', threshold: 40,  description: 'Edit 40 files in one session' },
    ],
  },
  {
    id: 'burner',
    title: 'The Burner',
    description: 'Token output in a single session',
    icon: '\u{1F525}', // fire
    tracker: 'max',
    tiers: [
      { tier: 'silver',  threshold: 50000,  description: '50k tokens in one session' },
      { tier: 'gold',    threshold: 200000, description: '200k tokens in one session' },
      { tier: 'diamond', threshold: 500000, description: '500k tokens in one session' },
    ],
  },
  {
    id: 'earlyBird',
    title: 'Early Bird',
    description: 'Active before 7am',
    icon: '\u{1F305}', // sunrise
    tracker: 'counter',
    tiers: [
      { tier: 'silver',  threshold: 3,  description: 'Code before 7am 3 times' },
      { tier: 'gold',    threshold: 10, description: 'Code before 7am 10 times' },
      { tier: 'diamond', threshold: 30, description: 'Code before 7am 30 times' },
    ],
  },
  {
    id: 'nightOwl',
    title: 'Night Owl',
    description: 'Active past midnight',
    icon: '\u{1F989}', // owl
    tracker: 'counter',
    tiers: [
      { tier: 'silver',  threshold: 3,  description: 'Code past midnight 3 times' },
      { tier: 'gold',    threshold: 10, description: 'Code past midnight 10 times' },
      { tier: 'diamond', threshold: 30, description: 'Code past midnight 30 times' },
    ],
  },
  {
    id: 'marathon',
    title: 'Marathon Runner',
    description: 'Longest session duration (hours)',
    icon: '\u{1F3C3}', // runner
    tracker: 'max',
    tiers: [
      { tier: 'silver',  threshold: 2,  description: '2-hour session' },
      { tier: 'gold',    threshold: 5,  description: '5-hour session' },
      { tier: 'diamond', threshold: 10, description: '10-hour session' },
    ],
  },
  {
    id: 'townBuilder',
    title: 'Town Builder',
    description: 'Buildings constructed',
    icon: '\u{1F3D8}', // cityscape
    tracker: 'counter',
    tiers: [
      { tier: 'silver',  threshold: 3, description: 'Build 3 buildings' },
      { tier: 'gold',    threshold: 5, description: 'Build 5 buildings' },
      { tier: 'diamond', threshold: 7, description: 'Build all 7 buildings' },
    ],
  },
  {
    id: 'harvestMaster',
    title: 'Harvest Master',
    description: 'Total crops harvested',
    icon: '\u{1F33E}', // rice
    tracker: 'counter',
    tiers: [
      { tier: 'silver',  threshold: 25,  description: '25 harvests' },
      { tier: 'gold',    threshold: 100, description: '100 harvests' },
      { tier: 'diamond', threshold: 500, description: '500 harvests' },
    ],
  },
  {
    id: 'collaborator',
    title: 'Team Player',
    description: 'Peak concurrent buddies',
    icon: '\u{1F91D}', // handshake
    tracker: 'max',
    tiers: [
      { tier: 'silver',  threshold: 3, description: '3 buddies at once' },
      { tier: 'gold',    threshold: 5, description: '5 buddies at once' },
      { tier: 'diamond', threshold: 8, description: '8 buddies at once' },
    ],
  },
  {
    id: 'goat',
    title: 'G.O.A.T.',
    description: 'Greatest of All Time — legendary session',
    icon: '\u{1F3C6}', // trophy
    tracker: 'flag',
    tiers: [
      { tier: 'diamond', threshold: 1, description: '1M tokens or 8h session' },
    ],
  },
];

module.exports = { TIERS, ACHIEVEMENTS };
