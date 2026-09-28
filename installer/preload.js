const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('setup', {
  install: () => ipcRenderer.send('setup:install'),
  openDownloads: () => ipcRenderer.send('setup:open-downloads'),
  onState: callback => ipcRenderer.on('setup:state', (_event, state) => callback(state))
});
