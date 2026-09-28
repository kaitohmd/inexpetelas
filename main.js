const { app, BrowserWindow, desktopCapturer, ipcMain, session } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
let selectedSource = null;
const updateKey = '698df1b771e65277936172ef0e1738b001193440dba5e4c1';
let updateState = { status: 'idle' };
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
ipcMain.on('updates:install', () => {
  if (updateState.status === 'downloaded') autoUpdater.quitAndInstall();
});

function publishUpdateState(state) {
  updateState = state;
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.webContents.isLoading()) window.webContents.once('did-finish-load', () => window.webContents.send('updates:state', updateState));
    else window.webContents.send('updates:state', updateState);
  }
}

if (app.isPackaged) {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: 'https://inexpetelas.squareweb.app/updates/',
    requestHeaders: { Authorization: `Bearer ${updateKey}` }
  });
  autoUpdater.on('checking-for-update', () => publishUpdateState({ status: 'checking' }));
  autoUpdater.on('update-available', info => publishUpdateState({ status: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('download-progress', progress => publishUpdateState({ status: 'downloading', percent: Math.round(progress.percent) }));
  autoUpdater.on('update-downloaded', info => publishUpdateState({ status: 'downloaded', version: info.version }));
  autoUpdater.on('update-not-available', () => publishUpdateState({ status: 'idle' }));
  autoUpdater.on('error', error => {
    console.error('Atualização:', error.message);
    publishUpdateState({ status: 'idle' });
  });
}

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
  if (app.isPackaged) setTimeout(() => autoUpdater.checkForUpdates().catch(error => console.error('Verificação de atualização:', error.message)), 2500);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
