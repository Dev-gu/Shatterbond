// Headless smoke test: serves dist/shatterbond.html at a fake origin, maps the CDN to node_modules.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const OUT = process.env.OUT || '/tmp/sb-shots';
fs.mkdirSync(OUT, { recursive: true });
const html = fs.readFileSync(process.env.HTML || path.join(ROOT, 'dist/shatterbond.html'));
const mime = (p) => p.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';
async function setup(opts = {}) {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'].concat(process.env.WEBGPU ? ['--enable-unsafe-webgpu'] : []) });
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
  await page.route('https://app.test/**', r => r.fulfill({ body: html, contentType: 'text/html' }));
  await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**', r => {
    const rel = r.request().url().split('three@0.170.0/')[1];
    const f = path.join(ROOT, 'node_modules/three', rel);
    if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: 'nf' });
    r.fulfill({ body: fs.readFileSync(f), contentType: mime(f) });
  });
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
  await page.route('https://fonts.gstatic.com/**', r => r.abort());
  if (opts.clear !== false) await page.addInitScript(([pre, phys]) => { try { localStorage.clear(); if (pre) localStorage.setItem('shatterbond.perf', JSON.stringify(Object.assign({ preset: pre }, phys ? { physics: phys } : {}))); } catch (e) {} }, [process.env.PERFAUTO ? null : (process.env.PERF || 'high'), process.env.PHYS || null]);
  await page.goto('https://app.test/index.html');
  return { browser, page, logs };
}
const status = (page) => page.evaluate(() => ({ pill: document.querySelector('#pill-sim').textContent, fps: document.querySelector('#pill-fps').textContent, stats: document.querySelector('#status-stats').textContent, vp: document.querySelector('#vp-stats').textContent, cache: document.querySelector('.tl-cache') && document.querySelector('.tl-cache').textContent }));
module.exports = { setup, status, OUT };
if (require.main === module) (async () => {
  const { browser, page, logs } = await setup();
  await page.waitForTimeout(4000);
  console.log('after load', await status(page));
  await page.screenshot({ path: OUT + '/01-load.png' });
  await page.keyboard.press('Space');
  for (let i = 0; i < 8; i++) { await page.waitForTimeout(2500); console.log('t', (i + 1) * 2.5, await status(page)); }
  await page.screenshot({ path: OUT + '/02-play.png' });
  console.log(logs.join('\n') || 'no console errors');
  await browser.close();
})();
