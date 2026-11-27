// Skeleton animation: a humanoid plays a clip; screenshots frames from the side so the motion can be watched.
// env: ANIM (walk), FRAMES (list), HIT=1 adds a hammer that swings into the path, RES (low), POSE, MODEL, CAM
const { setup, OUT } = require('./run.js');
(async () => {
  const { browser, page, logs } = await setup();
  await page.waitForFunction(() => window.SB);
  const anim = process.env.ANIM || 'walk', frames = (process.env.FRAMES || '0,10,20,30,40,60').split(',').map(Number);
  const res = await page.evaluate(([anim, hit, res, pose, model, rel]) => {
    const objs = [{ type: 'humanoid', props: { position: [0, 0, hit ? -1.6 : 0], animation: anim, resolution: res, pose: pose || 'stand', model: model || 'anatomical', release: rel != null ? rel : -1 } }];
    if (hit) objs.push({ type: 'hammer', props: { release: 0, angle: 70 } });
    objs.push({ type: 'camera', name: 'Camera', props: { position: [5.5, 1.3, 0.6], target: [0, 0.95, 0.6], fov: 40 } });
    SB.DEMOS.push({ id: 't14', name: 'anim test', world: { frameEnd: 200 }, objects: objs });
    SB.fn.loadDemo('t14');
    return SB.APP.scene.objects.length;
  }, [anim, !!process.env.HIT, process.env.RES || 'low', process.env.POSE, process.env.MODEL, process.env.RELEASE ? +process.env.RELEASE : null]);
  if (process.env.CLIP) {
    const b64 = require('fs').readFileSync(process.env.CLIP).toString('base64');
    const r = await page.evaluate(async (b64) => {
      const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i);
      const c = await SB.fn.retargetFBX(u.buffer, 'test.fbx');
      SB.APP.scene.clips = { tclip: c };
      const h = SB.APP.scene.objects.find(o => o.type === 'humanoid'); h.props.animation = 'clip:tclip';
      SB.RIG.track.clear(); SB.SIM.invalidate();
      return { n: c.n, fps: c.fps, v: c.v, segs: (c.qp || []).filter(Boolean).length, kb: Math.round(JSON.stringify(c).length / 1024) };
    }, b64);
    console.log('clip', JSON.stringify(r));
  }
  await page.waitForTimeout(1500);
  const last = Math.max(...frames);
  const t0 = Date.now();
  await page.evaluate((f) => { SB.SIM.target = f; SB.SIM.pump(); }, last);
  await page.waitForFunction((f) => SB.SIM.cache.end >= f, last, { timeout: 600000, polling: 500 });
  console.log('sim', ((Date.now() - t0) / 1000).toFixed(1) + 's');
  if (!process.env.NOCAM) await page.evaluate(() => { if (!SB.APP.camView) SB.fn.toggleCamView(); });
  for (const f of frames) {
    await page.evaluate((f) => SB.fn.setFrame(f), f);
    await page.waitForTimeout(350);
    const info = await page.evaluate(() => { const d = SB.SIM.disp, L = SB.SIM.layout[0]; let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (let i = L.start; i < L.start + L.data.count; i++) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], d[3 * i + k]); mx[k] = Math.max(mx[k], d[3 * i + k]); } return { mn: mn.map(v => +v.toFixed(2)), mx: mx.map(v => +v.toFixed(2)) }; });
    console.log('frame', f, JSON.stringify(info));
    const bx = await page.locator('#viewport canvas').first().boundingBox();
    await page.screenshot({ path: `${OUT}/anim-${anim}-${f}.png`, clip: bx });
  }
  console.log(logs.filter(l => !/GPU stall|GL Driver/.test(l)).join('\n') || 'no console errors');
  await browser.close();
})();
