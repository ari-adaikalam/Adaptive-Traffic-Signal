import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, Simulation } from '../src/sim/traffic.js';
import { compare, describe, tuneFixed } from '../src/sim/compare.js';
import { makeRng } from '../src/sim/rng.js';
import { CLASSES, KERB } from '../src/sim/world.js';

const run = (options, seconds) => new Simulation(options).run(seconds);

test('the random numbers are reproducible and the exponential gaps average the right value', () => {
  const a = makeRng(5);
  const b = makeRng(5);
  assert.deepEqual([a.next(), a.next(), a.next()], [b.next(), b.next(), b.next()]);
  const rng = makeRng(9);
  let total = 0;
  for (let i = 0; i < 20000; i += 1) total += rng.gap(600);
  assert.ok(Math.abs(total / 20000 - 6) < 0.15, 'mean gap at 600 an hour is 6 s');
  assert.equal(makeRng(1).gap(0), Infinity);
});

test('a run is deterministic, and a different seed gives a different run', () => {
  const one = run({ seed: 3, mode: 'adaptive', demand: PRESETS.moderate }, 900).summary();
  const two = run({ seed: 3, mode: 'adaptive', demand: PRESETS.moderate }, 900).summary();
  const other = run({ seed: 4, mode: 'adaptive', demand: PRESETS.moderate }, 900).summary();
  assert.deepEqual(one, two);
  assert.notDeepEqual(one.arrived, other.arrived);
});

test('both modes see exactly the same arrivals', () => {
  for (const preset of ['light', 'peak', 'uneven']) {
    const fixed = run({ seed: 2, mode: 'fixed', demand: PRESETS[preset] }, 900);
    const adaptive = run({ seed: 2, mode: 'adaptive', demand: PRESETS[preset] }, 900);
    assert.deepEqual(fixed.summary().arrived, adaptive.summary().arrived, preset);
    // A pedestrian does not spawn onto an occupied spot, so the two plans can differ by a few of the arrivals.
    assert.ok(Math.abs(fixed.stats.ped.arrived - adaptive.stats.ped.arrived) <= 0.03 * fixed.stats.ped.arrived, preset);
  }
});

test('every arriving vehicle is accounted for', () => {
  for (const mode of ['fixed', 'adaptive']) {
    const s = run({ seed: 6, mode, demand: PRESETS.peak }, 1200).summary();
    assert.equal(s.arrivedTotal, s.inSystem + s.exited, mode);
    assert.ok(s.crossed >= s.exited && s.crossed <= s.arrivedTotal);
  }
});

test('vehicles never overlap, never reverse and never exceed the speed limit', () => {
  class Checked extends Simulation {
    updateVehicles() {
      super.updateVehicles();
      for (const approach of this.lanes) {
        for (const lane of approach) {
          lane.forEach((v, i) => {
            this.fastest = Math.max(this.fastest || 0, v.v);
            if (v.v < 0) this.reversed = true;
            if (i > 0 && lane[i - 1].d > -8 && v.d - (lane[i - 1].d + lane[i - 1].length) < -0.01) this.overlap = true;
          });
        }
      }
    }
  }
  const sim = new Checked({ seed: 4, mode: 'adaptive', demand: PRESETS.peak }).run(1800);
  assert.ok(!sim.overlap && !sim.reversed);
  assert.ok(sim.fastest <= 18.01, `fastest ${sim.fastest}`);
});

test('a queue of cars discharges at about 2.1 s a lane, the calibration target', () => {
  class Probe extends Simulation {
    afterMove(v) {
      const before = v.crossed;
      super.afterMove(v);
      if (!before && v.crossed && v.approach === 1 && v.lane === 1) (this.crossings ||= []).push(this.time);
    }
  }
  const sim = new Probe({ seed: 3, mode: 'fixed', demand: { ...PRESETS.peak, rates: [1400, 100, 100, 100], mix: { car: 1 }, turns: { through: 1 } } }).run(1200);
  const gaps = sim.crossings.slice(1).map((t, i) => t - sim.crossings[i]).filter((g) => g < 6).sort((x, y) => x - y);
  const median = gaps[Math.floor(gaps.length / 2)];
  assert.ok(gaps.length > 80);
  assert.ok(median > 1.9 && median < 2.3, `median headway ${median}`);
});

test('no demand means no vehicles and no delay', () => {
  const s = run({ seed: 1, demand: { rates: [0, 0, 0, 0], pedRate: 0 } }, 300).summary();
  assert.equal(s.arrivedTotal, 0);
  assert.equal(s.meanDelay, null);
  assert.equal(s.pedestrians.arrived, 0);
});

test('light traffic is delayed about as theory says, and nothing runs a red or meets in the box', () => {
  for (const mode of ['fixed', 'adaptive']) {
    for (const preset of Object.keys(PRESETS)) {
      const s = run({ seed: 5, mode, demand: PRESETS[preset] }, 1800).summary();
      assert.equal(s.redRuns, 0, `${preset} ${mode}`);
      assert.equal(s.boxConflictSteps, 0, `${preset} ${mode}`);
    }
  }
  const light = run({ seed: 2, mode: 'fixed', demand: PRESETS.light }, 3600).summary();
  // A 64 second cycle with 10 s greens: the average wait is near red^2 / (2 * cycle), about 23 s.
  assert.ok(light.meanDelay > 18 && light.meanDelay < 35, `light fixed delay ${light.meanDelay}`);
});

test('while the bus lane is active only buses, bikes and left-turning vehicles use it', () => {
  const sim = new Simulation({ seed: 7, mode: 'adaptive', demand: PRESETS.bus_hours });
  let checked = 0;
  for (let second = 0; second < 1500; second += 1) {
    sim.run(1);
    if (!sim.snapshot.bus_lane_active) continue;
    for (const approach of sim.lanes) {
      for (const v of approach[KERB]) {
        checked += 1;
        assert.ok(v.cls === 'bus' || v.cls === 'bike' || v.movement === 'left', `${v.cls} ${v.movement} in the bus lane at ${v.d}`);
      }
    }
  }
  assert.ok(checked > 500);
});

test('an ambulance gets priority, and no request is left behind', () => {
  const sim = new Simulation({ seed: 6, mode: 'adaptive', demand: PRESETS.peak });
  sim.run(120);
  for (let approach = 1; approach <= 4; approach += 1) {
    sim.dispatchAmbulance(approach);
    sim.run(240);
  }
  sim.run(120);
  const s = sim.summary();
  assert.equal(sim.stats.delay.amb[1], 4);
  assert.ok(s.meanDelayByClass.amb < s.meanDelayByClass.car, `ambulance ${s.meanDelayByClass.amb} car ${s.meanDelayByClass.car}`);
  assert.equal(sim.controller.emergencies.size, 0);
});

test('on a long road an ambulance comes in close to the junction, in its own lane and in order', () => {
  for (const approachLength of [200, 700]) {
    const sim = new Simulation({ seed: 6, mode: 'adaptive', demand: PRESETS.peak, approachLength });
    sim.run(120);
    const id = sim.dispatchAmbulance(2, 'through');
    sim.run(1);
    const v = sim.vehicleList.find((x) => x.vid === id);
    assert.ok(v, 'it has come in');
    if (approachLength === 200) assert.ok(v.d > 150, 'on a short road nothing changes');
    else assert.ok(v.d > 200 && v.d < 400, `it came in ${v.d} m from the line, not at the far end`);
    for (const lane of sim.lanes[1]) {
      for (let i = 1; i < lane.length; i += 1) {
        assert.ok(lane[i].d >= lane[i - 1].d, 'the lane stays in order');
        assert.ok(lane[i].d - (lane[i - 1].d + lane[i - 1].length) > -0.5, 'nobody overlaps');
      }
    }
    sim.run(90);
    assert.equal(sim.controller.emergencies.size, 0);
    assert.ok(sim.stats.delay.amb[1] >= 1, 'it crossed');
  }
});

test('a fault becomes an all-way stop, and the junction recovers when it is cleared', () => {
  const sim = new Simulation({ seed: 7, mode: 'adaptive', demand: PRESETS.moderate, config: { fault_signal: 'flash' } });
  const crossings = [];
  const original = sim.afterMove.bind(sim);
  sim.afterMove = (v) => {
    const before = v.crossed;
    original(v);
    if (!before && v.crossed) crossings.push([sim.time, sim.snapshot.stage, v.approach]);
  };
  sim.run(600);
  sim.fault('link');
  sim.run(120);
  assert.equal(sim.snapshot.stage, 'fault');
  sim.clearFault();
  sim.run(600);
  const during = crossings.filter((c) => c[1] === 'fault');
  assert.ok(during.length > 10, 'vehicles still get through, one at a time');
  assert.ok(new Set(during.map((c) => c[2])).size === 4, 'every approach is served');
  const rate = during.length / 120;
  assert.ok(rate < 0.5, `an all-way stop passes fewer than a signal: ${rate} a second`);
  assert.equal(sim.stats.boxConflictSteps, 0);
  assert.notEqual(sim.snapshot.stage, 'fault');
  assert.ok(crossings.filter((c) => c[0] > 720 + 60).length > 150, 'traffic flows again after the restart');
});

test('pedestrians press the button, wait for a walk and finish crossing', () => {
  const sim = run({ seed: 8, mode: 'adaptive', demand: { ...PRESETS.moderate, pedRate: 200 } }, 3600);
  const ped = sim.summary().pedestrians;
  // 800 set out in the hour, and the ones still walking in from far down the footpath have not reached the kerb yet
  assert.ok(ped.arrived > 680 && ped.arrived < 860, `arrivals ${ped.arrived}, expected about 780`);
  assert.ok(ped.crossed >= ped.arrived - 80, 'nearly all have crossed');
  assert.ok(ped.meanWait > 5 && ped.meanWait < 60, `mean wait ${ped.meanWait}`);
  // the longest wait is a pedestrian who just misses one walk and, queued far back, one more: two cycles of 70 to 80 s
  assert.ok(ped.maxWait < 200, `longest wait ${ped.maxWait}`);
});

test('a camera that misses vehicles still gives a safe and working junction', () => {
  // One seed swings by 30 s, so the delay is the mean over four.
  const runs = [1, 2, 3, 9].map((seed) => run({ seed, mode: 'adaptive', demand: PRESETS.peak, detectionMiss: 0.3 }, 1800).summary());
  for (const blind of runs) {
    assert.equal(blind.redRuns, 0);
    assert.equal(blind.boxConflictSteps, 0);
  }
  const delay = runs.reduce((sum, blind) => sum + blind.meanDelay, 0) / runs.length;
  assert.ok(delay < 120, `delay with a poor camera ${delay}`);
});

test('describe handles empty and null values', () => {
  assert.deepEqual(describe([]), { n: 0, mean: null, sd: null, min: null, max: null });
  assert.equal(describe([1, 3, null]).mean, 2);
  assert.equal(describe([4]).sd, 0);
});

test('the comparison uses the same arrivals and adaptive beats the default fixed plan in moderate traffic', () => {
  // At peak the two plans come out about the same, because pedestrian service sets the minimum green and the camera sees only 60 m.
  const result = compare({ preset: 'moderate', seeds: [1, 2, 3], seconds: 3600, tuned: false });
  assert.equal(result.sameArrivals, true);
  const delay = result.rows.find((r) => r.key === 'meanDelay');
  assert.ok(delay.adaptive.mean < delay.fixed.mean);
  assert.ok(delay.adaptiveBetterIn >= 2, `better in ${delay.adaptiveBetterIn} of 3`);
  assert.throws(() => compare({ preset: 'nope' }), /unknown preset/);
});

test('tuning picks one of the candidate greens', () => {
  const best = tuneFixed({ preset: 'peak', seconds: 600, seeds: [101], candidates: [6, 10, 20] });
  assert.ok([6, 10, 20].includes(best.green));
  assert.ok(Number.isFinite(best.delay));
});

test('vehicles appear at the approach length, 200 m by default and as far as the page asks', () => {
  for (const [options, length] of [[{}, 200], [{ approachLength: 500 }, 500]]) {
    const sim = new Simulation({ seed: 3, demand: PRESETS.moderate, ...options });
    let farthest = 0;
    for (let i = 0; i < 600; i += 1) {
      sim.step();
      for (const lane of sim.lanes.flat()) for (const v of lane) farthest = Math.max(farthest, v.d);
    }
    assert.equal(sim.approachLength, length);
    assert.ok(farthest > length - 20 && farthest <= length, `farthest ${farthest}`);
  }
});

test('a pedestrian walks in, waits, crosses and walks out, and only disappears at the far end of the footpath', () => {
  const sim = new Simulation({ seed: 5, mode: 'adaptive', demand: { ...PRESETS.moderate, pedRate: 200 } });
  const order = ['approaching', 'waiting', 'crossing', 'leaving'];
  const backToWaiting = new Set(); // a walk can end before a queued pedestrian reaches the kerb, which sends them back to waiting once
  const last = new Map();
  let finished = 0;
  for (let i = 0; i < 30000; i += 1) {
    sim.step();
    const present = new Set();
    for (const p of sim.pedestrians) {
      present.add(p.id);
      const before = last.get(p.id);
      const goesBack = before && order.indexOf(p.state) < order.indexOf(before.state);
      if (goesBack) assert.ok(before.state === 'crossing' && p.state === 'waiting' && !(before.progress > 0), `pedestrian ${p.id} went back from ${before.state} to ${p.state}`);
      if (goesBack) backToWaiting.add(p.id);
      last.set(p.id, { state: p.state, away: p.away, speed: p.speed, progress: p.progress });
    }
    for (const [id, seen] of last) {
      if (present.has(id)) continue;
      assert.equal(seen.state, 'leaving', `pedestrian ${id} vanished while ${seen.state}`);
      assert.ok(sim.pedestrianWalk - seen.away <= seen.speed * sim.dt + 1e-9, `pedestrian ${id} vanished ${sim.pedestrianWalk - seen.away} m before the end`);
      last.delete(id); finished += 1;
    }
  }
  assert.ok(finished > 100, `only ${finished} pedestrians finished their walk`);
});

test('a fault at any moment never puts conflicting vehicles in the box, during the stop or after the restart', () => {
  for (const preset of ['moderate', 'peak']) {
    for (let seed = 1; seed <= 15; seed += 1) {
      const sim = new Simulation({ seed, mode: 'adaptive', demand: PRESETS[preset] });
      sim.run(300 + seed * 7);
      sim.fault('link');
      sim.run(120);
      sim.clearFault();
      sim.run(300);
      assert.equal(sim.stats.boxConflictSteps, 0, `${preset} seed ${seed}`);
    }
  }
});

// Lane changes
const EMPTY = { rates: [0, 0, 0, 0], pedRate: 0 };
const BUS_HOURS_CLOCK = 7 * 3600 + 30 * 60;
let nextTestId = 1;
const put = (sim, lane, props) => {
  const cls = props.cls || 'car', c = CLASSES[cls];
  const v = {
    id: nextTestId++, vid: `t-${nextTestId}`, cls, movement: 'through', approach: 1, lane, length: c.length, width: c.width, d: 200, v: c.v0,
    born: 0, emergency: false, requested: false, committed: false, released: false, crossed: false, wasStopped: false, stoppedSince: null,
    via: 0, lcAt: -Infinity, ...props,
  };
  sim.lanes[v.approach - 1][lane].push(v);
  sim.lanes[v.approach - 1][lane].sort((a, b) => a.d - b.d);
  sim.placeVehicle(v);
  return v;
};
const overtakeScene = (clock) => {
  const sim = new Simulation({ seed: 1, demand: { ...EMPTY, clockStartS: clock } });
  const slow = put(sim, 1, { cls: 'truck', d: 200, v: 5 }); // slow enough that it is still slow when the indicator has been on for 2 s
  const fast = put(sim, 1, { cls: 'car', d: 230, v: 16 });
  return { sim, slow, fast };
};

test('a car held up by a slow truck moves to the kerb lane when it is free', () => {
  const { sim, slow, fast } = overtakeScene(12 * 3600);
  sim.run(1.5);
  assert.equal(fast.pendingTo, KERB, 'the indicator is on first');
  assert.equal(fast.lane, 1, 'and it has not moved yet');
  sim.run(2);
  assert.equal(fast.lane, KERB);
  assert.equal(slow.lane, 1);
  assert.equal(sim.stats.laneChanges, 1);
  assert.deepEqual(sim.lanes[0][KERB], [fast]);
});

// The rule itself, called directly, so the scene is a standing queue and does not drive off on the first green.
const behindTurner = (gapBack, rolling = 5) => {
  const sim = new Simulation({ seed: 1, demand: { ...EMPTY, clockStartS: 12 * 3600 } });
  const turner = put(sim, KERB, { cls: 'car', movement: 'left', d: 100, v: 0 });
  const behind = put(sim, KERB, { cls: 'car', d: 100 + turner.length + gapBack, v: rolling });
  const lane = sim.lanes[0][KERB];
  return sim.heldUpByTurner(behind, lane.indexOf(behind), lane, sim.lanes[0], 1);
};

test('a car well behind a stopped left turner moves to the through lane when there is room', () => {
  assert.equal(behindTurner(5), true);
  assert.equal(behindTurner(25), true, 'beyond the old 12 m reach');
  assert.equal(behindTurner(39), true);
});

test('a car standing in the queue may go round a stopped left turner, and stays straight while it slides across', () => {
  assert.equal(behindTurner(5, 0), true);
  const sim = new Simulation({ seed: 1, demand: { ...EMPTY, clockStartS: 12 * 3600 } });
  const turner = put(sim, KERB, { cls: 'car', movement: 'left', d: 100, v: 0, lx: 8, committed: true });
  const behind = put(sim, KERB, { cls: 'car', d: 100 + turner.length + 3, v: 0, lx: 8, committed: true });
  let skew = 0, moved = false;
  for (let i = 0; i < 8 / sim.dt; i += 1) {
    sim.step();
    behind.v = 0; turner.v = 0; // the queue stays put
    if (behind.lane === 1) moved = true;
    skew = Math.max(skew, Math.abs(behind.pose.fx - behind.pose.rx)); // approach 1 runs along z, so x is across the road
  }
  assert.ok(moved, 'it moved into the through lane');
  assert.ok(skew < 0.01, `its body stayed straight: ${skew.toFixed(3)} m of skew`);
});

test('a car does not leave the kerb lane for a left turner that is far ahead', () => {
  assert.equal(behindTurner(45), false);
});

test('a vehicle that has just moved over stays the leader of the one behind it until the move is done', () => {
  const sim = new Simulation({ seed: 1, demand: { ...EMPTY, clockStartS: 12 * 3600 } });
  const mover = put(sim, 1, { cls: 'truck', d: 100, v: 0 });
  mover.lcFrom = KERB; mover.lcAt = sim.time; sim.changers.push(mover); // it has just left the kerb lane for lane 1
  const behind = put(sim, KERB, { cls: 'car', d: 115, v: 0 });
  const lane = sim.lanes[0][KERB];
  assert.equal(sim.leaderOf(behind, lane.indexOf(behind), lane), mover);
  sim.run(3); // after 2.5 s it is clear of the kerb lane
  assert.equal(sim.leaderOf(behind, lane.indexOf(behind), lane), null);
});

test('an ambulance takes the straight lane with the shorter queue, even the bus lane while it is active', () => {
  for (const [clock, busActive] of [[12 * 3600, false], [BUS_HOURS_CLOCK, true]]) {
    const sim = new Simulation({ seed: 1, demand: { ...EMPTY, clockStartS: clock } });
    for (let i = 0; i < 6; i += 1) put(sim, 1, { cls: 'car', d: 30 + i * 8, v: 0 }); // a long queue in the through lane
    put(sim, KERB, { cls: 'car', d: 30, v: 0 });
    sim.step();
    assert.equal(sim.snapshot.bus_lane_active, busActive);
    assert.equal(sim.chooseLane({ cls: 'amb', movement: 'through' }, 1), KERB, `bus lane active: ${busActive}`);
  }
  const sim = new Simulation({ seed: 1, demand: { ...EMPTY, clockStartS: 12 * 3600 } });
  for (let i = 0; i < 6; i += 1) put(sim, KERB, { cls: 'car', d: 30 + i * 8, v: 0 });
  assert.equal(sim.chooseLane({ cls: 'amb', movement: 'through' }, 1), 1);
});

test('vehicles just behind the gap ease off for an ambulance, which moves over and overtakes, and every vehicle keeps its own route', () => {
  const sim = new Simulation({ seed: 1, demand: { ...EMPTY, clockStartS: 12 * 3600 } });
  const slow = put(sim, 1, { cls: 'truck', d: 110, v: 5 }); // in the ambulance's way
  const amb = put(sim, 1, { cls: 'amb', d: 160, v: 16, emergency: true, requested: true });
  const behind = put(sim, KERB, { cls: 'car', movement: 'left', d: 172, v: 15 }); // close behind the gap in the other lane, and it means to turn left
  const route = behind.movement;
  let minGap = Infinity, yielded = false;
  for (let i = 0; i < 60 / sim.dt; i += 1) {
    sim.step();
    if (behind.yieldTo === amb) yielded = true;
    if (amb.lane === KERB && behind.lane === KERB) minGap = Math.min(minGap, behind.d - (amb.d + amb.length));
  }
  assert.ok(yielded, 'the vehicle behind was asked to ease off');
  assert.equal(amb.lane === KERB || amb.crossed, true, 'the ambulance moved over (or has already gone through)');
  assert.ok(minGap > 0, `it never touched the one behind: ${minGap}`);
  assert.equal(behind.movement, route, 'the vehicle behind kept its route');
  assert.ok(amb.d < slow.d || amb.crossed, 'the ambulance got past the truck');
});

test('traffic around an ambulance eases off, the vehicles ahead of it carry on, and nobody changes route', () => {
  const sim = new Simulation({ seed: 1, demand: { ...EMPTY, clockStartS: 12 * 3600 } });
  const amb = put(sim, 1, { cls: 'amb', d: 100, v: 16, emergency: true, requested: true });
  const level = put(sim, KERB, { cls: 'car', d: 100, v: 14 }); // level with it
  const passed = put(sim, KERB, { cls: 'car', d: 135, v: 14 }); // it has already gone past this one
  const ahead = put(sim, KERB, { cls: 'car', movement: 'left', d: 55, v: 14 }); // well ahead, and means to turn left
  const routes = [level.movement, passed.movement, ahead.movement];
  sim.run(3);
  assert.ok(level.v < 9 && passed.v < 9, `level ${level.v.toFixed(1)}, passed ${passed.v.toFixed(1)}: both ease off`);
  assert.ok(ahead.v > 11, `the one ahead carries on: ${ahead.v.toFixed(1)}`);
  assert.deepEqual([level.movement, passed.movement, ahead.movement], routes, 'every vehicle keeps its route');
  assert.ok(amb.v > 12, `the ambulance keeps its speed: ${amb.v.toFixed(1)}`);
});

test('a vehicle just ahead of the ambulance in its own lane is not slowed: it carries on and clears the way', () => {
  const sim = new Simulation({ seed: 1, demand: { ...EMPTY, clockStartS: 12 * 3600 } });
  put(sim, 1, { cls: 'amb', d: 60, v: 15, emergency: true, requested: true });
  const ahead = put(sim, 1, { cls: 'car', d: 50, v: 13 }); // 10 m ahead in the same lane
  const beside = put(sim, KERB, { cls: 'car', d: 60, v: 13 }); // beside it in the next lane
  sim.run(3);
  assert.ok(ahead.v > 12, `the one ahead keeps going: ${ahead.v.toFixed(1)}`);
  assert.ok(beside.v < 9, `the one beside it eases off: ${beside.v.toFixed(1)}`);
});

test('when the ambulance is at the line, every vehicle waiting to enter eases off, on every approach', () => {
  const sim = new Simulation({ seed: 1, demand: { ...EMPTY, clockStartS: 12 * 3600 } });
  put(sim, 1, { cls: 'amb', d: 20, v: 8, emergency: true, requested: true });
  const other = put(sim, 1, { approach: 2, cls: 'car', d: 40, v: 13 });
  const far = put(sim, 1, { approach: 3, cls: 'car', d: 160, v: 13 });
  sim.run(3);
  assert.ok(other.v < 9, `a vehicle about to enter eases off: ${other.v.toFixed(1)}`);
  assert.ok(far.v > 12, `one far away does not: ${far.v.toFixed(1)}`);
});

test('an ambulance that cannot reach its turn lane takes the route of its lane early enough to stop for what that route meets', () => {
  const sim = new Simulation({ seed: 1, demand: { ...EMPTY, clockStartS: 12 * 3600 } });
  // The signals start on the through phase of approaches 1 and 3. Approach 4's left turner is finishing its turn in the junction.
  const turner = put(sim, KERB, { approach: 4, cls: 'car', movement: 'left', d: -6, v: 3 });
  const amb = put(sim, 1, { approach: 3, cls: 'amb', movement: 'left', d: 40, v: 14, emergency: true, requested: true }); // too close to join the kerb lane now
  sim.changeAmbulanceLanes(sim.lanes[2]);
  assert.equal(amb.movement, 'through', 'at speed 40 m out it is already time: it takes the route of the through lane it is in');
  sim.run(8);
  assert.equal(sim.stats.boxConflictSteps, 0, 'and was not in the junction with the turner at the same time');
  assert.ok(turner.crossed || turner.d < -10, 'the turner got out of its way');
});

test('nobody moves into the bus lane while it is active', () => {
  const { sim, fast } = overtakeScene(BUS_HOURS_CLOCK);
  sim.run(3);
  assert.equal(sim.snapshot.bus_lane_active, true);
  assert.equal(fast.lane, 1);
  assert.equal(sim.stats.laneChanges, 0);
});

test('a car does not move over into a gap that is too small', () => {
  const { sim, fast } = overtakeScene(12 * 3600);
  put(sim, KERB, { cls: 'car', d: 214, v: 12 }); // alongside, and slow
  sim.run(3);
  assert.equal(fast.lane, 1);
  const beside = overtakeScene(12 * 3600);
  put(beside.sim, KERB, { cls: 'car', d: 230, v: 16.7 }); // close behind the gap, and fast
  beside.sim.run(3);
  assert.equal(beside.fast.lane, 1);
});

test('a standing queue is not overtaken, and neither is a vehicle still on a side street', () => {
  const queue = new Simulation({ seed: 1, demand: EMPTY });
  put(queue, 1, { cls: 'car', d: 100, v: 0 });
  const waiting = put(queue, 1, { cls: 'car', d: 108, v: 8 });
  queue.run(0.5); // one look at the situation, while the car ahead has not yet pulled away
  assert.equal(waiting.lane, 1, 'the leader is stopped, so there is nothing to pass');
  const near = new Simulation({ seed: 1, demand: EMPTY });
  put(near, 1, { cls: 'truck', d: 300, v: 5 });
  const free = put(near, 1, { cls: 'car', d: 330, v: 16 });
  near.run(5);
  assert.equal(free.lane, KERB, 'the same scene on the main road does change lane');
  const far = new Simulation({ seed: 1, demand: EMPTY });
  put(far, 1, { cls: 'truck', d: 300, v: 5 });
  const routed = put(far, 1, { cls: 'car', d: 330, v: 16, via: 2 }); // the turn from side street 2 ends at about 217 m
  far.run(5);
  assert.equal(routed.lane, 1, 'it is still on the side street, so it stays put');
});

test('lane changes keep every lane in order with no overlaps, and never enter an active bus lane', () => {
  let total = 0;
  for (const preset of ['moderate', 'peak', 'bus_hours']) {
    const sim = new Simulation({ seed: 6, mode: 'adaptive', demand: PRESETS[preset] });
    for (let i = 0; i < 14000; i += 1) {
      sim.step();
      for (const lanes of sim.lanes) {
        for (const lane of lanes) {
          for (let j = 1; j < lane.length; j += 1) {
            if (lane[j - 1].d <= -8) continue; // past the junction vehicles go different ways, so the order means nothing
            assert.ok(lane[j].d >= lane[j - 1].d, `${preset}: lane out of order at ${sim.time}`);
            assert.ok(lane[j].d >= lane[j - 1].d + lane[j - 1].length - 0.01, `${preset}: overlap at ${sim.time}`);
          }
        }
        if (sim.snapshot.bus_lane_active) {
          for (const v of lanes[KERB]) assert.ok(v.lcAt !== sim.time || v.cls === 'bike', `${preset}: a ${v.cls} moved into the bus lane at ${sim.time}`);
        }
      }
    }
    total += sim.stats.laneChanges;
    assert.equal(sim.stats.redRuns, 0, preset);
    assert.equal(sim.stats.boxConflictSteps, 0, preset);
  }
  assert.ok(total > 40, `only ${total} lane changes, so this checked very little`);
});
