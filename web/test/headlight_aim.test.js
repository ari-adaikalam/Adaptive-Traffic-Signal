import test from 'node:test';
import assert from 'node:assert/strict';
import { blocked, pickBeams } from '../src/scene/headlight-aim.js';

const lamp = (id, x, z, yaw = 0, extra = {}) => ({ id, x, z, yaw, start: 2.2, reach: 17, spread: 0.3, extra: 0.5, ...extra }); // facing +x at yaw 0
const body = (id, x, z, yaw = 0, length = 4.5, width = 1.9) => ({ id, x, z, yaw, length, width });
const run = (attackers, bodies, targets) => pickBeams(attackers, bodies, targets || bodies);

test('a vehicle straight ahead is lit by the beam behind it', () => {
  const r = run([lamp(1, 0, 0)], [body(1, 0, 0), body(2, 9, 0)]);
  assert.equal(r.get(2).length, 1);
  assert.equal(r.get(2)[0].from, 1);
  assert.equal(r.has(1), false, 'a vehicle is not lit by its own beam');
});

test('a vehicle that is only partly in the cone is lit, and one outside it is not', () => {
  const edge = run([lamp(1, 0, 0)], [body(1, 0, 0), body(2, 9, 2.6)]);
  assert.ok(edge.has(2), 'the near side of it is in the cone');
  const outside = run([lamp(1, 0, 0)], [body(1, 0, 0), body(2, 9, 7)]);
  assert.equal(outside.has(2), false);
});

test('a vehicle waiting at an angle to a turning vehicle is lit, as the beam swings across it', () => {
  // the turning vehicle faces 40 degrees to the left of +x, the other stands at its side of the junction facing across
  const yaw = 40 * Math.PI / 180;
  const r = run([lamp(1, 0, 0, yaw)], [body(1, 0, 0, yaw), body(2, 7, -5.6, Math.PI / 2)]);
  assert.ok(r.has(2));
});

test('a vehicle behind another is in its shadow, and a person behind a vehicle is not lit', () => {
  const r = run([lamp(1, 0, 0)], [body(1, 0, 0), body(2, 7, 0), body(3, 13, 0)]);
  assert.ok(r.has(2));
  assert.equal(r.has(3), false, 'the third in the queue gets no light from the first');
  const person = { id: 'p', x: 12, z: 0, yaw: 0, length: .6, width: .6 };
  assert.equal(run([lamp(1, 0, 0)], [body(1, 0, 0), body(2, 7, 0)], [person]).has('p'), false);
  assert.ok(run([lamp(1, 0, 0)], [body(1, 0, 0)], [person]).has('p'), 'with nothing in the way, the person is lit');
});

test('an oncoming vehicle and the vehicle behind both light the one in front, no more than two', () => {
  const r = run([lamp(1, -9, 0, 0), lamp(3, 25, 0, Math.PI), lamp(4, -16, 0, 0)], [body(1, -9, 0, 0), body(2, 8, 0, 0), body(3, 25, 0, Math.PI), body(4, -16, 0, 0)], [body(2, 8, 0, 0)]);
  const lit = r.get(2);
  assert.equal(lit.length, 2);
  assert.deepEqual(new Set(lit.map((b) => b.from)), new Set([1, 3]));
});

test('a long body crossing in front is lit where the beam falls on it', () => {
  assert.ok(run([lamp(1, 0, 0)], [body(1, 0, 0), body(2, 8, 0, Math.PI / 2, 12, 2.5)]).has(2));
});

test('light fades to nothing at the end of the reach and does not reach past it', () => {
  const near = run([lamp(1, 0, 0)], [body(1, 0, 0), body(2, 6, 0)]).get(2)[0].score, far = run([lamp(1, 0, 0)], [body(1, 0, 0), body(2, 16, 0)]).get(2)[0].score;
  assert.ok(near > far);
  assert.equal(run([lamp(1, 0, 0)], [body(1, 0, 0), body(2, 30, 0)]).has(2), false);
});

test('nothing behind the lamp is lit', () => {
  assert.equal(run([lamp(1, 0, 0)], [body(1, 0, 0), body(2, -9, 0)]).has(2), false);
});

test('the shadow test follows the body when it is turned', () => {
  assert.equal(blocked(-5, 0, 5, 0, body(9, 0, 0, 0, 4, 2)), true);
  assert.equal(blocked(-5, 3, 5, 3, body(9, 0, 0, 0, 4, 2)), false);
  assert.equal(blocked(0, -5, 0, 5, body(9, 0, 0, Math.PI / 2, 4, 2)), true);
  assert.equal(blocked(0, -5, 0, -2.5, body(9, 0, 0, Math.PI / 2, 4, 2)), false, 'a segment that stops short of the body does not pass through it');
});

import { beamFree, easeBeam, rayDistance } from '../src/scene/headlight-aim.js';

test('the beam on the road ends at the first body that the ray from the lamp enters, and a body beside it does not shorten it', () => {
  const lampAt = { x: 2.2, z: 0, dx: 1, dz: 0, reach: 17 };
  assert.ok(Math.abs(beamFree(lampAt, [body(2, 9, 0)], 1) - (9 - 2.25 + .1 - 2.2)) < 0.01, 'ends at the near end of the body');
  assert.equal(beamFree(lampAt, [body(2, 9, 3)], 1), 17, 'a vehicle in the next lane does not shorten it');
  assert.equal(beamFree(lampAt, [body(2, -9, 0)], 1), 17, 'one behind does not');
  assert.equal(beamFree({ ...lampAt, x: 9, z: 0 }, [body(2, 9, 0)], 1), 17, 'a body the lamp is already inside is ignored, so the beam does not collapse');
});

test('the vehicle that shortens the beam is the vehicle that is lit', () => {
  const at = lamp(1, 0, 0), bodies = [body(1, 0, 0), body(2, 8, 0.5, 0.3)];
  const l = { x: at.x + at.start, z: 0, dx: 1, dz: 0, reach: 17 };
  assert.ok(beamFree(l, bodies, 1) < 17);
  assert.ok(pickBeams([at], bodies, bodies).has(2));
});

test('the beam length follows its target smoothly: it shortens fast, lengthens slowly and never jumps', () => {
  let x = 17; const steps = [];
  for (let i = 0; i < 12; i += 1) { x = easeBeam(x, 4, 1 / 60); steps.push(x); }
  assert.ok(steps[0] < 17 && steps[0] > 4, 'not an instant cut');
  assert.ok(steps[11] < 9, 'and quick');
  let y = 4; const up = [];
  for (let i = 0; i < 12; i += 1) { y = easeBeam(y, 17, 1 / 60); up.push(y); }
  assert.ok(up[11] < 12 && (17 - up[11]) / 13 > (steps[11] - 4) / 13, 'slower to come back than it went');
  assert.ok(Math.max(...up.map((v, i) => Math.abs(v - (up[i - 1] ?? 4)))) < 2.5, 'no jump');
  assert.equal(easeBeam(5, 9, 0), 5);
});
