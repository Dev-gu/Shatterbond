// Headbutt into a standing body (SCENE=Aiden's file): per-frame state of the attacker (kinematic, animOff, balLost, ko, driven)
const { setup, OUT } = require('./run.js');
(async () => {
  const { browser, page, logs } = await setup();
  await page.waitForFunction(() => window.SB);
  const sc = JSON.parse(require('fs').readFileSync(process.env.SCENE, 'utf8'));
  const last = +(process.env.LAST || 150);
  await page.evaluate((sc) => { SB.fn.activateScene(sc); }, sc);
  await page.waitForTimeout(1500);
  await page.evaluate((f) => { SB.SIM.target = f; SB.SIM.pump(); }, last);
  await page.waitForFunction((f) => SB.SIM.cache.end >= f, last, { timeout: 1800000, polling: 1000 });
  const log = await page.evaluate(() => SB.SIM.bstLog);
  let prev = '';
  log.forEach((s, f) => { const t = JSON.stringify(s); if (t !== prev) console.log(f, t); prev = t; });
  const com = await page.evaluate((last) => { const out = []; for (let f = 20; f <= last; f += 4) { const P = SB.SIM.posOf(f); if (!P) continue; out.push(f + ' ' + SB.MOL.bodies.map(b => { let x = 0, y = 0, z = 0, my = 9, hy = -9; for (let i = b.start; i < b.start + b.count; i++) { x += P[3 * i]; y += P[3 * i + 1]; z += P[3 * i + 2]; my = Math.min(my, P[3 * i + 1]); hy = Math.max(hy, P[3 * i + 1]); } const n = b.count; return [x / n, y / n, z / n, my, hy].map(a => a.toFixed(2)).join(','); }).join(' | ')); } return out; }, last);
  console.log(com.join('\n'));
  await page.evaluate(() => { if (!SB.APP.camView) SB.fn.toggleCamView(); });
  for (const f of (process.env.FRAMES || '40,60,80,100,120,150').split(',').map(Number)) {
    await page.evaluate((f) => SB.fn.setFrame(f), f); await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/hb-${process.env.TAG || 's'}-${f}.png`, timeout: 120000 });
  }
  console.log(logs.filter(l => !/GPU stall|GL Driver/.test(l)).join('\n') || 'no console errors');
  await browser.close();
})();
