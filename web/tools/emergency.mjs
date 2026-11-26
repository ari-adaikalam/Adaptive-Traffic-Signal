// Emergency vehicles, fixed against adaptive, on the same traffic and the same calls: how long they wait to cross, and what the priority costs everyone else.
// Usage: node tools/emergency.mjs <preset> [seeds] [seconds]
import { FULL_MIX, emergencyRun, withFullMix } from '../src/sim/compare.js';
import { PRESETS } from '../src/sim/traffic.js';
import { CAMERA_RIG } from '../src/sim/world.js';

const preset = process.argv[2] || 'moderate', seedCount = Number(process.argv[3] || 10), seconds = Number(process.argv[4] || 3600);
const demand = withFullMix(PRESETS[preset], preset === 'peak' ? FULL_MIX.rush : FULL_MIX.work);
const median = (list) => { const s = [...list].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const mean = (list) => list.reduce((a, b) => a + b, 0) / (list.length || 1);
const rows = {};
for (const mode of ['fixed', 'adaptive']) {
  const waits = [], delays = [], conflicts = [];
  let crossed = 0;
  for (let seed = 1; seed <= seedCount; seed += 1) { const r = emergencyRun({ demand, seed, seconds, mode, rig: CAMERA_RIG }); waits.push(...r.waits); delays.push(r.meanDelay); conflicts.push(r.boxConflictSteps); crossed += r.crossed; }
  rows[mode] = { vehicles: crossed, meanWait: mean(waits), medianWait: median(waits), worstWait: Math.max(...waits), meanDelayOthers: mean(delays), boxConflictSteps: conflicts.reduce((a, b) => a + b, 0) };
}
console.log(`### ${preset}, ${seedCount} runs of ${seconds} s\n`);
console.log('| | Emergency vehicles | Mean wait (s) | Median (s) | Worst (s) | Mean delay of all vehicles (s) | Box conflicts |\n|---|---|---|---|---|---|---|');
for (const [mode, r] of Object.entries(rows)) console.log(`| ${mode} | ${r.vehicles} | ${r.meanWait.toFixed(1)} | ${r.medianWait.toFixed(1)} | ${r.worstWait.toFixed(1)} | ${r.meanDelayOthers.toFixed(1)} | ${r.boxConflictSteps} |`);
