// cameras: look through any camera, cycle, follow shots, render "View from", follow an object (look / move / chase)
const { setup, OUT } = require('./run.js');
(async () => {
  const { browser, page, logs } = await setup();
  let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
  await page.waitForTimeout(2500);
  await page.evaluate(() => SB.fn.loadDemo('walker'));
  await page.waitForTimeout(1500);
  const camName = () => page.evaluate(() => { const o = SB.fn.sceneCam(); return o && o.name; });
  const camPos = () => page.evaluate(() => SB.R.camera.position.toArray().map(v => +v.toFixed(2)).join(','));
  ok(await camName() === 'Wide', 'shot camera at frame 0 is Wide: ' + await camName());
  // select Close and press C: look through it even though Wide owns the shot
  await page.evaluate(() => { const o = SB.APP.scene.objects.find(o => o.name === 'Close'); SB.fn.select([o.id]); });
  await page.mouse.move(500, 400); await page.keyboard.press('c'); await page.waitForTimeout(400);
  ok(await page.evaluate(() => SB.APP.camView), 'in camera view');
  ok(await camName() === 'Close', 'looking through Close: ' + await camName());
  ok(await camPos() === '2.7,1.45,-2.2', 'view sits at Close: ' + await camPos());
  ok((await page.textContent('.vp-cam-label')).includes('Close'), 'label names the camera: ' + await page.textContent('.vp-cam-label'));
  await page.keyboard.press('PageDown'); await page.waitForTimeout(400);
  ok(await camName() === 'Follow', 'PgDn goes to Follow: ' + await camName());
  ok(await camPos() === '7,2.4,-1.6', 'view sits at Follow: ' + await camPos());
  // the camera menu lists all three and can return to shots
  await page.click('#vb-camlist'); await page.waitForTimeout(200);
  const items = await page.$$eval('.dropdown .mi .lbl', a => a.map(x => x.textContent));
  ok(items.filter(t => /\(shot from/.test(t)).length === 3, 'menu lists 3 cameras: ' + items.join(' | '));
  await page.screenshot({ path: OUT + '/t27-menu.png' });
  await page.click('.dropdown .mi:has-text("Follow shots")'); await page.waitForTimeout(400);
  ok(await camName() === 'Wide', 'Follow shots returns to Wide at frame 0: ' + await camName());
  await page.evaluate(() => SB.fn.setFrame(60)); await page.waitForTimeout(400);
  ok(await camName() === 'Close', 'shot cut at frame 60 -> Close: ' + await camName());
  // undo the pin
  await page.keyboard.press('Escape');
  // render panel View from
  await page.evaluate(() => { SB.PROPS.want = 'render'; SB.fn.buildProps(); });
  await page.waitForTimeout(200);
  const opts = await page.evaluate(() => { const s = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.text.startsWith('Camera: '))); return s ? [...s.options].map(o => o.text) : []; });
  ok(opts.length === 5, 'render View from: ' + opts.join(' | '));

  // follow: hammer demo, camera follows the humanoid
  await page.evaluate(() => SB.fn.loadDemo('hammer'));
  await page.waitForTimeout(1500);
  const setSel = (label, v) => page.evaluate(([label, v]) => { const s = document.querySelector(`select[aria-label="${label}"]`); if (!s) return false; s.value = v; s.dispatchEvent(new Event('change')); return true; }, [label, v]);
  const info = await page.evaluate(() => { const c = SB.APP.scene.objects.find(o => o.type === 'camera'), h = SB.APP.scene.objects.find(o => o.type === 'humanoid'); SB.fn.select([c.id]); SB.PROPS.want = 'object'; SB.fn.buildProps(); return { c: c.id, h: h.id }; });
  await page.waitForTimeout(300);
  ok(await setSel('Follow', info.h), 'Follow select present');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => !!document.querySelector('select[aria-label="How"]')), 'How select shown');
  await page.keyboard.press('c'); await page.waitForTimeout(300);
  // simulate a while, then check the aim point is the body's centre of mass
  await page.evaluate(() => { SB.SIM.target = 155; SB.SIM.pump(); });
  await page.waitForFunction(() => SB.SIM.cache.end >= 152, null, { timeout: 600000, polling: 1000 });
  await page.evaluate(() => SB.fn.setFrame(152)); await page.waitForTimeout(800);
  const look = await page.evaluate(() => { const t = SB.R.controls.target; const h = SB.APP.scene.objects.find(o => o.type === 'humanoid'); const c = SB.APP.scene.objects.find(o => o.type === 'camera');
    return { t: t.toArray().map(v => +v.toFixed(2)), base: c.props.target, pos: SB.R.camera.position.toArray().map(v => +v.toFixed(2)), cpos: c.props.position, frame: SB.APP.frame }; });
  console.log('look mode', JSON.stringify(look));
  ok(look.pos.join() === look.cpos.map(v => +v.toFixed(2)).join(), 'look mode keeps the camera in place');
  ok(Math.hypot(look.t[0] - look.base[0], look.t[2] - look.base[2]) > 0.05 || Math.abs(look.t[1] - look.base[1]) > 0.05, 'aim moved off the stored target to the body');
  await page.screenshot({ path: OUT + '/t27-look.png' });
  // move mode: switch at the start, then the camera travels with the body
  await page.evaluate(() => SB.fn.setFrame(0)); await page.waitForTimeout(400);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  ok(await setSel('How', 'chase'), 'set chase');
  await page.waitForTimeout(300);
  const p0 = await page.evaluate(() => { const c = SB.APP.scene.objects.find(o => o.type === 'camera'); return SB.APP.views.get(c.id).root.position.toArray(); });
  await page.evaluate(() => SB.fn.setFrame(140)); await page.waitForTimeout(800);
  const p1 = await page.evaluate(() => { const c = SB.APP.scene.objects.find(o => o.type === 'camera'); return { v: SB.APP.views.get(c.id).root.position.toArray(), b: c.props.position, ref: c.props.followRef, mode: c.props.followMode, fo: c.props.followObj, f: SB.APP.frame, ce: SB.SIM.cache.end, ev: c._eval && c._eval.followMode, cs: SB.fn.camState(c), an: SB.fn.followAnchor(SB.APP.scene.objects.find(o => o.type === "humanoid")) }; });
  console.log('chase', JSON.stringify(p0), JSON.stringify(p1));
  ok(Math.hypot(p1.v[0] - p0[0], p1.v[1] - p0[1], p1.v[2] - p0[2]) > 0.1, 'chase camera model moved with the body');
  await page.keyboard.press('c'); await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + '/t27-chase.png' });
  // unanchor keeps it where it is
  const before = await page.evaluate(() => SB.R.camera.position.toArray().map(v => +v.toFixed(2)).join());
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await setSel('Follow', ''); await page.waitForTimeout(300);
  await page.keyboard.press('c'); await page.waitForTimeout(500);
  const after = await page.evaluate(() => SB.R.camera.position.toArray().map(v => +v.toFixed(2)).join());
  ok(before === after, `unanchoring keeps the camera put (${before} vs ${after})`);
  const errs = logs.filter(l => !/GL Driver|GPU stall/.test(l));
  ok(!errs.length, 'no console errors ' + errs.join('\n'));
  console.log(fails ? fails + ' FAILED' : 'all passed');
  await browser.close();
})();
