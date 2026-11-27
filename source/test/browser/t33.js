// Animated clip close-ups (SCENE=saved scene, CLIP=fbx to swap in, SUPER=1 makes the animated body superhuman,
// SOLO=1 removes the other bodies, SHADE=skin). Prints attacker/victim state changes and damage, saves head close-ups.
const { setup, OUT } = require('./run.js');
(async () => {
  const { browser, page, logs } = await setup();
  await page.waitForFunction(() => window.SB);
  const sc = JSON.parse(require('fs').readFileSync(process.env.SCENE, 'utf8'));
  const hum = sc.objects.filter(o => o.type === 'humanoid');
  if (process.env.SUPER) hum[0].props.bodyType = 'super';
  if (process.env.SOLO) sc.objects = sc.objects.filter(o => o === hum[0] || o.type !== 'humanoid');
  const cam = sc.objects.find(o => o.type === 'camera');
  Object.assign(cam.props, JSON.parse(process.env.CAM || '{"position":[2.6,1.6,1.4],"target":[0,1.5,0.4],"fov":24}'));
  cam.anim = {};
  if (process.env.CLIP) {
    const b64 = require('fs').readFileSync(process.env.CLIP).toString('base64');
    const c = await page.evaluate(async (b64) => {
      const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i);
      return await SB.fn.retargetFBX(u.buffer, 'clip.fbx');
    }, b64);
    sc.clips = { tclip: c }; hum[0].props.animation = 'clip:tclip';
    console.log('clip frames', c.n, 'fps', c.fps);
  }
  await page.evaluate((sc) => { SB.fn.activateScene(sc); }, sc);
  await page.evaluate((s) => SB.fn.setShading(s), process.env.SHADE || 'skin');
  await page.waitForTimeout(1500);
  const frames = (process.env.FRAMES || '20,40,60,80,100,120').split(',').map(Number), last = +(process.env.LAST || Math.max(...frames));
  await page.evaluate((f) => { SB.SIM.target = f; SB.SIM.pump(); }, last);
  await page.waitForFunction((f) => SB.SIM.cache.end >= f, last, { timeout: 1800000, polling: 1000 });
  const log = await page.evaluate(() => SB.SIM.bstLog); let prev = '';
  log.forEach((s, f) => { const t = JSON.stringify(s); if (t !== prev) console.log(f, t); prev = t; });
  await page.evaluate(() => { if (!SB.APP.camView) SB.fn.toggleCamView(); });
  for (const f of frames) {
    await page.evaluate((f) => SB.fn.setFrame(f), f);
    if (process.env.HEADCAM) await page.evaluate(([f, off]) => {
      // aim the scene camera at the animated body's head (its seg 0 molecules) from a fixed offset
      const b = SB.MOL.bodies[0], P = SB.SIM.posOf(f), sg = b.data.seg; let x = 0, y = 0, z = 0, n = 0;
      for (let i = 0; i < b.count; i++) if (sg[i] === 0) { const k = 3 * (b.start + i); x += P[k]; y += P[k + 1]; z += P[k + 2]; n++; }
      const c = SB.APP.scene.objects.find(o => o.type === 'camera'); c.props.followObj = '';
      c.props.target = [x / n, y / n, z / n]; c.props.position = [x / n + off[0], y / n + off[1], z / n + off[2]]; c.props.fov = 14;
      SB.APP.dirtyEval = true; SB.fn.setFrame(f);
    }, [f, JSON.parse(process.env.HEADCAM)]);
    await page.waitForTimeout(400);
    const info = await page.evaluate(() => SB.MOL.bodies.map(b => { const st = SB.SIM.dispSt; let dm = 0, loose = 0; for (let i = b.start; i < b.start + b.count; i++) { if (st[i] === 1) dm++; else if (st[i] === 2) loose++; } return `n${b.count} dmg${dm} loose${loose}`; }));
    console.log('frame', f, info.join(' | '));
    await page.screenshot({ path: `${OUT}/t33-${process.env.TAG || 's'}-${f}.png`, timeout: 120000 });
  }
  console.log(logs.filter(l => !/GPU stall|GL Driver/.test(l)).join('\n') || 'no console errors');
  await browser.close();
})();
