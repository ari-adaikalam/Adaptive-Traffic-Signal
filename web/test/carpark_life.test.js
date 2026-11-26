// The comings and goings of a car park (src/scene/carpark-life.js): how full it is by the hour, that only one thing happens in it at a time, that nothing touches anything, and that nothing gets stuck.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LOT, depth, footprint, overlap } from '../src/scene/carpark-layout.js';
import { createCarPark, officeTarget, restaurantTarget } from '../src/scene/carpark-life.js';

const seeded = (seed) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
function fake() {
  const adapter = { cars: new Set(), walkers: new Set(), makeCar: (id) => ({ id, pose: null }), makeWalker: (id) => ({ id, pose: null }), addCar(o) { this.cars.add(o); }, removeCar(o) { this.cars.delete(o); }, addWalker(o) { this.walkers.add(o); }, removeWalker(o) { this.walkers.delete(o); }, poseCar(o, p) { o.pose = p; }, poseWalker(o, p) { o.pose = p; } };
  return adapter;
}

test('how full: an office fills in the morning, empties in the evening and keeps one or two cars at night; a restaurant fills at lunch and in the evening', () => {
  assert.ok(officeTarget(3, false) * 20 <= 2.01 && officeTarget(3, false) * 20 >= 1.99, 'two cars at night');
  assert.ok(officeTarget(8, false) > 0.15 && officeTarget(8, false) < 1);
  assert.equal(officeTarget(11, false), 1); assert.equal(officeTarget(15, false), 1);
  assert.ok(officeTarget(18, false) < 1 && officeTarget(18, false) > 0.1); assert.equal(officeTarget(22, false), 0.1);
  assert.ok(officeTarget(12, true) <= 0.2, 'a weekend');
  assert.ok(restaurantTarget(12.5, false) >= 0.9 && restaurantTarget(19, false) >= 0.9 && restaurantTarget(3, false) <= 0.1 && restaurantTarget(15, false) < restaurantTarget(12.5, false));
  for (let h = 0; h < 24; h += 0.25) for (const w of [false, true]) for (const f of [officeTarget, restaurantTarget]) { const v = f(h, w); assert.ok(v >= 0 && v <= 1); }
});

// Runs a car park for `hours` from `from`, with simulated vehicles passing in the near lane now and then, watching every step.
function run({ kind, seed, from, hours, dt = 0.1, traffic = true, watch = () => {} }) {
  const rnd = seeded(seed), adapter = fake(), life = createCarPark({ kind, rnd, adapter, hour: from, weekend: false });
  const street = []; let nextSim = 20 + rnd() * 60, busyFor = 0, longest = 0, lastBusy = null;
  const parkedBoxes = () => life.bays.filter((b) => b.car).map((b) => ({ b, box: footprint(b.a, b.t, b.heading) })); // the cars standing in bays
  for (let step = 0, time = 0; time < hours * 3600; step += 1, time += dt) {
    if (traffic) { // a simulated vehicle every 40 s on average, going by in the near lane at 15 m/s
      nextSim -= dt; if (nextSim <= 0) { street.push({ a: -250, v: 15 }); nextSim = 10 + rnd() * 70; }
      for (const s of street) s.a += s.v * dt; while (street.length && street[0].a > 300) street.shift();
    }
    life.update(dt, { hour: (from + time / 3600) % 24, weekend: false, street });
    if (life.busy !== lastBusy) { lastBusy = life.busy; busyFor = 0; } // one hold of the car park, from one car's turn in or out to the end of it
    busyFor = life.busy ? busyFor + dt : 0; longest = Math.max(longest, busyFor);
    watch({ life, adapter, street, time, parkedBoxes });
  }
  return { life, adapter, longest };
}

test('one thing at a time: while a person is walking nothing moves in the car park, and a car never overlaps a parked one or a person', () => {
  let walkingWithCar = 0, worstCar = -Infinity, nearPerson = Infinity, steps = 0;
  run({ kind: 'restaurant', seed: 4, from: 11, hours: 5, watch: ({ life, parkedBoxes }) => {
    steps += 1;
    const inLot = [...life.cars].filter((c) => c.t > -3);
    if (life.walkers.size && inLot.length) walkingWithCar += 1;
    if (steps % 5) return;
    const parked = parkedBoxes();
    for (const c of life.cars) { if (!c.obj.pose || c.t < 0.5) continue; const box = footprint(c.a, c.t, c.obj.pose.heading); for (const { b, box: other } of parked) if (!b.car || b.car.obj !== c.obj) worstCar = Math.max(worstCar, overlap(box, other)); }
    for (const w of life.walkers) for (const { b, box } of parked) { if (w.bay === b) continue; const d = overlap(footprint(w.a, w.t, 0, -1.6), box); nearPerson = Math.min(nearPerson, -d); }
  } });
  assert.equal(walkingWithCar, 0, 'a car moved in the car park while someone was walking');
  assert.ok(worstCar < -0.03, `a car came within ${(-worstCar).toFixed(2)} m of a parked car`);
  assert.ok(nearPerson > 0.1, `someone walked within ${nearPerson.toFixed(2)} m of a parked car`);
});

test('a car crosses the near lane only when no simulated vehicle is close, and a car leaving goes out only when none is', () => {
  let nearest = Infinity, checked = 0;
  run({ kind: 'office', seed: 6, from: 6.5, hours: 4, watch: ({ life, street }) => {
    const crossing = [];
    if (life.incoming && life.incoming.phase === 'go' && life.incoming.car.t > LOT.laneFar + 1 && life.incoming.car.t < -1.5) crossing.push(life.incoming.car); // a car turning in, across the near lane
    for (const o of life.outgoing) if (o.phase === 'lot' && o.car.t < -1.5) crossing.push(o.car); // a car turning out
    for (const c of crossing) { checked += 1; for (const s of street) nearest = Math.min(nearest, Math.abs(s.a - c.a)); }
  } });
  assert.ok(checked > 20, `${checked} samples of a car across the lane`);
  assert.ok(nearest > 12, `a simulated vehicle was ${nearest.toFixed(1)} m from a car crossing the lane`);
});

test('an office fills in the morning and empties in the evening, and has one or two cars at night', () => {
  const counts = {};
  const { life } = run({ kind: 'office', seed: 8, from: 2, hours: 24, dt: 0.2, watch: ({ life, time }) => { const h = Math.floor(time / 3600 + 2) % 24; if (time % 600 < 0.2) counts[h] = life.parked; } });
  assert.ok(counts[3] <= 4, `${counts[3]} cars at 3 am`); assert.ok(counts[11] >= 17, `${counts[11]} cars at 11`); assert.ok(counts[14] >= 17, `${counts[14]} at 14`);
  assert.ok(counts[21] <= 4, `${counts[21]} at 21`); assert.ok(life.stats.arrived >= 15 && life.stats.left >= 15, `${life.stats.arrived} arrived, ${life.stats.left} left`);
});

test('a restaurant has more cars at lunch than in the afternoon, and cars keep coming and going', () => {
  const counts = {};
  const { life } = run({ kind: 'restaurant', seed: 9, from: 9, hours: 12, dt: 0.2, watch: ({ life, time }) => { const h = Math.floor(time / 3600 + 9); if (time % 600 < 0.2) counts[h] = Math.max(counts[h] || 0, life.parked); } });
  assert.ok(counts[12] >= 12, `${counts[12]} at 12`); assert.ok(counts[12] > counts[16] - 1, 'more at lunch than at 4 pm'); assert.ok(life.stats.arrived >= 30, `${life.stats.arrived} arrived`);
});

test('nothing gets stuck: the car park is never taken for long, and every car and person made is removed at the end of its trip', () => {
  for (const kind of ['office', 'restaurant']) {
    const { life, adapter, longest } = run({ kind, seed: 12, from: 6, hours: 14, dt: 0.2 });
    assert.ok(longest < 140, `${kind}: one car's turn took ${longest.toFixed(0)} s`);
    const parkedCars = life.bays.filter((b) => b.car).length;
    assert.ok(adapter.cars.size <= parkedCars + life.cars.size, `${kind}: ${adapter.cars.size} cars made, ${parkedCars} parked, ${life.cars.size} moving`);
    assert.ok(adapter.walkers.size <= 1, `${kind}: ${adapter.walkers.size} people`);
  }
});

test('a long stop of the page (a very long step) does not break it', () => {
  const rnd = seeded(2), adapter = fake(), life = createCarPark({ kind: 'restaurant', rnd, adapter, hour: 12 });
  for (let i = 0; i < 400; i += 1) life.update(i % 40 === 39 ? 30 : 0.1, { hour: 12, weekend: false, street: [] });
  for (const c of life.cars) assert.ok(Number.isFinite(c.a + c.t));
});
