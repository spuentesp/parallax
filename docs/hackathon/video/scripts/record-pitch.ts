/**
 * Parallax Automated 1080p Screen Recorder
 * Choreographed to match the dual-voice narration in docs/hackathon/video/audio-timeline.json.
 * 
 * Run from repo root:
 *   node --experimental-strip-types docs/hackathon/video/scripts/record-pitch.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '../../../../packages/web/node_modules/playwright/index.mjs';

const APP_URL = process.env.APP_URL || 'http://localhost:5173/orgs/ws_cluster_a';
const TIMELINE_PATH = 'docs/hackathon/video/audio-timeline.json';
const RECORDINGS_DIR = path.resolve('docs/hackathon/video/recordings');

fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  if (!fs.existsSync(TIMELINE_PATH)) {
    console.error(`❌ Timeline file not found: ${TIMELINE_PATH}`);
    process.exit(1);
  }

  const timeline = JSON.parse(fs.readFileSync(TIMELINE_PATH, 'utf8'));
  console.log(`🎬 Launching browser for recording (${timeline.total_duration}s target)...`);

  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080'],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: {
      dir: RECORDINGS_DIR,
      size: { width: 1920, height: 1080 },
    },
  });

  const page = await context.newPage();

  console.log(`📡 Navigating to ${APP_URL}...`);
  await page.goto(APP_URL, { waitUntil: 'networkidle' });

  // SCENE 1: Problem Overview (0:00 - 0:20)
  console.log('▶️ Scene 1: Map overview & panning...');
  await sleep(4000);
  await page.mouse.move(960, 540);
  await page.mouse.down();
  await page.mouse.move(860, 500, { steps: 20 });
  await page.mouse.up();
  await sleep(15000);

  // SCENE 2: The Question & Nemotron Investigation (0:20 - 1:00)
  console.log('▶️ Scene 2: Asking question & investigator verification...');
  const chatInput = page.locator('input[placeholder*="Ask"], textarea[placeholder*="Ask"]').first();
  if (await chatInput.isVisible()) {
    await chatInput.click();
    await chatInput.pressSequentially('Which services consume the OpenShell gateway gRPC API, and from which repos?', { delay: 45 });
    await page.keyboard.press('Enter');
  }

  // Wait for streaming investigation and verification badges
  await sleep(35000);

  // Click 'Show on map'
  const showOnMapBtn = page.locator('button:has-text("Show on map")').first();
  if (await showOnMapBtn.isVisible()) {
    console.log('  Clicking "Show on map"...');
    await showOnMapBtn.click();
  }
  await sleep(6000);

  // SCENE 3: Lead Architect Deep Dive (1:03 - 1:40)
  console.log('▶️ Scene 3: Hierarchical canvas & confidence styling...');
  await page.mouse.wheel(0, -300);
  await sleep(5000);

  const filterToggle = page.locator('button:has-text("Inferred"), input[type="checkbox"]').first();
  if (await filterToggle.isVisible()) {
    await filterToggle.click();
    await sleep(4000);
    await filterToggle.click();
  }
  await sleep(15000);

  // SCENE 4: Blast Radius & PR Safety (1:43 - 2:02)
  console.log('▶️ Scene 4: PR Assessment blast radius...');
  const assessmentsLink = page.locator('a[href*="assessments"]').first();
  if (await assessmentsLink.isVisible()) {
    await assessmentsLink.click();
  }
  await sleep(15000);

  // SCENE 5: Under the Hood (2:02 - 2:22)
  console.log('▶️ Scene 5: Audit log & Nemotron tool calls...');
  await sleep(16000);

  // SCENE 6: Close & Outro (2:22 - 2:32)
  console.log('▶️ Scene 6: Outro & URLs...');
  await sleep(10000);

  console.log('⏹️ Closing recording session...');
  await page.close();
  await context.close();
  await browser.close();

  const videoFiles = fs.readdirSync(RECORDINGS_DIR).filter((f) => f.endsWith('.webm'));
  if (videoFiles.length > 0) {
    const latest = path.join(RECORDINGS_DIR, videoFiles[videoFiles.length - 1]);
    const target = path.join(RECORDINGS_DIR, 'raw-demo.webm');
    fs.copyFileSync(latest, target);
    console.log(`✅ Raw recording ready at: ${target}`);
    console.log('Run ./docs/hackathon/video/scripts/build-video.sh to merge with master voiceover.');
  }
}

main().catch(console.error);
