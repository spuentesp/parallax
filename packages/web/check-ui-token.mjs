import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const errors = [];
page.on('console', msg => {
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', err => errors.push(err.message));

// Navigate with token in URL
await page.goto('http://localhost:8080/?token=t', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

const rootHtml = await page.evaluate(() => document.getElementById('root')?.innerHTML ?? 'EMPTY');
console.log('root length:', rootHtml.length);
console.log('root preview:', rootHtml.slice(0, 400));
console.log('---');
console.log('console errors:', errors.length ? errors.slice(0, 3) : 'none');
console.log('---');

await page.screenshot({ path: '/tmp/parallax-ui-token.png', fullPage: true });
console.log('screenshot saved');

await browser.close();
