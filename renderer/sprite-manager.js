// Sprite Manager — loads and manages isometric sprite sheets.
// Handles direction/frame-based clipping for characters, animals, buildings, and crops.
// Designed for pre-rendered sprites generated via FLUX.1 on Colab.
const SpriteManager = (() => {
  // ===== Sprite sheet registry =====
  // Each registered sprite has: image, frameWidth, frameHeight, directions, framesPerDir
  const registry = new Map();

  // Image loading cache
  const imageCache = new Map();

  // ===== Direction mapping =====
  // Standard 4-direction layout in sprite sheets (rows top-to-bottom)
  const DIR_INDEX = {
    down: 0,   // facing camera (south-east in iso)
    left: 1,   // facing left (south-west in iso)
    right: 2,  // facing right (north-east in iso)
    up: 3,     // facing away (north-west in iso)
  };

  // ===== Loading =====

  /**
   * Register a sprite sheet from a URL or path.
   * @param {string} id - Unique sprite ID (e.g., 'character-blue', 'chicken', 'barn')
   * @param {object} config
   * @param {string} config.src - Image URL/path
   * @param {number} config.frameWidth - Width of a single frame in pixels
   * @param {number} config.frameHeight - Height of a single frame in pixels
   * @param {number} config.directions - Number of direction rows (1 for static, 4 for character)
   * @param {number} config.framesPerDir - Number of animation frames per direction
   * @param {number} [config.offsetX=0] - Drawing offset X (for centering)
   * @param {number} [config.offsetY=0] - Drawing offset Y (for anchoring feet to tile)
   * @returns {Promise} - Resolves when the image is loaded
   */
  function register(id, config) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        registry.set(id, {
          image: img,
          frameWidth: config.frameWidth,
          frameHeight: config.frameHeight,
          directions: config.directions || 1,
          framesPerDir: config.framesPerDir || 1,
          offsetX: config.offsetX || 0,
          offsetY: config.offsetY || 0,
        });
        imageCache.set(config.src, img);
        resolve();
      };
      img.onerror = () => {
        console.warn(`[SpriteManager] Failed to load: ${config.src}`);
        reject(new Error(`Failed to load sprite: ${config.src}`));
      };
      // Check cache first
      if (imageCache.has(config.src)) {
        img.src = ''; // cancel
        const cached = imageCache.get(config.src);
        registry.set(id, {
          image: cached,
          frameWidth: config.frameWidth,
          frameHeight: config.frameHeight,
          directions: config.directions || 1,
          framesPerDir: config.framesPerDir || 1,
          offsetX: config.offsetX || 0,
          offsetY: config.offsetY || 0,
        });
        resolve();
        return;
      }
      img.src = config.src;
    });
  }

  /**
   * Register multiple sprites at once.
   * @param {Array<{id: string, config: object}>} sprites
   * @returns {Promise}
   */
  function registerAll(sprites) {
    return Promise.allSettled(sprites.map(s => register(s.id, s.config)));
  }

  // ===== Drawing =====

  /**
   * Draw a sprite frame at screen position.
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} id - Registered sprite ID
   * @param {number} screenX - Screen X (center of tile)
   * @param {number} screenY - Screen Y (center of tile)
   * @param {string} [direction='down'] - 'up', 'down', 'left', 'right'
   * @param {number} [frame=0] - Animation frame index
   */
  function draw(ctx, id, screenX, screenY, direction, frame) {
    const sprite = registry.get(id);
    if (!sprite) return false;

    const dir = direction || 'down';
    const f = frame || 0;

    const dirIdx = DIR_INDEX[dir] || 0;
    const clampedDir = Math.min(dirIdx, sprite.directions - 1);
    const clampedFrame = f % sprite.framesPerDir;

    // Source rectangle in sprite sheet
    const sx = clampedFrame * sprite.frameWidth;
    const sy = clampedDir * sprite.frameHeight;

    // Destination: centered on screenX, anchored at bottom-center to screenY
    const dx = screenX - sprite.frameWidth / 2 + sprite.offsetX;
    const dy = screenY - sprite.frameHeight + sprite.offsetY;

    ctx.drawImage(
      sprite.image,
      sx, sy, sprite.frameWidth, sprite.frameHeight,
      dx, dy, sprite.frameWidth, sprite.frameHeight,
    );
    return true;
  }

  /**
   * Draw a static sprite (single frame, no direction — for buildings/crops).
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} id - Registered sprite ID
   * @param {number} screenX - Screen X
   * @param {number} screenY - Screen Y
   * @param {number} [variant=0] - Variant/stage index (used as frame column)
   */
  function drawStatic(ctx, id, screenX, screenY, variant) {
    const sprite = registry.get(id);
    if (!sprite) return false;

    const v = variant || 0;
    const sx = v * sprite.frameWidth;
    const sy = 0;

    const dx = screenX - sprite.frameWidth / 2 + sprite.offsetX;
    const dy = screenY - sprite.frameHeight + sprite.offsetY;

    ctx.drawImage(
      sprite.image,
      sx, sy, sprite.frameWidth, sprite.frameHeight,
      dx, dy, sprite.frameWidth, sprite.frameHeight,
    );
    return true;
  }

  // ===== Queries =====

  function has(id) {
    return registry.has(id);
  }

  function getInfo(id) {
    return registry.get(id) || null;
  }

  /**
   * Check if all required sprites are loaded.
   * @param {string[]} ids
   * @returns {boolean}
   */
  function allLoaded(ids) {
    return ids.every(id => registry.has(id));
  }

  // ===== Fallback rendering =====
  // When sprites aren't loaded yet, the iso-engine can use its procedural fallbacks.
  // This flag lets the renderer know whether to use sprites or fallback code.

  function shouldUseSpriteFor(id) {
    return registry.has(id);
  }

  return {
    DIR_INDEX,
    register,
    registerAll,
    draw,
    drawStatic,
    has,
    getInfo,
    allLoaded,
    shouldUseSpriteFor,
  };
})();
