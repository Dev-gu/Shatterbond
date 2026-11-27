const { setup, status, OUT } = require('./run.js');
(async () => {
  const { browser, page, logs } = await setup();
  const all = [];
  page.on('console', m => all.push(m.text()));
  await page.waitForFunction(() => window.SB);
  await page.evaluate(() => { window.SB_TRACE = 1; const b = SB.UI.busy; SB.UI.busy = function (t, p) { console.log('BUSY', JSON.stringify(t), new Error().stack.split('\n').slice(2, 4).join(' | ')); return b.call(this, t, p); }; });
  await page.waitForTimeout(4000);
  console.log(all.filter(x => !x.includes('GPU stall')).join('\n'));
  console.log(await page.evaluate(() => ({ hidden: document.querySelector('#busy').hidden, layoutBusy: !!SB.SIM.layoutBusy, dirty: SB.SIM.layoutDirty, tok: SB.SIM.token })));
  await browser.close();
})();
