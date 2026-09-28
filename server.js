const http = require('node:http');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT || process.argv[2] || 3000);
const ROOM_KEY = process.env.ROOM_KEY || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const RELEASE_REPOSITORY = 'kaitohmd/inexpetelas';
const members = new Map();
const server = http.createServer((req, res) => {
  if (req.url?.startsWith('/updates/')) {
    void serveUpdate(req, res);
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('INEXPETELAS online');
});
const wss = new WebSocketServer({ server, maxPayload: 65536 });

const send = (socket, payload) => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
};
const broadcast = (payload, except) => {
  for (const socket of members.values()) if (socket !== except) send(socket, payload);
};

async function serveUpdate(req, res) {
  if (!ROOM_KEY || !GITHUB_TOKEN || req.headers.authorization !== `Bearer ${ROOM_KEY}`) {
    res.writeHead(404).end();
    return;
  }
  const filename = decodeURIComponent(new URL(req.url, 'https://updates.local').pathname.slice('/updates/'.length));
  if (!/^(?:latest\.yml|INEXPETELAS-Setup-[\w.-]+\.exe(?:\.blockmap)?)$/.test(filename)) {
    res.writeHead(404).end();
    return;
  }
  try {
    const headers = { authorization: `Bearer ${GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'INEXPETELAS-updater' };
    const releaseResponse = await fetch(`https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/latest`, { headers });
    if (!releaseResponse.ok) throw new Error(`GitHub release lookup failed (${releaseResponse.status})`);
    const release = await releaseResponse.json();
    const asset = release.assets.find(item => item.name === filename);
    if (!asset) { res.writeHead(404).end(); return; }
    const assetResponse = await fetch(asset.url, { headers: { ...headers, accept: 'application/octet-stream' }, redirect: 'follow' });
    if (!assetResponse.ok || !assetResponse.body) throw new Error(`GitHub asset fetch failed (${assetResponse.status})`);
    res.writeHead(200, {
      'content-type': filename.endsWith('.yml') ? 'text/yaml; charset=utf-8' : 'application/octet-stream',
      'content-length': asset.size,
      'cache-control': filename === 'latest.yml' ? 'no-cache' : 'private, max-age=3600'
    });
    for await (const chunk of assetResponse.body) {
      if (!res.write(chunk)) await new Promise(resolve => res.once('drain', resolve));
    }
    res.end();
  } catch (error) {
    console.error('Update proxy:', error.message);
    if (!res.headersSent) res.writeHead(502).end('Update service unavailable');
    else res.destroy(error);
  }
}

wss.on('connection', socket => {
  let id = null;
  const timer = setTimeout(() => socket.close(4001, 'Tempo esgotado'), 10000);
  socket.on('message', raw => {
    let data;
    try { data = JSON.parse(raw.toString()); } catch { return; }
    if (!id) {
      if (data.type !== 'join') return;
      if (ROOM_KEY && data.key !== ROOM_KEY) return socket.close(4003, 'Código incorreto');
      if (members.size >= 8) return socket.close(4008, 'Sala cheia');
      const name = String(data.name || '').trim().slice(0, 24);
      if (!name) return socket.close(4002, 'Nome obrigatório');
      id = crypto.randomUUID();
      const candidatePhoto = String(data.photo || '');
      const photo = candidatePhoto.length <= 12000 && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(candidatePhoto) ? candidatePhoto : '';
      const profile = { id, name, photo, screen: false };
      socket.profile = profile;
      send(socket, { type: 'welcome', id, peers: [...members.values()].map(peer => peer.profile) });
      members.set(id, socket);
      broadcast({ type: 'joined', peer: profile }, socket);
      clearTimeout(timer);
      return;
    }
    if (data.type === 'ping') {
      send(socket, { type: 'pong', sent: data.sent });
    } else if (data.type === 'state') {
      const patch = { screen: !!data.screen };
      Object.assign(socket.profile, patch);
      broadcast({ type: 'state', id, ...patch }, socket);
    } else if (data.type === 'signal' && members.has(data.to)) {
      if (!['offer', 'answer', 'candidate'].includes(data.signal?.type)) return;
      send(members.get(data.to), { type: 'signal', from: id, signal: data.signal });
    }
  });
  socket.on('close', () => {
    clearTimeout(timer);
    if (!id) return;
    members.delete(id);
    broadcast({ type: 'left', id });
  });
});

const HOST = ROOM_KEY ? '0.0.0.0' : '127.0.0.1';
server.listen(PORT, HOST, () => console.log(`Servidor de telas em ${HOST}:${PORT}${ROOM_KEY ? ' (com código)' : ' (somente local)'}`));
