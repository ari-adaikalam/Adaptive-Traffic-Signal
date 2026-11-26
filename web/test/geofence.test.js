import test from 'node:test';
import assert from 'node:assert/strict';
import { laneForPosition, parseZones, pointInPolygon } from '../src/geofence.js';
import { vector } from './vectors.js';

const data = vector('geofence.json');

test('point vectors', () => {
  for (const c of data.points) assert.equal(pointInPolygon(c.lon, c.lat, c.ring), c.expect, c.name);
});

test('invalid input vectors', () => {
  for (const c of data.invalid_points) assert.throws(() => pointInPolygon(c.lon, c.lat, c.ring), undefined, c.name);
  for (const bad of [Number.NaN, Infinity, -Infinity]) {
    assert.throws(() => pointInPolygon(bad, 0, [[0, 0], [1, 0], [1, 1]]));
    assert.throws(() => pointInPolygon(0, 0, [[0, 0], [1, 0], [bad, 1]]));
  }
});

test('lane lookup on the real intersection', () => {
  const zones = parseZones(data.intersection);
  for (const c of data.lanes) assert.equal(laneForPosition(c.lon, c.lat, zones), c.expect, c.name);
});

test('the lowest lane wins an overlap, bad zone keys are rejected, an empty set matches nothing', () => {
  const big = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const small = [[2, 2], [4, 2], [4, 4], [2, 4]];
  assert.equal(laneForPosition(3, 3, { 2: small, 1: big }), 1);
  assert.equal(laneForPosition(3, 3, { 2: small }), 2);
  for (const key of data.bad_zone_keys) assert.throws(() => parseZones({ [key]: [[0, 0], [1, 0], [1, 1]] }), undefined, key);
  assert.equal(laneForPosition(0, 0, {}), null);
});
