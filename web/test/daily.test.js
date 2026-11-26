import test from 'node:test';
import assert from 'node:assert/strict';
import { WEEK, isNight, mixAt, parkFactor, pedestrianFactor, studentShare, vehicleFactor, vehicleKind } from '../src/sim/daily.js';

const at = (day, hour, minute = 0) => day * 86400 + hour * 3600 + minute * 60; // day 0 is Monday

test('nobody is about at night, and the working day has its peaks', () => {
  assert.ok(pedestrianFactor(at(0, 3)) <= 0.02, 'a handful at 3 am at most');
  assert.equal(parkFactor(at(0, 3)), 0, 'the park is empty at 3 am');
  assert.equal(pedestrianFactor(at(0, 8)), 1);
  assert.equal(vehicleFactor(at(0, 8)), 1);
  assert.equal(vehicleFactor(at(0, 17)), 1);
  assert.ok(vehicleFactor(at(0, 3)) < 0.05);
  assert.ok(vehicleFactor(at(0, 12)) < vehicleFactor(at(0, 8)), 'a lull at midday');
});

test('a weekend differs from a weekday: later and flatter for traffic, busier for the park', () => {
  assert.ok(vehicleFactor(at(5, 8)) < 0.4 * vehicleFactor(at(0, 8)));
  assert.ok(parkFactor(at(5, 11)) > parkFactor(at(0, 11)));
  assert.equal(parkFactor(at(5, 11)), 1);
});

test('every factor stays between 0 and 1, never jumps, and wraps at midnight and at the end of the week', () => {
  for (const f of [vehicleFactor, pedestrianFactor, parkFactor]) {
    let last = f(0);
    for (let t = 60; t <= WEEK; t += 60) {
      const v = f(t);
      assert.ok(v >= 0 && v <= 1 && Number.isFinite(v), `${f.name} at ${t}`);
      assert.ok(Math.abs(v - last) < 0.02, `${f.name} jumps by ${Math.abs(v - last)} at ${t}`);
      last = v;
    }
    assert.equal(f(WEEK), f(0), 'the week wraps');
    assert.equal(f(-60), f(WEEK - 60), 'and so does a time before the start');
  }
});

test('the mix of vehicles sums to one in both regions, with more buses in the rush hour and more trucks at night than at the weekend', () => {
  for (const region of ['au', 'in']) {
    for (const t of [at(0, 3), at(0, 8), at(0, 12), at(0, 20), at(5, 12)]) {
      const total = Object.values(mixAt(t, region)).reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(total - 1) < 1e-9, `${region} mix at ${t} sums to ${total}`);
    }
    assert.ok(mixAt(at(0, 8), region).bus > mixAt(at(0, 3), region).bus);
  }
  assert.ok(mixAt(at(0, 3)).truck > mixAt(at(5, 20)).truck);
});

test('it is dark at night and light in the day', () => {
  assert.equal(isNight(at(0, 2)), true);
  assert.equal(isNight(at(0, 12)), false);
  assert.equal(isNight(at(0, 20)), true);
});

test('school buses run at school times and a few at midday and early evening, and never in the dark', () => {
  const share = (day, hour) => { let n = 0; for (let i = 0; i < 1000; i += 1) if (vehicleKind('bus', at(day, hour), i / 1000) === 'school') n += 1; return n / 1000; };
  assert.ok(share(1, 8) > 0.2, 'the morning run');
  assert.ok(share(1, 15.5) > 0.2, 'the afternoon run');
  assert.ok(share(1, 12) > 0 && share(1, 12) < 0.1, 'a few at midday');
  assert.ok(share(1, 17) > 0 && share(1, 17) < 0.1, 'a few in the early evening');
  for (const hour of [0, 3, 5, 6.5, 19, 21, 23.5]) assert.equal(share(1, hour), 0, `none at ${hour}`);
  for (const hour of [0, 4, 20, 22]) assert.equal(share(5, hour), 0, `none on a Saturday at ${hour}`);
  assert.equal(studentShare(at(1, 3)), 0);
  assert.ok(studentShare(at(1, 8)) > 0);
  assert.equal(studentShare(at(5, 8)), 0, 'no school on a Saturday');
});

test('bin lorries only on early weekday mornings, and building trucks only in working hours', () => {
  const kinds = (day, hour) => { const k = new Set(); for (let i = 0; i < 1000; i += 1) k.add(vehicleKind('truck', at(day, hour), i / 1000)); return k; };
  assert.ok(kinds(1, 6).has('garbage'));
  for (const [day, hour] of [[1, 12], [1, 22], [5, 6], [6, 7]]) assert.ok(!kinds(day, hour).has('garbage'), `no bin round at day ${day} hour ${hour}`);
  for (const [day, hour] of [[1, 3], [1, 20], [5, 10]]) assert.ok(!kinds(day, hour).has('tipper') && !kinds(day, hour).has('flatbed'), `no building trucks at day ${day} hour ${hour}`);
});
