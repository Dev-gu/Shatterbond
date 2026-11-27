// Interaction test: clicking, gizmo, number drag, blast, keyboard, still render, video.
const { setup, status, OUT } = require('./run.js');
(async () => {
  const { browser, page, logs } = await setup();
  await page.waitForFunction(() => window.SB);
  await page.waitForTimeout(2500);
  await page.waitForFunction(() => !/^0 molecules/.test(document.querySelector('#status-stats').textContent), null, { timeout: 120000 });
  const vp = await page.$('#viewport canvas');
  const box = await vp.boundingBox();
  // project humanoid chest to screen
  const scr = await page.evaluate(() => { const v = new SB.R.camera.constructor(); const p = SB.R.camera.position.clone(); const THREEV = p.constructor; const w = new THREEV(0, 1.2, 0).project(SB.R.camera); const r = SB.R.renderer.domElement.getBoundingClientRect(); return [r.left + (w.x + 1) / 2 * r.width, r.top + (1 - w.y) / 2 * r.height]; });
  await page.mouse.click(scr[0], scr[1]);
  await page.waitForTimeout(300);
  console.log('click select ->', await page.evaluate(() => SB.APP.sel.map(id => SB.APP.scene.objects.find(o => o.id === id).name)));
  await page.screenshot({ path: OUT + '/30-selected.png' });
  // number drag on Location X (object tab)
  await page.evaluate(() => { const t = [...document.querySelectorAll('#prop-tabs .ptab')][0]; t.click(); });
  const nf = await page.$('#prop-body .vecblock .numf');
  const nb = await nf.boundingBox();
  await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2);
  await page.mouse.down(); await page.mouse.move(nb.x + nb.width / 2 + 60, nb.y + nb.height / 2, { steps: 6 }); await page.mouse.up();
  console.log('after drag X =', await page.evaluate(() => SB.APP.scene.objects.find(o => o.type === 'humanoid').props.position[0]));
  // click to type
  await page.mouse.click(nb.x + nb.width / 2, nb.y + nb.height / 2);
  await page.keyboard.press('Control+A'); await page.keyboard.type('0.5*2'); await page.keyboard.press('Enter');
  console.log('after typing X =', await page.evaluate(() => SB.APP.scene.objects.find(o => o.type === 'humanoid').props.position[0]));
  await page.keyboard.press('Control+z');
  console.log('after undo X =', await page.evaluate(() => SB.APP.scene.objects.find(o => o.type === 'humanoid').props.position[0]));
  // gizmo programmatic drag
  const g = await page.evaluate(() => { const g = SB.R.gizmo; g.dispatchEvent({ type: 'mouseDown' }); SB.R.gizmoTarget.position.x += 0.75; g.dispatchEvent({ type: 'objectChange' }); g.dispatchEvent({ type: 'mouseUp' }); return SB.APP.scene.objects.find(o => o.type === 'humanoid').props.position; });
  console.log('gizmo move ->', g);
  // keyboard: I to keyframe, then frame 40, move, I
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.keyboard.press('i');
  await page.evaluate(() => SB.fn.setFrame(40));
  await page.evaluate(() => { const h = SB.APP.scene.objects.find(o => o.type === 'humanoid'); SB.fn.setProp(h, 'position', 2, 2); });
  await page.keyboard.press('i');
  console.log('anim channels', await page.evaluate(() => Object.keys(SB.APP.scene.objects.find(o => o.type === 'humanoid').anim)));
  await page.evaluate(() => SB.fn.setFrame(20));
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + '/31-keyed.png' });
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
  // blast tool
  await page.keyboard.press('b');
  await page.evaluate(() => SB.fn.setFrame(0));
  const scr2 = await page.evaluate(() => { const h = SB.APP.scene.objects.find(o => o.type === 'humanoid'); const P = SB.fn.evalProps(h, 0); const w = new (SB.R.camera.position.constructor)(P.position[0], 1.3, P.position[2]).project(SB.R.camera); const r = SB.R.renderer.domElement.getBoundingClientRect(); return [r.left + (w.x + 1) / 2 * r.width, r.top + (1 - w.y) / 2 * r.height]; });
  await page.mouse.click(scr2[0], scr2[1]);
  await page.waitForTimeout(200);
  console.log('blast events', await page.evaluate(() => JSON.stringify(SB.APP.scene.events)), 'playing', await page.evaluate(() => SB.APP.playing));
  await page.waitForFunction(() => SB.SIM.cache.end >= 20, null, { timeout: 60000 });
  await page.keyboard.press('Space');
  await page.evaluate(() => SB.fn.setFrame(14));
  await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + '/32-blast.png' });
  console.log('after blast', await status(page));
  await page.keyboard.press('Escape');
  // still render
  const dl = page.waitForEvent('download', { timeout: 30000 });
  await page.keyboard.press('F12');
  const d = await dl; const p = OUT + '/render.png'; await d.saveAs(p); console.log('render saved', d.suggestedFilename(), require('fs').statSync(p).size, 'bytes');
  // short video
  await page.evaluate(() => { SB.fn.setProp(SB.APP.scene.world, 'frameEnd', 40); SB.OUT.res = '720'; });
  const dl2 = page.waitForEvent('download', { timeout: 900000 });
  await page.evaluate(() => SB.fn.recordVideo());
  await page.waitForTimeout(1500);
  console.log('recording', await status(page));
  const d2 = await dl2; const p2 = OUT + '/video.' + d2.suggestedFilename().split('.').pop(); await d2.saveAs(p2); console.log('video saved', d2.suggestedFilename(), require('fs').statSync(p2).size, 'bytes');
  // and the WebM format
  await page.evaluate(() => { SB.OUT.format = 'webm'; });
  const dl3 = page.waitForEvent('download', { timeout: 900000 });
  await page.evaluate(() => SB.fn.recordVideo());
  const d3 = await dl3; const p3 = OUT + '/video.' + d3.suggestedFilename().split('.').pop(); await d3.saveAs(p3); console.log('video saved', d3.suggestedFilename(), require('fs').statSync(p3).size, 'bytes');
  console.log('frame after export', await page.evaluate(() => SB.APP.frame));
  console.log(logs.filter(l => !l.includes('GPU stall')).join('\n') || 'no console errors');
  await browser.close();
})();
