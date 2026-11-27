// cache: compact frames decode accurately, still parts are shared, a full cache stops cleanly with a message
const { setup, OUT } = require('./run.js');
(async () => {
  const { browser, page, logs } = await setup();
  let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
  await page.waitForTimeout(2500);
  ok(await page.evaluate(() => SB.SIM.budget >= 1536 * 1048576), 'default cache budget is at least 1.5 GB: ' + await page.evaluate(() => SB.SIM.budget / 1048576) + ' MB');
  await page.evaluate(() => SB.fn.loadDemo('hammer')); await page.waitForTimeout(2500);
  // round trip accuracy of one frame
  const acc = await page.evaluate(() => {
    const N = 50000, pos = new Float32Array(3 * N), st = new Uint8Array(N);
    for (let i = 0; i < 3 * N; i++) pos[i] = Math.sin(i * 0.37) * (i % 3 === 1 ? 1 : 0.4) + (i > 120000 ? 30 : 0);
    SB.SIM._prevEnc = null; SB.SIM.compact = true;
    const fr = SB.SIM.encodeFrame(pos, st), out = new Float32Array(3 * N); SB.SIM.decodeFrame(fr, out, new Uint8Array(N));
    let e = 0; for (let i = 0; i < 3 * N; i++) e = Math.max(e, Math.abs(out[i] - pos[i]));
    const fr2 = SB.SIM.encodeFrame(pos.slice(), st.slice());
    SB.SIM._prevEnc = null;
    return { e, ratio: fr.bytes / (N * 13), shared: fr2.bytes / fr.bytes };
  });
  ok(acc.e < 3e-5, 'compact rounding under 0.03 mm: ' + (acc.e * 1000).toFixed(4) + ' mm');
  ok(acc.ratio < 0.62, 'compact frame is about half size: ' + acc.ratio.toFixed(2));
  ok(acc.shared < 0.02, 'an unchanged frame costs almost nothing: ' + acc.shared.toFixed(3));
  // small budget: the cache fills, says so, and playback keeps going instead of hanging
  await page.evaluate(() => { SB.SIM.budget = 12 * 1048576; SB.fn.resetSim(); SB.APP.loop = true; SB.fn.togglePlay(); });
  let full = false;
  for (let i = 0; i < 60 && !full; i++) { await page.waitForTimeout(1000); full = await page.evaluate(() => SB.SIM.cache.full); }
  ok(full, 'cache reports full');
  const st = await page.evaluate(() => ({ end: SB.SIM.cache.end, mb: SB.SIM.cache.bytes / 1048576, pill: document.querySelector('#pill-sim').textContent, toast: [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ') }));
  ok(/Cache full/.test(st.pill), 'status says cache full: ' + st.pill);
  ok(/Cache memory full at frame/.test(st.toast), 'toast explains it: ' + st.toast.slice(0, 120));
  console.log('cached frames', st.end, 'MB', st.mb.toFixed(1));
  const f1 = await page.evaluate(() => SB.APP.frame); await page.waitForTimeout(3000);
  ok(f2[2] && !f2[1] && f2[0] !== f1, `playback loops inside the cached frames instead of waiting: ${f1} -> ${f2[0]}`);
  ok(await page.evaluate(() => { const c = SB.SIM.cache; const p = new Float32Array(3 * SB.SIM.N), s = new Uint8Array(SB.SIM.N); return SB.SIM.load(c.end, p, s) && p.some(v => v !== 0); }), 'last cached frame loads');
  await page.screenshot({ path: OUT + '/t31-full.png' });
  console.log(logs.filter(l => !/favicon|GPU stall|WebGL|allocation/.test(l)).join('\n') || 'no console errors');
  console.log(fails ? `${fails} FAILED` : 'all passed');
  await browser.close(); process.exit(fails ? 1 : 0);
})();
