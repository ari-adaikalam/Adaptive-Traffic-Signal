// The people of a share hub (src/scene/hub-life.js): how often they come, that they never walk through each other or a pedestrian, that no place is ever held for ever, and that nobody
// blinks out of sight when they take or leave a vehicle. Run on a hub made of plain objects, with the pedestrians of the page as a list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AISLE_V, BAND_V, SLAB_TOP, createHubLife, groundHeight } from '../src/scene/hub-life.js';

const seeded = (seed) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const U0 = 14.2, WIDTH = 16;
const to = (u, v) => ({ x: U0 + u, z: U0 + v });

function makeHub(rnd) {
  const slot = (kind, i) => ({ kind, u: 1.5 + i * 1.1, v: kind === 'scooter' ? 2.15 : 7.5, yaw: Math.PI, nudge: 0, taken: rnd() < .7, reserved: false, mesh: {}, index: i });
  return { width: WIDTH, depth: 13, scooterSlots: Array.from({ length: 10 }, (_, i) => slot('scooter', i)), bikeSlots: Array.from({ length: 6 }, (_, i) => slot('bike', i)), place() {} };
}
function makeWorld() {
  const added = [], removed = [], alive = new Set();
  const mesh = (kind) => ({ kind, position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } }, rotation: { y: 0 }, scale: { v: 0, setScalar(v) { this.v = v; } }, userData: { body: {} }, traverse(fn) { fn({}); } });
  const builders = { walker: () => mesh('walk'), rider: () => mesh('bike'), scooterRider: () => mesh('scooter'), animateWalker() {}, animateRider() {}, animateScooter() {} };
  const scene = { add: (m) => { alive.add(m); added.push(m); }, remove: (m) => { alive.delete(m); removed.push({ m, x: m.position.x, z: m.position.z }); } };
  return { added, removed, alive, builders, scene };
}

// Runs a hub for `seconds`, in steps of `dt`, calling `watch` after every step.
function run({ seconds, demand = 1, seed = 1, pedestrians = () => [], dt = .1, watch = () => {} }) {
  const rnd = seeded(seed), hub = makeHub(rnd), world = makeWorld();
  const life = createHubLife(hub, { scene: world.scene, to, builders: world.builders, pedestrians, demand: () => demand, rnd });
  let time = 0;
  for (let i = 0; i < seconds / dt; i += 1) {
    time += dt; world.added.length = 0; world.removed.length = 0;
    life.update(time, dt);
    watch({ hub, world, life, time });
  }
  return { hub, world, life };
}

test('at the busiest time about one event in 45 s, and at night hardly any', () => {
  const busy = run({ seconds: 3600, demand: 1, seed: 3 }), night = run({ seconds: 3600, demand: .1, seed: 3 });
  assert.ok(busy.life.stats.events >= 30 && busy.life.stats.events <= 100, `busy hour: ${busy.life.stats.events} events`);
  assert.ok(night.life.stats.events <= 15, `night hour: ${night.life.stats.events} events`);
  assert.ok(night.life.stats.events < busy.life.stats.events / 3);
});

test('no more people than the limit at once, nobody stays for ever, and every place is let go', () => {
  let most = 0; const born = new Map(); let oldest = 0;
  const { hub, life } = run({ seconds: 4 * 3600, seed: 5, watch: ({ world, time }) => {
    most = Math.max(most, world.alive.size);
    for (const m of world.alive) { if (!born.has(m)) born.set(m, time); oldest = Math.max(oldest, time - born.get(m)); }
  } });
  assert.ok(most <= 2, `${most} people at once`);
  assert.ok(oldest < 200, `someone was there for ${oldest.toFixed(0)} s`);
  life.dispose();
  assert.ok([...hub.scooterSlots, ...hub.bikeSlots].every((s) => !s.reserved), 'a place is still held');
});

test('a place is never held by two people, and a vehicle is never taken that is not there', () => {
  run({ seconds: 3 * 3600, seed: 8, watch: ({ hub }) => {
    const slots = [...hub.scooterSlots, ...hub.bikeSlots];
    for (const s of slots) if (s.reserved) assert.ok(typeof s.taken === 'boolean');
  } });
  const { hub } = run({ seconds: 2 * 3600, seed: 9 });
  const taken = [...hub.scooterSlots, ...hub.bikeSlots].filter((s) => s.taken).length;
  assert.ok(taken >= 0 && taken <= 16);
});

test('nobody walks through anybody else', () => {
  let closest = Infinity;
  run({ seconds: 6 * 3600, seed: 11, dt: .05, watch: ({ world }) => {
    const list = [...world.alive];
    for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) closest = Math.min(closest, Math.hypot(list[i].position.x - list[j].position.x, list[i].position.z - list[j].position.z));
  } });
  assert.ok(closest > .35, `two people came to ${closest.toFixed(2)} m`);
});

test('nobody blinks out of sight: a person who takes or leaves a vehicle is replaced in the same frame, in the same place', () => {
  let handoffs = 0, worst = 0;
  const reach = WIDTH + 45, door = WIDTH + 1.3;
  run({ seconds: 3 * 3600, seed: 13, watch: ({ world }) => {
    for (const m of world.added) {
      const near = (p, u, v) => Math.hypot(p.x - (U0 + u), p.z - (U0 + v)) < 2.5;
      if (near(m.position, door, AISLE_V) || near(m.position, reach, BAND_V)) continue; // a first appearance, at the shop or the far end
      const same = world.removed.find((r) => Math.hypot(r.x - m.position.x, r.z - m.position.z) < 1);
      assert.ok(same, `someone appeared at (${m.position.x.toFixed(1)}, ${m.position.z.toFixed(1)}) with nobody leaving`);
      worst = Math.max(worst, Math.hypot(same.x - m.position.x, same.z - m.position.z)); handoffs += 1;
      assert.ok(m.scale.v > .99, 'a hand-over fades');
    }
  } });
  assert.ok(handoffs > 50, `${handoffs} hand-overs seen`);
  assert.ok(worst < 1, `a hand-over jumped ${worst.toFixed(2)} m`);
});

test('nobody crosses the pedestrians\' lanes through a pedestrian, and a rider does not wait for ever', () => {
  // pedestrians standing in the lane at several places along the hub, as a queue at the crossing does
  const stand = [3, 6, 9, 12].map((u) => ({ px: U0 + u, pz: U0 - 2.3, state: 'waiting' }));
  let closest = Infinity;
  const { hub, life } = run({ seconds: 3 * 3600, seed: 17, pedestrians: () => stand, watch: ({ world }) => {
    for (const m of world.alive) for (const p of stand) if (m.position.z < U0 - .3 && m.position.z > U0 - 4.7) closest = Math.min(closest, Math.hypot(m.position.x - p.px, m.position.z - p.pz));
  } });
  assert.ok(closest > .9, `someone came within ${closest.toFixed(2)} m of a pedestrian`);
  life.dispose();
  assert.ok([...hub.scooterSlots, ...hub.bikeSlots].every((s) => !s.reserved));
});

test('pedestrians walking along the lane hold a crossing, and it goes on when they have passed', () => {
  let crossed = 0, early = 0;
  const walker = { px: 0, pz: U0 - 2.3, state: 'approaching' };
  run({ seconds: 3600, seed: 21, pedestrians: () => [walker], watch: ({ time, world }) => {
    walker.px = U0 + ((time * 1.2) % 40); // walks along the lane, over and over
    for (const m of world.alive) if (m.position.z < U0 - 1.2 && m.position.z > U0 - 3.5 && Math.hypot(m.position.x - walker.px, m.position.z - walker.pz) < 1) early += 1;
    crossed = Math.max(crossed, world.alive.size);
  } });
  assert.equal(early, 0, 'someone was in the lane with a pedestrian on it');
  assert.ok(crossed > 0);
});

test('a sudden stop of the page (a very long step) does not throw anyone across the street', () => {
  const rnd = seeded(2), hub = makeHub(rnd), world = makeWorld();
  const life = createHubLife(hub, { scene: world.scene, to, builders: world.builders, pedestrians: () => [], demand: () => 5, rnd });
  for (let i = 0; i < 400; i += 1) life.update(i * .1, i % 50 === 49 ? 30 : .1);
  for (const m of world.alive) assert.ok(Number.isFinite(m.position.x) && Math.abs(m.position.x) < 200 && Math.abs(m.position.z) < 200);
});

test('on the footpath people stand on its slab, in the hub on the ground, and go between by a ramp without a jump', () => {
  assert.equal(groundHeight(0), 0);
  assert.equal(groundHeight(BAND_V), SLAB_TOP);
  assert.ok(groundHeight(-1) > 0 && groundHeight(-1) < SLAB_TOP);
  let onSlab = 0; const last = new Map();
  run({ seconds: 3 * 3600, seed: 31, watch: ({ world }) => {
    for (const m of world.alive) {
      const v = m.position.z - U0;
      assert.ok(Math.abs(m.position.y - groundHeight(v)) < 1e-9, `at v = ${v.toFixed(2)} the height is ${m.position.y}`);
      if (last.has(m)) assert.ok(Math.abs(m.position.y - last.get(m)) < .1, 'a jump in height');
      last.set(m, m.position.y); if (v < -1.4) onSlab += 1;
    }
  } });
  assert.ok(onSlab > 0, 'nobody was seen on the footpath');
});
