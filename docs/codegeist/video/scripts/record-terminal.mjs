// Scene 3: a real Claude Code session calling the app's MCP tools, recorded with asciinema and
// played back full-frame at 1080p. Idle gaps are shortened to 1 s; nothing else is changed.
//   CAST=/path/scene-3.cast PLAYER=/path/node_modules/asciinema-player START=15.2 \
//     node docs/codegeist/video/scripts/record-terminal.mjs
import fs from 'node:fs';
import path from 'node:path';
import { sleep, startScene } from './lib.mjs';

const cast = process.env.CAST;
const player = process.env.PLAYER;
const startAt = Number(process.env.START ?? 0);
if (!cast || !player) throw new Error('Set CAST (the .cast file) and PLAYER (the asciinema-player package dir).');

const html = path.join(path.dirname(cast), 'play.html');
fs.writeFileSync(
  html,
  `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="file://${player}/dist/bundle/asciinema-player.css">
<style>html,body{margin:0;width:1280px;height:720px;background:#272822;overflow:hidden}
#p{width:1280px;height:720px}.ap-wrapper,.ap-player,.ap-terminal{background:#272822 !important}</style></head>
<body><div id="p"></div>
<script src="file://${player}/dist/bundle/asciinema-player.min.js"></script>
<script>
  window.done = false;
  window.player = AsciinemaPlayer.create({ data: ${JSON.stringify(fs.readFileSync(cast, 'utf8')).replace(/</g, '\\u003c')} }, document.getElementById('p'), {
    cols: 104, rows: 30, fit: 'both', idleTimeLimit: 1, startAt: ${startAt}, controls: false,
    autoPlay: false, preload: true, theme: 'monokai', terminalFontFamily: 'ui-monospace, Menlo, monospace',
  });
  window.player.addEventListener('ended', () => { window.done = true; });
</script></body></html>`,
);

const s = await startScene('scene-3');
const { page } = s;
await page.goto(`file://${html}`);
await sleep(2500);
s.mark('start');
await page.evaluate(() => window.player.play());
await page.waitForFunction(() => window.done === true, null, { timeout: 300_000, polling: 250 });
await sleep(2500); // let the last answer sit on screen
s.mark('end');
await s.finish();
