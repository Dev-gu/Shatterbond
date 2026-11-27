// Desktop build: the page served by the launcher must boot with no internet.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = [], external = [];
  page.on('console', m => { if (m.type() === 'error') logs.push(m.text()); });
  page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => { external.push(r.request().url()); r.abort(); });
  await page.goto('http://127.0.0.1:47231/');
  await page.waitForFunction(() => window.SB, null, { timeout: 30000 });
  await page.waitForTimeout(3000);
  console.log(await page.evaluate(() => ({ secure: isSecureContext, webcodecs: typeof VideoEncoder, title: document.title, icon: document.querySelector('link[rel=icon]')?.href, molecules: SB.SIM.N })));
  await page.screenshot({ path: '/tmp/sb-shots/60-desktop.png' });
  console.log('blocked external requests:', external.map(u => u.split('?')[0]));
  console.log(logs.filter(l => !/fonts\.g|ERR_FAILED|net::/.test(l)).join('\n') || 'no app errors');
  await browser.close();
})();
