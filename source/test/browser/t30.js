// autofocus: the focus follows whatever the middle of the camera view hits
const { setup, OUT } = require('./run.js');
(async () => {
  const { browser, page, logs } = await setup();
  let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
  await page.waitForTimeout(2500);
  await page.evaluate(() => SB.fn.loadDemo('hammer')); await page.waitForTimeout(3000);
  const r = await page.evaluate(() => {
    const cam = SB.APP.scene.objects.find(o => o.type === 'camera'), h = SB.APP.scene.objects.find(o => o.type === 'humanoid');
    // aim at the humanoid's chest from 5 m in front
    SB.fn.setProp(cam, 'position', [0, 1.2, 5]); SB.fn.setProp(cam, 'target', [h.props.position[0], 1.2, h.props.position[2]]);
    SB.fn.setProp(cam, 'dof', true); SB.fn.setProp(cam, 'focusObj', '@auto');
    return { id: cam.id, hz: h.props.position[2] };
  });
  await page.waitForTimeout(2500);
  const d1 = await page.evaluate((id) => SB.fn.camFocusDist(SB.APP.scene.objects.find(o => o.id === id)), r.id);
  ok(d1 > 4.5 - r.hz && d1 < 4.95 - r.hz, `autofocus lands on the body surface: ${d1.toFixed(2)} m`);
  await page.evaluate((id) => { const c = SB.APP.scene.objects.find(o => o.id === id); SB.fn.setProp(c, 'position', [0, 1.2, 3]); }, r.id);
  await page.waitForTimeout(800);
  const d2 = await page.evaluate((id) => SB.fn.camFocusDist(SB.APP.scene.objects.find(o => o.id === id)), r.id);
  ok(Math.abs((d1 - d2) - 2) < 0.15, `camera moved 2 m closer, focus follows: ${d2.toFixed(2)} m`);
  // aim over the body at the floor far away: focus jumps to the floor
  await page.evaluate((id) => { const c = SB.APP.scene.objects.find(o => o.id === id); SB.fn.setProp(c, 'position', [3, 1.2, 3]); SB.fn.setProp(c, 'target', [6, 0, 6]); }, r.id);
  await page.waitForTimeout(800);
  const d3 = await page.evaluate((id) => SB.fn.camFocusDist(SB.APP.scene.objects.find(o => o.id === id)), r.id);
  ok(Math.abs(d3 - Math.hypot(3, 1.2, 3)) < 0.05, `pointing at empty floor focuses on the floor: ${d3.toFixed(2)} m`);
  await page.evaluate((id) => { const c = SB.APP.scene.objects.find(o => o.id === id); SB.fn.setProp(c, 'position', [0, 1.2, 3]); SB.fn.setProp(c, 'target', [0, 1.2, 0]); SB.fn.toggleCamView(); }, r.id);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: OUT + '/t30-autofocus.png' });
  console.log(logs.filter(l => !/favicon|GPU stall|WebGL/.test(l)).join('\n') || 'no console errors');
  console.log(fails ? `${fails} FAILED` : 'all passed');
  await browser.close(); process.exit(fails ? 1 : 0);
})();
