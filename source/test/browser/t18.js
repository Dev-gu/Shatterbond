// Look check: one body type from the side and three quarters (no simulation). env BT (horse), CAMS
const { setup, OUT } = require('./run.js');
(async () => {
  const { browser, page, logs } = await setup();
  await page.waitForFunction(() => window.SB);
  const bt = process.env.BT || 'horse';
  await page.evaluate(([bt, res]) => {
    const D = { horse: { height: 1.6 }, dog: { height: 0.62 }, child: { height: 1.25, fat: 0.25, build: 0.3 }, heavy: { height: 1.78, fat: 0.8, build: 0.5 } }[bt] || {};
    SB.DEMOS.push({ id: 't18', name: bt, world: { frameEnd: 50 }, objects: [{ type: 'humanoid', name: bt, props: Object.assign({ bodyType: bt, resolution: res, animation: 'none' }, D) }] });
    SB.fn.loadDemo('t18');
  }, [bt, process.env.RES || 'medium']);
  await page.waitForFunction(() => SB.SIM.layout && !SB.SIM.layoutDirty, null, { timeout: 120000, polling: 300 });
  await page.waitForTimeout(1500);
  const s = bt === 'horse' ? 1 : bt === 'dog' ? 0.42 : 0.9;
  const cams = [[4.2 * s, 1.1 * s, 0.2 * s, 0, 0.95 * s, 0.1 * s], [3.0 * s, 1.6 * s, 3.2 * s, 0, 0.9 * s, 0.2 * s]];
  for (let k = 0; k < cams.length; k++) {
    await page.evaluate((v) => { SB.R.camera.position.set(v[0], v[1], v[2]); SB.R.controls.target.set(v[3], v[4], v[5]); SB.R.controls.update(); }, cams[k]);
    await page.waitForTimeout(500);
    const bx = await page.locator('#viewport canvas').first().boundingBox();
    await page.screenshot({ path: `${OUT}/look-${bt}-${k}.png`, clip: bx });
  }
  console.log(logs.filter(l => !/GPU stall|GL Driver/.test(l)).join('\n') || 'no console errors');
  await browser.close();
})();
