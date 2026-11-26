import test from 'node:test';
import assert from 'node:assert/strict';
import { WEEK_SECONDS, checkWindow, isActive } from '../src/busLane.js';
import { vector } from './vectors.js';

const data = vector('bus_lane.json');

test('the default windows follow the schedule', () => {
  for (const c of data.cases) assert.equal(isActive(data.default_windows, c.second), c.expect, c.name);
});

test('custom windows', () => {
  for (const c of data.custom) assert.equal(isActive(c.windows, c.second), c.expect, c.name);
});

test('invalid windows and clock values are rejected', () => {
  for (const raw of data.invalid_windows) assert.throws(() => checkWindow(raw), undefined, JSON.stringify(raw));
  for (const second of data.invalid_seconds) assert.throws(() => isActive(data.default_windows, second));
});

test('the schedule repeats every week and gives 20 active hours', () => {
  for (let s = 0; s < WEEK_SECONDS; s += 997) {
    assert.equal(isActive(data.default_windows, s), isActive(data.default_windows, s + 3 * WEEK_SECONDS));
  }
  let active = 0;
  for (let s = 0; s < WEEK_SECONDS; s += 60) active += isActive(data.default_windows, s) ? 1 : 0;
  assert.equal(active, 5 * 4 * 60);
});
