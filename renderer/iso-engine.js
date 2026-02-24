// Isometric Engine — V2.0 prototype for tile-based 2.5D rendering.
// This is the core isometric coordinate system, tile rendering, and depth sorting.
const IsoEngine = (() => {
  // Tile dimensions (in screen pixels)
  const TILE_W = 32;  // width of diamond top
  const TILE_H = 16;  // height of diamond top (half of width for standard 2:1 iso)
  const TILE_DEPTH = 8; // visual depth of a tile (side face height)

  // Map dimensions
  let mapWidth = 10;
  let mapHeight = 10;
  let tileMap = null; // 2D array of tile types

  // Camera offset (screen pixels)
  let camX = 0;
  let camY = 0;
  let camZoom = 1.0;        // zoom level (0.5 to 3.0)
  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 3.0;
  const ZOOM_SPEED = 0.1;

  // Entities to render (sorted by depth each frame)
  let entities = [];

  // Tile type definitions
  const TILE_TYPES = {
    grass:    { top: '#5AAE45', side: '#4E9A3C', edge: '#6ABD55' },
    dirt:     { top: '#C8A870', side: '#A08050', edge: '#D4B880' },
    soil:     { top: '#8B6B3E', side: '#6B5030', edge: '#9A7A4E' },
    water:    { top: '#4A90D9', side: '#3570B0', edge: '#6CB0E8', animated: true },
    stone:    { top: '#A0A0A0', side: '#808080', edge: '#B0B0B0' },
    sand:     { top: '#E8D8A0', side: '#C8B880', edge: '#F0E0B0' },
    path:     { top: '#D4C4A8', side: '#B0A088', edge: '#E0D0B8' },
    empty:    { top: null, side: null, edge: null },
  };

  // ===== Coordinate conversions =====

  // Grid (col, row, z) → screen (px, py)
  // z = height layer (0 = ground level, each +1 lifts by TILE_DEPTH)
  function gridToScreen(col, row, z) {
    const sx = (col - row) * (TILE_W / 2) + camX;
    const sy = (col + row) * (TILE_H / 2) + camY - (z || 0) * TILE_DEPTH;
    return { x: sx, y: sy };
  }

  // Screen (px, py) → approximate grid (col, row)
  function screenToGrid(sx, sy) {
    const rx = sx - camX;
    const ry = sy - camY;
    const col = (rx / (TILE_W / 2) + ry / (TILE_H / 2)) / 2;
    const row = (ry / (TILE_H / 2) - rx / (TILE_W / 2)) / 2;
    return { col: Math.round(col), row: Math.round(row) };
  }

  // Depth key for sorting (higher row = drawn later = in front)
  // Multiply grid sum by 10 so z increments (integer) can slot between grid layers
  function depthKey(col, row, z) {
    return (col + row) * 10 + (z || 0);
  }

  // ===== Map management =====

  function initMap(w, h, defaultTile) {
    mapWidth = w;
    mapHeight = h;
    tileMap = [];
    for (let r = 0; r < h; r++) {
      tileMap[r] = [];
      for (let c = 0; c < w; c++) {
        tileMap[r][c] = defaultTile || 'grass';
      }
    }
  }

  function setTile(col, row, type) {
    if (tileMap && row >= 0 && row < mapHeight && col >= 0 && col < mapWidth) {
      tileMap[row][col] = type;
    }
  }

  function getTile(col, row) {
    if (tileMap && row >= 0 && row < mapHeight && col >= 0 && col < mapWidth) {
      return tileMap[row][col];
    }
    return null;
  }

  // ===== Auto-tiling (4-bit bitmask for edge transitions) =====
  // Groups define which tiles are "similar" for transition purposes
  const TILE_GROUPS = {
    grass:  'land',
    dirt:   'land',
    soil:   'land',
    sand:   'land',
    path:   'land',
    stone:  'land',
    water:  'water',
    empty:  'void',
  };

  // Transition colors: blended edge when two different groups meet
  const TRANSITION_COLORS = {
    'land-water': { edge: '#7CB8A0', blend: 'rgba(74, 144, 217, 0.3)' },
    'land-void':  { edge: '#6B5030', blend: 'rgba(0, 0, 0, 0.15)' },
  };

  /**
   * Compute a 4-bit bitmask for a tile based on its cardinal neighbors.
   * Bit layout: [North, East, South, West] — bit is 1 if neighbor is DIFFERENT group.
   * @returns {number} 0-15 bitmask
   */
  function getTileBitmask(col, row) {
    const center = getTile(col, row);
    if (!center) return 0;
    const cGroup = TILE_GROUPS[center] || 'land';

    let mask = 0;
    // North (row - 1)
    const n = getTile(col, row - 1);
    if (n && (TILE_GROUPS[n] || 'land') !== cGroup) mask |= 1;
    // East (col + 1)
    const e = getTile(col + 1, row);
    if (e && (TILE_GROUPS[e] || 'land') !== cGroup) mask |= 2;
    // South (row + 1)
    const s = getTile(col, row + 1);
    if (s && (TILE_GROUPS[s] || 'land') !== cGroup) mask |= 4;
    // West (col - 1)
    const w = getTile(col - 1, row);
    if (w && (TILE_GROUPS[w] || 'land') !== cGroup) mask |= 8;

    return mask;
  }

  /**
   * Draw transition edges on a tile based on its bitmask.
   * Called after the base tile is drawn.
   */
  function drawTileTransitions(ctx, sx, sy, col, row) {
    const mask = getTileBitmask(col, row);
    if (mask === 0) return; // no transitions needed

    const center = getTile(col, row);
    const cGroup = TILE_GROUPS[center] || 'land';

    const hw = TILE_W / 2;
    const hh = TILE_H / 2;

    // Determine transition color based on what we're bordering
    let transColor = 'rgba(100, 150, 200, 0.25)'; // default blue-ish
    // Check north neighbor to determine transition type
    const neighbors = [
      getTile(col, row - 1), getTile(col + 1, row),
      getTile(col, row + 1), getTile(col - 1, row),
    ];
    for (const nb of neighbors) {
      if (nb) {
        const nGroup = TILE_GROUPS[nb] || 'land';
        if (nGroup !== cGroup) {
          const key = [cGroup, nGroup].sort().join('-');
          if (TRANSITION_COLORS[key]) {
            transColor = TRANSITION_COLORS[key].blend;
          }
          break;
        }
      }
    }

    ctx.save();
    ctx.globalAlpha = 0.5;

    // North edge (top-right of diamond)
    if (mask & 1) {
      ctx.beginPath();
      ctx.moveTo(sx, sy - hh);
      ctx.lineTo(sx + hw, sy);
      ctx.lineTo(sx + hw * 0.6, sy - hh * 0.2);
      ctx.closePath();
      ctx.fillStyle = transColor;
      ctx.fill();
    }

    // East edge (bottom-right of diamond)
    if (mask & 2) {
      ctx.beginPath();
      ctx.moveTo(sx + hw, sy);
      ctx.lineTo(sx, sy + hh);
      ctx.lineTo(sx + hw * 0.6, sy + hh * 0.2);
      ctx.closePath();
      ctx.fillStyle = transColor;
      ctx.fill();
    }

    // South edge (bottom-left of diamond)
    if (mask & 4) {
      ctx.beginPath();
      ctx.moveTo(sx, sy + hh);
      ctx.lineTo(sx - hw, sy);
      ctx.lineTo(sx - hw * 0.6, sy + hh * 0.2);
      ctx.closePath();
      ctx.fillStyle = transColor;
      ctx.fill();
    }

    // West edge (top-left of diamond)
    if (mask & 8) {
      ctx.beginPath();
      ctx.moveTo(sx - hw, sy);
      ctx.lineTo(sx, sy - hh);
      ctx.lineTo(sx - hw * 0.6, sy - hh * 0.2);
      ctx.closePath();
      ctx.fillStyle = transColor;
      ctx.fill();
    }

    ctx.restore();
  }

  // ===== Entity management =====

  function addEntity(entity) {
    // entity: { col, row, z?, spriteId?, direction?, frame?, draw?: (ctx, screenX, screenY, tick) => void }
    entities.push(entity);
  }

  function clearEntities() {
    entities = [];
  }

  // ===== Rendering =====

  function drawTile(ctx, sx, sy, type, tick) {
    const def = TILE_TYPES[type];
    if (!def || !def.top) return;

    const hw = TILE_W / 2;
    const hh = TILE_H / 2;

    // Water shimmer
    let topColor = def.top;
    if (def.animated && tick) {
      const shimmer = Math.sin(tick * 0.08 + sx * 0.01) * 15;
      topColor = adjustBrightness(def.top, shimmer);
    }

    // Top face (diamond)
    ctx.beginPath();
    ctx.moveTo(sx, sy - hh);       // top
    ctx.lineTo(sx + hw, sy);        // right
    ctx.lineTo(sx, sy + hh);        // bottom
    ctx.lineTo(sx - hw, sy);        // left
    ctx.closePath();
    ctx.fillStyle = topColor;
    ctx.fill();

    // Edge highlight (top edge of diamond)
    ctx.beginPath();
    ctx.moveTo(sx, sy - hh);
    ctx.lineTo(sx + hw, sy);
    ctx.strokeStyle = def.edge;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Left side face
    ctx.beginPath();
    ctx.moveTo(sx - hw, sy);
    ctx.lineTo(sx, sy + hh);
    ctx.lineTo(sx, sy + hh + TILE_DEPTH);
    ctx.lineTo(sx - hw, sy + TILE_DEPTH);
    ctx.closePath();
    ctx.fillStyle = def.side;
    ctx.fill();

    // Right side face (slightly lighter)
    ctx.beginPath();
    ctx.moveTo(sx + hw, sy);
    ctx.lineTo(sx, sy + hh);
    ctx.lineTo(sx, sy + hh + TILE_DEPTH);
    ctx.lineTo(sx + hw, sy + TILE_DEPTH);
    ctx.closePath();
    ctx.fillStyle = adjustBrightness(def.side, 15);
    ctx.fill();
  }

  function drawMap(ctx, canvasW, canvasH, tick) {
    if (!tileMap) return;

    // Apply zoom transform
    ctx.save();
    ctx.scale(camZoom, camZoom);

    // Adjust culling bounds for zoom
    const cullW = canvasW / camZoom;
    const cullH = canvasH / camZoom;

    // Collect all renderable items with depth
    const renderList = [];

    // Tiles
    for (let r = 0; r < mapHeight; r++) {
      for (let c = 0; c < mapWidth; c++) {
        const { x, y } = gridToScreen(c, r);
        // Frustum culling (zoom-adjusted)
        if (x < -TILE_W || x > cullW + TILE_W || y < -TILE_H * 2 || y > cullH + TILE_H) continue;
        renderList.push({
          depth: depthKey(c, r),
          type: 'tile',
          col: c,
          row: r,
          x,
          y,
        });
      }
    }

    // Entities
    for (const ent of entities) {
      const ez = ent.z || 0;
      const { x, y } = gridToScreen(ent.col, ent.row, ez);
      renderList.push({
        depth: depthKey(ent.col, ent.row, ez) + 0.5, // entities render slightly after their tile
        type: 'entity',
        entity: ent,
        x,
        y,
      });
    }

    // Sort by depth (painter's algorithm: back to front)
    renderList.sort((a, b) => a.depth - b.depth);

    // Render
    for (const item of renderList) {
      if (item.type === 'tile') {
        drawTile(ctx, item.x, item.y, tileMap[item.row][item.col], tick);
        drawTileTransitions(ctx, item.x, item.y, item.col, item.row);
      } else if (item.type === 'entity') {
        const ent = item.entity;
        // Try sprite-based rendering first
        if (ent.spriteId && typeof SpriteManager !== 'undefined' && SpriteManager.has(ent.spriteId)) {
          SpriteManager.draw(ctx, ent.spriteId, item.x, item.y, ent.direction, ent.frame);
        } else if (ent.draw) {
          ent.draw(ctx, item.x, item.y, tick);
        }
      }
    }

    ctx.restore(); // end zoom transform
  }

  // ===== Camera =====

  function setCamera(x, y) {
    camX = x;
    camY = y;
  }

  function moveCamera(dx, dy) {
    camX += dx;
    camY += dy;
  }

  function centerOnTile(col, row, canvasW, canvasH) {
    const { x, y } = gridToScreen(col, row);
    camX += canvasW / 2 / camZoom - x + camX * (1 - 1);
    camY += canvasH / 2 / camZoom - y + camY * (1 - 1);
  }

  /**
   * Zoom in/out centered on a screen point (e.g., mouse position).
   * @param {number} delta - Positive = zoom in, negative = zoom out
   * @param {number} focusX - Screen X to zoom toward
   * @param {number} focusY - Screen Y to zoom toward
   */
  function zoom(delta, focusX, focusY) {
    const oldZoom = camZoom;
    camZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, camZoom + delta * ZOOM_SPEED));

    // Adjust camera to keep the focus point stable
    if (focusX !== undefined && focusY !== undefined) {
      const zoomRatio = camZoom / oldZoom;
      camX = focusX - (focusX - camX) * zoomRatio;
      camY = focusY - (focusY - camY) * zoomRatio;
    }
  }

  function getZoom() { return camZoom; }
  function setZoom(z) { camZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)); }

  // ===== Helpers =====

  function adjustBrightness(hex, amount) {
    const r = Math.min(255, Math.max(0, parseInt(hex.slice(1, 3), 16) + amount));
    const g = Math.min(255, Math.max(0, parseInt(hex.slice(3, 5), 16) + amount));
    const b = Math.min(255, Math.max(0, parseInt(hex.slice(5, 7), 16) + amount));
    return `rgb(${r},${g},${b})`;
  }

  // ===== Isometric sprite helpers =====

  // Draw a simple isometric tree at screen position
  function drawIsoTree(ctx, sx, sy, tick) {
    const sway = Math.sin(tick * 0.02) * 1;
    // Trunk
    ctx.fillStyle = '#8B6B3E';
    ctx.fillRect(sx - 2, sy - 20, 4, 16);
    // Canopy
    ctx.fillStyle = '#3EA832';
    ctx.beginPath();
    ctx.arc(sx + sway, sy - 24, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4AB840';
    ctx.beginPath();
    ctx.arc(sx + sway + 3, sy - 22, 7, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw a simple isometric character (4 directions)
  function drawIsoCharacter(ctx, sx, sy, dir, frame, hoodieColor, tick) {
    const bob = frame % 2 === 0 ? 0 : -1;
    const bodyY = sy - 14 + bob;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(sx, sy, 6, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Legs
    ctx.fillStyle = '#5B7DAF';
    if (dir === 'down' || dir === 'up') {
      ctx.fillRect(sx - 3, bodyY + 8, 3, 4);
      ctx.fillRect(sx + 1, bodyY + 8, 3, 4);
    } else {
      ctx.fillRect(sx - 2, bodyY + 8, 3, 4);
      ctx.fillRect(sx + 0, bodyY + 9, 3, 3);
    }

    // Body (hoodie)
    ctx.fillStyle = hoodieColor;
    ctx.fillRect(sx - 5, bodyY, 10, 8);

    // Head
    ctx.fillStyle = '#FFD5B8';
    ctx.fillRect(sx - 4, bodyY - 6, 8, 6);

    // Hair
    ctx.fillStyle = '#4A3728';
    ctx.fillRect(sx - 4, bodyY - 8, 8, 3);

    // Eyes (direction-dependent)
    ctx.fillStyle = '#2C2C2C';
    if (dir === 'down') {
      ctx.fillRect(sx - 2, bodyY - 4, 2, 2);
      ctx.fillRect(sx + 1, bodyY - 4, 2, 2);
    } else if (dir === 'left') {
      ctx.fillRect(sx - 3, bodyY - 4, 2, 2);
    } else if (dir === 'right') {
      ctx.fillRect(sx + 2, bodyY - 4, 2, 2);
    }
    // 'up' direction: no eyes visible (back of head)
  }

  // Draw a crop at an isometric position
  function drawIsoCrop(ctx, sx, sy, stage, color, tick) {
    if (stage === 0) return; // empty
    const baseY = sy - 2;
    if (stage === 1) {
      // Seed
      ctx.fillStyle = '#8B6B3E';
      ctx.fillRect(sx - 1, baseY - 2, 2, 2);
    } else if (stage === 2) {
      // Sprout
      ctx.fillStyle = '#5AAE45';
      ctx.fillRect(sx - 1, baseY - 6, 2, 4);
      ctx.fillRect(sx - 2, baseY - 7, 4, 2);
    } else if (stage === 3) {
      // Growing
      ctx.fillStyle = '#5AAE45';
      ctx.fillRect(sx - 1, baseY - 8, 2, 6);
      ctx.fillStyle = color;
      ctx.fillRect(sx - 3, baseY - 10, 6, 4);
    } else {
      // Mature (stage 4)
      const flash = (tick % 20) < 10;
      ctx.fillStyle = '#5AAE45';
      ctx.fillRect(sx - 1, baseY - 10, 2, 8);
      ctx.fillStyle = flash ? '#FFF' : color;
      ctx.fillRect(sx - 4, baseY - 14, 8, 6);
      ctx.fillStyle = flash ? '#FFD700' : adjustBrightness(color, -20);
      ctx.fillRect(sx - 3, baseY - 12, 6, 3);
    }
  }

  return {
    TILE_W,
    TILE_H,
    TILE_DEPTH,
    TILE_TYPES,
    TILE_GROUPS,
    gridToScreen,
    screenToGrid,
    depthKey,
    getTileBitmask,
    initMap,
    setTile,
    getTile,
    addEntity,
    clearEntities,
    drawTile,
    drawTileTransitions,
    drawMap,
    setCamera,
    moveCamera,
    centerOnTile,
    zoom,
    getZoom,
    setZoom,
    drawIsoTree,
    drawIsoCharacter,
    drawIsoCrop,
  };
})();
