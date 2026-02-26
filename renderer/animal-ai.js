// Animal Behavior Tree — view-independent AI for farm animals.
// Each animal runs a simple 3-state behavior tree: Wander, Rest, ReactToVibe.
// The behavior logic is decoupled from rendering so it can port to 2.5D.
const AnimalAI = (() => {
  // ===== Behavior states =====
  const STATE = {
    WANDER: 'wander',
    REST: 'rest',
    REACT: 'react',   // vibe reaction (huddle, play, flee, etc.)
  };

  // ===== Per-species personality traits =====
  const TRAITS = {
    chicken: { speed: 0.06, restChance: 0.008, wanderRange: 20, reactStyle: 'scatter', restDuration: [60, 120] },
    cow:     { speed: 0.02, restChance: 0.005, wanderRange: 12, reactStyle: 'slow',    restDuration: [100, 200] },
    pig:     { speed: 0.03, restChance: 0.006, wanderRange: 15, reactStyle: 'huddle',   restDuration: [80, 160] },
    sheep:   { speed: 0.025,restChance: 0.007, wanderRange: 14, reactStyle: 'flock',    restDuration: [90, 180] },
    cat:     { speed: 0.015,restChance: 0.012, wanderRange: 10, reactStyle: 'loaf',     restDuration: [150, 300] },
    dog:     { speed: 0.05, restChance: 0.004, wanderRange: 25, reactStyle: 'excited',  restDuration: [40, 80] },
  };

  // ===== Vibe-to-behavior mapping =====
  // animalMood comes from data-exporter atmosphere: 'happy', 'calm', 'cautious', 'huddled'
  const VIBE_EFFECTS = {
    happy:    { reactChance: 0.02, reactBehavior: 'play',   reactDuration: [60, 120], speedMod: 1.3 },
    calm:     { reactChance: 0.0,  reactBehavior: null,     reactDuration: [0, 0],    speedMod: 1.0 },
    cautious: { reactChance: 0.01, reactBehavior: 'shelter', reactDuration: [80, 150], speedMod: 0.7 },
    huddled:  { reactChance: 0.03, reactBehavior: 'huddle', reactDuration: [100, 200], speedMod: 0.5 },
  };

  // ===== Animal instance =====
  // Each animal is a lightweight state object managed externally.

  function createAnimal(type, homeX, worldMinX, worldMaxX) {
    const traits = TRAITS[type] || TRAITS.chicken;
    return {
      type,
      state: STATE.WANDER,
      x: homeX,                             // logical X position (float)
      homeX,                                // spawn / home position
      targetX: homeX,                       // wander target
      direction: 1,                         // 1 = right, -1 = left
      frame: 0,                             // animation frame counter
      stateTimer: 0,                        // ticks in current state
      restTimer: 0,                         // remaining rest ticks
      reactTimer: 0,                        // remaining react ticks
      reactBehavior: null,                  // 'play', 'shelter', 'huddle'
      worldMinX: worldMinX || 3,            // left boundary
      worldMaxX: worldMaxX || 100,          // right boundary
      // Social: nearest neighbor distance (updated externally)
      nearestDist: 999,
      nearestDir: 0,
    };
  }

  // ===== Behavior tree update (called each tick) =====

  function update(animal, animalMood, tick) {
    const traits = TRAITS[animal.type] || TRAITS.chicken;
    const vibeEffect = VIBE_EFFECTS[animalMood] || VIBE_EFFECTS.calm;
    animal.stateTimer++;

    switch (animal.state) {
      case STATE.WANDER:
        updateWander(animal, traits, vibeEffect, tick);
        break;
      case STATE.REST:
        updateRest(animal, traits, vibeEffect, tick);
        break;
      case STATE.REACT:
        updateReact(animal, traits, vibeEffect, tick);
        break;
    }

    // Clamp position
    animal.x = Math.max(animal.worldMinX, Math.min(animal.worldMaxX, animal.x));

    // Animation frame — speed proportional to actual movement
    if (animal.state === STATE.WANDER || (animal.state === STATE.REACT && animal.reactBehavior === 'play')) {
      const animalSpeed = traits.speed * vibeEffect.speedMod;
      const ticksPerFrame = Math.max(5, Math.round(0.5 / (animalSpeed + 0.01)));
      animal.frame = ((tick / ticksPerFrame) | 0) % 2;
    } else {
      animal.frame = 0;  // Force standing frame when idle/resting
    }
  }

  function updateWander(animal, traits, vibeEffect, tick) {
    const speed = traits.speed * vibeEffect.speedMod;

    // Move toward target
    const dx = animal.targetX - animal.x;
    if (Math.abs(dx) < 0.5) {
      // Reached target — pick new target or rest
      if (Math.random() < traits.restChance * 3) {
        transitionTo(animal, STATE.REST, traits);
        return;
      }
      pickNewTarget(animal, traits);
    } else {
      animal.direction = dx > 0 ? 1 : -1;
      animal.x += Math.sign(dx) * Math.min(speed, Math.abs(dx));
    }

    // Check for vibe reaction
    if (vibeEffect.reactBehavior && Math.random() < vibeEffect.reactChance) {
      transitionToReact(animal, vibeEffect);
      return;
    }

    // Random rest
    if (Math.random() < traits.restChance) {
      transitionTo(animal, STATE.REST, traits);
    }
  }

  function updateRest(animal, traits, vibeEffect, tick) {
    animal.restTimer--;
    if (animal.restTimer <= 0) {
      // Wake up — either wander or react
      if (vibeEffect.reactBehavior && Math.random() < vibeEffect.reactChance * 5) {
        transitionToReact(animal, vibeEffect);
      } else {
        transitionTo(animal, STATE.WANDER, traits);
        pickNewTarget(animal, traits);
      }
    }
  }

  function updateReact(animal, traits, vibeEffect, tick) {
    animal.reactTimer--;

    // Execute reaction behavior
    if (animal.reactBehavior === 'play') {
      // Excited movement — bounce around faster
      const speed = traits.speed * 1.8;
      const dx = animal.targetX - animal.x;
      if (Math.abs(dx) < 1) {
        animal.targetX = animal.homeX + (Math.random() - 0.5) * traits.wanderRange * 1.5;
        animal.targetX = Math.max(animal.worldMinX, Math.min(animal.worldMaxX, animal.targetX));
      } else {
        animal.direction = dx > 0 ? 1 : -1;
        animal.x += Math.sign(dx) * Math.min(speed, Math.abs(dx));
      }
    } else if (animal.reactBehavior === 'shelter') {
      // Move toward home position (train station area)
      const shelterX = 85; // near train station STATION_X
      const dx = shelterX - animal.x;
      if (Math.abs(dx) > 1) {
        animal.direction = dx > 0 ? 1 : -1;
        animal.x += Math.sign(dx) * traits.speed * 0.8;
      }
    } else if (animal.reactBehavior === 'huddle') {
      // Move toward nearest neighbor (flock together)
      if (animal.nearestDist > 3) {
        animal.x += animal.nearestDir * traits.speed * 0.6;
        animal.direction = animal.nearestDir >= 0 ? 1 : -1;
      }
    }

    if (animal.reactTimer <= 0) {
      transitionTo(animal, STATE.WANDER, traits);
      pickNewTarget(animal, traits);
    }
  }

  // ===== State transitions =====

  function transitionTo(animal, newState, traits) {
    animal.state = newState;
    animal.stateTimer = 0;

    if (newState === STATE.REST) {
      const [min, max] = traits.restDuration;
      animal.restTimer = min + Math.floor(Math.random() * (max - min));
    }
  }

  function transitionToReact(animal, vibeEffect) {
    animal.state = STATE.REACT;
    animal.stateTimer = 0;
    animal.reactBehavior = vibeEffect.reactBehavior;
    const [min, max] = vibeEffect.reactDuration;
    animal.reactTimer = min + Math.floor(Math.random() * (max - min));
  }

  function pickNewTarget(animal, traits) {
    const offset = (Math.random() - 0.5) * traits.wanderRange * 2;
    animal.targetX = animal.homeX + offset;
    animal.targetX = Math.max(animal.worldMinX, Math.min(animal.worldMaxX, animal.targetX));
  }

  // ===== Social: update nearest-neighbor info for all animals =====

  function updateSocial(animals) {
    for (let i = 0; i < animals.length; i++) {
      let minDist = 999;
      let dir = 0;
      for (let j = 0; j < animals.length; j++) {
        if (i === j) continue;
        const d = Math.abs(animals[i].x - animals[j].x);
        if (d < minDist) {
          minDist = d;
          dir = animals[j].x > animals[i].x ? 1 : -1;
        }
      }
      animals[i].nearestDist = minDist;
      animals[i].nearestDir = dir;
    }
  }

  // ===== Public API =====

  return {
    STATE,
    TRAITS,
    createAnimal,
    update,
    updateSocial,
  };
})();
