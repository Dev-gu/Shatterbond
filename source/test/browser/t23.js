// Load a saved scene file (SCENE=path) and simulate it: per-body damage at FRAMES, screenshots from the scene camera.
const { setup, OUT } = require('./run.js');
(async () => {
  const { browser, page, logs } = await setup();
  await page.waitForFunction(() => window.SB);
  const sc = JSON.parse(require('fs').readFileSync(process.env.SCENE, 'utf8'));
  const frames = (process.env.FRAMES || '30,60,90,120').split(',').map(Number);
  if (process.env.CAMPOS) { const c = sc.objects.find(o => o.type === 'camera'); c.props.position = JSON.parse(process.env.CAMPOS); c.props.target = JSON.parse(process.env.CAMTGT); c.anim = {}; }
  const info0 = await page.evaluate((sc) => { SB.fn.activateScene(sc); const c = Object.values(SB.APP.scene.clips || {})[0]; return c ? { n: c.n, fps: c.fps, name: c.name } : null; }, sc);
  console.log('clip', JSON.stringify(info0));
  await page.waitForTimeout(1500);
  const last = Math.max(...frames), t0 = Date.now();
  await page.evaluate((f) => { SB.SIM.target = f; SB.SIM.pump(); }, last);
  await page.waitForFunction((f) => SB.SIM.cache.end >= f, last, { timeout: 1800000, polling: 1000 });
  console.log('sim', ((Date.now() - t0) / 1000).toFixed(1) + 's');
  await page.evaluate(() => { if (!SB.APP.camView) SB.fn.toggleCamView(); });
  for (const f of frames) {
    await page.evaluate((f) => SB.fn.setFrame(f), f);
    await page.waitForTimeout(300);
    const info = await page.evaluate(() => SB.MOL.bodies.map(b => { const st = SB.SIM.dispSt; let dm = 0, loose = 0; for (let i = b.start; i < b.start + b.count; i++) { if (st[i] === 1) dm++; else if (st[i] === 2) loose++; } return `n${b.count} dmg${dm} loose${loose}`; }));
    console.log('frame', f, info.join(' | '));
    if (process.env.PROBE) console.log('probe', JSON.stringify(await page.evaluate((f) => SB.MOL.bodies.map((b, k) => ({ kin: !!SB.SIM.kinAt(f, k), sk: !!(b.data.skin && b.data.skin.sk), nseg: b.data.rig && b.data.rig.nseg, pose: b.data.rig && b.data.rig.pose })), f)));
    const bx = await page.locator('#viewport canvas').first().boundingBox();
    await page.screenshot({ path: `${OUT}/scene-${process.env.TAG || 's'}-${f}.png`, clip: bx });
  }
  console.log(logs.filter(l => !/GPU stall|GL Driver/.test(l)).join('\n') || 'no console errors');
  await browser.close();
})();
