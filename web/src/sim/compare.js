// Fixed timing against adaptive control on identical seeded traffic.
//
// Both modes see exactly the same arrivals: vehicle times, classes and turns, and pedestrians,
// come from random streams that do not depend on the controller. Only the signals differ.

import { PRESETS, Simulation } from './traffic.js';
import { CAMERA_RIG, CLASSES } from './world.js';

// A fixed plan runs one green length for every phase. The cap that adaptive timing has in the simulator (SIM_CONTROLLER_CONFIG) does not apply to it, so a long green is allowed up to the controller's own 60 s.
const fixedPlan = (green, config = {}) => ({ ...config, default_green: green, max_green: 60 });

export function describe(values) {
  const clean = values.filter((v) => v !== null && Number.isFinite(v));
  const n = clean.length;
  if (n === 0) return { n: 0, mean: null, sd: null, min: null, max: null };
  const mean = clean.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(clean.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  return { n, mean, sd, min: Math.min(...clean), max: Math.max(...clean) };
}

// What is compared. lowerIsBetter says which direction is an improvement.
export const METRICS = [
  { key: 'meanDelay', label: 'Mean vehicle delay (s)', pick: (s) => s.meanDelay, lowerIsBetter: true },
  { key: 'stops', label: 'Stops per vehicle', pick: (s) => s.stopsPerVehicle, lowerIsBetter: true },
  { key: 'throughput', label: 'Vehicles through per hour', pick: (s) => s.throughputPerHour, lowerIsBetter: false },
  { key: 'meanQueue', label: 'Mean vehicles queued', pick: (s) => s.meanQueue, lowerIsBetter: true },
  { key: 'busDelay', label: 'Mean bus delay (s)', pick: (s) => s.meanDelayByClass.bus, lowerIsBetter: true },
  { key: 'pedWait', label: 'Mean pedestrian wait (s)', pick: (s) => s.pedestrians.meanWait, lowerIsBetter: true },
];

// The best single green time for a fixed plan: every phase gets the same green. It is found on
// tuning seeds that the comparison does not use, so the plan is not fitted to the seeds it is
// scored on. A real fixed plan is tuned like this, so it is a fairer baseline than the default.
export function tuneFixed({ preset = 'moderate', demand = null, seeds = [101, 102, 103], seconds = 1800, config = {},
  candidates = [6, 8, 10, 12, 15, 20, 25, 30, 40] } = {}) {
  const chosen = demand || PRESETS[preset];
  let best = null;
  for (const green of candidates) {
    const delays = seeds.map((seed) => new Simulation({
      seed, mode: 'fixed', demand: chosen, config: fixedPlan(green, config),
    }).run(seconds).summary().meanDelay);
    const mean = describe(delays).mean;
    if (best === null || mean < best.delay) best = { green, delay: mean };
  }
  return best;
}

// The plan a real junction would run: one green time for every phase, chosen once for the whole day and used at every hour and every demand. The best single
// green is found over a typical day (the morning rush, midday, the evening rush and the quiet of the night, on a weekday) on seeds the tables do not use.
// Every kind of vehicle the page has, in the shares of an ordinary working day and of a rush hour (as in daily.js, for Australia).
export const FULL_MIX = {
  work: { car: 0.6, van: 0.1, truck: 0.08, semi: 0.04, bus: 0.06, artbus: 0.02, bike: 0.05, scooter: 0.05 },
  rush: { car: 0.62, van: 0.08, truck: 0.04, semi: 0.01, bus: 0.1, artbus: 0.03, bike: 0.05, scooter: 0.07 },
};

// How much road a vehicle takes up in a queue: its length and the gap it leaves in front of it.
const occupancy = (mix) => { let total = 0, weight = 0; for (const [cls, share] of Object.entries(mix)) { total += share * (CLASSES[cls].length + CLASSES[cls].s0); weight += share; } return total / weight; };
const ORIGINAL_MIX = { car: 0.76, truck: 0.06, bus: 0.04, bike: 0.14 };

// A demand with the full mix of vehicles, at the same lane load as the original preset. The presets give a number of vehicles an hour for the original four
// types. The full mix has longer vehicles (buses, semis, vans), so the same number of them would load the road far more, and a preset meant as a busy hour would
// become a jam for any plan. So the rates are scaled by how much road the mix takes up, and what changes is what the vehicles are.
export function withFullMix(base, mix) {
  const k = occupancy(ORIGINAL_MIX) / occupancy(mix), scale = (rates) => rates.map((r) => r * k);
  return { ...base, mix, rates: scale(base.rates), ...(base.profile ? { profile: base.profile.map(([t, rates]) => [t, scale(rates)]) } : {}), pedRate: base.pedRate };
}

export function tuneRealistic({ seeds = [201, 202], seconds = 1200, candidates = [6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60] } = {}) {
  const hours = [8, 12, 17.5, 22];
  let best = null;
  for (const green of candidates) {
    const delays = [];
    for (const hour of hours) for (const seed of seeds) {
      const demand = { ...PRESETS.clock, clockStartS: hour * 3600 };
      delays.push(new Simulation({ seed, mode: 'fixed', demand, config: fixedPlan(green) }).run(seconds).summary().meanDelay);
    }
    const mean = describe(delays).mean;
    if (best === null || mean < best.delay) best = { green, delay: mean };
  }
  return best;
}

export function compare({ preset = 'moderate', demand = null, seeds = [1, 2, 3, 4, 5], seconds = 3600, config = {},
  detectionMiss = 0, tuned = true, realisticGreen = null, fullMix = false, rig = null } = {}) {
  // rig: the cameras the adaptive plan sees through (CAMERA_RIG), or none for a perfect count of what is within 60 m. The fixed plans do not use cameras.
  const { lengthCounts = false, detectionZone, detectionCurve = null } = rig || {};
  const base = demand || PRESETS[preset];
  // a peak is a rush hour, with few semis and trucks
  const chosen = fullMix && base ? withFullMix(base, preset === 'bus_hours' || preset === 'peak' ? FULL_MIX.rush : FULL_MIX.work) : base;
  if (!chosen) throw new Error(`unknown preset ${preset}`);
  const runs = { fixed: [], adaptive: [] };
  const tunedPlan = tuned ? tuneFixed({ preset, demand: chosen, config }) : null;
  if (tuned) runs.fixedTuned = [];
  if (realisticGreen !== null) runs.fixedRealistic = [];
  for (const seed of seeds) {
    for (const mode of ['fixed', 'adaptive']) {
      const sim = new Simulation({ seed, mode, demand: chosen, config, detectionMiss, lengthCounts, detectionZone, detectionCurve });
      runs[mode].push(sim.run(seconds).summary());
    }
    if (realisticGreen !== null) runs.fixedRealistic.push(new Simulation({ seed, mode: 'fixed', demand: chosen, config: fixedPlan(realisticGreen, config) }).run(seconds).summary());
    if (tuned) {
      const sim = new Simulation({ seed, mode: 'fixed', demand: chosen, config: fixedPlan(tunedPlan.green, config) });
      runs.fixedTuned.push(sim.run(seconds).summary());
    }
  }
  const rows = METRICS.map((m) => {
    const fixed = runs.fixed.map(m.pick);
    const adaptive = runs.adaptive.map(m.pick);
    const paired = fixed.map((f, i) => (f === null || adaptive[i] === null ? null : m.lowerIsBetter ? f - adaptive[i] : adaptive[i] - f));
    const better = paired.filter((d) => d !== null && d > 0).length;
    const row = { ...m, fixed: describe(fixed), adaptive: describe(adaptive), improvement: describe(paired), adaptiveBetterIn: better, seedsCompared: paired.filter((d) => d !== null).length };
    if (tuned) {
      const tunedValues = runs.fixedTuned.map(m.pick);
      const against = tunedValues.map((f, i) => (f === null || adaptive[i] === null ? null : m.lowerIsBetter ? f - adaptive[i] : adaptive[i] - f));
      row.fixedTuned = describe(tunedValues);
      row.adaptiveBetterThanTunedIn = against.filter((d) => d !== null && d > 0).length;
    }
    if (realisticGreen !== null) {
      const realistic = runs.fixedRealistic.map(m.pick);
      row.fixedRealistic = describe(realistic);
      row.adaptiveBetterThanRealisticIn = realistic.map((f, i) => (f === null || adaptive[i] === null ? null : m.lowerIsBetter ? f - adaptive[i] : adaptive[i] - f)).filter((d) => d !== null && d > 0).length;
    }
    return row;
  });
  const arrived = runs.fixed.map((s, i) => [s.arrivedTotal, runs.adaptive[i].arrivedTotal]);
  return { preset, seeds, seconds, runs, rows, tunedPlan, realisticGreen, sameArrivals: arrived.every(([a, b]) => a === b) };
}

export function markdownTable(result) {
  const fmt = (d) => (d.mean === null ? 'n/a' : `${d.mean.toFixed(1)} ± ${d.sd.toFixed(1)}`);
  if (result.realisticGreen !== null && result.realisticGreen !== undefined) {
    const lines = [`| Measure | Fixed, default 10 s | Fixed, one plan for the day (${result.realisticGreen} s) | Fixed, tuned to this demand (${result.tunedPlan ? result.tunedPlan.green : '-'} s) | Adaptive | Adaptive better than the day plan in |`, '|---|---|---|---|---|---|'];
    for (const row of result.rows) lines.push(`| ${row.label} | ${fmt(row.fixed)} | ${fmt(row.fixedRealistic)} | ${row.fixedTuned ? fmt(row.fixedTuned) : 'n/a'} | ${fmt(row.adaptive)} | ${row.adaptiveBetterThanRealisticIn} of ${row.seedsCompared} seeds |`);
    return lines.join('\n');
  }
  if (!result.tunedPlan) {
    const lines = ['| Measure | Fixed | Adaptive | Adaptive better in |', '|---|---|---|---|'];
    for (const row of result.rows) lines.push(`| ${row.label} | ${fmt(row.fixed)} | ${fmt(row.adaptive)} | ${row.adaptiveBetterIn} of ${row.seedsCompared} seeds |`);
    return lines.join('\n');
  }
  const lines = [`| Measure | Fixed, default 10 s | Fixed, tuned ${result.tunedPlan.green} s | Adaptive | Adaptive better than tuned in |`, '|---|---|---|---|---|'];
  for (const row of result.rows) {
    lines.push(`| ${row.label} | ${fmt(row.fixed)} | ${fmt(row.fixedTuned)} | ${fmt(row.adaptive)} | ${row.adaptiveBetterThanTunedIn} of ${row.seedsCompared} seeds |`);
  }
  return lines.join('\n');
}

// ---- emergency vehicles, fixed against adaptive ----
// The same calls go to both plans: every EMERGENCY_EVERY seconds an emergency vehicle comes in, on a road and with a turn that are chosen once from the seed. The adaptive plan gives them priority (the controller holds or
// changes the signals for them from 120 m out). The fixed plan has none, as a fixed-time signal has none: an emergency vehicle there waits for its green like anyone else, though it still moves through the traffic as
// the simulator moves emergency vehicles and the traffic still slows for it. Real drivers often do more at a red (an emergency vehicle may stop and then go through when it is clear), which is not modelled, so the
// fixed numbers are the wait of an emergency vehicle that keeps to the signal.
export const EMERGENCY_EVERY = 240, EMERGENCY_FIRST = 120;
export function emergencyEvents(seed, seconds, every = EMERGENCY_EVERY) {
  let state = (seed * 2654435761 + 12345) >>> 0;
  const next = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
  const events = [];
  for (let t = EMERGENCY_FIRST; t < seconds - 60; t += every) { // the last minute is left for the last one to cross
    const m = next(), k = next();
    events.push({ t, approach: 1 + Math.floor(next() * 4), movement: m < 0.6 ? 'through' : m < 0.8 ? 'left' : 'right', kind: k < 0.6 ? 'amb' : k < 0.8 ? 'fire' : 'police' });
  }
  return events;
}
// One run of one plan with the calls. Returns the simulation's emergency summary ({ crossed, meanWait, worstWait, waits }).
export function emergencyRun({ demand, seed, seconds = 3600, mode, rig = {}, every = EMERGENCY_EVERY }) {
  const sim = new Simulation({ seed, mode, demand, ...(mode === 'adaptive' ? rig : { config: fixedPlan(40) }), emergencyPriority: mode === 'adaptive' });
  const events = emergencyEvents(seed, seconds, every);
  let next = 0;
  for (let i = 0; i < seconds * 10; i += 1) {
    while (next < events.length && events[next].t <= sim.time) { const e = events[next]; sim.dispatchEmergency(e.approach, e.movement, e.kind); next += 1; }
    sim.step();
  }
  return { ...sim.summary().emergency, meanDelay: sim.summary().meanDelay, boxConflictSteps: sim.summary().boxConflictSteps };
}
