// keyframed focus subject: focus switches between two objects within one shot, with a rack-focus glide
const { setup, OUT } = require('./run.js');
(async () => {
  const { browser, page, logs } = await setup();
  let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
  await page.waitForFunction(() => window.SB);
  await page.evaluate(() => SB.fn.emptyScene()); await page.waitForTimeout(800);
  const r = await page.evaluate(() => {
    const a = SB.fn.addObject('plane', { position: [0, 1, 2] }, 'Near'), b = SB.fn.addObject('plane', { position: [0, 1, -4] }, 'Far');
    const cam = SB.fn.addObject('camera', { position: [0, 1, 6], target: [0, 1, 0], dof: true });
    SB.fn.setFrame(0); SB.fn.setProp(cam, 'focusObj', a.id);
    // key it through the props panel's keyframe button path
    SB.fn.insertKey(cam, 'focusObj', 0, a.id); SB.fn.insertKey(cam, 'focusObj', 30, b.id); SB.fn.changed(cam, false);
    SB.fn.select([cam.id]); SB.PROPS.tab = 'object'; SB.fn.buildProps();
    return { cam: cam.id, a: a.id, b: b.id };
  });
  const at = (f) => page.evaluate(([id, f]) => { SB.fn.setFrame(f); const c = SB.APP.scene.objects.find(o => o.id === id); c._eval = SB.fn.evalProps(c, f); return SB.fn.camFocusDist(c, SB.fn.camState(c, c._eval)); }, [r.cam, f]);
  const d0 = await at(0), d29 = await at(29), d30 = await at(30), d36 = await at(36), d42 = await at(42), d60 = await at(60);
  console.log([d0, d29, d30, d36, d42, d60].map(v => v.toFixed(2)).join(' '));
  ok(Math.abs(d0 - 4) < 0.5, `frame 0 focuses on the near object (${d0.toFixed(2)} m)`);
  ok(Math.abs(d29 - d0) < 1e-6, 'still on the near object before the key');
  ok(Math.abs(d30 - d0) < 1e-6, 'focus pull starts at the key');
  ok(d36 > d0 + 0.3 && d36 < d60 - 0.3, `halfway through the pull it is between the two (${d36.toFixed(2)} m)`);
  ok(Math.abs(d42 - d60) < 1e-6 && Math.abs(d60 - 10) < 0.5, `after 12 frames it is on the far object (${d60.toFixed(2)} m)`);
  await page.evaluate((id) => { const c = SB.APP.scene.objects.find(o => o.id === id); SB.fn.setProp(c, 'focusPull', 0); }, r.cam);
  const s31 = await at(31);
  ok(Math.abs(s31 - d60) < 1e-6, 'focus pull 0 snaps straight over');
  const cls = await page.evaluate(() => { SB.fn.setFrame(30); SB.fn.buildProps(); const s = [...document.querySelectorAll('#props .selectf')].find(e => /Focus/.test(e.closest('.row').textContent)); return s ? s.className : 'none'; });
  ok(/keyed/.test(cls), 'Focus on field shows as keyed at a key frame: ' + cls);
  const kd = await page.evaluate(() => { const s = [...document.querySelectorAll('#props .row')].find(e => /^Focus on/.test(e.textContent)); return s && !!s.querySelector('button.kd'); });
  ok(kd, 'Focus on has a keyframe button');
  console.log(logs.filter(l => !/favicon|GPU stall|WebGL/.test(l)).join('\n') || 'no console errors');
  console.log(fails ? `${fails} FAILED` : 'all passed');
  await browser.close();
})();
