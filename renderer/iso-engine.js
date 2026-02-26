// Top-Down Engine — 3/4 perspective tile-based rendering (Harvest Moon style).
// Rectangular tiles viewed from above, depth sorted by row.
const IsoEngine = (() => {
  // Tile dimensions (in screen pixels)
  const TILE_W = 32;
  const TILE_H = 32;

  // Map dimensions
  let mapWidth = 20;
  let mapHeight = 18;
  let tileMap = null;

  // Home farm offset in world coordinates (set by ChunkManager mega-map)
  let homeOffsetCol = 0;
  let homeOffsetRow = 0;

  // Camera offset (screen pixels)
  let camX = 0;
  let camY = 0;
  let camZoom = 1.0;
  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 3.0;
  const ZOOM_SPEED = 0.15;

  // Hover state for mouse picking
  let hoverCol = -1;
  let hoverRow = -1;

  // Entities to render (sorted by depth each frame)
  let entities = [];

  // Tile type definitions — warm Harvest Moon palette
  const TILE_TYPES = {
    grass:    { top: '#6EBF4E', border: '#5AAE3D', dark: '#5BA83E' },
    darkgrass:{ top: '#4E9E38', border: '#3D8E2D', dark: '#408530' },
    dirt:     { top: '#C9A66B', border: '#B89458', dark: '#B49060' },
    soil:     { top: '#8B6D42', border: '#7A5C35', dark: '#6E5230' },
    soilwet:  { top: '#6B5235', border: '#5A422A', dark: '#4E3A25' },
    water:    { top: '#5BA0D9', border: '#4888C0', dark: '#4080B8', animated: true },
    stone:    { top: '#B0B0A8', border: '#9898A0', dark: '#909090' },
    sand:     { top: '#E8D89C', border: '#D0C488', dark: '#C8BC80' },
    path:     { top: '#D8C8A0', border: '#C0B088', dark: '#B8A880' },
    fence:    { top: '#C8A060', border: '#A88040', dark: '#906830' },
    mountain: { top: '#7A7A78', border: '#5A5A58', dark: '#4A4A48' },
    empty:    { top: null, border: null, dark: null },
  };

  // ===== Coordinate conversions =====

  // Grid (col, row) → screen (px, py) — simple rectangular projection
  function gridToScreen(col, row, z) {
    const sx = col * TILE_W + camX;
    const sy = row * TILE_H + camY - (z || 0) * TILE_H;
    return { x: sx, y: sy };
  }

  // Screen (px, py) → grid (col, row)
  function screenToGrid(sx, sy) {
    const col = Math.floor((sx - camX) / TILE_W);
    const row = Math.floor((sy - camY) / TILE_H);
    return { col, row };
  }

  // Mouse → grid (accounting for zoom)
  function mouseToGrid(mouseX, mouseY) {
    const wx = mouseX / camZoom;
    const wy = mouseY / camZoom;
    return screenToGrid(wx, wy);
  }

  function setHoverTile(col, row) {
    if (col >= 0 && col < mapWidth && row >= 0 && row < mapHeight) {
      hoverCol = col;
      hoverRow = row;
    } else {
      hoverCol = -1;
      hoverRow = -1;
    }
  }

  function getHoverTile() { return { col: hoverCol, row: hoverRow }; }

  // Depth key: row-based (higher row = closer to camera)
  function depthKey(col, row, z) {
    return row * 100 + (z || 0) * 10 + col * 0.01;
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
    // Initialize ChunkManager with the home farm layout
    if (typeof ChunkManager !== 'undefined') {
      ChunkManager.initHome(tileMap, w, h);
      // Store home offset so local coords (used by IsoFarm) map to world coords
      if (ChunkManager.getHomeOffset) {
        const off = ChunkManager.getHomeOffset();
        homeOffsetCol = off.col;
        homeOffsetRow = off.row;
      }
    }
  }

  function setTile(col, row, type) {
    // Delegate to ChunkManager for infinite map support
    if (typeof ChunkManager !== 'undefined') {
      ChunkManager.setTile(col, row, type);
      // Also update local tileMap if within home bounds (backward compat)
      const lc = col - homeOffsetCol;
      const lr = row - homeOffsetRow;
      if (tileMap && lr >= 0 && lr < mapHeight && lc >= 0 && lc < mapWidth) {
        tileMap[lr][lc] = type;
      }
      return;
    }
    if (tileMap && row >= 0 && row < mapHeight && col >= 0 && col < mapWidth) {
      tileMap[row][col] = type;
    }
  }

  function getTile(col, row) {
    // Delegate to ChunkManager for infinite map support
    if (typeof ChunkManager !== 'undefined') {
      return ChunkManager.getTile(col, row);
    }
    if (tileMap && row >= 0 && row < mapHeight && col >= 0 && col < mapWidth) {
      return tileMap[row][col];
    }
    return null;
  }

  /** Get home farm world offset (for converting local farm coords to world). */
  function getHomeOffset() {
    return { col: homeOffsetCol, row: homeOffsetRow };
  }

  // Tile groups for transition detection
  const TILE_GROUPS = {
    grass: 'land', darkgrass: 'land', dirt: 'land', soil: 'farm',
    soilwet: 'farm', sand: 'land', path: 'land', stone: 'land',
    fence: 'land', mountain: 'mountain', water: 'water', empty: 'void',
  };

  function getTileBitmask(col, row) {
    const center = getTile(col, row);
    if (!center) return 0;
    const cGroup = TILE_GROUPS[center] || 'land';
    let mask = 0;
    const n = getTile(col, row - 1);
    if (n && (TILE_GROUPS[n] || 'land') !== cGroup) mask |= 1;
    const e = getTile(col + 1, row);
    if (e && (TILE_GROUPS[e] || 'land') !== cGroup) mask |= 2;
    const s = getTile(col, row + 1);
    if (s && (TILE_GROUPS[s] || 'land') !== cGroup) mask |= 4;
    const w = getTile(col - 1, row);
    if (w && (TILE_GROUPS[w] || 'land') !== cGroup) mask |= 8;
    return mask;
  }

  // ===== Entity management =====

  // Persistent player entity (set once, updated in-place each frame)
  let playerEntity = null;
  let petEntity = null;

  function setPlayer(entity) {
    playerEntity = entity;
  }

  function setPet(entity) {
    petEntity = entity;
  }

  function addEntity(entity) {
    entities.push(entity);
  }

  function clearEntities() {
    entities = [];
  }

  // ===== Tile rendering (top-down rectangles) =====

  function drawTile(ctx, sx, sy, type, tick) {
    const def = TILE_TYPES[type];
    if (!def || !def.top) return;

    // Mountain tiles: tall rocky wall
    if (type === 'mountain') {
      const wallH = 20; // extra height above tile
      // Cliff face (dark)
      ctx.fillStyle = def.dark;
      ctx.fillRect(sx, sy - wallH, TILE_W, wallH + TILE_H);
      // Lighter top face
      ctx.fillStyle = def.top;
      ctx.fillRect(sx + 2, sy - wallH, TILE_W - 4, 6);
      // Snow cap on top
      ctx.fillStyle = '#E8E8E0';
      ctx.fillRect(sx + 4, sy - wallH - 2, TILE_W - 8, 4);
      // Rock texture lines
      ctx.strokeStyle = def.border;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(sx + 4, sy - wallH + 8); ctx.lineTo(sx + TILE_W - 4, sy - wallH + 10);
      ctx.moveTo(sx + 6, sy - wallH + 16); ctx.lineTo(sx + TILE_W - 6, sy - wallH + 14);
      ctx.moveTo(sx + 3, sy); ctx.lineTo(sx + TILE_W - 3, sy + 2);
      ctx.stroke();
      return;
    }

    let topColor = def.top;

    // Water shimmer
    if (def.animated && tick) {
      const shimmer = Math.sin(tick * 0.06 + sx * 0.03 + sy * 0.02) * 12;
      topColor = adjustBrightness(def.top, shimmer);
    }

    // Main tile face (flat rectangle)
    ctx.fillStyle = topColor;
    ctx.fillRect(sx, sy, TILE_W, TILE_H);

    // Subtle inner shadow on top edge (depth hint)
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(sx, sy, TILE_W, 1);

    // Subtle shadow on bottom edge
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    ctx.fillRect(sx, sy + TILE_H - 1, TILE_W, 1);

    // Grid border (subtle)
    ctx.strokeStyle = def.border;
    ctx.lineWidth = 0.5;
    ctx.strokeRect(sx + 0.5, sy + 0.5, TILE_W - 1, TILE_H - 1);
  }

  // Draw soil tile with tilled row texture
  function drawSoilDetail(ctx, sx, sy, type, tick) {
    if (type !== 'soil' && type !== 'soilwet') return;
    // Tilled furrow lines
    ctx.strokeStyle = type === 'soilwet' ? '#5A422A' : '#7A5C35';
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const fy = sy + 4 + i * 7;
      ctx.beginPath();
      ctx.moveTo(sx + 3, fy);
      ctx.lineTo(sx + TILE_W - 3, fy);
      ctx.stroke();
    }
  }

  // Draw tile transition edges (soft blend between different terrain types)
  function drawTileTransitions(ctx, sx, sy, col, row) {
    const mask = getTileBitmask(col, row);
    if (mask === 0) return;

    const center = getTile(col, row);
    const cGroup = TILE_GROUPS[center] || 'land';

    ctx.save();

    // North edge
    if (mask & 1) {
      const nb = getTile(col, row - 1);
      const nbDef = nb ? TILE_TYPES[nb] : null;
      if (nbDef && nbDef.top) {
        const grad = ctx.createLinearGradient(sx, sy, sx, sy + 4);
        grad.addColorStop(0, nbDef.top + '66');
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.fillRect(sx, sy, TILE_W, 4);
      }
    }

    // South edge
    if (mask & 4) {
      const nb = getTile(col, row + 1);
      const nbDef = nb ? TILE_TYPES[nb] : null;
      if (nbDef && nbDef.top) {
        const grad = ctx.createLinearGradient(sx, sy + TILE_H, sx, sy + TILE_H - 4);
        grad.addColorStop(0, nbDef.top + '66');
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.fillRect(sx, sy + TILE_H - 4, TILE_W, 4);
      }
    }

    // West edge
    if (mask & 8) {
      const nb = getTile(col - 1, row);
      const nbDef = nb ? TILE_TYPES[nb] : null;
      if (nbDef && nbDef.top) {
        const grad = ctx.createLinearGradient(sx, sy, sx + 4, sy);
        grad.addColorStop(0, nbDef.top + '66');
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.fillRect(sx, sy, 4, TILE_H);
      }
    }

    // East edge
    if (mask & 2) {
      const nb = getTile(col + 1, row);
      const nbDef = nb ? TILE_TYPES[nb] : null;
      if (nbDef && nbDef.top) {
        const grad = ctx.createLinearGradient(sx + TILE_W, sy, sx + TILE_W - 4, sy);
        grad.addColorStop(0, nbDef.top + '66');
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.fillRect(sx + TILE_W - 4, sy, 4, TILE_H);
      }
    }

    ctx.restore();
  }

  function drawTileHighlight(ctx, sx, sy, tick) {
    const pulse = 0.25 + Math.sin(tick * 0.1) * 0.1;

    ctx.save();
    ctx.fillStyle = `rgba(255, 255, 200, ${pulse})`;
    ctx.fillRect(sx, sy, TILE_W, TILE_H);
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 2;
    ctx.strokeRect(sx + 1, sy + 1, TILE_W - 2, TILE_H - 2);
    ctx.restore();
  }

  // ===== Entity shadows =====

  /**
   * Draw an elliptical shadow beneath an entity.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x - Screen center X
   * @param {number} y - Screen base Y (feet)
   * @param {number} rx - Horizontal radius
   */
  function drawShadow(ctx, x, y, rx) {
    const ry = rx * 0.4; // squashed ellipse
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** Return shadow radius based on entity type. 0 = no shadow. */
  function entityShadowRadius(ent) {
    if (!ent) return 0;
    if (ent.type === 'player') return 8;
    switch (ent.entityType) {
      case 'character': return 8;
      case 'animal': {
        const sizes = { chicken: 4, cow: 7, pig: 6, sheep: 6, cat: 4, dog: 5 };
        return sizes[ent.type] || 5;
      }
      case 'static': return 0; // trees/crops/buildings have their own ground
      default: return 0;
    }
  }

  // ===== Main rendering =====

  function drawMap(ctx, canvasW, canvasH, tick) {
    if (!tileMap && typeof ChunkManager === 'undefined') return;

    // Track canvas size for camera clamping
    lastCanvasW = canvasW;
    lastCanvasH = canvasH;

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.scale(camZoom, camZoom);

    const cullW = canvasW / camZoom;
    const cullH = canvasH / camZoom;

    // Determine tile iteration range
    let rMin, rMax, cMin, cMax;
    if (typeof ChunkManager !== 'undefined') {
      const wb = ChunkManager.getWorldBounds();
      rMin = wb.minRow;
      rMax = wb.maxRow;
      cMin = wb.minCol;
      cMax = wb.maxCol;
    } else {
      rMin = 0;
      rMax = mapHeight - 1;
      cMin = 0;
      cMax = mapWidth - 1;
    }

    // Collect renderable items
    const renderList = [];

    // Tiles (always drawn first, back to front)
    for (let r = rMin; r <= rMax; r++) {
      for (let c = cMin; c <= cMax; c++) {
        const { x, y } = gridToScreen(c, r);
        // Frustum culling
        if (x + TILE_W < 0 || x > cullW || y + TILE_H < 0 || y > cullH) continue;
        // Skip fog-of-war tiles
        if (typeof ChunkManager !== 'undefined' && ChunkManager.isFog(c, r)) continue;
        renderList.push({
          depth: depthKey(c, r),
          type: 'tile',
          col: c, row: r, x, y,
        });
      }
    }

    // Entities
    for (const ent of entities) {
      const ez = ent.z || 0;
      const { x, y } = gridToScreen(ent.col, ent.row, ez);
      ent.screenX = x + TILE_W / 2;
      ent.screenY = y;
      renderList.push({
        depth: depthKey(ent.col, ent.row, ez) + 0.5,
        type: 'entity',
        entity: ent, x, y,
      });
    }
    // Player entity (persistent reference, not re-pushed each frame)
    if (playerEntity) {
      const ez = playerEntity.z || 0;
      const { x, y } = gridToScreen(playerEntity.col, playerEntity.row, ez);
      playerEntity.screenX = x + TILE_W / 2;
      playerEntity.screenY = y;
      renderList.push({
        depth: depthKey(playerEntity.col, playerEntity.row, ez) + 0.5,
        type: 'entity',
        entity: playerEntity, x, y,
      });
    }
    // Pet entity (follows player)
    if (petEntity) {
      const ez = petEntity.z || 0;
      const { x, y } = gridToScreen(petEntity.col, petEntity.row, ez);
      petEntity.screenX = x + TILE_W / 2;
      petEntity.screenY = y;
      renderList.push({
        depth: depthKey(petEntity.col, petEntity.row, ez) + 0.4,
        type: 'entity',
        entity: petEntity, x, y,
      });
    }

    renderList.sort((a, b) => a.depth - b.depth);

    // Render pass
    for (const item of renderList) {
      if (item.type === 'tile') {
        const tileType = getTile(item.col, item.row);
        if (!tileType) continue;
        drawTile(ctx, item.x, item.y, tileType, tick);
        drawSoilDetail(ctx, item.x, item.y, tileType, tick);
        drawTileTransitions(ctx, item.x, item.y, item.col, item.row);
        if (item.col === hoverCol && item.row === hoverRow) {
          drawTileHighlight(ctx, item.x, item.y, tick);
        }
      } else if (item.type === 'entity') {
        const ent = item.entity;
        // Draw shadow beneath entity
        const shadowR = entityShadowRadius(ent);
        if (shadowR > 0) {
          drawShadow(ctx, item.x + TILE_W / 2, item.y + TILE_H / 2 + 2, shadowR);
        }
        if (ent.spriteId && typeof SpriteManager !== 'undefined' && SpriteManager.has(ent.spriteId)) {
          SpriteManager.draw(ctx, ent.spriteId, item.x + TILE_W / 2, item.y + TILE_H / 2, ent.direction, ent.frame);
        } else if (ent.draw) {
          ent.draw(ctx, item.x + TILE_W / 2, item.y + TILE_H / 2, tick);
        }
      }
    }

    ctx.restore();
  }

  // ===== Camera =====

  // Last known canvas size for boundary clamping
  let lastCanvasW = 660;
  let lastCanvasH = 500;
  const CAM_MARGIN = 128; // allow panning past the map edge for tall buildings

  function setCamera(x, y) { camX = x; camY = y; clampCamera(); }

  function moveCamera(dx, dy) { camX += dx; camY += dy; clampCamera(); }

  function centerOnTile(col, row, canvasW, canvasH) {
    if (canvasW) lastCanvasW = canvasW;
    if (canvasH) lastCanvasH = canvasH;
    camX = (canvasW || lastCanvasW) / 2 / camZoom - col * TILE_W - TILE_W / 2;
    camY = (canvasH || lastCanvasH) / 2 / camZoom - row * TILE_H - TILE_H / 2;
  }

  function zoom(delta, focusX, focusY) {
    const oldZoom = camZoom;
    camZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, camZoom + delta * ZOOM_SPEED));
    if (focusX !== undefined && focusY !== undefined) {
      const zoomRatio = camZoom / oldZoom;
      camX = focusX - (focusX - camX) * zoomRatio;
      camY = focusY - (focusY - camY) * zoomRatio;
    }
    clampCamera();
  }

  /** Clamp camera so the map stays mostly on-screen. */
  function clampCamera() {
    if (!tileMap && typeof ChunkManager === 'undefined') return;
    const vw = lastCanvasW / camZoom;
    const vh = lastCanvasH / camZoom;

    let worldW, worldH, offsetX, offsetY;
    if (typeof ChunkManager !== 'undefined') {
      // Use full world bounds for camera clamping (not just loaded chunks)
      const wb = ChunkManager.getFullWorldBounds
        ? ChunkManager.getFullWorldBounds()
        : ChunkManager.getWorldBounds();
      worldW = wb.width * TILE_W;
      worldH = wb.height * TILE_H;
      offsetX = wb.minCol * TILE_W;
      offsetY = wb.minRow * TILE_H;
    } else {
      worldW = mapWidth * TILE_W;
      worldH = mapHeight * TILE_H;
      offsetX = 0;
      offsetY = 0;
    }

    // Camera offset ranges: map should fill viewport with margin
    const minX = -(worldW + offsetX - vw + CAM_MARGIN);
    const maxX = -offsetX + CAM_MARGIN;
    const minY = -(worldH + offsetY - vh + CAM_MARGIN);
    const maxY = -offsetY + CAM_MARGIN;
    camX = Math.max(minX, Math.min(maxX, camX));
    camY = Math.max(minY, Math.min(maxY, camY));
  }

  function getZoom() { return camZoom; }
  function setZoom(z) { camZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)); }
  function getCameraState() { return { x: camX, y: camY, zoom: camZoom }; }

  /**
   * Smoothly move camera to center on a world-pixel position.
   * @param {number} worldX — target X in world pixels
   * @param {number} worldY — target Y in world pixels
   * @param {number} lerp — interpolation factor (0..1, higher = snappier). Default 0.08.
   */
  function smoothFollow(worldX, worldY, lerp) {
    const t = lerp || 0.08;
    const vw = lastCanvasW / camZoom;
    const vh = lastCanvasH / camZoom;
    const targetX = vw / 2 - worldX;
    const targetY = vh / 2 - worldY;
    camX += (targetX - camX) * t;
    camY += (targetY - camY) * t;
    clampCamera();
  }

  function getMapSize() { return { w: mapWidth, h: mapHeight }; }

  // Viewport state persistence (survives view mode toggles)
  let savedViewport = null;
  function saveViewportState() {
    savedViewport = { camX, camY, zoom: camZoom };
  }
  function restoreViewportState() {
    if (!savedViewport) return false;
    camX = savedViewport.camX;
    camY = savedViewport.camY;
    camZoom = savedViewport.zoom;
    savedViewport = null;
    return true;
  }
  function hasSavedViewport() { return !!savedViewport; }

  // ===== Helpers =====

  function adjustBrightness(hex, amount) {
    if (!hex || hex[0] !== '#') return hex;
    const r = Math.min(255, Math.max(0, parseInt(hex.slice(1, 3), 16) + amount));
    const g = Math.min(255, Math.max(0, parseInt(hex.slice(3, 5), 16) + amount));
    const b = Math.min(255, Math.max(0, parseInt(hex.slice(5, 7), 16) + amount));
    return `rgb(${r},${g},${b})`;
  }

  // ===== Top-down sprite helpers =====

  // Tree (viewed from above — circular canopy with trunk visible below)
  // Seasonal palette from IsoSeasons (spring blossoms, autumn orange, winter bare)
  function drawIsoTree(ctx, sx, sy, tick) {
    const sway = Math.sin(tick * 0.02 + sx) * 0.7;
    // Get seasonal palette (falls back to summer defaults)
    const pal = (typeof IsoSeasons !== 'undefined') ? IsoSeasons.getTreePalette() : null;
    const trunk = pal ? pal.trunk : '#8B6B3E';
    const c0 = pal ? pal.canopy[0] : '#3A8A2A';
    const c1 = pal ? pal.canopy[1] : '#4EAA3A';
    const c2 = pal ? pal.canopy[2] : '#5CBC48';

    // Winter: smaller canopy (sparse leaves)
    const season = (typeof IsoWeather !== 'undefined') ? IsoWeather.getSeason() : 'summer';
    const canopyScale = season === 'winter' ? 0.75 : 1.0;

    // Shadow on ground
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.ellipse(sx + 2, sy + 5, 11, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    // Trunk
    ctx.fillStyle = trunk;
    ctx.fillRect(sx - 3, sy - 10, 6, 16);
    // Canopy layers (darker below, lighter above)
    ctx.fillStyle = c0;
    ctx.beginPath();
    ctx.ellipse(sx + sway, sy - 14, 14 * canopyScale, 11 * canopyScale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = c1;
    ctx.beginPath();
    ctx.ellipse(sx + sway, sy - 16, 11 * canopyScale, 8 * canopyScale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = c2;
    ctx.beginPath();
    ctx.ellipse(sx + sway + 1, sy - 18, 7 * canopyScale, 5 * canopyScale, 0, 0, Math.PI * 2);
    ctx.fill();

    // Seasonal accent (blossom spots in spring, red leaves in autumn, snow in winter)
    if (pal && pal.accent && pal.accentChance > 0) {
      // Use deterministic seed from position so accents are stable per tree
      const seed = Math.abs(sx * 31 + sy * 17) % 100;
      if (seed < pal.accentChance * 100) {
        ctx.fillStyle = pal.accent;
        // 3-4 small accent dots on the canopy
        for (let i = 0; i < 4; i++) {
          const ax = sx + sway + Math.sin(seed + i * 2.1) * 8 * canopyScale;
          const ay = sy - 15 + Math.cos(seed + i * 3.3) * 6 * canopyScale;
          const ar = 1.5 + (i % 2);
          ctx.beginPath();
          ctx.arc(ax, ay, ar, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  // Character (top-down chibi — big head, small body)
  function drawIsoCharacter(ctx, sx, sy, dir, frame, hoodieColor, tick) {
    const bob = Math.sin(tick * 0.15 + frame) * 1.2;
    const bodyY = sy - 14 + bob;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(sx, sy + 3, 8, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body/hoodie
    ctx.fillStyle = hoodieColor;
    const bodyW = 14, bodyH = 11;
    ctx.fillRect(sx - bodyW / 2, bodyY, bodyW, bodyH);

    // Walking animation — leg movement
    if (frame % 2 === 1) {
      ctx.fillStyle = '#5B7DAF';
      if (dir === 'down' || dir === 'up') {
        ctx.fillRect(sx - 4, bodyY + bodyH, 4, 4);
        ctx.fillRect(sx + 1, bodyY + bodyH - 1, 4, 4);
      } else {
        ctx.fillRect(sx - 3, bodyY + bodyH, 4, 4);
        ctx.fillRect(sx, bodyY + bodyH - 1, 4, 3);
      }
    } else {
      ctx.fillStyle = '#5B7DAF';
      ctx.fillRect(sx - 4, bodyY + bodyH, 4, 3);
      ctx.fillRect(sx + 1, bodyY + bodyH, 4, 3);
    }

    // Head (big chibi head)
    const headW = 16, headH = 14;
    ctx.fillStyle = '#FFD5B8';
    ctx.fillRect(sx - headW / 2, bodyY - headH + 3, headW, headH);

    // Hair (covers top of head)
    ctx.fillStyle = '#4A3728';
    ctx.fillRect(sx - headW / 2, bodyY - headH + 3, headW, 5);
    // Hair sides
    if (dir !== 'up') {
      ctx.fillRect(sx - headW / 2, bodyY - headH + 7, 3, 4);
      ctx.fillRect(sx + headW / 2 - 3, bodyY - headH + 7, 3, 4);
    }

    // Hat/cap (like the reference farmer)
    ctx.fillStyle = '#4A80C8';
    ctx.fillRect(sx - 9, bodyY - headH + 1, 18, 4);
    ctx.fillRect(sx - 8, bodyY - headH - 1, 16, 3);

    // Face details (direction-dependent)
    const faceY = bodyY - headH + 8;
    if (dir === 'down') {
      // Eyes
      ctx.fillStyle = '#2C2C2C';
      ctx.fillRect(sx - 4, faceY, 2, 3);
      ctx.fillRect(sx + 3, faceY, 2, 3);
      // Mouth
      ctx.fillStyle = '#C85A32';
      ctx.fillRect(sx - 1, faceY + 4, 3, 1);
      // Blush
      ctx.fillStyle = 'rgba(240,160,160,0.4)';
      ctx.fillRect(sx - 6, faceY + 1, 3, 3);
      ctx.fillRect(sx + 5, faceY + 1, 3, 3);
    } else if (dir === 'left') {
      ctx.fillStyle = '#2C2C2C';
      ctx.fillRect(sx - 4, faceY, 2, 3);
      ctx.fillStyle = '#C85A32';
      ctx.fillRect(sx - 3, faceY + 4, 3, 1);
    } else if (dir === 'right') {
      ctx.fillStyle = '#2C2C2C';
      ctx.fillRect(sx + 3, faceY, 2, 3);
      ctx.fillStyle = '#C85A32';
      ctx.fillRect(sx + 1, faceY + 4, 3, 1);
    }
    // 'up' direction: back of head, no face
  }

  // Crop rendering — type-specific, 2 plants per tile for dense row look
  function drawIsoCrop(ctx, sx, sy, stage, cropType, tick) {
    if (stage === 0) return;

    // Per-tile random offset to break grid feel (seeded by position)
    const seed = (sx * 7 + sy * 13) & 0xFFFF;
    const offX = ((seed % 5) - 2);        // -2 to +2 px
    const offY = (((seed >> 3) % 5) - 2); // -2 to +2 px
    sx += offX;
    sy += offY;

    // Stage 1: Universal seedling (2 small sprouts per tile)
    if (stage === 1) {
      for (let i = -1; i <= 1; i += 2) {
        const px = sx + i * 7;
        ctx.fillStyle = '#6B5030';
        ctx.beginPath();
        ctx.ellipse(px, sy + 4, 4, 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#5AAE45';
        ctx.fillRect(px - 1, sy, 2, 5);
        ctx.fillRect(px - 2, sy - 1, 1, 2);
        ctx.fillRect(px + 1, sy - 1, 1, 2);
      }
      return;
    }

    // Stage 2: Sprout with slight type variation
    if (stage === 2) {
      const tall = cropType === 'corn' || cropType === 'sunflower';
      for (let i = -1; i <= 1; i += 2) {
        const px = sx + i * 7;
        const h = tall ? 13 : 9;
        ctx.fillStyle = '#4A8A38';
        ctx.fillRect(px, sy - h, 2, h + 3);
        ctx.fillStyle = '#5AAE45';
        ctx.fillRect(px - 4, sy - h + 2, 4, 3);
        ctx.fillRect(px + 2, sy - h + 1, 4, 3);
        ctx.fillStyle = '#6AC050';
        ctx.fillRect(px - 3, sy - h, 3, 2);
        ctx.fillRect(px + 2, sy - h - 1, 3, 2);
      }
      return;
    }

    // Stage 3-4: Type-specific rendering
    const mature = stage >= 4;
    const glow = mature && ((tick / 40) | 0) % 2;

    switch (cropType) {
      case 'carrot': _drawCarrot(ctx, sx, sy, mature, glow, tick); break;
      case 'tomato': _drawTomato(ctx, sx, sy, mature, glow, tick); break;
      case 'corn': _drawCorn(ctx, sx, sy, mature, glow, tick); break;
      case 'sunflower': _drawSunflower(ctx, sx, sy, mature, glow, tick); break;
      case 'watermelon': _drawWatermelon(ctx, sx, sy, mature, glow, tick); break;
      case 'pumpkin': _drawPumpkin(ctx, sx, sy, mature, glow, tick); break;
      default: _drawGenericCrop(ctx, sx, sy, mature, glow, tick); break;
    }

    // Extra leaf overlay for mature crops — adds lushness
    if (mature) {
      const leafSway = Math.sin(tick * 0.025 + seed * 0.01) * 0.5;
      ctx.fillStyle = 'rgba(106, 192, 80, 0.35)';
      ctx.fillRect(sx - 10 + leafSway, sy - 20, 4, 3);
      ctx.fillRect(sx + 6 + leafSway, sy - 18, 4, 3);
      ctx.fillRect(sx - 7 + leafSway, sy - 14, 3, 2);
      ctx.fillRect(sx + 8 + leafSway, sy - 22, 3, 2);
    }

    // Harvest sparkle for mature crops
    if (glow) {
      ctx.fillStyle = '#FFD700';
      ctx.fillRect(sx - 11, sy - 22, 2, 2);
      ctx.fillRect(sx + 9, sy - 18, 2, 2);
      ctx.fillRect(sx - 3, sy - 25, 2, 2);
    }
  }

  // --- Carrot: green feathery tops, orange root peeking from soil ---
  function _drawCarrot(ctx, sx, sy, mature, glow, tick) {
    for (let i = -1; i <= 1; i += 2) {
      const px = sx + i * 7;
      const sway = Math.sin(tick * 0.04 + px * 0.1) * 0.6;
      const h = mature ? 26 : 18;
      // Feathery green leaves
      ctx.fillStyle = '#4A9A3A';
      ctx.fillRect(px - 1 + sway, sy - h, 2, h - 2);
      ctx.fillRect(px - 5 + sway, sy - h + 3, 3, 3);
      ctx.fillRect(px + 3 + sway, sy - h + 2, 3, 3);
      ctx.fillStyle = '#5BBE48';
      ctx.fillRect(px - 3 + sway, sy - h - 1, 2, h - 4);
      ctx.fillRect(px + 2 + sway, sy - h, 2, h - 5);
      ctx.fillStyle = '#6CD058';
      ctx.fillRect(px - 6 + sway, sy - h + 6, 3, 2);
      ctx.fillRect(px + 4 + sway, sy - h + 5, 3, 2);
      ctx.fillRect(px - 4 + sway, sy - h + 9, 2, 2);
      ctx.fillRect(px + 3 + sway, sy - h + 8, 2, 2);
      // Orange carrot root in soil
      ctx.fillStyle = glow ? '#FFA030' : '#FF8C00';
      ctx.fillRect(px - 2, sy - 1, 5, 6);
      ctx.fillRect(px - 1, sy + 5, 3, 3);
      ctx.fillStyle = '#E07800';
      ctx.fillRect(px, sy + 7, 1, 2);
    }
  }

  // --- Tomato: bushy green plant with round red fruits ---
  function _drawTomato(ctx, sx, sy, mature, glow, tick) {
    for (let i = -1; i <= 1; i += 2) {
      const px = sx + i * 7;
      const h = mature ? 24 : 16;
      // Green bush
      ctx.fillStyle = '#3A8A30';
      ctx.fillRect(px - 6, sy - h + 5, 12, h - 6);
      ctx.fillStyle = '#4AA840';
      ctx.fillRect(px - 5, sy - h + 3, 10, h - 8);
      ctx.fillStyle = '#5AB848';
      ctx.fillRect(px - 4, sy - h, 8, 5);
      // Stem
      ctx.fillStyle = '#3A7030';
      ctx.fillRect(px - 1, sy - 1, 2, 4);
      // Tomatoes
      const tc = glow ? '#FF6666' : '#FF4444';
      if (mature) {
        ctx.fillStyle = tc;
        ctx.beginPath(); ctx.arc(px - 3, sy - h + 10, 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(px + 4, sy - h + 12, 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(px, sy - h + 16, 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#FF8888';
        ctx.fillRect(px - 4, sy - h + 9, 1, 1);
        ctx.fillRect(px + 3, sy - h + 11, 1, 1);
      } else {
        ctx.fillStyle = '#5A9A40';
        ctx.beginPath(); ctx.arc(px - 2, sy - h + 10, 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(px + 3, sy - h + 12, 2.5, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // --- Corn: TALL stalk with spreading leaves and yellow cob ---
  function _drawCorn(ctx, sx, sy, mature, glow, tick) {
    for (let i = -1; i <= 1; i += 2) {
      const px = sx + i * 7;
      const sway = Math.sin(tick * 0.03 + i * 2 + px * 0.05) * 1;
      const h = mature ? 42 : 28;
      // Main stalk
      ctx.fillStyle = '#4A9A3A';
      ctx.fillRect(px - 1 + sway, sy - h, 3, h + 3);
      // Spreading leaves
      ctx.fillStyle = '#5AAE45';
      ctx.fillRect(px - 9 + sway, sy - h + 10, 9, 3);
      ctx.fillRect(px + 2 + sway, sy - h + 14, 9, 3);
      ctx.fillRect(px - 10 + sway, sy - h + 20, 10, 3);
      ctx.fillRect(px + 2 + sway, sy - h + 24, 10, 3);
      // Lighter leaf tips
      ctx.fillStyle = '#6AC050';
      ctx.fillRect(px - 9 + sway, sy - h + 10, 2, 2);
      ctx.fillRect(px + 9 + sway, sy - h + 14, 2, 2);
      ctx.fillRect(px - 10 + sway, sy - h + 20, 2, 2);
      ctx.fillRect(px + 10 + sway, sy - h + 24, 2, 2);
      if (mature) {
        // Corn cob
        const cc = glow ? '#FFE8A0' : '#F0E068';
        ctx.fillStyle = cc;
        ctx.fillRect(px + 1 + sway, sy - h + 12, 5, 10);
        // Husk
        ctx.fillStyle = '#B8D070';
        ctx.fillRect(px - 1 + sway, sy - h + 11, 3, 3);
        ctx.fillRect(px + 5 + sway, sy - h + 18, 2, 4);
        // Silk
        ctx.fillStyle = '#C8A040';
        ctx.fillRect(px + 2 + sway, sy - h + 10, 2, 2);
      }
    }
  }

  // --- Sunflower: tall stem with big yellow flower head ---
  function _drawSunflower(ctx, sx, sy, mature, glow, tick) {
    for (let i = -1; i <= 1; i += 2) {
      const px = sx + i * 7;
      const sway = Math.sin(tick * 0.025 + i * 3) * 1;
      const h = mature ? 38 : 26;
      // Thick stem
      ctx.fillStyle = '#4A9030';
      ctx.fillRect(px - 1 + sway, sy - h + 10, 3, h - 8);
      // Leaves along stem
      ctx.fillStyle = '#5AAE45';
      ctx.fillRect(px - 7 + sway, sy - h + 18, 6, 4);
      ctx.fillRect(px + 3 + sway, sy - h + 24, 6, 4);
      ctx.fillStyle = '#4A9838';
      ctx.fillRect(px - 6 + sway, sy - h + 14, 5, 4);
      ctx.fillRect(px + 3 + sway, sy - h + 20, 5, 4);
      if (mature) {
        // Big flower head
        ctx.fillStyle = glow ? '#FFE040' : '#FFD700';
        ctx.beginPath();
        ctx.ellipse(px + sway, sy - h + 5, 9, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        // Center (brown seeds)
        ctx.fillStyle = '#8B6B3E';
        ctx.beginPath();
        ctx.ellipse(px + sway, sy - h + 5, 5, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#6B4B2E';
        ctx.fillRect(px - 2 + sway, sy - h + 4, 1, 1);
        ctx.fillRect(px + 1 + sway, sy - h + 3, 1, 1);
        ctx.fillRect(px + sway, sy - h + 6, 1, 1);
      } else {
        // Bud
        ctx.fillStyle = '#A0C040';
        ctx.beginPath();
        ctx.ellipse(px + sway, sy - h + 8, 5, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#FFD700';
        ctx.fillRect(px - 2 + sway, sy - h + 6, 4, 2);
      }
    }
  }

  // --- Watermelon: low vine with large green striped fruit ---
  function _drawWatermelon(ctx, sx, sy, mature, glow, tick) {
    for (let i = -1; i <= 1; i += 2) {
      const px = sx + i * 7;
      // Vine
      ctx.fillStyle = '#4A8A38';
      ctx.fillRect(px - 7, sy + 1, 14, 2);
      ctx.fillRect(px - 1, sy - 3, 2, 6);
      // Leaves
      ctx.fillStyle = '#5AAE45';
      ctx.fillRect(px - 6, sy - 4, 4, 4);
      ctx.fillRect(px + 3, sy - 3, 4, 4);
      ctx.fillStyle = '#6AC050';
      ctx.fillRect(px - 5, sy - 5, 3, 2);
      if (mature) {
        // Big watermelon
        ctx.fillStyle = glow ? '#358B5F' : '#2E8B57';
        ctx.beginPath();
        ctx.ellipse(px, sy - 7, 8, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        // Dark stripes
        ctx.fillStyle = '#1A6B3A';
        ctx.fillRect(px - 4, sy - 10, 1, 7);
        ctx.fillRect(px, sy - 12, 1, 8);
        ctx.fillRect(px + 4, sy - 10, 1, 7);
        // Highlight
        ctx.fillStyle = '#48A870';
        ctx.fillRect(px - 5, sy - 10, 2, 2);
      } else {
        ctx.fillStyle = '#3A8A48';
        ctx.beginPath();
        ctx.ellipse(px, sy - 5, 4, 3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // --- Pumpkin: vine with big orange round fruit ---
  function _drawPumpkin(ctx, sx, sy, mature, glow, tick) {
    for (let i = -1; i <= 1; i += 2) {
      const px = sx + i * 7;
      // Vine
      ctx.fillStyle = '#4A8A38';
      ctx.fillRect(px - 6, sy + 2, 12, 2);
      ctx.fillRect(px - 1, sy - 2, 2, 6);
      // Leaves
      ctx.fillStyle = '#5AAE45';
      ctx.fillRect(px - 6, sy - 3, 5, 4);
      ctx.fillRect(px + 2, sy - 2, 5, 4);
      if (mature) {
        // Big pumpkin
        ctx.fillStyle = glow ? '#FF8530' : '#FF7518';
        ctx.beginPath();
        ctx.ellipse(px, sy - 6, 7, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        // Segment line
        ctx.strokeStyle = '#E06510';
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(px, sy - 12); ctx.lineTo(px, sy);
        ctx.stroke();
        // Stem
        ctx.fillStyle = '#5A8030';
        ctx.fillRect(px - 1, sy - 13, 3, 4);
        // Highlight
        ctx.fillStyle = '#FF9538';
        ctx.fillRect(px - 4, sy - 8, 2, 2);
      } else {
        ctx.fillStyle = '#8A9A40';
        ctx.beginPath();
        ctx.ellipse(px, sy - 5, 5, 4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // --- Generic fallback ---
  function _drawGenericCrop(ctx, sx, sy, mature, glow, tick) {
    for (let i = -1; i <= 1; i += 2) {
      const px = sx + i * 7;
      const h = mature ? 20 : 14;
      ctx.fillStyle = '#4E9A3C';
      ctx.fillRect(px - 5, sy - h, 10, h - 2);
      ctx.fillStyle = '#5AAE45';
      ctx.fillRect(px - 4, sy - h - 2, 8, h - 4);
      ctx.fillStyle = '#6AC050';
      ctx.fillRect(px - 3, sy - h - 3, 6, 4);
      ctx.fillStyle = '#4A8A38';
      ctx.fillRect(px - 1, sy - 1, 2, 3);
    }
  }

  // Fence post (top-down)
  function drawFencePost(ctx, sx, sy, horizontal) {
    ctx.fillStyle = '#A88040';
    if (horizontal) {
      ctx.fillRect(sx - TILE_W / 2, sy - 2, TILE_W, 4);
      // Posts
      ctx.fillStyle = '#8B6830';
      ctx.fillRect(sx - TILE_W / 2 + 2, sy - 4, 3, 8);
      ctx.fillRect(sx + TILE_W / 2 - 5, sy - 4, 3, 8);
    } else {
      ctx.fillRect(sx - 2, sy - TILE_H / 2, 4, TILE_H);
      ctx.fillStyle = '#8B6830';
      ctx.fillRect(sx - 4, sy - TILE_H / 2 + 2, 8, 3);
      ctx.fillRect(sx - 4, sy + TILE_H / 2 - 5, 8, 3);
    }
  }

  // Animal (top-down chibi style — scaled for 32px tiles)
  function drawAnimal(ctx, sx, sy, type, frame, tick) {
    const bob = frame % 2 === 0 ? 0 : -1;
    const ay = sy + bob;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.ellipse(sx, sy + 4, 7, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();

    const colors = {
      chicken: { body: '#FFFDE0', head: '#FFFDE0', comb: '#E83030', beak: '#F0A030' },
      cow:     { body: '#F0F0F0', head: '#F0F0F0', spot: '#4A3020', nose: '#FFB8A0' },
      pig:     { body: '#FFB8A8', head: '#FFB8A8', nose: '#E88878', ear: '#E89888' },
      sheep:   { body: '#F8F8F0', head: '#FFFDE8', wool: '#E8E8D8', face: '#FFD5B8' },
      cat:     { body: '#F0A050', head: '#F0A050', ear: '#E09040', stripe: '#D08030' },
      dog:     { body: '#D8A060', head: '#D8A060', ear: '#C09050', nose: '#3C3C3C' },
    };
    const c = colors[type] || colors.chicken;

    switch (type) {
      case 'chicken':
        ctx.fillStyle = c.body;
        ctx.fillRect(sx - 5, ay - 5, 10, 9);
        ctx.fillStyle = c.comb;
        ctx.fillRect(sx - 1, ay - 8, 4, 3);
        ctx.fillStyle = c.beak;
        ctx.fillRect(sx - 1, ay - 2, 4, 3);
        ctx.fillStyle = '#2C2C2C';
        ctx.fillRect(sx - 3, ay - 4, 2, 2);
        ctx.fillRect(sx + 2, ay - 4, 2, 2);
        break;
      case 'cow':
        ctx.fillStyle = c.body;
        ctx.fillRect(sx - 8, ay - 7, 16, 12);
        ctx.fillStyle = c.spot;
        ctx.fillRect(sx - 4, ay - 4, 5, 4);
        ctx.fillRect(sx + 3, ay - 1, 4, 4);
        ctx.fillStyle = c.nose;
        ctx.fillRect(sx - 3, ay + 3, 6, 3);
        ctx.fillStyle = '#2C2C2C';
        ctx.fillRect(sx - 4, ay - 3, 2, 2);
        ctx.fillRect(sx + 3, ay - 3, 2, 2);
        break;
      case 'pig':
        ctx.fillStyle = c.body;
        ctx.fillRect(sx - 7, ay - 5, 14, 10);
        ctx.fillStyle = c.nose;
        ctx.fillRect(sx - 3, ay, 6, 4);
        ctx.fillStyle = '#2C2C2C';
        ctx.fillRect(sx - 1, ay + 1, 1, 1);
        ctx.fillRect(sx + 1, ay + 1, 1, 1);
        ctx.fillStyle = '#2C2C2C';
        ctx.fillRect(sx - 3, ay - 3, 2, 2);
        ctx.fillRect(sx + 2, ay - 3, 2, 2);
        break;
      case 'sheep':
        ctx.fillStyle = c.wool;
        ctx.beginPath();
        ctx.ellipse(sx, ay - 1, 10, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = c.face;
        ctx.fillRect(sx - 4, ay - 5, 8, 7);
        ctx.fillStyle = '#2C2C2C';
        ctx.fillRect(sx - 3, ay - 4, 2, 2);
        ctx.fillRect(sx + 2, ay - 4, 2, 2);
        break;
      case 'cat':
        ctx.fillStyle = c.body;
        ctx.fillRect(sx - 5, ay - 4, 10, 8);
        ctx.fillStyle = c.ear;
        ctx.fillRect(sx - 5, ay - 8, 4, 4);
        ctx.fillRect(sx + 2, ay - 8, 4, 4);
        ctx.fillStyle = '#2C2C2C';
        ctx.fillRect(sx - 3, ay - 3, 2, 2);
        ctx.fillRect(sx + 2, ay - 3, 2, 2);
        ctx.fillStyle = c.stripe;
        ctx.fillRect(sx - 4, ay - 1, 8, 1);
        ctx.fillRect(sx - 3, ay + 1, 6, 1);
        break;
      case 'dog':
        ctx.fillStyle = c.body;
        ctx.fillRect(sx - 7, ay - 5, 14, 9);
        ctx.fillStyle = c.ear;
        ctx.fillRect(sx - 7, ay - 8, 4, 5);
        ctx.fillRect(sx + 4, ay - 8, 4, 5);
        ctx.fillStyle = c.nose;
        ctx.fillRect(sx - 1, ay, 3, 3);
        ctx.fillStyle = '#2C2C2C';
        ctx.fillRect(sx - 3, ay - 3, 2, 2);
        ctx.fillRect(sx + 2, ay - 3, 2, 2);
        // Tail wag
        if (frame % 2 === 0) {
          ctx.fillStyle = c.body;
          ctx.fillRect(sx + 7, ay - 4, 3, 4);
        } else {
          ctx.fillStyle = c.body;
          ctx.fillRect(sx + 7, ay - 6, 3, 4);
        }
        break;
    }
  }

  // ===== Particle System (harvest effects) =====

  const particles = [];
  const MAX_PARTICLES = 200;

  function spawnHarvestParticles(col, row, color, count) {
    const { x, y } = gridToScreen(col, row);
    const cx = x + TILE_W / 2;
    const cy = y + TILE_H / 2;
    const n = Math.min(count || 12, MAX_PARTICLES - particles.length);
    for (let i = 0; i < n; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.5 + Math.random() * 2;
      const size = 2 + Math.random() * 3;
      particles.push({
        x: cx + (Math.random() - 0.5) * 10,
        y: cy - Math.random() * 8,
        vx: Math.cos(angle) * speed,
        vy: -1.5 - Math.random() * 2.5,
        size,
        color,
        alpha: 1,
        life: 40 + Math.random() * 30,
        age: 0,
        type: Math.random() < 0.3 ? 'star' : 'square',
      });
    }
  }

  function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age++;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.04; // gravity
      p.vx *= 0.98; // friction
      p.alpha = Math.max(0, 1 - p.age / p.life);
      if (p.age >= p.life) {
        particles.splice(i, 1);
      }
    }
  }

  function drawParticles(ctx) {
    for (const p of particles) {
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      if (p.type === 'star') {
        // Small star shape
        const s = p.size * 0.7;
        ctx.fillRect(p.x - s / 2, p.y - s, s, s * 2);
        ctx.fillRect(p.x - s, p.y - s / 2, s * 2, s);
      } else {
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
    ctx.globalAlpha = 1;
  }

  // Draw mature crop golden aura (call after crop entity rendering)
  function drawMatureGlow(ctx, sx, sy, tick, color) {
    const pulse = 0.15 + Math.sin(tick * 0.08) * 0.1;
    const radius = 14 + Math.sin(tick * 0.06) * 3;

    // Soft golden glow
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.ellipse(sx, sy - 8, radius, radius * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Tiny sparkle dots orbiting
    const sparkleCount = 3;
    for (let i = 0; i < sparkleCount; i++) {
      const angle = tick * 0.04 + i * (Math.PI * 2 / sparkleCount);
      const sparkleR = radius + 2;
      const spx = sx + Math.cos(angle) * sparkleR;
      const spy = sy - 8 + Math.sin(angle) * sparkleR * 0.6;
      const sparkleAlpha = 0.4 + Math.sin(tick * 0.15 + i * 2) * 0.3;
      ctx.fillStyle = `rgba(255, 215, 0, ${sparkleAlpha})`;
      ctx.fillRect(Math.round(spx) - 1, Math.round(spy) - 1, 2, 2);
    }
  }

  return {
    TILE_W, TILE_H,
    TILE_TYPES, TILE_GROUPS,
    gridToScreen, screenToGrid, mouseToGrid,
    depthKey,
    getTileBitmask,
    initMap, setTile, getTile,
    setPlayer, setPet, addEntity, clearEntities,
    drawTile, drawTileTransitions, drawTileHighlight,
    drawMap,
    setCamera, moveCamera, centerOnTile, clampCamera,
    zoom, getZoom, setZoom, getCameraState,
    smoothFollow, getMapSize,
    saveViewportState, restoreViewportState, hasSavedViewport,
    adjustBrightness,
    drawIsoTree, drawIsoCharacter, drawIsoCrop,
    drawAnimal, drawFencePost,
    drawShadow, entityShadowRadius,
    setHoverTile, getHoverTile,
    spawnHarvestParticles, updateParticles, drawParticles,
    drawMatureGlow,
    getHomeOffset,
  };
})();
