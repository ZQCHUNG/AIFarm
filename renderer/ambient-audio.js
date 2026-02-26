/**
 * ambient-audio.js — Dynamic environmental ambient sounds (Sprint 28 P2).
 *
 * Generates procedural ambient audio using Web Audio API:
 *   - Rain: pink noise filtered through bandpass when raining
 *   - Water: gentle low-pass filtered noise near rivers/ponds
 *   - Birds: random chirps in forest areas during daytime
 *   - Wind: soft white noise during storms
 *   - Night crickets: high-pitched chirps at night
 *
 * All sounds are synthesized — no audio files needed.
 * Volume crossfades based on proximity and conditions.
 */
const AmbientAudio = (() => {
  let audioCtx = null;
  let masterGain = null;
  let initialized = false;
  let enabled = true;

  // Sound layers
  let rainNode = null;
  let rainGain = null;
  let waterNode = null;
  let waterGain = null;
  let windNode = null;
  let windGain = null;
  let cricketTimer = null;

  // Target volumes (smoothly interpolated)
  let rainTarget = 0;
  let waterTarget = 0;
  let windTarget = 0;
  let currentRain = 0;
  let currentWater = 0;
  let currentWind = 0;

  const LERP = 0.02; // volume fade speed
  const MASTER_VOL = 0.12; // keep ambient quiet

  // ===== Init =====

  function init() {
    if (initialized) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = MASTER_VOL;
      masterGain.connect(audioCtx.destination);

      // Create persistent noise sources
      createRainLayer();
      createWaterLayer();
      createWindLayer();

      initialized = true;
    } catch (e) {
      // Web Audio not available
    }
  }

  function unlock() {
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  // ===== Noise Generators =====

  function createNoiseBuffer(duration, type) {
    if (!audioCtx) return null;
    const sampleRate = audioCtx.sampleRate;
    const length = sampleRate * duration;
    const buffer = audioCtx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    if (type === 'pink') {
      // Pink noise approximation (1/f)
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      }
    } else {
      // White noise
      for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
    }
    return buffer;
  }

  function createRainLayer() {
    if (!audioCtx) return;
    const buffer = createNoiseBuffer(2, 'pink');
    rainNode = audioCtx.createBufferSource();
    rainNode.buffer = buffer;
    rainNode.loop = true;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 800;
    filter.Q.value = 0.5;

    rainGain = audioCtx.createGain();
    rainGain.gain.value = 0;

    rainNode.connect(filter);
    filter.connect(rainGain);
    rainGain.connect(masterGain);
    rainNode.start();
  }

  function createWaterLayer() {
    if (!audioCtx) return;
    const buffer = createNoiseBuffer(2, 'pink');
    waterNode = audioCtx.createBufferSource();
    waterNode.buffer = buffer;
    waterNode.loop = true;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    filter.Q.value = 1;

    waterGain = audioCtx.createGain();
    waterGain.gain.value = 0;

    waterNode.connect(filter);
    filter.connect(waterGain);
    waterGain.connect(masterGain);
    waterNode.start();
  }

  function createWindLayer() {
    if (!audioCtx) return;
    const buffer = createNoiseBuffer(2, 'white');
    windNode = audioCtx.createBufferSource();
    windNode.buffer = buffer;
    windNode.loop = true;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300;
    filter.Q.value = 0.3;

    windGain = audioCtx.createGain();
    windGain.gain.value = 0;

    windNode.connect(filter);
    filter.connect(windGain);
    windGain.connect(masterGain);
    windNode.start();
  }

  // ===== Bird Chirps =====

  function playChirp() {
    if (!audioCtx || !enabled) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    // Random bird pitch
    const baseFreq = 2000 + Math.random() * 2000;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.3, audioCtx.currentTime + 0.05);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.8, audioCtx.currentTime + 0.1);

    gain.gain.setValueAtTime(0, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.03, audioCtx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);

    osc.connect(gain);
    gain.connect(masterGain);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.15);
  }

  function playCricket() {
    if (!audioCtx || !enabled) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.value = 4000 + Math.random() * 1000;

    // Rapid on-off pattern
    const now = audioCtx.currentTime;
    gain.gain.setValueAtTime(0, now);
    for (let i = 0; i < 3; i++) {
      gain.gain.linearRampToValueAtTime(0.015, now + i * 0.06 + 0.01);
      gain.gain.linearRampToValueAtTime(0, now + i * 0.06 + 0.04);
    }

    osc.connect(gain);
    gain.connect(masterGain);
    osc.start();
    osc.stop(now + 0.2);
  }

  // ===== Update =====

  function update(tick) {
    if (!initialized || !enabled) return;

    // Determine ambient conditions
    const isRaining = (typeof IsoWeather !== 'undefined') && IsoWeather.isRaining && IsoWeather.isRaining();
    const isNight = (typeof IsoWeather !== 'undefined') && IsoWeather.isNight && IsoWeather.isNight();
    const isStormy = (typeof IsoWeather !== 'undefined') && IsoWeather.isStormy && IsoWeather.isStormy();

    // Near water check (simple: player near row > 15 or specific tiles)
    let nearWater = false;
    if (typeof Player !== 'undefined' && typeof IsoEngine !== 'undefined') {
      const pp = Player.getPosition();
      const tile = IsoEngine.getTile(Math.floor(pp.x), Math.floor(pp.y));
      // Check surrounding tiles for water
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          const t = IsoEngine.getTile(Math.floor(pp.x) + dx, Math.floor(pp.y) + dy);
          if (t === 'water' || t === 'pond') { nearWater = true; break; }
        }
        if (nearWater) break;
      }
    }

    // Set target volumes
    rainTarget = isRaining ? 1.0 : 0;
    waterTarget = nearWater ? 0.6 : 0;
    windTarget = isStormy ? 0.8 : 0;

    // Smooth interpolation
    currentRain += (rainTarget - currentRain) * LERP;
    currentWater += (waterTarget - currentWater) * LERP;
    currentWind += (windTarget - currentWind) * LERP;

    if (rainGain) rainGain.gain.value = currentRain;
    if (waterGain) waterGain.gain.value = currentWater;
    if (windGain) windGain.gain.value = currentWind;

    // Bird chirps (daytime, not raining, random)
    if (!isNight && !isRaining && tick % 180 === 0 && Math.random() < 0.4) {
      playChirp();
      // Sometimes double chirp
      if (Math.random() < 0.3) {
        setTimeout(() => playChirp(), 100 + Math.random() * 200);
      }
    }

    // Cricket chirps (nighttime)
    if (isNight && !isRaining && tick % 120 === 0 && Math.random() < 0.5) {
      playCricket();
    }
  }

  function setEnabled(val) { enabled = val; }
  function isEnabled() { return enabled; }

  return {
    init,
    unlock,
    update,
    setEnabled,
    isEnabled,
  };
})();
