// Render effects: motion blur + depth of field in camera view and in a still render; checks the image differs
// from a plain render and that nothing throws.
const { setup, OUT } = require('./run.js');
(async () => {
  const { browser, page, logs } = await setup();
  await page.waitForFunction(() => window.SB);
  await page.evaluate((d) => SB.fn.loadDemo(d), process.env.DEMO || 'hammer');
  await page.waitForTimeout(1500);
  const F = +(process.env.F || 40);
  await page.evaluate((f) => { SB.SIM.target = f + 2; SB.SIM.pump(); }, F);
  await page.waitForFunction((f) => SB.SIM.cache.end >= f + 1, F, { timeout: 600000, polling: 500 });
  await page.evaluate((f) => { SB.fn.setFrame(f); SB.fn.toggleCamView(); }, F);
  const shot = async (name) => { await page.waitForTimeout(900); const bx = await page.locator('#viewport canvas').first().boundingBox(); await page.screenshot({ path: `${OUT}/fx-${name}.png`, clip: bx }); return page.evaluate(() => { const c = document.querySelector('#viewport canvas'); const g = document.createElement('canvas'); g.width = 64; g.height = 36; g.getContext('2d').drawImage(c, 0, 0, 64, 36); return Array.from(g.getContext('2d').getImageData(0, 0, 64, 36).data); }); };
  await page.evaluate(() => { SB.FXS.mblur = false; SB.FXS.dof = false; });
  const a = await shot('plain');
  await page.evaluate(() => { SB.FXS.dof = true; });
  const b = await shot('dof');
  await page.evaluate(() => { SB.FXS.dof = false; SB.FXS.mblur = true; SB.FXS.samples = 8; });
  const c = await shot('mblur');
  await page.evaluate(() => { SB.FXS.dof = true; });
  const d = await shot('both');
  const diff = (x, y) => { let s = 0; for (let i = 0; i < x.length; i++) s += Math.abs(x[i] - y[i]); return (s / x.length).toFixed(2); };
  console.log('diff dof', diff(a, b), 'mblur', diff(a, c), 'both', diff(a, d));
  const ok = diff(a, b) > 0.3 && diff(a, c) > 0.05 && !logs.some(l => /pageerror|error/.test(l) && !/GL Driver/.test(l));
  console.log(logs.filter(l => !/GL Driver|GPU stall/.test(l)).join('\n') || 'no console errors');
  console.log(ok ? 'PASS' : 'FAIL');
  await browser.close();
})();
