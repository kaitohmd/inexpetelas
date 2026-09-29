const root = document.querySelector('#app');
const icons = {
  screen: '<rect x="2" y="3" width="20" height="15" rx="2"/><path d="M8 22h8m-4-4v4m0-15v7m-3-3 3 3 3-3"/>',
  volume: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7m3-10a9 9 0 0 1 0 13"/>',
  muted: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 5 6m0-6-5 6"/>',
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
let appVersion = '';
const bundledConfig = { version: 3, url: 'wss://inexpetelas.squareweb.app', key: '698df1b771e65277936172ef0e1738b001193440dba5e4c1' };
let config = saved('call-config', bundledConfig);
if (config.version !== bundledConfig.version) {
  config = bundledConfig;
  localStorage.setItem('call-config', JSON.stringify(config));
}
let socket, myId, screenStream, publisherPc, receiverPc, receiverQueue = Promise.resolve(), joinTimeout = null;
const sfuMidOwners = new Map();
let connecting = false, connected = false, choosingScreen = false;
let message = '', peers = new Map();
let focusedScreenId = null, pingTimer = null;
let loading = true;
let captureBusy = false, sourceFilter = 'screen', fitMode = 'contain';
let cpuLimited = false, cpuPressureSamples = 0, healthySamples = 0, statsTimer = null, statsBusy = false;
const qualityPresets = screenQuality.presets;
let quality = saved('screen-quality', 'smooth');
if (!qualityPresets[quality]) quality = 'smooth';
const volumes = new Map();
const mutedScreens = new Set();
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
const pcConfig = { iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] };
function sfuBase() { return config.url.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:').replace(/\/$/, ''); }
async function sfuRequest(path, method = 'POST', payload = {}) {
  const response = await fetch(`${sfuBase()}${path}`, {
    method,
    headers: { authorization: `Bearer ${config.key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ...payload, memberId: myId })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível conectar ao servidor de mídia.');
  return data;
}
function waitIceGathering(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { if (pc.iceGatheringState === 'complete') { pc.removeEventListener('icegatheringstatechange', done); resolve(); } };
    pc.addEventListener('icegatheringstatechange', done);
    setTimeout(resolve, 8000);
  });
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
  root.innerHTML = `${loading ? loadingMarkup() : connected ? callMarkup() : welcomeMarkup()}${updateMarkup()}`;
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
let updateView = { status: 'idle' };
function updateMarkup() {
  if (updateView.status === 'idle') return '';
  if (updateView.status === 'downloaded') return `<div class="update-overlay"><section class="update-card"><div class="update-mark">${icon('screen',32)}</div><strong>Atualização pronta</strong><button class="join-button" id="install-update">Reiniciar e atualizar</button></section></div>`;
  if (updateView.status === 'error') return `<div class="update-overlay"><section class="update-card"><div class="update-mark">${icon('screen',32)}</div><strong>Não consegui verificar atualizações</strong><span class="update-error-detail">O app vai abrir normalmente. Confira sua conexão e tente de novo mais tarde.</span><button class="join-button" id="dismiss-update">Continuar</button></section></div>`;
  const checking = updateView.status === 'checking';
  const percent = Math.max(0, Math.min(100, updateView.percent || 0));
  return `<div class="update-overlay"><section class="update-card"><div class="update-mark ${checking ? 'is-checking' : ''}">${icon('screen',32)}</div><strong>${checking ? 'Verificando atualizações' : 'Atualizando'}${checking ? '…' : ` · ${percent}%`}</strong>${checking ? '' : `<div class="update-progress"><span style="width:${percent}%"></span></div>`}</section></div>`;
}
function loadingMarkup() {
  return `<div class="loading-screen" role="status" aria-label="Carregando aplicativo"><div class="loading-mark">${icon('screen', 48)}</div><div class="loading-brand">INEXPETELAS</div><div class="loading-progress"><span></span></div></div>`;
}
function welcomeMarkup() {
  return `<div class="welcome-shell">
    <header class="welcome-top"><div class="brand">${icon('screen', 22)} <span>INEXPETELAS</span></div></header>
    <main class="welcome-main"><section class="entry-card"><div class="profile-row"><button class="photo-button" id="photo-button" title="Escolher foto">${avatar(profile)}<span class="photo-edit">${icon('pencil', 13)}</span></button><div class="name-wrap"><label for="name">Seu nome</label><input id="name" maxlength="24" placeholder="Como quer aparecer?" value="${safe(profile.name)}" autocomplete="off"/></div></div><input id="photo-file" type="file" accept="image/*" hidden/><button class="join-button" id="join" ${connecting ? 'disabled' : ''}>${connecting ? 'Entrando...' : 'Entrar'} ${icon('arrow', 17)}</button><div class="app-version">INEXPETELAS <span>v${safe(appVersion || '…')}</span></div>${message ? `<div class="inline-message">${safe(message)}</div>` : ''}</section></main></div>`;
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
    <div class="viewer-actions">${person.local ? '' : `<label class="stream-volume">Volume <input id="stream-volume" type="range" min="0" max="100" value="${volumes.get(person.id) ?? 100}" aria-label="Volume da transmissão"/></label><button class="back-button" id="toggle-screen-audio" aria-pressed="${mutedScreens.has(person.id)}" title="${mutedScreens.has(person.id) ? 'Ativar áudio desta tela' : 'Silenciar áudio desta tela'}">${icon(mutedScreens.has(person.id) ? 'muted' : 'volume', 16)}</button>`}<button class="back-button" id="toggle-fit" title="Ajustar mantém toda a imagem; preencher pode cortar as bordas">${icon('expand', 16)} ${fitMode === 'contain' ? 'Preencher' : 'Ajustar'}</button></div></div>
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
  document.querySelector('#install-update')?.addEventListener('click', () => window.desktop?.installUpdate?.());
  document.querySelector('#dismiss-update')?.addEventListener('click', () => { updateView = { status: 'idle' }; render(); });
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
  document.querySelector('#toggle-screen-audio')?.addEventListener('click', () => {
    if (!focusedScreenId || focusedScreenId === myId) return;
    if (mutedScreens.has(focusedScreenId)) mutedScreens.delete(focusedScreenId);
    else mutedScreens.add(focusedScreenId);
    render();
  });
  document.querySelector('#share-quality')?.addEventListener('change', event => {
    quality = event.target.value; localStorage.setItem('screen-quality', JSON.stringify(quality));
    cpuLimited = false; cpuPressureSamples = 0; healthySamples = 0;
    tuneCaptureProfile();
  });
  document.querySelectorAll('[data-source-filter]').forEach(button => button.addEventListener('click', () => { sourceFilter = button.dataset.sourceFilter; render(); }));
  document.querySelectorAll('[data-focus-screen]').forEach(button => button.addEventListener('click', () => {
    focusedScreenId = button.dataset.focusScreen;
    send({ type: 'view', screenId: focusedScreenId === myId ? null : focusedScreenId });
    tuneAllSenders();
    tuneCaptureProfile();
    render();
    window.desktop?.setFocusMode?.(true).catch(console.error);
  }));
  document.querySelector('#close-source')?.addEventListener('click', () => { choosingScreen = false; render(); });
  document.querySelectorAll('.source-choice').forEach(button => button.addEventListener('click', () => startScreen(sources[Number(button.dataset.source)])));
}
function exitFocus() {
  focusedScreenId = null;
  send({ type: 'view', screenId: null });
  tuneAllSenders();
  tuneCaptureProfile();
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
    joinTimeout = setTimeout(() => {
      if (!connecting) return;
      message = 'O servidor demorou para responder. Confira sua internet e tente novamente.';
      connecting = false; render(); socket?.close();
    }, 15000);
    socket.onopen = () => socket.send(JSON.stringify({ type: 'join', name: profile.name, photo: profile.photo.length <= 12000 ? profile.photo : '', key: config.key }));
    socket.onmessage = event => handleMessage(JSON.parse(event.data));
    socket.onclose = event => {
      if (joinTimeout) clearTimeout(joinTimeout);
      joinTimeout = null;
      if (connected || connecting) {
        const knownReasons = { 4001: 'O servidor demorou para responder. Tente novamente.', 4002: 'Digite seu nome para entrar.', 4003: 'Código da sala incorreto.', 4008: 'A sala já está cheia.' };
        const reason = knownReasons[event.code] || event.reason || 'Não foi possível conectar à sala. Confira sua internet.';
        leave(reason);
      }
    };
    socket.onerror = () => { if (connecting) { message = 'Falha de conexão. Verificando o motivo…'; render(); } };
  } catch { connecting = false; message = 'Endereço do servidor inválido.'; render(); }
}
function handleMessage(data) {
  if (data.type === 'welcome') {
    if (joinTimeout) clearTimeout(joinTimeout);
    joinTimeout = null;
    myId = data.id; connecting = false; connected = true;
    for (const person of data.peers) peers.set(person.id, { profile: person, streams: { audio: new MediaStream(), screen: new MediaStream() } });
    render();
    playSound('join');
    requestPing(); pingTimer = setInterval(requestPing, 5000);
    refreshSubscriptions();
  } else if (data.type === 'pong') {
    // O ping continua sendo usado só para manter a conexão ativa; não precisa aparecer na interface.
  } else if (data.type === 'joined') {
    peers.set(data.peer.id, { profile: data.peer, streams: { audio: new MediaStream(), screen: new MediaStream() } }); render(); tuneCaptureProfile(); playSound('join'); notify(`${data.peer.name} entrou na sala`);
  } else if (data.type === 'left') {
    peers.delete(data.id); if (focusedScreenId === data.id) exitFocus(); else { render(); tuneCaptureProfile(); } refreshSubscriptions(); playSound('leave');
  } else if (data.type === 'state') {
    const peer = peers.get(data.id); if (peer) { const screenChanged = peer.profile.screen !== data.screen; peer.profile.screen = !!data.screen; if (!data.screen && focusedScreenId === data.id) exitFocus(); else { render(); tuneCaptureProfile(); } if (screenChanged) { refreshSubscriptions(); playSound('screen'); } }
  } else if (data.type === 'view') {
    const peer = peers.get(data.id);
    if (peer) {
      peer.profile.watching = data.screenId;
      tuneCaptureProfile();
    }
  }
}
function send(data) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data)); }
function stateUpdate() { window.desktop?.setSharing?.(!!screenStream); send({ type: 'state', screen: !!screenStream }); render(); }
async function refreshSubscriptions() {
  if (!connected || !myId) return;
  receiverQueue = receiverQueue.then(async () => {
    const publications = [...peers.entries()].filter(([, peer]) => peer.profile.screen).map(([memberId]) => ({ memberId }));
    receiverPc?.close(); receiverPc = null; sfuMidOwners.clear();
    for (const peer of peers.values()) peer.streams.screen = new MediaStream();
    if (!publications.length) { attachMedia(); render(); return; }
    const session = await sfuRequest('/sfu/session', 'POST', { role: 'subscriber' });
    const pc = new RTCPeerConnection(pcConfig); receiverPc = pc;
    pc.ontrack = event => {
      const ownerId = sfuMidOwners.get(event.transceiver.mid);
      const peer = peers.get(ownerId);
      if (!peer) return;
      if (!peer.streams.screen.getTracks().some(track => track.id === event.track.id)) peer.streams.screen.addTrack(event.track);
      event.track.onunmute = attachMedia;
      event.track.onended = () => { peer.streams.screen.removeTrack(event.track); render(); };
      attachMedia();
    };
    const response = await sfuRequest('/sfu/subscribe', 'POST', { publications });
    for (const track of response.tracks || []) if (track.mid && track.ownerId) sfuMidOwners.set(String(track.mid), track.ownerId);
    if (!response.sessionDescription) { pc.close(); receiverPc = null; return; }
    await pc.setRemoteDescription(response.sessionDescription);
    await pc.setLocalDescription(await pc.createAnswer());
    await waitIceGathering(pc);
    await sfuRequest('/sfu/renegotiate', 'PUT', { sessionDescription: pc.localDescription });
    attachMedia(); render();
  }).catch(error => { console.error('Assinatura SFU:', error); notify('Não foi possível abrir a transmissão.'); });
  return receiverQueue;
}
async function replace(kind, track) {
  if (kind === 'screen' && publisherPc) {
    const sender = publisherPc.getSenders().find(item => item.track?.kind === 'video');
    if (sender) await sender.replaceTrack(track || null).catch(console.error);
  }
}
async function tuneScreenSender(sender, focused) {
  if (!sender.track) return;
  const profile = screenQuality.outgoingProfile(focused, quality, peers.size, cpuLimited);
  const parameters = sender.getParameters();
  if (!parameters.encodings?.length) parameters.encodings = [{}];
  parameters.encodings[0] = { ...parameters.encodings[0], maxBitrate: profile.maxBitrate, maxFramerate: profile.maxFramerate, scaleResolutionDownBy: profile.scaleResolutionDownBy, priority: profile.priority };
  // Balanced adaptation lets Chromium trade resolution/FPS if the game and encoder compete.
  parameters.degradationPreference = 'balanced';
  await sender.setParameters(parameters).catch(error => console.warn('Ajuste de qualidade:', error));
}
function tuneAllSenders() {
  if (!publisherPc) return Promise.resolve();
  const sender = publisherPc.getSenders().find(item => item.track?.kind === 'video');
  const hasFocusedViewer = focusedScreenId === myId || [...peers.values()].some(peer => peer.profile.watching === myId);
  return sender ? tuneScreenSender(sender, hasFocusedViewer) : Promise.resolve();
}
function tuneCaptureProfile() {
  if (!screenStream) return;
  // Keep the original capture track capable of the selected quality. Chromium
  // does not reliably restore a track after applying a lower max constraint.
  tuneAllSenders();
}
async function checkEncoderPressure() {
  if (!screenStream || statsBusy) return;
  statsBusy = true;
  try {
    let limitedByCpu = false;
    {
      const sender = publisherPc?.getSenders().find(item => item.track?.kind === 'video');
      if (!sender?.track) return;
      const stats = await sender.getStats();
      for (const report of stats.values()) {
        if (report.type === 'outbound-rtp' && (report.kind === 'video' || report.mediaType === 'video') && report.qualityLimitationReason === 'cpu') {
          limitedByCpu = true;
          break;
        }
      }
    }
    if (limitedByCpu) {
      cpuPressureSamples += 1; healthySamples = 0;
      if (!cpuLimited && cpuPressureSamples >= 2) {
        cpuLimited = true;
        notify('Reduzi a carga da transmissão para ajudar o jogo a manter FPS.');
        tuneCaptureProfile();
      }
    } else {
      cpuPressureSamples = 0;
      if (cpuLimited && ++healthySamples >= 20) {
        cpuLimited = false; healthySamples = 0;
        notify('A carga melhorou; restaurei a qualidade escolhida.');
        tuneCaptureProfile();
      }
    }
  } catch (error) { console.debug('Leitura de carga do codificador indisponível:', error); }
  finally { statsBusy = false; }
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
    const capture = screenQuality.captureProfile(false, quality);
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { width: { ideal: capture.width, max: capture.width }, height: { ideal: capture.height, max: capture.height }, frameRate: { ideal: capture.frameRate, max: capture.frameRate } }, audio: false });
    const videoTrack = screenStream.getVideoTracks()[0];
    // Para navegação, jogos e Alt+Tab, fluidez importa mais que preservar texto estático.
    videoTrack.contentHint = 'motion';
    await videoTrack.applyConstraints({ width: { ideal: capture.width, max: capture.width }, height: { ideal: capture.height, max: capture.height }, frameRate: { ideal: capture.frameRate, max: capture.frameRate } }).catch(error => console.warn('Limite de captura:', error));
    videoTrack.onended = stopScreen;
    const session = await sfuRequest('/sfu/session', 'POST', { role: 'publisher' });
    const pc = new RTCPeerConnection(pcConfig); publisherPc = pc;
    const transceiver = pc.addTransceiver(videoTrack, { direction: 'sendonly', streams: [screenStream] });
    await pc.setLocalDescription(await pc.createOffer());
    await waitIceGathering(pc);
    const publication = await sfuRequest('/sfu/publish', 'POST', {
      sessionDescription: pc.localDescription,
      mid: transceiver.mid
    });
    await pc.setRemoteDescription(publication.sessionDescription);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') notify('Conexão com o servidor de mídia interrompida.');
    };
    tuneCaptureProfile();
    if (statsTimer) clearInterval(statsTimer);
    statsTimer = setInterval(checkEncoderPressure, 2500);
    stateUpdate(); playSound('screen');
    await refreshSubscriptions();
  } catch (error) {
    console.error('Compartilhamento de tela:', error);
    if (screenStream) {
      screenStream.getTracks().forEach(track => track.stop());
      screenStream = null;
      await Promise.all([replace('screen', null), replace('audio', null)]);
    }
    publisherPc?.close(); publisherPc = null;
    notify(`Não foi possível compartilhar: ${error.message || error.name || 'erro desconhecido'}`);
  } finally { captureBusy = false; }
}
async function stopScreen() {
  if (!screenStream) return;
  if (statsTimer) clearInterval(statsTimer);
  statsTimer = null; cpuLimited = false; cpuPressureSamples = 0; healthySamples = 0;
  const old = screenStream; screenStream = null;
  if (focusedScreenId === myId) exitFocus();
  old.getTracks().forEach(track => { track.onended = null; track.stop(); });
  publisherPc?.close(); publisherPc = null;
  await Promise.all([replace('screen', null), replace('audio', null)]); stateUpdate(); await refreshSubscriptions(); playSound('screen');
}
function attachMedia() {
  for (const [id, peer] of peers) {
    document.querySelectorAll('.share-video').forEach(share => { if (share.dataset.owner === id) attachVideo(share, peer.streams.screen); });
    let audio = document.querySelector(`[data-audio="${id}"]`);
    if (!audio) { audio = document.createElement('audio'); audio.dataset.audio = id; audio.autoplay = true; document.body.append(audio); }
    if (audio.srcObject !== peer.streams.audio) audio.srcObject = peer.streams.audio;
    // O loopback captura o áudio do sistema; não tocar streams remotos durante a própria transmissão evita realimentação.
    audio.muted = !!screenStream || mutedScreens.has(id) || Boolean(focusedScreenId && focusedScreenId !== id);
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
  if (joinTimeout) clearTimeout(joinTimeout);
  joinTimeout = null;
  if (connected && !reason) playSound('leave');
  connected = false; connecting = false; myId = null;
  if (pingTimer) clearInterval(pingTimer);
  if (statsTimer) clearInterval(statsTimer);
  pingTimer = null;
  statsTimer = null; cpuLimited = false; cpuPressureSamples = 0; healthySamples = 0;
  if (focusedScreenId) window.desktop?.setFocusMode?.(false).catch(console.error);
  focusedScreenId = null;
  if (socket) { socket.onclose = null; socket.close(); socket = null; }
  publisherPc?.close(); publisherPc = null; receiverPc?.close(); receiverPc = null; peers.clear();
  screenStream?.getTracks().forEach(track => track.stop());
  screenStream = null;
  document.querySelectorAll('audio[data-audio]').forEach(el => el.remove());
  message = reason; render();
}
window.addEventListener('keydown', event => { if (event.key === 'Escape' && focusedScreenId) { event.preventDefault(); exitFocus(); } });
window.addEventListener('beforeunload', () => { if (socket) socket.close(); });
window.desktop?.onLeaveFullscreen?.(() => { if (focusedScreenId) { focusedScreenId = null; render(); } });
window.desktop?.onUpdateState?.(state => { updateView = state; render(); });
window.desktop?.getVersion?.().then(version => { appVersion = version; if (!connected) render(); }).catch(() => {});
render();
playSound('loading');
setTimeout(() => { loading = false; render(); }, 5000);
