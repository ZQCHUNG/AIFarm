/**
 * minimap.js — Circular Minimap for AIFarm 3.0 (Sprint 17 P2).
 *
 * Shows a bird's-eye view of the farm in a circular HUD widget.
 * Displays player position, buildings, chunk boundaries, and fog of war.
 * Uses an offscreen canvas that refreshes every ~30 frames for performance.
 */
const Minimap = (() => {
  const RADIUS = 32;         // Minimap radius in pixels
  const DIAMETER = RADIUS * 2;
  const TILE_PX = 2;         // Pixels per tile on minimap
  const REFRESH_INTERVAL = 30; // Frames between full redraws

  // Offscreen canvas for the minimap base layer
  let offCanvas = null;
  let offCtx = null;
  let lastRefreshTick = 0;
  let visible = true;

  // Tile colors for minimap
  const TILE_COLORS = {
    grass:     '#5AAE45',
    darkgrass: '#4E9E38',
    dirt:      '#8B6B3E',
    soil:      '#7A5C32',
    soilwet:   '#6A4C22',
    path:      '#C8B898',
    stone:     '#A0A0A0',
    sand:      '#E8D8A0',
    water:     '#4A90D9',
    fence:     '#6B4226',
  };

  // Building marker colors
  const BUILDING_COLORS = {
    well:     '#4A90D9',
    barn:     '#D05050',
    mill:     '#B0A090',
    windmill: '#E8D8C0',
    workshop: '#A07840',
    market:   '#FFD700',
    clock:    '#D0C0A0',
    townhall: '#D8C8B8',
    statue:   '#C0C0C0',
  };

  function ensureCanvas() {
    if (offCanvas) return;
    offCanvas = document.createElement('canvas');
    offCanvas.width = DIAMETER;
    offCanvas.height = DIAMETER;
    offCtx = offCanvas.getContext('2d');
  }

  function toggle() { visible = !visible; }
  function isVisible() { return visible; }

  /** Refresh the offscreen minimap base layer. */
  function refresh() {
    ensureCanvas();
    offCtx.clearRect(0, 0, DIAMETER, DIAMETER);

    // Get player position as center reference
    const playerTile = (typeof Player !== 'undefined') ? Player.getTile() : { col: 10, row: 9 };
    const viewRadius = Math.floor(RADIUS / TILE_PX); // tiles visible from center

    // Draw tiles centered on player
    for (let dy = -viewRadius; dy <= viewRadius; dy++) {
      for (let dx = -viewRadius; dx <= viewRadius; dx++) {
        const col = playerTile.col + dx;
        const row = playerTile.row + dy;

        // Circular clip check
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > viewRadius) continue;

        const sx = RADIUS + dx * TILE_PX;
        const sy = RADIUS + dy * TILE_PX;

        // Check fog of war
        if (typeof ChunkManager !== 'undefined' && ChunkManager.isFog(col, row)) {
          offCtx.fillStyle = 'rgba(30, 30, 50, 0.8)';
          offCtx.fillRect(sx, sy, TILE_PX, TILE_PX);
          continue;
        }

        // Get tile type
        let tileType = null;
        if (typeof IsoEngine !== 'undefined') {
          tileType = IsoEngine.getTile(col, row);
        }
        if (typeof ChunkManager !== 'undefined' && !tileType) {
          tileType = ChunkManager.getTile(col, row);
        }

        if (tileType) {
          offCtx.fillStyle = TILE_COLORS[tileType] || '#5AAE45';
          offCtx.fillRect(sx, sy, TILE_PX, TILE_PX);
        } else {
          // Unloaded area
          offCtx.fillStyle = '#2A3A20';
          offCtx.fillRect(sx, sy, TILE_PX, TILE_PX);
        }
      }
    }

    // Draw buildings as colored markers
    const farmState = (typeof Farm !== 'undefined') ? Farm.getState() : null;
    if (farmState && farmState.buildings && typeof IsoFarm !== 'undefined') {
      for (const [bldId, isBuilt] of Object.entries(farmState.buildings)) {
        if (!isBuilt) continue;
        const pos = IsoFarm.BUILDING_POSITIONS[bldId];
        if (!pos) continue;

        const dx = pos.col - playerTile.col;
        const dy = pos.row - playerTile.row;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > viewRadius) continue;

        const sx = RADIUS + dx * TILE_PX;
        const sy = RADIUS + dy * TILE_PX;

        offCtx.fillStyle = BUILDING_COLORS[bldId] || '#FFF';
        offCtx.fillRect(sx - 1, sy - 1, TILE_PX + 2, TILE_PX + 2);
      }
    }

    // Draw chunk boundaries (faint grid lines)
    if (typeof ChunkManager !== 'undefined') {
      offCtx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      offCtx.lineWidth = 0.5;
      const chunkSize = ChunkManager.CHUNK_SIZE;

      for (let dy = -viewRadius; dy <= viewRadius; dy++) {
        for (let dx = -viewRadius; dx <= viewRadius; dx++) {
          const col = playerTile.col + dx;
          const row = playerTile.row + dy;
          // Draw lines at chunk boundaries
          if (col % chunkSize === 0) {
            const sx = RADIUS + dx * TILE_PX;
            const sy = RADIUS + dy * TILE_PX;
            offCtx.fillStyle = 'rgba(255, 255, 255, 0.1)';
            offCtx.fillRect(sx, sy, 1, TILE_PX);
          }
          if (row % chunkSize === 0) {
            const sx = RADIUS + dx * TILE_PX;
            const sy = RADIUS + dy * TILE_PX;
            offCtx.fillStyle = 'rgba(255, 255, 255, 0.1)';
            offCtx.fillRect(sx, sy, TILE_PX, 1);
          }
        }
      }
    }
  }

  /**
   * Draw the minimap on the main canvas.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} canvasW
   * @param {number} canvasH
   * @param {number} tick
   */
  function draw(ctx, canvasW, canvasH, tick) {
    if (!visible) return;

    // Refresh offscreen canvas periodically
    if (tick - lastRefreshTick >= REFRESH_INTERVAL || lastRefreshTick === 0) {
      refresh();
      lastRefreshTick = tick;
    }
    if (!offCanvas) return;

    // Position: top-right, below status panel
    const cx = canvasW - RADIUS - 10;
    const cy = 54 + RADIUS;

    // Circular clip mask
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, RADIUS, 0, Math.PI * 2);
    ctx.clip();

    // Draw offscreen minimap
    ctx.drawImage(offCanvas, cx - RADIUS, cy - RADIUS);

    // Player dot (center, blinking)
    const blink = Math.sin(tick * 0.15) * 0.3 + 0.7;
    ctx.fillStyle = `rgba(255, 215, 0, ${blink.toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Player direction indicator
    if (typeof Player !== 'undefined') {
      const dir = Player.getDirection();
      let angle = Math.PI / 2; // default: down
      if (dir === 'up') angle = -Math.PI / 2;
      else if (dir === 'left') angle = Math.PI;
      else if (dir === 'right') angle = 0;

      ctx.fillStyle = '#FFD700';
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * 4, cy + Math.sin(angle) * 4);
      ctx.lineTo(cx + Math.cos(angle + 2.5) * 2, cy + Math.sin(angle + 2.5) * 2);
      ctx.lineTo(cx + Math.cos(angle - 2.5) * 2, cy + Math.sin(angle - 2.5) * 2);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();

    // Circular border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, RADIUS, 0, Math.PI * 2);
    ctx.stroke();

    // Outer dark ring
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, RADIUS + 1.5, 0, Math.PI * 2);
    ctx.stroke();

    // "MAP" label below
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = '6px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('MAP', cx, cy + RADIUS + 3);
  }

  return {
    draw,
    toggle,
    isVisible,
    RADIUS,
  };
})();

if (typeof module !== 'undefined') module.exports = Minimap;
