const { app, BrowserWindow, desktopCapturer, ipcMain, session } = require('electron');
const path = require('path');
let selectedSource = null;
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// A transmissão continua em tempo real mesmo quando o INEXPETELAS perde foco.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

ipcMain.handle('screen:sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
  return sources.map(source => ({ id: source.id, name: source.name, thumbnail: source.thumbnail.toDataURL() }));
});
ipcMain.handle('screen:select', (_event, id) => { selectedSource = id; });
ipcMain.handle('window:focus-screen', (event, enabled) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  window?.setFullScreen(Boolean(enabled));
});

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 640,
    minHeight: 420,
    backgroundColor: '#070708',
    title: 'INEXPETELAS',
    icon: path.join(__dirname, 'assets', 'app.ico'),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  window.loadFile(path.join(__dirname, 'index.html'));
  window.on('leave-full-screen', () => window.webContents.send('window:left-full-screen'));
  window.once('ready-to-show', () => window.show());
  window.maximize();
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    // O áudio de getDisplayMedia também pede "media" no Windows. Só liberar durante uma captura escolhida pelo usuário.
    callback(permission === 'display-capture' || (permission === 'media' && selectedSource !== null));
  });
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
    const source = sources.find(item => item.id === selectedSource);
    selectedSource = null;
    callback(source ? { video: source, audio: 'loopback' } : null);
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
