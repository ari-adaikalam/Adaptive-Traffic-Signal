// Behaviour checks on the running simulation, written to catch what a plain overlap test cannot: a vehicle crawling, a time in the junction far outside the usual
// range, two vehicles holding each other, wrong kinds of vehicle for the hour, calls for emergency vehicles, kinds of walker, side street use and length counts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, Simulation } from '../src/sim/traffic.js';
import { BOX_PATH, CAMERA_RIG, CLASSES, isEmergency } from '../src/sim/world.js';
import { withFullMix, FULL_MIX } from '../src/sim/compare.js';
import { watch } from './helpers/contact.js';
import { emergencyRate, walkerRole } from '../src/sim/daily.js';

const clockAt = (hour, day = 0) => ({ ...PRESETS.clock, clockStartS: day * 86400 + hour * 3600 });
const make = (seed, demand, options = {}) => new Simulation({ seed, mode: 'adaptive', demand, ...options });

// How long every vehicle spends in the junction, and for how long it crawls (moves, but slower than walking pace) there. Returns one record for each vehicle through.
function crossings(sim, seconds) {
  const live = new Map(), done = [];
  for (let i = 0; i < seconds * 10; i += 1) {
    sim.step();
    for (const v of sim.vehicleList) {
      const reach = BOX_PATH[v.movement], inBox = v.d < 0 && v.d > -reach;
      let r = live.get(v.id);
      if (inBox && !r) { r = { id: v.id, cls: v.cls, movement: v.movement, t0: sim.time, run: 0, worstRun: 0, emergency: isEmergency(v.cls) }; live.set(v.id, r); }
      if (!r) continue;
      if (v.d <= 0 && v.d > -reach - 30) { r.run = v.v > 0.05 && v.v < 1.5 ? r.run + 0.1 : 0; r.worstRun = Math.max(r.worstRun, r.run); }
      if (v.d <= -reach) { r.dwell = sim.time - r.t0; done.push(r); live.delete(v.id); }
    }
  }
  return done;
}
const quantile = (list, q) => [...list].sort((a, b) => a - b)[Math.min(list.length - 1, Math.floor(list.length * q))];

test('crossing times stay in their usual range and nothing crawls, in the morning rush, midday and a Saturday', () => {
  for (const [label, demand, seed] of [['08:00', clockAt(8), 1], ['12:00', clockAt(12), 2], ['Saturday 11:00', clockAt(11, 5), 3]]) {
    const done = crossings(make(seed, demand), 900);
    assert.ok(done.length > 300, `${label}: only ${done.length} vehicles crossed`);
    const worstCrawl = Math.max(...done.map((r) => r.worstRun));
    assert.ok(worstCrawl <= 5, `${label}: a vehicle crawled for ${worstCrawl.toFixed(1)} s in a row`);
    const straight = done.filter((r) => r.movement === 'through').map((r) => r.dwell), right = done.filter((r) => r.movement === 'right').map((r) => r.dwell);
    assert.ok(quantile(straight, 0.99) <= 8, `${label}: 1 in 100 vehicles going straight took ${quantile(straight, 0.99).toFixed(1)} s`);
    assert.ok(Math.max(...straight) <= 35, `${label}: one vehicle going straight took ${Math.max(...straight).toFixed(1)} s in the junction`);
    assert.ok(quantile(right, 0.99) <= 8 && Math.max(...right) <= 10, `${label}: right turns took up to ${Math.max(...right).toFixed(1)} s`);
    // A left turner gives way to people crossing where it turns, so some wait; none may wait more than a full cycle and a half.
    const left = done.filter((r) => r.movement === 'left').map((r) => r.dwell);
    assert.ok(quantile(left, 0.5) <= 6, `${label}: the usual left turn took ${quantile(left, 0.5).toFixed(1)} s`);
    assert.ok(Math.max(...left) <= 50, `${label}: a left turner took ${Math.max(...left).toFixed(1)} s`);
  }
});

test('long vehicles cross in a time that fits their length, and emergency vehicles are never slow', () => {
  const done = crossings(make(4, { ...clockAt(12), daily: { ...PRESETS.clock.daily, autoEmergencies: true } }), 1800);
  for (const cls of ['semi', 'artbus', 'bus', 'truck']) {
    const times = done.filter((r) => r.cls === cls && r.movement === 'through').map((r) => r.dwell);
    if (times.length < 10) continue;
    assert.ok(quantile(times, 0.9) <= 9, `${cls}: 9 in 10 took ${quantile(times, 0.9).toFixed(1)} s or less, more than a long vehicle should need`);
  }
  const emergency = done.filter((r) => r.emergency);
  assert.ok(emergency.length >= 1, 'no emergency vehicle came by itself in half an hour at midday');
  for (const r of emergency) assert.ok(r.dwell <= 12, `${r.cls}/${r.movement} took ${r.dwell.toFixed(1)} s to cross`);
});

test('a bus turning left and a truck going straight beside it do not hold each other', () => {
  for (const seed of [11, 3, 5]) {
    const sim = make(seed, clockAt(7.5), { approachLength: 700, exitRun: 640, pedestrianWalk: 560 });
    const held = new Map();
    let worst = 0, pair = '';
    for (let second = 0; second < 600; second += 1) {
      for (let k = 0; k < 10; k += 1) sim.step();
      const inside = sim.vehicleList.filter((v) => v.d < 0 && v.d > -34 && v.v < 1 && v.why && !v.why.startsWith('ped'));
      const now = new Set();
      for (const a of inside) for (const b of inside) {
        if (a.id >= b.id || Math.hypot(a.pose.fx - b.pose.fx, a.pose.fz - b.pose.fz) > 16) continue;
        const key = `${a.id}-${b.id}`; now.add(key);
        const n = (held.get(key) || 0) + 1; held.set(key, n);
        if (n > worst) { worst = n; pair = `${a.cls}/${a.movement} and ${b.cls}/${b.movement}`; }
      }
      for (const key of held.keys()) if (!now.has(key)) held.delete(key);
    }
    assert.ok(worst <= 6, `seed ${seed}: ${pair} held each other for ${worst} s`);
  }
});

test('emergency vehicles call themselves by the clock: more by day than at night, never more than three at once', () => {
  assert.ok(emergencyRate('amb', 1 * 86400 + 8 * 3600) > emergencyRate('amb', 1 * 86400 + 3 * 3600) * 1.5);
  assert.ok(emergencyRate('police', 4 * 86400 + 23 * 3600) > emergencyRate('police', 1 * 86400 + 23 * 3600), 'police are busier late on a Friday');
  const sim = make(6, clockAt(9));
  let most = 0; const seen = { amb: 0, fire: 0, police: 0 };
  const counted = new Set();
  for (let i = 0; i < 3600 * 10; i += 1) {
    sim.step();
    if (i % 10) continue;
    const on = sim.vehicleList.filter((v) => isEmergency(v.cls));
    most = Math.max(most, on.length + sim.entry.reduce((n, q) => n + q.filter((e) => e.emergency).length, 0));
    for (const v of on) if (!counted.has(v.id)) { counted.add(v.id); seen[v.cls] += 1; }
  }
  assert.ok(most <= 3, `${most} emergency vehicles at once`);
  assert.ok(seen.amb >= 3 && seen.police >= 1, `in an hour: ${JSON.stringify(seen)}`);
  assert.ok(seen.amb > seen.fire, 'ambulances come more often than fire engines');
});

test('kinds of walker follow the hour', () => {
  const at = (day, hour) => day * 86400 + hour * 3600;
  const kinds = (day, hour) => { const k = new Set(); for (let i = 0; i < 1000; i += 1) k.add(walkerRole(at(day, hour), i / 1000)); return k; };
  assert.ok(kinds(1, 6).has('jogger') && kinds(1, 8).has('commuter') && kinds(1, 12).has('elder'));
  assert.ok(!kinds(1, 3).has('jogger') && !kinds(1, 3).has('commuter') && !kinds(1, 23).has('elder'), 'none of them in the small hours');
  assert.ok(!kinds(5, 8).has('commuter'), 'no commuters on a Saturday');
  const sim = make(7, clockAt(8));
  sim.run(900);
  const roles = new Map(); for (const p of sim.pedestrians) roles.set(p.role || '', (roles.get(p.role || '') || 0) + 1);
  assert.ok((roles.get('commuter') || 0) > 0, 'commuters at 8 am');
  for (const p of sim.pedestrians) if (p.role === 'jogger') assert.ok(p.speed >= 2.4, 'a jogger moves like one');
});

test('people turn corners onto the next crossing, and the choice does not change what the signals do to the random stream', () => {
  const run = (mode) => { const s = make(8, clockAt(12)); s.setMode(mode); const turned = new Set(); for (let i = 0; i < 900 * 10; i += 1) { s.step(); if (i % 10 === 0) for (const p of s.pedestrians) if (p.turns) turned.add(p.id); } return { s, turned }; };
  const fixed = run('fixed'), adaptive = run('adaptive');
  assert.equal(fixed.s.summary().pedestrians.spawned, adaptive.s.summary().pedestrians.spawned, 'the same people set out under both plans');
  assert.ok(adaptive.turned.size >= 5, `only ${adaptive.turned.size} people turned a corner in a quarter of an hour`);
  assert.ok(adaptive.turned.size < adaptive.s.stats.ped.crossed, 'not everyone turns');
});

test('two in five vehicles going straight in the kerb lane turn off into a side street', () => {
  const sim = make(9, clockAt(12));
  const seen = new Map();
  for (let i = 0; i < 1200 * 10; i += 1) { sim.step(); if (i % 10) continue; for (const v of sim.vehicleList) if (v.lane === 0 && v.movement === 'through' && !seen.has(v.id)) seen.set(v.id, v.exitVia > 0); }
  const share = [...seen.values()].filter(Boolean).length / seen.size;
  assert.ok(seen.size > 100 && share > 0.3 && share < 0.5, `${(share * 100).toFixed(0)}% of ${seen.size}`);
});

test('a long vehicle counts for the lane it takes up when counts are by length', () => {
  const sim = make(10, clockAt(8), { lengthCounts: true });
  assert.ok(Math.abs(sim.countWeight('semi', 'trucks') - (CLASSES.semi.length + CLASSES.semi.s0) / (CLASSES.truck.length + CLASSES.truck.s0)) < 1e-9);
  assert.ok(sim.countWeight('semi', 'trucks') > 1.7 && sim.countWeight('artbus', 'buses') > 1.3);
  assert.equal(sim.countWeight('car', 'cars'), 1);
  assert.equal(sim.countWeight('scooter', 'bikes'), 1, 'a small one never counts for less than one');
  assert.equal(make(10, clockAt(8)).countWeight('semi', 'trucks'), 1, 'one each without the option');
});

test('with the camera rig, which misses a quarter of the vehicles, the junction is still safe and every vehicle is accounted for', () => {
  assert.ok(CAMERA_RIG.detectionCurve.every(([metres, share], i, all) => metres > (i ? all[i - 1][0] : 0) && share > 0.4 && share <= 1), 'a curve of rising distances and believable shares');
  assert.equal(CAMERA_RIG.detectionZone, CAMERA_RIG.detectionCurve.at(-1)[0], 'the zone ends where the curve does');
  const demand = withFullMix(PRESETS.peak, FULL_MIX.rush);
  const sim = make(2, demand, CAMERA_RIG);
  const found = watch(sim, 600, { minDepth: 0.3 }).filter((c) => (c.kinds === 'vv' || c.kinds === 'vp') && Math.abs(c.x) < 60 && Math.abs(c.z) < 60);
  assert.equal(found.length, 0, `${found.length} overlaps near the junction`);
  const s = sim.summary();
  assert.ok(s.arrivedTotal >= s.exited, 'nothing leaves that never arrived');
  assert.ok(s.throughputPerHour > 1500, `${s.throughputPerHour} vehicles an hour got through`);
});
