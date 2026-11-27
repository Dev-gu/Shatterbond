// Phone editing: select, add, settings, move/turn/size, keyframe, undo, delete from the phone page against the
// real desktop server (go build in desktop/, run with SHATTERBOND_REMOTE_ADDR=127.0.0.1:47232).
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../..'), OUT = process.env.OUT || '/tmp/sb-shots';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0; const check = (name, ok, extra) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' ' + extra : '')); if (!ok) fails++; };
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const pc = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const logs = [];
  pc.on('console', m => { if (m.type() === 'error') logs.push(`[pc] ${m.text()}`); });
  pc.on('pageerror', e => logs.push(`[pc pageerror] ${e.message}`));
  await pc.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**', r => {
    const f = path.join(ROOT, 'node_modules/three', r.request().url().split('three@0.170.0/')[1]);
    fs.existsSync(f) ? r.fulfill({ body: fs.readFileSync(f), contentType: 'text/javascript' }) : r.fulfill({ status: 404, body: 'nf' });
  });
  await pc.addInitScript(() => { try { localStorage.setItem('shatterbond.perf', JSON.stringify({ preset: 'low' })); } catch (e) {} });
  await pc.goto('http://127.0.0.1:47231/');
  await pc.waitForFunction(() => window.SB && SB.SIM);
  await pc.evaluate(() => SB.fn.loadDemo('hammer'));
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
  phone.on('console', m => { if (m.type() === 'error') logs.push(`[phone] ${m.text()}`); });
  phone.on('pageerror', e => logs.push(`[phone pageerror] ${e.message}`));
  phone.on('dialog', d => d.accept(d.type() === 'prompt' ? 'Renamed box' : undefined));
  await phone.goto('http://127.0.0.1:47232/');
  await phone.waitForFunction(() => document.getElementById('scene').textContent !== 'Shatterbond' && !/Waiting/.test(document.getElementById('scene').textContent), null, { timeout: 30000 });
  const P = (fn, a) => pc.evaluate(fn, a);
  const waitPC = async (fn, a, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await pc.evaluate(fn, a)) return true; await sleep(250); } return false; };

  await phone.click('#edit');
  check('edit mode on PC', await waitPC(() => SB.REMOTE && SB.REMOTE.edit));
  // objects list -> select the humanoid
  await phone.click('#e-objs'); await sleep(300);
  const names = await phone.$$eval('#ebody .olist button span', a => a.map(x => x.textContent));
  console.log('objects', names.join(', '));
  const hid = await P(() => SB.APP.scene.objects.find(o => o.type === 'humanoid').id);
  await phone.click('#ebody .olist button:has-text("Humanoid")');
  check('select from list', await waitPC((id) => SB.APP.active === id, hid));
  // deselect by tapping empty sky, then tap the body after framing it
  await sleep(700);
  await phone.tap('#touch', { position: { x: 195, y: 60 } });
  check('tap empty deselects', await waitPC(() => SB.APP.active === null));
  // double tap on the body frames it (and selects it); then a single tap in the middle selects it again
  const sc = await P((id) => { const o = SB.APP.scene.objects.find(q => q.id === id); const b = SB.fn.selectionBox(o); const c = b.getCenter(new SB.R.camera.position.constructor()); const cam = SB.REMOTE.phoneCam(); c.project(cam); return [(c.x + 1) / 2, (1 - c.y) / 2]; }, hid);
  console.log('body on screen at', sc.map(v => v.toFixed(2)).join(','));
  await phone.dblclick('#touch', { position: { x: 390 * sc[0], y: 844 * sc[1] } });
  check('double tap frames body', await waitPC((id) => SB.REMOTE.camMode === 'free' && SB.APP.active === id, hid));
  await sleep(800);
  await P(() => SB.fn.select([]));
  await sleep(800);
  console.log('dbg', await P(() => { const R2 = SB.REMOTE; const h = SB.REMOTE.rayAt(0.5, 0.5); return JSON.stringify({ mode: R2.camMode, cam: R2.cam && R2.cam.position.toArray().map(v => +v.toFixed(2)), tg: R2.target && R2.target.toArray().map(v => +v.toFixed(2)), o: h.origin.toArray().map(v => +v.toFixed(2)), d: h.direction.toArray().map(v => +v.toFixed(2)), hit: (SB.REMOTE.applyEdit({ t: 'pick', x: 0.5, y: 0.5 }), SB.APP.active) }); })); await P(() => SB.fn.select([]));
  await phone.tap('#touch', { position: { x: 195, y: 422 } });
  check('tap on body selects it', await waitPC((id) => SB.APP.active === id, hid), await P(() => String(SB.APP.active)));
  // add a cube
  await phone.click('#e-add'); await sleep(300);
  const n0 = await P(() => SB.APP.scene.objects.length);
  await phone.click('#ebody .grid button:text-is("Cube")');
  check('add cube', await waitPC((n) => SB.APP.scene.objects.length === n + 1 && SB.APP.scene.objects.find(o => o.id === SB.APP.active).type === 'cube', n0));
  const cid = await P(() => SB.APP.active);
  // settings: change a slider and a color
  await sleep(700);
  await phone.click('#e-props'); await sleep(500);
  const groups = await phone.$$eval('#ebody .grp', a => a.map(x => x.textContent));
  console.log('settings groups', groups.join(' | '));
  await phone.screenshot({ path: OUT + '/t26-settings.png' });
  const fld = await phone.$('#ebody .fld:has(input[type=range])');
  const fk = await fld.getAttribute('data-k');
  await fld.$eval('input[type=range]', (r) => { r.value = String(+r.min + (+r.max - +r.min) * 0.37); r.dispatchEvent(new Event('input', { bubbles: true })); });
  const want = await fld.$eval('input[type=range]', r => +r.value);
  check('slider sets ' + fk, await waitPC(([id, k, v]) => Math.abs(SB.APP.scene.objects.find(o => o.id === id).props[k] - v) < 1e-6, [cid, fk, want]));
  await phone.$eval('#ebody .fld[data-k="color"] input[type=color]', (c) => { c.value = '#ff3300'; c.dispatchEvent(new Event('input', { bubbles: true })); });
  check('color', await waitPC((id) => SB.APP.scene.objects.find(o => o.id === id).props.color === '#ff3300', cid));
  await phone.click('#ex');
  // move tool: drag with one finger
  await phone.click('#tools button[data-t="move"]');
  const p0 = await P((id) => SB.APP.scene.objects.find(o => o.id === id).props.position.slice(), cid);
  await phone.mouse.move(195, 420); await phone.mouse.down(); for (let i = 1; i <= 10; i++) { await phone.mouse.move(195 + i * 8, 420 + i * 3); await sleep(40); } await phone.mouse.up();
  check('move', await waitPC(([id, p]) => { const q = SB.APP.scene.objects.find(o => o.id === id).props.position; return Math.hypot(q[0] - p[0], q[2] - p[2]) > 0.05 && Math.abs(q[1] - p[1]) < 1e-6; }, [cid, p0]), JSON.stringify(await P((id) => SB.APP.scene.objects.find(o => o.id === id).props.position, cid)));
  // turn and size
  await phone.click('#tools button[data-t="turn"]');
  await phone.mouse.move(150, 400); await phone.mouse.down(); for (let i = 1; i <= 8; i++) { await phone.mouse.move(150 + i * 10, 400); await sleep(40); } await phone.mouse.up();
  check('turn', await waitPC((id) => Math.abs(SB.APP.scene.objects.find(o => o.id === id).props.rotation[1]) > 5, cid));
  await phone.click('#tools button[data-t="size"]');
  const s0 = await P((id) => SB.APP.scene.objects.find(o => o.id === id).props.scale[0], cid);
  await phone.mouse.move(200, 500); await phone.mouse.down(); for (let i = 1; i <= 8; i++) { await phone.mouse.move(200, 500 - i * 10); await sleep(40); } await phone.mouse.up();
  check('size', await waitPC(([id, s]) => SB.APP.scene.objects.find(o => o.id === id).props.scale[0] > s * 1.05, [cid, s0]));
  await phone.click('#tools button[data-t="view"]');
  // keyframe, undo, rename, delete
  await phone.click('#e-key');
  check('keyframe', await waitPC((id) => { const o = SB.APP.scene.objects.find(o => o.id === id); return o.anim && o.anim['position.0'] && o.anim['position.0'].length > 0; }, cid));
  await sleep(500);
  await phone.click('#e-undo');
  check('undo', await waitPC((id) => { const o = SB.APP.scene.objects.find(o => o.id === id); return !(o.anim && o.anim['position.0'] && o.anim['position.0'].length); }, cid));
  await phone.click('#e-more'); await sleep(300);
  await phone.click('#ebody .menu button:text-is("Rename")');
  check('rename', await waitPC((id) => SB.APP.scene.objects.find(o => o.id === id).name === 'Renamed box', cid));
  await sleep(600);
  await phone.click('#e-more'); await sleep(300);
  await phone.click('#ebody .menu button:text-is("Delete")');
  check('delete', await waitPC((id) => !SB.APP.scene.objects.find(o => o.id === id), cid));
  // world settings: change the end frame
  await phone.click('#e-more'); await sleep(300);
  await phone.click('#ebody .menu button:has-text("World settings")');
  for (let i = 0; i < 30 && await phone.$eval('#etitle', e => e.textContent) !== 'World'; i++) await sleep(300);
  const wt = await phone.$eval('#etitle', e => e.textContent);
  check('world sheet', wt === 'World', wt + ' ' + await P(() => JSON.stringify({ pw: SB.REMOTE.propsWorld, act: SB.APP.active, pid: (SB.REMOTE.editState().props || {}).id })) + ' phone:' + await phone.evaluate(() => JSON.stringify(window.__ed())));
  await phone.$eval('#ebody .fld[data-k="gravity"] input[type=range]', (r) => { r.value = '-5'; r.dispatchEvent(new Event('input', { bubbles: true })); });
  check('world gravity', await waitPC(() => SB.APP.scene.world.props.gravity === -5));
  await phone.screenshot({ path: OUT + '/t26-world.png' });
  await phone.click('#ex');
  // save the scene to the PC's library from the phone; it shows up in the phone's Scenes list
  await phone.click('#e-more'); await sleep(300);
  await phone.click('#ebody .menu button:text-is("Save scene to library")');
  check('save scene', await waitPC(() => JSON.parse(localStorage.getItem('shatterbond.library') || '[]').length > 0));
  await sleep(4500);
  await phone.click('#conn'); await sleep(400);
  const libn = await phone.$$eval('#list .grp', a => a.map(x => x.textContent));
  check('library in Scenes list', libn.includes('Your scenes'), libn.join('|'));
  await phone.screenshot({ path: OUT + '/t26-scenes.png' });
  await phone.tap('#sheet', { position: { x: 195, y: 40 } });
  // a long press opens the object menu
  await phone.click('#e-objs'); await sleep(300); await phone.click('#ebody .olist button:has-text("Humanoid")'); await sleep(900);
  await phone.screenshot({ path: OUT + '/t26-select.png' });
  console.log(logs.join('\n') || 'no console errors');
  console.log(fails ? fails + ' FAILED' : 'ALL PASS');
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
