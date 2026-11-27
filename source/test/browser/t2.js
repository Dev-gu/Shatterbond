const { setup, status, OUT } = require('./run.js');
(async () => {
  const { browser, page, logs } = await setup();
  await page.evaluate(() => { window.SB_TRACE = 1; });
  await page.waitForTimeout(3500);
  console.log('load', await status(page));
  await page.screenshot({ path: OUT + '/03-load.png' });
  await page.keyboard.press('Space');
  const t0 = Date.now();
  for (let i = 0; i < 6; i++) { await page.waitForTimeout(2000); const s = await status(page); console.log(((Date.now() - t0) / 1000).toFixed(1), s.pill, '|', s.stats); }
  await page.keyboard.press('Space');
  await page.evaluate(() => { SB.APP.frame = 110; SB.APP.dirtyEval = true; });
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + '/04-f110.png' });
  await page.keyboard.press('2');
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + '/05-xray.png' });
  console.log(logs.filter(l => !l.includes('GPU stall')).join('\n') || 'no console errors');
  await browser.close();
})();
