// Color edits must not throw away simulated frames; physics edits must.
const { setup } = require('./run.js');
(async () => {
  const { browser, page, logs } = await setup();
  await page.waitForFunction(() => window.SB);
  await page.evaluate(() => SB.fn.loadDemo('hammer'));
  await page.waitForTimeout(1500);
  await page.evaluate(() => { SB.SIM.target = 40; SB.SIM.pump(); });
  await page.waitForFunction(() => SB.SIM.cache.end >= 40, null, { timeout: 600000, polling: 500 });
  const r = await page.evaluate(() => {
    const h = SB.APP.scene.objects.find(o => o.type === 'humanoid');
    const before = SB.SIM.cache.end;
    SB.fn.setProp(h, 'insideColor', '#20a050'); const afterColor = SB.SIM.cache.end;
    SB.fn.setProp(h, 'skinColor', '#ffcc99'); const afterSkin = SB.SIM.cache.end;
    SB.fn.setProp(h, 'shatter', h.props.shatter); const afterSame = SB.SIM.cache.end;
    SB.fn.setProp(h, 'shatter', 12); const afterPhys = SB.SIM.cache.end;
    return { before, afterColor, afterSkin, afterSame, afterPhys };
  });
  await page.waitForTimeout(800);
  r.inside = await page.evaluate(() => SB.MOL.bodies[0].mc);
  console.log(JSON.stringify(r));
  const ok = r.afterColor === r.before && r.afterSkin === r.before && r.afterSame === r.before && r.afterPhys === -1 && Math.abs(r.inside[1] - 0xa0 / 255) < 0.02 && Math.abs(r.inside[0] - 0x20 / 255) < 0.02;
  console.log(ok ? 'PASS' : 'FAIL');
  console.log(logs.filter(l => !/GPU stall|GL Driver/.test(l)).join('\n') || 'no console errors');
  await browser.close();
})();
