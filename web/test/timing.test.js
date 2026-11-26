import test from 'node:test';
import assert from 'node:assert/strict';
import { makeConfig } from '../src/config.js';
import { arrowGreenTime, busLaneGreenTime, countsFromClassIds, greenTime, makeCounts, medianCounts } from '../src/timing.js';
import { vector } from './vectors.js';

const data = vector('green_time.json');
const cfgFor = (c) => makeConfig(c.config || {});

test('green time vectors', () => {
  for (const c of data.valid) assert.equal(greenTime(makeCounts(c.counts), cfgFor(c)), c.expect, c.name);
});

test('invalid counts are rejected', () => {
  for (const c of data.invalid) assert.throws(() => makeCounts(c.counts), undefined, c.name);
});

test('class id vectors', () => {
  for (const c of data.class_ids.valid) assert.deepEqual({ ...countsFromClassIds(c.ids) }, c.expect);
  for (const ids of data.class_ids.invalid) assert.throws(() => countsFromClassIds(ids));
});

test('arrow green vectors', () => {
  for (const c of data.arrow) assert.equal(arrowGreenTime(makeCounts(c.counts), cfgFor(c)), c.expect, c.name);
});

test('bus lane green vectors', () => {
  for (const c of data.bus_lane) assert.equal(busLaneGreenTime(makeCounts(c.counts), cfgFor(c)), c.expect, c.name);
});

test('lane override vectors', () => {
  for (const c of data.lanes.valid) assert.equal(greenTime(makeCounts(c.counts), makeConfig(), c.lanes), c.expect, c.name);
  for (const bad of data.lanes.invalid) assert.throws(() => greenTime(makeCounts({ cars: 4 }), makeConfig(), bad));
});

test('median vectors', () => {
  for (const c of data.median.valid) {
    assert.deepEqual({ ...medianCounts(c.reports.map(makeCounts)) }, c.expect, c.name);
  }
  for (const reports of data.median.invalid) assert.throws(() => medianCounts(reports.map(makeCounts)));
});

test('unknown count names are rejected', () => {
  assert.throws(() => makeCounts({ planes: 1 }));
});
