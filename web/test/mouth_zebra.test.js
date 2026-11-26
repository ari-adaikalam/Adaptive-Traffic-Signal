// The zebra crossing where a side street meets a main road: where it is, and the rule that a vehicle coming out of the street or turning into it gives way to people on it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/traffic.js';
import { CLASSES, KERB, SIDE_STREET_COUNT, joinDistance } from '../src/sim/world.js';
import { MOUTH_STOP, exitTurnProgress, exitZebraStart, joinerZebraStart, mouthZebras, onMouthZebra, pedestrianPose, vehiclePose } from '../src/sim/tracks.js';

const EMPTY = { rates: [0, 0, 0, 0], pedRate: 0, clockStartS: 12 * 3600 };

test('there is a zebra at every side street mouth, and a person walking along any footpath crosses exactly one at each', () => {
  const zebras = mouthZebras();
  assert.equal(zebras.length, 4 * 2 * SIDE_STREET_COUNT);
  for (let crossing = 1; crossing <= 4; crossing += 1) for (const dir of [1, -1]) for (let id = 0; id < 4; id += 1) for (let n = 1; n <= SIDE_STREET_COUNT; n += 1) {
    const ped = { id, crossing, dir, state: 'leaving', toKerb: 0, progress: 0, away: n * 120 - 14 }, at = pedestrianPose(ped);
    assert.equal(zebras.filter((z) => onMouthZebra(z, at.x, at.z)).length, 1, `crossing ${crossing} dir ${dir} id ${id} street ${n}`);
  }
  assert.equal(zebras.filter((z) => onMouthZebra(z, 0, 0)).length, 0, 'none in the middle of the junction');
});

// A person standing still on a zebra, on the footpath line of a crossing.
const stand = (sim, crossing, dir, along) => {
  const ped = { id: 8001, crossing, dir, state: 'leaving', born: 0, toKerb: 0, speed: 0, progress: 0, away: along, px: 0, pz: 0, stall: 0 };
  ped.pose = pedestrianPose(ped); ped.px = ped.pose.x; ped.pz = ped.pose.z;
  sim.pedestrians.push(ped);
  return ped;
};
const car = (sim, props) => {
  const c = CLASSES.car, v = { id: 9001, vid: 't', cls: 'car', movement: 'through', approach: 1, lane: KERB, length: c.length, width: c.width, d: 0, v: 8, born: 0, emergency: false,
    requested: false, committed: false, released: false, crossed: false, wasStopped: false, stoppedSince: null, via: 0, lcAt: -Infinity, lx: 8, pendingTo: null, pendingSince: 0,
    signalSide: null, signalUntil: -Infinity, held: 0, stall: 0, inside: false, enteredAt: Infinity, exitVia: 0, pose: null, ...props };
  sim.lanes[v.approach - 1][v.lane].push(v);
  sim.placeVehicle(v);
  return v;
};

test('a vehicle coming out of a side street stops short of the zebra while someone is on it, and goes when they are gone', () => {
  const sim = new Simulation({ seed: 1, pedestrianWalk: 560, demand: EMPTY });
  const via = 2, join = joinDistance(via), start = joinerZebraStart(8);
  const v = car(sim, { via, d: join + start + 30 });
  const ped = stand(sim, 2, -1, 226); // on the zebra of street 2, on the kerb side of approach 1
  sim.run(20);
  assert.ok(v.v < 0.05, `it is standing (${v.v.toFixed(2)} m/s)`);
  const gap = v.d - join - start;
  assert.ok(gap > 0 && gap < MOUTH_STOP + 3, `it is ${gap.toFixed(2)} m short of the stripes`);
  sim.pedestrians.splice(sim.pedestrians.indexOf(ped), 1);
  sim.run(10);
  assert.ok(v.d - join - start < 0, 'it went over the stripes once they were clear');
});

test('a vehicle that has reached the stripes carries on, and one far away is not held', () => {
  const sim = new Simulation({ seed: 1, pedestrianWalk: 560, demand: EMPTY });
  const via = 2, join = joinDistance(via), start = joinerZebraStart(8);
  const on = car(sim, { via, d: join + start - 0.5 });
  stand(sim, 2, -1, 226);
  sim.run(3);
  assert.ok(on.d < join + start - 2, 'it was already on the stripes, so it kept going');
  const other = new Simulation({ seed: 1, pedestrianWalk: 560, demand: EMPTY });
  const far = car(other, { via: 3, d: joinDistance(3) + start + 30 });
  stand(other, 2, -1, 226); // someone on the zebra of street 2 means nothing to a vehicle for street 3
  other.run(6);
  assert.ok(far.v > 3, 'it is not held');
});

test('a vehicle turning into a side street stops short of the zebra while someone is on it, and goes when they are gone', () => {
  const sim = new Simulation({ seed: 1, exitRun: 700, pedestrianWalk: 560, demand: EMPTY });
  const via = 2, start = exitZebraStart(8);
  const v = car(sim, { exitVia: via, d: -14.4 - (via * 120 - 9) + 40 });
  const ped = stand(sim, 2, 1, 226); // the zebra of street 2 on the way out of approach 1, on its kerb side
  sim.run(20);
  assert.ok(v.v < 0.05, `it is standing (${v.v.toFixed(2)} m/s)`);
  const gap = start - exitTurnProgress(v);
  assert.ok(gap > 0 && gap < MOUTH_STOP + 3, `it is ${gap.toFixed(2)} m short of the stripes`);
  sim.pedestrians.splice(sim.pedestrians.indexOf(ped), 1);
  sim.run(10);
  assert.ok(exitTurnProgress(v) > start, 'it went over the stripes once they were clear');
});

test('a stopped vehicle never overlaps the person it is waiting for', () => {
  const sim = new Simulation({ seed: 1, pedestrianWalk: 560, demand: EMPTY });
  const v = car(sim, { via: 2, d: joinDistance(2) + joinerZebraStart(8) + 30 });
  const ped = stand(sim, 2, -1, 226);
  sim.run(20);
  const pose = vehiclePose(v);
  assert.ok(Math.hypot(pose.x - ped.px, pose.z - ped.pz) > 1.5, 'clear of them');
});
