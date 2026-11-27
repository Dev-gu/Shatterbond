// Loop playback: with bodies in the scene, playback past the end frame wraps to the start (loop on) or stops (loop off).
const { setup } = require('./run.js');
(async () => {
  const { browser, page, logs } = await setup();
  await page.waitForFunction(() => window.SB);
  await page.evaluate(() => SB.fn.loadDemo('hammer'));
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const W = SB.APP.scene.world.props; W.frameStart = 0; W.frameEnd = 20; SB.SIM.target = 20; SB.SIM.pump(); });
  await page.waitForFunction(() => SB.SIM.cache.end >= 20, null, { timeout: 600000, polling: 500 });
  const run = async (loop) => {
    await page.evaluate((l) => { SB.APP.loop = l; SB.fn.setFrame(10); if (!SB.APP.playing) SB.fn.togglePlay(); }, loop);
    const seen = [];
    for (let i = 0; i < 30; i++) { seen.push(await page.evaluate(() => [SB.APP.frame, SB.APP.playing, SB.SIM.cache.start, SB.SIM.cache.end, SB.APP.waiting, Math.round(SB.SIM.cache && 0 || 0)])); await page.waitForTimeout(100); }
    await page.evaluate(() => { if (SB.APP.playing) SB.fn.togglePlay(); });
    return seen;
  };
  const a = await run(true), fa = a.map(x => x[0]); console.log(JSON.stringify(a.slice(0,6)));
  const wrapped = fa.some((f, i) => i > 0 && f < fa[i - 1]);
  console.log('loop on frames', fa.join(' '), wrapped ? 'PASS wrapped' : 'FAIL no wrap');
  const b = await run(false), fb = b.map(x => x[0]);
  const stopped = b[b.length - 1][0] === 20 && !b[b.length - 1][1];
  console.log('loop off frames', fb.join(' '), stopped ? 'PASS stopped at end' : 'FAIL');
  console.log(logs.join('\n') || 'no console errors');
  await browser.close();
  process.exit(wrapped && stopped ? 0 : 1);
})();
