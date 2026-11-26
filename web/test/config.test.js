import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, crossingTimes, makeConfig } from '../src/config.js';
import { vector } from './vectors.js';

test('defaults match the Python config', () => {
  const c = makeConfig();
  assert.deepEqual([c.default_green, c.yellow, c.all_red, c.min_green, c.max_green], [10, 4, 2, 5, 60]);
  assert.deepEqual([c.bike_time, c.bus_time, c.car_time, c.truck_time], [2, 6, 4, 6]);
  assert.deepEqual([c.walk_min, c.walking_speed_cm_s, c.max_arrow_green, c.smoothing_frames], [6, 120, 15, 3]);
  assert.deepEqual([c.bus_extension, c.bus_early_green, c.startup_flash, c.max_skips, c.count_ttl], [5, true, 5, 2, 10]);
  assert.deepEqual(c.bus_lane_windows, [[0, 4, 420, 540], [0, 4, 960, 1080]]);
  assert.equal(Object.keys(DEFAULTS).length, 31); // 30 in Python. left_clear_arrow, which is display only, is JavaScript only
  assert.deepEqual([c.turn_hold, c.left_arrow], [0, true]);
});

const positive = ['default_green', 'yellow', 'min_green', 'max_green', 'lanes_per_approach', 'bike_time', 'bus_time',
  'car_time', 'truck_time', 'count_ttl', 'max_arrow_green', 'smoothing_frames', 'walk_min', 'walking_speed_cm_s',
  'emergency_timeout', 'max_emergencies'];

test('positive fields reject bad values', () => {
  for (const field of positive) {
    for (const bad of [0, -1, 1.5, true, '5', null]) {
      assert.throws(() => makeConfig({ [field]: bad }), undefined, `${field}=${String(bad)}`);
    }
  }
});

test('fields that may be zero accept it and reject other bad values', () => {
  for (const field of ['all_red', 'max_skips', 'bus_extension', 'startup_flash']) {
    makeConfig({ [field]: 0 });
    for (const bad of [-1, 1.5, true, '1', null]) assert.throws(() => makeConfig({ [field]: bad }), undefined, field);
  }
});

test('relations between fields are enforced', () => {
  assert.throws(() => makeConfig({ min_green: 10, max_green: 5, default_green: 5 }));
  assert.throws(() => makeConfig({ default_green: 1 }));
  assert.throws(() => makeConfig({ default_green: 61 }));
  assert.throws(() => makeConfig({ max_arrow_green: 4 }));
  makeConfig({ max_arrow_green: 5 });
  assert.throws(() => makeConfig({ max_green: 12 }), /crossing/);
  makeConfig({ max_green: 13 });
  // with the 6 s turn hold the same crossing needs 19 s
  assert.throws(() => makeConfig({ max_green: 18, turn_hold: 6 }), /crossing/);
  makeConfig({ max_green: 19, turn_hold: 6 });
  assert.throws(() => makeConfig({ turn_hold: -1 }));
  for (const bad of [1, 0, null, 'yes']) assert.throws(() => makeConfig({ left_arrow: bad }));
});

test('widths, windows, flags and unknown keys are validated', () => {
  for (const bad of [[1280, 1280, 1280], [1280, 1280, 1280, 1280, 1280], [1280, 1280, 1280, 0], [1280, 1280, 1280, 1.5],
    [1280, 1280, 1280, true], '1280']) {
    assert.throws(() => makeConfig({ crossing_widths_cm: bad }));
  }
  for (const bad of [1, 0, null, 'yes']) assert.throws(() => makeConfig({ bus_early_green: bad }));
  assert.throws(() => makeConfig({ nonsense: 1 }), /unknown config key/);
  assert.deepEqual(makeConfig({ bus_lane_windows: [] }).bus_lane_windows, []);
  assert.throws(() => makeConfig({ bus_lane_windows: 'x' }));
});

test('invalid bus windows from the shared vectors are rejected', () => {
  for (const raw of vector('bus_lane.json').invalid_windows) {
    assert.throws(() => makeConfig({ bus_lane_windows: [raw] }), undefined, JSON.stringify(raw));
  }
});

test('crossing times match the shared vectors', () => {
  for (const c of vector('crossing_times.json').cases) {
    assert.deepEqual(crossingTimes(c.width_cm, c.speed_cm_s, c.yellow), [c.total, c.clearance_1], c.name);
  }
});

test('a config is immutable', () => {
  const c = makeConfig();
  assert.throws(() => { c.yellow = 3; }, TypeError);
});
