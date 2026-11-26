// The hand-worked controller scenarios, shared with the Python tests.
// Time t is the snapshot after t ticks. Events at t run after snapshot t exists and before the
// next tick. Only the fields named in an expectation are checked.

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeConfig } from '../src/config.js';
import { buildPlan } from '../src/phases.js';
import { Controller } from '../src/signals.js';
import { makeCounts } from '../src/timing.js';
import { vector } from './vectors.js';

const FILES = ['controller_scenarios.json', 'controller_pedestrian_scenarios.json', 'controller_arrow_scenarios.json',
  'controller_emergency_scenarios.json', 'controller_bus_scenarios.json', 'controller_mode_scenarios.json'];

function run(scenario) {
  const config = { ...scenario.config };
  const arrows = config.plan !== 'through_only';
  delete config.plan;
  const controller = new Controller({
    config: makeConfig(config), plan: buildPlan(arrows),
    clockStartS: scenario.clock_start_s || 0, powerOn: Boolean(scenario.power_on),
  });
  const events = new Map();
  for (const event of scenario.events) {
    if (!events.has(event.t)) events.set(event.t, []);
    events.get(event.t).push(event);
  }
  const expected = new Map(scenario.expect.map((e) => [e.t, e]));
  const last = Math.max(...expected.keys());
  let snapshot = controller.snapshot;
  for (let t = 0; t <= last; t += 1) {
    if (expected.has(t)) {
      for (const [key, value] of Object.entries(expected.get(t))) {
        if (key === 't') continue;
        let actual = snapshot[key];
        if (key === 'signals') actual = Object.fromEntries(Object.keys(value).map((name) => [name, actual[name]]));
        assert.deepEqual(actual, value, `t=${t} ${key}`);
      }
    }
    for (const event of events.get(t) || []) {
      if ('request' in event) {
        assert.equal(controller.requestCrossing(event.request), event.result ?? true, `t=${t} request`);
      } else if ('fault' in event) {
        assert.equal(controller.fault(event.fault), event.result, `t=${t} fault`);
      } else if ('clear_fault' in event) {
        assert.equal(controller.clearFault(), event.result, `t=${t} clear_fault`);
      } else if ('mode' in event) {
        controller.setMode(event.mode);
      } else if ('pause' in event) {
        assert.equal(controller.pause(event.pause.vehicle, event.pause.approach), event.result, `t=${t} pause`);
      } else if ('resume' in event) {
        assert.equal(controller.resume(event.resume), event.result, `t=${t} resume`);
      } else {
        const { approach, counts, lane } = event.report;
        const value = counts === null ? null : makeCounts(counts);
        if (lane === 'right') controller.reportRightCounts(approach, value);
        else if (lane === 'left') controller.reportLeftCounts(approach, value);
        else if (lane === 'bus') controller.reportBusCounts(approach, value);
        else controller.reportCounts(approach, value);
      }
    }
    if (t < last) snapshot = controller.tick();
  }
}

let total = 0;
for (const file of FILES) {
  for (const scenario of vector(file)) {
    total += 1;
    test(`${file.replace('controller_', '').replace('.json', '')}: ${scenario.name}`, () => run(scenario));
  }
}

test('all the shared scenarios were found', () => {
  assert.equal(total, 76);
});
