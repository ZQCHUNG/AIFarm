/**
 * audio-manager.js — Procedural 8-bit Audio Engine (Sprint 23 P2, expanded Sprint 24).
 *
 * Pure Web Audio API synthesis — no external audio files.
 * AudioContext unlocked on first user interaction (click/keydown).
 * ADSR envelope on all tones to prevent clicking/popping.
 *
 * Sound library:
 *   playUIClick()      — short crisp click for menu navigation
 *   playHarvestPop()   — upward frequency sweep for resource gain
 *   playErrorBuzzer()  — low buzz for failures/denials
 *   playLevelUp()      — celebratory arpeggio for skill level-ups
 *   playCookDone()     — warm completion chime for cooking
 *   playBuildHammer()  — sawtooth percussive hit for construction
 *   playWoodChop()     — sharp chop for tree felling
 *   playSell()         — descending coin jingle for selling resources
 *   playBump()         — soft thud for wall collision
 *   playFootstep()     — subtle tick for player movement (rate-limited)
 *   playDiscovery()    — mysterious rising chime for exploration
 *   playPlant()        — soft plop for seed planting
 */
const AudioManager = (() => {
  let ctx = null;         // AudioContext (lazy init)
  let unlocked = false;   // browser autoplay policy satisfied
  let masterGain = null;  // master volume node
  let muted = false;
  let volume = 0.3;       // 0..1 master volume

  // ===== AudioContext lifecycle =====

  function ensureContext() {
    if (ctx) return true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = volume;
      masterGain.connect(ctx.destination);
      return true;
    } catch (e) {
      console.warn('[Audio] Web Audio API not available:', e.message);
      return false;
    }
  }

  /** Must be called from a user gesture (click/keydown). */
  function unlock() {
    if (unlocked) return;
    if (!ensureContext()) return;
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => {
        unlocked = true;
        console.log('[Audio] AudioContext unlocked');
      });
    } else {
      unlocked = true;
    }
  }

  // ===== Core synthesizer =====

  /**
   * Play a single tone with ADSR envelope.
   * @param {number} freq — frequency in Hz
   * @param {string} type — 'sine'|'triangle'|'square'|'sawtooth'
   * @param {number} duration — total duration in seconds
   * @param {number} vol — volume 0..1
   * @param {object} opts — { attack, decay, sustain, release, freqEnd }
   */
  function playTone(freq, type, duration, vol, opts) {
    if (!ctx || !unlocked || muted) return;
    const now = ctx.currentTime;
    const o = opts || {};
    const attack  = o.attack  || 0.005;
    const decay   = o.decay   || 0.02;
    const sustain = o.sustain || 0.6;
    const release = o.release || 0.05;

    // Oscillator
    const osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, now);

    // Frequency sweep (optional)
    if (o.freqEnd) {
      osc.frequency.linearRampToValueAtTime(o.freqEnd, now + duration * 0.8);
    }

    // Gain envelope (ADSR)
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    // Attack
    gain.gain.linearRampToValueAtTime(vol, now + attack);
    // Decay → sustain
    gain.gain.linearRampToValueAtTime(vol * sustain, now + attack + decay);
    // Hold sustain until release
    const holdEnd = now + duration - release;
    gain.gain.setValueAtTime(vol * sustain, holdEnd);
    // Release
    gain.gain.linearRampToValueAtTime(0, now + duration);

    // Connect: osc → gain → master
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(now);
    osc.stop(now + duration + 0.01);
  }

  // ===== Sound library =====

  /** Short crisp click for UI navigation. */
  function playUIClick() {
    playTone(800, 'triangle', 0.05, 0.15, { attack: 0.002, release: 0.02 });
  }

  /** Upward frequency sweep — resource harvested / item gained. */
  function playHarvestPop() {
    playTone(400, 'sine', 0.12, 0.2, {
      attack: 0.005,
      release: 0.04,
      freqEnd: 600,
    });
  }

  /** Low warning buzz — action denied / error. */
  function playErrorBuzzer() {
    playTone(150, 'sawtooth', 0.15, 0.12, {
      attack: 0.005,
      decay: 0.03,
      sustain: 0.4,
      release: 0.06,
    });
  }

  /** Celebratory arpeggio for skill level-ups. */
  function playLevelUp() {
    const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
    notes.forEach((freq, i) => {
      const delay = i * 0.08;
      if (!ctx || !unlocked || muted) return;
      const now = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.18, now + 0.01);
      gain.gain.linearRampToValueAtTime(0, now + 0.15);
      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(now);
      osc.stop(now + 0.16);
    });
  }

  /** Warm completion chime for cooking done. */
  function playCookDone() {
    playTone(523, 'sine', 0.1, 0.15);  // C5
    setTimeout(() => {
      playTone(659, 'sine', 0.15, 0.18); // E5
    }, 100);
  }

  /** Percussive sawtooth hit — construction / building progress. */
  function playBuildHammer() {
    playTone(220, 'sawtooth', 0.08, 0.14, {
      attack: 0.002,
      decay: 0.01,
      sustain: 0.3,
      release: 0.03,
      freqEnd: 110,
    });
  }

  /** Sharp chop — tree felling. */
  function playWoodChop() {
    playTone(300, 'square', 0.06, 0.16, {
      attack: 0.002,
      decay: 0.01,
      sustain: 0.2,
      release: 0.02,
      freqEnd: 150,
    });
  }

  /** Descending coin jingle — selling resources. */
  function playSell() {
    if (!ctx || !unlocked || muted) return;
    const notes = [880, 784, 659]; // A5 G5 E5 — descending
    notes.forEach((freq, i) => {
      const now = ctx.currentTime + i * 0.06;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.12, now + 0.005);
      gain.gain.linearRampToValueAtTime(0, now + 0.1);
      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(now);
      osc.stop(now + 0.11);
    });
  }

  /** Soft thud — wall collision bump. */
  function playBump() {
    playTone(100, 'sine', 0.08, 0.1, {
      attack: 0.002,
      decay: 0.02,
      sustain: 0.2,
      release: 0.03,
      freqEnd: 60,
    });
  }

  /** Subtle tick — player footstep (rate-limited externally). */
  function playFootstep() {
    playTone(500, 'triangle', 0.03, 0.06, {
      attack: 0.001,
      release: 0.01,
    });
  }

  /** Mysterious rising chime — landmark / chunk discovery. */
  function playDiscovery() {
    if (!ctx || !unlocked || muted) return;
    const notes = [392, 494, 587, 784]; // G4 B4 D5 G5 — rising
    notes.forEach((freq, i) => {
      const now = ctx.currentTime + i * 0.1;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.14, now + 0.02);
      gain.gain.linearRampToValueAtTime(0, now + 0.25);
      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(now);
      osc.stop(now + 0.26);
    });
  }

  /** Soft plop — planting seed. */
  function playPlant() {
    playTone(350, 'sine', 0.1, 0.12, {
      attack: 0.003,
      release: 0.04,
      freqEnd: 250,
    });
  }

  // ===== EventBus integration =====

  function setupListeners() {
    if (typeof EventBus === 'undefined') return;

    // Harvest / resource gain sounds
    EventBus.on('CROP_HARVESTED', playHarvestPop);
    EventBus.on('ROCK_MINED', playHarvestPop);
    EventBus.on('FISH_CAUGHT', playHarvestPop);
    EventBus.on('FOOD_COOKED', playCookDone);

    // Level-up fanfare
    EventBus.on('SKILL_LEVELUP', playLevelUp);

    // Construction
    EventBus.on('CONSTRUCTION_PROGRESS', playBuildHammer);
    EventBus.on('BUILDING_CONSTRUCTED', playDiscovery);

    // Resource gathering
    EventBus.on('TREE_CHOPPED', playWoodChop);
    EventBus.on('RESOURCE_SOLD', playSell);

    // Exploration
    EventBus.on('LANDMARK_DISCOVERED', playDiscovery);
    EventBus.on('CHUNK_UNLOCKED', playDiscovery);

    // Quests / achievements
    EventBus.on('QUEST_COMPLETED', playLevelUp);
    EventBus.on('SEASON_CHANGED', playDiscovery);
  }

  // ===== Volume control =====

  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (masterGain) masterGain.gain.value = muted ? 0 : volume;
  }

  function toggleMute() {
    muted = !muted;
    if (masterGain) masterGain.gain.value = muted ? 0 : volume;
    return muted;
  }

  function isMuted() { return muted; }

  // ===== Public API =====

  return {
    unlock,
    playUIClick,
    playHarvestPop,
    playErrorBuzzer,
    playLevelUp,
    playCookDone,
    playBuildHammer,
    playWoodChop,
    playSell,
    playBump,
    playFootstep,
    playDiscovery,
    playPlant,
    setupListeners,
    setVolume,
    toggleMute,
    isMuted,
  };
})();

if (typeof module !== 'undefined') module.exports = AudioManager;
