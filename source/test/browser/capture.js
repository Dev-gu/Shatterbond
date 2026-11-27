// Captures the engine build message and step inputs a demo sends to the physics worker, for replay in node (test/node/replay.js).
const { setup } = require('./run.js');
const fs = require('fs');
const demo = process.argv[2] || 'spikes', out = process.argv[3] || '/tmp/cap.json';
(async () => {
  const { browser, page } = await setup();
  await page.waitForFunction(() => window.SB && SB.SIM.worker);
  await page.evaluate(() => {
    window.__cap = { build: null, steps: [] };
    const w = SB.SIM.worker, pm = w.postMessage.bind(w);
    const enc = (v) => (ArrayBuffer.isView(v) ? { __t: v.constructor.name, d: Array.from(v) } : Array.isArray(v) ? v.map(enc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v);
    w.postMessage = (m, tr) => { if (m.type === 'build') __cap.build = JSON.stringify(enc(m.data)); else if (m.type === 'step' && __cap.steps.length < 400) __cap.steps.push(JSON.stringify(enc(m.input))); return pm(m, tr); };
  });
  await page.evaluate((d) => SB.fn.loadDemo(d), demo);
  await page.waitForTimeout(1500);
  await page.evaluate(() => { SB.SIM.target = 60; SB.SIM.pump(); });
  await page.waitForFunction(() => SB.SIM.cache.end >= 60, null, { timeout: 500000, polling: 500 });
  const cap = await page.evaluate(() => '{"build":' + __cap.build + ',"steps":[' + __cap.steps.join(',') + ']}');
  fs.writeFileSync(out, cap); console.log('saved', out, (cap.length / 1e6).toFixed(1) + ' MB');
  await browser.close();
})();
