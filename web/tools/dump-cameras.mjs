// Saves where each of the eight detection cameras is, and which road it owns, as JSON, for the evaluation of the detector (detect-eval.mjs), which needs them to put a detection on the road. The cameras are fixed in
// the scene, so one page is enough. Needs puppeteer-core, as collect-run.mjs does, and the dev server running.
//   PUPPETEER_CORE=/tmp/pp/node_modules/puppeteer-core node web/tools/dump-cameras.mjs datasets/detection/cameras.json
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const loaded = process.env.PUPPETEER_CORE ? createRequire(import.meta.url)(process.env.PUPPETEER_CORE) : await import('puppeteer-core'), puppeteer = loaded.default ?? loaded;
const BASE = process.env.BASE || 'http://127.0.0.1:8765', CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-gl=angle', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 } });
try {
  const page = await browser.newPage(); await page.goto(`${BASE}/?seed=1`, { waitUntil: 'load' });
  await page.waitForFunction('window.__scene3d && window.__scene3d.exportFrame', { timeout: 120000 });
  const cameras = await page.evaluate(() => { const s = window.__scene3d, out = []; for (let i = 0; i < 8; i += 1) { const f = s.exportFrame(i); out.push({ camera: i, approach: f.approach, own: f.own, crop: f.crop, ...f.cam }); } return out; });
  writeFileSync(process.argv[2] || 'cameras.json', JSON.stringify(cameras, null, 1));
  console.log(`${cameras.length} cameras saved`);
} finally { await browser.close(); }
