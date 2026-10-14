import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const errors = [];
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', err => errors.push(err.message));

await page.goto('http://localhost:8080/orgs/org_demo?token=t', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);

const rootHtml = await page.evaluate(() => document.getElementById('root')?.innerHTML ?? 'EMPTY');
console.log('root length:', rootHtml.length);
console.log('has TopologyView:', rootHtml.includes('topology') || rootHtml.includes('cytoscape'));
console.log('has ChatPanel:', rootHtml.includes('Pregunta') || rootHtml.includes('Enviar'));
console.log('---');
console.log('console errors:', errors.length ? errors.slice(0, 3) : 'none');

await page.screenshot({ path: '/tmp/parallax-org.png', fullPage: true });
console.log('screenshot saved');

await browser.close();
