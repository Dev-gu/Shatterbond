// Performance panel: auto-detect runs, presets change renderer settings, the panel renders without errors.
process.env.PERFAUTO = '1';
const { setup } = require('./run.js');
(async () => {
  const { browser, page, logs } = await setup();
  await page.waitForFunction(() => window.SB && SB.PERF.detected);
  const r = await page.evaluate(async () => {
    const out = { detected: SB.PERF.detected, preset: SB.PERF.preset, tier: SB.PERF.autoTier };
    SB.PROPS.want = 'render'; SB.fn.select([]); SB.fn.buildProps();
    const sel = [...document.querySelectorAll('#prop-body select')].find(s => s.getAttribute('aria-label') === 'Quality preset');
    out.hasPanel = !!sel;
    sel.value = 'low'; sel.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 300));
    out.lowShadow = SB.R.renderer.shadowMap.type; out.lowPR = SB.OUT.pixelRatio; out.lowCap = SB.PERF.fpsCap;
    const sel2 = [...document.querySelectorAll('#prop-body select')].find(s => s.getAttribute('aria-label') === 'Quality preset');
    sel2.value = 'ultra'; sel2.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 300));
    out.ultraRes = SB.R.sun.shadow.mapSize.x; out.ultraCap = SB.PERF.fpsCap;
    const sel3 = [...document.querySelectorAll('#prop-body select')].find(s => s.getAttribute('aria-label') === 'Shadows');
    sel3.value = 'off'; sel3.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 300));
    out.customPreset = SB.PERF.preset; out.shadowsOn = SB.R.renderer.shadowMap.enabled;
    return out;
  });
  console.log(JSON.stringify(r));
  const ok = r.hasPanel && r.detected && r.detected.cls === 'software' && r.tier === 'potato' && r.lowShadow === 1 && r.lowPR === '0.75' && r.lowCap === 60 && r.ultraRes === 4096 && r.ultraCap === 0 && r.customPreset === 'custom' && r.shadowsOn === false;
  console.log(ok ? 'PASS' : 'FAIL');
  console.log(logs.filter(l => !/GPU stall|GL Driver/.test(l)).join('\n') || 'no console errors');
  await browser.close(); process.exit(ok ? 0 : 1);
})();
