const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const owner = 'kaitohmd';
const repository = 'inexpetelas';
const installDir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'INEXPETELAS');
const installedExe = path.join(installDir, 'INEXPETELAS.exe');
let window;
let currentDownload;

function send(type, details = {}) {
  if (window && !window.isDestroyed()) window.webContents.send('setup:state', { type, ...details });
}

async function getLatestSetup() {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repository}/releases/latest`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'INEXPETELAS-Launcher' }
  });
  if (!response.ok) throw new Error(`GitHub respondeu ${response.status}`);
  const release = await response.json();
  const setup = release.assets?.find(asset => /^INEXPETELAS-Setup-[\w.-]+\.exe$/.test(asset.name));
  if (!setup) throw new Error('Não encontrei um instalador compatível na versão mais recente.');
  return { version: release.tag_name, setup };
}

function launchInstalled() {
  if (!fs.existsSync(installedExe)) return false;
  const child = spawn(installedExe, [], { detached: true, stdio: 'ignore' });
  child.unref();
  app.quit();
  return true;
}

async function installLatest() {
  try {
    if (launchInstalled()) return;
    send('checking');
    const { version, setup } = await getLatestSetup();
    const temporary = path.join(app.getPath('temp'), `INEXPETELAS-${version}-setup.exe`);
    currentDownload = temporary;
    send('downloading', { version, percent: 0 });
    const response = await fetch(setup.browser_download_url);
    if (!response.ok || !response.body) throw new Error(`Não consegui baixar o app (${response.status}).`);
    const output = fs.createWriteStream(temporary);
    let received = 0;
    const total = Number(response.headers.get('content-length')) || setup.size;
    for await (const chunk of response.body) {
      received += chunk.length;
      if (!output.write(chunk)) await new Promise(resolve => output.once('drain', resolve));
      if (total) send('downloading', { version, percent: Math.min(99, Math.round(received / total * 100)) });
    }
    await new Promise((resolve, reject) => output.end(error => error ? reject(error) : resolve()));
    send('installing', { version });
    fs.mkdirSync(installDir, { recursive: true });
    const installer = spawn(temporary, ['/S'], { detached: false, stdio: 'ignore' });
    installer.once('error', error => send('error', { message: `Não consegui abrir a instalação: ${error.message}` }));
    installer.once('close', code => {
      if (code === 0 && launchInstalled()) return;
      send('error', { message: 'A instalação não terminou. Você pode tentar novamente.' });
    });
  } catch (error) {
    send('error', { message: error.message || 'Falha ao instalar o INEXPETELAS.' });
  }
}

function createWindow() {
  window = new BrowserWindow({
    width: 460, height: 560, resizable: false, autoHideMenuBar: true,
    title: 'INEXPETELAS', backgroundColor: '#10090b', show: false,
    icon: path.join(__dirname, 'app.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  window.loadFile(path.join(__dirname, 'index.html'));
  window.once('ready-to-show', () => window.show());
}

ipcMain.on('setup:install', installLatest);
ipcMain.on('setup:open-downloads', () => shell.openExternal(`https://github.com/${owner}/${repository}/releases/latest`));
app.whenReady().then(() => { if (launchInstalled()) return; createWindow(); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { if (currentDownload && fs.existsSync(currentDownload)) { try { fs.unlinkSync(currentDownload); } catch {} } });
