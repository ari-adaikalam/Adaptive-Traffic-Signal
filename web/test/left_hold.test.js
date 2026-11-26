// A left turner waits at the line while the green man shows for the crossing it turns across, and moves up when the flashing red man starts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, Simulation } from '../src/sim/traffic.js';

function pullUpsDuringWalk(options, seconds) {
  const sim = new Simulation({ seed: 5, mode: 'adaptive', demand: { ...PRESETS.moderate, pedRate: 200 }, ...options });
  let bad = 0, moved = 0;
  const before = new Map();
  for (let i = 0; i < seconds * sim.stepsPerSecond; i += 1) {
    sim.step();
    for (const v of sim.vehicleList) {
      if (v.movement !== 'left') continue;
      const was = before.get(v.id); before.set(v.id, v.d);
      if (was === undefined || !(was > 0.6 && v.d <= 0.6)) continue; // crossed the stop line this step
      if (v.committed || v.released) continue;
      moved += 1;
      if (sim.snapshot.signals[`C${sim.exitCrossing(v)}`] === 'walk') bad += 1;
    }
  }
  return { bad, moved };
}

test('without the option, left turners do pull in during the walk', () => {
  const r = pullUpsDuringWalk({}, 1800);
  assert.ok(r.bad > 0, `${r.bad} of ${r.moved}`);
});

test('with the option, no left turner crosses the line while the green man shows for its crossing', () => {
  const r = pullUpsDuringWalk({ leftWaitsForWalk: true }, 1800);
  assert.ok(r.moved > 5, `${r.moved} left turners crossed the line`);
  assert.equal(r.bad, 0);
});

test('the option changes nothing about the arrivals', () => {
  const a = new Simulation({ seed: 5, mode: 'adaptive', demand: PRESETS.moderate }).run(900).summary();
  const b = new Simulation({ seed: 5, mode: 'adaptive', demand: PRESETS.moderate, leftWaitsForWalk: true }).run(900).summary();
  assert.deepEqual(a.arrived, b.arrived);
});
