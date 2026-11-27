// Visual check: load a demo, simulate, screenshot several frames from the demo camera and a close orbit view.
const { setup, OUT } = require('./run.js');
const demo = process.argv[2] || 'hammer', frames = (process.argv[3] || '1,30,45,60,90,140').split(',').map(Number);
(async () => {
  const { browser, page, logs } = await setup();
  await page.waitForFunction(() => window.SB);
  await page.evaluate((d) => SB.fn.loadDemo(d), demo);
  if (process.env.CAMVIEW) await page.evaluate(() => { if (!SB.APP.camView) SB.fn.toggleCamView(); });
  if (process.env.SHADE) await page.evaluate((s) => SB.fn.setShading(s), process.env.SHADE);
  await page.waitForTimeout(1500);
  const last = Math.max(...frames);
  const t0 = Date.now();
  await page.evaluate((f) => { SB.SIM.target = f; SB.SIM.pump(); }, last);
  await page.waitForFunction((f) => SB.SIM.cache.end >= f, last, { timeout: 600000, polling: 500 });
  console.log('sim', ((Date.now() - t0) / 1000).toFixed(1) + 's', await page.evaluate(() => document.querySelector('#status-stats').textContent));
  for (const f of frames) {
    await page.evaluate(([f, cam]) => { SB.fn.setFrame(f); if (cam) { const v = cam.split(',').map(Number); SB.R.camera.position.set(v[0], v[1], v[2]); SB.R.controls.target.set(v[3], v[4], v[5]); SB.R.controls.update(); } }, [f, process.env.CAM || '']);
    await page.waitForTimeout(400);
    const bx = await page.locator('#viewport canvas').first().boundingBox();
    await page.screenshot({ path: `${OUT}/${demo}-${f}.png`, clip: bx, timeout: 240000 });
  }
  console.log(logs.filter(l => !/GPU stall|GL Driver/.test(l)).join('\n') || 'no console errors');
  await browser.close();
})();
