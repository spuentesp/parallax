// Scene 1: the ticket. OSP-10 with the cursor on its open question; scene 2 continues from here.
//   ATL_STATE=/path/state.json node docs/codegeist/video/scripts/record-hook.mjs
import { SITE, sleep, startScene, stateFromEnv } from './lib.mjs';

const s = await startScene('scene-1', { storageState: stateFromEnv() });
const { page } = s;
await page.goto(`${SITE}/browse/OSP-10`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: /ListSandboxTemplates/i }).first().waitFor({ timeout: 60_000 });
await page.getByRole('button', { name: 'Collapse sidebar' }).click().catch(() => {});
await sleep(3000);
s.mark('start');

const at = async (text) => {
  const b = await page.getByText(text).first().boundingBox();
  return b ? { x: b.x, y: b.y + b.height / 2, w: b.width } : null;
};
await sleep(1500);
// Read along the title...
const title = await at('Remove the ListSandboxTemplates RPC');
if (title) { await s.move(title.x, title.y, 800); await s.move(title.x + Math.min(title.w, 470), title.y, 1800); }
await sleep(1200);
// ...the request...
const req = await at(/Remove rpc/);
if (req) { await s.move(req.x + 40, req.y, 900); await sleep(2500); }
// ...and rest on the question nobody can answer.
const q = await at(/which clients still call it/);
if (q) { await s.move(q.x, q.y, 900); await s.move(q.x + Math.min(q.w, 270), q.y, 1500); }
await sleep(1500);
s.mark('end');
await s.finish();
