// Saved animations: import a Mixamo FBX (CLIP=path), check it is saved, reload the app and check it is still there,
// play it on a fresh humanoid, and screenshot the Saved animations dialog.
const { setup, OUT } = require('./run.js');
(async () => {
  const { browser, page, logs } = await setup();
  await page.waitForFunction(() => window.SB && SB.ANIMLIB);
  const b64 = require('fs').readFileSync(process.env.CLIP).toString('base64');
  const r1 = await page.evaluate(async (b64) => {
    SB.DEMOS.push({ id: 't21', name: 'anim lib', world: { frameEnd: 120 }, objects: [{ type: 'humanoid', props: { position: [0, 0, 0], resolution: 'low' } }] });
    SB.fn.loadDemo('t21');
    const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i);
    SB.APP.sel = [SB.APP.scene.objects.find(o => o.type === 'humanoid').id];
    await SB.fn.importMixamo([new File([u], 'Samba Dancing.fbx')]);
    const h = SB.APP.scene.objects.find(o => o.type === 'humanoid');
    return { saved: SB.ANIMLIB.list().map(e => e.clip.name), anim: h.props.animation };
  }, b64);
  console.log('after import', JSON.stringify(r1));
  await page.reload();
  await page.waitForFunction(() => window.SB && SB.ANIMLIB);
  await page.waitForTimeout(800);
  const r2 = await page.evaluate(async () => {
    const L = SB.ANIMLIB.list();
    SB.DEMOS.push({ id: 't21b', name: 'anim lib 2', world: { frameEnd: 120 }, objects: [{ type: 'humanoid', props: { position: [0, 0, 0], resolution: 'low', animation: 'clip:' + L[0].id } }, { type: 'camera', name: 'Camera', props: { position: [2.4, 1.3, 2.4], target: [0, 1, 0], fov: 40 } }] });
    SB.fn.loadDemo('t21b');
    return { saved: L.map(e => e.clip.name + ' ' + e.clip.n + 'f'), inScene: Object.keys(SB.APP.scene.clips || {}).length };
  });
  console.log('after reload', JSON.stringify(r2));
  await page.waitForTimeout(1500);
  await page.evaluate(() => { SB.SIM.target = 60; SB.SIM.pump(); });
  await page.waitForFunction(() => SB.SIM.cache.end >= 60, null, { timeout: 600000, polling: 500 });
  await page.evaluate(() => { if (!SB.APP.camView) SB.fn.toggleCamView(); SB.fn.setFrame(60); });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/lib-play.png` });
  await page.evaluate(() => SB.fn.openAnimLibrary());
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/lib-dialog.png` });
  const opts = await page.evaluate(() => [...document.querySelectorAll('select option')].map(o => o.textContent).filter(t => /Saved/.test(t)));
  console.log('menu', JSON.stringify(opts));
  console.log(logs.filter(l => !/GPU stall|GL Driver/.test(l)).join('\n') || 'no console errors');
  await browser.close();
})();
