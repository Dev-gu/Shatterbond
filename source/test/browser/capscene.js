// Captures the engine build + step inputs for a saved scene (SCENE=<json>, LAST=<frames>) for node replay/profiling (test/node/replay.js, prof.js).
const { setup } = require('./run.js');
const fs = require('fs');
const out = process.argv[2] || '/tmp/capscene.json', last = +(process.env.LAST || 40);
(async () => {
  const { browser, page } = await setup();
  await page.waitForFunction(() => window.SB && SB.SIM.worker);
  await page.evaluate(() => {
    window.__cap = { build: null, steps: [] };
    const w = SB.SIM.worker, pm = w.postMessage.bind(w);
    const enc = (v) => (ArrayBuffer.isView(v) ? { __t: v.constructor.name, d: Array.from(v) } : Array.isArray(v) ? v.map(enc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v);
    w.postMessage = (m, tr) => { if (m.type === 'build') { __cap.build = JSON.stringify(enc(m.data)); __cap.steps = []; } else if (m.type === 'step' && __cap.steps.length < 400) __cap.steps.push(JSON.stringify(enc(m.input))); return pm(m, tr); };
  });
  const sc = JSON.parse(fs.readFileSync(process.env.SCENE, 'utf8'));
  await page.evaluate((sc) => SB.fn.activateScene(sc), sc);
  await page.waitForTimeout(1500);
  const t0 = Date.now();
  await page.evaluate((f) => { SB.SIM.target = f; SB.SIM.pump(); }, last);
  let lastEnd = -1;
  while (true) { const e = await page.evaluate(() => SB.SIM.cache.end); if (e !== lastEnd) { console.log('frame', e, ((Date.now() - t0) / 1000).toFixed(0) + 's'); lastEnd = e; } if (e >= last) break; await page.waitForTimeout(3000); }
  const cap = await page.evaluate(() => '{"build":' + __cap.build + ',"steps":[' + __cap.steps.join(',') + ']}');
  fs.writeFileSync(out, cap); console.log('saved', out, (cap.length / 1e6).toFixed(1) + ' MB');
  await browser.close();
})();
