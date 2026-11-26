// The car park off a side street (src/scene/carpark-layout.js): the paths into and out of every bay are smooth, stay in the car park, and never touch a parked car.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CAR, LOT, arrivalPath, bays, depth, departurePath, footprint, halfWidth, overlap, speedProfile } from '../src/scene/carpark-layout.js';

const all = bays();

test('twenty bays, ten on each side, square to the aisle, each wide enough for a car with a gap either side', () => {
  assert.equal(all.length, 20);
  assert.equal(all.filter((b) => b.side > 0).length, 10);
  for (const b of all) { assert.ok(Math.abs(Math.abs(b.a) - (LOT.aisle / 2 + LOT.bayD / 2)) < 1e-9); assert.ok(b.t > LOT.entryT && b.t < depth() - LOT.turnEnd + 0.01); }
  assert.ok(LOT.bayW - CAR.width >= 0.7, 'a person can pass between two parked cars');
});

// Sample a path every 0.1 m.
const samples = (path) => { const out = []; for (let s = 0; s <= path.length + 1e-9; s += 0.1) out.push(path.at(s)); return out; };

test('every path is continuous, and its heading changes smoothly (no kinks)', () => {
  for (const bay of all) for (const path of [arrivalPath(bay, 80), departurePath(bay, 100)]) {
    const list = samples(path);
    for (let i = 1; i < list.length; i += 1) {
      assert.ok(Math.hypot(list[i].a - list[i - 1].a, list[i].t - list[i - 1].t) < 0.11, `a jump in bay ${bay.id} at ${i * 0.1}`);
      let turn = list[i].heading - list[i - 1].heading; turn -= Math.round(turn / (2 * Math.PI)) * 2 * Math.PI; // the nose: it does not jump when the car changes gear
      assert.ok(Math.abs(turn) < 0.1, `a kink of ${turn.toFixed(3)} rad in bay ${bay.id} at ${(i * 0.1).toFixed(1)} m`); // 0.1 m of path on a 3 m radius is 0.033 rad
    }
  }
});

test('an arriving car ends in its bay, nose out, and a departing car starts there and ends heading away in the near lane', () => {
  for (const bay of all) {
    const arrive = arrivalPath(bay, 80), end = arrive.at(arrive.length), leave = departurePath(bay, 100), start = leave.at(0), last = leave.at(leave.length);
    assert.ok(Math.hypot(end.a - bay.a, end.t - bay.t) < 1e-6 && Math.abs(Math.cos(end.heading - bay.heading) - 1) < 1e-9, `arrival in bay ${bay.id}`);
    assert.ok(Math.hypot(start.a - bay.a, start.t - bay.t) < 1e-6 && Math.abs(Math.cos(start.heading - bay.heading) - 1) < 1e-9, `departure from bay ${bay.id}`);
    assert.ok(Math.abs(last.t - LOT.laneNear) < 1e-6 && Math.abs(Math.cos(last.heading) - 1) < 1e-9 && last.a > 50, 'leaves in the near lane, heading +a');
    const first = arrive.at(0);
    assert.ok(Math.abs(first.t - LOT.laneFar) < 1e-9 && Math.abs(Math.cos(first.heading + 1)) > 0 && Math.abs(Math.sin(first.heading)) < 1e-9, 'comes in along the far lane, heading -a');
  }
});

test('while backing out the car is in reverse and its nose points opposite to the way it moves; all else is forward', () => {
  for (const bay of all) {
    const list = samples(departurePath(bay, 100));
    const reverse = list.filter((p) => p.reverse);
    assert.ok(reverse.length > 40, 'backs out');
    for (const p of list) assert.equal(p.reverse, p.tag !== 'street' && p.segment <= 1);
  }
});

test('no part of any path takes a car outside the car park or its apron, or through a parked car in another bay', () => {
  const limitA = halfWidth() + 0.1;
  for (const bay of all) {
    const others = all.filter((b) => b.id !== bay.id).map((b) => footprint(b.a, b.t, b.heading));
    for (const path of [arrivalPath(bay, 80), departurePath(bay, 100)]) {
      let worst = -Infinity;
      for (const p of samples(path)) {
        const car = footprint(p.a, p.t, p.heading);
        if (p.t > 0.5) { // inside the car park: between the ends of the bays and not past the end
          assert.ok(Math.abs(p.a) <= limitA + 1e-9 && p.t < depth(), `outside at ${p.a.toFixed(1)}, ${p.t.toFixed(1)} in bay ${bay.id}`);
          for (const other of others) worst = Math.max(worst, overlap(car, other));
        }
      }
      assert.ok(worst < -0.05, `bay ${bay.id}: a car comes within ${(-worst).toFixed(2)} m of a parked car`); // 5 cm clear at least
    }
  }
});

test('the speed along a path starts at the speed given, never exceeds its limits, and slows to a stop at the end of an arrival', () => {
  const bay = all[7], path = arrivalPath(bay, 120), speed = speedProfile(path, { v0: 12, vEnd: 0 });
  assert.ok(Math.abs(speed(0) - 12) < 1e-6);
  assert.ok(speed(path.length) < 0.05);
  const limit = { street: 14, cross: 4.5, aisle: 4, bay: 2 };
  for (let s = 0; s <= path.length; s += 0.5) {
    const tags = [path.at(Math.max(0, s - 0.3)).tag, path.at(s).tag, path.at(Math.min(path.length, s + 0.3)).tag]; // the speed is worked out every 0.25 m, so at a change of segment it is between the two limits
    assert.ok(speed(s) <= Math.max(...tags.map((t) => limit[t])) + 1e-6 || s < 1, `too fast in the ${tags[1]} at ${s}`);
  }
  for (let s = 1; s < path.length; s += 0.25) assert.ok(Math.abs(speed(s) ** 2 - speed(s - 0.25) ** 2) / (2 * 0.25) <= 3.6, 'slows much harder than 3 m/s2'); // the speed squared falls by 2 a ds (a little over at the 0.25 m steps, where the speed is joined by straight lines)
});
