const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadConfig: () => ipcRenderer.invoke('cfg:load'),
  saveConfig: (cfg) => ipcRenderer.invoke('cfg:save', cfg),
  startMonitor: (cfg) => ipcRenderer.invoke('monitor:start', cfg),
  stopMonitor: () => ipcRenderer.invoke('monitor:stop'),
  fetchOnce: (cfg) => ipcRenderer.invoke('monitor:fetch-once', cfg),
  onData: (cb) => ipcRenderer.on('steam-data', (_, data) => cb(data)),
  onError: (cb) => ipcRenderer.on('steam-error', (_, msg) => cb(msg)),
  listHistory: () => ipcRenderer.invoke('history:list'),
  compareHistory: (idFrom, idTo) => ipcRenderer.invoke('history:compare', idFrom, idTo),
  clearHistory: () => ipcRenderer.invoke('history:clear')
});
