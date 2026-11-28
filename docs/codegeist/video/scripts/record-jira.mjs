// Scenes 1-2: Jira issue OSP-10, then the Parallax impact panel (Forge Custom UI).
//   ATL_STATE=/path/state.json node docs/codegeist/video/scripts/record-jira.mjs
import { SITE, sleep, startScene, stateFromEnv } from './lib.mjs';

const ISSUE = process.env.ISSUE || 'OSP-10';
const s = await startScene('scene-2', { storageState: stateFromEnv() });
const { page } = s;

await page.goto(`${SITE}/browse/${ISSUE}`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: /ListSandboxTemplates/i }).first().waitFor({ timeout: 60_000 });
// Off-camera setup (trimmed later): collapse the sidebar, close the panel if it is open.
await page.getByRole('button', { name: 'Collapse sidebar' }).click().catch(() => {});
const more = page.getByRole('button', { name: /More actions for Parallax/i });
if (await more.count()) {
  await more.first().click();
  await sleep(800);
  const items = page.getByRole('menuitem');
  console.log('panel menu:', (await items.allInnerTexts()).join(' / '));
  await page.getByRole('menuitem', { name: /remove|close|hide/i }).first().click().catch((e) => console.log('close failed', e.message.split('\n')[0]));
  await sleep(1500);
}
await page.mouse.move(640, 360);
await sleep(2000);
s.mark('start');

// On camera: open the panel from the issue's app actions.
await sleep(2500);
for (let attempt = 1; ; attempt++) {
  const apps = page.getByRole('button', { name: 'View app actions' }).first();
  const b = await apps.boundingBox();
  await s.click(b.x + b.width / 2, b.y + b.height / 2);
  const item = page.getByRole('menuitem', { name: /Parallax impact/i }).first();
  try {
    await item.waitFor({ state: 'visible', timeout: 6000 });
  } catch (e) {
    if (attempt >= 3) throw e;
    console.log('app menu did not open, retrying');
    await page.keyboard.press('Escape');
    await sleep(1500);
    continue;
  }
  await sleep(700);
  const c = await item.boundingBox();
  await s.click(c.x + c.width / 2, c.y + c.height / 2);
  break;
}
// The panel asks the backend first ("Reading the ticket..."): keep a moment of that, cut the rest.
await sleep(900);
s.mark('cut1_from');

// Wait for the panel's own content inside its iframe.
const panel = page.frameLocator('iframe[src*="cdn.prod.atl"], iframe[src*="atl-paas"]').first();
await panel.getByText('What the pull request actually changed').waitFor({ timeout: 90_000 });
s.mark('cut1_to');
await sleep(1500);

// Bring a panel heading to a given height on screen (Jira's scroll position varies between loads).
const bringTo = async (text, y, ms = 2500) => {
  const box = await panel.getByText(text).first().boundingBox();
  if (!box) return;
  console.log('bringTo', String(text), 'from y', Math.round(box.y), 'to', y);
  // Scroll the iframe's scrollable ancestor in the page by an exact amount, smoothly.
  await page.evaluate(async ([dy, dur]) => {
    let el = document.querySelector('iframe[src*="cdn.prod.atl"], iframe[src*="atl-paas"]');
    while (el && !(el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
    const target = el || document.scrollingElement;
    const from = target.scrollTop, t0 = performance.now();
    await new Promise((done) => {
      const step = (now) => {
        const k = Math.min(1, (now - t0) / dur), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        target.scrollTop = from + dy * e;
        k < 1 ? requestAnimationFrame(step) : done();
      };
      requestAnimationFrame(step);
    });
  }, [box.y - y, ms]);
  const after = await panel.getByText(text).first().boundingBox();
  console.log('  landed y', Math.round(after.y));
};

// The prediction graph.
await s.move(620, 430, 900);
await bringTo('What the ticket predicts', 130);
await sleep(6_000);
// The PR headline.
await bringTo('What the pull request actually changed', 130);
await s.move(520, 220, 800);
await sleep(23_000);
// Next steps.
await bringTo(/what to do next/i, 170, 2000);
await s.move(480, 200, 800);
await sleep(12_000);
s.mark('end');
await s.finish();
