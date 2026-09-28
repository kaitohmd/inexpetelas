const root = document.querySelector('#app');
const icons = {
  screen: '<rect x="2" y="3" width="20" height="15" rx="2"/><path d="M8 22h8m-4-4v4m0-15v7m-3-3 3 3 3-3"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  pencil: '<path d="m16 4 4 4M3 21l4.5-1 12-12a2.8 2.8 0 0 0-4-4l-12 12z"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
};
const icon = (name, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const safe = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const saved = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; } };
let profile = saved('call-profile', { name: '', photo: '' });
const bundledConfig = { version: 3, url: 'wss://inexpetelas.squareweb.app', key: '698df1b771e65277936172ef0e1738b001193440dba5e4c1' };
let config = saved('call-config', bundledConfig);
if (config.version !== bundledConfig.version) {
  config = bundledConfig;
  localStorage.setItem('call-config', JSON.stringify(config));
}
let socket, myId, screenStream;
let connecting = false, connected = false, choosingScreen = false;
let message = '', peers = new Map();
let focusedScreenId = null, pingTimer = null;
let loading = true;
let captureBusy = false, sourceFilter = 'screen', fitMode = 'contain';
const qualityPresets = {
  smooth: { label: '720p · 60 FPS', width: 1280, height: 720, fps: 60, bitrate: 5_000_000 },
  sharp: { label: '1080p · 60 FPS', width: 1920, height: 1080, fps: 60, bitrate: 8_000_000 },
  light: { label: '720p · 30 FPS', width: 1280, height: 720, fps: 30, bitrate: 3_000_000 }
};
let quality = saved('screen-quality', 'smooth');
if (!qualityPresets[quality]) quality = 'smooth';
const volumes = new Map();
let viewerTimer;
const layoutObserver = new ResizeObserver(() => layoutTiles());
function layoutTiles() {
  const grid = document.querySelector('.stage-grid');
  if (!grid) return;
  const box = screenLayout.fitTiles(grid.clientWidth, grid.clientHeight, grid.children.length);
  grid.style.setProperty('--tile-width', `${Math.floor(box.width)}px`);
  grid.style.setProperty('--tile-height', `${Math.floor(box.height)}px`);
}
const sounds = {
  loading: 'carregandoapp.ogg',
  join: 'entrounacall.ogg',
  leave: 'Alguem saiu da call.ogg',
  screen: 'compartilhououdescopartilhoutela.ogg'
};
function playSound(name) {
  const file = sounds[name];
  if (!file) return;
  const audio = new Audio(`assets/sounds/${encodeURIComponent(file)}`);
  audio.volume = 0.5;
  audio.play().catch(() => {});
  return audio;
}
const pcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };
function captureConstraints() {
  const preset = qualityPresets[quality];
  return { width: { ideal: preset.width, max: preset.width }, height: { ideal: preset.height, max: preset.height }, frameRate: { ideal: preset.fps, max: preset.fps } };
}

function avatar(person, extra = '') {
  const photo = typeof person.photo === 'string' && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(person.photo) ? person.photo : '';
  return photo ? `<img class="avatar ${extra}" src="${photo}" alt=""/>` : `<span class="avatar avatar-letter ${extra}">${safe((person.name || '?').slice(0, 1).toUpperCase())}</span>`;
}
function notify(text) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = text; document.body.append(el);
  setTimeout(() => el.remove(), 3200);
}
function render() {
  // Reuse the actual video nodes so UI updates do not restart their decoder.
  const videos = new Map([...root.querySelectorAll('.share-video')].map(video => [video.dataset.owner, video]));
  layoutObserver.disconnect();
  root.innerHTML = loading ? loadingMarkup() : connected ? callMarkup() : welcomeMarkup();
  document.body.classList.toggle('screen-focus-mode', Boolean(connected && focusedScreenId));
  root.querySelectorAll('.share-video').forEach(slot => {
    const existing = videos.get(slot.dataset.owner);
    if (existing) slot.replaceWith(existing);
  });
  if (loading) return;
  bind(); attachMedia();
  const grid = root.querySelector('.stage-grid');
  if (grid) { layoutObserver.observe(grid); layoutTiles(); }
  if (focusedScreenId) revealViewer();
}
function loadingMarkup() {
  return `<div class="loading-screen" role="status" aria-label="Carregando aplicativo"><div class="loading-mark">${icon('screen', 48)}</div><div class="loading-brand">INEXPETELAS</div><div class="loading-progress"><span></span></div></div>`;
}
function welcomeMarkup() {
  return `<div class="welcome-shell">
    <header class="welcome-top"><div class="brand">${icon('screen', 22)} <span>INEXPETELAS</span></div></header>
    <main class="welcome-main"><section class="entry-card"><div class="profile-row"><button class="photo-button" id="photo-button" title="Escolher foto">${avatar(profile)}<span class="photo-edit">${icon('pencil', 13)}</span></button><div class="name-wrap"><label for="name">Seu nome</label><input id="name" maxlength="24" placeholder="Como quer aparecer?" value="${safe(profile.name)}" autocomplete="off"/></div></div><input id="photo-file" type="file" accept="image/*" hidden/><button class="join-button" id="join" ${connecting ? 'disabled' : ''}>${connecting ? 'Entrando...' : 'Entrar'} ${icon('arrow', 17)}</button>${message ? `<div class="inline-message">${safe(message)}</div>` : ''}</section></main></div>`;
}
function participantTile(person, compact = false) {
  const name = `${safe(person.name)}${person.local ? ' <small>(você)</small>' : ''}`;
  const shared = person.screen;
  const contents = shared
    ? `<video class="share-video" data-owner="${safe(person.id)}" autoplay playsinline muted></video><span class="tile-expand">${icon('expand', 18)}</span>`
    : `<div class="tile-avatar">${avatar(person)}</div>`;
  const labels = `<span class="tile-label"><strong>${name}</strong>${shared ? '<span class="tile-live">AO VIVO</span>' : ''}</span>`;
  const classes = `participant-tile ${shared ? 'is-sharing' : ''} ${compact ? 'is-compact' : ''}`;
  return shared
    ? `<button class="${classes}" data-focus-screen="${safe(person.id)}" title="Abrir a tela de ${safe(person.name)}">${contents}${labels}</button>`
    : `<div class="${classes}">${contents}${labels}</div>`;
}
function requestPing() { send({ type: 'ping', sent: Date.now() }); }
function callMarkup() {
  const all = [{ id: myId, name: profile.name, photo: profile.photo, screen: !!screenStream, local: true }, ...[...peers.values()].map(p => p.profile)];
  const sharing = all.filter(person => person.screen);
  const focused = sharing.find(person => person.id === focusedScreenId);
  if (!focused && focusedScreenId) {
    focusedScreenId = null;
    window.desktop?.setFocusMode?.(false).catch(console.error);
  }
  const gridClass = `stage-grid people-${Math.min(all.length, 8)}`;
  return `<div class="call-shell"><div class="call-main"><header class="call-header"><div class="brand">${icon('screen', 21)} <span>INEXPETELAS</span></div></header>
    <main class="call-body ${focused ? 'is-focused' : ''}">${focused ? viewerMarkup(focused, sharing) : `<div class="${gridClass}">${all.map(person => participantTile(person)).join('')}</div>`}</main>
    <footer class="controls-bar"><div></div><div class="controls-center"><button class="control-btn ${screenStream ? 'active' : ''}" id="toggle-screen" title="${screenStream ? 'Parar compartilhamento' : 'Compartilhar tela'}">${icon('screen', 20)}<span>${screenStream ? 'Parar transmissão' : 'Compartilhar tela'}</span></button></div><button class="leave-btn" id="leave" title="Sair da sala">${icon('close', 19)}<span>Sair</span></button></footer>${choosingScreen ? sourceMarkup() : ''}</div></div>`;
}
let sources = [];
function viewerMarkup(person, sharing) {
  return `<section class="focus-screen" style="--video-fit:${fitMode}" aria-label="Tela de ${safe(person.name)}">
    <video class="share-video" data-owner="${safe(person.id)}" autoplay playsinline muted></video>
    <div class="viewer-top viewer-ui"><button class="back-button" id="exit-focus" title="Voltar à grade (Esc)">${icon('back')} Voltar</button><span>${safe(person.name)} <span class="tile-live">AO VIVO</span></span></div>
    <div class="viewer-bottom viewer-ui"><div class="stream-switcher">${sharing.map(p => `<button data-focus-screen="${safe(p.id)}" class="stream-chip ${p.id === person.id ? 'selected' : ''}" aria-pressed="${p.id === person.id}">${avatar(p)}<span>${safe(p.name)}</span></button>`).join('')}</div>
    <div class="viewer-actions">${person.local ? '' : `<label class="stream-volume">Volume <input id="stream-volume" type="range" min="0" max="100" value="${volumes.get(person.id) ?? 100}" aria-label="Volume da transmissão"/></label>`}<button class="back-button" id="toggle-fit" title="Ajustar mantém toda a imagem; preencher pode cortar as bordas">${icon('expand', 16)} ${fitMode === 'contain' ? 'Preencher' : 'Ajustar'}</button></div></div>
  </section>`;
}
function revealViewer() {
  const viewer = document.querySelector('.focus-screen');
  if (!viewer) return;
  viewer.classList.add('controls-visible');
  clearTimeout(viewerTimer);
  viewerTimer = setTimeout(() => viewer.classList.remove('controls-visible'), 2500);
}
function sourceMarkup() {
  return `<div class="modal-backdrop"><section class="modal source-modal" role="dialog" aria-modal="true" aria-label="Compartilhar tela"><div class="modal-head"><h2>Compartilhar tela</h2><button class="close-button" id="close-source" aria-label="Fechar">${icon('close', 20)}</button></div><div class="source-toolbar"><div class="source-tabs">${['screen','window'].map(type => `<button data-source-filter="${type}" aria-pressed="${sourceFilter === type}">${type === 'screen' ? 'Monitores' : 'Janelas'}</button>`).join('')}</div><select id="share-quality" aria-label="Qualidade da transmissão">${Object.entries(qualityPresets).map(([key,p]) => `<option value="${key}" ${quality === key ? 'selected' : ''}>${p.label}</option>`).join('')}</select></div><div class="source-grid">${sources.map((s, i) => s.id.startsWith(`${sourceFilter}:`) ? `<button class="source-choice" data-source="${i}"><img src="${s.thumbnail}" alt=""/><span>${safe(s.name)}</span></button>` : '').join('')}</div></section></div>`;
}
function bind() {
  document.querySelector('#join')?.addEventListener('click', join);
  document.querySelector('#name')?.addEventListener('input', event => { profile.name = event.target.value; localStorage.setItem('call-profile', JSON.stringify(profile)); });
  document.querySelector('#name')?.addEventListener('keydown', event => { if (event.key === 'Enter') join(); });
  document.querySelector('#photo-button')?.addEventListener('click', () => document.querySelector('#photo-file').click());
  document.querySelector('#photo-file')?.addEventListener('change', selectPhoto);
  document.querySelector('#toggle-screen')?.addEventListener('click', chooseScreen);
  document.querySelector('#leave')?.addEventListener('click', () => leave());
  document.querySelector('#back-to-call')?.addEventListener('click', exitFocus);
  document.querySelector('#exit-focus')?.addEventListener('click', exitFocus);
  document.querySelector('.focus-screen')?.addEventListener('pointermove', revealViewer);
  document.querySelector('#toggle-fit')?.addEventListener('click', () => {
    fitMode = fitMode === 'contain' ? 'cover' : 'contain'; render();
  });
  document.querySelector('#stream-volume')?.addEventListener('input', event => {
    volumes.set(focusedScreenId, Number(event.target.value)); attachMedia();
  });
  document.querySelector('#share-quality')?.addEventListener('change', event => {
    quality = event.target.value; localStorage.setItem('screen-quality', JSON.stringify(quality));
  });
  document.querySelectorAll('[data-source-filter]').forEach(button => button.addEventListener('click', () => { sourceFilter = button.dataset.sourceFilter; render(); }));
  document.querySelectorAll('[data-focus-screen]').forEach(button => button.addEventListener('click', () => {
    focusedScreenId = button.dataset.focusScreen;
    render();
    window.desktop?.setFocusMode?.(true).catch(console.error);
  }));
  document.querySelector('#close-source')?.addEventListener('click', () => { choosingScreen = false; render(); });
  document.querySelectorAll('.source-choice').forEach(button => button.addEventListener('click', () => startScreen(sources[Number(button.dataset.source)])));
}
function exitFocus() {
  focusedScreenId = null;
  window.desktop?.setFocusMode?.(false).catch(console.error);
  render();
}
async function selectPhoto(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) return notify('Escolha uma imagem.');
  const image = new Image();
  image.src = URL.createObjectURL(file);
  try {
    await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const side = Math.min(image.width, image.height);
    ctx.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, 128, 128);
    profile.photo = canvas.toDataURL('image/jpeg', .72);
    localStorage.setItem('call-profile', JSON.stringify(profile)); render();
  } catch { notify('Não foi possível abrir essa imagem.'); }
  finally { URL.revokeObjectURL(image.src); }
}
async function join() {
  profile.name = (document.querySelector('#name')?.value || profile.name).trim().slice(0, 24);
  if (!profile.name) return notify('Digite seu nome para entrar.');
  if (!/^wss?:\/\//i.test(config.url)) return notify('Não foi possível entrar na sala.');
  if (/^ws:\/\//i.test(config.url) && !/^ws:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/?$/i.test(config.url)) return notify('Use wss:// para conectar com segurança pela internet.');
  localStorage.setItem('call-profile', JSON.stringify(profile));
  message = ''; connecting = true; render();
  try {
    socket = new WebSocket(config.url);
    socket.onopen = () => socket.send(JSON.stringify({ type: 'join', name: profile.name, photo: profile.photo.length <= 12000 ? profile.photo : '', key: config.key }));
    socket.onmessage = event => handleMessage(JSON.parse(event.data));
    socket.onclose = event => {
      if (connected || connecting) {
        const reason = event.reason || 'Não foi possível conectar ao servidor.';
        leave(reason);
      }
    };
    socket.onerror = () => { if (connecting) { message = 'Não foi possível entrar na sala.'; connecting = false; render(); } };
  } catch { connecting = false; message = 'Endereço do servidor inválido.'; render(); }
}
function handleMessage(data) {
  if (data.type === 'welcome') {
    myId = data.id; connecting = false; connected = true;
    for (const person of data.peers) peers.set(person.id, { profile: person, pc: null, streams: { audio: new MediaStream(), screen: new MediaStream() }, candidates: [] });
    render();
    playSound('join');
    requestPing(); pingTimer = setInterval(requestPing, 5000);
    for (const person of data.peers) makeOffer(person.id);
  } else if (data.type === 'pong') {
    // O ping continua sendo usado só para manter a conexão ativa; não precisa aparecer na interface.
  } else if (data.type === 'joined') {
    peers.set(data.peer.id, { profile: data.peer, pc: null, streams: { audio: new MediaStream(), screen: new MediaStream() }, candidates: [] }); render(); playSound('join'); notify(`${data.peer.name} entrou na sala`);
  } else if (data.type === 'left') {
    const peer = peers.get(data.id); peer?.pc?.close(); peers.delete(data.id); if (focusedScreenId === data.id) exitFocus(); else render(); playSound('leave');
  } else if (data.type === 'state') {
    const peer = peers.get(data.id); if (peer) { const screenChanged = peer.profile.screen !== data.screen; peer.profile.screen = !!data.screen; if (!data.screen && focusedScreenId === data.id) exitFocus(); else render(); if (screenChanged) playSound('screen'); }
  } else if (data.type === 'signal') {
    const peer = peers.get(data.from);
    if (peer) peer.signalQueue = (peer.signalQueue || Promise.resolve()).then(() => receiveSignal(data.from, data.signal)).catch(console.error);
  }
}
function send(data) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data)); }
function stateUpdate() { send({ type: 'state', screen: !!screenStream }); render(); }
function peerConnection(id, answering = false) {
  const peer = peers.get(id); if (!peer) return null;
  if (peer.pc) return peer.pc;
  const pc = new RTCPeerConnection(pcConfig); peer.pc = pc;
  if (!answering) {
    peer.senders = {
      screen: pc.addTransceiver(screenStream?.getVideoTracks()[0] || 'video', { direction: 'sendrecv', streams: screenStream ? [screenStream] : [] }).sender,
      audio: pc.addTransceiver(screenStream?.getAudioTracks()[0] || 'audio', { direction: 'sendrecv', streams: screenStream?.getAudioTracks().length ? [screenStream] : [] }).sender
    };
  }
  pc.onicecandidate = event => { if (event.candidate) send({ type: 'signal', to: id, signal: { type: 'candidate', candidate: event.candidate } }); };
  pc.ontrack = event => {
    const kind = event.track.kind === 'audio' ? 'audio' : 'screen';
    if (!peer.streams[kind].getTracks().some(track => track.id === event.track.id)) peer.streams[kind].addTrack(event.track);
    event.track.onunmute = () => attachMedia();
    event.track.onended = () => { peer.streams[kind].removeTrack(event.track); render(); };
    attachMedia();
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') { peer.restarts = 0; tuneAllSenders(); }
    if (pc.connectionState === 'failed') {
      if ((peer.restarts || 0) < 2) { peer.restarts = (peer.restarts || 0) + 1; pc.restartIce(); makeOffer(id); }
      else notify(`Não foi possível conectar à tela de ${peer.profile.name}.`);
    }
  };
  return pc;
}
async function makeOffer(id) {
  const peer = peers.get(id), pc = peerConnection(id); if (!pc || !peer) return;
  if (peer.offering || pc.signalingState !== 'stable') { peer.needsOffer = true; return; }
  peer.offering = true; peer.needsOffer = false;
  try { await pc.setLocalDescription(await pc.createOffer()); send({ type: 'signal', to: id, signal: { type: 'offer', sdp: pc.localDescription } }); }
  catch (error) { console.error('Oferta WebRTC:', error); }
  finally { peer.offering = false; }
}
async function receiveSignal(id, signal) {
  const peer = peers.get(id); if (!peer) return;
  try {
    if (signal.type === 'candidate') {
      if (peer.ignoreOffer) return;
      if (peer.pc?.remoteDescription) await peer.pc.addIceCandidate(signal.candidate);
      else peer.candidates.push(signal.candidate);
      return;
    }
    const pc = peerConnection(id, signal.type === 'offer'); if (!pc) return;
    if (signal.type === 'offer') {
      const collision = peer.offering || pc.signalingState !== 'stable';
      peer.ignoreOffer = collision && String(myId) < String(id);
      if (peer.ignoreOffer) return;
      if (pc.signalingState !== 'stable') await pc.setLocalDescription({ type: 'rollback' });
      await pc.setRemoteDescription(signal.sdp);
      if (!peer.senders) {
        const transceivers = pc.getTransceivers();
        peer.senders = { screen: transceivers[0].sender, audio: transceivers[1].sender };
        // Quem responde à primeira oferta também precisa poder mandar uma tela
        // depois. Sem isto, a chamada fica funcionando em apenas uma direção.
        for (const transceiver of transceivers.slice(0, 2)) transceiver.direction = 'sendrecv';
        for (const [kind, track] of [['screen', screenStream?.getVideoTracks()[0]], ['audio', screenStream?.getAudioTracks()[0]]]) {
          if (!track) continue;
          peer.senders[kind].setStreams(screenStream);
          await peer.senders[kind].replaceTrack(track);
          if (kind === 'screen') await tuneScreenSender(peer.senders[kind]);
        }
      }
      await pc.setLocalDescription(await pc.createAnswer());
      send({ type: 'signal', to: id, signal: { type: 'answer', sdp: pc.localDescription } });
    } else if (signal.type === 'answer') {
      if (pc.signalingState !== 'have-local-offer') return;
      await pc.setRemoteDescription(signal.sdp);
      peer.ignoreOffer = false;
    }
    for (const candidate of peer.candidates.splice(0)) await pc.addIceCandidate(candidate);
    if (peer.needsOffer && pc.signalingState === 'stable') makeOffer(id);
  } catch (error) { console.error('Sinalização WebRTC:', error.name, error.message); }
}
async function replace(kind, track) {
  await Promise.all([...peers.values()].map(async peer => {
    const sender = peer.senders?.[kind]; if (!sender) return;
    const transceiver = peer.pc?.getTransceivers().find(item => item.sender === sender);
    if (transceiver && transceiver.direction !== 'sendrecv') transceiver.direction = 'sendrecv';
    sender.setStreams(...(track && screenStream ? [screenStream] : []));
    await sender.replaceTrack(track || null);
    if (kind === 'screen' && track) await tuneScreenSender(sender);
  }).map(promise => promise.catch(console.error)));
}
async function tuneScreenSender(sender) {
  if (!sender.track) return;
  const preset = qualityPresets[quality];
  const parameters = sender.getParameters();
  if (!parameters.encodings?.length) parameters.encodings = [{}];
  // Bound total outgoing video to 16 Mbps instead of multiplying 8 Mbps by seven peers.
  const budget = Math.min(preset.bitrate, Math.floor(16_000_000 / Math.max(1, peers.size)));
  parameters.encodings[0] = { ...parameters.encodings[0], maxBitrate: budget, maxFramerate: preset.fps };
  parameters.degradationPreference = 'maintain-framerate';
  await sender.setParameters(parameters).catch(error => console.warn('Ajuste de qualidade:', error));
}
function tuneAllSenders() {
  return Promise.all([...peers.values()].map(peer => peer.senders?.screen ? tuneScreenSender(peer.senders.screen) : null));
}
async function chooseScreen() {
  if (captureBusy) return;
  if (screenStream) return stopScreen();
  try { sources = await window.desktop.sources(); choosingScreen = true; render(); }
  catch { notify('Não foi possível listar as telas.'); }
}
async function startScreen(source) {
  if (captureBusy || !source) return;
  captureBusy = true;
  choosingScreen = false; render();
  try {
    await window.desktop.selectSource(source.id);
    const preset = qualityPresets[quality];
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { width: { ideal: preset.width }, height: { ideal: preset.height }, frameRate: { ideal: preset.fps } }, audio: true });
    const videoTrack = screenStream.getVideoTracks()[0];
    // Para navegação, jogos e Alt+Tab, fluidez importa mais que preservar texto estático.
    videoTrack.contentHint = 'motion';
    await videoTrack.applyConstraints(captureConstraints()).catch(error => console.warn('Limite de captura:', error));
    videoTrack.onended = stopScreen;
    await replace('screen', videoTrack);
    await replace('audio', screenStream.getAudioTracks()[0] || null);
    await Promise.all([...peers.keys()].map(makeOffer));
    stateUpdate(); playSound('screen');
    if (!screenStream.getAudioTracks().length) notify('Tela iniciada sem áudio do computador.');
  } catch (error) {
    console.error('Compartilhamento de tela:', error);
    if (screenStream) {
      screenStream.getTracks().forEach(track => track.stop());
      screenStream = null;
      await Promise.all([replace('screen', null), replace('audio', null)]);
    }
    notify(`Não foi possível compartilhar: ${error.message || error.name || 'erro desconhecido'}`);
  } finally { captureBusy = false; }
}
async function stopScreen() {
  if (!screenStream) return;
  const old = screenStream; screenStream = null;
  if (focusedScreenId === myId) exitFocus();
  old.getTracks().forEach(track => { track.onended = null; track.stop(); });
  await Promise.all([replace('screen', null), replace('audio', null)]); stateUpdate(); playSound('screen');
}
function attachMedia() {
  for (const [id, peer] of peers) {
    document.querySelectorAll('.share-video').forEach(share => { if (share.dataset.owner === id) attachVideo(share, peer.streams.screen); });
    let audio = document.querySelector(`[data-audio="${id}"]`);
    if (!audio) { audio = document.createElement('audio'); audio.dataset.audio = id; audio.autoplay = true; document.body.append(audio); }
    if (audio.srcObject !== peer.streams.audio) audio.srcObject = peer.streams.audio;
    // O loopback captura o áudio do sistema; não tocar streams remotos durante a própria transmissão evita realimentação.
    audio.muted = !!screenStream || Boolean(focusedScreenId && focusedScreenId !== id);
    audio.volume = (volumes.get(id) ?? 100) / 100;
  }
  document.querySelectorAll('.share-video').forEach(share => { if (share.dataset.owner === myId) attachVideo(share, screenStream); });
}
function attachVideo(video, stream) {
  if (video.srcObject !== stream) video.srcObject = stream;
  const play = () => video.play().catch(() => {});
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) play();
  else video.onloadedmetadata = play;
}
function leave(reason = '') {
  if (connected && !reason) playSound('leave');
  connected = false; connecting = false; myId = null;
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = null;
  if (focusedScreenId) window.desktop?.setFocusMode?.(false).catch(console.error);
  focusedScreenId = null;
  if (socket) { socket.onclose = null; socket.close(); socket = null; }
  for (const peer of peers.values()) peer.pc?.close(); peers.clear();
  screenStream?.getTracks().forEach(track => track.stop());
  screenStream = null;
  document.querySelectorAll('audio[data-audio]').forEach(el => el.remove());
  message = reason; render();
}
window.addEventListener('keydown', event => { if (event.key === 'Escape' && focusedScreenId) { event.preventDefault(); exitFocus(); } });
window.addEventListener('beforeunload', () => { if (socket) socket.close(); });
window.desktop?.onLeaveFullscreen?.(() => { if (focusedScreenId) { focusedScreenId = null; render(); } });
render();
playSound('loading');
setTimeout(() => { loading = false; render(); }, 5000);
