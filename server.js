const http = require('node:http');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT || process.argv[2] || 3000);
const ROOM_KEY = process.env.ROOM_KEY || '';
const members = new Map();
const server = http.createServer((req, res) => {
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

const HOST = '0.0.0.0';
server.listen(PORT, HOST, () => console.log(`Servidor de telas em ${HOST}:${PORT}${ROOM_KEY ? ' (com código)' : ' (somente local)'}`));
