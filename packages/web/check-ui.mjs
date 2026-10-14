import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

// Capture console errors
const errors = [];
page.on('console', msg => {
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', err => errors.push(err.message));

await page.goto('http://localhost:8080/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

// Check root content
const rootHtml = await page.evaluate(() => document.getElementById('root')?.innerHTML ?? 'EMPTY');
console.log('root length:', rootHtml.length);
console.log('root preview:', rootHtml.slice(0, 300));
console.log('---');
console.log('console errors:', errors.length ? errors.slice(0, 5) : 'none');
console.log('---');

// Screenshot
await page.screenshot({ path: '/tmp/parallax-ui.png', fullPage: true });
console.log('screenshot saved');

await browser.close();
