// Prints broken-bond count as a demo simulates, every ~20 frames (compare builds with HTML=<file>).
const { setup } = require('./run.js');
const demo = process.argv[2] || 'cannon', last = +(process.argv[3] || 260);
(async () => {
  const { browser, page } = await setup();
  await page.waitForFunction(() => window.SB);
  await page.evaluate((d) => SB.fn.loadDemo(d), demo);
  await page.waitForTimeout(1500);
  await page.evaluate((f) => { SB.SIM.target = f; SB.SIM.pump(); }, last);
  let lastF = -20;
  for (;;) {
    const s = await page.evaluate(() => ({ f: SB.SIM.cache.end, b: SB.SIM.broken }));
    if (s.f - lastF >= 20 || s.f >= last) { console.log(`f${s.f} broken=${s.b}`); lastF = s.f; }
    if (s.f >= last) break;
    await page.waitForTimeout(1000);
  }
  await browser.close();
})();
