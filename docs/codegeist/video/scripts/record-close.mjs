// Scene 7: the closing title card.
//   node docs/codegeist/video/scripts/record-close.mjs
import path from 'node:path';
import { sleep, startScene } from './lib.mjs';

const s = await startScene('scene-7');
await s.page.goto(`file://${path.resolve(import.meta.dirname, '../slides/close.html')}`);
await sleep(800);
s.mark('start');
await sleep(1800);
await s.page.evaluate(() => window.step());
await sleep(8800);
s.mark('end');
await s.finish();
