const http = require('node:http');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT || process.argv[2] || 3000);
const ROOM_KEY = process.env.ROOM_KEY || '';
const REALTIME_APP_ID = process.env.REALTIME_SFU_APP_ID || '';
const REALTIME_API_TOKEN = process.env.REALTIME_SFU_API_TOKEN || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN && !/^(?:required-|placeholder)/i.test(process.env.GITHUB_TOKEN)
  ? process.env.GITHUB_TOKEN
  : '';
const RELEASE_REPOSITORY = 'kaitohmd/inexpetelas';
const members = new Map();
const server = http.createServer((req, res) => {
  if (req.url?.startsWith('/sfu/')) {
    void handleSfuRequest(req, res);
    return;
  }
  if (req.url?.startsWith('/updates/')) {
    void serveUpdate(req, res);
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('INEXPETELAS online');
});
const wss = new WebSocketServer({ server, maxPayload: 65536 });

async function handleSfuRequest(req, res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'POST, PUT, OPTIONS');
  res.setHeader('access-control-allow-headers', 'authorization, content-type');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  const reply = (status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
  if (!REALTIME_APP_ID || !REALTIME_API_TOKEN) return reply(503, { error: 'SFU ainda não está configurado no servidor.' });
  if (req.headers.authorization !== `Bearer ${ROOM_KEY}` || !ROOM_KEY) return reply(401, { error: 'Não autorizado.' });
  if (!['POST', 'PUT'].includes(req.method)) return reply(405, { error: 'Método não permitido.' });
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 2_000_000) return reply(413, { error: 'Solicitação muito grande.' });
  }
  let input;
  try { input = JSON.parse(body || '{}'); } catch { return reply(400, { error: 'JSON inválido.' }); }
  const member = members.get(input.memberId);
  if (!member || member.readyState !== WebSocket.OPEN) return reply(401, { error: 'Participante não está na sala.' });
  const base = `https://rtc.live.cloudflare.com/v1/apps/${REALTIME_APP_ID}`;
  const call = async (path, method = 'POST', payload) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${REALTIME_API_TOKEN}`, 'content-type': 'application/json' },
      ...(payload ? { body: JSON.stringify(payload) } : {})
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.errorDescription || result.error || `Cloudflare SFU (${response.status})`);
    return result;
  };
  try {
    const route = new URL(req.url, 'http://localhost').pathname;
    if (route === '/sfu/session' && req.method === 'POST') {
      if (!['publisher', 'subscriber'].includes(input.role)) return reply(400, { error: 'Sessão inválida.' });
      const session = await call('/sessions/new');
      member[input.role === 'publisher' ? 'publishSessionId' : 'receiveSessionId'] = session.sessionId;
      return reply(200, session);
    }
    if (route === '/sfu/publish' && req.method === 'POST') {
      const sessionId = member.publishSessionId;
      const mid = String(input.mid || '');
      if (!sessionId || !input.sessionDescription || !mid || mid.length > 8) return reply(400, { error: 'Publicação inválida.' });
      const result = await call(`/sessions/${encodeURIComponent(sessionId)}/tracks/new`, 'POST', {
        sessionDescription: input.sessionDescription,
        tracks: [{ location: 'local', mid, trackName: 'screen' }]
      });
      return reply(200, result);
    }
    if (route === '/sfu/subscribe' && req.method === 'POST') {
      const sessionId = member.receiveSessionId;
      const requested = Array.isArray(input.publications) ? input.publications.slice(0, 7) : [];
      const tracks = requested.map(item => {
        const publisher = members.get(item.memberId);
        if (!publisher?.profile.screen || !publisher.publishSessionId || item.memberId === input.memberId) return null;
        return { location: 'remote', sessionId: publisher.publishSessionId, trackName: 'screen' };
      }).filter(Boolean);
      if (!sessionId || !tracks.length) return reply(200, { tracks: [] });
      const result = await call(`/sessions/${encodeURIComponent(sessionId)}/tracks/new`, 'POST', { tracks });
      result.tracks = (result.tracks || []).map(track => ({
        ...track,
        ownerId: requested.find(item => members.get(item.memberId)?.publishSessionId === track.sessionId)?.memberId || null
      }));
      return reply(200, result);
    }
    if (route === '/sfu/renegotiate' && req.method === 'PUT') {
      const sessionId = member.receiveSessionId;
      if (!sessionId || !input.sessionDescription) return reply(400, { error: 'Resposta de conexão inválida.' });
      return reply(200, await call(`/sessions/${encodeURIComponent(sessionId)}/renegotiate`, 'PUT', { sessionDescription: input.sessionDescription }));
    }
    return reply(404, { error: 'Rota não encontrada.' });
  } catch (error) {
    console.error('SFU:', error.message);
    return reply(502, { error: 'Não foi possível conectar ao servidor de mídia.' });
  }
}

const send = (socket, payload) => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
};
const broadcast = (payload, except) => {
  for (const socket of members.values()) if (socket !== except) send(socket, payload);
};

async function serveUpdate(req, res) {
  if (!ROOM_KEY || req.headers.authorization !== `Bearer ${ROOM_KEY}`) {
    res.writeHead(404).end();
    return;
  }
  const filename = decodeURIComponent(new URL(req.url, 'https://updates.local').pathname.slice('/updates/'.length));
  if (!/^(?:latest\.yml|INEXPETELAS-Setup-[\w.-]+\.exe(?:\.blockmap)?)$/.test(filename)) {
    res.writeHead(404).end();
    return;
  }
  try {
    const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'INEXPETELAS-updater' };
    if (GITHUB_TOKEN) headers.authorization = `Bearer ${GITHUB_TOKEN}`;
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
      if (!crypto.randomUUID) return socket.close(1011, 'Servidor sem suporte a UUID');
      id = crypto.randomUUID();
      const candidatePhoto = String(data.photo || '');
      const photo = candidatePhoto.length <= 12000 && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(candidatePhoto) ? candidatePhoto : '';
      const profile = { id, name, photo, screen: false, watching: null };
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
      if (!patch.screen && socket.profile.watching) {
        socket.profile.watching = null;
        broadcast({ type: 'view', id, screenId: null }, socket);
      }
      Object.assign(socket.profile, patch);
      if (!patch.screen) socket.publishSessionId = null;
      broadcast({ type: 'state', id, ...patch }, socket);
    } else if (data.type === 'view') {
      const screenId = typeof data.screenId === 'string' && data.screenId !== id && members.get(data.screenId)?.profile.screen
        ? data.screenId
        : null;
      socket.profile.watching = screenId;
      broadcast({ type: 'view', id, screenId }, socket);
    } else if (data.type === 'signal' && members.has(data.to)) {
      if (!['offer', 'answer', 'candidate'].includes(data.signal?.type)) return;
      send(members.get(data.to), { type: 'signal', from: id, signal: data.signal });
    }
  });
  socket.on('close', () => {
    clearTimeout(timer);
    if (!id) return;
    members.delete(id);
    socket.publishSessionId = null;
    socket.receiveSessionId = null;
    broadcast({ type: 'left', id });
  });
});

const HOST = ROOM_KEY ? '0.0.0.0' : '127.0.0.1';
server.listen(PORT, HOST, () => console.log(`Servidor de telas em ${HOST}:${PORT}${ROOM_KEY ? ' (com código)' : ' (somente local)'}`));
