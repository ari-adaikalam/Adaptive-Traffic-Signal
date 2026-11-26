// fault_signal 'red': a fault runs the vehicles through their yellow and into all-red, and lets pedestrians already crossing finish.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Controller } from '../src/signals.js';
import { crossingTimes, makeConfig } from '../src/config.js';
import { buildPlan } from '../src/phases.js';
import { makeCounts } from '../src/timing.js';

const cars = (n) => makeCounts({ bikes: 0, buses: 0, cars: n, trucks: 0 });
const feed = (c) => { for (const a of [1, 2, 3, 4]) { c.reportCounts(a, cars(a % 2 ? 40 : 1)); c.reportRightCounts(a, cars(a === 2 || a === 4 ? 3 : 0)); } };
const make = (overrides = {}) => new Controller({ config: makeConfig({ fault_signal: 'red', left_window: 6, left_follow: true, left_follow_windows: [], ...overrides }), plan: buildPlan(true) });

function until(c, predicate, limit = 400) {
  for (let i = 0; i < limit; i += 1) {
    feed(c);
    if (i === 3) c.requestCrossing(2);
    const s = c.tick();
    if (predicate(s)) return s;
  }
  throw new Error('condition never met');
}
const lit = (s) => Object.entries(s.signals).filter(([, v]) => v === 'green' || v === 'yellow').map(([m]) => m);

test('a fault in a green gives the vehicles their normal yellow, then all-red, and never a green again', () => {
  const c = make();
  until(c, (s) => s.phase === 'T13' && s.stage === 'green' && s.period > 1);
  assert.ok(c.fault('link'));
  const trace = [];
  for (let i = 0; i < 20; i += 1) { feed(c); trace.push(c.tick()); }
  const yellow = trace.filter((s) => s.stage === 'yellow');
  assert.equal(yellow.length, makeConfig().yellow, 'the full yellow');
  assert.deepEqual(lit(yellow[0]).sort(), ['T1', 'T3']);
  const after = trace.slice(trace.findIndex((s) => s.stage === 'fault'));
  assert.ok(after.length > 5, 'then the fault holds');
  for (const s of after) {
    assert.deepEqual(lit(s), [], `a signal is lit at ${s.time}`);
    assert.deepEqual(s.arrows, ['red', 'red', 'red', 'red']);
  }
  assert.ok(trace.every((s) => s.stage !== 'green'), 'no green after the fault');
  assert.equal(trace[0].fault, 'link');
});

test('a fault in the middle of a walk keeps the flashing man for the whole crossing and starts nobody new', () => {
  const cfg = makeConfig({ fault_signal: 'red' });
  const [total] = crossingTimes(cfg.crossing_widths_cm[1], cfg.walking_speed_cm_s, cfg.yellow);
  const c = make();
  until(c, (s) => s.phase === 'T13' && s.signals.C2 === 'walk' && s.stage === 'green');
  c.fault('manual');
  const trace = [];
  for (let i = 0; i < total + 10; i += 1) { feed(c); c.requestCrossing(2); c.requestCrossing(4); trace.push(c.tick()); }
  const flashing = trace.filter((s) => s.signals.C2 === 'clear').length;
  assert.equal(flashing, total - 1, 'flashes for the time a person who just stepped out needs');
  assert.ok(trace.every((s) => s.signals.C2 !== 'walk' && s.signals.C4 !== 'walk'), 'nobody is sent out during a fault');
  assert.equal(trace.at(-1).signals.C2, 'stop');
  // Never back from solid red to flashing.
  let stopped = false;
  for (const s of trace) { if (s.signals.C2 === 'stop') stopped = true; else assert.ok(!stopped, 'the man came back'); }
});

test('a fault during the yellow or the all-red finishes that stage, then holds red', () => {
  for (const stage of ['yellow', 'all_red']) {
    const c = make();
    const s0 = until(c, (s) => s.phase === 'T13' && s.stage === stage && s.period > 1);
    c.fault('conflict');
    const trace = [];
    for (let i = 0; i < 12; i += 1) { feed(c); trace.push(c.tick()); }
    assert.ok(trace.some((s) => s.stage === 'fault'), `${stage}: the fault holds`);
    assert.ok(trace.every((s) => s.stage !== 'green'), `${stage}: no green`);
    assert.ok(s0);
  }
});

test('a left arrow that is lit goes yellow and then red in a fault, never straight to red', () => {
  const c = make();
  until(c, (s) => s.phase === 'T13' && s.stage === 'green' && s.arrows[0] === 'green');
  c.fault('link');
  const arrows = [];
  for (let i = 0; i < 10; i += 1) { feed(c); arrows.push(c.tick().arrows[0]); }
  assert.deepEqual(arrows.slice(0, 5), ['yellow', 'yellow', 'yellow', 'yellow', 'red']);
});

test('after a fault is cleared the junction goes through the all-red and starts, with no flash', () => {
  const c = make();
  until(c, (s) => s.stage === 'green' && s.period > 1);
  c.fault('link');
  for (let i = 0; i < 10; i += 1) c.tick();
  assert.ok(c.clearFault());
  const trace = [];
  for (let i = 0; i < 10; i += 1) trace.push(c.tick());
  assert.ok(trace.every((s) => s.stage !== 'flash'));
  assert.ok(trace.some((s) => s.stage === 'all_red'));
  assert.ok(trace.some((s) => s.stage === 'green'), 'it restarts');
  assert.equal(trace.at(-1).fault, null);
});

test('with the default fault_signal a fault still flashes at once', () => {
  const c = new Controller({ config: makeConfig(), plan: buildPlan(true) });
  c.tick();
  c.fault('manual');
  const s = c.tick();
  assert.equal(s.stage, 'fault');
  assert.ok(Object.entries(s.signals).filter(([m]) => m[0] !== 'C').every(([, v]) => v === 'flash'));
});
