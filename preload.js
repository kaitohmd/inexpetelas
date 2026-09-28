const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  sources: () => ipcRenderer.invoke('screen:sources'),
  selectSource: id => ipcRenderer.invoke('screen:select', id),
  setSharing: active => ipcRenderer.send('screen:sharing', Boolean(active)),
  setFocusMode: enabled => ipcRenderer.invoke('window:focus-screen', enabled),
  onLeaveFullscreen: callback => ipcRenderer.on('window:left-full-screen', () => callback()),
  onUpdateState: callback => ipcRenderer.on('updates:state', (_event, state) => callback(state)),
  installUpdate: () => ipcRenderer.send('updates:install')
});
