// The feed between the detector and the controller (src/detection/feed.js), and the controller with counts that come from it: a late, dead, wrong or returning detector, and an emergency vehicle through all of it
import test from 'node:test';
import assert from 'node:assert/strict';
import { DetectionFeed } from '../src/detection/feed.js';
import { PRESETS, Simulation } from '../src/sim/traffic.js';

const lane = (cars = 0, trucks = 0, buses = 0, bikes = 0) => ({ cars, trucks, buses, bikes });
const result = (kerb = lane(), middle = lane(), right = lane()) => ({ lanes: [kerb, middle, right] });
const roads = [[0, 1], [2, 3], [4, 5], [6, 7]]; // two cameras to a road

test('a road is counted from both its cameras, in groups: the kerb lane is general traffic, or the bus lane when it is open', () => {
  const feed = new DetectionFeed(roads);
  feed.submit(0, 10, result(lane(2), lane(1, 1), lane(0, 0, 0, 1))); feed.submit(1, 10, result(lane(1, 0, 1), lane(3), lane(1)));
  const a = feed.countsFor(1, 11, false);
  assert.deepEqual(a.general, { cars: 2 + 1 + 1 + 3, trucks: 1, buses: 1, bikes: 0 });
  assert.deepEqual(a.right, { cars: 1, trucks: 0, buses: 0, bikes: 1 });
  assert.deepEqual(a.bus, { cars: 0, trucks: 0, buses: 0, bikes: 0 });
  const b = feed.countsFor(1, 11, true);
  assert.deepEqual(b.bus, { cars: 3, trucks: 0, buses: 1, bikes: 0 }, 'the kerb lane is the bus lane');
  assert.deepEqual(b.general, { cars: 1 + 3, trucks: 1, buses: 0, bikes: 0 });
});

test('a road with one camera missing or late is unknown, not smaller, and the other roads are not affected', () => {
  const feed = new DetectionFeed(roads);
  for (const c of [0, 1, 2, 3]) feed.submit(c, 10, result(lane(1)));
  assert.ok(feed.countsFor(1, 11)); assert.ok(feed.countsFor(2, 11));
  assert.equal(feed.countsFor(3, 11), null, 'cameras 4 and 5 never reported');
  feed.submit(2, 14, result(lane(1))); // camera 2 reports again, camera 3 does not
  assert.equal(feed.countsFor(2, 14), null, 'camera 3 is 4 s old, and the limit is 3');
  assert.ok(feed.countsFor(1, 12), 'another road is not affected');
  assert.equal(feed.status(11), 'partial'); assert.equal(new DetectionFeed(roads).status(0), 'off');
});

test('a result that is malformed, or could not be true, is not used, and the last good one carries on until it is too old', () => {
  const feed = new DetectionFeed(roads);
  assert.ok(feed.submit(0, 1, result(lane(3))));
  for (const bad of [null, {}, { lanes: [] }, { lanes: [lane(), lane(), { cars: -1, trucks: 0, buses: 0, bikes: 0 }] }, { lanes: [lane(), lane(), { cars: 1.5, trucks: 0, buses: 0, bikes: 0 }] }, { lanes: [lane(), lane(), { cars: NaN, trucks: 0, buses: 0, bikes: 0 }] }]) assert.equal(feed.submit(0, 2, bad), false);
  assert.equal(feed.submit(0, 2, result(lane(40))), false, 'more vehicles than the stretch can hold');
  assert.equal(feed.submit(0, 2, result(lane(20))), false, 'from 3 to 20 in one second');
  assert.equal(feed.stats.malformed, 6); assert.equal(feed.stats.rejected, 2);
  feed.submit(1, 2, result()); assert.equal(feed.countsFor(1, 3).general.cars, 3, 'the last good result is still the count');
  assert.equal(feed.countsFor(1, 5), null, 'and it goes when it is too old');
  assert.ok(feed.submit(0, 3, result(lane(3))));
  assert.equal(feed.submit(0, 2.5, result(lane(3))), false, 'a result from the past is not new');
});

test('after an outage the first result is taken as it is, because the road may really have changed', () => {
  const feed = new DetectionFeed(roads);
  feed.submit(0, 1, result(lane(2))); feed.submit(1, 1, result(lane(0)));
  assert.equal(feed.submit(0, 2, result(lane(18))), false, 'a jump of 16 at once is refused');
  assert.ok(feed.submit(0, 30, result(lane(18))), 'but 30 s later, after nothing, it is a new picture of the road');
});

// ----- the controller, with counts from the feed -----
// A detector that is perfect, as the simulation's own vehicles can make it, and that can be made late, dead or wrong.
function junction({ seed = 3, preset = 'moderate', mode = 'adaptive', outage = null } = {}) {
  const feed = new DetectionFeed(roads); let sim = null;
  const counts = (a, t) => {
    if (outage && t >= outage[0] && t < outage[1]) return null; // the detector is dead
    return sim.truth[a - 1];
  };
  sim = new Simulation({ seed, mode, demand: PRESETS[preset], countSource: counts });
  return { sim, feed };
}

test('with no detector at all the controller never skips a phase on a count it does not have, serves every road, and has no conflict', () => {
  const sim = new Simulation({ seed: 5, mode: 'adaptive', demand: PRESETS.moderate, countSource: () => null }), greens = new Set();
  for (let i = 0; i < 6000; i += 1) { sim.step(); for (let a = 1; a <= 4; a += 1) if (sim.snapshot.signals[`T${a}`] === 'green') greens.add(a); }
  assert.equal(greens.size, 4, 'every road got a green');
  const s = sim.summary(); assert.equal(s.boxConflictSteps, 0); assert.equal(s.redRuns, 0);
  assert.ok(s.crossed > 50, 'vehicles got through');
});

test('a detector that dies and comes back: the controller goes to default greens, then uses the counts again, with no conflict and no phase skipped meanwhile', () => {
  const { sim } = junction({ seed: 7, outage: [120, 240] });
  const fresh = []; let greensDuring = new Set();
  for (let i = 0; i < 4200; i += 1) {
    sim.step();
    if (i % 10 === 0) fresh.push([sim.time, sim.controller.fresh('T', 1) !== null]);
    if (sim.time > 135 && sim.time < 240) for (let a = 1; a <= 4; a += 1) if (sim.snapshot.signals[`T${a}`] === 'green') greensDuring.add(a);
  }
  const at = (t) => fresh.find(([x]) => x >= t)[1];
  assert.ok(at(100), 'before the outage the controller has counts'); assert.equal(at(150), false, 'and 10 s into it it has none'); assert.ok(at(260), 'and after it has them again');
  assert.equal(greensDuring.size, 4, 'every road was still served during the outage');
  assert.equal(sim.summary().boxConflictSteps, 0);
});

test('an emergency vehicle is served through a detector outage and its return, and a second one after it, and no request is left behind', () => {
  const { sim } = junction({ seed: 9, outage: [100, 200] });
  const crossed = (kind) => sim.summary().emergency.crossed;
  for (let i = 0; i < 600; i += 1) sim.step();
  sim.dispatchEmergency(1, 'through', 'amb'); // first: while the detector is still working
  for (let i = 0; i < 1000; i += 1) sim.step(); // to 160 s: the detector died at 100
  sim.dispatchEmergency(3, 'through', 'fire'); // second: during the outage
  for (let i = 0; i < 1500; i += 1) sim.step(); // to 310 s: the detector is back from 200
  sim.dispatchEmergency(2, 'left', 'police'); // third: after it is back
  for (let i = 0; i < 1500; i += 1) sim.step();
  assert.ok(crossed() >= 3, `all three crossed (${crossed()})`);
  assert.equal(sim.snapshot.emergency_approach, null, 'and nothing is still waiting');
  assert.equal(sim.summary().boxConflictSteps, 0);
});

test('with perfect counts from the feed the controller does as it does with the simulator\'s own counts, give or take the camera model', () => {
  const a = new Simulation({ seed: 11, mode: 'adaptive', demand: PRESETS.moderate, countSource: null }), b = junction({ seed: 11 }).sim;
  a.run(900); b.run(900);
  const da = a.summary().meanDelay, db = b.summary().meanDelay;
  assert.ok(Math.abs(da - db) / da < 0.25, `${da.toFixed(1)} s with the camera model, ${db.toFixed(1)} s with perfect counts`);
});


test('two cameras that both counted the same vehicle on the line between them are one vehicle, and two that are not the same stay two', () => {
  const feed = new DetectionFeed(roads, { boundaries: [[40], [40], [40], [40]] });
  const v = (cls, d, lateral) => ({ cls, d, lateral });
  // one vehicle in the middle lane near 40 m, seen from both: near camera says 39.6, far camera says 40.7
  feed.submit(0, 5, { lanes: [lane(), lane(1), lane()], vehicles: [v(0, 39.6, 5)] }); feed.submit(1, 5, { lanes: [lane(), lane(1), lane()], vehicles: [v(0, 40.7, 5.2)] });
  assert.equal(feed.countsFor(1, 6).general.cars, 1, 'counted by both, reported once');
  // two vehicles of one lane, 6 m apart, each seen by one camera: both stay
  feed.submit(0, 6, { lanes: [lane(), lane(1), lane()], vehicles: [v(0, 39, 5)] }); feed.submit(1, 6, { lanes: [lane(), lane(1), lane()], vehicles: [v(0, 45.5, 5)] });
  assert.equal(feed.countsFor(1, 7).general.cars, 2);
  // another class, another lane, or too far from the line is not the same vehicle
  feed.submit(0, 7, { lanes: [lane(), lane(1), lane()], vehicles: [v(0, 39.8, 5)] }); feed.submit(1, 7, { lanes: [lane(), lane(0, 1), lane()], vehicles: [v(1, 40.2, 5)] });
  assert.deepEqual([feed.countsFor(1, 8).general.cars, feed.countsFor(1, 8).general.trucks], [1, 1]);
  feed.submit(0, 8, { lanes: [lane(), lane(1), lane()], vehicles: [v(0, 38, 5)] }); feed.submit(1, 8, { lanes: [lane(), lane(1), lane()], vehicles: [v(0, 41.8, 5)] });
  assert.equal(feed.countsFor(1, 9).general.cars, 2, 'nearly 4 m apart');
  assert.equal(feed.submit(0, 9, { lanes: [lane(), lane(), lane()], vehicles: [{ cls: 9, d: 1, lateral: 1 }] }), false, 'a vehicle that is not one is refused');
  assert.equal(new DetectionFeed(roads).submit(0, 1, { lanes: [lane(), lane(), lane()], vehicles: [{ cls: 0, d: 5, lateral: 2 }] }), true, 'without boundaries nothing is merged, and the list is allowed');
});
