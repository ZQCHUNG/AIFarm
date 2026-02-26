const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buddy', {
  onActivityEvent: (cb) => ipcRenderer.on('activity-event', (_e, d) => cb(d)),
  onSetBuddies: (cb) => ipcRenderer.on('set-buddies', (_e, list) => cb(list)),
  onResizeCanvas: (cb) => ipcRenderer.on('resize-canvas', (_e, w, h) => cb(w, h)),
  onFarmUpdate: (cb) => ipcRenderer.on('farm-update', (_e, state) => cb(state)),
  onFarmEnergyTick: (cb) => ipcRenderer.on('farm-energy-tick', (_e, pts) => cb(pts)),
  onUsageUpdate: (cb) => ipcRenderer.on('usage-update', (_e, state) => cb(state)),
  onAchievementUnlocked: (cb) => ipcRenderer.on('achievement-unlocked', (_e, notif) => cb(notif)),
  onPrestigeEvent: (cb) => ipcRenderer.on('prestige-event', (_e, data) => cb(data)),
  onVibeUpdate: (cb) => ipcRenderer.on('vibe-update', (_e, data) => cb(data)),
  onSpritesReload: (cb) => ipcRenderer.on('sprites-reload', (_e, data) => cb(data)),
  setIgnoreMouseEvents: (ignore, opts) => ipcRenderer.send('set-ignore-mouse', ignore, opts),
  unlockBuilding: (id) => ipcRenderer.send('unlock-building', id),
  setWeather: (condition) => ipcRenderer.send('set-weather', condition),
  setSeason: (season) => ipcRenderer.send('set-season', season),
});
