// Demand that follows the clock, and pedestrians who are not all alike.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, Simulation } from '../src/sim/traffic.js';
import { contacts } from './helpers/contact.js';

const DAY = (hour) => hour * 3600;
const run = (options, seconds) => new Simulation(options).run(seconds);
const clockAt = (hour, extra = {}) => ({ ...PRESETS.clock, clockStartS: DAY(hour), ...extra });

test('at 3 am almost nobody walks and few vehicles come, and at 8 am a lot of both', () => {
  const night = run({ seed: 3, demand: clockAt(3) }, 1200).summary();
  const rush = run({ seed: 3, demand: clockAt(8) }, 1200).summary();
  assert.ok(night.pedestrians.arrived <= 6, `${night.pedestrians.arrived} pedestrians at 3 am`);
  assert.ok(rush.pedestrians.arrived > 60, `${rush.pedestrians.arrived} pedestrians at 8 am`);
  assert.ok(night.arrivedTotal * 8 < rush.arrivedTotal, `${night.arrivedTotal} vehicles at 3 am and ${rush.arrivedTotal} at 8 am`);
});

test('the clock demand is the same for both plans, so a comparison is fair', () => {
  const fixed = run({ seed: 4, mode: 'fixed', demand: clockAt(8) }, 900).summary();
  const adaptive = run({ seed: 4, mode: 'adaptive', demand: clockAt(8) }, 900).summary();
  assert.deepEqual(fixed.arrived, adaptive.arrived);
  assert.equal(fixed.pedestrians.spawned, adaptive.pedestrians.spawned, 'the same people set out'); // how many reach the kerb in the hour depends on the traffic they wait for
});

test('a pedestrian who never presses waits for someone else to, and with nobody pressing gives up and walks away', () => {
  const sim = new Simulation({ seed: 5, demand: { ...PRESETS.moderate, pedRate: 120, pedBehaviour: { pressShare: 0, groupShare: 0, quiet: false, patience: [20, 30] } } });
  let pressed = false;
  for (let i = 0; i < 900 / sim.dt; i += 1) {
    sim.step();
    if (sim.snapshot.pedestrian_requests.length > 0) pressed = true;
  }
  const s = sim.summary().pedestrians;
  assert.equal(pressed, false, 'nobody pressed a button');
  assert.equal(s.crossed, 0, 'and so nobody crossed');
  assert.ok(s.gaveUp > 20, `${s.gaveUp} gave up`);
  for (const p of sim.pedestrians) if (p.state === 'waiting') assert.ok(sim.time - p.arrived <= 31 || !sim.leavingClear(p), 'nobody waits longer than their patience, unless the way back out is blocked');
});

test('one who gives up walks back out the way they came, from where they stand', () => {
  const sim = new Simulation({ seed: 6, demand: { ...PRESETS.moderate, pedRate: 120, pedBehaviour: { pressShare: 0, groupShare: 0, quiet: false, patience: [5, 6] } } });
  let checked = 0;
  for (let i = 0; i < 400 / sim.dt && checked < 5; i += 1) {
    const before = new Map(sim.pedestrians.filter((p) => p.state === 'waiting').map((p) => [p.id, { x: p.px, z: p.pz, dir: p.dir }]));
    sim.step();
    for (const p of sim.pedestrians) {
      const was = before.get(p.id);
      if (was && p.state === 'leaving' && p.gaveUp) {
        assert.equal(p.dir, -was.dir, 'it turns round');
        assert.ok(Math.hypot(p.px - was.x, p.pz - was.z) < 0.3, 'and does not jump');
        checked += 1;
      }
    }
  }
  assert.ok(checked > 0, 'a pedestrian gave up');
});

test('pedestrians arrive in groups that walk together in one direction', () => {
  const sim = new Simulation({ seed: 7, demand: { ...PRESETS.moderate, pedRate: 120, pedBehaviour: { pressShare: 1, groupShare: 1, quiet: false, patience: [60, 90] } } });
  sim.run(1200);
  const byCrossing = [1, 2, 3, 4].map((j) => sim.pedestrians.filter((p) => p.crossing === j).sort((a, b) => a.born - b.born));
  let pairs = 0;
  for (const list of byCrossing) for (let i = 1; i < list.length; i += 1) if (list[i].born - list[i - 1].born < 1 && list[i].dir === list[i - 1].dir) pairs += 1;
  assert.ok(pairs > 10, `${pairs} neighbours walking together`);
});

test('there are quiet spells with nobody and busy spells with a rush', () => {
  const sim = new Simulation({ seed: 8, demand: { ...PRESETS.moderate, pedRate: 180, pedBehaviour: { pressShare: 1, groupShare: 0, quiet: true, patience: [60, 90] } } });
  const perMinute = [];
  let last = 0;
  for (let m = 1; m <= 40; m += 1) { sim.run(60); perMinute.push(sim.stats.ped.arrived - last); last = sim.stats.ped.arrived; }
  const quiet = perMinute.filter((n) => n <= 1).length, busy = perMinute.filter((n) => n >= 14).length;
  assert.ok(quiet >= 3, `${quiet} quiet minutes in ${perMinute}`);
  assert.ok(busy >= 3, `${busy} busy minutes in ${perMinute}`);
});

test('with all of this going on nothing overlaps near the junction', () => {
  for (const hour of [8, 12, 22]) {
    const sim = new Simulation({ seed: 9, demand: clockAt(hour) });
    const found = new Set();
    for (let i = 0; i < 600 / sim.dt; i += 1) {
      sim.step();
      if (i % 2) continue;
      for (const c of contacts(sim, 0.3)) if ((c.kinds === 'vv' || c.kinds === 'vp') && Math.abs(c.x) < 60 && Math.abs(c.z) < 60) found.add(`${c.idA}:${c.idB}`);
    }
    assert.equal(found.size, 0, `hour ${hour}: ${found.size} overlaps`);
  }
});

// Regression: on the page's long roads, an articulated bus turning into a side street, and cars from two approaches merging in one
// exit lane, once locked each other for good. The exit road crawled, the queue grew past 800 vehicles and nothing crossed.
test('on long roads at the morning peak nothing stays held for minutes and the junction keeps discharging', () => {
  const sim = new Simulation({ seed: 3, mode: 'adaptive', demand: { ...PRESETS.clock, clockStartS: 7.5 * 3600 }, approachLength: 700, exitRun: 640, pedestrianWalk: 560 });
  let worst = 0;
  for (let second = 0; second < 1500; second += 1) {
    for (let k = 0; k < 10; k += 1) sim.step();
    for (const v of sim.vehicleList) worst = Math.max(worst, v.stall);
  }
  assert.ok(worst < 600, `a vehicle was held for ${worst / 10} s`);
  assert.ok(sim.stats.crossed > 1000, `only ${sim.stats.crossed} crossed in 25 minutes`);
});

// Regression: right after the page opens (seed 11, ten minutes in), a long bus turning left from the kerb lane waits mid-turn for pedestrians, and a truck
// going straight in the lane beside it drove in alongside. The bus then waited for the truck's body and the truck for the bus's swinging tail, and both
// crept for many seconds. The truck now waits at the line, and crosses in a few seconds once the bus has gone.
test('a truck does not drive in beside a long vehicle that is turning left, and no two vehicles hold each other', () => {
  const sim = new Simulation({ seed: 11, mode: 'adaptive', demand: { ...PRESETS.clock, clockStartS: 7.5 * 3600 }, approachLength: 700, exitRun: 640, pedestrianWalk: 560 });
  let first = null, last = null;
  for (let second = 0; second < 800; second += 1) {
    for (let k = 0; k < 10; k += 1) sim.step();
    const truck = sim.vehicleList.find((v) => v.id === 419);
    if (truck && truck.d < 0 && truck.d > -34) { first ??= sim.time; last = sim.time; }
  }
  assert.ok(first !== null, 'the truck crossed');
  assert.ok(last - first <= 8, `the truck took ${last - first} s to cross the junction`);
});
