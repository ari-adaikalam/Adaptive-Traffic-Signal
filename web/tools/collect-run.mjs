// Makes the whole training set: opens the page once for every run in the plan below, with its seed, and runs collect-driver.js in it. A development tool, not part of the site, and it adds no dependency to it.
// It needs puppeteer-core, which is not in this repository: `npm install --prefix /tmp/pp puppeteer-core`, then
//   PUPPETEER_CORE=/tmp/pp/node_modules/puppeteer-core python3 web/tools/serve.py --collect datasets/detection &
//   PUPPETEER_CORE=/tmp/pp/node_modules/puppeteer-core node web/tools/collect-run.mjs [first] [last]     (run numbers, to do a part of the plan)
// CHROME names the Chrome to use (the default is the one in /Applications on a Mac). The plan is a function of the run number, so the same command makes the same runs.
import { createRequire } from 'node:module';

const BASE = process.env.BASE || 'http://127.0.0.1:8765', CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HOURS = [6.5, 8, 10, 12, 14, 16.5, 17.5, 19, 20.5, 22, 2, 4.5], WEATHER = ['clear', 'partly', 'overcast', 'rain'], NIGHT_RAIN_HOURS = [20, 21.5, 23, 1, 3, 4.5, 19.5, 20.5, 21, 22, 19.75, 22.5]; // dark by 19:15 and light after 5:45 (isNight in sim/daily.js)
const FRAMES = Number(process.env.FRAMES || 60), MAIN = 40, HELD_OUT = 12;

// Run i (0 to 45): runs 0 to 27 are for training, 28 to 33 for validation and 34 to 39 for the test (70, 15 and 15 percent of the 40 ordinary runs, split by run and never by picture), and 40 to 45 are night with rain, the held-out
// condition, used only for the test (the other runs have no rain after dark, so the model has not seen one). The validation and test runs are listed, so each covers different weather and hours; the training runs go round all the weathers and hours.
const VAL = [['clear', 8], ['partly', 12], ['overcast', 17.5], ['rain', 9], ['clear', 22], ['rain', 6.5]], TEST = [['partly', 10], ['overcast', 14], ['rain', 16.5], ['clear', 19], ['overcast', 2], ['rain', 12]];
export function plan(i) {
  const day = i % 3 === 2 ? 5 : 1; // most runs on a Tuesday, one in three on a Saturday
  if (i >= MAIN) { const k = i - MAIN; return { seed: 2001 + k, split: 'test-heldout', weather: 'rain', hour: NIGHT_RAIN_HOURS[k % NIGHT_RAIN_HOURS.length], day }; }
  if (i >= 34) return { seed: 1001 + i, split: 'test', weather: TEST[i - 34][0], hour: TEST[i - 34][1], day };
  if (i >= 28) return { seed: 1001 + i, split: 'val', weather: VAL[i - 28][0], hour: VAL[i - 28][1], day };
  const weather = WEATHER[i % WEATHER.length], hour = HOURS[(i * 5 + Math.floor(i / 4)) % HOURS.length], dark = hour < 6 || hour >= 19.25;
  return { seed: 1001 + i, split: 'train', weather: weather === 'rain' && dark ? 'overcast' : weather, hour, day }; // rain after dark is the held-out condition, so it is not in training
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const loaded = process.env.PUPPETEER_CORE ? createRequire(import.meta.url)(process.env.PUPPETEER_CORE) : await import('puppeteer-core'), puppeteer = loaded.default ?? loaded;
  const first = Number(process.argv[2] ?? 0), last = Number(process.argv[3] ?? MAIN + HELD_OUT - 1);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--window-size=1280,800'], defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 } });
  try {
    for (let i = first; i <= last; i += 1) {
      const p = plan(i), page = await browser.newPage(); page.on('pageerror', (e) => console.error(`run ${i}: page error: ${e.message}`));
      await page.goto(`${BASE}/?seed=${p.seed}`, { waitUntil: 'load' });
      await page.waitForFunction('window.__scene3d && window.__scene3d.exportFrame', { timeout: 120000 });
      await page.addScriptTag({ url: `${BASE}/tools/collect-driver.js` }); // by address: the page's policy does not allow inline scripts
      const t0 = Date.now(), result = await page.evaluate((o) => window.collectSession(o), { ...p, frames: FRAMES });
      console.log(`run ${i}: seed ${p.seed} ${p.split} ${p.weather} hour ${p.hour} day ${p.day}: ${result.sent} pictures (${result.empty} empty, ${result.skipped} left out) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
      await page.close();
    }
  } finally { await browser.close(); }
}
