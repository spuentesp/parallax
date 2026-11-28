// Scene 5: the Parallax Architect agent in Rovo chat, asked in plain language.
//   ATL_STATE=/path/state.json node docs/codegeist/video/scripts/record-rovo.mjs
import { SITE, sleep, startScene, stateFromEnv } from './lib.mjs';

const QUESTION =
  'What breaks if I change the openshell-gateway service in ws_cluster_a? Who should I talk to?';
const s = await startScene('scene-5', { storageState: stateFromEnv() });
const { page } = s;

await page.goto(`${SITE}/jira/your-work`, { waitUntil: 'domcontentloaded' });
const ask = page.getByRole('button', { name: /Ask Rovo/i }).first();
await ask.waitFor({ timeout: 60_000 });
await sleep(2500);
await ask.click();
await sleep(4000);
// The chat stays in the sidebar: its full-screen mode does not apply in a headless browser.
await sleep(3500);
s.mark('start');

const input = page.getByRole('textbox').last();
const ib = await input.boundingBox();
await s.click(ib.x + 60, ib.y + ib.height / 2);
await page.keyboard.type('@Parallax', { delay: 70 });
const option = page.getByRole('option', { name: /Parallax Architect/ }).first();
await option.waitFor({ timeout: 15_000 });
await sleep(600);
const ob = await option.boundingBox();
await s.click(ob.x + 80, ob.y + ob.height / 2);
await sleep(500);
await page.keyboard.type(` ${QUESTION}`, { delay: 28 });
await sleep(700);
await page.keyboard.press('Enter');
await sleep(1500);
s.mark('cut1_from');

// Wait for the agent to finish: its answer names the owner it read from Confluence.
await page.getByText(/Platform team/).last().waitFor({ timeout: 240_000 });
// Then wait until the text stops growing.
let last = -1;
for (let i = 0; i < 60; i++) {
  const len = (await page.locator('body').innerText()).length;
  if (len === last) break;
  last = len;
  await sleep(2000);
}
s.mark('cut1_to');
await sleep(2500);
// Scroll through the answer.
// Scroll the chat itself: put the cursor over the answer first.
await s.move(1256, 420, 800); // the chat panel's right edge (x 860-1270), clear of links and their hover cards
for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 240); await sleep(2400); }
await sleep(2000);
s.mark('end');
await s.finish();
