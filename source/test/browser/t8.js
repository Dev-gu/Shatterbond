// Layout at phone and tablet sizes.
const { setup, OUT } = require('./run.js');
(async () => {
  for (const [w, h] of [[390, 844], [1024, 700]]) {
    const { browser, page, logs } = await setup({ viewport: { width: w, height: h } });
    await page.waitForFunction(() => window.SB);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${OUT}/50-layout-${w}.png` });
    const over = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bw: document.body.scrollWidth }));
    console.log(w, over);
    console.log(logs.filter(l => !l.includes('GPU stall')).join('\n') || 'no console errors');
    await browser.close();
  }
})();
