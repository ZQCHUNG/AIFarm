/**
 * ugc-importer.js — User-Generated Content asset importer (Sprint 26 P2).
 *
 * Watches renderer/assets/custom/ for new PNG sprite sheets.
 * Auto-detects sprite metadata from filename convention:
 *   {category}-{name}_{width}x{height}_{frames}f.png
 *   e.g., character-ninja_32x32_4f.png → 32x32 sprite sheet with 4 frames
 *
 * Falls back to sensible defaults if filename doesn't match the convention.
 * Notifies renderer via IPC to register sprites in AssetManager.
 */
const fs = require('fs');
const path = require('path');

class UGCImporter {
  constructor() {
    this._watcher = null;
    this._debounceTimer = null;
    this._pendingFiles = new Set();
    this._registered = new Map(); // filename → sprite config
    this._customDir = null;
    this._onSpriteAdded = null; // callback(spriteConfig)
    this._onSpriteRemoved = null; // callback(spriteId)
  }

  /**
   * Start watching the custom assets directory.
   * @param {Function} onAdded - Called with sprite config when new asset detected
   * @param {Function} onRemoved - Called with sprite id when asset removed
   */
  start(onAdded, onRemoved) {
    this._onSpriteAdded = onAdded || (() => {});
    this._onSpriteRemoved = onRemoved || (() => {});
    this._customDir = path.join(__dirname, '..', 'renderer', 'assets', 'custom');

    // Ensure directory exists
    if (!fs.existsSync(this._customDir)) {
      fs.mkdirSync(this._customDir, { recursive: true });
      console.log(`[UGC] Created custom assets directory: ${this._customDir}`);
    }

    // Scan existing files
    this._scanExisting();

    // Start watching
    try {
      this._watcher = fs.watch(this._customDir, { persistent: false }, (eventType, filename) => {
        if (!filename || !filename.endsWith('.png')) return;
        this._pendingFiles.add(filename);
        this._debounce();
      });
      console.log(`[UGC] Watching ${this._customDir} for custom sprites`);
    } catch (err) {
      console.warn('[UGC] Failed to start watcher:', err.message);
    }
  }

  stop() {
    if (this._watcher) {
      this._watcher.close();
      this._watcher = null;
    }
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
  }

  _debounce() {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;
      this._processPending();
    }, 500);
  }

  _scanExisting() {
    try {
      const files = fs.readdirSync(this._customDir).filter(f => f.endsWith('.png'));
      for (const file of files) {
        const config = this._parseFilename(file);
        if (config) {
          this._registered.set(file, config);
          this._onSpriteAdded(config);
        }
      }
      if (files.length > 0) {
        console.log(`[UGC] Scanned ${files.length} existing custom sprites`);
      }
    } catch (err) {
      // Directory might not exist yet
    }
  }

  _processPending() {
    for (const filename of this._pendingFiles) {
      const filePath = path.join(this._customDir, filename);

      if (fs.existsSync(filePath)) {
        // File added/changed
        const config = this._parseFilename(filename);
        if (config) {
          const isNew = !this._registered.has(filename);
          this._registered.set(filename, config);
          this._onSpriteAdded(config);
          console.log(`[UGC] ${isNew ? 'Registered' : 'Updated'} custom sprite: ${config.id}`);
        }
      } else {
        // File removed
        const oldConfig = this._registered.get(filename);
        if (oldConfig) {
          this._registered.delete(filename);
          this._onSpriteRemoved(oldConfig.id);
          console.log(`[UGC] Removed custom sprite: ${oldConfig.id}`);
        }
      }
    }
    this._pendingFiles.clear();
  }

  /**
   * Parse filename to extract sprite metadata.
   * Convention: {category}-{name}_{width}x{height}_{frames}f.png
   * Examples:
   *   character-ninja_32x32_4f.png → { id: 'custom_character-ninja', w: 32, h: 32, frames: 4 }
   *   building-castle_48x48_1f.png → { id: 'custom_building-castle', w: 48, h: 48, frames: 1 }
   *   my-sprite.png → { id: 'custom_my-sprite', w: 32, h: 32, frames: 1 }
   */
  _parseFilename(filename) {
    const base = filename.replace('.png', '');

    // Try convention: name_WxH_Nf
    const match = base.match(/^(.+?)_(\d+)x(\d+)_(\d+)f$/);
    if (match) {
      return {
        id: `custom_${match[1]}`,
        filename,
        path: `assets/custom/${filename}`,
        width: parseInt(match[2], 10),
        height: parseInt(match[3], 10),
        frames: parseInt(match[4], 10),
        category: match[1].split('-')[0] || 'misc',
      };
    }

    // Try partial: name_WxH
    const match2 = base.match(/^(.+?)_(\d+)x(\d+)$/);
    if (match2) {
      return {
        id: `custom_${match2[1]}`,
        filename,
        path: `assets/custom/${filename}`,
        width: parseInt(match2[2], 10),
        height: parseInt(match2[3], 10),
        frames: 1,
        category: match2[1].split('-')[0] || 'misc',
      };
    }

    // Fallback: just use the name with defaults
    return {
      id: `custom_${base}`,
      filename,
      path: `assets/custom/${filename}`,
      width: 32,
      height: 32,
      frames: 1,
      category: 'misc',
    };
  }

  /** Get all registered custom sprites. */
  getRegistered() {
    return Array.from(this._registered.values());
  }
}

module.exports = UGCImporter;
