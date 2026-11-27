// Humanoid defaults: saving one humanoid's look makes every new humanoid start with it; demos keep theirs unless opted in.
const { setup } = require('./run.js');
(async () => {
  const { browser, page, logs } = await setup();
  await page.waitForFunction(() => window.SB);
  await page.evaluate(() => SB.fn.loadDemo('empty'));
  await page.waitForTimeout(800);
  const r = await page.evaluate(async () => {
    const h = SB.APP.scene.objects.find(o => o.type === 'humanoid');
    SB.fn.select([h.id]); SB.PROPS.want = 'object'; SB.fn.buildProps();
    h.props.skinColor = '#ff0000'; h.props.insideColor = '#00ff00'; h.props.fat = 0.5;
    SB.fn.buildProps();
    const btn = [...document.querySelectorAll('#prop-body button')].find(b => b.textContent === 'Make these my defaults');
    if (!btn) return { err: 'no button' };
    btn.click();
    const n = SB.fn.addObject('humanoid', { position: [1, 0, 0] });
    const out = { newSkin: n.props.skinColor, newInside: n.props.insideColor, newFat: n.props.fat, newPos: n.props.position };
    SB.fn.loadDemo('split'); await new Promise(r => setTimeout(r, 300));
    out.demoInside = SB.APP.scene.objects.find(o => o.type === 'humanoid').props.insideColor;
    SB.HDEF.demos = true; SB.HDEF.save();
    SB.fn.loadDemo('split'); await new Promise(r => setTimeout(r, 300));
    out.demoInsideOptIn = SB.APP.scene.objects.find(o => o.type === 'humanoid').props.insideColor;
    SB.HDEF.props = null; SB.HDEF.demos = false; SB.HDEF.save();
    return out;
  });
  console.log(JSON.stringify(r));
  const ok = r.newSkin === '#ff0000' && r.newInside === '#00ff00' && r.newFat === 0.5 && r.newPos[0] === 1 && r.demoInside === '#9e1420' && r.demoInsideOptIn === '#00ff00';
  console.log(ok ? 'PASS' : 'FAIL');
  console.log(logs.filter(l => !/GPU stall|GL Driver/.test(l)).join('\n') || 'no console errors');
  await browser.close(); process.exit(ok ? 0 : 1);
})();
