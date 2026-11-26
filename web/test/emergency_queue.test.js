// Several emergency vehicles at once: each keeps its own request, they are served one after another, and none waits with no request.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, Simulation } from '../src/sim/traffic.js';
import { isEmergency } from '../src/sim/world.js';

const make = (seed) => new Simulation({ seed, mode: 'adaptive', demand: { ...PRESETS.clock, clockStartS: 12 * 3600 } });

test('two vehicles of the same kind sent in the same moment get different ids', () => {
  const sim = make(1);
  const ids = [sim.dispatchEmergency(1, 'through', 'police'), sim.dispatchEmergency(4, 'right', 'police'), sim.dispatchEmergency(2, 'through', 'police')];
  assert.equal(new Set(ids).size, 3, ids.join(', '));
});

test('four vehicles sent at once, two of them police, all cross within a minute and none waits without a request', () => {
  for (const seed of [1, 4, 5]) { // seed 1 is the one where two police cars shared an id, and the first to cross cancelled the other's request (it waited 110 s)
    const sim = make(seed), line = new Map(), first = new Map();
    for (let step = 0; step < 1800; step += 1) {
      if (step === 200) ['police', 'police', 'amb', 'fire'].forEach((kind, i) => sim.dispatchEmergency(1 + i, 'through', kind));
      sim.step();
      if (step % 10 !== 0) continue;
      const held = new Set(sim.controller.emergencies.keys());
      for (const v of sim.vehicleList) {
        if (!isEmergency(v.cls) || sim.time < 20) continue;
        if (!first.has(v.id)) first.set(v.id, sim.time);
        if (v.d < 0 && !line.has(v.id)) line.set(v.id, sim.time);
        if (v.requested && !v.crossed && v.d > 0) assert.ok(held.has(String(v.vid)) || [...held].some((k) => String(k).endsWith(String(v.vid))), `seed ${seed}, t ${sim.time.toFixed(0)}: ${v.cls} on road ${v.approach} asked for priority and the controller holds no request for it`);
      }
    }
    const waits = [...first].filter(([id]) => line.has(id)).map(([id, t]) => line.get(id) - t);
    assert.ok(waits.length >= 4, `seed ${seed}: only ${waits.length} crossed`);
    assert.ok(Math.max(...waits) < 70, `seed ${seed}: the longest wait was ${Math.max(...waits).toFixed(0)} s`);
  }
});

import { contacts } from './helpers/contact.js';

test('a fast vehicle in the next lane does not drive into the tail of a slow one that is joining from a side street', () => {
  // seed 2, fixed timing, four emergency vehicles at 20 s: a fire engine overlapped a semi by 0.5 m, 88 m before the junction, at 136 s
  const MOVES = ['through', 'left', 'right'], KINDS = ['amb', 'fire', 'police'];
  const sim = new Simulation({ seed: 2, mode: 'fixed', demand: { ...PRESETS.clock, clockStartS: 12 * 3600 } });
  const found = [];
  for (let step = 0; step < 1600; step += 1) {
    if (step === 200) [1, 2, 3, 4].forEach((r, i) => sim.dispatchEmergency(r, MOVES[(2 + i) % 3], KINDS[(2 + i) % 3]));
    sim.step();
    if (step % 5 === 0) for (const c of contacts(sim, 0.2)) found.push(`${c.a} vs ${c.b} ${c.depth.toFixed(2)}`);
  }
  assert.deepEqual(found, []);
});
