// GPU physics smoke test: WEBGPU=1 PHYS=gpu node test/browser/tgpu.js [demo] [frame]
const { setup, OUT } = require('./run.js');
const demo = process.argv[2] || 'hammer', last = +(process.argv[3] || 60);
(async () => {
  const { browser, page, logs } = await setup();
  await page.waitForFunction(() => window.SB);
  console.log('webgpu in page:', await page.evaluate(() => !!navigator.gpu));
  await page.evaluate((d) => SB.fn.loadDemo(d), demo);
  await page.waitForTimeout(1500);
  const t0 = Date.now();
  await page.evaluate((f) => { SB.SIM.target = f; SB.SIM.pump(); }, last);
  try { await page.waitForFunction((f) => SB.SIM.cache.end >= f, last, { timeout: 400000, polling: 500 }); } catch (e) { console.log('timeout'); }
  console.log('sim', ((Date.now() - t0) / 1000).toFixed(1) + 's', await page.evaluate(() => JSON.stringify({ ph: SB.SIM.physics, ms: SB.SIM.ms, end: SB.SIM.cache.end, broken: SB.SIM.broken })));
  await page.evaluate((f) => SB.fn.setFrame ? SB.fn.setFrame(f) : (SB.APP.frame = f), last);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/gpu-${demo}-${last}-${process.env.PHYS || 'cpu'}.png` });
  console.log(logs.slice(0, 8).join('\n') || 'no console errors');
  await browser.close();
})();
