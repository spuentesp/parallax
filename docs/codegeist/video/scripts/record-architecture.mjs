// Scene 6: the architecture slide, revealed with the narration, then the live web console.
//   PARALLAX_READ_TOKEN=... node docs/codegeist/video/scripts/record-architecture.mjs
// The token is the read-only entry of the Fly secret PARALLAX_TOKENS; it is never printed, and the
// recording has no URL bar.
import path from 'node:path';
import { sleep, startScene } from './lib.mjs';

const SERVER = 'https://marbled-river-9619.fly.dev';
const token = process.env.PARALLAX_READ_TOKEN;
if (!token) throw new Error('Set PARALLAX_READ_TOKEN (read-only token for the Fly server).');

const health = await (await fetch(`${SERVER}/api/health`)).text();
const slide = path.resolve(import.meta.dirname, '../slides/architecture.html');
const s = await startScene('scene-6');
const { page } = s;
await page.goto(`file://${slide}`);
await sleep(800);
s.mark('start');
const t0 = Date.now();
const at = async (sec) => { const wait = t0 + sec * 1000 - Date.now(); if (wait > 0) await sleep(wait); };

// Times follow the narration (word position in the scene's audio).
await at(0.6); await page.evaluate(() => window.step(1)); // the Forge app runs on Atlassian
await at(4.2); await page.evaluate(() => window.step(2)); // one declared outbound domain
await at(8.4); await page.evaluate(() => window.step(3)); // one machine: API and two engines
await at(19); await page.evaluate(() => window.step(4)); // indexes, contracts, base vs head; baked graph
await at(31); await page.evaluate((h) => { window.setHealth(h); window.step(5); }, health); // live health
await at(35.3);

// "...and its own web console": the same server's map. Loading is cut from the edit.
s.mark('cut1_from');
await page.goto(`${SERVER}/orgs/ws_cluster_a?token=${encodeURIComponent(token)}`, { waitUntil: 'domcontentloaded' });
await page.getByText('openshell-gateway').first().waitFor({ timeout: 90_000 });
await sleep(2500);
s.mark('cut1_to');
// Zoom the map towards the services so they are readable.
const zoomIn = page.getByRole('button', { name: /zoom in/i }).first();
const zb = (await zoomIn.count()) ? await zoomIn.boundingBox() : { x: 567, y: 572, width: 16, height: 16 };
for (let i = 0; i < 2; i++) { await s.click(zb.x + zb.width / 2, zb.y + zb.height / 2); await sleep(700); }
await s.move(900, 380, 1000);
await sleep(3000);
s.mark('end');
await s.finish();
