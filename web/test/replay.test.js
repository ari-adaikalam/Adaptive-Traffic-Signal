// Replays random controller runs recorded from the Python engine (tests/replay_export.py) and
// checks a digest of the whole snapshot after every tick. This is the strong parity check: it
// covers every combination the random runs reached, not just the hand-worked scenarios.

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeConfig } from '../src/config.js';
import { buildPlan, ALL_MOVEMENTS } from '../src/phases.js';
import { Controller } from '../src/signals.js';
import { makeCounts } from '../src/timing.js';
import { vector } from './vectors.js';

const CODES = { red: 'R', yellow: 'Y', green: 'G', flash: 'F', stop: 'S', walk: 'W', clear: 'C' };

function digestText(s) {
  return [
    String(s.time), s.phase, s.stage, String(s.remaining), ALL_MOVEMENTS.map((m) => CODES[s.signals[m]]).join(''),
    s.pedestrian_requests.join(','), String(s.period), s.emergency_approach === null ? '-' : String(s.emergency_approach),
    s.holding ? '1' : '0', s.bus_lane_active ? '1' : '0', s.bus_priority ? '1' : '0', s.mode, s.fault || '-', String(s.startups),
    s.arrows.map((a) => CODES[a]).join(''),
  ].join(';');
}

function fnv1a(text) {
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) h = Math.imul(h ^ byte, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

const asCounts = (list) => (list === null ? null : makeCounts({ bikes: list[0], buses: list[1], cars: list[2], trucks: list[3] }));

function apply(controller, event) {
  const [, kind, ...args] = event;
  const call = {
    counts: () => controller.reportCounts(args[0], asCounts(args[1])),
    right: () => controller.reportRightCounts(args[0], asCounts(args[1])),
    left: () => controller.reportLeftCounts(args[0], asCounts(args[1])),
    bus: () => controller.reportBusCounts(args[0], asCounts(args[1])),
    crossing: () => controller.requestCrossing(args[0]),
    pause: () => controller.pause(args[0], args[1], args[2]),
    resume: () => controller.resume(args[0]),
    fault: () => controller.fault(args[0]),
    clear: () => controller.clearFault(),
    mode: () => controller.setMode(args[0]),
  }[kind];
  assert.ok(call, `unknown recorded call ${kind}`);
  if (event[event.length - 1] === 'error') assert.throws(call, undefined, JSON.stringify(event));
  else call();
}

const data = vector('replay_runs.json');

for (const run of data.runs) {
  test(`replay of seed ${run.seed}: ${data.ticks} ticks, ${run.events.length} calls`, () => {
    const controller = new Controller({
      config: makeConfig(run.config), plan: buildPlan(run.arrows), clockStartS: run.clock, powerOn: run.power_on,
    });
    const byTick = new Map();
    for (const event of run.events) {
      if (!byTick.has(event[0])) byTick.set(event[0], []);
      byTick.get(event[0]).push(event);
    }
    const expected = run.digests.match(/.{8}/g);
    assert.equal(expected.length, data.ticks + 1);
    assert.equal(fnv1a(digestText(controller.snapshot)), expected[0], 'initial snapshot');
    for (let t = 1; t <= data.ticks; t += 1) {
      for (const event of byTick.get(t) || []) apply(controller, event);
      const snapshot = controller.tick();
      const got = fnv1a(digestText(snapshot));
      if (got !== expected[t]) {
        assert.fail(`tick ${t}: digest ${got} differs from ${expected[t]}. Snapshot: ${digestText(snapshot)}`);
      }
    }
  });
}
