// play mode: arena builds, live sim steps, a pistol shot tears a dummy, spawning appends a body, keys, exit restores the editor
const { setup, OUT } = require('./run.js');
(async () => {
  const { browser, page, logs } = await setup();
  let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
  await page.waitForTimeout(2500);
  const before = await page.evaluate(() => SB.APP.scene.name);
  await page.evaluate(() => SB.fn.enterPlay('fps'));
  await page.waitForFunction(() => SB.PLAY.ready, null, { timeout: 120000 });
  ok(await page.evaluate(() => SB.SIM.layout.length === 3 && document.body.classList.contains('play-on')), 'arena with 3 dummies');
  await page.waitForTimeout(3000);
  const s1 = await page.evaluate(() => ({ steps: SB.PLAY.simT, broken: SB.SIM.broken }));
  ok(s1.steps > 0.04, `live sim runs: ${s1.steps.toFixed(2)} s simulated`);
  await page.screenshot({ path: OUT + '/t35-arena.png' });
  // shoot the middle dummy in the chest
  await page.evaluate(() => { const P = SB.PLAY; P.pos.set(0, 0, 1); P.yaw = 0; P.pitch = -0.15; P.gun = 0;
    const o = new SB.fn.V3(0, 1.65, 1), d = new SB.fn.V3(0, 1.25 - 1.65, -3).normalize(); for (let k = 0; k < 3; k++) SB.fn.playFire(o, d); });
  await page.waitForTimeout(4000);
  const s2 = await page.evaluate(() => SB.SIM.broken);
  ok(s2 > s1.broken + 50, `pistol shots tear the dummy: ${s1.broken} -> ${s2} bonds broken`);
  await page.screenshot({ path: OUT + '/t35-shot.png' });
  // cannon + rocket
  await page.evaluate(() => { SB.PLAY.gun = 3; SB.fn.playFire(new SB.fn.V3(-1.6, 1.3, 1), new SB.fn.V3(0, 0, -1)); SB.PLAY.gun = 5; SB.fn.playFire(new SB.fn.V3(1.6, 1.65, 1), new SB.fn.V3(0, -0.2, -1).normalize()); });
  await page.waitForTimeout(1500);
  ok(await page.evaluate(() => SB.PLAY.balls.size >= 1), 'cannonball is a live engine ball');
  // spawn
  const n0 = await page.evaluate(() => SB.SIM.N);
  await page.evaluate(() => SB.fn.playSpawn(0, new SB.fn.V3(0, 0, -0.2), 0));
  await page.waitForFunction((n) => SB.SIM.layout.length === 4 && SB.SIM.N > n, n0, { timeout: 60000 });
  const keep = await page.evaluate(() => SB.SIM.broken);
  await page.waitForTimeout(2500);
  const s3 = await page.evaluate(() => ({ N: SB.SIM.N, broken: SB.SIM.broken, disp: SB.SIM.disp.length, nan: Array.from(SB.SIM.disp).some(v => !isFinite(v)) }));
  ok(s3.broken >= keep && s3.disp === 3 * s3.N && !s3.nan, `spawned 4th body into the running sim, damage kept (${keep} -> ${s3.broken}), N=${s3.N}`);
  await page.evaluate(() => SB.fn.playSpawn(3, new SB.fn.V3(1, 0, 0), 0));
  await page.waitForFunction(() => SB.SIM.layout.length === 5, null, { timeout: 60000 });
  ok(true, 'ragdoll drop spawned');
  // grab the left dummy's head and yank it up and back (what a VR grip or fist does)
  const g0 = await page.evaluate(() => { const L = SB.SIM.layout[0]; let hi = L.start; for (let i = L.start; i < L.start + L.data.count; i++) if (SB.SIM.disp[3 * i + 1] > SB.SIM.disp[3 * hi + 1]) hi = i;
    const p = [SB.SIM.disp[3 * hi], SB.SIM.disp[3 * hi + 1] - 0.08, SB.SIM.disp[3 * hi + 2]]; SB.PLAY.grab.set('test', { p, q: [0, 0, 0, 1], r: 0.09 }); return { p, broken: SB.SIM.broken, hi }; });
  for (let k = 0; k < 12; k++) { await page.evaluate((k) => { const g = SB.PLAY.grab.get('test'); g.p = [g.p[0], g.p[1] + 0.08, g.p[2] + 0.05]; }, k); await page.waitForTimeout(250); }
  const g1 = await page.evaluate((hi) => ({ y: SB.SIM.disp[3 * hi + 1], broken: SB.SIM.broken, held: SB.PLAY.grab.size }), g0.hi);
  ok(g1.y > g0.p[1] + 0.2, `grabbed head follows the hand: y ${g0.p[1].toFixed(2)} -> ${g1.y.toFixed(2)}, bonds ${g0.broken} -> ${g1.broken}`);
  await page.screenshot({ path: OUT + '/t35-grab.png', timeout: 60000 }).catch(() => console.log('(grab screenshot timed out in SwiftShader)'));
  await page.evaluate(() => SB.PLAY.grab.delete('test'));
  // keyboard: walk forward
  await page.mouse.click(400, 300);
  const z0 = await page.evaluate(() => SB.PLAY.pos.z);
  await page.keyboard.down('KeyW'); await page.waitForTimeout(600); await page.keyboard.up('KeyW');
  const z1 = await page.evaluate(() => SB.PLAY.pos.z);
  ok(z1 < z0 - 0.2, `W walks forward ${z0.toFixed(2)} -> ${z1.toFixed(2)}`);
  await page.keyboard.press('Tab'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => !document.querySelector('#pl-menu').hidden && document.querySelectorAll('#pl-menu .pl-btn').length > 10), 'Tab opens the spawn menu');
  await page.screenshot({ path: OUT + '/t35-menu.png', timeout: 60000 }).catch(() => console.log('(menu screenshot timed out)'));
  await page.evaluate(() => SB.fn.exitPlay());
  await page.waitForTimeout(1500);
  ok(await page.evaluate((b) => SB.APP.scene.name === b && !document.body.classList.contains('play-on'), before), 'exit restores the editor scene');
  console.log(logs.filter(l => !/favicon|GPU stall|WebGL/.test(l)).join('\n') || 'no console errors');
  console.log(fails ? `${fails} FAILED` : 'all passed');
  await browser.close(); process.exit(fails ? 1 : 0);
})();
