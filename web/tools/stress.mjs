// A long stress campaign for the junction, the vehicles and the pedestrians. It is not part of `npm test` because it takes minutes.
// Usage: node tools/stress.mjs <slice> <slices> [seconds] > results.jsonl   (run the slices in parallel, one per core)
// Each line is one run: its settings, what was counted and the first few examples of every kind of violation.

import { CAMERA_RIG } from '../src/sim/world.js';
import { PRESETS, Simulation } from '../src/sim/traffic.js';
import { compatible } from '../src/phases.js';
import { contacts } from '../test/helpers/contact.js';
import { isEmergency } from '../src/sim/world.js';

const [slice = 0, slices = 1, seconds = 1200] = process.argv.slice(2, 5).map(Number);
// Which events to inject: a for ambulances, f for faults, p for pedestrian presses. The default is all of them.
const EVENTS = process.argv[5] ?? 'afp';
// TRACE=config,demand,mode,seed,approach,from,to prints the vehicles on that approach between those times to stderr.
const TRACE = process.env.TRACE ? (([config, demand, mode, seed, approach, from, to]) => ({ config, demand, mode, seed: +seed, approach: +approach, from: +from, to: +to }))(process.env.TRACE.split(',')) : null;

const CRUSH = { rates: [1000, 1000, 1000, 1000], pedRate: 400, clockStartS: 7.5 * 3600, mix: { car: 0.6, truck: 0.1, bus: 0.12, bike: 0.18 } };
const DEMANDS = {
  ...PRESETS,
  crush: CRUSH,
  one_road: { rates: [1000, 0, 0, 0], pedRate: 60, clockStartS: 12 * 3600 },
  cross_roads: { rates: [900, 900, 0, 0], pedRate: 120, clockStartS: 12 * 3600 },
  pedestrians_only: { rates: [0, 0, 0, 0], pedRate: 400, clockStartS: 12 * 3600 },
  vehicles_only: { rates: [800, 800, 800, 800], pedRate: 0, clockStartS: 12 * 3600 },
  trickle: { rates: [30, 30, 30, 30], pedRate: 10, clockStartS: 12 * 3600 },
  clock_8am: { ...PRESETS.clock, clockStartS: 8 * 3600 },
  clock_3am: { ...PRESETS.clock, clockStartS: 3 * 3600 },
  clock_10pm: { ...PRESETS.clock, clockStartS: 22 * 3600 },
  clock_india_8am: { ...PRESETS.clock, clockStartS: 8 * 3600, daily: { vehiclePeak: 750, pedPeak: 180, region: 'in' } },
  clock_india_noon: { ...PRESETS.clock, clockStartS: 12 * 3600, daily: { vehiclePeak: 750, pedPeak: 180, region: 'in' } },
  clock_sat_noon: { ...PRESETS.clock, clockStartS: 5 * 86400 + 12 * 3600 },
};
const CONFIGS = {
  default_noon: { config: {}, clockStartS: 12 * 3600 },
  default_peak: { config: {}, clockStartS: 7.5 * 3600 }, // follow is on here
  follow_always: { config: { left_follow: true, left_follow_windows: [] }, clockStartS: 12 * 3600 },
  left_count: { config: { left_window: 0 }, clockStartS: 12 * 3600, leftCounts: true },
  no_left_arrow: { config: { left_arrow: false, left_window: 0 }, clockStartS: 12 * 3600 },
};
const MODES = ['adaptive', 'fixed'];
const SEEDS = process.env.SEEDS ? process.env.SEEDS.split(',').map(Number) : [11, 12, 13];
const SIGNAL_STATES = ['green', 'yellow', 'walk', 'clear'];

// A small deterministic generator for the events, apart from the simulator's own.
const lcg = (seed) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

function runOne(name, demandName, mode, seed) {
  const c = CONFIGS[name], own = DEMANDS[demandName];
  const demand = { ...own, clockStartS: own.daily ? own.clockStartS : c.clockStartS }; // a demand that follows the clock keeps its own start
  const sim = new Simulation({ seed, mode, demand, config: c.config, ...(process.env.RIG && mode === 'adaptive' ? CAMERA_RIG : {}) }); // RIG=1 puts the adaptive plan behind the camera rig
  const rng = lcg(seed * 7919 + 13);
  const found = {};
  const note = (kind, text) => {
    const entry = found[kind] || (found[kind] = { n: 0, examples: [] });
    entry.n += 1;
    if (entry.examples.length < 3) entry.examples.push(`${text} at ${sim.time.toFixed(0)} s ${sim.snapshot.phase}/${sim.snapshot.stage}`);
  };
  const stillInBox = new Map(), idleAtGreen = new Map(), pedWaitsOnWalk = new Map(), pedProgress = new Map();
  const ambInfo = new Map(), ambDelays = [];
  let lastBoxSteps = 0;
  let redOutsideFault = 0, redInFault = 0, lastRed = 0, faultEnd = -1;
  let prev = null, faultUntil = -1, ambulances = 0, faults = 0, presses = 0, overlapsSeen = new Set();
  const steps = Math.round(seconds / sim.dt);
  // With no left arrow a turner waits in the box for a gap in the oncoming traffic, and in a heavy flow that can last the whole green, so the limit there is one longest green and its clearance.
  const boxLimit = demandName === 'crush' ? 150 : name === 'no_left_arrow' ? sim.controller.cfg.max_green + sim.controller.cfg.yellow + sim.controller.cfg.all_red : 40;

  for (let i = 0; i < steps; i += 1) {
    sim.step();
    const snap = sim.snapshot, faultOrFlash = snap.stage === 'fault' || snap.stage === 'flash';

    // Physical contact, every other step, near the junction where the ground model is exact.
    if (TRACE && TRACE.config === name && TRACE.demand === demandName && TRACE.mode === mode && TRACE.seed === seed && sim.time >= TRACE.from && sim.time <= TRACE.to && i % 5 === 0) {
      const rows = [];
      for (const lane of sim.lanes[TRACE.approach - 1]) for (const v of lane) if (v.d > -30 && v.d < 60) rows.push(`${v.cls}/${v.movement}/L${v.lane} d${v.d.toFixed(1)} v${v.v.toFixed(1)} lx${v.lx.toFixed(1)}${v.pendingTo !== null ? ' pend' + v.pendingTo : ''}${sim.time - v.lcAt < 3 ? ' MOVED' : ''}${v.committed ? ' COMMITTED' : ''}${v.released ? ' RELEASED' : ''}`);
      console.error(`${sim.time.toFixed(1)} ${snap.phase}/${snap.stage} rem${snap.remaining} arrows ${snap.arrows.join(',')} C ${['C1', 'C2', 'C3', 'C4'].map((m) => snap.signals[m][0]).join('')} emerg ${snap.emergency_approach} fault ${snap.fault} | ${rows.join(' ; ')}`);
    }
    if (i % 2 === 0) {
      for (const k of contacts(sim, 0.3)) {
        if (!(k.kinds === 'vv' || k.kinds === 'vp') || Math.abs(k.x) > 60 || Math.abs(k.z) > 60) continue;
        const id = `${k.idA}:${k.idB}`;
        if (overlapsSeen.has(id)) continue;
        overlapsSeen.add(id);
        const detail = (id) => { const v = sim.vehicleList.find((o) => o.id === id); return v ? `[lx${v.lx.toFixed(1)} lane${v.lane} moved ${(sim.time - v.lcAt).toFixed(1)}s ago from ${v.lcFrom}]` : ''; };
        note(k.kinds === 'vv' ? 'overlap vehicle vehicle' : 'overlap vehicle pedestrian', `${k.a}${detail(k.idA)} x ${k.b}${detail(k.idB)} ${k.depth.toFixed(2)} m`);
      }
    }
    if (sim.stats.boxConflictSteps > lastBoxSteps) {
      lastBoxSteps = sim.stats.boxConflictSteps;
      if (!found.__boxLogged) { found.__boxLogged = true; note('box conflict detail', sim.lastInBox.map((v) => `${v.cls}/${v.movement}/a${v.approach}/L${v.lane}/d${v.d.toFixed(0)}/v${v.v.toFixed(1)}${v.cls === 'amb' ? '/requested' + v.requested : ''}`).join(' + ')); }
    }
    if (sim.stepCount % sim.stepsPerSecond !== 0) continue;

    // Red-light runs are counted apart when a fault is running or has just cleared: a vehicle already inside its braking distance when the signals change cannot stop.
    const reds = sim.stats.redRuns - lastRed; lastRed = sim.stats.redRuns;
    if (reds > 0) { if (snap.fault !== null || sim.time < faultEnd + 15) redInFault += reds; else { redOutsideFault += reds; note('ran a red light', `at ${sim.time.toFixed(0)} s`); } }

    // Once a second: events.
    if (EVENTS.includes('a') && rng() < 1 / 150 && ambulances < 6) { sim.dispatchEmergency(1 + Math.floor(rng() * 4), ['through', 'through', 'left', 'right'][Math.floor(rng() * 4)], ['amb', 'amb', 'fire', 'police'][Math.floor(rng() * 4)]); ambulances += 1; }
    if (EVENTS.includes('f') && rng() < 1 / 400 && faults < 2 && snap.stage !== 'fault') { sim.fault('manual'); faultUntil = sim.time + 10 + rng() * 20; faults += 1; }
    if (faultUntil > 0 && sim.time > faultUntil) { sim.clearFault(); faultEnd = sim.time; faultUntil = -1; }
    if (EVENTS.includes('p') && rng() < 1 / 20) { sim.pressButton(1 + Math.floor(rng() * 4)); presses += 1; }

    // Signals: nothing conflicting is lit, nothing goes from green straight to red, the man never steps back.
    if (!faultOrFlash) {
      const lit = [];
      for (const [m, s] of Object.entries(snap.signals)) if (SIGNAL_STATES.includes(s)) lit.push(m);
      snap.arrows.forEach((s, n) => { if (s === 'green' || s === 'yellow') lit.push(`L${n + 1}`); });
      for (let a = 0; a < lit.length; a += 1) for (let b = a + 1; b < lit.length; b += 1) if (!compatible(lit[a], lit[b])) note('conflicting signals', `${lit[a]} with ${lit[b]}`);
      if (prev && prev.stage !== 'fault' && prev.stage !== 'flash') {
        for (const m of Object.keys(snap.signals)) {
          const [was, now] = [prev.signals[m], snap.signals[m]];
          if (m[0] !== 'C' && was === 'green' && now === 'red') note('green straight to red', m);
          if (m[0] === 'C' && ((was === 'walk' && now === 'stop') || (was === 'stop' && now === 'clear') || (was === 'clear' && now === 'walk'))) note('pedestrian signal out of order', `${m} ${was} to ${now}`);
        }
        snap.arrows.forEach((now, n) => { if (prev.arrows[n] === 'green' && now === 'red' && prev.phase === snap.phase && !(prev.emergency_approach === null && snap.emergency_approach !== null)) note('left arrow green straight to red', `L${n + 1}`); });
      }
    }
    prev = snap;
    if (faultOrFlash) continue;

    // Ambulances: what was in the way when the request went out, and how long it took to cross.
    for (const v of sim.vehicleList) {
      if (!isEmergency(v.cls)) continue;
      if (v.requested && ambInfo.has(v.id) && !ambInfo.get(v.id).done && Math.round(sim.time) % 5 === 0 && ambInfo.get(v.id).trace.at(-1)?.[0] !== Math.round(sim.time)) ambInfo.get(v.id).trace.push([Math.round(sim.time), v.lane, +v.d.toFixed(0), +v.v.toFixed(1), snap.signals[v.lane === 2 ? `R${v.approach}` : `T${v.approach}`], `${snap.phase}/${snap.stage}`, v.why || '']);
      if (v.requested && !ambInfo.has(v.id)) ambInfo.set(v.id, { trace: [], requestedAt: sim.time, ahead: sim.lanes[v.approach - 1][v.lane].filter((o) => o.d < v.d).length, phase: `${snap.phase}/${snap.stage}`, remaining: snap.remaining });
      if (v.crossed && ambInfo.has(v.id) && !ambInfo.get(v.id).done) {
        const info = ambInfo.get(v.id); info.done = true;
        ambDelays.push({ trace: (sim.time - v.born - sim.approachLength / 18) > 100 ? info.trace.slice(-14) : undefined, movement: v.movement, delay: +(sim.time - v.born - sim.approachLength / 18).toFixed(1), waitedForSignal: +(sim.time - info.requestedAt).toFixed(1), ahead: info.ahead, phase: info.phase, remaining: info.remaining });
      }
    }

    // Vehicles: nobody stands in the junction for long, and nobody idles at a green with nothing in the way.
    const inBox = sim.vehicleList.filter((v) => v.d < 0 && v.d > -30);
    const pedsCrossing = sim.pedestrians.some((p) => p.state === 'crossing');
    for (const v of sim.vehicleList) {
      if (v.d < 0 && v.d > -20) {
        const n = v.v < 0.3 ? (stillInBox.get(v.id) || 0) + 1 : 0;
        stillInBox.set(v.id, n);
        if (n === boxLimit + 1) note('stood still in the junction', `${v.cls}/${v.movement}/a${v.approach} for ${boxLimit}+ s`);
      }
      const head = sim.lanes[v.approach - 1][v.lane][0] === v;
      const key = `${v.approach}:${v.lane}`;
      const green = snap.signals[`T${v.approach}`] === 'green' && v.lane !== 2 || snap.signals[`R${v.approach}`] === 'green' && v.lane === 2;
      if (head && v.d > 0 && v.d < 3 && v.v < 0.3 && green && !inBox.some((o) => o !== v) && !pedsCrossing && v.movement !== 'left') {
        const n = (idleAtGreen.get(v.id) || 0) + 1;
        idleAtGreen.set(v.id, n);
        if (n === 8) note('idle 8 s at a green with an empty junction and no pedestrian', `${v.cls}/${v.movement}/a${v.approach}/L${v.lane} ${key}`);
      } else idleAtGreen.delete(v.id);
    }

    // Pedestrians: nobody waits on a walk that has room, and nobody stops in the middle of the road.
    for (const p of sim.pedestrians) {
      if (p.state === 'waiting' && snap.signals[`C${p.crossing}`] === 'walk' && snap.remaining > 8 && !sim.crossingOccupied(p.crossing)) {
        const n = (pedWaitsOnWalk.get(p.id) || 0) + 1;
        pedWaitsOnWalk.set(p.id, n);
        if (n === 10) note('pedestrian waits 10 s on a walk with time left', `crossing ${p.crossing}`);
      } else pedWaitsOnWalk.delete(p.id);
      if (p.state === 'crossing') {
        const last = pedProgress.get(p.id);
        if (last && Math.abs(last.progress - p.progress) < 1e-6) {
          last.same += 1;
          if (last.same === 30) note('pedestrian stopped on the road for 30 s', `crossing ${p.crossing}`);
        } else pedProgress.set(p.id, { progress: p.progress, same: 0 });
      }
    }
  }

  const s = sim.summary();
  if (s.boxConflictSteps) note('conflicting vehicles in the box', `${s.boxConflictSteps} steps`);
  const flowed = s.exited / Math.max(1, s.arrivedTotal);
  if (faults === 0 && !['crush', 'one_road', 'peak', 'cross_roads'].includes(demandName) && mode === 'adaptive' && s.arrivedTotal > 50 && flowed < 0.8) note('low throughput', `${(flowed * 100).toFixed(0)}% of arrivals left`);
  return {
    config: name, demand: demandName, mode, seed, seconds, arrived: s.arrivedTotal, exited: s.exited, delay: s.meanDelay === null ? null : +s.meanDelay.toFixed(1),
    ambulanceDelay: s.meanDelayByClass.amb ?? null, ambulances, faults, presses, redInFault, redOutsideFault, ambDelays, violations: found,
  };
}

let index = 0;
for (const name of Object.keys(CONFIGS)) {
  if (process.env.ONLY && process.env.ONLY !== name) continue;
  for (const demandName of Object.keys(DEMANDS)) {
    for (const mode of MODES) {
      for (const seed of SEEDS) {
        if (TRACE && !(TRACE.config === name && TRACE.demand === demandName && TRACE.mode === mode && TRACE.seed === seed)) { index += 1; continue; }
        if (index % slices === slice) console.log(JSON.stringify(runOne(name, demandName, mode, seed)));
        index += 1;
      }
    }
  }
}
