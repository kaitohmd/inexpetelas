const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  sources: () => ipcRenderer.invoke('screen:sources'),
  selectSource: id => ipcRenderer.invoke('screen:select', id),
  setFocusMode: enabled => ipcRenderer.invoke('window:focus-screen', enabled),
  onLeaveFullscreen: callback => ipcRenderer.on('window:left-full-screen', () => callback())
});
