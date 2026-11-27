// Animated body into another body (defaults: react on, the other one asleep): neither should tear apart.
// env: ANIM (run), DIST (start distance, 2.4), RES (low), FRAMES, CLIP (fbx path), SLEEP (1)
const { setup, OUT } = require('./run.js');
(async () => {
  const { browser, page, logs } = await setup();
  await page.waitForFunction(() => window.SB);
  const anim = process.env.ANIM || 'run', D = +(process.env.DIST || 2.4), frames = (process.env.FRAMES || '30,50,70,100').split(',').map(Number);
  await page.evaluate(([anim, D, res, sleep]) => {
    const objs = [{ type: 'humanoid', props: { position: [0, 0, -D], animation: anim, resolution: res } },
      { type: 'humanoid', props: { position: [0, 0, 0], rotation: [0, 180, 0], resolution: res, sleep, seed: 19 } },
      { type: 'camera', name: 'Camera', props: { position: [4.2, 1.5, -0.6], target: [0, 1.1, -0.6], fov: 40 } }];
    SB.DEMOS.push({ id: 't22', name: 'body into body', world: { frameEnd: 200 }, objects: objs });
    SB.fn.loadDemo('t22');
  }, [anim, D, process.env.RES || 'low', process.env.SLEEP !== '0']);
  if (process.env.CLIP) {
    const b64 = require('fs').readFileSync(process.env.CLIP).toString('base64');
    await page.evaluate(async (b64) => {
      const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i);
      const c = await SB.fn.retargetFBX(u.buffer, 'test.fbx');
      SB.APP.scene.clips = { tclip: c };
      SB.APP.scene.objects.find(o => o.type === 'humanoid').props.animation = 'clip:tclip';
      SB.RIG.track.clear(); SB.SIM.invalidate();
    }, b64);
  }
  await page.waitForTimeout(1500);
  const last = Math.max(...frames);
  await page.evaluate((f) => { SB.SIM.target = f; SB.SIM.pump(); }, last);
  await page.waitForFunction((f) => SB.SIM.cache.end >= f, last, { timeout: 900000, polling: 500 });
  await page.evaluate(() => { if (!SB.APP.camView) SB.fn.toggleCamView(); });
  const tag = process.env.TAG || anim;
  for (const f of frames) {
    await page.evaluate((f) => SB.fn.setFrame(f), f);
    await page.waitForTimeout(300);
    const info = await page.evaluate(() => SB.MOL.bodies.map(b => { const st = SB.SIM.dispSt; let dm = 0, loose = 0; for (let i = b.start; i < b.start + b.count; i++) { if (st[i] === 1) dm++; else if (st[i] === 2) loose++; } return `n${b.count} dmg${dm} loose${loose}`; }));
    console.log('frame', f, info.join(' | '));
    const bx = await page.locator('#viewport canvas').first().boundingBox();
    await page.screenshot({ path: `${OUT}/b2b-${tag}-${f}.png`, clip: bx });
  }
  console.log(logs.filter(l => !/GPU stall|GL Driver/.test(l)).join('\n') || 'no console errors');
  await browser.close();
})();
