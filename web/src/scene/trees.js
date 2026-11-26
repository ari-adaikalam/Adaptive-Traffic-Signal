// Trees of eight kinds, built in code. Each kind is one merged shape with its colours in the vertices, and every tree of a kind is an instance of it, so a few
// hundred trees are a handful of draw calls. A tree is 1 unit big at `size` 1 and the heights below are what that means in metres.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

let currentHeight = 8; // the height of the kind being built, for the shading
const fract = (x) => x - Math.floor(x);
class Bake {
  constructor() { this.list = []; }
  add(geometry, colour, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    g.deleteAttribute('uv');
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz)));
    g.computeVertexNormals();
    const c = new THREE.Color(colour), n = g.attributes.position.count, a = new Float32Array(n * 3), pos = g.attributes.position;
    // Darker near the ground and in the heart of the crown, lighter on top, and every face a little different, so it reads as leaves in light and shade.
    for (let i = 0; i < n; i += 1) {
      const t = Math.floor(i / 3) * 3, fx = pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2), fy = pos.getY(t) + pos.getY(t + 1) + pos.getY(t + 2), fz = pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2);
      const jitter = 1 + (fract(Math.sin(fx * 12.9898 + fy * 78.233 + fz * 37.719) * 43758.5453) - 0.5) * 0.2;
      const k = (0.68 + 0.42 * Math.min(1, Math.max(0, pos.getY(i) / currentHeight))) * jitter;
      a[i * 3] = c.r * k; a[i * 3 + 1] = c.g * k; a[i * 3 + 2] = c.b * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    this.list.push(g);
  }
  geometry() { return mergeGeometries(this.list, false); }
}
const trunk = (b, h, r0, r1, colour = '#7a5b3f', x = 0, z = 0, lean = 0) => b.add(new THREE.CylinderGeometry(r1, r0, h, 7), colour, x, h / 2, z, 1, 1, 1, 0, 0, lean);
const blob = (b, x, y, z, r, colour, sy = 0.85) => {
  const seed = x * 12.9898 + y * 78.233 + z * 37.719;
  b.add(new THREE.IcosahedronGeometry(r, 1), colour, x, y, z, 1, sy, 1, 0, seed % 6.28, 0);
  for (let i = 0; i < 6; i += 1) { // clumps of leaves on the outside of the crown
    const a = fract(Math.sin(seed + i * 4.1) * 9371.7) * 6.28, e = (fract(Math.sin(seed * 1.7 + i * 2.3) * 5113.3) - 0.35) * 1.5, cr = r * (0.42 + 0.14 * fract(Math.sin(i + seed) * 777.7));
    b.add(new THREE.IcosahedronGeometry(cr, 0), colour, x + Math.cos(a) * Math.cos(e) * r * 0.92, y + Math.sin(e) * r * sy * 0.92, z + Math.sin(a) * Math.cos(e) * r * 0.92, 1, sy, 1, 0, a, 0);
  }
};
const cone = (b, y, r, h, colour) => b.add(new THREE.ConeGeometry(r, h, 8), colour, 0, y + h / 2, 0);

// A set of greens for a kind. Each cluster of leaves takes the next one so a crown has light and dark parts.
const OAK = ['#5a8a47', '#6b9a4c', '#4e7d3d', '#79a455'];
const PINE = ['#2f5d46', '#3a6b50', '#295440'];
const GUM = ['#7e8f5a', '#8a9a62', '#707f50'];
const JACARANDA = ['#8e72c9', '#a086d6', '#7d62b8', '#b39bde'];
const BLOSSOM = ['#f0b3c8', '#f5c6d6', '#e7a0ba', '#f9d7e2'];
const WILLOW = ['#9bb857', '#8aa84a', '#a8c261'];
const POPLAR = ['#6a9a3f', '#7aa84b', '#5c8a38'];

const SPECIES = {
  oak: { height: 6.4, build() { const b = new Bake(); trunk(b, 2.6, 0.38, 0.25); b.add(new THREE.CylinderGeometry(0.1, 0.16, 1.4, 5), '#7a5b3f', 0.5, 2.9, 0.1, 1, 1, 1, 0, 0, -0.7); b.add(new THREE.CylinderGeometry(0.1, 0.16, 1.3, 5), '#7a5b3f', -0.45, 2.8, -0.1, 1, 1, 1, 0, 0, 0.7); [[0, 4.4, 0, 2.2], [1.3, 3.7, 0.4, 1.6], [-1.3, 3.8, -0.3, 1.7], [0.2, 3.7, 1.3, 1.5], [-0.3, 3.8, -1.3, 1.5], [0.2, 5.4, 0.1, 1.5]].forEach(([x, y, z, r], i) => blob(b, x, y, z, r, OAK[i % 4])); return b.geometry(); } },
  pine: { height: 8, build() { const b = new Bake(); trunk(b, 2.2, 0.28, 0.18, '#5e4630'); [[1.3, 2.2, 2.9], [2.5, 1.85, 2.5], [3.7, 1.5, 2.2], [4.8, 1.15, 2.0], [5.8, 0.8, 1.7]].forEach(([y, r, h], i) => cone(b, y, r, h, PINE[i % 3])); b.add(new THREE.ConeGeometry(0.28, 1.0, 6), PINE[0], 0, 7.4, 0); return b.geometry(); } },
  poplar: { height: 9.5, build() {
    const b = new Bake(); trunk(b, 2.2, 0.28, 0.18, '#8a8470');
    for (let i = 0; i < 9; i += 1) { // a narrow column of leaf clumps, fullest in the lower middle
      const t = i / 8, y = 2.8 + t * 6.2, r = 1.0 * Math.sin(Math.PI * (0.12 + t * 0.85)) + 0.18, side = (i % 2 ? 1 : -1) * 0.18 * (1 - t);
      blob(b, side, y, (i % 3 - 1) * 0.12, r, POPLAR[i % 3], 1.15);
    }
    return b.geometry();
  } },
  palm: { height: 8.2, build() {
    const b = new Bake();
    for (let i = 0; i < 16; i += 1) { const t = i / 15; b.add(new THREE.CylinderGeometry(0.17 - t * 0.04, 0.19 - t * 0.04, 0.55, 8), i % 2 ? '#8a7258' : '#7d664d', t * t * 0.5, 0.27 + i * 0.47, 0, 1, 1, 1, 0, 0, -t * 0.12); }
    const top = [0.5, 7.7, 0];
    for (let i = 0; i < 11; i += 1) { // each frond rises, then droops, in four pieces
      const a = (i / 11) * Math.PI * 2 + (i % 2) * 0.2; let r = 0.15, y = 0;
      for (let k = 0; k < 4; k += 1) {
        const th = 0.55 - 0.38 * k + (i % 3) * 0.06, len = 0.7 - k * 0.05;
        const cx = r + Math.cos(th) * len / 2, cy = y + Math.sin(th) * len / 2;
        b.add(new THREE.BoxGeometry(len, 0.05, 0.42 - k * 0.07), (i + k) % 2 ? '#4f8a3a' : '#5e9a44', top[0] + Math.cos(a) * cx, top[1] + cy, top[2] + Math.sin(a) * cx, 1, 1, 1, 0, -a, th);
        r += Math.cos(th) * len; y += Math.sin(th) * len;
      }
    }
    b.add(new THREE.SphereGeometry(0.2, 6, 5), '#6b4a2a', 0.62, 7.45, 0.12); b.add(new THREE.SphereGeometry(0.19, 6, 5), '#6b4a2a', 0.38, 7.4, -0.14);
    return b.geometry();
  } },
  jacaranda: { height: 6.6, build() { const b = new Bake(); trunk(b, 2.4, 0.3, 0.2, '#6e5a48'); b.add(new THREE.CylinderGeometry(0.09, 0.14, 1.3, 5), '#6e5a48', 0.5, 2.8, 0, 1, 1, 1, 0, 0, -0.8); b.add(new THREE.CylinderGeometry(0.09, 0.14, 1.3, 5), '#6e5a48', -0.5, 2.8, 0, 1, 1, 1, 0, 0, 0.8); [[0, 4.5, 0, 2.0], [1.5, 3.9, 0.3, 1.5], [-1.5, 3.9, -0.2, 1.5], [0.1, 3.9, 1.4, 1.4], [0.5, 5.2, -0.5, 1.4], [-0.6, 3.8, -1.4, 1.3]].forEach(([x, y, z, r], i) => blob(b, x, y, z, r, JACARANDA[i % 4], 0.7)); return b.geometry(); } },
  gum: { height: 8, build() { const b = new Bake(); trunk(b, 3.4, 0.34, 0.2, '#cfc8b8', 0, 0, 0.05); b.add(new THREE.CylinderGeometry(0.08, 0.15, 2.0, 5), '#bdb5a3', 0.6, 3.9, 0, 1, 1, 1, 0, 0, -0.55); b.add(new THREE.CylinderGeometry(0.07, 0.13, 1.8, 5), '#bdb5a3', -0.5, 4.0, 0.1, 1, 1, 1, 0, 0, 0.6); [[1.3, 5.3, 0, 1.4], [-1.2, 5.3, 0.2, 1.3], [0, 6.3, 0, 1.3], [0.2, 5.0, -1.0, 1.0]].forEach(([x, y, z, r], i) => blob(b, x, y, z, r, GUM[i % 3], 0.7)); return b.geometry(); } },
  blossom: { height: 4.8, build() { const b = new Bake(); trunk(b, 1.8, 0.26, 0.17, '#5a4636'); [[0, 3.2, 0, 1.6], [1.1, 2.7, 0.3, 1.2], [-1.1, 2.8, -0.2, 1.2], [0.1, 2.7, 1.1, 1.1], [0.3, 3.8, -0.4, 1.1]].forEach(([x, y, z, r], i) => blob(b, x, y, z, r, BLOSSOM[i % 4], 0.8)); return b.geometry(); } },
  willow: { height: 6.4, build() { const b = new Bake(); trunk(b, 2.0, 0.4, 0.26, '#6b5a43'); blob(b, 0, 3.9, 0, 1.9, WILLOW[0], 0.7); for (let i = 0; i < 16; i += 1) { const a = (i / 16) * Math.PI * 2, r = 1.7 + (i % 2) * 0.25; b.add(new THREE.ConeGeometry(0.22, 3.2, 4), WILLOW[1 + (i % 2)], Math.cos(a) * r, 2.5, Math.sin(a) * r, 1, 1, 0.6, 0, -a, Math.PI); } return b.geometry(); } },
};

export const TREE_KINDS = Object.keys(SPECIES);

// spots: [x, z, size, kind]. Returns the group to add, an update(time) that sways them, and the height of each kind for whoever needs it.
export function buildTrees(spots, rand) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
  const sets = {};
  for (const kind of TREE_KINDS) sets[kind] = { spots: [], mesh: null };
  spots.forEach((spot, index) => { sets[spot[3] || 'oak'].spots.push({ spot, index }); });
  const tint = new THREE.Color(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  for (const kind of TREE_KINDS) {
    const set = sets[kind];
    if (set.spots.length === 0) continue;
    currentHeight = SPECIES[kind].height;
    const mesh = new THREE.InstancedMesh(SPECIES[kind].build(), material, set.spots.length);
    mesh.castShadow = true; mesh.receiveShadow = false;
    set.spots.forEach(({ spot }, i) => {
      set.spots[i].yaw = rand() * 6.28; set.spots[i].lean = (rand() - 0.5) * 0.06; set.spots[i].phase = rand() * 6;
      mesh.setColorAt(i, tint.setHSL(0.0, 0.0, 0.9 + rand() * 0.2)); // a little lighter or darker, so no two are the same
    });
    set.mesh = mesh; group.add(mesh);
  }
  const place = (time) => {
    for (const kind of TREE_KINDS) {
      const set = sets[kind];
      if (!set.mesh) continue;
      set.spots.forEach(({ spot, yaw, lean, phase }, i) => {
        const [x, z, size] = spot;
        e.set(lean + Math.sin(time * 0.9 + phase) * 0.012, yaw, Math.sin(time * 0.7 + phase * 1.3) * 0.012 + lean * 0.5); q.setFromEuler(e);
        m.compose(p.set(x, 0, z), q, s.setScalar(size * (kind === 'poplar' ? 0.9 : 1))); set.mesh.setMatrixAt(i, m);
      });
      set.mesh.instanceMatrix.needsUpdate = true;
    }
  };
  place(0);
  return { group, update: place, heightOf: (kind) => SPECIES[kind].height };
}
