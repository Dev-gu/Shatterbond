// Default shading is Molecule view, and no kidney molecules show on the back of the default body
const { setup, OUT } = require('./run.js');
(async () => {
  const { browser, page, logs } = await setup();
  await page.waitForFunction(() => window.SB && SB.MOL);
  console.log('default shading', await page.evaluate(() => SB.MOL.shading));
  await page.evaluate(() => SB.fn.loadDemo('hammer'));
  await page.waitForTimeout(3000);
  await page.evaluate(() => { SB.R.camera.position.set(0, 1.15, -1.5); SB.R.controls.target.set(0, 1.05, 0); SB.R.controls.update(); SB.APP.dirtyEval = true; });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${OUT}/back.png`, timeout: 300000 });
  console.log(logs.filter(l => !/GPU stall|GL Driver/.test(l)).join('\n') || 'no console errors');
  await browser.close();
})();
