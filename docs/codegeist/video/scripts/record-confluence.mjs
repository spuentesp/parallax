// Scene 4: the generated Confluence page for nemoclaw, from its machine-made tags to Human notes.
//   ATL_STATE=/path/state.json node docs/codegeist/video/scripts/record-confluence.mjs
import { SITE, sleep, startScene, stateFromEnv } from './lib.mjs';

const PAGE = `${SITE}/wiki/spaces/PLXDOCS/pages/4718593/Service+architecture+nemoclaw`;
const s = await startScene('scene-4', { storageState: stateFromEnv() });
const { page } = s;

await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
await page.getByText('MACHINE MADE').first().waitFor({ timeout: 60_000 });
await page.mouse.click(28, 24); // the sidebar toggle, top left
await sleep(2500);

// Scroll Confluence's main content so a heading lands at a given height, smoothly.
const bringTo = async (text, y, ms = 2200) => {
  const box = await (typeof text === 'string' ? page.getByRole('heading', { name: text }) : page.getByText(text)).first().boundingBox();
  if (!box) return console.log('not found:', String(text));
  await page.evaluate(
    async ([dy, dur]) => {
      const main = document.querySelector('#AkMainContent') ?? document.scrollingElement;
      let el = main;
      while (el && !(el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(el).overflowY))) {
        el = el.parentElement;
      }
      const target = el ?? document.scrollingElement;
      const from = target.scrollTop;
      const t0 = performance.now();
      await new Promise((done) => {
        const step = (now) => {
          const k = Math.min(1, (now - t0) / dur);
          const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
          target.scrollTop = from + dy * e;
          k < 1 ? requestAnimationFrame(step) : done();
        };
        requestAnimationFrame(step);
      });
    },
    [box.y - y, ms],
  );
};

s.mark('start');
// The machine-made tags and the note above the generated part.
const tag = await page.getByText('MACHINE MADE').first().boundingBox();
if (tag) await s.move(tag.x + 20, tag.y + tag.height / 2, 1000);
await sleep(5500);
// The generated architecture.
await bringTo('Overview', 110);
await s.move(560, 300, 900);
await sleep(5000);
// Human notes: what people wrote, which Parallax keeps.
await bringTo('Human notes', 110, 2600);
const owner = await page.getByText('Platform team').first().boundingBox();
if (owner) await s.move(owner.x + 10, owner.y + owner.height / 2, 1000);
await sleep(11_000);
s.mark('end');
await s.finish();
