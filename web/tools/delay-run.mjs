// Runs delay-driver.js in the page for one seed and prints one JSON line per mode. A development tool, not part of the site. It needs puppeteer-core, which is not in this repository, and the dev server:
//   python3 web/tools/serve.py &
//   PUPPETEER_CORE=/path/to/node_modules/puppeteer-core node web/tools/delay-run.mjs <seed> <hour> <mode,mode,...> [seconds] [warmup]
// Modes are rig, detector and fixed (see delay-driver.js). Every mode opens a new page with the same seed, so the traffic is the same. CHROME names the Chrome to use.
import { createRequire } from 'node:module';

const BASE = process.env.BASE || 'http://127.0.0.1:8765', CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [seed, hour, modes = 'rig', seconds = '1800', warmup = '420'] = process.argv.slice(2);
if (!/^[0-9]{1,10}$/.test(seed || '') || !Number.isFinite(Number(hour))) throw new Error('usage: delay-run.mjs <seed> <hour> <mode,mode> [seconds] [warmup]');
const loaded = process.env.PUPPETEER_CORE ? createRequire(import.meta.url)(process.env.PUPPETEER_CORE) : await import('puppeteer-core'), puppeteer = loaded.default ?? loaded;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', protocolTimeout: 0, args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--window-size=1280,800'], defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 } });
try {
  for (const mode of modes.split(',')) {
    const page = await browser.newPage(); page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
    // The page warms the simulation up for ten minutes at load, with the demand of the visitor's real time of day, and a seed gives the same traffic only if that time is the same. So the page's clock is frozen
    // at one moment (a Monday, 12:00), and every mode of a seed then starts from the same traffic.
    await page.evaluateOnNewDocument(() => { const RealDate = Date, frozen = new RealDate(2026, 10, 23, 12, 0, 0).getTime(); globalThis.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(frozen); } static now() { return frozen; } }; });
    await page.goto(`${BASE}/?seed=${seed}`, { waitUntil: 'load' });
    await page.waitForFunction('window.__scene3d && window.__scene3d.step', { timeout: 120000 });
    await page.addScriptTag({ url: `${BASE}/tools/delay-driver.js` }); // by address: the page's policy does not allow inline scripts
    const result = await page.evaluate((o) => window.delayRun(o), { mode, hour: Number(hour), seconds: Number(seconds), warmup: Number(warmup), trace: process.env.TRACE === '1' });
    console.log(JSON.stringify({ seed: Number(seed), ...result }));
    await page.close();
  }
} finally { await browser.close(); }
