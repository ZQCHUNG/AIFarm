/**
 * monument-v2.js — Grand Monument 2.0 for AIFarm 3.0 (Sprint 20 P2).
 *
 * Enhances the existing monument (10k energy) with dynamic growth:
 *   - 5 visual stages based on cumulative energy + collection progress
 *   - Pedestal → Crystal → Obelisk → Tower → Grand Spire
 *   - Particle effects scale with energy level
 *   - Collection completion % shown on monument face
 *   - Ambient glow + orbiting particles at higher stages
 */

const MonumentV2 = (() => {
  // ===== Growth stages =====
  const STAGES = [
    { name: 'Pedestal',     minEnergy: 10000, minCollection: 0,  scale: 1.0 },
    { name: 'Crystal',      minEnergy: 15000, minCollection: 10, scale: 1.2 },
    { name: 'Obelisk',      minEnergy: 25000, minCollection: 25, scale: 1.5 },
    { name: 'Tower',        minEnergy: 40000, minCollection: 50, scale: 1.8 },
    { name: 'Grand Spire',  minEnergy: 70000, minCollection: 75, scale: 2.2 },
  ];

  // Colors per stage
  const STAGE_COLORS = [
    { primary: '#9B59B6', secondary: '#DA70D6', glow: '#B070D0' },      // Purple crystal
    { primary: '#3498DB', secondary: '#5DADE2', glow: '#4A90D9' },      // Blue sapphire
    { primary: '#2ECC71', secondary: '#58D68D', glow: '#27AE60' },      // Emerald
    { primary: '#F39C12', secondary: '#F5B041', glow: '#E67E22' },      // Golden amber
    { primary: '#E74C3C', secondary: '#EC7063', glow: '#C0392B' },      // Ruby + diamond
  ];

  let currentStage = 0;
  let energy = 0;
  let collectionPct = 0;

  // ===== Update =====

  function update(tick) {
    // Get current energy
    const farmState = (typeof Farm !== 'undefined') ? Farm.getState() : null;
    energy = farmState ? (farmState.totalEnergy || 0) : 0;

    // Get collection completion
    if (typeof CollectionUI !== 'undefined' && CollectionUI.getCompletionPercent) {
      collectionPct = CollectionUI.getCompletionPercent();
    }

    // Determine stage
    currentStage = 0;
    for (let i = STAGES.length - 1; i >= 0; i--) {
      if (energy >= STAGES[i].minEnergy && collectionPct >= STAGES[i].minCollection) {
        currentStage = i;
        break;
      }
    }
  }

  function getStage() { return currentStage; }
  function getStageName() { return STAGES[currentStage].name; }

  // ===== Drawing =====

  /**
   * Draw the monument v2. Called from iso-farm.js syncMonument.
   * Replaces the original drawMonument when this module is loaded.
   */
  function draw(ctx, sx, sy, tick) {
    const stage = currentStage;
    const colors = STAGE_COLORS[stage];
    const stageInfo = STAGES[stage];
    const scale = stageInfo.scale;
    const usage = (typeof Farm !== 'undefined') ? Farm.getUsage() : null;

    // Ground shadow (scales with stage)
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.ellipse(sx, sy + 4, 16 * scale, 7 * scale, 0, 0, Math.PI * 2);
    ctx.fill();

    // Ambient glow aura (stronger at higher stages)
    const pulse = Math.sin(tick * 0.04) * 0.15 + 0.85;
    const glowRadius = (12 + stage * 4) * scale;
    ctx.save();
    ctx.globalAlpha = (0.15 + stage * 0.08) * pulse;
    const glowGrad = ctx.createRadialGradient(sx, sy - 18 * scale, 2, sx, sy - 18 * scale, glowRadius);
    glowGrad.addColorStop(0, colors.glow);
    glowGrad.addColorStop(0.6, colors.primary);
    glowGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = glowGrad;
    ctx.fillRect(sx - glowRadius, sy - 18 * scale - glowRadius, glowRadius * 2, glowRadius * 2);
    ctx.restore();

    // Orbiting particles (stage 2+)
    if (stage >= 2) {
      drawOrbitingParticles(ctx, sx, sy - 18 * scale, tick, stage, colors);
    }

    // Stone pedestal (all stages)
    drawPedestal(ctx, sx, sy, scale, colors);

    // Crystal/structure body (varies by stage)
    if (stage === 0) {
      drawCrystal(ctx, sx, sy, tick, scale, colors);
    } else if (stage === 1) {
      drawSapphire(ctx, sx, sy, tick, scale, colors);
    } else if (stage === 2) {
      drawObelisk(ctx, sx, sy, tick, scale, colors);
    } else if (stage === 3) {
      drawTower(ctx, sx, sy, tick, scale, colors);
    } else {
      drawGrandSpire(ctx, sx, sy, tick, scale, colors);
    }

    // Sparkle particles (count scales with stage)
    drawSparkles(ctx, sx, sy, tick, stage, scale, colors);

    // Stage name plate
    ctx.font = 'bold 6px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = colors.secondary;
    ctx.fillText(stageInfo.name.toUpperCase(), sx, sy + 6);

    // Stats: total tokens
    if (usage && usage.totalOutput) {
      ctx.font = '6px monospace';
      ctx.fillStyle = colors.primary;
      const totalMB = (usage.totalOutput / 1000000).toFixed(1);
      ctx.fillText(`${totalMB}M tok`, sx, sy + 14);
    }

    // Collection % (stage 1+)
    if (stage >= 1) {
      ctx.font = '5px monospace';
      ctx.fillStyle = '#FFD700';
      ctx.fillText(`${Math.round(collectionPct)}% collected`, sx, sy + 21);
    }
  }

  function drawPedestal(ctx, sx, sy, scale, colors) {
    // Base tier
    ctx.fillStyle = '#777';
    ctx.fillRect(sx - 14 * scale, sy - 4, 28 * scale, 8);
    // Middle tier
    ctx.fillStyle = '#999';
    ctx.fillRect(sx - 12 * scale, sy - 8, 24 * scale, 6);
    // Top tier
    ctx.fillStyle = '#B0B0A8';
    ctx.fillRect(sx - 10 * scale, sy - 10, 20 * scale, 4);
    // Trim line
    ctx.fillStyle = colors.primary;
    ctx.fillRect(sx - 12 * scale, sy - 5, 24 * scale, 1);
  }

  function drawCrystal(ctx, sx, sy, tick, scale, colors) {
    // Original crystal (stage 0 — same as v1)
    const pulse = Math.sin(tick * 0.05) * 0.15 + 0.85;
    ctx.fillStyle = `rgba(180, 100, 220, ${(0.7 + pulse * 0.3).toFixed(2)})`;
    ctx.beginPath();
    ctx.moveTo(sx, sy - 12);
    ctx.lineTo(sx - 6, sy - 20);
    ctx.lineTo(sx, sy - 28);
    ctx.lineTo(sx + 6, sy - 20);
    ctx.closePath();
    ctx.fill();

    // Highlight facet
    ctx.fillStyle = `rgba(220, 180, 255, ${(0.4 + pulse * 0.2).toFixed(2)})`;
    ctx.beginPath();
    ctx.moveTo(sx - 1, sy - 14);
    ctx.lineTo(sx - 4, sy - 20);
    ctx.lineTo(sx - 1, sy - 26);
    ctx.lineTo(sx + 1, sy - 20);
    ctx.closePath();
    ctx.fill();
  }

  function drawSapphire(ctx, sx, sy, tick, scale, colors) {
    // Taller crystal with two tiers
    const pulse = Math.sin(tick * 0.04) * 0.15 + 0.85;

    // Lower crystal body
    ctx.fillStyle = `rgba(52, 152, 219, ${(0.7 + pulse * 0.3).toFixed(2)})`;
    ctx.beginPath();
    ctx.moveTo(sx - 7, sy - 12);
    ctx.lineTo(sx - 5, sy - 24);
    ctx.lineTo(sx, sy - 32);
    ctx.lineTo(sx + 5, sy - 24);
    ctx.lineTo(sx + 7, sy - 12);
    ctx.closePath();
    ctx.fill();

    // Upper spike
    ctx.fillStyle = `rgba(93, 173, 226, ${(0.6 + pulse * 0.4).toFixed(2)})`;
    ctx.beginPath();
    ctx.moveTo(sx - 3, sy - 24);
    ctx.lineTo(sx, sy - 36);
    ctx.lineTo(sx + 3, sy - 24);
    ctx.closePath();
    ctx.fill();

    // Highlight
    ctx.fillStyle = `rgba(174, 214, 241, ${0.3 * pulse})`;
    ctx.fillRect(sx - 2, sy - 30, 3, 12);
  }

  function drawObelisk(ctx, sx, sy, tick, scale, colors) {
    // Tall rectangular pillar with gem top
    const pulse = Math.sin(tick * 0.035) * 0.15 + 0.85;
    const h = 38 * scale;

    // Pillar body
    ctx.fillStyle = '#7F8C8D';
    ctx.fillRect(sx - 5 * scale, sy - h, 10 * scale, h - 10);

    // Stone texture lines
    ctx.fillStyle = '#6C7A7A';
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(sx - 4 * scale, sy - h + 6 + i * 8, 8 * scale, 1);
    }

    // Emerald gem at top
    ctx.fillStyle = `rgba(46, 204, 113, ${(0.7 + pulse * 0.3).toFixed(2)})`;
    ctx.beginPath();
    ctx.moveTo(sx, sy - h - 6);
    ctx.lineTo(sx - 5, sy - h + 2);
    ctx.lineTo(sx + 5, sy - h + 2);
    ctx.closePath();
    ctx.fill();

    // Gem glow
    ctx.save();
    ctx.globalAlpha = 0.3 * pulse;
    ctx.fillStyle = colors.glow;
    ctx.beginPath();
    ctx.arc(sx, sy - h, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Rune engravings (animated glow)
    const runeAlpha = Math.sin(tick * 0.06 + 1) * 0.3 + 0.5;
    ctx.fillStyle = `rgba(46, 204, 113, ${runeAlpha.toFixed(2)})`;
    ctx.fillRect(sx - 3 * scale, sy - h + 10, 2, 4);
    ctx.fillRect(sx + 1 * scale, sy - h + 16, 2, 4);
    ctx.fillRect(sx - 2 * scale, sy - h + 22, 2, 4);
  }

  function drawTower(ctx, sx, sy, tick, scale, colors) {
    // Multi-tier golden tower
    const pulse = Math.sin(tick * 0.03) * 0.15 + 0.85;
    const h = 48 * scale;

    // Base section
    ctx.fillStyle = '#B8860B';
    ctx.fillRect(sx - 8 * scale, sy - 14, 16 * scale, 6);

    // Middle section (narrower)
    ctx.fillStyle = '#DAA520';
    ctx.fillRect(sx - 6 * scale, sy - 30, 12 * scale, 18);

    // Upper section
    ctx.fillStyle = '#FFD700';
    ctx.fillRect(sx - 4 * scale, sy - 42, 8 * scale, 14);

    // Crown
    ctx.fillStyle = '#FFF8DC';
    ctx.fillRect(sx - 5 * scale, sy - 44, 10 * scale, 3);

    // Amber orb at top
    ctx.save();
    ctx.globalAlpha = 0.8 * pulse;
    const orbGrad = ctx.createRadialGradient(sx, sy - 48, 1, sx, sy - 48, 6);
    orbGrad.addColorStop(0, '#FFFACD');
    orbGrad.addColorStop(0.5, '#FFD700');
    orbGrad.addColorStop(1, 'rgba(243, 156, 18, 0)');
    ctx.fillStyle = orbGrad;
    ctx.beginPath();
    ctx.arc(sx, sy - 48, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Windows (glowing)
    const winAlpha = Math.sin(tick * 0.08) * 0.2 + 0.6;
    ctx.fillStyle = `rgba(255, 255, 200, ${winAlpha.toFixed(2)})`;
    ctx.fillRect(sx - 2, sy - 26, 4, 4);
    ctx.fillRect(sx - 2, sy - 38, 4, 4);

    // Banner/flags
    const flagWave = Math.sin(tick * 0.06) * 2;
    ctx.fillStyle = '#E74C3C';
    ctx.fillRect(sx + 5 * scale, sy - 46, 4 + flagWave, 3);
    ctx.fillRect(sx - 9 * scale, sy - 46, 4 - flagWave, 3);
  }

  function drawGrandSpire(ctx, sx, sy, tick, scale, colors) {
    // Ultimate monument — multi-gem spire with energy beam
    const pulse = Math.sin(tick * 0.025) * 0.15 + 0.85;
    const h = 60 * scale;

    // Wide base
    ctx.fillStyle = '#4A4A4A';
    ctx.fillRect(sx - 10 * scale, sy - 14, 20 * scale, 8);

    // Marble pillar
    ctx.fillStyle = '#D0D0D0';
    ctx.fillRect(sx - 6 * scale, sy - 40, 12 * scale, 28);

    // Gold trim bands
    ctx.fillStyle = '#FFD700';
    ctx.fillRect(sx - 7 * scale, sy - 14, 14 * scale, 2);
    ctx.fillRect(sx - 7 * scale, sy - 28, 14 * scale, 2);
    ctx.fillRect(sx - 7 * scale, sy - 42, 14 * scale, 2);

    // Spire top section
    ctx.fillStyle = '#E8E8E8';
    ctx.beginPath();
    ctx.moveTo(sx - 5 * scale, sy - 42);
    ctx.lineTo(sx, sy - 60);
    ctx.lineTo(sx + 5 * scale, sy - 42);
    ctx.closePath();
    ctx.fill();

    // Ruby gem at peak
    ctx.save();
    ctx.globalAlpha = pulse;
    const gemGrad = ctx.createRadialGradient(sx, sy - 60, 1, sx, sy - 60, 5);
    gemGrad.addColorStop(0, '#FFF');
    gemGrad.addColorStop(0.3, '#FF6B6B');
    gemGrad.addColorStop(0.7, '#E74C3C');
    gemGrad.addColorStop(1, 'rgba(231, 76, 60, 0)');
    ctx.fillStyle = gemGrad;
    ctx.beginPath();
    ctx.arc(sx, sy - 60, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Energy beam upward
    ctx.save();
    const beamAlpha = Math.sin(tick * 0.05) * 0.15 + 0.25;
    ctx.globalAlpha = beamAlpha;
    const beamGrad = ctx.createLinearGradient(sx, sy - 60, sx, sy - 80);
    beamGrad.addColorStop(0, colors.secondary);
    beamGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = beamGrad;
    ctx.fillRect(sx - 2, sy - 80, 4, 20);
    ctx.restore();

    // Embedded gems on pillar face
    const gems = ['#E74C3C', '#3498DB', '#2ECC71', '#F39C12'];
    for (let i = 0; i < gems.length; i++) {
      const gemY = sy - 18 - i * 7;
      const gemPulse = Math.sin(tick * 0.06 + i * 1.5) * 0.3 + 0.7;
      ctx.fillStyle = gems[i];
      ctx.globalAlpha = gemPulse;
      ctx.fillRect(sx - 2, gemY, 4, 3);
    }
    ctx.globalAlpha = 1;
  }

  function drawOrbitingParticles(ctx, sx, sy, tick, stage, colors) {
    const count = stage; // more particles at higher stages
    for (let i = 0; i < count; i++) {
      const angle = (tick * 0.02 + i * Math.PI * 2 / count) % (Math.PI * 2);
      const radius = 14 + stage * 3;
      const px = sx + Math.cos(angle) * radius;
      const py = sy + Math.sin(angle) * radius * 0.4; // elliptical orbit
      const alpha = Math.sin(tick * 0.08 + i) * 0.3 + 0.7;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = colors.secondary;
      ctx.fillRect(px - 1, py - 1, 2, 2);
      ctx.restore();
    }
  }

  function drawSparkles(ctx, sx, sy, tick, stage, scale, colors) {
    const sparkCount = 3 + stage * 2;
    for (let i = 0; i < sparkCount; i++) {
      const phase = (tick + i * 17) % 40;
      if (phase > 6) continue;

      const angle = (i * 2.3 + tick * 0.01) % (Math.PI * 2);
      const dist = 6 + stage * 2 + Math.sin(i * 1.7) * 4;
      const px = sx + Math.cos(angle) * dist * scale;
      const py = sy - 20 * scale + Math.sin(angle) * dist * 0.5 * scale;

      ctx.fillStyle = phase < 3 ? '#FFF' : colors.secondary;
      ctx.fillRect(px, py, 2, 2);
    }
  }

  // ===== State =====

  function getState() {
    return { stage: currentStage };
  }

  function loadState(saved) {
    if (saved && saved.stage !== undefined) {
      currentStage = saved.stage;
    }
  }

  return {
    STAGES,
    update,
    draw,
    getStage,
    getStageName,
    getState,
    loadState,
  };
})();

if (typeof module !== 'undefined') module.exports = MonumentV2;
