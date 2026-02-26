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
  onUGCSpriteAdded: (cb) => ipcRenderer.on('ugc-sprite-added', (_e, config) => cb(config)),
  onUGCSpriteRemoved: (cb) => ipcRenderer.on('ugc-sprite-removed', (_e, id) => cb(id)),
  setIgnoreMouseEvents: (ignore, opts) => ipcRenderer.send('set-ignore-mouse', ignore, opts),
  saveSkills: (state) => ipcRenderer.send('save-skills', state),
  saveConstruction: (state) => ipcRenderer.send('save-construction', state),
  unlockBuilding: (id) => ipcRenderer.send('unlock-building', id),
  setWeather: (condition) => ipcRenderer.send('set-weather', condition),
  setSeason: (season) => ipcRenderer.send('set-season', season),
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
  captureToFile: (filePath) => ipcRenderer.send('capture-to-file', filePath),
});
