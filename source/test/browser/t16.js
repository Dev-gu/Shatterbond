// Camera shots: two cameras with shot starts; the scene camera must switch at the cut, in the viewport and in output.
const { setup, OUT } = require('./run.js');
(async () => {
  const { browser, page, logs } = await setup();
  await page.waitForFunction(() => window.SB);
  const r = await page.evaluate(() => {
    SB.DEMOS.push({ id: 't16', name: 'shots', world: { frameEnd: 120 }, objects: [
      { type: 'humanoid', props: { resolution: 'low' } },
      { type: 'camera', name: 'Wide', props: { position: [5, 2, 6], target: [0, 1, 0], fov: 40, shotStart: 0 } },
      { type: 'camera', name: 'Close', props: { position: [0.3, 1.6, 1.6], target: [0, 1.5, 0], fov: 35, shotStart: 40 } }] });
    SB.fn.loadDemo('t16');
    const names = [];
    for (const f of [0, 39, 40, 80]) { SB.fn.setFrame(f); names.push(f + ":" + SB.fn.sceneCam(f).name); }
    return names;
  });
  console.log('active cameras', r.join(' '));
  await page.evaluate(() => { SB.fn.setFrame(10); if (!SB.APP.camView) SB.fn.toggleCamView(); });
  await page.waitForTimeout(600);
  const pos1 = await page.evaluate(() => SB.R.camera.position.toArray().map(v => +v.toFixed(2)));
  await page.evaluate(() => SB.fn.setFrame(60));
  await page.waitForTimeout(600);
  const pos2 = await page.evaluate(() => SB.R.camera.position.toArray().map(v => +v.toFixed(2)));
  console.log('view at 10', pos1, 'view at 60', pos2);
  const bx = await page.locator('#viewport canvas').first().boundingBox();
  await page.screenshot({ path: `${OUT}/shot-60.png`, clip: bx });
  // the timeline shows the shot marks
  await page.screenshot({ path: `${OUT}/shot-timeline.png` });
  const ok = r.join(' ') === '0:Wide 39:Wide 40:Close 80:Close' && pos1[2] > 5 && pos2[2] < 2;
  console.log(logs.filter(l => !/GPU stall|GL Driver/.test(l)).join('\n') || 'no console errors');
  console.log(ok ? 'PASS' : 'FAIL');
  await browser.close();
})();
