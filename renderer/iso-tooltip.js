// Iso Tooltip — pixel-art info bubbles for entities in the isometric view.
// Shows buddy activity, crop growth %, animal type, building name.
// Anchored to entity screen position, follows camera.
const IsoTooltip = (() => {
  // Current tooltip target
  let target = null;  // { entity, type, data }
  let fadeAlpha = 0;
  const FADE_SPEED = 0.08;

  // Tooltip styles
  const PADDING = 4;
  const LINE_H = 11;
  const MAX_WIDTH = 130;
  const ARROW_SIZE = 4;
  const BG_COLOR = 'rgba(20, 20, 40, 0.85)';
  const BORDER_COLOR = '#FFD700';
  const TEXT_COLOR = '#FFF';
  const ACCENT_COLOR = '#88DDFF';
  const LABEL_COLOR = '#AAA';

  // ===== Entity detection =====

  /**
   * Find the entity nearest to a grid position, within a threshold.
   * @param {number} col - Grid column (from mouseToGrid)
   * @param {number} row - Grid row
   * @returns {object|null} - { entity, distance }
   */
  function findEntityAt(col, row) {
    if (typeof IsoEntityManager === 'undefined') return null;
    const all = IsoEntityManager.getAll();
    let best = null;
    let bestDist = 1.5; // max pickup radius in grid units

    for (const ent of all) {
      const dx = ent.gridX - col;
      const dy = ent.gridY - row;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDist) {
        bestDist = dist;
        best = ent;
      }
    }
    return best;
  }

  /**
   * Update tooltip target based on hovered grid position.
   * Called each frame from renderer.
   */
  function updateHover(col, row, buddyMap, buddyOrder) {
    const entity = findEntityAt(col, row);

    if (!entity) {
      target = null;
      return;
    }

    const data = buildTooltipData(entity, buddyMap, buddyOrder);
    if (data) {
      target = { entity, data };
    } else {
      target = null;
    }
  }

  /**
   * Build tooltip content based on entity type.
   */
  function buildTooltipData(entity, buddyMap, buddyOrder) {
    if (!entity) return null;

    switch (entity.entityType) {
      case 'character':
        return buildCharacterTooltip(entity, buddyMap, buddyOrder);
      case 'animal':
        return buildAnimalTooltip(entity);
      case 'static':
        return buildStaticTooltip(entity);
      default:
        return null;
    }
  }

  function buildCharacterTooltip(entity, buddyMap, buddyOrder) {
    // Find the buddy state machine for this entity
    let buddyState = null;
    let buddyName = entity.name || '?';
    if (buddyMap && buddyOrder) {
      for (const [id, buddy] of buddyMap) {
        if (buddy.project === entity.name) {
          buddyState = buddy.sm;
          break;
        }
      }
    }

    const lines = [];
    lines.push({ text: buddyName, color: entity.hoodieColor || '#FFF', bold: true });

    if (buddyState) {
      const stateEmoji = {
        idle: '\u{1F4A4}', thinking: '\u{1F914}', writing: '\u{270D}',
        reading: '\u{1F4D6}', bash: '\u{1F4BB}', browsing: '\u{1F310}',
        tasking: '\u{2699}', sleeping: '\u{1F634}', celebrating: '\u{1F389}',
      };
      const emoji = stateEmoji[buddyState.state] || '\u{2699}';
      lines.push({ text: `${emoji} ${buddyState.state}`, color: ACCENT_COLOR });
      if (buddyState.detail) {
        const detail = buddyState.detail.length > 18
          ? buddyState.detail.slice(0, 17) + '\u2026'
          : buddyState.detail;
        lines.push({ text: detail, color: LABEL_COLOR });
      }
    }

    return { lines, icon: '\u{1F464}' };
  }

  function buildAnimalTooltip(entity) {
    const typeNames = {
      chicken: 'Chicken', cow: 'Cow', pig: 'Pig',
      sheep: 'Sheep', cat: 'Cat', dog: 'Dog',
    };
    const typeEmoji = {
      chicken: '\u{1F414}', cow: '\u{1F404}', pig: '\u{1F437}',
      sheep: '\u{1F411}', cat: '\u{1F431}', dog: '\u{1F436}',
    };
    const stateLabels = {
      wander: 'Wandering', rest: 'Resting', react: 'Playing',
    };

    const name = typeNames[entity.type] || entity.type;
    const emoji = typeEmoji[entity.type] || '\u{1F43E}';
    const state = stateLabels[entity.state] || entity.state;

    const lines = [];
    lines.push({ text: `${emoji} ${name}`, color: '#FFF', bold: true });
    lines.push({ text: state, color: ACCENT_COLOR });

    // Show mood indicator
    if (entity.state === 'react' && entity.reactBehavior) {
      lines.push({ text: `Mood: ${entity.reactBehavior}`, color: LABEL_COLOR });
    }

    return { lines, icon: emoji };
  }

  function buildStaticTooltip(entity) {
    // Try to identify what this static entity is from context
    // Buildings and crops are created in iso-farm.js with draw functions
    // We can infer type from grid position

    const farmState = (typeof Farm !== 'undefined') ? Farm.getState() : null;
    if (!farmState) return null;

    // Check if it's a crop
    const cropInfo = getCropAtPosition(entity.gridX, entity.gridY, farmState);
    if (cropInfo) {
      return buildCropTooltip(cropInfo);
    }

    // Check if it's a building
    const buildingInfo = getBuildingAtPosition(entity.gridX, entity.gridY, farmState);
    if (buildingInfo) {
      return buildBuildingTooltip(buildingInfo);
    }

    return null; // trees and other decorations — no tooltip
  }

  function getCropAtPosition(col, row, farmState) {
    // Use IsoFarm's plot positions (multi-tile rows)
    const positions = (typeof IsoFarm !== 'undefined') ? IsoFarm.PLOT_POSITIONS : [];
    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      const w = pos.width || 1;
      // Check if col is within the plot's tile range
      if (row >= pos.row - 0.5 && row < pos.row + 0.5 &&
          col >= pos.col - 0.5 && col < pos.col + w + 0.5) {
        const plot = farmState.plots && farmState.plots[i];
        if (plot && plot.crop) {
          return { ...plot, index: i };
        }
      }
    }
    return null;
  }

  function getBuildingAtPosition(col, row, farmState) {
    // Use IsoFarm's positions if available, otherwise fallback
    const positions = (typeof IsoFarm !== 'undefined' && IsoFarm.BUILDING_POSITIONS)
      ? IsoFarm.BUILDING_POSITIONS
      : {
          well:     { col: 2,  row: 15 },
          barn:     { col: 5,  row: 15 },
          windmill: { col: 8,  row: 15 },
          market:   { col: 11, row: 15 },
          clock:    { col: 14, row: 15 },
          townhall: { col: 4,  row: 17 },
          statue:   { col: 15, row: 17 },
        };
    for (const [name, pos] of Object.entries(positions)) {
      if (Math.abs(pos.col - col) < 1.5 && Math.abs(pos.row - row) < 1.5) {
        if (farmState.buildings && farmState.buildings[name]) {
          return { name, col: pos.col, row: pos.row };
        }
      }
    }
    return null;
  }

  function buildCropTooltip(cropInfo) {
    const cropEmoji = {
      carrot: '\u{1F955}', sunflower: '\u{1F33B}', watermelon: '\u{1F349}',
      tomato: '\u{1F345}', corn: '\u{1F33D}', pumpkin: '\u{1F383}',
    };
    const stageNames = ['Seed', 'Sprout', 'Growing', 'Mature'];
    const emoji = cropEmoji[cropInfo.crop] || '\u{1F331}';
    const stageName = stageNames[Math.min(cropInfo.stage - 1, 3)] || 'Empty';
    const pct = cropInfo.stage >= 4 ? 100 : Math.floor(((cropInfo.stage - 1) / 3) * 100);

    const lines = [];
    lines.push({ text: `${emoji} ${cropInfo.crop}`, color: '#FFF', bold: true });
    lines.push({ text: `Stage: ${stageName}`, color: ACCENT_COLOR });

    // Progress bar text
    const barFill = Math.floor(pct / 10);
    const bar = '\u2588'.repeat(barFill) + '\u2591'.repeat(10 - barFill);
    lines.push({ text: `${bar} ${pct}%`, color: pct >= 100 ? '#FFD700' : '#6AB04C' });

    return { lines, icon: emoji };
  }

  function buildBuildingTooltip(buildingInfo) {
    const buildingNames = {
      well: 'Water Well', barn: 'Barn', windmill: 'Windmill',
      market: 'Market', clock: 'Clock Tower', townhall: 'Town Hall', statue: 'Statue',
    };
    const buildingEmoji = {
      well: '\u{26F2}', barn: '\u{1F3DA}', windmill: '\u{1F3ED}',
      market: '\u{1F6D2}', clock: '\u{1F550}', townhall: '\u{1F3DB}', statue: '\u{1F5FF}',
    };
    const name = buildingNames[buildingInfo.name] || buildingInfo.name;
    const emoji = buildingEmoji[buildingInfo.name] || '\u{1F3E0}';

    const lines = [];
    lines.push({ text: `${emoji} ${name}`, color: '#FFF', bold: true });
    lines.push({ text: 'Built', color: '#6AB04C' });

    return { lines, icon: emoji };
  }

  // ===== Drawing =====

  function draw(ctx, canvasW, canvasH, tick) {
    // Fade animation
    if (target) {
      fadeAlpha = Math.min(1, fadeAlpha + FADE_SPEED);
    } else {
      fadeAlpha = Math.max(0, fadeAlpha - FADE_SPEED * 2);
    }

    if (fadeAlpha <= 0) return;

    const ent = target ? target.entity : null;
    const data = target ? target.data : null;
    if (!ent || !data) return;

    // Get entity screen position (already computed by IsoEntityManager)
    const zoom = (typeof IsoEngine !== 'undefined') ? IsoEngine.getZoom() : 1;
    const sx = ent.screenX * zoom;
    const sy = ent.screenY * zoom;

    // Measure tooltip size
    ctx.save();
    ctx.font = '9px monospace';
    let maxTextW = 0;
    for (const line of data.lines) {
      const w = ctx.measureText(line.text).width;
      if (w > maxTextW) maxTextW = w;
    }
    const tooltipW = Math.min(MAX_WIDTH, maxTextW + PADDING * 2 + 4);
    const tooltipH = data.lines.length * LINE_H + PADDING * 2;

    // Position: above entity, centered
    let tx = sx - tooltipW / 2;
    let ty = sy - tooltipH - ARROW_SIZE - 16; // 16px above entity head

    // Clamp to viewport
    tx = Math.max(4, Math.min(canvasW - tooltipW - 4, tx));
    ty = Math.max(4, ty);

    ctx.globalAlpha = fadeAlpha;

    // Background
    ctx.fillStyle = BG_COLOR;
    roundRect(ctx, tx, ty, tooltipW, tooltipH, 3);
    ctx.fill();

    // Border
    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth = 1;
    roundRect(ctx, tx, ty, tooltipW, tooltipH, 3);
    ctx.stroke();

    // Arrow pointing down to entity
    const arrowX = Math.max(tx + 8, Math.min(tx + tooltipW - 8, sx));
    ctx.fillStyle = BG_COLOR;
    ctx.beginPath();
    ctx.moveTo(arrowX - ARROW_SIZE, ty + tooltipH);
    ctx.lineTo(arrowX, ty + tooltipH + ARROW_SIZE);
    ctx.lineTo(arrowX + ARROW_SIZE, ty + tooltipH);
    ctx.closePath();
    ctx.fill();
    // Arrow border
    ctx.beginPath();
    ctx.moveTo(arrowX - ARROW_SIZE, ty + tooltipH);
    ctx.lineTo(arrowX, ty + tooltipH + ARROW_SIZE);
    ctx.lineTo(arrowX + ARROW_SIZE, ty + tooltipH);
    ctx.strokeStyle = BORDER_COLOR;
    ctx.stroke();

    // Text lines
    let textY = ty + PADDING + 6;
    for (const line of data.lines) {
      ctx.fillStyle = line.color || TEXT_COLOR;
      ctx.font = line.bold ? 'bold 9px monospace' : '8px monospace';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(line.text, tx + PADDING + 2, textY);
      textY += LINE_H;
    }

    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  // Clear tooltip (e.g. when leaving iso mode)
  function clear() {
    target = null;
    fadeAlpha = 0;
  }

  return {
    findEntityAt,
    updateHover,
    draw,
    clear,
  };
})();
