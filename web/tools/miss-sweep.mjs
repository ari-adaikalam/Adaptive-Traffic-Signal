// How much counting error the adaptive controller can take: the same traffic with the cameras made to miss more and more of the vehicles they would see (the rig's measured chance of seeing a vehicle, `detectionCurve`
// in sim/world.js, scaled down by the miss rate), against the fixed plan. Mean delay of a vehicle in seconds, averaged over 6 seeds of 30 minutes, at midday and at the evening rush on the weekday clock traffic.
//   node web/tools/miss-sweep.mjs
// (The simulator's own `detectionMiss` setting does nothing while a `detectionCurve` is given, which the rig always does, so the curve is what is scaled here.) Results are in docs/results.md.
import { PRESETS, Simulation } from '../src/sim/traffic.js';
import { CAMERA_RIG } from '../src/sim/world.js';

const seeds = [1, 2, 3, 4, 5, 6], hours = [12, 17.5], seconds = 1800, misses = [0, 0.03, 0.06, 0.1, 0.2, 0.3], mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const run = (mode, hour, seed, miss) => new Simulation({ seed, mode, demand: { ...PRESETS.clock, clockStartS: hour * 3600 },
  ...(mode === 'adaptive' ? { ...CAMERA_RIG, detectionCurve: CAMERA_RIG.detectionCurve.map(([d, p]) => [d, p * (1 - miss)]) } : { config: { default_green: 40, max_green: 60 } }) }).run(seconds).summary().meanDelay;
for (const hour of hours) {
  const row = { hour, fixed: +mean(seeds.map((s) => run('fixed', hour, s, 0))).toFixed(1) };
  for (const miss of misses) row[`missed ${miss}`] = +mean(seeds.map((s) => run('adaptive', hour, s, miss))).toFixed(1);
  console.log(JSON.stringify(row));
}
