const { setup } = require('./run.js');
(async () => { const { browser, page, logs } = await setup(); await page.waitForTimeout(5000); console.log(logs.join('\n')); await browser.close(); })();
