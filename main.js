const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen } = require('electron');
const path = require('path');
const SessionFinder = require('./watcher/session-finder');
const JsonlTailer = require('./watcher/jsonl-tailer');
const EventParser = require('./watcher/event-parser');
const FarmState = require('./farm/farm-state');
const UsageTracker = require('./watcher/usage-tracker');

let win = null;
let tray = null;
const sessionFinder = new SessionFinder();
const farm = new FarmState();
const usage = new UsageTracker();

// Per-buddy slot width: must equal scene.js SLOT_W (40) * PX (3)
const SLOT_W_PX = 40 * 3; // 120 screen pixels
const WIN_H = 351;
const MIN_W = 330;
const MAX_W = 1200;

// Active buddies: Map<sessionPath, { tailer, project }>
const buddies = new Map();

// ---------- Single window ----------

function ensureWindow() {
  if (win && !win.isDestroyed()) return;

  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    width: MIN_W,
    height: WIN_H,
    x: Math.floor(screenW / 2 - MIN_W / 2),
    y: screenH - WIN_H,
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

  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const [, curY] = win.getPosition();
  const x = Math.max(0, Math.floor(screenW / 2 - newW / 2));

  win.setSize(newW, WIN_H);
  win.setPosition(x, screenH - WIN_H);

  // Tell renderer about new canvas size
  win.webContents.send('resize-canvas', newW, WIN_H);
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
      buddy.tailer.stop();
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
      };

      tailer.start((entries) => {
        if (entries.length > 0) {
          buddyObj.lastDataTime = Date.now(); // got new data → still alive
        }
        for (const entry of entries) {
          // Track usage tokens from raw JSONL entry
          usage.trackEntry(entry);
          const events = EventParser.parse(entry);
          for (const evt of events) {
            if (win && !win.isDestroyed()) {
              evt.sessionId = session.path;
              win.webContents.send('activity-event', evt);
            }
            // Feed energy to farm
            const pts = farm.addEnergy(evt.type, buddies.size);
            if (pts > 0 && win && !win.isDestroyed()) {
              win.webContents.send('farm-energy-tick', pts);
              win.webContents.send('farm-update', farm.getRendererState());
            }
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
  }
}

function sendBuddyList(activeSessions) {
  const list = (activeSessions || [])
    .filter(s => buddies.has(s.path))
    .map((s, i) => ({ id: s.path, project: s.project, colorIndex: i }));
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

// ---------- IPC ----------

ipcMain.on('set-ignore-mouse', (e, ignore, opts) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w) w.setIgnoreMouseEvents(ignore, opts || {});
});

// ---------- App lifecycle ----------

app.whenReady().then(() => {
  ensureWindow();
  createTray();

  // Wait for renderer to finish loading before starting watchers,
  // otherwise IPC messages are dropped silently.
  // Load farm state and start auto-save
  farm.load();
  farm.startAutoSave();

  // Start usage tracker — sends updates to renderer on change
  usage.start((usageState) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('usage-update', usageState);
    }
  });

  win.webContents.on('did-finish-load', () => {
    console.log('[Claude Buddy] Renderer ready, starting session watcher');
    // Send initial states to renderer
    win.webContents.send('farm-update', farm.getRendererState());
    win.webContents.send('usage-update', usage.getRendererState());
    // Poll every 5s, sessions active if modified in last 6 hours
    sessionFinder.start((sessions) => {
      reconcileSessions(sessions);
    }, 5000, 6 * 60 * 60 * 1000);
  });
});

app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  farm.stopAutoSave();
  farm.save();
  usage.stop();
  sessionFinder.stop();
  for (const [, b] of buddies) b.tailer.stop();
});
