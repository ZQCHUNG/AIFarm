/**
 * player-accessories.js — Player Equipment & Customization (Sprint 19 P2).
 *
 * Manages hat and backpack slots for the player character.
 * Draws accessories as layered sprites on top of IsoEngine.drawIsoCharacter().
 * Items can be purchased from the shop or earned from landmarks/achievements.
 *
 * Each accessory defines 4-direction pixel offsets so it aligns
 * with the character's facing direction.
 */
const PlayerAccessories = (() => {
  // ===== Accessory definitions =====

  // Hat types
  const HATS = {
    none: { name: 'None', emoji: '' },
    straw: {
      name: 'Straw Hat',
      emoji: '\u{1F452}',
      rarity: 'common',
      offsets: {
        down:  { x: 0, y: -22 },
        up:    { x: 0, y: -22 },
        left:  { x: -1, y: -22 },
        right: { x: 1, y: -22 },
      },
      draw: (ctx, sx, sy, dir, tick) => {
        // Straw hat — wide brim, warm color
        ctx.fillStyle = '#F5DEB3';
        ctx.fillRect(sx - 10, sy, 20, 3);
        ctx.fillStyle = '#DEB887';
        ctx.fillRect(sx - 7, sy - 4, 14, 5);
        ctx.fillStyle = '#CD853F';
        ctx.fillRect(sx - 6, sy - 1, 12, 1);
        // Ribbon
        ctx.fillStyle = '#8B0000';
        ctx.fillRect(sx - 7, sy - 1, 14, 2);
      },
    },
    crown: {
      name: 'Golden Crown',
      emoji: '\u{1F451}',
      rarity: 'legendary',
      offsets: {
        down:  { x: 0, y: -22 },
        up:    { x: 0, y: -24 },
        left:  { x: -1, y: -23 },
        right: { x: 1, y: -23 },
      },
      draw: (ctx, sx, sy, dir, tick) => {
        // Golden crown
        ctx.fillStyle = '#FFD700';
        ctx.fillRect(sx - 7, sy, 14, 4);
        // Points
        ctx.fillRect(sx - 7, sy - 3, 3, 3);
        ctx.fillRect(sx - 1, sy - 4, 3, 4);
        ctx.fillRect(sx + 5, sy - 3, 3, 3);
        // Gems
        ctx.fillStyle = '#FF0000';
        ctx.fillRect(sx - 6, sy - 1, 2, 2);
        ctx.fillStyle = '#0000FF';
        ctx.fillRect(sx, sy - 2, 2, 2);
        ctx.fillStyle = '#00FF00';
        ctx.fillRect(sx + 5, sy - 1, 2, 2);
        // Sparkle
        if (tick % 20 < 5) {
          ctx.fillStyle = '#FFF';
          ctx.fillRect(sx + 6, sy - 4, 1, 1);
        }
      },
    },
    explorer: {
      name: 'Explorer Hat',
      emoji: '\u{1FA96}',
      rarity: 'uncommon',
      offsets: {
        down:  { x: 0, y: -22 },
        up:    { x: 0, y: -22 },
        left:  { x: -2, y: -22 },
        right: { x: 2, y: -22 },
      },
      draw: (ctx, sx, sy, dir, tick) => {
        // Explorer/adventure hat — wide brim, band
        ctx.fillStyle = '#8B7355';
        ctx.fillRect(sx - 9, sy, 18, 2);
        ctx.fillStyle = '#6B5B3E';
        ctx.fillRect(sx - 6, sy - 5, 12, 6);
        // Crease in top
        ctx.fillStyle = '#5A4A30';
        ctx.fillRect(sx - 4, sy - 5, 8, 1);
        // Band
        ctx.fillStyle = '#2F4F4F';
        ctx.fillRect(sx - 6, sy - 1, 12, 2);
      },
    },
    wizard: {
      name: 'Wizard Hat',
      emoji: '\u{1FA84}',
      rarity: 'rare',
      offsets: {
        down:  { x: 0, y: -22 },
        up:    { x: 0, y: -24 },
        left:  { x: -1, y: -23 },
        right: { x: 1, y: -23 },
      },
      draw: (ctx, sx, sy, dir, tick) => {
        // Wizard hat — tall pointed
        ctx.fillStyle = '#191970';
        ctx.fillRect(sx - 8, sy, 16, 2);
        // Cone
        ctx.beginPath();
        ctx.moveTo(sx - 6, sy);
        ctx.lineTo(sx, sy - 14);
        ctx.lineTo(sx + 6, sy);
        ctx.closePath();
        ctx.fill();
        // Stars on hat
        ctx.fillStyle = '#FFD700';
        ctx.fillRect(sx - 3, sy - 4, 2, 2);
        ctx.fillRect(sx + 2, sy - 8, 2, 2);
        // Tip sparkle
        const sparkle = Math.sin(tick * 0.1) * 0.5 + 0.5;
        ctx.fillStyle = `rgba(255, 215, 0, ${sparkle})`;
        ctx.fillRect(sx - 1, sy - 15, 2, 2);
      },
    },
  };

  // Backpack types
  const BACKPACKS = {
    none: { name: 'None', emoji: '' },
    basic: {
      name: 'Basic Pack',
      emoji: '\u{1F392}',
      rarity: 'common',
      offsets: {
        down:  { x: 0, y: -6 },   // visible behind character
        up:    { x: 0, y: -8 },   // visible in front
        left:  { x: 5, y: -7 },
        right: { x: -5, y: -7 },
      },
      draw: (ctx, sx, sy, dir, tick) => {
        if (dir === 'down' || dir === 'up') {
          // Back view: small rectangle
          ctx.fillStyle = '#8B4513';
          ctx.fillRect(sx - 4, sy, 8, 6);
          ctx.fillStyle = '#A0522D';
          ctx.fillRect(sx - 3, sy + 1, 6, 4);
          // Strap
          ctx.fillStyle = '#6B3410';
          ctx.fillRect(sx - 4, sy, 1, 6);
          ctx.fillRect(sx + 3, sy, 1, 6);
        } else {
          // Side view: thinner profile
          ctx.fillStyle = '#8B4513';
          ctx.fillRect(sx - 2, sy, 4, 6);
          ctx.fillStyle = '#A0522D';
          ctx.fillRect(sx - 1, sy + 1, 2, 4);
        }
      },
    },
    explorer: {
      name: 'Explorer Pack',
      emoji: '\u{1F9F3}',
      rarity: 'uncommon',
      offsets: {
        down:  { x: 0, y: -6 },
        up:    { x: 0, y: -8 },
        left:  { x: 6, y: -7 },
        right: { x: -6, y: -7 },
      },
      draw: (ctx, sx, sy, dir, tick) => {
        if (dir === 'down' || dir === 'up') {
          ctx.fillStyle = '#556B2F';
          ctx.fillRect(sx - 5, sy, 10, 8);
          ctx.fillStyle = '#6B8E23';
          ctx.fillRect(sx - 4, sy + 1, 8, 6);
          // Bedroll on top
          ctx.fillStyle = '#8B6B3E';
          ctx.fillRect(sx - 4, sy - 2, 8, 2);
          // Buckles
          ctx.fillStyle = '#C0C0C0';
          ctx.fillRect(sx - 1, sy + 2, 2, 1);
          ctx.fillRect(sx - 1, sy + 5, 2, 1);
        } else {
          ctx.fillStyle = '#556B2F';
          ctx.fillRect(sx - 3, sy, 6, 8);
          ctx.fillStyle = '#6B8E23';
          ctx.fillRect(sx - 2, sy + 1, 4, 6);
          // Bedroll on top
          ctx.fillStyle = '#8B6B3E';
          ctx.fillRect(sx - 3, sy - 2, 6, 2);
        }
      },
    },
    crystal: {
      name: 'Crystal Pack',
      emoji: '\u{1F48E}',
      rarity: 'rare',
      offsets: {
        down:  { x: 0, y: -6 },
        up:    { x: 0, y: -8 },
        left:  { x: 5, y: -7 },
        right: { x: -5, y: -7 },
      },
      draw: (ctx, sx, sy, dir, tick) => {
        if (dir === 'down' || dir === 'up') {
          ctx.fillStyle = '#4B0082';
          ctx.fillRect(sx - 5, sy, 10, 7);
          ctx.fillStyle = '#6A0DAD';
          ctx.fillRect(sx - 4, sy + 1, 8, 5);
          // Crystal sticking out
          const shimmer = Math.sin(tick * 0.1) * 0.3 + 0.7;
          ctx.fillStyle = `rgba(200, 100, 255, ${shimmer})`;
          ctx.fillRect(sx - 2, sy - 3, 2, 4);
          ctx.fillRect(sx + 1, sy - 2, 2, 3);
        } else {
          ctx.fillStyle = '#4B0082';
          ctx.fillRect(sx - 2, sy, 4, 7);
          const shimmer = Math.sin(tick * 0.1) * 0.3 + 0.7;
          ctx.fillStyle = `rgba(200, 100, 255, ${shimmer})`;
          ctx.fillRect(sx, sy - 2, 2, 3);
        }
      },
    },
  };

  // Currently equipped items
  let equippedHat = 'straw';
  let equippedBackpack = 'basic';

  // Owned items (Set of ids)
  let ownedHats = new Set(['none', 'straw']);
  let ownedBackpacks = new Set(['none', 'basic']);

  // ===== Equipment management =====

  function equipHat(hatId) {
    if (HATS[hatId] && ownedHats.has(hatId)) {
      equippedHat = hatId;
      return true;
    }
    return false;
  }

  function equipBackpack(bpId) {
    if (BACKPACKS[bpId] && ownedBackpacks.has(bpId)) {
      equippedBackpack = bpId;
      return true;
    }
    return false;
  }

  function unlockHat(hatId) {
    if (HATS[hatId]) {
      ownedHats.add(hatId);
      if (typeof Farm !== 'undefined' && Farm.logEvent) {
        Farm.logEvent(HATS[hatId].emoji || '\u{1F3A9}', `Unlocked ${HATS[hatId].name}!`);
      }
      return true;
    }
    return false;
  }

  function unlockBackpack(bpId) {
    if (BACKPACKS[bpId]) {
      ownedBackpacks.add(bpId);
      if (typeof Farm !== 'undefined' && Farm.logEvent) {
        Farm.logEvent(BACKPACKS[bpId].emoji || '\u{1F392}', `Unlocked ${BACKPACKS[bpId].name}!`);
      }
      return true;
    }
    return false;
  }

  // ===== Drawing =====

  /**
   * Draw equipped accessories on the player character.
   * Called AFTER drawIsoCharacter() to layer on top.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} sx - Screen center X
   * @param {number} sy - Screen center Y (feet)
   * @param {string} direction - 'up', 'down', 'left', 'right'
   * @param {number} tick - Current animation tick
   * @param {number} bob - Vertical bob offset from walking animation
   */
  function drawAccessories(ctx, sx, sy, direction, tick, bob) {
    const bobY = bob || 0;

    // Draw backpack BEHIND character for down/left/right, IN FRONT for up
    const bp = BACKPACKS[equippedBackpack];
    if (bp && bp.draw) {
      const off = bp.offsets[direction] || bp.offsets.down;
      if (direction !== 'up') {
        // Draw behind: we're already called after character, so use z-ordering
        // Actually, backpack is on the character's back — always draw
        bp.draw(ctx, sx + off.x, sy + off.y + bobY, direction, tick);
      }
    }

    // Draw hat ON TOP of character
    const hat = HATS[equippedHat];
    if (hat && hat.draw) {
      const off = hat.offsets[direction] || hat.offsets.down;
      hat.draw(ctx, sx + off.x, sy + off.y + bobY, direction, tick);
    }

    // Draw backpack in front for 'up' direction
    if (bp && bp.draw && direction === 'up') {
      const off = bp.offsets[direction] || bp.offsets.down;
      bp.draw(ctx, sx + off.x, sy + off.y + bobY, direction, tick);
    }
  }

  // ===== Auto-unlock from events =====

  function setupListeners() {
    if (typeof EventBus === 'undefined') return;

    // Unlock explorer hat/pack when first landmark is discovered
    EventBus.on('LANDMARK_DISCOVERED', (data) => {
      if (!ownedHats.has('explorer')) {
        unlockHat('explorer');
        equipHat('explorer');
        if (typeof IsoEffects !== 'undefined') {
          IsoEffects.spawnFloatingText(200, 100, '\u{1FA96} Explorer Hat unlocked!', '#FFD700');
        }
      }
      if (!ownedBackpacks.has('explorer')) {
        unlockBackpack('explorer');
        equipBackpack('explorer');
      }
      // Crystal pack from legendary landmarks
      if (data.rarity === 'legendary' && !ownedBackpacks.has('crystal')) {
        unlockBackpack('crystal');
        equipBackpack('crystal');
      }
    });
  }

  // ===== State persistence =====

  function getState() {
    return {
      hat: equippedHat,
      backpack: equippedBackpack,
      ownedHats: Array.from(ownedHats),
      ownedBackpacks: Array.from(ownedBackpacks),
    };
  }

  function loadState(state) {
    if (!state) return;
    if (state.ownedHats) ownedHats = new Set(state.ownedHats);
    if (state.ownedBackpacks) ownedBackpacks = new Set(state.ownedBackpacks);
    if (state.hat && HATS[state.hat]) equippedHat = state.hat;
    if (state.backpack && BACKPACKS[state.backpack]) equippedBackpack = state.backpack;
  }

  function getEquipped() {
    return {
      hat: equippedHat,
      hatName: HATS[equippedHat] ? HATS[equippedHat].name : 'None',
      backpack: equippedBackpack,
      backpackName: BACKPACKS[equippedBackpack] ? BACKPACKS[equippedBackpack].name : 'None',
    };
  }

  function getOwnedHats() { return Array.from(ownedHats); }
  function getOwnedBackpacks() { return Array.from(ownedBackpacks); }

  return {
    HATS,
    BACKPACKS,
    equipHat,
    equipBackpack,
    unlockHat,
    unlockBackpack,
    drawAccessories,
    setupListeners,
    getState,
    loadState,
    getEquipped,
    getOwnedHats,
    getOwnedBackpacks,
  };
})();

if (typeof module !== 'undefined') module.exports = PlayerAccessories;
