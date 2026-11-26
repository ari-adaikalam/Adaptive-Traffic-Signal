// Where the footpath slab is under a person's feet (src/scene/footpath.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SLAB_TOP, footpathHeight, onSlab } from '../src/scene/footpath.js';

test('the footpaths beside the four roads are slab, and the road and the blocks are not', () => {
  for (const [x, z] of [[11, 50], [-11, 50], [11, -50], [-11, -50], [50, 11], [50, -11], [-50, 11], [-50, -11]]) assert.equal(footpathHeight(x, z), SLAB_TOP, `${x}, ${z}`);
  for (const [x, z] of [[0, 50], [4.8, 80], [50, 3], [-50, -3], [0, 0], [5, 5]]) assert.equal(footpathHeight(x, z), 0, `road ${x}, ${z}`);
  for (const [x, z] of [[30, 30], [20, 50], [-40, 25], [14, 60]]) assert.equal(footpathHeight(x, z), 0, `block ${x}, ${z}`);
});

test('a side street cuts the footpath, and the corners are rounded', () => {
  assert.equal(footpathHeight(11, 120), 0, 'the mouth of a side street');
  assert.equal(footpathHeight(11, 123.9), 0);
  assert.equal(footpathHeight(11, 124.5), SLAB_TOP, 'and the footpath goes on past it');
  assert.equal(footpathHeight(12.5, 12.5), SLAB_TOP, 'the corner piece');
  assert.equal(footpathHeight(10, 10), 0, 'the rounded corner leaves the road there');
  assert.equal(onSlab(-12.5, 12.5), true); assert.equal(onSlab(12.5, -12.5), true); assert.equal(onSlab(-12.5, -12.5), true);
});

test('the slab is the same from every side of the junction', () => {
  for (let x = -60; x <= 60; x += 1.7) for (let z = -60; z <= 60; z += 1.9) {
    const h = footpathHeight(x, z);
    assert.equal(footpathHeight(-x, z), h, `${x}, ${z} mirrored in x`);
    assert.equal(footpathHeight(x, -z), h, `${x}, ${z} mirrored in z`);
    assert.equal(footpathHeight(z, x), h, `${x}, ${z} turned`);
  }
});
