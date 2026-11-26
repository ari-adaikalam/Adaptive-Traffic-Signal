// Looks for vehicles that behave abnormally at the junction: a long time in it, or crawling in it. For every vehicle it records the time spent in the junction
// (from the stop line to the end of its path), by class and movement, then prints the usual range and the worst cases with what was holding them.
// Usage: node tools/anomalies.mjs [seconds] [seeds, comma separated]
import { PRESETS, Simulation } from '../src/sim/traffic.js';
import { BOX_PATH } from '../src/sim/world.js';

const seconds = Number(process.argv[2] || 1800), seeds = (process.argv[3] || '1,2').split(',').map(Number);
const CASES = {
  'weekday 08:00': { ...PRESETS.clock, clockStartS: 8 * 3600 },
  'weekday 12:00': { ...PRESETS.clock, clockStartS: 12 * 3600 },
  'weekday 17:30': { ...PRESETS.clock, clockStartS: 17.5 * 3600 },
  'saturday 11:00': { ...PRESETS.clock, clockStartS: 5 * 86400 + 11 * 3600 },
  'peak': PRESETS.peak, 'uneven': PRESETS.uneven,
};
const pct = (list, q) => (list.length ? [...list].sort((a, b) => a - b)[Math.min(list.length - 1, Math.floor(list.length * q))] : 0);
const records = [];
for (const [name, demand] of Object.entries(CASES)) {
  for (const seed of seeds) {
    const sim = new Simulation({ seed, mode: 'adaptive', demand });
    const live = new Map();
    for (let i = 0; i < seconds * 10; i += 1) {
      sim.step();
      for (const v of sim.vehicleList) {
        const inBox = v.d < 0 && v.d > -BOX_PATH[v.movement];
        let r = live.get(v.id);
        if (inBox && !r) { r = { name, seed, id: v.id, cls: v.cls, movement: v.movement, approach: v.approach, t0: sim.time, crawl: 0, run: 0, worstRun: 0, stopped: 0, reasons: new Map() }; live.set(v.id, r); }
        if (!r || r.done) continue;
        if (inBox || v.d <= 0 && v.d > -BOX_PATH[v.movement] - 30) { // the junction and the first 30 m of the exit
          const slow = v.v > 0.05 && v.v < 1.5;
          r.run = slow ? r.run + 0.1 : 0; r.worstRun = Math.max(r.worstRun, r.run); if (slow) r.crawl += 0.1; if (v.v <= 0.05) r.stopped += 0.1;
          if (v.why) r.reasons.set(v.why.split('/')[0].replace(/\d+/g, '').trim(), 1);
        }
        if (v.d <= -BOX_PATH[v.movement]) { r.done = true; r.dwell = sim.time - r.t0; records.push(r); live.delete(v.id); }
      }
    }
  }
}
console.log(`${records.length} vehicles through the junction in ${Object.keys(CASES).length} cases, ${seeds.length} seeds, ${seconds} s each\n`);
console.log('time in the junction (s)    median   90th   99th   max     crawling(s) 99th');
const groups = new Map();
for (const r of records) { const k = `${r.cls}/${r.movement}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
for (const [k, list] of [...groups].sort()) {
  const d = list.map((r) => r.dwell), c = list.map((r) => r.worstRun);
  console.log(`${k.padEnd(22)} n=${String(list.length).padStart(5)}  ${pct(d, 0.5).toFixed(1).padStart(6)} ${pct(d, 0.9).toFixed(1).padStart(6)} ${pct(d, 0.99).toFixed(1).padStart(6)} ${Math.max(...d).toFixed(1).padStart(6)}      ${pct(c, 0.99).toFixed(1)}`);
}
const bad = records.filter((r) => r.worstRun > 4 || r.dwell > 25).sort((a, b) => b.dwell - a.dwell);
console.log(`\nflagged: ${bad.length} (crawling more than 4 s in a row, or more than 25 s in the junction)`);
const only = process.argv[4]; const shown = only ? bad.filter((r) => r.movement === only) : bad;
for (const r of shown.slice(0, 15)) console.log(`${r.name} seed ${r.seed} ${r.cls}/${r.movement} a${r.approach} id${r.id}: ${r.dwell.toFixed(0)} s in, crawled ${r.crawl.toFixed(0)} s (longest ${r.worstRun.toFixed(0)} s), stood ${r.stopped.toFixed(0)} s, held by: ${[...r.reasons.keys()].join(', ') || 'nothing recorded'}`);
