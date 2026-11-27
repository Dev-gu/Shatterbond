// Body types: adult, child, heavier build, dog, horse side by side; they must build, stand and stay standing.
// ANIM=walk also makes the dog and horse walk.
const { setup, OUT } = require('./run.js');
(async () => {
  const { browser, page, logs } = await setup();
  await page.waitForFunction(() => window.SB);
  await page.evaluate((anim) => {
    const H = (x, bt, extra) => ({ type: 'humanoid', name: bt, props: Object.assign({ position: [x, 0, 0], bodyType: bt, resolution: 'low' }, { adult: { height: 1.8, fat: 0.2, build: 0.6 }, child: { height: 1.25, fat: 0.25, build: 0.3 }, heavy: { height: 1.78, fat: 0.8, build: 0.5 }, dog: { height: 0.62, fat: 0.3 }, horse: { height: 1.6, fat: 0.3 } }[bt], extra || {}) });
    const objs = [H(-2.2, 'adult'), H(-1.2, 'child'), H(-0.1, 'heavy'), H(1.1, 'dog', { rotation: [0, 90, 0], animation: anim || 'none' }), H(3.0, 'horse', { rotation: [0, 90, 0], animation: anim || 'none' })];
    objs.push({ type: 'camera', name: 'Camera', props: { position: [0.6, 1.6, 8.5], target: [0.6, 0.9, 0], fov: 42 } });
    SB.DEMOS.push({ id: 't15', name: 'body types', world: { frameEnd: 200 }, objects: objs });
    SB.fn.loadDemo('t15');
  }, process.env.ANIM || '');
  await page.waitForTimeout(1500);
  const frames = (process.env.FRAMES || '0,60,120').split(',').map(Number), last = Math.max(...frames);
  const t0 = Date.now();
  await page.evaluate((f) => { SB.SIM.target = f; SB.SIM.pump(); }, last);
  await page.waitForFunction((f) => SB.SIM.cache.end >= f, last, { timeout: 900000, polling: 500 });
  console.log('sim', ((Date.now() - t0) / 1000).toFixed(1) + 's', await page.evaluate(() => SB.SIM.layout.map(L => L.obj.name + ':' + L.data.count).join(' ')));
  await page.evaluate(() => { if (!SB.APP.camView) SB.fn.toggleCamView(); });
  for (const f of frames) {
    await page.evaluate((f) => SB.fn.setFrame(f), f);
    await page.waitForTimeout(400);
    const info = await page.evaluate(() => SB.SIM.layout.map(L => { const d = SB.SIM.disp; let mx = -1e9, cz = 0; for (let i = L.start; i < L.start + L.data.count; i++) { mx = Math.max(mx, d[3 * i + 1]); cz += d[3 * i]; } return L.obj.name + ' top ' + mx.toFixed(2) + ' x ' + (cz / L.data.count).toFixed(2); }).join(' | '));
    console.log('frame', f, info);
    const bx = await page.locator('#viewport canvas').first().boundingBox();
    await page.screenshot({ path: `${OUT}/types-${process.env.ANIM || 'still'}-${f}.png`, clip: bx });
  }
  console.log(logs.filter(l => !/GPU stall|GL Driver/.test(l)).join('\n') || 'no console errors');
  await browser.close();
})();
