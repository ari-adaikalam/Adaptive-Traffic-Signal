// Keeps a viewpoint away from every solid thing in the scene, using the scene's own triangles, so that no pole, signal arm, lamp, shelter, fence or crown has to be listed by hand.
//
// The triangles are put in a grid of cells 4 m wide (each in every cell it comes within `radius` of), so a point only looks at the triangles of its own cell. A point closer than `radius` to a triangle
// is moved straight away from the nearest spot on it, which slides it along a surface and round an edge without a corner to catch on.
// Everything is in typed arrays: the triangles are one Float32Array, and the grid is two Int32Arrays (where each cell's list starts, and the lists), filled in two passes, count then fill. A scene of a million
// triangles would cost hundreds of MB as JavaScript arrays of numbers and a Map of arrays.
//
// This file has no Three.js in it, so it runs under node and is tested there. collectTriangles takes the THREE namespace as an argument.

const CELL = 4;
const key = (ix, iz) => (ix + 1024) * 2048 + (iz + 1024);

// The triangles of a scene, in world space, as a flat list of nine numbers each: x y z of the three corners.
//   skip(object)     true for something that moves or is not solid (the sky, people), which is left out together with everything under it
//   reach            how far from the middle of the scene to look, in metres
//   solid(material)  false for glows, decals and the like
// Surfaces that lie flat on the ground (roads, paths, kerbs, grass) are left out, because the ground is kept clear by its own rule. Buildings are left out by size
// (a single mesh of more than `maxTriangles`), because the page keeps clear of them by their footprints and a point inside a closed building cannot be told which way out is.
export function collectTriangles(scene, THREE, { skip = () => false, reach = 300, groundTop = 0.4, maxTriangles = 300000, solid = () => true } = {}) {
  let out = new Float32Array(9 * 65536), used = 0; // grows by doubling, so it is never a list of numbers
  const v = new THREE.Vector3(), im = new THREE.Matrix4(), w = new THREE.Matrix4();
  scene.updateMatrixWorld(true);
  const dynamic = (o) => { for (let p = o; p; p = p.parent) if (skip(p)) return true; return false; };
  scene.traverse((o) => {
    if (!o.isMesh || !o.visible || !o.geometry || !o.geometry.attributes.position) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m || !solid(m) || dynamic(o)) return;
    const g = o.geometry, pos = g.attributes.position, idx = g.index, n = (idx ? idx.count : pos.count) / 3;
    if (n > maxTriangles) return;
    const copies = o.isInstancedMesh ? o.count : 1, corner = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let k = 0; k < copies; k += 1) {
      if (o.isInstancedMesh) { o.getMatrixAt(k, im); w.multiplyMatrices(o.matrixWorld, im); } else w.copy(o.matrixWorld);
      for (let t = 0; t < n; t += 1) {
        let top = -Infinity, near = true;
        for (let c = 0; c < 3; c += 1) {
          v.fromBufferAttribute(pos, idx ? idx.getX(t * 3 + c) : t * 3 + c).applyMatrix4(w);
          corner[c * 3] = v.x; corner[c * 3 + 1] = v.y; corner[c * 3 + 2] = v.z;
          if (v.y > top) top = v.y;
          if (Math.abs(v.x) > reach || Math.abs(v.z) > reach) near = false;
        }
        if (top >= groundTop && near) {
          if (used + 9 > out.length) { const bigger = new Float32Array(out.length * 2); bigger.set(out); out = bigger; }
          out.set(corner, used); used += 9;
        }
      }
    }
  });
  return out.slice(0, used);
}

// The closest point to (px, py, pz) on the triangle that starts at offset o, written to `into` (Ericson, Real-Time Collision Detection, 5.1.5).
export function closest(t, o, px, py, pz, into) {
  const ax = t[o], ay = t[o + 1], az = t[o + 2], bx = t[o + 3], by = t[o + 4], bz = t[o + 5], cx = t[o + 6], cy = t[o + 7], cz = t[o + 8];
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  const set = (x, y, z) => { into[0] = x; into[1] = y; into[2] = z; };
  if (d1 <= 0 && d2 <= 0) return set(ax, ay, az);
  const bpx = px - bx, bpy = py - by, bpz = pz - bz, d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return set(bx, by, bz);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const s = d1 / (d1 - d3); return set(ax + s * abx, ay + s * aby, az + s * abz); }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz, d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return set(cx, cy, cz);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const s = d2 / (d2 - d6); return set(ax + s * acx, ay + s * acy, az + s * acz); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const s = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return set(bx + s * (cx - bx), by + s * (cy - by), bz + s * (cz - bz)); }
  const sum = va + vb + vc;
  if (!(sum > 0)) return set(ax, ay, az); // a triangle with no area (all three corners in a line) has no inside
  const den = 1 / sum, s = vb * den, r = vc * den;
  return set(ax + abx * s + acx * r, ay + aby * s + acy * r, az + abz * s + acz * r);
}

export function createTriangleGrid(triangles, radius) {
  const count = triangles.length / 9, nearest = [0, 0, 0], range = [0, 0, 0, 0];
  // The extent of the grid, from the corners of all the triangles.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < triangles.length; i += 3) { const x = triangles[i], z = triangles[i + 2]; if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; }
  if (!count) { minX = maxX = minZ = maxZ = 0; }
  const cx0 = Math.floor((minX - radius) / CELL), cz0 = Math.floor((minZ - radius) / CELL), nx = Math.floor((maxX + radius) / CELL) - cx0 + 1, nz = Math.floor((maxZ + radius) / CELL) - cz0 + 1;
  const cells = nx * nz, start = new Int32Array(cells + 1);
  let items = null, fill = null, pass = 0, next = 0; // pass 0 counts, pass 1 fills, then it is done

  // The cells a triangle is in, as a box of cells written to `range` (ix0, ix1, iz0, iz1). False for a triangle that is not kept: one with no area (or not a number), or a sheet as wide as a street, which is a surface
  // and not an object.
  const cellsOf = (t) => {
    const o = t * 9;
    const ux = triangles[o + 3] - triangles[o], uy = triangles[o + 4] - triangles[o + 1], uz = triangles[o + 5] - triangles[o + 2];
    const vx = triangles[o + 6] - triangles[o], vy = triangles[o + 7] - triangles[o + 1], vz = triangles[o + 8] - triangles[o + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (!(cx * cx + cy * cy + cz * cz > 1e-10)) return false;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let c = 0; c < 3; c += 1) { const x = triangles[o + c * 3], z = triangles[o + c * 3 + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    range[0] = Math.floor((x0 - radius) / CELL) - cx0; range[1] = Math.floor((x1 + radius) / CELL) - cx0; range[2] = Math.floor((z0 - radius) / CELL) - cz0; range[3] = Math.floor((z1 + radius) / CELL) - cz0;
    return (range[1] - range[0] + 1) * (range[3] - range[2] + 1) <= 400;
  };
  const cellAt = (x, z) => { const ix = Math.floor(x / CELL) - cx0, iz = Math.floor(z / CELL) - cz0; return ix < 0 || iz < 0 || ix >= nx || iz >= nz ? -1 : ix * nz + iz; };
  const span = [0, 0]; // the list of the cell of a point, written here so that nothing is made on every call
  const listOf = (p) => { const c = cellAt(p.x, p.z); if (c < 0 || !items) return null; span[0] = start[c]; span[1] = start[c + 1]; return span; };

  return {
    triangles: count,
    get done() { return pass >= 2; },
    // Does `n` units of the work (a unit is one triangle in one of the two passes). The page calls this a little at a time so the scene starts at once. Returns true when the grid is built.
    build(n = 2 * count) {
      let budget = n;
      while (budget > 0 && pass < 2) {
        const stop = Math.min(count, next + budget); budget -= stop - next;
        if (pass === 0) {
          for (; next < stop; next += 1) if (cellsOf(next)) for (let ix = range[0]; ix <= range[1]; ix += 1) for (let iz = range[2]; iz <= range[3]; iz += 1) start[ix * nz + iz + 1] += 1;
        } else {
          for (; next < stop; next += 1) if (cellsOf(next)) for (let ix = range[0]; ix <= range[1]; ix += 1) for (let iz = range[2]; iz <= range[3]; iz += 1) items[fill[ix * nz + iz]++] = next;
        }
        if (next >= count) {
          if (pass === 0) { for (let c = 0; c < cells; c += 1) start[c + 1] += start[c]; items = new Int32Array(start[cells]); fill = start.slice(0, cells); }
          else fill = null;
          pass += 1; next = 0;
        }
      }
      return pass >= 2;
    },
    // Moves p ({x, y, z}) out of everything it is within `radius` of. Returns true when it moved. Before the grid is built it moves nothing.
    push(p) {
      if (pass < 2) return false;
      const list = listOf(p);
      if (!list) return false;
      let moved = false;
      for (let i = list[0]; i < list[1]; i += 1) {
        closest(triangles, items[i] * 9, p.x, p.y, p.z, nearest);
        let dx = p.x - nearest[0], dy = p.y - nearest[1], dz = p.z - nearest[2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= radius * radius) continue;
        let d = Math.sqrt(d2);
        if (d < 1e-6) { dx = 0; dy = 1; dz = 0; d = 0; } // exactly on it: out, upward
        else { dx /= d; dy /= d; dz /= d; }
        const gap = radius - d;
        if (!Number.isFinite(gap * dx + gap * dy + gap * dz)) continue; // a bad number in the model must never reach the camera
        p.x += dx * gap; p.y += dy * gap; p.z += dz * gap; moved = true;
      }
      return moved;
    },
    // The least distance from p to any triangle that the grid holds for its cell, or Infinity. For tests.
    nearest(p) {
      const list = pass >= 2 ? listOf(p) : null;
      let best = Infinity;
      if (list) for (let i = list[0]; i < list[1]; i += 1) { closest(triangles, items[i] * 9, p.x, p.y, p.z, nearest); best = Math.min(best, Math.hypot(p.x - nearest[0], p.y - nearest[1], p.z - nearest[2])); }
      return best;
    },
  };
}
