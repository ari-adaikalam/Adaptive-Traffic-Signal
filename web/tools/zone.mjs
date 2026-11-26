// How far back from the stop line does the camera need to see? Adaptive timing with a perfect count out to each distance, against the one fixed plan for the day, on the demand
// a junction really has every weekday: the morning rush, midday and the evening rush from the daily clock (sim/daily.js). One line of JSON per zone and time of day.
// Usage: node tools/zone.mjs <zone metres, comma separated, or rig> [seeds] [seconds]   (rig runs behind CAMERA_RIG, the cameras as chosen)
import { PRESETS, Simulation } from '../src/sim/traffic.js';
import { describe } from '../src/sim/compare.js';
import { CAMERA_RIG } from '../src/sim/world.js';

const rig = process.argv[2] === 'rig', zones = rig ? [CAMERA_RIG.detectionZone] : process.argv[2].split(',').map(Number), seedCount = Number(process.argv[3] || 8), seconds = Number(process.argv[4] || 3600);
const TIMES = { morning: 7.5, midday: 12, evening: 17 };
const seeds = Array.from({ length: seedCount }, (_, i) => i + 1);
for (const [name, hour] of Object.entries(TIMES)) {
  const demand = { ...PRESETS.clock, clockStartS: hour * 3600 };
  const fixed = seeds.map((seed) => new Simulation({ seed, mode: 'fixed', demand, config: { default_green: 40, max_green: 60 } }).run(seconds).summary());
  console.log(JSON.stringify({ time: name, plan: 'fixed day plan', delay: describe(fixed.map((s) => s.meanDelay)), queued: describe(fixed.map((s) => s.meanQueue)) }));
  for (const zone of zones) {
    const runs = seeds.map((seed) => new Simulation({ seed, mode: 'adaptive', demand, lengthCounts: true, detectionZone: zone, ...(rig ? CAMERA_RIG : {}) }).run(seconds).summary());
    console.log(JSON.stringify({ time: name, plan: rig ? 'adaptive, camera rig' : `adaptive, ${zone} m`, delay: describe(runs.map((s) => s.meanDelay)), queued: describe(runs.map((s) => s.meanQueue)), better: runs.filter((s, i) => s.meanDelay < fixed[i].meanDelay).length, seeds: seedCount }));
  }
}
