// Shared helpers for the scene recorders: headless Chromium at 1080p recording video, a visible
// cursor (headless video has none), and a "show starts here" marker used to trim page loading.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from '../../../../packages/web/node_modules/playwright/index.mjs';

export const SITE = 'https://one-atlas-bhik.atlassian.net';
export const OUT = path.resolve(import.meta.dirname, '../out/clips');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CURSOR = `
  (() => {
    const add = () => {
      if (document.getElementById('__demo_cursor')) return;
      const c = document.createElement('div');
      c.id = '__demo_cursor';
      c.style.cssText = 'position:fixed;left:-50px;top:-50px;width:22px;height:22px;z-index:2147483647;' +
        'pointer-events:none;transition:left .05s linear,top .05s linear;';
      c.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.5 13.5 L11 20 L13.5 19 L10 12.5 L16 12.5 Z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
      document.documentElement.appendChild(c);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
  })();`;

export async function startScene(name, { storageState } = {}) {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    storageState,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1.5,
  });
  await ctx.addInitScript(CURSOR);
  const page = await ctx.newPage();
  const t0 = Date.now();
  // Chrome's own screencast delivers frames at device pixels (1280x720 CSS at 1.5x = 1920x1080).
  // Playwright's recordVideo would capture CSS pixels and pad them onto the canvas instead.
  const framesDir = path.join(OUT, `${name}-frames`);
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });
  const frames = [];
  const cdp = await ctx.newCDPSession(page);
  cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
    const file = path.join(framesDir, `${String(frames.length).padStart(6, '0')}.jpg`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    frames.push({ file, t: (Date.now() - t0) / 1000 });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  let pos = { x: 640, y: 360 };
  const marks = {};
  const api = {
    page,
    /** Move the real mouse and the drawn cursor together, smoothly. */
    async move(x, y, ms = 700) {
      const steps = Math.max(8, Math.round(ms / 25));
      for (let i = 1; i <= steps; i++) {
        const k = i / steps, e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        const nx = pos.x + (x - pos.x) * e, ny = pos.y + (y - pos.y) * e;
        await page.mouse.move(nx, ny);
        await page.evaluate(([a, b]) => { const c = document.getElementById('__demo_cursor'); if (c) { c.style.left = a + 'px'; c.style.top = b + 'px'; } }, [nx, ny]).catch(() => {});
        await sleep(ms / steps);
      }
      pos = { x, y };
    },
    async click(x, y) { await api.move(x, y); await sleep(250); await page.mouse.click(x, y); },
    /** Smooth wheel scroll at the cursor position. */
    async scroll(dy, ms = 1500) {
      const steps = Math.max(10, Math.round(ms / 30));
      for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dy / steps); await sleep(ms / steps); }
    },
    mark(label) { marks[label] = (Date.now() - t0) / 1000; console.log(`mark ${label} @ ${marks[label].toFixed(2)}s`); },
    async finish() {
      await sleep(500);
      await cdp.send('Page.stopScreencast').catch(() => {});
      const tEnd = (Date.now() - t0) / 1000;
      await ctx.close();
      await browser.close();
      // Frames arrive only when the page changes: give each one its real on-screen duration.
      const list = frames.map((f, i) => `file '${f.file}'\nduration ${((frames[i + 1]?.t ?? tEnd) - f.t).toFixed(3)}`);
      list.push(`file '${frames.at(-1).file}'`);
      const listFile = path.join(framesDir, 'frames.txt');
      fs.writeFileSync(listFile, 'ffconcat version 1.0\n' + list.join('\n') + '\n');
      const dst = path.join(OUT, `${name}.mp4`);
      // The first frame arrives a little after t0; pad so clip time == mark time.
      const lead = frames[0].t.toFixed(3);
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
        '-vf', `tpad=start_duration=${lead}:start_mode=clone,fps=30,scale=1920:1080:flags=lanczos,format=yuv420p`,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', dst]);
      fs.rmSync(framesDir, { recursive: true, force: true });
      fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(marks, null, 2));
      console.log(`clip ${dst}`);
    },
  };
  return api;
}

export function stateFromEnv() {
  const s = process.env.ATL_STATE;
  if (!s || !fs.existsSync(s)) throw new Error('Set ATL_STATE to the Atlassian storageState JSON (kept outside the repo).');
  return s;
}
