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

  // ===== Sprite Sheet Config =====
  // Defines expected sprite sheets and their frame layouts.
  // Used by iso-farm.js and iso-entity-manager.js to register sprites after generation.

  const SPRITE_CONFIG = {
    // Characters: 8 hoodie colors × 4 directions × 3 frames
    // Sheet layout: 3 cols (frames) × 4 rows (down/left/right/up)
    characters: [
      { id: 'char_blue',   src: 'sprites/char_blue_sheet.png',   frameWidth: 48, frameHeight: 48, directions: 4, framesPerDir: 3, offsetY: -8 },
      { id: 'char_red',    src: 'sprites/char_red_sheet.png',    frameWidth: 48, frameHeight: 48, directions: 4, framesPerDir: 3, offsetY: -8 },
      { id: 'char_green',  src: 'sprites/char_green_sheet.png',  frameWidth: 48, frameHeight: 48, directions: 4, framesPerDir: 3, offsetY: -8 },
      { id: 'char_purple', src: 'sprites/char_purple_sheet.png', frameWidth: 48, frameHeight: 48, directions: 4, framesPerDir: 3, offsetY: -8 },
      { id: 'char_orange', src: 'sprites/char_orange_sheet.png', frameWidth: 48, frameHeight: 48, directions: 4, framesPerDir: 3, offsetY: -8 },
      { id: 'char_teal',   src: 'sprites/char_teal_sheet.png',   frameWidth: 48, frameHeight: 48, directions: 4, framesPerDir: 3, offsetY: -8 },
      { id: 'char_pink',   src: 'sprites/char_pink_sheet.png',   frameWidth: 48, frameHeight: 48, directions: 4, framesPerDir: 3, offsetY: -8 },
      { id: 'char_yellow', src: 'sprites/char_yellow_sheet.png', frameWidth: 48, frameHeight: 48, directions: 4, framesPerDir: 3, offsetY: -8 },
    ],
    // Animals: 6 types × 4 directions × 2 frames
    // Sheet layout: 2 cols (frames) × 4 rows (down/left/right/up)
    animals: [
      { id: 'animal_chicken', src: 'sprites/animal_chicken_sheet.png', frameWidth: 32, frameHeight: 32, directions: 4, framesPerDir: 2, offsetY: -4 },
      { id: 'animal_cow',     src: 'sprites/animal_cow_sheet.png',     frameWidth: 32, frameHeight: 32, directions: 4, framesPerDir: 2, offsetY: -4 },
      { id: 'animal_pig',     src: 'sprites/animal_pig_sheet.png',     frameWidth: 32, frameHeight: 32, directions: 4, framesPerDir: 2, offsetY: -4 },
      { id: 'animal_sheep',   src: 'sprites/animal_sheep_sheet.png',   frameWidth: 32, frameHeight: 32, directions: 4, framesPerDir: 2, offsetY: -4 },
      { id: 'animal_cat',     src: 'sprites/animal_cat_sheet.png',     frameWidth: 32, frameHeight: 32, directions: 4, framesPerDir: 2, offsetY: -4 },
      { id: 'animal_dog',     src: 'sprites/animal_dog_sheet.png',     frameWidth: 32, frameHeight: 32, directions: 4, framesPerDir: 2, offsetY: -4 },
    ],
    // Crops: 6 types × 4 stages (each stage is a separate file, loaded as variants)
    // Single row with 4 columns for growth stages
    crops: [
      { id: 'crop_carrot',     src: 'sprites/crop_carrot_sheet.png',     frameWidth: 32, frameHeight: 32, directions: 1, framesPerDir: 4 },
      { id: 'crop_sunflower',  src: 'sprites/crop_sunflower_sheet.png',  frameWidth: 32, frameHeight: 32, directions: 1, framesPerDir: 4 },
      { id: 'crop_watermelon', src: 'sprites/crop_watermelon_sheet.png', frameWidth: 32, frameHeight: 32, directions: 1, framesPerDir: 4 },
      { id: 'crop_tomato',     src: 'sprites/crop_tomato_sheet.png',     frameWidth: 32, frameHeight: 32, directions: 1, framesPerDir: 4 },
      { id: 'crop_corn',       src: 'sprites/crop_corn_sheet.png',       frameWidth: 32, frameHeight: 32, directions: 1, framesPerDir: 4 },
      { id: 'crop_pumpkin',    src: 'sprites/crop_pumpkin_sheet.png',    frameWidth: 32, frameHeight: 32, directions: 1, framesPerDir: 4 },
    ],
    // Buildings: 7 structures (single static sprite each)
    buildings: [
      { id: 'building_well',     src: 'sprites/building_well.png',     frameWidth: 64, frameHeight: 64, directions: 1, framesPerDir: 1 },
      { id: 'building_barn',     src: 'sprites/building_barn.png',     frameWidth: 64, frameHeight: 64, directions: 1, framesPerDir: 1 },
      { id: 'building_windmill', src: 'sprites/building_windmill.png', frameWidth: 64, frameHeight: 64, directions: 1, framesPerDir: 1 },
      { id: 'building_market',   src: 'sprites/building_market.png',   frameWidth: 64, frameHeight: 64, directions: 1, framesPerDir: 1 },
      { id: 'building_clock',    src: 'sprites/building_clock.png',    frameWidth: 64, frameHeight: 64, directions: 1, framesPerDir: 1 },
      { id: 'building_townhall', src: 'sprites/building_townhall.png', frameWidth: 64, frameHeight: 64, directions: 1, framesPerDir: 1 },
      { id: 'building_statue',   src: 'sprites/building_statue.png',   frameWidth: 64, frameHeight: 64, directions: 1, framesPerDir: 1 },
    ],
    // Tiles: 8 terrain types (isometric diamond, 32×16 each)
    tiles: [
      { id: 'tile_grass',   src: 'sprites/tile_grass.png',   frameWidth: 32, frameHeight: 16, directions: 1, framesPerDir: 1 },
      { id: 'tile_dirt',    src: 'sprites/tile_dirt.png',    frameWidth: 32, frameHeight: 16, directions: 1, framesPerDir: 1 },
      { id: 'tile_soil',    src: 'sprites/tile_soil.png',    frameWidth: 32, frameHeight: 16, directions: 1, framesPerDir: 1 },
      { id: 'tile_water',   src: 'sprites/tile_water.png',   frameWidth: 32, frameHeight: 16, directions: 1, framesPerDir: 1 },
      { id: 'tile_stone',   src: 'sprites/tile_stone.png',   frameWidth: 32, frameHeight: 16, directions: 1, framesPerDir: 1 },
      { id: 'tile_sand',    src: 'sprites/tile_sand.png',    frameWidth: 32, frameHeight: 16, directions: 1, framesPerDir: 1 },
      { id: 'tile_path',    src: 'sprites/tile_path.png',    frameWidth: 32, frameHeight: 16, directions: 1, framesPerDir: 1 },
      { id: 'tile_flowers', src: 'sprites/tile_flowers.png', frameWidth: 32, frameHeight: 16, directions: 1, framesPerDir: 1 },
    ],
  };

  /**
   * Load all available sprites from config.
   * Silently skips missing files (procedural fallback remains active).
   * @param {string} basePath - Base path to sprite directory
   * @returns {Promise<{loaded: string[], failed: string[]}>}
   */
  async function loadAllFromConfig(basePath) {
    const loaded = [];
    const failed = [];
    const allSprites = [
      ...SPRITE_CONFIG.characters,
      ...SPRITE_CONFIG.animals,
      ...SPRITE_CONFIG.crops,
      ...SPRITE_CONFIG.buildings,
      ...SPRITE_CONFIG.tiles,
    ];
    const results = await Promise.allSettled(
      allSprites.map(s => register(s.id, { ...s, src: `${basePath}/${s.src}` }))
    );
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') loaded.push(allSprites[i].id);
      else failed.push(allSprites[i].id);
    });
    return { loaded, failed };
  }

  return {
    DIR_INDEX,
    SPRITE_CONFIG,
    register,
    registerAll,
    loadAllFromConfig,
    draw,
    drawStatic,
    has,
    getInfo,
    allLoaded,
    shouldUseSpriteFor,
  };
})();
