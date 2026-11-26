// The grid that keeps the viewpoint away from solid things (src/scene/clearance.js), on small scenes made by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closest, collectTriangles, createTriangleGrid } from '../src/scene/clearance.js';

// A wall in the plane x = 10, from z = -5 to 5 and y = 0 to 6, as two triangles.
const wall = new Float32Array([10, 0, -5, 10, 6, -5, 10, 0, 5, 10, 6, -5, 10, 6, 5, 10, 0, 5]);
const grid = (tris, r = 2.2) => { const g = createTriangleGrid(tris, r); g.build(); return g; };
const at = (x, y, z) => ({ x, y, z });

test('a point close to a wall is moved straight back to the clearance, and one far away is left alone', () => {
  const g = grid(wall);
  const near = at(9, 3, 0); assert.equal(g.push(near), true);
  assert.ok(Math.abs(near.x - 7.8) < 1e-6 && near.y === 3 && near.z === 0, JSON.stringify(near));
  const far = at(5, 3, 0); assert.equal(g.push(far), false); assert.deepEqual(far, at(5, 3, 0));
});

test('a point beside the wall slides along it, round the end, with no jump', () => {
  const g = grid(wall);
  let last = null;
  for (let z = 0; z <= 12; z += 0.25) { // walks along the wall 1 m from it and on past its end
    const p = at(9, 3, z); g.push(p);
    if (last) assert.ok(Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z) < 0.6, `jump at z ${z}`);
    assert.ok(g.nearest(p) > 2.2 - 1e-6, `too close at z ${z}`);
    last = p;
  }
});

test('a triangle with no area, or a point exactly on a surface, never makes a bad number', () => {
  const line = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]); // three corners in a line
  const point = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  for (const tris of [line, point, wall]) {
    const g = grid(tris);
    for (const p of [at(1, 0, 0), at(0, 0, 0), at(10, 3, 0), at(1, 1, 1)]) { g.push(p); assert.ok(Number.isFinite(p.x + p.y + p.z), JSON.stringify(p)); }
  }
});

test('a big sheet that spans a whole street is a surface and is left out, and the grid says when it is built', () => {
  const sheet = new Float32Array([-100, 0, -100, 100, 0, -100, -100, 0, 100]);
  const g = createTriangleGrid(new Float32Array([...sheet, ...wall]), 2.2);
  assert.equal(g.done, false);
  assert.equal(g.build(1), false); assert.equal(g.build(10), true); assert.equal(g.done, true);
  const p = at(0, 0.1, 0); assert.equal(g.push(p), false);
});

// Against brute force: on random small triangles, a point is moved exactly when some triangle is within the clearance of it, and is then at least that far from all of them.
test('the grid finds every triangle that is within the clearance, as brute force does', () => {
  let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const triangles = new Float32Array(9 * 400);
  for (let i = 0; i < 400; i += 1) { const cx = (rnd() - .5) * 120, cy = rnd() * 8, cz = (rnd() - .5) * 120; for (let c = 0; c < 3; c += 1) { triangles[i * 9 + c * 3] = cx + (rnd() - .5) * 5; triangles[i * 9 + c * 3 + 1] = cy + (rnd() - .5) * 3; triangles[i * 9 + c * 3 + 2] = cz + (rnd() - .5) * 5; } }
  const radius = 2.2, g = createTriangleGrid(triangles, radius); g.build();
  const into = [0, 0, 0], brute = (p) => { let best = Infinity; for (let t = 0; t < 400; t += 1) { closest(triangles, t * 9, p.x, p.y, p.z, into); best = Math.min(best, Math.hypot(p.x - into[0], p.y - into[1], p.z - into[2])); } return best; };
  let moved = 0;
  for (let i = 0; i < 2000; i += 1) {
    const p = at((rnd() - .5) * 130, rnd() * 10, (rnd() - .5) * 130), before = brute(p), did = g.push(p);
    if (before >= radius + 1e-6) assert.equal(did, false, `moved a point that was ${before.toFixed(2)} m from everything`);
    if (before < radius - 1e-3) { assert.equal(did, true, `did not move a point ${before.toFixed(2)} m from a triangle`); moved += 1; }
  }
  assert.ok(moved > 100, `only ${moved} points were near a triangle`);
});

test('collecting triangles into the typed array loses and invents none', () => {
  // a fake scene of two meshes (one instanced twice) in the shape collectTriangles reads
  const THREE = { Vector3: class { constructor() { this.x = this.y = this.z = 0; } fromBufferAttribute(a, i) { this.x = a.array[i * 3]; this.y = a.array[i * 3 + 1]; this.z = a.array[i * 3 + 2]; return this; } applyMatrix4() { return this; } }, Matrix4: class { copy() { return this; } multiplyMatrices() { return this; } } };
  const geometry = (tris) => ({ attributes: { position: { array: tris, count: tris.length / 3 } }, index: null });
  const mesh = (tris, extra = {}) => ({ isMesh: true, visible: true, geometry: geometry(tris), material: {}, matrixWorld: {}, ...extra });
  const scene = { updateMatrixWorld() {}, traverse(fn) { fn(mesh(wall)); fn(mesh(wall, { isInstancedMesh: true, count: 2, getMatrixAt() {} })); fn(mesh(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0.1, 1]))); } }; // the last has no point above 0.4: it is ground
  const out = collectTriangles(scene, THREE);
  assert.equal(out.length, 9 * 6, 'two walls of two triangles each, and a second wall twice'); // 2 + 2 * 2, and the ground left out
});
