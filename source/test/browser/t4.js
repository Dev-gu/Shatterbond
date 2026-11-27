const { setup, status, OUT } = require('./run.js');
(async () => {
  const { browser, page, logs } = await setup();
  await page.waitForFunction(() => window.SB);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: OUT + '/10-start.png' });
  await page.evaluate(() => { SB.SIM.target = 150; });
  const t0 = Date.now();
  await page.waitForFunction(() => SB.SIM.cache.end >= 150, null, { timeout: 120000 });
  console.log('simulated 150 frames in', ((Date.now() - t0) / 1000).toFixed(1), 's');
  const look = async (f, shade, name, cam) => {
    await page.evaluate(([f, shade, cam]) => {
      SB.APP.frame = f; SB.APP.dirtyEval = true;
      if (cam) { SB.R.camera.position.set(...cam[0]); SB.R.controls.target.set(...cam[1]); SB.R.controls.update(); }
      document.querySelector(`[data-shade="${shade}"]`).click();
    }, [f, shade, cam]);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/${name}.png` });
  };
  const close = [[2.2, 1.5, 2.6], [0, 1.0, -0.2]];
  await look(0, 'skin', '11-f0', close);
  await look(56, 'skin', '12-f56');
  await look(64, 'skin', '13-f64');
  await look(80, 'skin', '14-f80');
  await look(80, 'xray', '15-f80-xray');
  await look(80, 'tissue', '16-f80-tissue');
  await look(150, 'skin', '17-f150', [[2.6, 1.6, 0.6], [0, 0.2, -1.2]]);
  await look(150, 'xray', '18-f150-xray');
  console.log(await status(page));
  console.log(logs.filter(l => !l.includes('GPU stall')).join('\n') || 'no console errors');
  await browser.close();
})();
