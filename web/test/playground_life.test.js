// The playground (src/scene/playground-layout.js and playground-life.js): a swing moves only with a child on it, a child is always where the equipment is, and nothing is held for ever.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SLIDE, SWING, chute, chuteAt, obstacles, seatTop, swingStand } from '../src/scene/playground-layout.js';
import { createPlayLife } from '../src/scene/playground-life.js';

const seeded = (seed) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;

test('with nobody on them the swings hang still, exactly, however long it runs', () => {
  const life = createPlayLife({ rnd: seeded(1) });
  for (let i = 0; i < 20000; i += 1) life.update(0.05);
  for (let i = 0; i < SWING.seats.length; i += 1) assert.equal(life.swingAngle(i), 0);
});

test('a swing builds up under a child and slows to a stop once the child is ready to get off, and the child waits for it', () => {
  const life = createPlayLife({ rnd: seeded(2) });
  let errand; do errand = life.errand(); while (errand && errand.type !== 'swing');
  assert.ok(errand, 'a swing was offered');
  const act = life.begin(errand), i = errand.i;
  let peak = 0, left = null, t = 0;
  while (!act.done && t < 200) {
    const pose = life.step(act, 0.05); life.update(0.05); t += 0.05;
    peak = Math.max(peak, Math.abs(life.swingAngle(i)));
    if (act.phase === 'off' && left === null) left = life.swings[i].amp;
    assert.ok(pose.mode === 'sit' || pose.mode === 'stand');
    if (pose.blend === 1) assert.ok(pose.mode === 'sit', 'on the seat the child sits');
  }
  assert.ok(act.done, 'the turn ended');
  assert.ok(peak > 0.4, `it only reached ${peak.toFixed(2)} rad`);
  assert.ok(left < 0.1, `the child got off at ${left} rad`);
  life.release(act);
  for (let k = 0; k < 400; k += 1) life.update(0.05);
  assert.equal(life.swingAngle(i), 0, 'and it came to rest');
});

test('one child at a time on each piece, and the places are given back', () => {
  const life = createPlayLife({ rnd: seeded(3) });
  const got = [];
  for (let k = 0; k < 10; k += 1) { const e = life.errand(); if (e) got.push(e); }
  assert.equal(got.filter((e) => e.type === 'slide').length, 1, 'one slide');
  assert.equal(new Set(got.filter((e) => e.type === 'swing').map((e) => e.i)).size, got.filter((e) => e.type === 'swing').length, 'a swing is never offered twice');
  assert.equal(got.length, SWING.seats.length + 1);
  assert.equal(life.errand(), null, 'everything is in use');
  for (const e of got) life.release(e);
  assert.ok(life.errand(), 'and free again when the children are done');
});

// Runs a turn on the slide, calling `look` with each pose.
function slideTurn(look) {
  const life = createPlayLife({ rnd: seeded(4) });
  let e; do { e = life.errand(); if (e && e.type !== 'slide') { life.release(e); e = null; } } while (!e);
  const act = life.begin(e); let t = 0, last = null;
  while (!act.done && t < 60) { const pose = life.step(act, 0.05); t += 0.05; look(pose, last, act); last = pose; }
  assert.ok(act.done, 'the turn on the slide ended');
  return { t, life, act };
}

test('a child on the slide moves smoothly: no jumps, never under the ground, and on the chute while sliding', () => {
  const c = chute();
  let worst = 0, slid = 0;
  const { t } = slideTurn((pose, last, act) => {
    assert.ok(pose.y >= -1e-9, 'under the ground');
    if (last) worst = Math.max(worst, Math.hypot(pose.u - last.u, pose.v - last.v, pose.y - last.y));
    if (act.phase === 'slide') { // on the chute surface: the height is the surface's at that distance along
      slid += 1; const x = pose.u - (2.2), p = chuteAt((x - c.x0) / Math.cos(c.angle));
      assert.ok(Math.abs(pose.y - p.y) < 1e-6, `off the chute by ${Math.abs(pose.y - p.y)}`);
      assert.ok(Math.abs(pose.pitch + c.angle) < 1e-9, 'the child lies along the chute');
    }
  });
  assert.ok(worst < 0.2, `a jump of ${worst.toFixed(2)} m in 0.05 s`);
  assert.ok(slid > 10, 'the child slid');
  assert.ok(t > 6 && t < 14, `a turn of ${t.toFixed(1)} s`);
});

test('the child starts on the ground at the foot of the ladder, ends on the ground past the chute, and the chute is sound', () => {
  let first = null, final = null;
  slideTurn((pose) => { first = first || pose; final = pose; });
  assert.ok(Math.abs(first.y) < 0.05, 'starts on the ground');
  assert.ok(Math.abs(final.y) < 1e-9, 'ends on the ground');
  const c = chute();
  assert.ok(c.angle > 0.25 && c.angle < 0.6, `the chute is at ${(c.angle * 180 / Math.PI).toFixed(0)} degrees`);
  assert.ok(Math.abs(chuteAt(c.length).y - SLIDE.exitY) < 1e-9, 'it ends at the exit height');
  assert.ok(final.u > 2.2 + c.x0 + SLIDE.run - 0.5, 'past the end of the chute');
});

test('the seat is where the swing hangs, and a child stands behind it', () => {
  assert.ok(seatTop() < -1.5 && seatTop() > -2.2);
  for (let i = 0; i < SWING.seats.length; i += 1) assert.ok(swingStand(i).u < -3.5 - 0.5, 'behind the seat');
  for (const [u, v, r] of obstacles()) assert.ok(Number.isFinite(u + v + r) && r > 0);
});
