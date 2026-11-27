// Free zoom goes past the pivot without slowing; export crop presets frame the right size; crop guide shows.
const { setup } = require('./run.js');
(async () => {
  const { browser, page, logs } = await setup();
  await page.waitForFunction(() => window.SB);
  await page.evaluate(() => SB.fn.loadDemo('punch'));
  await page.waitForTimeout(1500);
  const box = await page.evaluate(() => { const r = SB.R.renderer.domElement.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.move(box.x, box.y);
  const d0 = await page.evaluate(() => SB.R.camera.position.distanceTo(SB.R.controls.target));
  const steps = [];
  for (let k = 0; k < 40; k++) { const p0 = await page.evaluate(() => SB.R.camera.position.toArray()); await page.mouse.wheel(0, -120); await page.waitForTimeout(30); const p1 = await page.evaluate(() => SB.R.camera.position.toArray()); steps.push(Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2])); }
  const dEnd = await page.evaluate(() => SB.R.camera.position.distanceTo(SB.R.controls.target));
  const minStep = Math.min(...steps.slice(10));
  console.log('start dist', d0.toFixed(2), 'end dist', dEnd.toFixed(2), 'min step late', minStep.toFixed(3), 'first step', steps[0].toFixed(3));
  const crops = await page.evaluate(async () => {
    const out = {};
    for (const id of ['ig-reel', 'ig-portrait', 'yt', 'shorts', 'cinema', 'custom']) { SB.OUT.res = id; SB.OUT.cw = 1234; SB.OUT.ch = 700; out[id] = SB.fn.outSize(); }
    SB.OUT.res = 'ig-portrait'; SB.OUT.useCam = false; SB.OUT.guide = true; SB.fn.updateCropGuide();
    const g = document.querySelector('#crop-guide .cg-box'); out.guide = g ? [g.style.width, g.style.height, g.firstChild.textContent] : null;
    SB.OUT.trimS = 20; SB.OUT.trimE = 50; out.range = SB.fn.exportRange();
    SB.OUT.trimS = SB.OUT.trimE = -1;
    return out;
  });
  console.log(JSON.stringify(crops));
  const ok = minStep > 0.02 && dEnd < 0.5 && crops['ig-reel'][1] === 1920 && crops['ig-portrait'][1] === 1350 && crops.custom[0] === 1234 && crops.guide && crops.range[0] === 20 && crops.range[1] === 50;
  console.log(ok ? 'PASS' : 'FAIL');
  await page.screenshot({ path: (process.env.OUT || '/tmp') + '/t10.png' });
  console.log(logs.filter(l => !/GPU stall|GL Driver/.test(l)).join('\n') || 'no console errors');
  await browser.close();
})();
