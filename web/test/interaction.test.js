// Vehicles, turns and pedestrians together: nothing may overlap near the junction, nothing may stall in it for long, every
// preset must keep getting vehicles through, and a turning vehicle must give way to pedestrians as the rule says.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, Simulation } from '../src/sim/traffic.js';
import { CLASSES } from '../src/sim/world.js';
import { pedestrianPose } from '../src/sim/tracks.js';
import { contacts, watch } from './helpers/contact.js';

const CRUSH = { rates: [1000, 1000, 1000, 1000], pedRate: 400, clockStartS: 7.5 * 3600, mix: { car: 0.6, truck: 0.1, bus: 0.12, bike: 0.18 } };
const CASES = [...Object.entries(PRESETS), ['crush', CRUSH]];
const NEAR = 60; // metres from the middle of the junction

test('near the junction no vehicle overlaps another vehicle or a pedestrian, in any preset or a very heavy one', () => {
  for (const [name, demand] of CASES) {
    const sim = new Simulation({ seed: 3, mode: 'adaptive', demand });
    const found = watch(sim, 600, { minDepth: 0.3 }).filter((c) => (c.kinds === 'vv' || c.kinds === 'vp') && Math.abs(c.x) < NEAR && Math.abs(c.z) < NEAR);
    assert.equal(found.length, 0, `${name}: ${found.slice(0, 3).map((c) => `${c.a} x ${c.b} ${c.depth.toFixed(2)} m at ${c.time.toFixed(0)} s`).join('; ')}`);
  }
});

test('pedestrians never end up on top of each other, including those who turn the corner into a queue', () => {
  for (const [name, demand] of [['clock', PRESETS.clock], ['crush', CRUSH]]) {
    const sim = new Simulation({ seed: 5, mode: 'adaptive', demand });
    const found = watch(sim, 1500, { minDepth: 0.3 }).filter((c) => c.kinds === 'pp' && Math.abs(c.x) < NEAR && Math.abs(c.z) < NEAR);
    assert.equal(found.length, 0, `${name}: ${found.slice(0, 3).map((c) => `${c.a} x ${c.b} ${c.depth.toFixed(2)} m at ${c.time.toFixed(0)} s`).join('; ')}`);
  }
});

test('no vehicle stands still in the junction for long, in any preset or a very heavy one', () => {
  for (const [name, demand] of CASES) {
    for (const mode of ['adaptive', 'fixed']) {
      const sim = new Simulation({ seed: 4, mode, demand });
      const still = new Map();
      let longest = 0;
      for (let i = 0; i < 6000; i += 1) {
        sim.step();
        for (const v of sim.vehicleList) {
          if (v.d >= 0 || v.d <= -20) continue;
          const n = v.v < 0.3 ? (still.get(v.id) || 0) + 1 : 0;
          still.set(v.id, n);
          longest = Math.max(longest, n);
        }
      }
      // A turner waits inside the junction for pedestrians, and a signal change can add to that, so allow up to 40 s. The heavy case has a pedestrian
      // arriving at each crossing every 9 s, so a turner there can wait a good while, but never for ever.
      const limit = name === 'crush' ? 150 : 40;
      assert.ok(longest / sim.stepsPerSecond <= limit, `${name} ${mode}: a vehicle stood still in the junction for ${(longest / sim.stepsPerSecond).toFixed(0)} s, limit ${limit}`);
    }
  }
});

test('every preset keeps getting vehicles through, so a gridlock cannot go unnoticed', () => {
  // The steady presets, and the clock demand at midday, where it is flat. In the morning the clock demand falls on purpose.
  const cases = [...Object.entries(PRESETS).filter(([, demand]) => !demand.daily), ['clock at noon', { ...PRESETS.clock, clockStartS: 12 * 3600 }]];
  for (const [name, demand] of cases) {
    for (const mode of ['adaptive', 'fixed']) {
      const sim = new Simulation({ seed: 11, mode, demand, approachLength: 700, exitRun: 640, pedestrianWalk: 560 });
      sim.run(1200);
      const early = sim.stats.crossed;
      sim.run(1200);
      const late = sim.stats.crossed - early;
      assert.ok(late > 0.6 * early, `${name} ${mode}: ${early} vehicles got through in the first 20 minutes and only ${late} in the next 20`);
    }
  }
});

// A scene with nothing but one left turner at the stop line of approach 1 and its signal held green. Pedestrians are put on the
// crossing it turns across (C2), and the test watches when its front reaches that crossing.
function leftTurnScene({ walkers = [], signal = 'walk' }) {
  const sim = new Simulation({ seed: 1, demand: { rates: [0, 0, 0, 0], pedRate: 0, clockStartS: 12 * 3600 } });
  sim.run(1);
  const green = { ...sim.snapshot, phase: 'T13', stage: 'green', signals: { ...sim.snapshot.signals, T1: 'green', T3: 'green', C2: signal }, arrows: ['red', 'red', 'red', 'red'] };
  sim.controller.tick = () => green;
  sim.snapshot = green;
  const c = CLASSES.car;
  const car = { id: 9001, vid: 't', cls: 'car', movement: 'left', approach: 1, lane: 0, length: c.length, width: c.width, d: 8, v: 0, born: 0, emergency: false,
    requested: false, committed: false, released: false, crossed: false, wasStopped: false, stoppedSince: null, via: 0, lcAt: -Infinity, lx: 8,
    pendingTo: null, pendingSince: 0, signalSide: null, signalUntil: -Infinity, held: 0, stall: 0, inside: false, enteredAt: Infinity, exitVia: 0, pose: null };
  sim.lanes[0][0].push(car);
  sim.placeVehicle(car);
  walkers.forEach((w, i) => {
    const ped = { id: 8000 + 2 * i + (w.dir > 0 ? 1 : 0), crossing: 2, dir: w.dir, state: w.state || 'crossing', born: 0, toKerb: w.toKerb || 0, speed: 1.2, progress: w.progress ?? 0, away: 0, px: 0, pz: 0, stall: 0 };
    ped.pose = pedestrianPose(ped); ped.px = ped.pose.x; ped.pz = ped.pose.z;
    sim.pedestrians.push(ped);
  });
  return { sim, car };
}

// Run until the front of the car reaches the crossing, and say how far each pedestrian had walked by then.
function runUntilItCrosses(scene, seconds = 60) {
  const { sim, car } = scene;
  const at = sim.zebraDistance(car);
  for (let i = 0; i < seconds * 10; i += 1) {
    sim.step();
    if (-car.d >= at - 0.5) return { time: sim.time, walkers: sim.pedestrians.map((p) => ({ state: p.state, progress: p.progress })), contacts: contacts(sim, 0.2).filter((c) => c.kinds === 'vp') };
  }
  return null;
}

test('a left turner with no one crossing goes at once and does not stop', () => {
  const result = runUntilItCrosses(leftTurnScene({ walkers: [] }), 20);
  assert.ok(result, 'it reached the crossing');
  assert.ok(result.time < 8, `it took ${result.time} s with nobody in the way`);
});

test('a left turner waits for a pedestrian coming toward its lane, and goes once they are past it', () => {
  // One pedestrian starting from the far side of the road, walking toward the turner's exit lane. Where the turner's lane is along the crossing
  // is where the pedestrian is when it is 2 m past.
  const scene = leftTurnScene({ walkers: [{ dir: -1, progress: 3 }] });
  const result = runUntilItCrosses(scene, 80);
  assert.ok(result, 'it did get through');
  assert.equal(result.contacts.length, 0, 'it never drove into the pedestrian');
  assert.ok(result.time > 5, `it did not wait for the pedestrian (${result.time} s)`);
  const walker = result.walkers[0];
  assert.ok(walker === undefined || walker.state !== 'crossing' || walker.progress > 8, `the pedestrian was only ${walker?.progress} m across when it went`);
});

test('a left turner waits for pedestrians coming from both sides until both have gone past', () => {
  const scene = leftTurnScene({ walkers: [{ dir: -1, progress: 2 }, { dir: 1, progress: 2 }] });
  const result = runUntilItCrosses(scene, 90);
  assert.ok(result, 'it did get through');
  assert.equal(result.contacts.length, 0, 'it never drove into a pedestrian');
  for (const walker of result.walkers) assert.ok(walker.state !== 'crossing' || walker.progress > 8, `a pedestrian was only ${walker.progress} m across when it went`);
});

test('a left turner does not wait for pedestrians who are only waiting at the kerb while their signal is red', () => {
  const result = runUntilItCrosses(leftTurnScene({ walkers: [{ dir: 1, state: 'waiting', toKerb: 0 }], signal: 'stop' }), 20);
  assert.ok(result && result.time < 8, 'it went at once');
});

test('a left turner does wait for pedestrians waiting at the kerb while their signal shows walk', () => {
  const scene = leftTurnScene({ walkers: [{ dir: 1, state: 'waiting', toKerb: 0 }], signal: 'walk' });
  scene.sim.step();
  assert.equal(scene.sim.pedestrianAtExit(scene.car), true);
});

test('a bus mid-turn whose tail clips a stopped truck beside it works itself free instead of locking the junction (regression)', () => {
  // With the camera counting 90 m back, this seed once left a right-turning bus stuck for the rest of the run, because it and the truck waited for each other.
  const sim = new Simulation({ seed: 104, mode: 'adaptive', demand: PRESETS.moderate, detectionZone: 90 });
  const still = new Map();
  let longest = 0;
  for (let i = 0; i < 12000; i += 1) {
    sim.step();
    for (const v of sim.vehicleList) {
      if (v.d >= 0 || v.d <= -30) continue;
      const n = v.v < 0.3 ? (still.get(v.id) || 0) + 1 : 0;
      still.set(v.id, n);
      longest = Math.max(longest, n);
    }
  }
  assert.ok(longest / sim.stepsPerSecond < 60, `a vehicle stood still in the junction for ${(longest / sim.stepsPerSecond).toFixed(0)} s`);
  assert.ok(sim.stats.crossed > 550, `only ${sim.stats.crossed} vehicles got through in 20 minutes`);
});

test('every pedestrian lane lies on the footpath, clear of the street trees and the lamps', async () => {
  const { walkAcross } = await import('../src/sim/tracks.js');
  const { PEDESTRIAN_LANES, pedestrianExtent } = await import('../src/sim/world.js');
  const half = pedestrianExtent(0).width / 2;
  const TREE = 10.5 + 0.3, LAMP = 13.05 - 0.15, BUILDING = 13.2; // trunk edge, lamp pole edge, building line, metres from the middle of the road
  const seen = new Set();
  for (const dir of [1, -1]) {
    for (let lane = 0; lane < PEDESTRIAN_LANES; lane += 1) {
      const out = -walkAcross(dir, lane);
      seen.add(out.toFixed(3));
      assert.ok(out - half > TREE, `dir ${dir} lane ${lane} touches a tree at ${out}`);
      assert.ok(out + half < LAMP, `dir ${dir} lane ${lane} touches a lamp at ${out}`);
      assert.ok(out + half < BUILDING, `dir ${dir} lane ${lane} is inside a building at ${out}`);
    }
  }
  assert.equal(seen.size, 2 * PEDESTRIAN_LANES, 'no two lanes share a line');
});
