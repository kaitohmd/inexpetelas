// Local integration test: two isolated renderers, real WebRTC and synthetic video.
// No screen, microphone, remote room or personal profile is accessed.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.whenReady().then(async () => {
  const windows = [];
  try {
    for (const id of ['a','b']) {
      const win = new BrowserWindow({ show: false, width: 1360, height: 768, webPreferences: { partition: `test-${id}`, backgroundThrottling: false, nodeIntegration: false, contextIsolation: true } });
      windows.push(win);
      win.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.log('renderer',id,message); });
      await win.loadFile(path.join(__dirname, '../index.html'));
      await win.webContents.executeJavaScript(`loading=false; connected=true; myId='${id}'; profile={name:'${id}',photo:''}; peers.clear(); peers.set('${id === 'a' ? 'b' : 'a'}', {profile:{id:'${id === 'a' ? 'b' : 'a'}',name:'peer',screen:false},streams:{audio:new MediaStream(),screen:new MediaStream()}, candidates:[]}); window.testSignals=[]; send=data=>window.testSignals.push(data); playSound=()=>{}; render();`);
    }
    const run = (i, code) => windows[i].webContents.executeJavaScript(code);
    async function pump(rounds = 15) {
      for (let n=0;n<rounds;n++) {
        for (const i of [0,1]) {
          const signals = await run(i, 'JSON.parse(JSON.stringify(window.testSignals.splice(0)))');
          for (const message of signals) {
            if (message.type === 'signal') await run(1-i, `receiveSignal('${i === 0 ? 'a' : 'b'}',${JSON.stringify(message.signal)})`);
          }
        }
        await new Promise(resolve=>setTimeout(resolve,100));
      }
    }
    await run(0, "makeOffer('b')");
    console.log('offer',await run(0, "JSON.stringify({signals:window.testSignals.map(m=>m.type),state:peers.get('b').pc.signalingState})"));
    await pump();
    for (const i of [0,1]) {
      await run(i, `window.canvas=document.createElement('canvas'); canvas.width=1280; canvas.height=720; window.paint=setInterval(()=>{const ctx=canvas.getContext('2d'); ctx.fillStyle='${i ? '#3366ff' : '#ee3344'}'; ctx.fillRect(0,0,1280,720); ctx.fillStyle='white'; ctx.fillRect(Date.now()%1100,40,120,120);},16); screenStream=canvas.captureStream(60); (async()=>{await replace('screen',screenStream.getVideoTracks()[0]);await makeOffer('${i === 0 ? 'b' : 'a'}');})()`);
    }
    await pump(30);
    for (const i of [0,1]) {
      await run(i, `peers.get('${i === 0 ? 'b' : 'a'}').profile.screen=true; render();`);
    }
    await pump(10);
    for (const i of [0,1]) {
      const stats = await run(i, `(async()=>{const p=peers.get('${i === 0 ? 'b' : 'a'}'); const stats=await p.pc.getStats();return {connection:p.pc.connectionState, directions:p.pc.getTransceivers().map(t=>t.currentDirection), frames:[...stats.values()].filter(s=>s.type==='inbound-rtp'&&s.kind==='video').map(s=>s.framesDecoded), dimensions:[...document.querySelectorAll('video')].map(v=>[v.videoWidth,v.videoHeight])};})()`);
      if (stats.connection !== 'connected' || !stats.frames.some(n=>n>0) || !stats.dimensions.every(([w,h])=>w>0&&h>0)) throw Error(JSON.stringify(stats));
      const retained = await run(i, `window.oldVideo=document.querySelector('video'); render(); oldVideo===document.querySelector('video')`);
      if (!retained) throw Error('Video decoder reset on render');
      console.log('PASS renderer',i,JSON.stringify(stats));
    }
    // Stop and restart without losing the negotiated receive direction.
    await run(0, "stopScreen()"); await pump(5);
    await run(0, "screenStream=canvas.captureStream(60); (async()=>{await replace('screen',screenStream.getVideoTracks()[0]);await makeOffer('b')})()");
    await pump(15);
    const restarted = await run(1, "(async()=>[... (await peers.get('a').pc.getStats()).values()].filter(s=>s.type==='inbound-rtp'&&s.kind==='video').some(s=>s.framesDecoded>30))()");
    if (!restarted) throw Error('Restart failed');
    console.log('PASS restart and simultaneous sharing');
    app.exit(0);
  } catch(error) { console.error(error); app.exit(1); }
});
