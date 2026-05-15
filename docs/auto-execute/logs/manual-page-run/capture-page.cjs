const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e)));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.goto('http://127.0.0.1:5177', { waitUntil: 'networkidle', timeout: 30000 });
  await page.screenshot({ path: process.argv[2], fullPage: true });
  const title = await page.title();
  const text = await page.locator('body').innerText({ timeout: 5000 });
  console.log(JSON.stringify({ ok: true, title, url: page.url(), bodyPreview: text.slice(0, 700), errorCount: errors.length, errors }, null, 2));
  await browser.close();
})();
