// Skin quality while animated: a humanoid plays a clip (ANIM, or CLIP=fbx file); close-up frames of the torso and
// counts of skin triangles that went missing and molecules marked damaged. env: RES (medium), FRAMES, CAM (front|side|back)
const { setup, OUT } = require('./run.js');
(async () => {
  const { browser, page, logs } = await setup();
  await page.waitForFunction(() => window.SB);
  const anim = process.env.ANIM || 'punch', frames = (process.env.FRAMES || '0,15,30,45,60').split(',').map(Number);
  const cam = process.env.CAMPOS ? [JSON.parse(process.env.CAMPOS), JSON.parse(process.env.CAMTGT)] : { front: [[1.2, 1.4, 2.4], [0, 1.15, 0]], side: [[2.6, 1.3, 0.3], [0, 1.1, 0]], back: [[-1.4, 1.5, -2.2], [0, 1.15, 0]] }[process.env.CAM || 'front'];
  await page.evaluate(([anim, res, cam, pose]) => {
    const objs = [{ type: 'humanoid', props: Object.assign({ position: [0, 0, 0], animation: anim, animMove: false, resolution: res }, pose ? { pose } : {}) },
      { type: 'camera', name: 'Camera', props: { position: cam[0], target: cam[1], fov: 40 } }];
    SB.DEMOS.push({ id: 't19', name: 'skin test', world: { frameEnd: 200 }, objects: objs });
    SB.fn.loadDemo('t19');
  }, [anim, process.env.RES || 'medium', cam, process.env.POSE || null]);
  if (process.env.CLIP) {
    const b64 = require('fs').readFileSync(process.env.CLIP).toString('base64');
    await page.evaluate(async (b64) => {
      const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i);
      const c = await SB.fn.retargetFBX(u.buffer, 'test.fbx');
      SB.APP.scene.clips = { tclip: c };
      const h = SB.APP.scene.objects.find(o => o.type === 'humanoid'); h.props.animation = 'clip:tclip';
      SB.RIG.track.clear(); SB.SIM.invalidate();
    }, b64);
  }
  await page.waitForTimeout(1500);
  const last = Math.max(...frames);
  await page.evaluate((f) => { SB.SIM.target = f; SB.SIM.pump(); }, last);
  await page.waitForFunction((f) => SB.SIM.cache.end >= f, last, { timeout: 900000, polling: 500 });
  await page.evaluate((sh) => { if (!SB.APP.camView) SB.fn.toggleCamView(); if (sh) SB.fn.setShading(sh); }, process.env.SHADING || null);
  const tag = process.env.TAG || anim;
  for (const f of frames) {
    await page.evaluate((f) => SB.fn.setFrame(f), f);
    await page.waitForTimeout(400);
    const info = await page.evaluate(() => {
      const b = SB.MOL.bodies[0], st = SB.SIM.dispSt; let dm = 0, loose = 0;
      for (let i = b.start; i < b.start + b.count; i++) { if (st[i] === 1) dm++; else if (st[i] === 2) loose++; }
      return { tris: b.skin.geometry.drawRange.count / 3 | 0, of: b.nT, damaged: dm, loose };
    });
    console.log('frame', f, JSON.stringify(info));
    if (process.env.DUMP) {
      const d = await page.evaluate(() => { const b = SB.MOL.bodies[0], g = b.skin.geometry, P = g.attributes.position.array, I = g.index.array, n = g.drawRange.count;
        const out = []; for (let t = 0; t < n; t += 3) { const v = [I[t], I[t + 1], I[t + 2]].map(k => [P[3 * k], P[3 * k + 1], P[3 * k + 2]]); const cy = (v[0][1] + v[1][1] + v[2][1]) / 3, cx = (v[0][0] + v[1][0] + v[2][0]) / 3;
          if (cy > 1.5 && cy < 1.8 && Math.abs(cx) < 0.1) out.push(v); } return out; });
      require('fs').writeFileSync(process.env.DUMP, JSON.stringify(d));
    }
    const bx = await page.locator('#viewport canvas').first().boundingBox();
    await page.screenshot({ path: `${OUT}/skin-${tag}-${f}.png`, clip: bx });
  }
  console.log(logs.filter(l => !/GPU stall|GL Driver/.test(l)).join('\n') || 'no console errors');
  await browser.close();
})();
