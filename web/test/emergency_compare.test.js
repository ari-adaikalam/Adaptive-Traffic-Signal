// Emergency vehicles in the comparison of the fixed plan with adaptive timing: the same calls go to both, the adaptive plan gives them priority, the fixed plan has none and its emergency vehicles slow at a red or a yellow
// and go through as soon as it is clear. See emergencyEvents and emergencyRun in src/sim/compare.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FULL_MIX, emergencyEvents, emergencyRun, withFullMix } from '../src/sim/compare.js';
import { PRESETS, Simulation } from '../src/sim/traffic.js';
import { CLASSES } from '../src/sim/world.js';
import { contacts } from './helpers/contact.js';

const demand = withFullMix(PRESETS.moderate, FULL_MIX.work);

test('the calls are the same for both plans, spread over the hour, and come from the seed', () => {
  const a = emergencyEvents(3, 3600), b = emergencyEvents(3, 3600), c = emergencyEvents(4, 3600);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.ok(a.length >= 14 && a.length <= 16, `${a.length} calls`);
  for (const e of a) { assert.ok(e.approach >= 1 && e.approach <= 4); assert.ok(['through', 'left', 'right'].includes(e.movement)); assert.ok(['amb', 'fire', 'police'].includes(e.kind)); assert.ok(e.t < 3540); }
});

// A run of one plan with the calls, watching what the controller is asked and what the vehicles do.
function watch(mode, seed, seconds, each) {
  const sim = new Simulation({ seed, mode, demand, config: mode === 'fixed' ? { default_green: 40, max_green: 60 } : {}, emergencyPriority: mode === 'adaptive' });
  const calls = emergencyEvents(seed, seconds); let next = 0, asked = 0;
  for (let i = 0; i < seconds * 10; i += 1) {
    while (next < calls.length && calls[next].t <= sim.time) { const e = calls[next]; sim.dispatchEmergency(e.approach, e.movement, e.kind); next += 1; }
    sim.step();
    if (sim.snapshot.emergency_approach !== null) asked += 1;
    each(sim, i);
  }
  return { sim, asked, calls: calls.length };
}

test('the fixed plan has no priority: the controller is never asked to hold or change for an emergency vehicle, and the adaptive plan is', () => {
  const fixed = watch('fixed', 1, 900, () => {}), adaptive = watch('adaptive', 1, 900, () => {});
  assert.equal(fixed.asked, 0, 'the fixed plan was asked');
  assert.ok(adaptive.asked > 0, 'the adaptive plan was never asked');
  assert.equal(fixed.sim.summary().emergency.crossed > 0, true, 'and the emergency vehicles still crossed');
});

test('an emergency vehicle goes through a red or a yellow as soon as the way is clear, without stopping, and nobody is hit and no two paths cross in the junction', () => {
  let worstContact = 0, conflicts = 0, redRuns = 0, atSpeed = 0, farOut = true;
  for (const seed of [1, 2, 3]) {
    const seen = new Set(), { sim } = watch('fixed', seed, 1200, (s, i) => {
      for (const v of s.vehicleList) if (v.emergency && v.released && !seen.has(v.vid)) { seen.add(v.vid); if (v.d > Math.max(30, v.v * v.v / 6 + 8) + 3) farOut = false; if (v.v > 4) atSpeed += 1; }
      if (i % 10 === 0) for (const c of contacts(s, 0.3)) if ((c.kinds === 'vv' || c.kinds === 'vp') && /amb|fire|police/.test(c.a + c.b)) worstContact = Math.max(worstContact, c.depth);
    });
    conflicts += sim.summary().boxConflictSteps; redRuns += sim.summary().emergency.redRuns;
  }
  assert.equal(conflicts, 0, 'two vehicles whose paths cross were in the junction together');
  assert.ok(worstContact < 0.3, `an emergency vehicle overlapped something by ${worstContact.toFixed(2)} m`);
  assert.ok(redRuns > 0, 'none of the emergency vehicles ever went through a red');
  assert.ok(atSpeed > 0, 'none of them went through a red without first coming to a stop');
  assert.ok(farOut, 'one set out through a red from further out than it looks (30 m, or its braking distance at speed)');
});

// The rule itself, with a scene set up by hand: an ambulance 25 m from the line of approach 1 at 15 m/s, and a vehicle on the road that crosses its path.
const EMPTY = { rates: [0, 0, 0, 0], pedRate: 0 };
function scene(cross) {
  const sim = new Simulation({ seed: 1, mode: 'fixed', demand: { ...EMPTY, clockStartS: 12 * 3600 }, emergencyPriority: false });
  const car = (props) => {
    const cls = props.cls || 'car', c = CLASSES[cls], v = { id: Math.random(), vid: `t-${Math.random()}`, cls, movement: 'through', approach: 1, lane: 1, length: c.length, width: c.width, d: 200, v: c.v0, born: 0, emergency: false, requested: false, committed: false, released: false, crossed: false, wasStopped: false, stoppedSince: null, via: 0, lcAt: -Infinity, ...props };
    sim.lanes[v.approach - 1][v.lane].push(v); sim.placeVehicle(v); return v;
  };
  sim.vehicleList = []; // filled below, as a step would
  sim.snapshot.signals = { T1: 'red', T2: 'red', T3: 'red', T4: 'red', R1: 'red', R2: 'red', R3: 'red', R4: 'red' };
  const amb = car({ cls: 'amb', emergency: true, d: 25, v: 15 });
  const other = cross ? car({ approach: 2, ...cross }) : null;
  sim.vehicleList = sim.lanes.flat(2);
  return { sim, amb, other, signals: sim.snapshot.signals };
}

test('it may cross when nothing is in the way, and stays able to when a vehicle on the other road stands at its own red', () => {
  assert.equal(scene(null).sim.emergencyMayProceed(scene(null).amb), true);
  const s = scene({ d: 1, v: 0 }); // standing at its red
  assert.equal(s.sim.emergencyMayProceed(s.amb), true);
});

test('it may not cross while a vehicle that crosses its path is in the junction, or has a light and is too near to stop', () => {
  const inside = scene({ d: -4, v: 8 });
  assert.equal(inside.sim.emergencyMayProceed(inside.amb), false, 'in the junction');
  const coming = scene({ d: 12, v: 14 }); coming.signals.T2 = 'green';
  assert.equal(coming.sim.emergencyMayProceed(coming.amb), false, 'coming in on a green');
  const far = scene({ d: 150, v: 14 }); far.signals.T2 = 'green';
  assert.equal(far.sim.emergencyMayProceed(far.amb), true, 'one that is far enough off to stop for it');
  coming.signals.T2 = 'red';
  assert.equal(coming.sim.emergencyMayProceed(coming.amb), true, 'the same one, with a red of its own');
});

test('it decides only when near enough (30 m, or its braking distance at speed), and not while people are on the crossing in its way', () => {
  const s = scene(null); s.amb.d = 90;
  assert.equal(s.sim.emergencyMayProceed(s.amb), false, 'too far to decide');
  s.amb.d = 25; assert.equal(s.sim.emergencyMayProceed(s.amb), true);
  s.sim.pedestrianInPath = () => true;
  assert.equal(s.sim.emergencyMayProceed(s.amb), false, 'people on the crossing have the way');
});

test('with priority an emergency vehicle waits less than without, over several runs', () => {
  let fixed = 0, adaptive = 0, nf = 0, na = 0;
  for (const seed of [1, 2, 3]) {
    const f = emergencyRun({ demand, seed, seconds: 1200, mode: 'fixed' }), a = emergencyRun({ demand, seed, seconds: 1200, mode: 'adaptive' });
    fixed += f.meanWait * f.crossed; nf += f.crossed; adaptive += a.meanWait * a.crossed; na += a.crossed;
    assert.equal(f.boxConflictSteps, 0); assert.equal(a.boxConflictSteps, 0);
  }
  assert.ok(nf >= 10 && na >= 10, `${nf} and ${na} crossed`);
  assert.ok(adaptive / na < fixed / nf, `adaptive ${(adaptive / na).toFixed(1)} s, fixed ${(fixed / nf).toFixed(1)} s`);
});
