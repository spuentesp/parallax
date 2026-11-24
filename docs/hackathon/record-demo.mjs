// Records a silent 1080p screen capture of the demo, following docs/hackathon/video-script.md.
// Add your voice-over afterwards. Needs playwright-core and a Chromium:
//   node docs/hackathon/record-demo.mjs <BASE_URL> <READ_ONLY_TOKEN> <OUT_DIR> [chromium-path]
// e.g. node docs/hackathon/record-demo.mjs https://marbled-river-9619.fly.dev <token> ./video
// Steps that need judgement (drilling repo -> file, the inspector) are not automated: record those by hand.
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'playwright-core'); // PLAYWRIGHT_CORE: path to playwright-core if it is not installed here
const [BASE, TOKEN, OUT, EXE = '/usr/bin/chromium'] = process.argv.slice(2);
if (!BASE || !TOKEN || !OUT) {
  console.error('usage: record-demo.mjs <BASE_URL> <READ_ONLY_TOKEN> <OUT_DIR> [chromium-path]');
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });
// The token is not kept across full page loads, so every navigation carries it (the app strips it from the address bar).
const url = (path = '') => `${BASE}/orgs/ws_cluster_a${path}?token=${TOKEN}`;
const ASK = 'Which services consume the OpenShell gRPC gateway, and from which repos?';
const WEB = 'According to the official gRPC documentation, what is server reflection, and which of our services would expose it?';

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } },
});
const page = await ctx.newPage();
const wait = (ms) => page.waitForTimeout(ms);
const step = async (name, fn) => {
  try { await fn(); console.log('ok  ', name); } catch (e) { console.log('FAIL', name, String(e).split('\n').slice(0, 12).join(" | ").slice(0, 900)); }
};
const typeSlow = async (loc, text) => { await loc.click(); await loc.pressSequentially(text, { delay: 35 }); };
// The dock reopens the last conversation after a page load. Start from an empty one so the wait below cannot match
// text from an earlier answer.
const freshChat = async () => {
  const b = page.getByRole('button', { name: 'New', exact: true });
  if (await b.isVisible().catch(() => false)) {
    await b.click({ timeout: 5000 }).catch(() => {});
    await wait(1500);
  }
};
const ask = async (q, doneText, timeout = 240000) => {
  await freshChat();
  const box = page.getByLabel('Ask about the architecture');
  await typeSlow(box, q);
  await wait(600);
  await box.press('Enter');
  await page.getByText(doneText).first().waitFor({ timeout });
  await wait(5000);
};

// Clip order is chosen so clean pages are recorded first: after an Ask, the floating assistant panel covers the Query
// page's Run button. Re-order the clips in your editor to follow video-script.md.

await step('open the map', async () => {
  await page.goto(url(), { waitUntil: 'domcontentloaded', timeout: 120000 });
  await wait(8000);
  // Fit the graph to the canvas, then walk the detail levels (repos -> services -> endpoints).
  await page.getByRole('button', { name: 'Fit to view' }).click({ timeout: 10000 });
  await wait(3000);
  for (const name of ['Repos', 'Services', 'Endpoints']) {
    await page.getByRole('button', { name: name, exact: true }).click({ timeout: 8000 });
    await wait(3500);
    await page.getByRole('button', { name: 'Fit to view' }).click({ timeout: 8000 });
    await wait(2500);
  }
});

await step('query page', async () => {
  // After an Ask the assistant dock can cover the ask bar, so open the page directly (same page the Query toggle opens).
  await page.goto(url('/query'), { waitUntil: 'domcontentloaded' });
  await page.getByTestId('query-page').waitFor({ timeout: 30000 });
  // The assistant dock stays open after an Ask and can cover the Run button.

  await wait(3000);
  await page.getByRole('button', { name: 'gRPC call sites into each service' }).click();
  await wait(1500);
  const run = page.getByRole('button', { name: 'Run' });
  console.log('     run disabled:', await run.isDisabled(), '| alerts:', await page.getByRole('alert').allInnerTexts());
  await run.click({ timeout: 10000 });
  await page.getByTestId('query-results').waitFor({ timeout: 60000 });
  await wait(8000);
});

await step('coverage page', async () => {
  await page.goto(url('/coverage'), { waitUntil: 'domcontentloaded' });
  await wait(6000);
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 500); await wait(2500); }
  await wait(3000);
});

await step('ask + verdicts', async () => {
  await page.goto(url(), { waitUntil: 'domcontentloaded' });
  await wait(8000);
  await ask(ASK, /verified|supported|unverifiable/i);
});

await step('show on map', async () => {
  await page.getByRole('button', { name: /Show on map/ }).first().click({ timeout: 15000 });
  await wait(8000);
});

await step('proven / inferred filters', async () => {
  for (const name of ['Inferred', 'Proven']) {
    const b = page.getByRole('button', { name: new RegExp(`^${name}`) }).first();
    await b.click({ timeout: 8000 });
    await wait(3500);
    await b.click({ timeout: 8000 });
    await wait(1500);
  }
});

await step('web-search ask', async () => {
  await page.goto(url(), { waitUntil: 'domcontentloaded' });
  await wait(8000);
  const done = /Server reflection in|reflection (service|is|allows|lets)/i;
  try {
    await ask(WEB, done, 150000);
  } catch {
    // The model sometimes answers without citations ("failed:citations_missing"). Start a new conversation and ask again.
    console.log('     web-search ask did not finish, retrying once');
    await ask(WEB, done, 150000);
  }
  await wait(6000);
});

await ctx.close();
await browser.close();
const f = readdirSync(OUT).find((n) => n.endsWith('.webm'));
if (f) { renameSync(join(OUT, f), join(OUT, 'parallax-demo-silent.webm')); console.log('wrote', join(OUT, 'parallax-demo-silent.webm')); }
