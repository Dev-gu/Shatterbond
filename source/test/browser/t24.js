// Phone remote smooth clip: needs the desktop server running (go build in desktop/, then run it).
// The PC page simulates, renders the range into a video, and the phone page plays it locally.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../..'), OUT = process.env.OUT || '/tmp/sb-shots';
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const pc = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const logs = [];
  pc.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[pc ${m.type()}] ${m.text()}`); });
  pc.on('pageerror', e => logs.push(`[pc pageerror] ${e.message}`));
  await pc.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**', r => {
    const f = path.join(ROOT, 'node_modules/three', r.request().url().split('three@0.170.0/')[1]);
    fs.existsSync(f) ? r.fulfill({ body: fs.readFileSync(f), contentType: 'text/javascript' }) : r.fulfill({ status: 404, body: 'nf' });
  });
  await pc.addInitScript(() => { try { localStorage.setItem('shatterbond.perf', JSON.stringify({ preset: 'low' })); } catch (e) {} });
  await pc.goto('http://127.0.0.1:47231/');
  await pc.waitForFunction(() => window.SB && SB.SIM);
  await pc.evaluate(([id, n]) => { SB.fn.loadDemo(id); const w = SB.APP.scene.world.props; w.frameEnd = w.frameStart + n; SB.SIM.invalidate(); }, [process.env.DEMO || 'split', +(process.env.N || 90)]);
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true })).newPage();
  phone.on('console', m => { if (m.type() === 'error') logs.push(`[phone] ${m.text()}`); });
  await phone.goto('http://127.0.0.1:47232/');
  await phone.waitForTimeout(2500);
  await phone.click('#play');
  // no clip until the Smooth button is pressed, even once the sim is done
  for (let i = 0; i < 400; i++) { const j = JSON.parse(await phone.evaluate(() => fetch('/remote/state').then(r => r.text()))); if (j.cached >= j.end) break; await phone.waitForTimeout(500); }
  await phone.waitForTimeout(3000);
  const st0 = JSON.parse(await phone.evaluate(() => fetch('/remote/state').then(r => r.text())));
  console.log(st0.clip.state === 'none' ? 'PASS no auto clip' : 'FAIL auto clip ' + st0.clip.state);
  await phone.click('#smooth');
  const t0 = Date.now();
  let last = '';
  for (;;) {
    const st = await phone.evaluate(() => ({ stat: document.getElementById('stat').textContent, on: document.getElementById('clip').classList.contains('on'), t: document.getElementById('clip').currentTime, fr: document.getElementById('fr').textContent }));
    const line = `${st.stat} on=${st.on} fr=${st.fr}`;
    if (line !== last) { console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', line); last = line; }
    if (st.on && st.t > 0.3) break;
    if (Date.now() - t0 > 600000) { console.log('timeout'); break; }
    await phone.waitForTimeout(700);
  }
  const info = await phone.evaluate(async () => { const v = document.getElementById('clip'); const a = v.currentTime; await new Promise(r => setTimeout(r, 1000)); return { w: v.videoWidth, h: v.videoHeight, dur: v.duration, adv: v.currentTime - a, paused: v.paused }; });
  console.log('video', JSON.stringify(info));
  await phone.screenshot({ path: OUT + '/t24-phone.png' });
  // save the clip to the phone
  const dlP = phone.waitForEvent('download', { timeout: 20000 }).catch(() => null);
  await phone.click('#dl');
  const dl = await dlP;
  if (dl) { const fp = await dl.path(); console.log('download', dl.suggestedFilename(), fs.statSync(fp).size, 'bytes'); } else console.log('download FAIL (no download event)');
  // orbit on the phone: back to the live stream, then a fresh clip
  await phone.evaluate(() => fetch('/remote/cmd', { method: 'POST', body: JSON.stringify({ t: 'orbit', dx: 0.1, dy: 0 }) }));
  await phone.waitForTimeout(1500);
  console.log('pc', await pc.evaluate(() => JSON.stringify({ cam: SB.REMOTE ? SB.REMOTE.camMode : 'no REMOTE export', rec: !!SB.APP.recording })));
  console.log('state', (await phone.evaluate(() => fetch('/remote/state').then(r => r.text()))).slice(0, 300));
  await phone.waitForTimeout(3000);
  const st1 = JSON.parse(await phone.evaluate(() => fetch('/remote/state').then(r => r.text())));
  console.log(st1.clip.state !== 'making' ? 'PASS no clip after orbit' : 'FAIL clip restarted after orbit');
  console.log('after orbit', await phone.evaluate(() => document.getElementById('stat').textContent + ' on=' + document.getElementById('clip').classList.contains('on')));
  console.log(logs.filter(l => !/GPU stall|GL Driver|swiftshader/i.test(l)).join('\n') || 'no console errors');
  await browser.close();
})();
