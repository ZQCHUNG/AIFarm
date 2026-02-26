const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const SessionFinder = require('./watcher/session-finder');
const JsonlTailer = require('./watcher/jsonl-tailer');
const EventParser = require('./watcher/event-parser');
const FarmState = require('./farm/farm-state');
const UsageTracker = require('./watcher/usage-tracker');
const DataExporter = require('./watcher/data-exporter');
const UGCImporter = require('./watcher/ugc-importer');

let win = null;
let tray = null;
const sessionFinder = new SessionFinder();
const farm = new FarmState();
const usage = new UsageTracker();
const exporter = new DataExporter();
const ugcImporter = new UGCImporter();

// Per-buddy slot width: must equal scene.js SLOT_W (40) * PX (3)
const SLOT_W_PX = 40 * 3; // 120 screen pixels
const MIN_W = 330;
const MAX_W = 1200;

// Dynamic window height based on screen size
const WIN_H_RATIO = 0.45;  // 佔螢幕高度 45%
const WIN_H_MIN = 351;     // 最小高度（向下相容）
const WIN_H_MAX = 800;     // 最大高度上限

function getWindowHeight() {
  const { height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  return Math.min(WIN_H_MAX, Math.max(WIN_H_MIN, Math.floor(screenH * WIN_H_RATIO)));
}

// Active buddies: Map<sessionPath, { tailer, project }>
const buddies = new Map();

// Achievement throttle: buffer events and flush every 1 second
let achievementEventBuffer = [];
let achievementFlushTimer = null;

function startAchievementFlush() {
  achievementFlushTimer = setInterval(() => {
    if (achievementEventBuffer.length === 0) return;
    const batch = achievementEventBuffer.splice(0);
    for (const { evt, sessionPath } of batch) {
      farm.achievements.onEvent(evt, sessionPath, farm.state);
    }
    const notifs = farm.achievements.popNotifications();
    if (notifs.length > 0 && win && !win.isDestroyed()) {
      for (const n of notifs) win.webContents.send('achievement-unlocked', n);
      win.webContents.send('farm-update', farm.getRendererState());
    }
  }, 1000);
}

function stopAchievementFlush() {
  if (achievementFlushTimer) clearInterval(achievementFlushTimer);
}

// ---------- Single window ----------

function ensureWindow() {
  if (win && !win.isDestroyed()) return;

  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const winH = getWindowHeight();

  win = new BrowserWindow({
    width: MIN_W,
    height: winH,
    x: Math.floor(screenW / 2 - MIN_W / 2),
    y: screenH - winH,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.setIgnoreMouseEvents(true, { forward: true });
}

function resizeWindow(numBuddies) {
  if (!win || win.isDestroyed()) return;
  const count = Math.max(1, numBuddies);
  const newW = Math.min(MAX_W, Math.max(MIN_W, count * SLOT_W_PX + 90));
  const winH = getWindowHeight();

  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const x = Math.max(0, Math.floor(screenW / 2 - newW / 2));

  win.setSize(newW, winH);
  win.setPosition(x, screenH - winH);

  // Tell renderer about new canvas size
  win.webContents.send('resize-canvas', newW, winH);
}

// ---------- Session management ----------

// If no new JSONL data for this long, consider the session closed
const INACTIVE_TIMEOUT = 10 * 60 * 1000; // 10 minutes

function reconcileSessions(activeSessions) {
  const activePaths = new Set(activeSessions.map(s => s.path));
  let changed = false;
  const now = Date.now();

  // Remove: no longer in mtime window OR no new data for 10 min
  for (const [sp, buddy] of buddies) {
    const timedOut = (now - buddy.lastDataTime) > INACTIVE_TIMEOUT;
    if (!activePaths.has(sp) || timedOut) {
      console.log('[Claude Buddy] -', buddy.project, timedOut ? '(inactive)' : '(old)');
      // Record session for NPC history
      const duration = now - (buddy.startTime || buddy.lastDataTime);
      farm.recordSession({
        id: sp,
        project: buddy.project,
        startTime: buddy.startTime || (now - duration),
        endTime: now,
        duration,
        colorIndex: buddy.colorIndex || 0,
      });
      buddy.tailer.stop();
      farm.achievements.removeSession(sp);
      buddies.delete(sp);
      changed = true;
    }
  }

  // Add new
  for (const session of activeSessions) {
    if (!buddies.has(session.path)) {
      console.log('[Claude Buddy] +', session.project);
      const tailer = new JsonlTailer();
      tailer.setFile(session.path);

      const buddyObj = {
        tailer,
        project: session.project,
        lastDataTime: now, // assume alive on discovery
        startTime: now,    // track session start for NPC history
        colorIndex: 0,     // assigned later in sendBuddyList
      };

      tailer.start((entries) => {
        if (entries.length > 0) {
          buddyObj.lastDataTime = Date.now(); // got new data → still alive
        }
        for (const entry of entries) {
          // Track usage tokens from raw JSONL entry
          usage.trackEntry(entry);
          // Detect bash errors from raw entry
          if (entry.type === 'result' && entry.result && entry.result.is_error) {
            exporter.recordBashError();
          }

          const events = EventParser.parse(entry);
          for (const evt of events) {
            // Feed to data exporter for vibe analysis
            exporter.recordEvent(evt);

            if (win && !win.isDestroyed()) {
              evt.sessionId = session.path;
              win.webContents.send('activity-event', evt);
            }
            // Feed energy to farm
            const pts = farm.addEnergy(evt.type, buddies.size);
            if (pts > 0 && win && !win.isDestroyed()) {
              win.webContents.send('farm-energy-tick', pts);
              win.webContents.send('farm-update', farm.getRendererState());
              // Check for generation prestige event
              const prestige = farm.popPrestigeEvent();
              if (prestige) {
                win.webContents.send('prestige-event', prestige);
              }
            }
            // Buffer achievement events (flushed every 1s to reduce CPU)
            achievementEventBuffer.push({ evt, sessionPath: session.path });
          }
        }
      });

      buddies.set(session.path, buddyObj);
      changed = true;
    }
  }

  if (changed) {
    resizeWindow(buddies.size);
    sendBuddyList(activeSessions);
    // Track peak buddy count for achievement
    farm.achievements.onBuddyCountChange(buddies.size);
  }
}

function sendBuddyList(activeSessions) {
  const list = (activeSessions || [])
    .filter(s => buddies.has(s.path))
    .map((s, i) => {
      // Store colorIndex on buddy for NPC history recording
      const buddy = buddies.get(s.path);
      if (buddy) buddy.colorIndex = i;
      return { id: s.path, project: s.project, colorIndex: i };
    });
  if (win && !win.isDestroyed()) {
    win.webContents.send('set-buddies', list);
  }
}

// ---------- Tray ----------

function createTrayIcon() {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const i = (y * size + x) * 4;
    buf[i] = r; buf[i+1] = g; buf[i+2] = b; buf[i+3] = a;
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if (Math.sqrt((x-7.5)**2 + (y-7.5)**2) <= 6.5) set(x, y, 0xE8, 0x73, 0x4A);
  set(5,7,0x2C,0x2C,0x2C); set(10,7,0x2C,0x2C,0x2C);
  set(6,9,0xC8,0x5A,0x32); set(7,10,0xC8,0x5A,0x32);
  set(8,10,0xC8,0x5A,0x32); set(9,9,0xC8,0x5A,0x32);
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('Claude Buddy');

  const buildMenu = () => {
    const items = [];
    for (const [, b] of buddies) items.push({ label: `  ${b.project}`, enabled: false });
    if (items.length === 0) items.push({ label: '  (no sessions)', enabled: false });
    return Menu.buildFromTemplate([
      { label: `Active: ${buddies.size} buddies`, enabled: false },
      ...items,
      { type: 'separator' },
      { label: 'Show / Hide', click: () => { if (win) win.isVisible() ? win.hide() : win.show(); } },
      { type: 'separator' },
      { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
    ]);
  };
  setInterval(() => tray.setContextMenu(buildMenu()), 5000);
  tray.setContextMenu(buildMenu());
  tray.on('click', () => { if (win) win.isVisible() ? win.hide() : win.show(); });
}

// ---------- Fullscreen toggle (F11) ----------

let isFullscreen = false;
let savedBounds = null;

ipcMain.on('toggle-fullscreen', () => {
  if (!win || win.isDestroyed()) return;
  if (!isFullscreen) {
    // Save current state
    savedBounds = win.getBounds();
    // Switch to fullscreen mode
    win.setAlwaysOnTop(false);
    win.setSkipTaskbar(false);
    win.setIgnoreMouseEvents(false);
    win.setFullScreen(true);
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    win.webContents.send('resize-canvas', width, height);
    isFullscreen = true;
    console.log('[Claude Buddy] Fullscreen ON');
  } else {
    // Restore desktop companion mode
    win.setFullScreen(false);
    win.setAlwaysOnTop(true);
    win.setSkipTaskbar(true);
    win.setIgnoreMouseEvents(true, { forward: true });
    if (savedBounds) {
      win.setBounds(savedBounds);
      win.webContents.send('resize-canvas', savedBounds.width, savedBounds.height);
    }
    isFullscreen = false;
    console.log('[Claude Buddy] Fullscreen OFF');
  }
});

// ---------- IPC ----------

ipcMain.on('capture-to-file', async (e, filePath) => {
  if (!win || win.isDestroyed()) return;
  try {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(filePath, img.toPNG());
    console.log(`[Claude Buddy] Screenshot saved to ${filePath}`);
  } catch (err) {
    console.error('[Claude Buddy] Screenshot failed:', err);
  }
});

let isIgnoring = true; // tracks current ignore state to prevent jitter
ipcMain.on('set-ignore-mouse', (e, ignore) => {
  if (isIgnoring === ignore) return; // state unchanged — skip to prevent flicker
  isIgnoring = ignore;
  if (win && !win.isDestroyed()) {
    win.setIgnoreMouseEvents(ignore, { forward: true });
    if (!ignore) {
      // When no longer click-through, grab keyboard focus (fixes Bug A)
      win.focus();
    }
  }
});

ipcMain.on('focus-window', () => {
  if (win && !win.isDestroyed()) win.focus();
});

ipcMain.on('set-weather', (e, condition) => {
  // Rain gives +50% crop growth rate
  if (condition === 'rain') {
    farm.setWeatherMultiplier(1.5);
  } else {
    farm.setWeatherMultiplier(1.0);
  }
});

ipcMain.on('set-season', (e, season) => {
  if (farm.setSeason) farm.setSeason(season);
});

ipcMain.on('save-skills', (e, skillsState) => {
  if (skillsState) {
    farm.state.skills = skillsState;
    farm._dirty = true;
  }
});

ipcMain.on('save-construction', (e, constructionState) => {
  if (constructionState) {
    farm.state.construction = constructionState;
    farm._dirty = true;
  }
});

ipcMain.on('save-tech-tree', (e, s) => { if (s) { farm.state.techTree = s; farm._dirty = true; } });
ipcMain.on('save-house-custom', (e, s) => { if (s) { farm.state.houseCustom = s; farm._dirty = true; } });
ipcMain.on('save-broadcast', (e, s) => { if (s) { farm.state.broadcast = s; farm._dirty = true; } });
ipcMain.on('save-trade-diplo', (e, s) => { if (s) { farm.state.tradeDiplo = s; farm._dirty = true; } });
ipcMain.on('save-tutorial', (e, s) => { if (s) { farm.state.tutorial = s; farm._dirty = true; } });
ipcMain.on('save-friendship', (e, s) => { if (s) { farm.state.friendship = s; farm._dirty = true; } });
ipcMain.on('save-victory', (e, s) => { if (s) { farm.state.victory = s; farm._dirty = true; } });

ipcMain.on('unlock-building', (e, id) => {
  if (!farm.state.buildings[id]) {
    farm.state.buildings[id] = true;
    farm._dirty = true;
    console.log(`[Farm] Building unlocked via permit: ${id}`);
    if (win && !win.isDestroyed()) {
      win.webContents.send('farm-update', farm.getRendererState());
    }
  }
});

// ---------- App lifecycle ----------

app.whenReady().then(() => {
  ensureWindow();
  createTray();

  // Re-adapt window when display changes (plug/unplug external monitor)
  screen.on('display-metrics-changed', () => {
    resizeWindow(buddies.size);
  });


  // Wait for renderer to finish loading before starting watchers,
  // otherwise IPC messages are dropped silently.
  // Load farm state and start auto-save
  farm.load();
  farm.startAutoSave();

  // Start achievement throttled flush
  startAchievementFlush();

  // Start usage tracker — sends updates to renderer on change
  usage.start((usageState) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('usage-update', usageState);
    }
  });

  // Start data exporter — analyzes coding vibe every 30s
  exporter.start((vibeState) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('vibe-update', vibeState);
    }
  });

  win.webContents.on('did-finish-load', () => {
    console.log('[Claude Buddy] Renderer ready, starting session watcher');
    // Send initial states to renderer
    win.webContents.send('farm-update', farm.getRendererState());
    win.webContents.send('usage-update', usage.getRendererState());
    const vibeState = exporter.getRendererState();
    if (vibeState) win.webContents.send('vibe-update', vibeState);
    // Poll every 5s, sessions active if modified in last 6 hours
    sessionFinder.start((sessions) => {
      reconcileSessions(sessions);
    }, 5000, 6 * 60 * 60 * 1000);
    // Watch sprites/ for hot-reload
    startSpriteWatcher();
    // Start UGC custom asset importer
    ugcImporter.start(
      (config) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('ugc-sprite-added', config);
        }
      },
      (spriteId) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('ugc-sprite-removed', spriteId);
        }
      }
    );
  });
});

// ===== Sprite folder watcher =====
// Watches renderer/sprites/ for new or changed PNG files.
// Debounces changes and notifies renderer to hot-reload SpriteManager.
let spriteWatcher = null;
let spriteReloadTimer = null;

function startSpriteWatcher() {
  const spritesDir = path.join(__dirname, 'renderer', 'sprites');
  if (!fs.existsSync(spritesDir)) {
    console.log('[Sprites] sprites/ directory not found, skipping watcher');
    return;
  }
  try {
    spriteWatcher = fs.watch(spritesDir, { persistent: false }, (eventType, filename) => {
      if (!filename || !filename.endsWith('.png')) return;
      console.log(`[Sprites] ${eventType}: ${filename}`);
      // Debounce: wait 500ms after last change before reloading
      if (spriteReloadTimer) clearTimeout(spriteReloadTimer);
      spriteReloadTimer = setTimeout(() => {
        spriteReloadTimer = null;
        if (win && !win.isDestroyed()) {
          console.log('[Sprites] Notifying renderer to reload sprites');
          win.webContents.send('sprites-reload', { trigger: filename });
        }
      }, 500);
    });
    console.log(`[Sprites] Watching ${spritesDir} for changes`);
  } catch (err) {
    console.warn('[Sprites] Failed to start watcher:', err.message);
  }
}

app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  stopAchievementFlush();
  exporter.flush();
  exporter.stop();
  farm.close(); // saves + closes SQLite
  usage.stop();
  sessionFinder.stop();
  ugcImporter.stop();
  if (spriteWatcher) { spriteWatcher.close(); spriteWatcher = null; }
  for (const [, b] of buddies) b.tailer.stop();
});
