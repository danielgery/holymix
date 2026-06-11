const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('toggleVmix', {
  getState: () => ipcRenderer.invoke('toggle:get-state'),
  setState: (enabled) => ipcRenderer.invoke('toggle:set-state', enabled),
  toggle: () => ipcRenderer.invoke('toggle:toggle'),
  testVmix: (target) => ipcRenderer.invoke('toggle:test-vmix', target),
  onStateChanged: (callback) => ipcRenderer.on('state-changed', (_event, payload) => callback(payload)),
});