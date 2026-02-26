/**
 * house-customizer.js — Player House Interior Customization (TBD Backlog P2).
 *
 * Lets the player decorate their house interior:
 *   - Place/move furniture items on a grid
 *   - Change wall & floor colors
 *   - Decoration mode toggle [H] near house
 *
 * Furniture unlocked via shop purchases or friendship milestones.
 * Persisted via farm-state.
 */
const HouseCustomizer = (() => {
  // House interior grid (8x6 tiles)
  const GRID_W = 8;
  const GRID_H = 6;
  const TILE_SIZE = 16;

  // Furniture catalog
  const FURNITURE = {
    bed:       { name: 'Bed',       emoji: '\u{1F6CF}\u{FE0F}', w: 2, h: 1, cost: 50 },
    table:     { name: 'Table',     emoji: '\u{1FA91}',          w: 1, h: 1, cost: 20 },
    chair:     { name: 'Chair',     emoji: '\u{1FA91}',          w: 1, h: 1, cost: 15 },
    bookshelf: { name: 'Bookshelf', emoji: '\u{1F4DA}',          w: 1, h: 2, cost: 35 },
    plant:     { name: 'Plant',     emoji: '\u{1FAB4}',          w: 1, h: 1, cost: 10 },
    lamp:      { name: 'Lamp',      emoji: '\u{1F4A1}',          w: 1, h: 1, cost: 15 },
    rug:       { name: 'Rug',       emoji: '\u{1F9F6}',          w: 2, h: 2, cost: 25 },
    fireplace: { name: 'Fireplace', emoji: '\u{1F525}',          w: 2, h: 1, cost: 80 },
    trophy:    { name: 'Trophy',    emoji: '\u{1F3C6}',          w: 1, h: 1, cost: 100 },
    painting:  { name: 'Painting',  emoji: '\u{1F5BC}\u{FE0F}',  w: 1, h: 1, cost: 40 },
  };

  // Wall/floor color options
  const WALL_COLORS = ['#8B7355', '#A0522D', '#D2B48C', '#F5DEB3', '#C8A882', '#6B4226'];
  const FLOOR_COLORS = ['#DEB887', '#D2691E', '#8B4513', '#CD853F', '#A0522D', '#F4A460'];

  // State
  let decorMode = false;
  let placed = [];        // [{ type, gx, gy }]
  let wallColor = 0;
  let floorColor = 0;
  let cursorX = 0;
  let cursorY = 0;
  let selectedFurniture = 0;
  let catalogOpen = false;
  const furnitureKeys = Object.keys(FURNITURE);
  let initialized = false;

  // ===== Init =====

  function init(savedState) {
    if (savedState) {
      placed = savedState.placed || [];
      wallColor = savedState.wallColor || 0;
      floorColor = savedState.floorColor || 0;
    }
    initialized = true;
  }

  // ===== Decor Mode =====

  function isNearHouse() {
    if (typeof Player === 'undefined') return false;
    const pos = Player.getPosition();
    // House is typically around (6,6) in starting area
    return Math.abs(pos.x - 6) <= 2 && Math.abs(pos.y - 6) <= 2;
  }

  function toggle() {
    if (!isNearHouse() && !decorMode) return false;
    decorMode = !decorMode;
    if (decorMode) {
      cursorX = 0;
      cursorY = 0;
      catalogOpen = false;
      selectedFurniture = 0;
    }
    return true;
  }

  function isOpen() { return decorMode; }

  // ===== Key Handling =====

  function handleKey(key) {
    if (!decorMode) return false;

    if (key === 'Escape' || key === 'h' || key === 'H') {
      decorMode = false;
      return true;
    }

    // Catalog toggle
    if (key === 'Tab') {
      catalogOpen = !catalogOpen;
      return true;
    }

    if (catalogOpen) {
      if (key === 'ArrowUp' || key === 'w' || key === 'W') {
        selectedFurniture = Math.max(0, selectedFurniture - 1);
        return true;
      }
      if (key === 'ArrowDown' || key === 's' || key === 'S') {
        selectedFurniture = Math.min(furnitureKeys.length - 1, selectedFurniture + 1);
        return true;
      }
      if (key === 'Enter' || key === 'e' || key === 'E') {
        catalogOpen = false;
        return true;
      }
      return true;
    }

    // Cursor movement
    if (key === 'ArrowUp' || key === 'w' || key === 'W') { cursorY = Math.max(0, cursorY - 1); return true; }
    if (key === 'ArrowDown' || key === 's' || key === 'S') { cursorY = Math.min(GRID_H - 1, cursorY + 1); return true; }
    if (key === 'ArrowLeft' || key === 'a' || key === 'A') { cursorX = Math.max(0, cursorX - 1); return true; }
    if (key === 'ArrowRight' || key === 'd' || key === 'D') { cursorX = Math.min(GRID_W - 1, cursorX + 1); return true; }

    // Place furniture
    if (key === 'Enter' || key === 'e' || key === 'E') {
      placeFurniture(furnitureKeys[selectedFurniture], cursorX, cursorY);
      return true;
    }

    // Remove furniture at cursor
    if (key === 'x' || key === 'X' || key === 'Delete') {
      removeFurnitureAt(cursorX, cursorY);
      return true;
    }

    // Cycle wall color
    if (key === '1') {
      wallColor = (wallColor + 1) % WALL_COLORS.length;
      return true;
    }

    // Cycle floor color
    if (key === '2') {
      floorColor = (floorColor + 1) % FLOOR_COLORS.length;
      return true;
    }

    return false;
  }

  // ===== Furniture Placement =====

  function placeFurniture(type, gx, gy) {
    const def = FURNITURE[type];
    if (!def) return false;

    // Bounds check
    if (gx + def.w > GRID_W || gy + def.h > GRID_H) return false;

    // Collision check
    for (const p of placed) {
      const pd = FURNITURE[p.type];
      if (rectsOverlap(gx, gy, def.w, def.h, p.gx, p.gy, pd.w, pd.h)) return false;
    }

    // Cost check
    if (typeof ResourceInventory !== 'undefined') {
      const gold = ResourceInventory.getResource('gold') || 0;
      if (gold < def.cost) {
        if (typeof IsoEffects !== 'undefined') {
          const pp = (typeof Player !== 'undefined') ? Player.getPosition() : { x: 10, y: 10 };
          IsoEffects.spawnText(pp.x, pp.y - 1, `Need ${def.cost}g`, { color: '#FF6666', life: 60, rise: 0.3 });
        }
        return false;
      }
      ResourceInventory.addResource('gold', -def.cost);
    }

    placed.push({ type, gx, gy });
    _save();

    if (typeof IsoEffects !== 'undefined') {
      const pp = (typeof Player !== 'undefined') ? Player.getPosition() : { x: 10, y: 10 };
      IsoEffects.spawnText(pp.x, pp.y - 1, `${def.emoji} Placed!`, { color: '#4FC3F7', life: 40, rise: 0.3 });
    }

    return true;
  }

  function removeFurnitureAt(gx, gy) {
    const idx = placed.findIndex(p => {
      const pd = FURNITURE[p.type];
      if (!pd) return false;
      return gx >= p.gx && gx < p.gx + pd.w && gy >= p.gy && gy < p.gy + pd.h;
    });
    if (idx >= 0) {
      const removed = placed.splice(idx, 1)[0];
      _save();
      // Refund half
      const def = FURNITURE[removed.type];
      if (typeof ResourceInventory !== 'undefined') {
        ResourceInventory.addResource('gold', Math.floor(def.cost / 2));
      }
      return true;
    }
    return false;
  }

  function rectsOverlap(x1, y1, w1, h1, x2, y2, w2, h2) {
    return x1 < x2 + w2 && x1 + w1 > x2 && y1 < y2 + h2 && y1 + h1 > y2;
  }

  // ===== Draw =====

  function draw(ctx, canvasW, canvasH, tick) {
    if (!decorMode) return;

    ctx.save();

    // Interior background
    const ox = (canvasW - GRID_W * TILE_SIZE) / 2;
    const oy = (canvasH - GRID_H * TILE_SIZE) / 2 - 10;

    // Wall
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillRect(0, 0, canvasW, canvasH);

    ctx.fillStyle = WALL_COLORS[wallColor];
    ctx.fillRect(ox - 4, oy - 20, GRID_W * TILE_SIZE + 8, 24);

    // Floor
    ctx.fillStyle = FLOOR_COLORS[floorColor];
    ctx.fillRect(ox, oy, GRID_W * TILE_SIZE, GRID_H * TILE_SIZE);

    // Grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= GRID_W; x++) {
      ctx.beginPath();
      ctx.moveTo(ox + x * TILE_SIZE, oy);
      ctx.lineTo(ox + x * TILE_SIZE, oy + GRID_H * TILE_SIZE);
      ctx.stroke();
    }
    for (let y = 0; y <= GRID_H; y++) {
      ctx.beginPath();
      ctx.moveTo(ox, oy + y * TILE_SIZE);
      ctx.lineTo(ox + GRID_W * TILE_SIZE, oy + y * TILE_SIZE);
      ctx.stroke();
    }

    // Placed furniture
    for (const p of placed) {
      const def = FURNITURE[p.type];
      if (!def) continue;
      ctx.font = `${Math.min(def.w, def.h) * 12}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(def.emoji,
        ox + (p.gx + def.w / 2) * TILE_SIZE,
        oy + (p.gy + def.h / 2) * TILE_SIZE);
    }

    // Cursor
    const curDef = FURNITURE[furnitureKeys[selectedFurniture]];
    const curAlpha = Math.sin(tick * 0.1) * 0.3 + 0.5;
    ctx.fillStyle = `rgba(79, 195, 247, ${curAlpha})`;
    ctx.fillRect(ox + cursorX * TILE_SIZE, oy + cursorY * TILE_SIZE,
      curDef.w * TILE_SIZE, curDef.h * TILE_SIZE);

    // Title
    ctx.font = 'bold 9px monospace';
    ctx.fillStyle = '#4FC3F7';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('\u{1F3E0} HOUSE DECORATOR', canvasW / 2, 6);

    // Selected furniture info
    ctx.font = '7px monospace';
    ctx.fillStyle = '#FFF';
    ctx.textAlign = 'left';
    ctx.fillText(`Selected: ${curDef.emoji} ${curDef.name} (${curDef.cost}g)`, ox, oy + GRID_H * TILE_SIZE + 8);

    // Controls
    ctx.font = '6px monospace';
    ctx.fillStyle = '#666';
    ctx.textAlign = 'center';
    ctx.fillText('[WASD] Move  [E] Place  [X] Remove  [Tab] Catalog  [1] Wall  [2] Floor  [H/ESC] Exit',
      canvasW / 2, canvasH - 6);

    // Catalog overlay
    if (catalogOpen) {
      drawCatalog(ctx, canvasW, canvasH);
    }

    ctx.restore();
  }

  function drawCatalog(ctx, canvasW, canvasH) {
    const pw = 140;
    const ph = furnitureKeys.length * 14 + 20;
    const px = canvasW - pw - 10;
    const py = 20;

    ctx.fillStyle = 'rgba(20, 15, 10, 0.95)';
    ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 1;
    ctx.strokeRect(px, py, pw, ph);

    ctx.font = 'bold 8px monospace';
    ctx.fillStyle = '#FFD700';
    ctx.textAlign = 'center';
    ctx.fillText('CATALOG', px + pw / 2, py + 12);

    ctx.textAlign = 'left';
    for (let i = 0; i < furnitureKeys.length; i++) {
      const key = furnitureKeys[i];
      const def = FURNITURE[key];
      const isSel = i === selectedFurniture;
      const y = py + 22 + i * 14;

      if (isSel) {
        ctx.fillStyle = 'rgba(255, 215, 0, 0.15)';
        ctx.fillRect(px + 2, y - 4, pw - 4, 14);
      }

      ctx.font = '7px monospace';
      ctx.fillStyle = isSel ? '#FFD700' : '#AAA';
      ctx.fillText(`${def.emoji} ${def.name}`, px + 6, y + 4);
      ctx.fillStyle = '#888';
      ctx.textAlign = 'right';
      ctx.fillText(`${def.cost}g`, px + pw - 6, y + 4);
      ctx.textAlign = 'left';
    }
  }

  // ===== Persistence =====

  function _save() {
    if (typeof window !== 'undefined' && window.buddy && window.buddy.saveHouseCustom) {
      window.buddy.saveHouseCustom(getState());
    }
  }

  function getState() {
    return { placed, wallColor, floorColor };
  }

  return {
    init,
    toggle,
    isOpen,
    handleKey,
    draw,
    getState,
    isNearHouse,
  };
})();
