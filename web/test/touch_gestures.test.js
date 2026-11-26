// The two-finger gestures: each movement of the fingers must change only what it means. See src/scene/touch-gestures.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { measure, step } from '../src/scene/touch-gestures.js';

const at = (a, b) => measure({ x: a[0], y: a[1] }, { x: b[0], y: b[1] });
const gesture = (from, to) => step(at(...from), at(...to));
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} is not ${b}`);

test('a pinch apart zooms in and changes nothing else', () => {
  const d = gesture([[150, 400], [250, 400]], [[100, 400], [300, 400]]);
  near(d.zoom, 0.5); near(d.twist, 0); assert.equal(d.pan, 0); assert.equal(d.tilt, 0);
});

test('a pinch together zooms out', () => {
  assert.ok(gesture([[100, 400], [300, 400]], [[150, 400], [250, 400]]).zoom > 1);
});

test('a twist turns the view and does not zoom, pan or tilt', () => {
  const a = 30 * Math.PI / 180, r = 100;
  const d = gesture([[200 - r, 400], [200 + r, 400]], [[200 - r * Math.cos(a), 400 - r * Math.sin(a)], [200 + r * Math.cos(a), 400 + r * Math.sin(a)]]);
  near(d.twist, a, 1e-6); near(d.zoom, 1, 1e-6); assert.ok(Math.abs(d.pan) < 1e-6); assert.equal(d.tilt, 0);
});

test('a twist the other way round the circle is the short way, not 340 degrees', () => {
  const r = 100, d = gesture([[200 - r, 399], [200 + r, 401]], [[200 - r, 401], [200 + r, 399]]); // the line crosses the -pi / pi seam
  assert.ok(Math.abs(d.twist) < 0.1, `twist ${d.twist}`);
});

test('two fingers swiping down tilt, and do not pan, zoom or turn', () => {
  const d = gesture([[150, 400], [250, 400]], [[150, 440], [250, 440]]);
  assert.equal(d.tilt, 40); assert.equal(d.pan, 0); near(d.zoom, 1); near(d.twist, 0);
});

test('two fingers swiping up tilt the other way', () => {
  assert.equal(gesture([[150, 400], [250, 400]], [[150, 360], [250, 360]]).tilt, -40);
});

test('two fingers dragging sideways pan, and do not tilt', () => {
  const d = gesture([[150, 400], [250, 400]], [[190, 400], [290, 400]]);
  assert.equal(d.pan, 40); assert.equal(d.tilt, 0); near(d.zoom, 1); near(d.twist, 0);
});

test('a slanted drag is a pan, and a little drift while pinching is not a tilt', () => {
  assert.equal(gesture([[150, 400], [250, 400]], [[190, 410], [290, 410]]).tilt, 0);
  const pinch = gesture([[150, 400], [250, 400]], [[110, 404], [290, 404]]);
  assert.equal(pinch.tilt, 0); assert.ok(pinch.zoom < 1);
});

test('fingers that are almost on top of each other say nothing about zoom or turning', () => {
  const d = gesture([[200, 400], [203, 400]], [[190, 400], [210, 400]]);
  assert.equal(d.zoom, 1); assert.equal(d.twist, 0);
});
