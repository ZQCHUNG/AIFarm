/**
 * asset-manager.js — Dynamic Asset Manager (Sprint 25 P1).
 *
 * Wraps SpriteManager with:
 * - External JSON manifest loading (sprites.json)
 * - Lazy loading: sprites loaded on first draw attempt
 * - Dynamic registration for UGC/remote assets
 * - Asset status tracking (pending/loading/loaded/failed)
 *
 * Usage:
 *   AssetManager.loadManifest('sprites/sprites.json');
 *   // Sprites load lazily when first drawn via SpriteManager
 *   AssetManager.request('my_custom_building');
 */
const AssetManager = (() => {
  // Asset status
  const STATUS = {
    PENDING: 'pending',     // registered but not yet requested
    LOADING: 'loading',     // currently loading
    LOADED: 'loaded',       // ready to use
    FAILED: 'failed',       // load error
  };

  // Registered asset manifests: Map<id, { config, status, retries }>
  const assets = new Map();

  // Base path for relative sprite URLs
  let basePath = '.';

  // Load queue for lazy loading (FIFO)
  const loadQueue = [];
  let loading = 0;
  const MAX_CONCURRENT = 4;

  // ===== Manifest loading =====

  /**
   * Load a JSON manifest file defining available sprites.
   * Manifest format:
   * {
   *   "basePath": "sprites/",
   *   "assets": [
   *     { "id": "char_blue", "src": "char_blue_sheet.png", "frameWidth": 48, ... },
   *     ...
   *   ]
   * }
   */
  async function loadManifest(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const manifest = await res.json();

      if (manifest.basePath) {
        basePath = manifest.basePath;
      }

      const count = registerFromManifest(manifest.assets || []);
      console.log(`[AssetManager] Manifest loaded: ${count} assets registered from ${url}`);
      return count;
    } catch (err) {
      console.warn(`[AssetManager] Manifest load failed: ${url} — ${err.message}`);
      return 0;
    }
  }

  /**
   * Register assets from manifest array without loading them.
   * They will be loaded lazily on first request.
   */
  function registerFromManifest(assetList) {
    let count = 0;
    for (const item of assetList) {
      if (!item.id || !item.src) continue;
      if (assets.has(item.id)) continue; // skip duplicates

      assets.set(item.id, {
        config: {
          src: item.src.startsWith('http') ? item.src : `${basePath}/${item.src}`,
          frameWidth: item.frameWidth || 32,
          frameHeight: item.frameHeight || 32,
          directions: item.directions || 1,
          framesPerDir: item.framesPerDir || 1,
          offsetX: item.offsetX || 0,
          offsetY: item.offsetY || 0,
        },
        status: STATUS.PENDING,
        retries: 0,
      });
      count++;
    }
    return count;
  }

  /**
   * Register a single dynamic asset (e.g., from UGC or remote URL).
   */
  function registerDynamic(id, config) {
    if (assets.has(id)) return false;
    assets.set(id, {
      config: {
        src: config.src,
        frameWidth: config.frameWidth || 32,
        frameHeight: config.frameHeight || 32,
        directions: config.directions || 1,
        framesPerDir: config.framesPerDir || 1,
        offsetX: config.offsetX || 0,
        offsetY: config.offsetY || 0,
      },
      status: STATUS.PENDING,
      retries: 0,
    });
    return true;
  }

  // ===== Lazy loading =====

  /**
   * Request an asset to be loaded. If already loaded, returns immediately.
   * If pending, queues for loading.
   */
  function request(id) {
    const asset = assets.get(id);
    if (!asset) return false;
    if (asset.status === STATUS.LOADED || asset.status === STATUS.LOADING) return true;

    // Queue for loading
    asset.status = STATUS.LOADING;
    loadQueue.push(id);
    processQueue();
    return true;
  }

  /**
   * Process the load queue (up to MAX_CONCURRENT simultaneous loads).
   */
  function processQueue() {
    while (loading < MAX_CONCURRENT && loadQueue.length > 0) {
      const id = loadQueue.shift();
      const asset = assets.get(id);
      if (!asset || asset.status === STATUS.LOADED) continue;

      loading++;
      loadAsset(id, asset).then(() => {
        loading--;
        processQueue();
      });
    }
  }

  async function loadAsset(id, asset) {
    try {
      if (typeof SpriteManager !== 'undefined') {
        await SpriteManager.register(id, asset.config);
      }
      asset.status = STATUS.LOADED;
    } catch (err) {
      asset.retries++;
      if (asset.retries < 3) {
        asset.status = STATUS.PENDING;
        // Retry after delay — track handle for cleanup
        asset.retryTimeout = setTimeout(() => {
          asset.retryTimeout = null;
          request(id);
        }, 1000 * asset.retries);
      } else {
        asset.status = STATUS.FAILED;
        if (asset.retryTimeout) { clearTimeout(asset.retryTimeout); asset.retryTimeout = null; }
        console.warn(`[AssetManager] Failed to load ${id} after 3 retries`);
      }
    }
  }

  // ===== Auto-request on SpriteManager miss =====

  /**
   * Check if an asset exists. If it's registered but not loaded,
   * trigger lazy loading. Returns true if available now.
   */
  function ensure(id) {
    // Already in SpriteManager
    if (typeof SpriteManager !== 'undefined' && SpriteManager.has(id)) return true;

    // Registered in manifest — request lazy load
    const asset = assets.get(id);
    if (asset) {
      if (asset.status === STATUS.PENDING) {
        request(id);
      }
      return asset.status === STATUS.LOADED;
    }
    return false;
  }

  // ===== Bulk operations =====

  /**
   * Eagerly load all registered assets (not lazy).
   * Useful at startup to preload known sprites.
   */
  async function preloadAll() {
    const promises = [];
    for (const [id, asset] of assets) {
      if (asset.status === STATUS.PENDING) {
        asset.status = STATUS.LOADING;
        promises.push(loadAsset(id, asset));
      }
    }
    await Promise.allSettled(promises);
    const loaded = [...assets.values()].filter(a => a.status === STATUS.LOADED).length;
    console.log(`[AssetManager] Preload complete: ${loaded}/${assets.size} loaded`);
  }

  // ===== Integrate with SpriteManager's existing config =====

  /**
   * Import SpriteManager.SPRITE_CONFIG into the asset registry.
   * This bridges the existing hardcoded config with the new dynamic system.
   */
  function importSpriteConfig() {
    if (typeof SpriteManager === 'undefined') return 0;
    const cfg = SpriteManager.SPRITE_CONFIG;
    if (!cfg) return 0;

    const allSprites = [
      ...(cfg.characters || []),
      ...(cfg.animals || []),
      ...(cfg.crops || []),
      ...(cfg.buildings || []),
      ...(cfg.tiles || []),
    ];

    return registerFromManifest(allSprites);
  }

  // ===== Status queries =====

  function getStatus(id) {
    const asset = assets.get(id);
    return asset ? asset.status : null;
  }

  function getStats() {
    let pending = 0, loading_ = 0, loaded = 0, failed = 0;
    for (const [, a] of assets) {
      switch (a.status) {
        case STATUS.PENDING: pending++; break;
        case STATUS.LOADING: loading_++; break;
        case STATUS.LOADED: loaded++; break;
        case STATUS.FAILED: failed++; break;
      }
    }
    return { total: assets.size, pending, loading: loading_, loaded, failed };
  }

  /** Remove failed assets from registry to free memory. */
  function cleanupFailed() {
    const failed = [];
    for (const [id, asset] of assets) {
      if (asset.status === STATUS.FAILED) {
        if (asset.retryTimeout) { clearTimeout(asset.retryTimeout); asset.retryTimeout = null; }
        failed.push(id);
      }
    }
    for (const id of failed) assets.delete(id);
    return failed.length;
  }

  // ===== Init =====

  function init(config) {
    if (config && config.basePath) basePath = config.basePath;

    // Import existing SpriteManager config
    const imported = importSpriteConfig();
    if (imported > 0) {
      console.log(`[AssetManager] Imported ${imported} sprites from SpriteManager config`);
    }

    // Try loading external manifest
    const manifestUrl = (config && config.manifestUrl) || 'sprites/sprites.json';
    loadManifest(manifestUrl).catch(() => {});
  }

  // ===== Public API =====

  return {
    STATUS,
    init,
    loadManifest,
    registerDynamic,
    request,
    ensure,
    preloadAll,
    importSpriteConfig,
    getStatus,
    getStats,
    cleanupFailed,
  };
})();
