// Broad UI smoke test: every demo, every object type, every panel, menus, keyframes, undo.
const { setup, status, OUT } = require('./run.js');
(async () => {
  const { browser, page, logs } = await setup();
  await page.waitForFunction(() => window.SB);
  await page.waitForTimeout(1500);
  const step = async (name, fn, arg) => { try { const r = await page.evaluate(fn, arg); console.log('ok  ', name, r !== undefined ? JSON.stringify(r).slice(0, 160) : ''); } catch (e) { console.log('FAIL', name, e.message.split('\n')[0]); } };
  // all demos: load, simulate a few frames
  const demos = await page.evaluate(() => SB.DEMOS.map(d => d.id));
  for (const id of demos) {
    await step('demo ' + id, (id) => { SB.fn.loadDemo(id); SB.SIM.target = 12; return SB.APP.scene.objects.length; }, id);
    try { await page.waitForFunction(() => SB.SIM.cache.end >= 12 || !SB.SIM.bodyObjs().length, null, { timeout: 60000 }); } catch (e) { console.log('FAIL sim timeout', id, JSON.stringify(await status(page))); }
    const st = await page.evaluate(() => ({ N: SB.SIM.N, end: SB.SIM.cache.end, broken: SB.SIM.broken, ms: SB.SIM.ms }));
    console.log('     ', id, JSON.stringify(st));
  }
  await page.screenshot({ path: OUT + '/20-lastdemo.png' });
  // add every type and open every tab
  await step('new empty', () => { SB.fn.loadDemo('empty'); return true; });
  const types = await page.evaluate(() => Object.keys(SB.TYPES));
  for (const t of types) {
    await step('add ' + t, (t) => { const o = SB.fn.addObjectAtCursor(t); const tabs = [...document.querySelectorAll('#prop-tabs .ptab')]; const out = []; for (const b of tabs) { b.click(); out.push(document.querySelectorAll('#prop-body .row').length); } return out; }, t);
  }
  await step('evaluate all', () => { SB.APP.dirtyEval = true; return SB.APP.scene.objects.length; });
  await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + '/21-alltypes.png' });
  // keyframes + motion presets
  await step('keyframe', () => { const h = SB.APP.scene.objects.find(o => o.type === 'cube'); SB.fn.select([h.id]); SB.fn.setFrame(0); SB.fn.insertKeyframeSelected(); SB.fn.setFrame(60); SB.fn.setProp(h, 'position', 3, 0); SB.fn.insertKeyframeSelected(); SB.fn.setFrame(30); return [Object.keys(h.anim).length, SB.fn.evalProps(h, 30).position[0].toFixed(3)]; });
  for (const m of await page.evaluate(() => SB.MOTIONS.map(m => m.id))) {
    await step('motion ' + m, (m) => { const mm = SB.MOTIONS.find(x => x.id === m); const o = SB.APP.scene.objects.find(o => mm.ok(o)) || null; if (o) SB.fn.select([o.id]); SB.fn.applyMotion(m); return o ? o.type : 'world'; }, m);
  }
  await step('timeline rows', () => { SB.fn.select(SB.APP.scene.objects.map(o => o.id)); SB.TL.rebuildLabels(); SB.TL.draw(); return SB.TL.rows.length; });
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + '/22-timeline.png' });
  await step('undo x5', () => { for (let i = 0; i < 5; i++) SB.fn.doUndo(); return SB.APP.scene.objects.length; });
  await step('redo x2', () => { for (let i = 0; i < 2; i++) SB.fn.doRedo(); return SB.APP.scene.objects.length; });
  await step('duplicate/delete', () => { SB.fn.select([SB.APP.scene.objects[0].id]); SB.fn.duplicateSelected(); const n = SB.APP.scene.objects.length; SB.fn.deleteSelected(); return [n, SB.APP.scene.objects.length]; });
  // menus
  const menus = await page.$$eval('#menus .menu-btn', bs => bs.map(b => b.textContent));
  for (const m of menus) {
    await page.click(`#menus .menu-btn:text-is("${m}")`);
    await page.waitForTimeout(150);
    const n = await page.$$eval('.dropdown .mi', x => x.length);
    console.log('ok   menu', m, n, 'items');
    if (m === 'Add') await page.screenshot({ path: OUT + '/23-addmenu.png' });
    await page.keyboard.press('Escape');
  }
  await step('library', () => { SB.fn.saveSceneCmd(false); SB.fn.openLibrary(); return document.querySelectorAll('.scard').length; });
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + '/24-library.png' });
  await page.keyboard.press('Escape');
  await step('shortcuts', () => { SB.fn.showShortcuts(); return document.querySelectorAll('.keys div').length; });
  await page.screenshot({ path: OUT + '/25-shortcuts.png' });
  await page.keyboard.press('Escape');
  await step('tissue tab', () => { document.querySelectorAll('#prop-tabs .ptab')[document.querySelectorAll('#prop-tabs .ptab').length - 2].click(); return document.querySelectorAll('#prop-body .group').length; });
  await page.screenshot({ path: OUT + '/26-tissues.png' });
  await step('cam view', () => { SB.fn.toggleCamView(); return SB.APP.camView; });
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + '/27-camview.png' });
  await step('cam view off', () => { SB.fn.toggleCamView(); return SB.APP.camView; });
  console.log(logs.filter(l => !l.includes('GPU stall')).join('\n') || 'no console errors');
  await browser.close();
})();
