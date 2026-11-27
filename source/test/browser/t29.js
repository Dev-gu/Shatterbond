// v21: deleting explosions, keyframable depth of field per camera, emitters
const { setup, OUT } = require('./run.js');
(async () => {
  const { browser, page, logs } = await setup();
  let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
  await page.waitForTimeout(2500);
  // ---------- explosions ----------
  await page.evaluate(() => SB.fn.loadDemo('bomb'));
  await page.waitForTimeout(2500);
  const bomb = await page.evaluate(() => SB.APP.scene.objects.find(o => o.type === 'bomb').id);
  await page.evaluate(() => SB.fn.setFrame(70)); await page.waitForTimeout(800);
  ok(await page.evaluate((id) => SB.APP.views.get(id).body.visible, bomb), 'explosive stays clickable as a ghost after it went off');
  // blasts with the Blast tool
  await page.evaluate(() => { SB.fn.setFrame(5); SB.fn.blastAt(new SB.fn.V3(0.3, 1.2, 0.2), 0.85, 13); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { if (SB.APP.playing) SB.fn.togglePlay(); SB.fn.setFrame(20); SB.fn.blastAt(new SB.fn.V3(-0.3, 0.9, 0.2), 0.85, 13); if (SB.APP.playing) SB.fn.togglePlay(); });
  await page.waitForTimeout(500);
  ok(await page.evaluate(() => SB.APP.scene.events.length) === 2, 'two blasts recorded');
  ok(await page.$$eval('#outliner-list .ol-blast', a => a.length) === 2, 'outliner lists both blasts');
  await page.screenshot({ path: OUT + '/t29-blasts.png' });
  await page.evaluate(() => { if (SB.APP.playing) SB.fn.togglePlay(); document.querySelectorAll('#outliner-list .ol-blast')[0].querySelector('button').click(); });
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => SB.APP.scene.events.length) === 1, 'trash button deletes one blast');
  await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => SB.APP.scene.events.length) === 2, 'undo brings it back');
  // select via outliner row then X key
  await page.evaluate(() => document.querySelectorAll('#outliner-list .ol-blast')[1].click()); await page.mouse.move(600, 400);
  ok(await page.evaluate(() => SB.APP.blastSel) === 1, 'row click selects the blast');
  await page.keyboard.press('x'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => SB.APP.scene.events.length) === 1, 'X deletes the selected blast');
  // undo of blastAt
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => SB.APP.scene.events.length) === 1, 'Ctrl+Z also takes back a fresh blast: ' + await page.evaluate(() => SB.APP.scene.events.length));
  // the explosive object itself: select, X
  await page.evaluate((id) => SB.fn.select([id]), bomb); await page.mouse.move(600, 400); await page.keyboard.press('x'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => !SB.APP.scene.objects.some(o => o.type === 'bomb')), 'explosive object deleted');
  // ---------- depth of field ----------
  await page.evaluate(() => SB.fn.loadDemo('hammer'));
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => {
    const cam = SB.APP.scene.objects.find(o => o.type === 'camera'); SB.FXS.dof = false;
    SB.fn.select([cam.id]);
    SB.fn.setProp(cam, 'dof', true);
    SB.fn.setFrame(0); SB.fn.insertKey(cam, 'focusDist', 0, 2); SB.fn.insertKey(cam, 'focusDist', 40, 9);
    SB.fn.insertKey(cam, 'blur', 0, 0.5); SB.fn.insertKey(cam, 'blur', 40, 3); SB.fn.changed(cam);
    const a = SB.fn.evalProps(cam, 20);
    return { fd: a.focusDist, blur: a.blur, id: cam.id };
  });
  await page.waitForTimeout(600);
  r.on = await page.evaluate((id) => SB.fn.dofEnabled(SB.APP.scene.objects.find(o => o.id === id)), r.id);
  ok(r.on, 'camera depth of field on without the global switch');
  ok(r.fd > 2.5 && r.fd < 8.5 && r.blur > 0.6 && r.blur < 2.9, `focus distance and blur interpolate at frame 20: ${r.fd.toFixed(2)} ${r.blur.toFixed(2)}`);
  await page.evaluate(() => { SB.PROPS.tab = 'object'; SB.fn.buildProps(); }); ok(await page.evaluate(() => document.querySelector('#prop-body').textContent.includes('Blur amount')), 'Blur amount field shown');
  await page.evaluate(() => { SB.fn.setFrame(40); SB.fn.toggleCamView(); }); await page.waitForTimeout(1500);
  await page.screenshot({ path: OUT + '/t29-dof-blur3.png' });
  const dp = await page.evaluate((id) => { const c = SB.APP.scene.objects.find(o => o.id === id); return SB.fn.dofParams(SB.R.camera, c); }, r.id);
  ok(Math.abs(dp.focus - 9) < 0.01 && Math.abs(dp.blur - 3) < 0.01, 'render uses keyed focus 9 m, blur 3: ' + JSON.stringify(dp));
  // focus on an object
  const fo = await page.evaluate((id) => { const c = SB.APP.scene.objects.find(o => o.id === id), h = SB.APP.scene.objects.find(o => o.type === 'humanoid'); SB.fn.setProp(c, 'focusObj', h.id); return SB.fn.camFocusDist(c); }, r.id);
  ok(fo > 2 && fo < 15, 'focus on the humanoid: ' + fo.toFixed(2) + ' m');
  await page.evaluate(() => SB.fn.toggleCamView());
  // ---------- emitter ----------
  await page.evaluate(() => SB.fn.emptyScene()); await page.waitForTimeout(800);
  const em = await page.evaluate(() => {
    const o = SB.fn.addObject('emitter', { position: [0, 1, 0], rotation: [-60, 0, 0], rate: 20, speed: 6, spread: 25, life: 1.5, start: 0 });
    SB.fn.addObject('cube', { position: [0, 0.5, 3], scale: [4, 1, 0.3] }, 'Wall');
    SB.fn.select([o.id]);
    return o.id;
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => { SB.fn.setFrame(0); SB.fn.togglePlay(); });
  await page.waitForTimeout(7000);
  const st = await page.evaluate((id) => {
    if (SB.APP.playing) SB.fn.togglePlay();
    const c = SB.SIM.cache, f = Math.min(c.end, 60), m = SB.SIM.ballsFor(f);
    const v = SB.APP.views.get(id);
    return { end: c.end, n: m ? [...m.keys()].filter(k => k.startsWith(id + ':e')).length : -1, inst: v.inst ? v.inst.count : -1, f };
  }, em);
  ok(st.end >= 40, 'emitter-only scene simulates: cached to ' + st.end);
  // rate 20/s with 1.5 s lifetime: about 30 alive once it has been running for > 1.5 s
  ok(st.f < 90 ? st.n > 5 : (st.n >= 24 && st.n <= 34), `balls alive at frame ${st.f}: ${st.n}`);
  await page.evaluate(() => SB.fn.setFrame(Math.min(SB.SIM.cache.end, 80))); await page.waitForTimeout(600);
  ok(await page.evaluate((id) => SB.APP.views.get(id).inst.count, em) > 5, 'viewport draws the emitted objects');
  await page.screenshot({ path: OUT + '/t29-emitter.png' });
  // keyed rate: zero rate emits nothing
  const z = await page.evaluate((id) => { const o = SB.APP.scene.objects.find(x => x.id === id); SB.fn.setProp(o, 'rate', 0); const et = SB.fn.emitTable(o); return SB.fn.emitCount(et, 10); }, em);
  ok(z === 0, 'rate 0 emits nothing');
  console.log(logs.filter(l => !/favicon|GPU stall|WebGL/.test(l)).join('\n') || 'no console errors');
  console.log(fails ? `${fails} FAILED` : 'all passed');
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
