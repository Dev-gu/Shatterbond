// Phone layout: portrait phone, screenshots of the editor, the panel sheet and playback.
const { setup, OUT } = require('./run.js');
(async () => {
  const { browser, page, logs } = await setup({ viewport: { width: 390, height: 844 } });
  await page.waitForFunction(() => window.SB);
  await page.evaluate(() => SB.fn.loadDemo('hammer'));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/m-editor.png` });
  const lay = await page.evaluate(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; }; return { vp: r('#viewport'), tools: r('#toolbar'), tl: r('#timeline'), fab: r('#fab-play'), side: r('#side'), sw: document.documentElement.scrollWidth }; });
  console.log('layout', JSON.stringify(lay));
  await page.click('#side-toggle');
  await page.waitForTimeout(500);
  await page.evaluate(() => { const h = SB.APP.scene.objects.find(o => o.type === 'humanoid'); SB.fn.select([h.id]); });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/m-sheet.png` });
  await page.click('#sheet-grab');
  await page.waitForTimeout(400);
  await page.click('#fab-play');
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${OUT}/m-play.png` });
  console.log('playing', await page.evaluate(() => SB.APP.playing), 'frame', await page.evaluate(() => SB.APP.frame));
  console.log(logs.filter(l => !/GPU stall|GL Driver/.test(l)).join('\n') || 'no console errors');
  await browser.close();
})();
