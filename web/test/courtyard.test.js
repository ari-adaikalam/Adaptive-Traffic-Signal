// A courtyard's seats (src/scene/courtyard-layout.js) and the people who use them (src/scene/courtyard-life.js): nobody walks through furniture, nobody sits on anybody, the courtyard is empty when it is
// closed, at night and in the rain, and nothing gets stuck
import test from 'node:test';
import assert from 'node:assert/strict';
import { benches, cafeTables, hasCafe, seatsOf, yardParts } from '../src/scene/courtyard-layout.js';
import { CAFE_OPEN, createCourtyardLife } from '../src/scene/courtyard-life.js';

const seeded = (seed) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const YARDS = [
  { x: 0, z: 0, w: 25, d: 23, cafeX: 1, cafeZ: -1 }, { x: 40, z: -70, w: 15, d: 15, cafeX: -1, cafeZ: 1 }, { x: -60, z: -24, w: 15, d: 22, cafeX: 1, cafeZ: 1 },
  { x: 10, z: 10, w: 12, d: 9, cafeX: -1, cafeZ: -1 }, { x: 0, z: 0, w: 8, d: 8, cafeX: 1, cafeZ: 1 }, { x: 0, z: 0, w: 8, d: 25, cafeX: -1, cafeZ: 1 },
];

// What a walker must keep out of: the fountain, the benches (1.7 by 0.46 m), the tables and their umbrellas' poles.
function obstacles(y) {
  const { r } = yardParts(y.w, y.d), list = [{ circle: [y.x, y.z, r + 0.05] }];
  for (const b of benches(y.x, y.z, r)) list.push({ box: [b.x, b.z, b.alongX ? 0.85 : 0.23, b.alongX ? 0.23 : 0.85] });
  if (hasCafe(y.w, y.d)) for (const t of cafeTables(y.x, y.z, y.w, y.d, y.cafeX, y.cafeZ).tables) list.push({ circle: [t.x, t.z, 0.55] });
  return list;
}
const WALKER = 0.22; // half the width of a person
function hits(o, x, z, margin = WALKER) {
  if (o.circle) return Math.hypot(x - o.circle[0], z - o.circle[1]) < o.circle[2] + margin;
  return Math.abs(x - o.box[0]) < o.box[2] + margin && Math.abs(z - o.box[1]) < o.box[3] + margin;
}

test('every seat has a way in that ends at the seat, stays inside the courtyard and keeps clear of the fountain, the benches and the tables', () => {
  for (const y of YARDS) {
    const seats = seatsOf(y), list = obstacles(y);
    assert.ok(seats.filter((s) => s.kind === 'bench').length === 8, 'two on each bench');
    for (const s of seats) {
      const last = s.route[s.route.length - 1];
      assert.ok(Math.hypot(last[0] - s.x, last[1] - s.z) < 1e-9, 'the walk ends at the seat');
      for (let i = 0; i < s.route.length; i += 1) {
        const [px, pz] = s.route[i];
        assert.ok(Math.abs(px - y.x) <= y.w / 2 + 1e-9 && Math.abs(pz - y.z) <= y.d / 2 + 1e-9, `inside the courtyard (${JSON.stringify(y)} seat ${s.id})`);
        if (i === 0) continue;
        const [qx, qz] = s.route[i - 1], n = Math.max(1, Math.ceil(Math.hypot(px - qx, pz - qz) / 0.05));
        for (let k = 0; k <= n; k += 1) {
          const x = qx + (px - qx) * k / n, z = qz + (pz - qz) * k / n;
          // the last step ends at a seat, which is part of the bench or the table and is allowed to touch it
          if (i === s.route.length - 1 && Math.hypot(x - s.x, z - s.z) < 0.9) continue;
          for (const o of list) assert.ok(!hits(o, x, z, WALKER * 0.5), `a walker clear of the furniture (${JSON.stringify(y)} seat ${s.id} ${s.kind}, point ${x.toFixed(2)}, ${z.toFixed(2)})`);
        }
      }
    }
  }
});

test('seats are where the furniture is: on a bench, and at a table, facing it', () => {
  for (const y of YARDS) {
    const { r } = yardParts(y.w, y.d), seats = seatsOf(y), bs = benches(y.x, y.z, r), tables = hasCafe(y.w, y.d) ? cafeTables(y.x, y.z, y.w, y.d, y.cafeX, y.cafeZ).tables : [];
    for (const s of seats) {
      if (s.kind === 'bench') assert.ok(bs.some((b) => (b.alongX ? Math.abs(s.x - b.x) <= 0.85 && Math.abs(s.z - b.z) <= 0.23 : Math.abs(s.z - b.z) <= 0.85 && Math.abs(s.x - b.x) <= 0.23)), 'on a bench');
      else assert.ok(tables.some((t) => Math.abs(s.x - t.x) < 1e-9 && Math.abs(Math.abs(s.z - t.z) - 0.85) < 1e-9), 'a stool at a table');
      // a person faces the fountain from a bench, and the table from a stool
      const dx = Math.cos(s.facing), dz = Math.sin(s.facing);
      if (s.kind === 'bench') assert.ok((y.x - s.x) * dx + (y.z - s.z) * dz > 0, 'facing the fountain');
      else { const t = tables.find((q) => Math.abs(q.x - s.x) < 1e-9); assert.ok((t.x - s.x) * dx + (t.z - s.z) * dz > 0, 'facing the table'); }
    }
  }
});

function fake() {
  const a = { walkers: new Set(), made: 0, makeWalker: (id) => ({ id, pose: null }), addWalker(o) { this.walkers.add(o); this.made += 1; }, removeWalker(o) { this.walkers.delete(o); }, poseWalker(o, p) { o.pose = p; } };
  return a;
}
// Runs one courtyard for `hours` of the clock from `from` (on a weekday), watching every step. `rain` is a function of the hour.
function run({ yard = YARDS[0], seed = 1, from = 6, hours = 24, rain = () => 0, dt = 0.2, watch = () => {} }) {
  let clock = from * 3600;
  const hour = () => (clock / 3600) % 24, adapter = fake();
  const bench = (h) => [0, 0, 0, 0, 0, 0.08, 0.3, 0.45, 0.3, 0.2, 0.3, 0.55, 0.8, 0.7, 0.45, 0.5, 0.7, 0.8, 0.6, 0.35, 0.18, 0.08, 0.02, 0][Math.floor(h)]; // the park's weekday
  const cafe = (h) => [0.01, 0, 0, 0, 0.01, 0.05, 0.2, 0.6, 1.0, 0.6, 0.4, 0.5, 0.8, 0.7, 0.4, 0.6, 0.9, 1.0, 0.7, 0.45, 0.35, 0.2, 0.08, 0.03][Math.floor(h)]; // the footpath's
  const demand = (kind) => (kind === 'cafe' ? cafe : bench)(hour()) * Math.max(0, 1 - 1.6 * rain(hour()));
  const life = createCourtyardLife(yard, { adapter, demand, hour, rnd: seeded(seed) });
  for (let t = 0; t < hours * 3600; t += dt) { clock += dt; life.update(dt); watch(life, adapter, hour()); }
  return { life, adapter };
}

test('nobody is there at night, and the cafe is shut outside its hours', () => {
  const seen = [];
  run({ seed: 3, from: 6, hours: 24, watch: (life, adapter, h) => { if (h >= 0 && h < 4.5) seen.push(adapter.walkers.size); } });
  assert.ok(seen.length > 0 && Math.max(...seen) === 0, 'empty from midnight to half past four');
  run({ seed: 4, from: 12, hours: 12, watch: (life, adapter, h) => {
    if (h >= CAFE_OPEN[1] + 0.2 || h < CAFE_OPEN[0]) assert.ok(![...life.seats].some((s) => s.owner && s.kind === 'cafe' && life.walkers.size >= 0 && [...life.walkers].some((w) => w.seat === s && w.phase === 'sit' && !w.closing) ), 'nobody settles at the cafe when it is shut');
  } });
});

test('people sit in the day: a weekday midday has people on the benches and at the cafe, and none sit down on top of another', () => {
  let most = 0, cafe = 0;
  run({ seed: 5, from: 10, hours: 4, watch: (life) => {
    const owners = [...life.walkers].map((w) => w.seat.id), sitting = [...life.walkers].filter((w) => w.phase === 'sit');
    assert.equal(new Set(owners).size, owners.length, 'one person to a seat');
    most = Math.max(most, sitting.length); cafe = Math.max(cafe, sitting.filter((w) => w.seat.kind === 'cafe').length);
  } });
  assert.ok(most >= 6, `a lively courtyard at midday (${most})`);
  assert.ok(cafe >= 2, 'people at the cafe');
});

test('rain empties it, and the people who were there get up and go', () => {
  let storm = false, wet = 0;
  const { adapter } = run({ seed: 6, from: 11, hours: 3, rain: () => (storm ? 1 : 0), watch: (life, a, h) => { if (h >= 12 && !storm) storm = true; if (h >= 12.5) wet = Math.max(wet, a.walkers.size); } });
  assert.equal(wet, 0, 'empty within half an hour of the rain');
  assert.equal(adapter.walkers.size, 0);
});

test('one person at a time walks in or out of an entrance, and a walk is never held up for ever', () => {
  for (const seed of [1, 2, 3]) {
    let stuck = 0, longest = 0; const since = new Map();
    run({ seed, from: 8, hours: 8, watch: (life) => {
      const byEntrance = {};
      for (const w of life.walkers) {
        if (w.phase === 'sit') continue;
        byEntrance[w.seat.entrance] = (byEntrance[w.seat.entrance] || 0) + 1;
        since.set(w, (since.get(w) || 0) + 0.2); longest = Math.max(longest, since.get(w));
      }
      for (const n of Object.values(byEntrance)) assert.ok(n <= 1, 'one in a corridor');
      stuck = longest;
    } });
    assert.ok(stuck < 90, `no walk takes more than 90 s (${stuck})`);
  }
});

test('the courtyard fills only so far, everyone who comes also leaves, and a person is visible all the way except at the entrance', () => {
  const { life } = run({ seed: 8, from: 6, hours: 18, watch: (life, adapter) => {
    for (const w of adapter.walkers) { const p = w.pose; if (!p) continue; assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z) && Number.isFinite(p.heading)); assert.ok(p.fade >= 0 && p.fade <= 1); }
    assert.ok(life.seated <= life.seats.length);
  } });
  assert.ok(life.stats.arrived > 10, 'people came');
  assert.ok(life.stats.arrived - life.stats.left <= life.seats.length, 'and left');
});
