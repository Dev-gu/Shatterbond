// Skinning strain: plays a clip and lists the most stretched bonds (posed / rest length) with the weights of both ends.
// env: ANIM (idle), FRAME (10), RES (medium), TOP (25)
const { setup } = require('./run.js');
(async () => {
  const { browser, page, logs } = await setup();
  await page.waitForFunction(() => window.SB);
  const anim = process.env.ANIM || 'idle', f = +(process.env.FRAME || 10);
  await page.evaluate(([anim, res]) => {
    SB.DEMOS.push({ id: 't20', name: 'strain', world: { frameEnd: 200 }, objects: [{ type: 'humanoid', props: { position: [0, 0, 0], animation: anim, animMove: false, resolution: res } }] });
    SB.fn.loadDemo('t20');
  }, [anim, process.env.RES || 'medium']);
  await page.waitForTimeout(1500);
  await page.evaluate((f) => { SB.SIM.target = f; SB.SIM.pump(); }, f);
  await page.waitForFunction((f) => SB.SIM.cache.end >= f, f, { timeout: 600000, polling: 500 });
  const out = await page.evaluate(([f, top]) => {
    SB.fn.setFrame(f);
    const L = SB.SIM.layout[0], d = L.data, p = new Float32Array(SB.SIM.disp.length), st = new Uint8Array(SB.SIM.dispSt.length);
    SB.SIM.load(f, p, st);
    const o = 3 * L.start, B = d.bonds, r = d.rest, res = [];
    const hist = [0, 0, 0, 0, 0];
    for (let q = 0; q < B.length; q += 2) {
      const i = B[q], j = B[q + 1];
      const l0 = Math.hypot(r[3 * i] - r[3 * j], r[3 * i + 1] - r[3 * j + 1], r[3 * i + 2] - r[3 * j + 2]);
      const l1 = Math.hypot(p[o + 3 * i] - p[o + 3 * j], p[o + 3 * i + 1] - p[o + 3 * j + 1], p[o + 3 * i + 2] - p[o + 3 * j + 2]);
      const k = l1 / l0; hist[k < 1.2 ? 0 : k < 1.5 ? 1 : k < 2 ? 2 : k < 3 ? 3 : 4]++;
      if (k > 1.5) res.push([k, i, j]);
    }
    res.sort((a, b) => b[0] - a[0]);
    const w = (i) => { const a = []; for (let k = 0; k < 4; k++) if (d.skw[4 * i + k]) a.push(d.sk[4 * i + k] + ':' + d.skw[4 * i + k]); return a.join(' '); };
    const P = (i) => [r[3 * i], r[3 * i + 1], r[3 * i + 2]].map(v => v.toFixed(3)).join(',');
    return { hist, top: res.slice(0, top).map(([k, i, j]) => `${k.toFixed(2)}  ${P(i)} seg${d.seg[i]} [${w(i)}]  |  ${P(j)} seg${d.seg[j]} [${w(j)}]`) };
  }, [f, +(process.env.TOP || 25)]);
  console.log('bond stretch histogram <1.2, <1.5, <2, <3, >3:', out.hist.join(', '));
  console.log(out.top.join('\n'));
  console.log(logs.filter(l => !/GPU stall|GL Driver/.test(l)).join('\n') || 'no console errors');
  await browser.close();
})();
