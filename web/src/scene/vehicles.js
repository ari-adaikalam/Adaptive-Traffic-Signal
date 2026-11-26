// The 3D models of every vehicle, built in code with no model files. Each is a handful of merged parts, so a hundred of them on screen stay cheap.
// A vehicle faces +x with its middle at the origin. Its length runs along x and its width along z, as in the simulator's CLASSES, and the
// parts scale to fit that box so what you see is what the simulator moves. Heights are in metres.
//
// What the scene needs from every one: `group.userData` has `tail` (the brake light material), `indL` and `indR` (the indicator materials) and,
// for an emergency vehicle, `siren`, with `blue` and `red` meshes and `glowB` and `glowR`, the places of their glow.

import * as THREE from 'three';
import { lightTexture } from './textures.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { geometryKey } from './shape-key.js';
import { beamHook, withHeadlightBeam } from './night-glow.js';
import { CLASSES } from '../sim/world.js';

// Every part that is only a colour is baked into the vertex colours of one glossy and one matte mesh per vehicle, so a vehicle costs a few draw calls
// and not one for each colour on it. Only what glows or changes (headlights, brake lights, indicators) keeps its own mesh and material.
export const GLOSS = withHeadlightBeam(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.35 }), 'beam-gloss'); // lit by the headlights of the vehicle behind (night-glow.js)
export const MATTE = withHeadlightBeam(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }), 'beam-matte');
const mat = (color, roughness = 0.6, metalness = 0, extra = {}) => {
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  m.userData.mode = extra.emissive !== undefined ? 'own' : metalness >= 0.3 || roughness <= 0.4 ? 'gloss' : 'matte';
  return m;
};
// The light a vehicle's headlamps throw on the road (drawn after the bus lane's red overlay, renderOrder 3 in main.js, or the red would hide the beam of every vehicle in the bus lane): a flat cone ahead of it that widens and fades, drawn as an additive plane. One material is shared by every
// vehicle, so the scene switches all of them on at dusk by setting its opacity.
const beamTexture = lightTexture(128, 64, (u, v) => { // along the cone (u) it fades out, and across it (v) it is brightest down the middle
  const along = u, half = 0.18 + 0.82 * along, across = Math.abs(v - 0.5) * 2;
  return Math.pow(1 - along, 1.4) * Math.pow(Math.max(0, 1 - across / half), 0.9);
});
export const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff1c8, map: beamTexture, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 });
const beamGeos = new Map();
function headlightBeam(L, reach, z = 0, spread = 0.42) {
  const key = `${L}|${reach}|${z}|${spread}`;
  if (!beamGeos.has(key)) beamGeos.set(key, new THREE.PlaneGeometry(reach, reach * spread).rotateX(-Math.PI / 2).translate(L / 2 + reach / 2 - 0.2, 0.07, z));
  const g = beamGeos.get(key); g.userData.shared = true; // one geometry for every vehicle of that size: never given back with a vehicle
  const m = new THREE.Mesh(g, beamMat); m.renderOrder = 4; m.userData.beam = { start: L / 2 - 0.2, reach, z, spread }; return m;
}

export const headMat = mat(0xfff6d8, 0.3, 0, { emissive: 0xfff0b8, emissiveIntensity: 0.3 }); // the scene raises this at night
const glass = mat(0x3a5368, 0.08, 0.45);
const trim = mat(0x16181b, 0.8);
const chrome = mat(0xc9ced4, 0.25, 0.8);
const tyre = mat(0x131518, 0.95);
const rim = mat(0xaab0b8, 0.3, 0.7);
const plate = mat(0xf3f1e6, 0.6);
const white = mat(0xf2f3f0, 0.55);
const yellow = mat(0xf2c418, 0.5);
const red = mat(0xb3261e, 0.5);
const orange = mat(0xe0721d, 0.5);
const blueTrim = mat(0x1f4ea1, 0.5);
const green = mat(0x2f7d4a, 0.55);
const canvas = mat(0x2a2d31, 0.9);
const seat = mat(0x2c2c30, 0.85);
const SKIN = ['#f0c8a0', '#d9a577', '#b87c52', '#8d5a3b', '#6b4330'];
const JACKET = ['#d44b3a', '#2f7fd6', '#f0b429', '#2c2f36', '#5a8f3c', '#f2efe6', '#7e5bb5'];

// Colours people buy, weighted: mostly white, silver, grey and black.
const CAR_COLOURS = [['#f1f1ee', 5], ['#c3c7cc', 4], ['#6f757c', 3], ['#1b1d21', 3], ['#244d8f', 2], ['#a52b2b', 2], ['#2f5d46', 1], ['#c8b79a', 1], ['#7d2438', 1], ['#d9822b', 0.6], ['#4a6fa5', 1], ['#3d2f27', 0.6]];
function hash(id, salt = 0) { let h = (id * 2654435761 + salt * 40503) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13; return (h >>> 0) / 4294967296; }
function weighted(list, r) { const total = list.reduce((a, [, w]) => a + w, 0); let x = r * total; for (const [v, w] of list) { x -= w; if (x < 0) return v; } return list[0][0]; }
const CARGO_LIVERY = [mat('#2f5d8f', 0.6), mat('#b5442f', 0.6), mat('#2f7d4a', 0.6), mat('#1f2a36', 0.6)];
const pickFrom = (list, id, salt) => list[Math.floor(hash(id, salt) * list.length) % list.length];

// A collection of geometry pieces that end up as one mesh for each material.
//
// Vehicles of the same make-up are built from the same pieces in the same places, and differ only in the colours. So the work of putting the pieces together (copying, moving and merging them) is done once for
// each make-up, and the result is kept: the next vehicle with the same pieces, in the same places, takes the positions and normals that were made and adds its own colours. Two vehicles of one make-up
// share the same arrays, which saves the time of building the second and the memory of holding it, and a vehicle comes out exactly as it would have if it had been built on its own (checked piece by piece
// in the browser, see docs/results.md). What a vehicle is made of is told by a key: for the pieces that are made by a method of Parts (box, slab, profile, cylZ, cylY) it is the method and its numbers, so
// on a repeat the piece is not even made, and for a piece that is handed over ready made it is a hash of the numbers in it. The colours are not in the key.
const SHAPES = new Map(), SHAPE_LIMIT = 96; // kept make-ups, the least recently used going first
export const shapeStats = { built: 0, reused: 0 };
class Parts {
  constructor() { this.items = []; }
  // A piece handed over ready made.
  add(material, geometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) { this.items.push({ material, geometry, make: null, key: geometryKey(geometry), x, y, z, rx, ry, rz }); }
  // A piece that is made only if the make-up has not been seen before: `key` says what it is, and `make` makes it.
  later(material, key, make, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) { this.items.push({ material, geometry: null, make, key, x, y, z, rx, ry, rz }); }
  box(material, w, h, d, x, y, z, r = 0.04) { this.later(material, `box|${w}|${h}|${d}|${r}`, () => (r > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.1, h / 2.1, d / 2.1)) : new THREE.BoxGeometry(w, h, d)), x, y, z); }
  slab(material, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) { this.later(material, `slab|${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz); }
  // A shape in the side view (x along the vehicle, y up) pushed out across the width.
  profile(material, points, width, z = 0, bevel = 0.025) {
    this.later(material, `profile|${points.map((q) => `${q[0]},${q[1]}`).join(';')}|${width}|${z}|${bevel}`, () => {
      const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
      const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 1 });
      g.translate(0, 0, -(width - bevel * 2) / 2 + z);
      return g;
    });
  }
  cylZ(material, r, len, x, y, z, segments = 14) { this.later(material, `cylZ|${r}|${len}|${segments}`, () => new THREE.CylinderGeometry(r, r, len, segments).rotateX(Math.PI / 2), x, y, z); }
  cylY(material, r, h, x, y, z, segments = 12) { this.later(material, `cylY|${r}|${h}|${segments}`, () => new THREE.CylinderGeometry(r, r, h, segments), x, y, z); }

  // Which mesh each piece goes to, by order of first appearance: 'gloss', 'matte', or the position in the list of materials that bring their own look (the lamps).
  plan() {
    const own = [], where = this.items.map((item) => {
      const mode = item.material.userData.mode;
      if (mode !== 'own') return mode === 'gloss' ? 'gloss' : 'matte';
      let at = own.indexOf(item.material); if (at < 0) { at = own.length; own.push(item.material); }
      return at;
    });
    return { own, where };
  }
  // The make-up of this vehicle's pieces, as one string.
  signature(where) { return this.items.map((item, i) => `${item.key}@${item.x},${item.y},${item.z},${item.rx},${item.ry},${item.rz}>${where[i]}`).join('|'); }

  build(group) {
    const { own, where } = this.plan(), signature = this.signature(where);
    let shape = SHAPES.get(signature);
    if (shape) { SHAPES.delete(signature); SHAPES.set(signature, shape); shapeStats.reused += 1; } // used just now: last to go
    else { shape = this.assemble(where, own.length); SHAPES.set(signature, shape); shapeStats.built += 1; if (SHAPES.size > SHAPE_LIMIT) SHAPES.delete(SHAPES.keys().next().value); }
    for (const bucket of shape) {
      const geometry = new THREE.BufferGeometry(); geometry.userData.sharesShape = true;
      geometry.setAttribute('position', bucket.position); geometry.setAttribute('normal', bucket.normal);
      if (bucket.coloured) { // the colours are this vehicle's: one for every point of every piece that goes to the mesh
        const colours = new Float32Array(bucket.position.count * 3); let at = 0;
        bucket.pieces.forEach((piece) => { const c = this.items[piece.item].material.color; for (let n = 0; n < piece.count; n += 1, at += 3) { colours[at] = c.r; colours[at + 1] = c.g; colours[at + 2] = c.b; } });
        geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
      }
      const material = bucket.mode === 'gloss' ? GLOSS : bucket.mode === 'matte' ? MATTE : own[bucket.mode];
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = material === GLOSS || material === MATTE; // the small glowing lamps cast no shadow worth a draw call
      if (mesh.castShadow) mesh.onBeforeRender = beamHook; // the body and the trim take the light of a beam that falls on the vehicle
      group.add(mesh);
    }
  }

  // Puts the pieces together, as it always was done: each piece made if it was not, copied, moved, given its colour, and the pieces of a mesh merged. Returns the meshes' shared parts: for each, the merged
  // positions and normals and which pieces (and how many points of each) are in it.
  assemble(where, ownCount) {
    const lists = new Map(); // bucket -> { geometries, pieces }
    const order = ['gloss', 'matte', ...Array.from({ length: ownCount }, (_, k) => k)]; // gloss first, then matte, then the others in the order they first came
    this.items.forEach((item, index) => {
      const geometry = item.geometry || item.make();
      const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
      g.deleteAttribute('uv');
      g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(item.x, item.y, item.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(item.rx, item.ry, item.rz)), new THREE.Vector3(1, 1, 1)));
      const bucket = where[index];
      if (!lists.has(bucket)) lists.set(bucket, { geometries: [], pieces: [] });
      lists.get(bucket).geometries.push(g); lists.get(bucket).pieces.push({ item: index, count: g.attributes.position.count });
    });
    const shape = [];
    for (const bucket of order) {
      const list = lists.get(bucket);
      if (!list || list.geometries.length === 0) continue;
      const merged = mergeGeometries(list.geometries, false);
      shape.push({ mode: bucket, coloured: typeof bucket === 'string', position: merged.attributes.position, normal: merged.attributes.normal, pieces: list.pieces });
    }
    return shape;
  }
}

// A tyre is a revolved profile with a rounded shoulder and a sidewall, so it is round and not a faceted drum. One geometry per size.
const tyreGeos = new Map();
function tyreGeometry(r, w) {
  const key = `${r.toFixed(3)}|${w.toFixed(3)}`;
  if (!tyreGeos.has(key)) {
    const h = w / 2, pts = [[0.58 * r, -h], [0.8 * r, -h], [0.93 * r, -h * 0.9], [r * 0.985, -h * 0.55], [r, -h * 0.3], [r, h * 0.3], [r * 0.985, h * 0.55], [0.93 * r, h * 0.9], [0.8 * r, h], [0.58 * r, h]];
    tyreGeos.set(key, new THREE.LatheGeometry(pts.map(([rr, y]) => new THREE.Vector2(rr, y)), 28).rotateX(Math.PI / 2));
  }
  return tyreGeos.get(key);
}
// A wheel: the tyre, an alloy rim with a lip, a dark recess, five spokes and a hub. `dual` adds a second tyre inboard, as on the rear axles of trucks and buses.
// The lip round a wheel well: a half ring in the body colour standing out from the side, over the top of the wheel.
const flareGeos = new Map();
function flareGeometry(r) {
  const key = r.toFixed(3);
  if (!flareGeos.has(key)) {
    const shape = new THREE.Shape(), outer = r + 0.17, inner = r + 0.07;
    shape.absarc(0, 0, outer, -0.25, Math.PI + 0.25, false); shape.absarc(0, 0, inner, Math.PI + 0.25, -0.25, true);
    flareGeos.set(key, new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false, curveSegments: 14 }).translate(0, 0, -0.025));
  }
  return flareGeos.get(key);
}
// well: { mat, hw } puts the wheel in a dark well, in front of anything painted on the side, with a lip in the body colour. hw is the half width of the body there.
function wheel(p, x, z, r = 0.34, w = 0.24, dual = false, well = null) {
  if (well) { const sd = Math.sign(z); const cut = Math.acos(r / (r + 0.07)); // the disc is 7 cm bigger than the tyre, so its lowest part would be under the road: leave out the wedge below the ground
    p.later(trim, `archDisc|${r}`, () => new THREE.CylinderGeometry(r + 0.07, r + 0.07, 0.02, 26, 1, false, cut, Math.PI * 2 - 2 * cut).rotateX(Math.PI / 2), x, r, sd * (well.hw + 0.03)); p.add(well.mat, flareGeometry(r), x, r, sd * (well.hw + 0.04)); }
  p.add(tyre, tyreGeometry(r, w), x, r, z);
  p.cylZ(rim, r * 0.68, w + 0.03, x, r, z, 24); // the rim and its lip, standing a little proud of the tyre
  p.cylZ(trim, r * 0.55, w + 0.046, x, r, z, 22); // the dark recess the spokes stand in
  const sides = z === 0 ? [-1, 1] : [Math.sign(z)];
  if (r >= 0.22) for (const s of sides) {
    const face = z + s * (w / 2 + 0.028);
    for (let i = 0; i < 5; i += 1) { const a = i * Math.PI * 2 / 5 + 0.3; p.slab(rim, r * 0.46, 0.04, 0.014, x + Math.cos(a) * r * 0.3, r + Math.sin(a) * r * 0.3, face, 0, 0, a); }
    p.cylZ(rim, r * 0.15, 0.035, x, r, face + s * 0.008, 10); // the hub
  }
  if (dual) p.add(tyre, tyreGeometry(r, w), x, r, z - Math.sign(z) * (w + 0.03));
}
function head(p, L, W, y = 0.68, inset = 0.34) {
  for (const s of [-1, 1]) {
    const z = s * (W / 2 - inset);
    p.box(trim, 0.08, 0.26, 0.46, L / 2 - 0.03, y, z, 0.02); // the housing
    p.box(headMat, 0.1, 0.17, 0.34, L / 2 - 0.01, y, z, 0.03); // the lamp
    p.slab(chrome, 0.02, 0.025, 0.4, L / 2 + 0.03, y + 0.11, z); // a chrome brow over it
  }
}
// The rear lamps: a housing and a lamp at each side, one wrapping round the corner, a white reversing lamp inboard and a reflector below. `tall` makes them vertical strips, as on vans, buses and ambulances.
function tailLamps(p, tail, L, W, y = 0.7, inset = 0.3, tall = false) {
  const x = -L / 2;
  for (const s of [-1, 1]) {
    const z = s * (W / 2 - (tall ? 0.13 : inset)), h = tall ? 0.5 : 0.17, wd = tall ? 0.16 : 0.38;
    p.box(trim, 0.06, h + 0.08, wd + 0.08, x + 0.025, y, z, 0.02); // the housing
    p.box(tail, 0.08, h, wd, x + 0.02, y, z, 0.03); // the lamp
    p.box(tail, 0.18, h * 0.9, 0.03, x + 0.1, y, s * (W / 2 - 0.004), 0.01); // the part that wraps round the corner
    p.box(white, 0.05, 0.07, 0.12, x + 0.012, y - (tall ? 0.34 : 0.07), s * (W / 2 - (tall ? 0.13 : inset) - (tall ? 0.0 : 0.3)), 0.01); // the reversing lamp
    p.box(red, 0.03, 0.05, 0.1, x + 0.005, y - (tall ? 0.38 : 0.2), z, 0.005); // a reflector
  }
}
// What a tail end carries on the left of a tall rear: hinges and a handle on a pair of doors.
function rearDoors(p, x, W, y0, y1) {
  for (const s of [-1, 1]) {
    for (const y of [y0 + 0.15, (y0 + y1) / 2, y1 - 0.15]) p.slab(trim, 0.04, 0.12, 0.05, x - 0.005, y, s * W * 0.47);
    p.slab(chrome, 0.03, 0.34, 0.03, x - 0.014, (y0 + y1) / 2, s * 0.09); // a handle each
  }
}
// Hazard stripes along the bottom of a heavy vehicle's tail, an underrun bar and mudflaps behind the last axle.
function heavyRear(p, x, W, lastAxleX, stripeY = 0.78) {
  for (let i = 0; i < 10; i += 1) p.slab(i % 2 ? white : red, 0.02, 0.12, W * 0.9 / 10, x - 0.01, stripeY, -W * 0.45 + (i + 0.5) * W * 0.09);
  p.box(trim, 0.1, 0.14, W * 0.9, x - 0.1, 0.46, 0, 0.02);
  for (const s of [-1, 1]) { p.slab(trim, 0.03, 0.5, 0.42, lastAxleX - 0.7, 0.3, s * (W / 2 - 0.3)); p.slab(trim, 0.04, 0.5, 0.05, x - 0.1, 0.62, s * W * 0.4); }
}
function indicators(p, indL, indR, L, W, y) { // the left side of a vehicle facing +x is -z
  for (const [x, edge] of [[L / 2, 1], [-L / 2, 1]]) { p.box(indR, 0.08, 0.1, 0.2, x, y, edge * (W / 2 - 0.12), 0.02); p.box(indL, 0.08, 0.1, 0.2, x, y, -edge * (W / 2 - 0.12), 0.02); }
}
function plates(p, L, y = 0.5) { p.slab(plate, 0.02, 0.12, 0.42, L / 2 + 0.01, y, 0); p.slab(plate, 0.02, 0.12, 0.42, -L / 2 - 0.01, y, 0); }
function mirrors(p, body, x, y, W) { for (const s of [-1, 1]) p.box(body, 0.16, 0.12, 0.12, x, y, s * (W / 2 + 0.07), 0.03); }

// The front of a tall vehicle: a bumper with a chrome strip, a headlight cluster at each side, a grille with chrome bars between them, fog lamps and a plate.
function fascia(p, x, W, { headY = 0.9, grilleY = 0.95, grilleH = 0.5, grilleW = 0.46, bumperY = 0.5, bumperH = 0.3, inset = 0.38, lamp = 0.3 } = {}) {
  p.box(trim, 0.14, bumperH, W * 0.99, x - 0.02, bumperY, 0, 0.04);
  p.slab(chrome, 0.02, 0.04, W * 0.9, x + 0.056, bumperY + bumperH / 2 - 0.03, 0);
  p.slab(trim, 0.03, bumperH * 0.45, W * 0.42, x + 0.07, bumperY - 0.02, 0); // the intake in the bumper
  p.box(trim, 0.06, grilleH, W * grilleW, x + 0.0, grilleY, 0, 0.02); // the grille
  for (let i = 1; i < 5; i += 1) p.slab(chrome, 0.02, 0.025, W * grilleW * 0.92, x + 0.036, grilleY - grilleH / 2 + i * grilleH / 5, 0);
  for (const s of [-1, 1]) {
    const z = s * (W / 2 - inset);
    p.box(trim, 0.07, lamp + 0.12, 0.52, x - 0.005, headY, z, 0.02); // the housing
    p.box(headMat, 0.09, lamp, 0.4, x + 0.01, headY, z, 0.03); // the lamp
    p.slab(chrome, 0.02, 0.025, 0.46, x + 0.05, headY + lamp / 2 + 0.03, z); // a chrome brow over it
    p.slab(orange, 0.04, 0.08, 0.26, x + 0.03, headY - lamp / 2 - 0.1, z); // the indicator
    p.box(headMat, 0.04, 0.07, 0.15, x + 0.03, bumperY + 0.03, s * W * 0.37, 0.01); // a fog lamp
  }
  p.slab(plate, 0.02, 0.14, 0.46, x + 0.07, bumperY + 0.02, 0);
}
// A windscreen on a sloping line from a to b (x, y in the side view): glass proud of the body, a pillar at each end, wipers and a visor.
function screen(p, bodyMat, a, b, W, lift = 0.075) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy), n = [-dy / len, dx / len];
  const at = (t, off) => [a[0] + dx * t + n[0] * off, a[1] + dy * t + n[1] * off];
  p.profile(glass, [at(0.05, lift), at(0.95, lift), at(0.95, lift + 0.025), at(0.05, lift + 0.025)], W * 0.92, 0, 0.004);
  for (const sd of [-1, 1]) p.profile(bodyMat, [at(0.03, lift), at(0.97, lift), at(0.97, lift + 0.045), at(0.03, lift + 0.045)], 0.08, sd * W * 0.48, 0.003);
  p.profile(bodyMat, [at(0.0, lift), at(0.04, lift), at(0.04, lift + 0.07), at(0.0, lift + 0.07)], W * 0.96, 0, 0.003); // the visor edge
  for (const z of [-W * 0.22, W * 0.12]) p.profile(trim, [at(0.9, lift + 0.03), at(0.97, lift + 0.03), at(0.97, lift + 0.05), at(0.9, lift + 0.05)], 0.03, z, 0.002); // wipers
}

// ---------- cars ----------
// Each style is the side profile of the glass house, in fractions of the length, and the heights of the belt line and roof.
const CAR_STYLES = {
  hatchback: { belt: 0.86, roof: 1.42, glass: [[-0.38, 0], [-0.31, 1], [0.1, 1], [0.25, 0]], hood: 0.9, rear: 'hatch', width: 0.97 },
  sedan: { belt: 0.88, roof: 1.42, glass: [[-0.27, 0], [-0.16, 1], [0.08, 1], [0.21, 0]], hood: 0.88, rear: 'trunk', width: 1 },
  wagon: { belt: 0.88, roof: 1.46, glass: [[-0.41, 0], [-0.38, 1], [0.1, 1], [0.24, 0]], hood: 0.88, rear: 'hatch', width: 1 },
  suv: { belt: 1.0, roof: 1.78, glass: [[-0.4, 0], [-0.37, 1], [0.1, 1], [0.24, 0]], hood: 1.02, rear: 'hatch', width: 1.02, lift: 0.14 },
  hothatch: { belt: 0.82, roof: 1.36, glass: [[-0.37, 0], [-0.29, 1], [0.1, 1], [0.26, 0]], hood: 0.84, rear: 'hatch', width: 1.02, spoiler: true },
  coupe: { belt: 0.8, roof: 1.3, glass: [[-0.3, 0], [-0.17, 1], [0.04, 1], [0.22, 0]], hood: 0.82, rear: 'trunk', width: 1.03, wheel: 0.33 },
  sports: { belt: 0.64, roof: 1.14, glass: [[-0.28, 0], [-0.19, 1], [0.0, 1], [0.2, 0]], hood: 0.68, rear: 'trunk', width: 1.06, wing: true, wheel: 0.31 },
  luxury: { belt: 0.92, roof: 1.42, glass: [[-0.3, 0], [-0.2, 1], [0.1, 1], [0.25, 0]], hood: 0.94, rear: 'trunk', width: 1.04, grand: true, wheel: 0.35 },
  gwagon: { belt: 1.04, roof: 1.9, glass: [[-0.488, 0], [-0.484, 1], [0.13, 1], [0.235, 0]], hood: 1.06, rear: 'hatch', width: 1.05, lift: 0.14, wheel: 0.4, gwagon: true, round: true },
  ute: { belt: 0.98, roof: 1.62, glass: [[-0.1, 0], [-0.07, 1], [0.12, 1], [0.24, 0]], hood: 0.98, rear: 'tray', width: 1.02, lift: 0.1 },
};
function buildCar(p, group, id, L, W, bodyMat, tail, indL, indR, kind) {
  const names = Object.keys(CAR_STYLES);
  // most cars are ordinary; a few in every fourteen are a coupe, a sports car, a luxury saloon or a G-Wagon style SUV
  const pool = ['hatchback', 'hatchback', 'sedan', 'sedan', 'sedan', 'wagon', 'wagon', 'hothatch', 'ute', 'coupe', 'sports', 'luxury', 'luxury', 'gwagon'];
  const styleName = kind === 'police' ? 'sedan' : kind === 'taxi' ? 'sedan' : pool[Math.floor(hash(id, 1) * pool.length)];
  void names;
  const S = CAR_STYLES[styleName], lift = S.lift || 0;
  const w = W * S.width;
  // lower body, with the bonnet and boot as rounded slabs
  p.box(bodyMat, L, S.belt - 0.38 - lift * 0.3 + 0.1, w, 0, (S.belt + 0.3 + lift) / 2 - 0.02 - 0.05, 0, S.gwagon ? 0.025 : 0.12);
  p.box(bodyMat, L * 0.24, 0.1, w * 0.96, L * 0.36, S.hood + lift * 0.2, 0, 0.05); // the bonnet
  const gl = S.glass.map(([fx, up]) => [fx * L, S.belt + lift * 0.3 + up * (S.roof - S.belt)]);
  const top = S.roof;
  if (styleName !== 'ute') {
    p.profile(glass, [[gl[0][0], S.belt + lift * 0.3], gl[1], gl[2], gl[3], [gl[3][0], S.belt + lift * 0.3]], w * 0.88);
    p.profile(bodyMat, [[gl[1][0] - 0.04, gl[1][1] - 0.03], [gl[2][0] + 0.04, gl[2][1] - 0.03], [gl[2][0] + 0.04, gl[2][1] + 0.05], [gl[1][0] - 0.04, gl[1][1] + 0.05]], w * 0.9, 0, 0.015); // the roof, on the top edge of the glass
    // The frame round the glass: thin strips in the body colour along the windscreen and the rear window, and a pillar in the middle of each side.
    const frame = (a, b, thick) => p.profile(bodyMat, [a, b, [b[0] - thick, b[1]], [a[0] - thick * 1.4, a[1]]], w * 0.9, 0, 0.01);
    frame([gl[3][0], S.belt + lift * 0.3], gl[2], 0.07);
    frame([gl[1][0] + 0.07, gl[1][1]], [gl[0][0] + 0.1, S.belt + lift * 0.3], 0.07);
    for (const s of [-1, 1]) p.slab(bodyMat, 0.06, top - S.belt - lift * 0.3 - 0.08, 0.04, (gl[1][0] + gl[2][0]) / 2 - 0.1, S.belt + lift * 0.3 + (top - S.belt) * 0.5, s * w * 0.44);
    if (S.rear === 'trunk') p.box(bodyMat, L * 0.2, 0.08, w * 0.94, -L * 0.38, S.belt + 0.02, 0, 0.04); // the boot lid
    if (S.spoiler) p.box(bodyMat, 0.2, 0.05, w * 0.86, gl[1][0] - 0.02, top + 0.0, 0, 0.015); // a lip on the rear edge of the roof, sitting on it
  } else { // a ute: a short cab and an open tray
    p.profile(glass, [[gl[0][0], S.belt + lift * 0.3], gl[1], gl[2], gl[3], [gl[3][0], S.belt + lift * 0.3]], w * 0.88);
    p.profile(bodyMat, [[gl[1][0] - 0.04, gl[1][1] - 0.03], [gl[2][0] + 0.04, gl[2][1] - 0.03], [gl[2][0] + 0.04, gl[2][1] + 0.05], [gl[1][0] - 0.04, gl[1][1] + 0.05]], w * 0.9, 0, 0.015);
    const bz = S.belt + lift * 0.3; // the frame round the cab glass: windscreen and rear window strips, and a pillar at the back and the middle of each side
    const strip = (a, b, thick) => p.profile(bodyMat, [a, b, [b[0] - thick, b[1]], [a[0] - thick * 1.4, a[1]]], w * 0.9, 0, 0.01);
    strip([gl[3][0], bz], gl[2], 0.07); strip([gl[1][0] + 0.07, gl[1][1]], [gl[0][0] + 0.1, bz], 0.07);
    for (const sd of [-1, 1]) for (const px of [gl[0][0] + 0.02, (gl[1][0] + gl[2][0]) / 2 - 0.05]) p.slab(bodyMat, 0.07, top - bz - 0.06, 0.05, px, bz + (top - bz) / 2, sd * w * 0.44);
    p.slab(trim, L * 0.38, 0.05, w * 0.86, -L * 0.3, S.belt + 0.02, 0); // the floor of the tray
    for (const s of [-1, 1]) p.box(bodyMat, L * 0.4, 0.28, 0.07, -L * 0.3, S.belt + 0.14, s * (w / 2 - 0.04), 0.02); // its sides
    p.box(bodyMat, 0.07, 0.28, w * 0.9, -L / 2 + 0.05, S.belt + 0.14, 0, 0.02); p.box(bodyMat, 0.07, 0.34, w * 0.9, -L * 0.1, S.belt + 0.17, 0, 0.02);
  }
  const wy = (S.wheel || 0.34) + lift * 0.4;
  for (const sx of [0.3, -0.3]) for (const s of [-1, 1]) wheel(p, sx * L, s * (w / 2 - 0.04), wy, 0.24, false, { mat: bodyMat, hw: w / 2 });
  // door seams, handles, the side skirt and the lower intake
  const beltY = S.belt + lift * 0.3, doorX = [gl[2][0] + 0.1, (gl[1][0] + gl[2][0]) / 2 - 0.1, gl[1][0] - 0.12];
  for (const s of [-1, 1]) {
    for (const x of doorX.filter((dx) => Math.abs(dx) < L / 2 - 0.1)) p.slab(trim, 0.014, beltY - 0.5, 0.012, x, (beltY + 0.5) / 2, s * (w / 2 + 0.004));
    for (const x of [doorX[0] - 0.22, doorX[1] - 0.22].filter((dx) => Math.abs(dx) < L / 2 - 0.1)) p.slab(chrome, 0.16, 0.025, 0.02, x, beltY - 0.08, s * (w / 2 + 0.008));
    p.slab(trim, L * 0.5, 0.09, 0.02, 0, 0.36 + lift * 0.3, s * (w / 2 + 0.006)); // the skirt
  }
  p.slab(trim, 0.03, 0.09, w * 0.62, L / 2 + 0.006, 0.47 + lift * 0.3, 0); // the intake under the bumper line
  if (S.wing) { // a wing on struts that reach the boot lid, a bonnet scoop, a wide front splitter and twin exhausts
    const wx = -L / 2 + 0.34, wyy = S.belt + 0.26;
    p.box(bodyMat, 0.3, 0.04, w * 0.9, wx, wyy, 0, 0.012); for (const s of [-1, 1]) { p.slab(trim, 0.05, 0.22, 0.04, wx, S.belt + 0.12, s * w * 0.32); p.box(bodyMat, 0.3, 0.12, 0.03, wx, wyy + 0.04, s * w * 0.45, 0.01); }
    p.box(trim, 0.34, 0.06, w * 0.3, L * 0.3, S.hood + 0.05, 0, 0.02);
    p.box(trim, 0.2, 0.04, w * 1.0, L / 2 - 0.05, 0.28, 0, 0.01);
    for (const s of [-1, 1]) p.add(chrome, new THREE.CylinderGeometry(0.045, 0.045, 0.14, 10).rotateZ(Math.PI / 2), -L / 2 - 0.02, 0.3, s * w * 0.28);
  }
  const spare = (cover) => { // a spare wheel on a carrier: a hub plate on the back door, an arm out to a hinge post at the side, and the wheel facing aft
    const r = 0.36, sy = S.belt + 0.05 + lift * 0.3, sx0 = -L / 2 - 0.15;
    p.box(trim, 0.16, 0.2, 0.3, -L / 2 - 0.08, sy, 0, 0.02); // the hub plate bolted to the door
    p.box(trim, 0.1, 0.14, w * 0.36, -L / 2 - 0.1, sy, w * 0.18, 0.02); // the arm
    p.box(trim, 0.14, 0.95, 0.12, -L / 2 - 0.1, sy - 0.1, w * 0.36, 0.02); // the hinge post down the corner
    p.add(tyre, tyreGeometry(r, 0.22), sx0, sy, 0, 0, Math.PI / 2, 0);
    p.add(rim, new THREE.CylinderGeometry(r * 0.7, r * 0.7, 0.06, 22).rotateZ(Math.PI / 2), sx0 - 0.115, sy, 0);
    if (cover) { p.add(cover, new THREE.CylinderGeometry(r * 0.84, r * 0.84, 0.05, 24).rotateZ(Math.PI / 2), sx0 - 0.135, sy, 0); p.add(chrome, new THREE.CylinderGeometry(r * 0.86, r * 0.86, 0.02, 24).rotateZ(Math.PI / 2), sx0 - 0.12, sy, 0); }
  };
  if (S.gwagon) { // a G-Wagon: a chrome grille with a badge, fender indicators, running boards, wide arches, a covered spare and a roof rail
    const gy = 0.8 + lift * 0.3;
    p.box(chrome, 0.05, 0.42, w * 0.56, L / 2 + 0.02, gy, 0, 0.01); for (let i = 1; i < 5; i += 1) p.slab(trim, 0.03, 0.03, w * 0.52, L / 2 + 0.05, gy - 0.21 + i * 0.07, 0);
    p.add(chrome, new THREE.CylinderGeometry(0.07, 0.07, 0.02, 14).rotateZ(Math.PI / 2), L / 2 + 0.055, gy + 0.08, 0); // the badge
    for (const sd of [-1, 1]) { p.box(orange, 0.1, 0.06, 0.04, L * 0.34, S.belt - 0.12 + lift * 0.3, sd * (w / 2 + 0.005), 0.01); p.slab(trim, L * 0.3, 0.05, 0.16, 0.0, 0.44 + lift * 0.3, sd * (w / 2 + 0.08)); p.slab(chrome, L * 0.5, 0.025, 0.02, -L * 0.18, S.roof + 0.05, sd * w * 0.4); }
    for (const sx of [0.3, -0.3]) for (const sd of [-1, 1]) p.box(trim, 0.9, 0.05, 0.1, sx * L, wy + 0.4 + 0.1, sd * (w / 2 + 0.01), 0.02);
    p.box(chrome, 0.1, 0.1, w * 0.8, L / 2 + 0.03, 0.5 + lift * 0.3, 0, 0.02); // a bumper bar
    spare(bodyMat);
  }
  if (S.grand) { // a big chrome grille, a bonnet ornament, chrome trim under the windows and along the sills
    p.box(chrome, 0.05, 0.24, w * 0.36, L / 2 + 0.03, 0.64 + lift * 0.3, 0, 0.01); for (let i = 1; i < 8; i += 1) p.slab(trim, 0.02, 0.2, 0.014, L / 2 + 0.062, 0.64 + lift * 0.3, -w * 0.18 + i * w * 0.36 / 8);
    p.cylY(chrome, 0.03, 0.08, L * 0.43, S.hood + 0.1, 0, 6);
    for (const s of [-1, 1]) { p.slab(chrome, L * 0.5, 0.025, 0.02, 0.0, S.belt + 0.03, s * (w / 2 + 0.009)); p.slab(chrome, L * 0.5, 0.025, 0.02, 0.0, 0.42, s * (w / 2 + 0.009)); }
    for (const s of [-1, 1]) p.add(chrome, new THREE.CylinderGeometry(0.04, 0.04, 0.1, 10).rotateZ(Math.PI / 2), -L / 2 - 0.02, 0.32, s * w * 0.3);
  }
  p.box(trim, 0.1, 0.24, w * 0.92, L / 2 - 0.02, 0.42 + lift * 0.3, 0, 0.03); p.box(trim, 0.1, 0.22, w * 0.92, -L / 2 + 0.02, 0.42 + lift * 0.3, 0, 0.03); // bumpers
  if (!S.grand) { p.slab(trim, 0.03, 0.14, w * 0.5, L / 2 + 0.005, 0.66 + lift * 0.3, 0); // the grille
    for (let i = 0; i < 4; i += 1) p.slab(chrome, 0.02, 0.012, w * 0.46, L / 2 + 0.022, 0.61 + i * 0.035 + lift * 0.3, 0); } // grille bars
  if (!S.wing && !S.grand) p.add(chrome, new THREE.CylinderGeometry(0.035, 0.035, 0.08, 10).rotateZ(Math.PI / 2), -L / 2 - 0.02, 0.3, w * 0.3); // one exhaust tip
  if (S.round) { // round headlamps in a dark bezel, as on a jeep or a G-Wagon
    for (const sd of [-1, 1]) { const hz = sd * (w / 2 - 0.36), hy = 0.78 + lift * 0.3; p.add(trim, new THREE.CylinderGeometry(0.15, 0.15, 0.1, 18).rotateZ(Math.PI / 2), L / 2 - 0.02, hy, hz); p.add(headMat, new THREE.CylinderGeometry(0.115, 0.115, 0.04, 18).rotateZ(Math.PI / 2), L / 2 + 0.035, hy, hz); }
  } else head(p, L, w, 0.7 + lift * 0.3);
  tailLamps(p, tail, L, w, 0.74 + lift * 0.3); indicators(p, indL, indR, L, w, 0.62 + lift * 0.3); plates(p, L, 0.5 + lift * 0.3); mirrors(p, bodyMat, gl[3][0] - 0.05, S.belt + 0.12 + lift * 0.3, w);
  if (kind === 'taxi') { p.box(white, 0.3, 0.14, 0.5, (gl[1][0] + gl[2][0]) / 2, top + 0.14, 0, 0.04); p.slab(yellow, 0.31, 0.05, 0.51, (gl[1][0] + gl[2][0]) / 2, top + 0.14, 0); }
  return { roofY: top + 0.1, roofX: (gl[1][0] + gl[2][0]) / 2, belt: S.belt };
}

// ---------- vans ----------
function buildVan(p, group, id, L, W, bodyMat, tail, indL, indR, kind) {
  const delivery = kind === 'delivery' ? true : kind === 'panel' ? false : hash(id, 3) < 0.55, h = L / 2, roof = 2.0, base = 1.1;
  const xs = (y) => L * 0.16 + (roof - y) / (roof - base) * L * 0.2; // where the windscreen line is at height y
  // the side silhouette: a tall box behind, a windscreen that slopes down to a short bonnet, rounded at the corners
  p.profile(bodyMat, [[-h, 0.38], [-h, roof - 0.12], [-h + 0.14, roof], [L * 0.16, roof], [xs(base), base], [h - 0.3, 1.0], [h - 0.03, 0.92], [h, 0.7], [h, 0.4]], W, 0, 0.07);
  // the windscreen, with a pillar at each side
  const A = [L * 0.16, roof], B = [xs(base), base], dx = B[0] - A[0], dy = B[1] - A[1], len = Math.hypot(dx, dy), n = [-dy / len, dx / len];
  const at = (t, off) => [A[0] + dx * t + n[0] * off, A[1] + dy * t + n[1] * off];
  p.profile(glass, [at(0.06, 0.075), at(0.94, 0.075), at(0.94, 0.1), at(0.06, 0.1)], W * 0.92, 0, 0.004);
  for (const sd of [-1, 1]) p.profile(bodyMat, [at(0.03, 0.075), at(0.97, 0.075), at(0.97, 0.115), at(0.03, 0.115)], 0.08, sd * W * 0.48, 0.003);
  for (const sd of [-1, 1]) { // the cab door window follows the windscreen line, and the doors have seams and handles
    p.profile(glass, [[L * 0.05, 1.8], [xs(1.8) - 0.04, 1.8], [xs(1.3) - 0.04, 1.3], [L * 0.05, 1.3]], 0.03, sd * W / 2, 0.004);
    for (const x of [L * 0.04, L * 0.27, -L * 0.31]) p.slab(trim, 0.014, x === L * 0.27 ? 0.7 : 1.45, 0.012, x, x === L * 0.27 ? 0.85 : 1.1, sd * (W / 2 + 0.004));
    p.slab(chrome, 0.16, 0.025, 0.02, L * 0.0, 1.05, sd * (W / 2 + 0.008)); p.slab(chrome, 0.16, 0.025, 0.02, -L * 0.1, 1.05, sd * (W / 2 + 0.008));
    p.slab(trim, L * 0.92, 0.22, 0.03, -L * 0.04, 0.56, sd * (W / 2 + 0.008)); // dark lower cladding
    p.slab(trim, L * 0.62, 0.05, 0.02, -L * 0.14, 1.0, sd * (W / 2 + 0.009)); // a rub rail along the side
    p.box(trim, 0.08, 0.1, 0.08, L * 0.2, 1.5, sd * (W / 2 + 0.17), 0.02); // the mirror arm
    p.slab(trim, 0.1, 0.1, 0.02, -L * 0.26, 1.1, sd * (W / 2 + 0.009)); // the fuel flap
    p.box(glass, 0.03, 0.62, W * 0.36, -h - 0.075, roof - 0.62, sd * W * 0.21, 0.01); // the rear door windows
  }
  p.slab(trim, 0.025, 1.45, 0.03, -h - 0.078, 1.15, 0); // the line between the rear doors
  // The roof is what shows from above, so it has a rack, a vent, a seam where the cab starts and, on delivery vans, a livery stripe.
  if (delivery) p.slab(yellow, L * 0.6, 0.012, W * 0.22, -L * 0.17, roof + 0.008, 0);
  for (const z of [-W * 0.36, W * 0.36]) { p.box(trim, L * 0.44, 0.05, 0.05, -L * 0.23, roof + 0.075, z, 0.01); for (const x of [-L * 0.42, -L * 0.04]) p.slab(trim, 0.07, 0.07, 0.07, x, roof + 0.035, z); }
  for (let i = 0; i < 5; i += 1) p.box(trim, 0.05, 0.04, W * 0.78, -L * 0.43 + i * L * 0.1, roof + 0.08, 0, 0.01);
  p.slab(trim, 0.02, 0.014, W * 0.96, L * 0.17, roof + 0.004, 0); // the seam where the cab roof starts
  p.box(white, 0.5, 0.07, 0.46, L * 0.07, roof + 0.045, 0, 0.02); // a roof vent
  if (delivery) for (const sd of [-1, 1]) { p.slab(white, L * 0.28, 0.4, 0.025, -L * 0.135, 1.4, sd * (W / 2 + 0.012)); p.slab(yellow, L * 0.28, 0.07, 0.026, -L * 0.135, 1.16, sd * (W / 2 + 0.013)); }
  for (const sx of [0.32, -0.3]) for (const sd of [-1, 1]) wheel(p, sx * L, sd * (W / 2 - 0.04), 0.36, 0.26, false, { mat: bodyMat, hw: W / 2 });
  p.box(trim, 0.1, 0.24, W * 0.96, h - 0.01, 0.45, 0, 0.03); p.box(trim, 0.1, 0.24, W * 0.96, -h + 0.01, 0.45, 0, 0.03);
  fascia(p, h + 0.07, W, { headY: 0.84, grilleY: 0.78, grilleH: 0.3, grilleW: 0.42, bumperY: 0.5, bumperH: 0.26, inset: 0.34, lamp: 0.22 });
  p.cylY(trim, 0.012, 0.5, -L * 0.1, roof + 0.3, W * 0.4, 5); // an antenna
  tailLamps(p, tail, L + 0.14, W + 0.14, 1.15, 0.3, true); rearDoors(p, -h - 0.075, W, 0.5, 1.9); p.box(trim, 0.22, 0.08, W * 0.9, -h - 0.13, 0.42, 0, 0.02); // a step
  indicators(p, indL, indR, L, W, 0.7); mirrors(p, bodyMat, L * 0.2, 1.45, W);
  return { roofY: roof + 0.1, roofX: 0, belt: 1.3 };
}

// ---------- trucks ----------
function cab(p, bodyMat, x, W, height = 2.2) { // a flat-fronted truck cab
  p.box(bodyMat, 2.0, height, W, x, 0.7 + height / 2, 0, 0.12);
  p.slab(glass, 0.05, 0.9, W * 0.82, x + 1.01, 0.7 + height * 0.68, 0); // the windscreen
  for (const s of [-1, 1]) p.slab(glass, 1.1, 0.8, 0.02, x + 0.1, 0.7 + height * 0.68, s * (W / 2 + 0.005)); // the side windows
  fascia(p, x + 1.0, W, { headY: 1.05, grilleY: 1.1, grilleH: 0.65, grilleW: 0.5, bumperY: 0.62, bumperH: 0.3, inset: 0.4 });
  p.slab(bodyMat, 0.3, 0.07, W * 0.96, x + 1.02, 0.7 + height * 0.68 + 0.5, 0); // the sun visor
  for (const s of [-1, 1]) {
    p.box(chrome, 0.12, 0.35, 0.1, x + 0.9, 2.15, s * (W / 2 + 0.12), 0.02); // the mirror
    p.slab(chrome, 0.05, 0.05, 0.1, x + 0.88, 2.15, s * (W / 2 + 0.06)); // its arm
    const z = s * (W / 2 + 0.02), top = 0.7 + height; // the door: a frame round the window, a handle, and two steps under it
    p.slab(trim, 0.03, height - 0.25, 0.015, x - 0.55, 0.7 + (height - 0.25) / 2 + 0.05, z); p.slab(trim, 0.03, height - 0.25, 0.015, x + 0.62, 0.7 + (height - 0.25) / 2 + 0.05, z);
    p.slab(trim, 1.17, 0.03, 0.015, x + 0.035, 0.78, z); p.slab(trim, 1.17, 0.03, 0.015, x + 0.035, top - 0.2, z);
    p.slab(chrome, 0.22, 0.04, 0.025, x + 0.35, 0.7 + height * 0.45, z + s * 0.01);
    for (const sy of [0.42, 0.7]) p.box(trim, 0.5, 0.05, 0.22, x + 0.3, sy, s * (W / 2 - 0.02), 0.01);
    p.box(chrome, 0.3, 0.24, 0.5, x - 0.2, 0.5, s * (W / 2 - 0.35), 0.02); // the battery box under the cab, behind the steps
  }
}
function chassis(p, L, W, x0, x1) { p.box(trim, x1 - x0, 0.25, W * 0.7, (x0 + x1) / 2, 0.62, 0, 0.02); }
function buildTruck(p, group, id, L, W, bodyMat, tail, indL, indR, kind) {
  const variant = ['box', 'tipper', 'flatbed', 'garbage'].includes(kind) ? kind : ['box', 'tipper', 'flatbed', 'garbage'][Math.floor(hash(id, 4) * 4)];
  const rear = -L / 2, cabX = L / 2 - 1.0;
  cab(p, bodyMat, cabX, W);
  chassis(p, L, W, rear, cabX);
  const bodyLen = L - 2.4, bx = rear + bodyLen / 2 + 0.1;
  if (variant === 'box') { p.box(white, bodyLen, 2.6, W * 0.98, bx, 2.1, 0, 0.06); const panel = Math.max(2, Math.round(bodyLen / 1.5)), pw = bodyLen / panel; // the box is built of panels: vertical seams, a top and a bottom rail, a logo panel and a roof edge
    for (const sd of [-1, 1]) {
      const z = sd * (W * 0.49 + 0.012);
      for (let i = 1; i < panel; i += 1) p.slab(trim, 0.025, 2.4, 0.02, rear + 0.1 + i * pw, 2.1, z);
      p.slab(trim, bodyLen, 0.06, 0.025, bx, 3.32, z); p.slab(trim, bodyLen, 0.08, 0.025, bx, 0.92, z);
      p.slab(pickFrom(CARGO_LIVERY, id, 24), bodyLen * 0.5, 0.7, 0.026, bx - bodyLen * 0.05, 2.45, z); p.slab(white, bodyLen * 0.3, 0.16, 0.028, bx - bodyLen * 0.05, 2.45, z); // a company panel with a pale stripe
      p.slab(yellow, bodyLen * 0.9, 0.1, 0.024, bx, 1.15, z);
    }
    p.box(trim, bodyLen * 0.9, 0.06, W * 0.96, bx, 3.4, 0, 0.01); // the roof edge
    p.slab(trim, 0.03, 2.2, W * 0.8, rear + 0.12, 2.0, 0); }
  else if (variant === 'tipper') { p.box(orange, bodyLen, 1.4, W * 0.96, bx, 1.65, 0, 0.05); p.box(mat('#6b5a45', 0.95), bodyLen * 0.94, 0.14, W * 0.84, bx - 0.05, 2.33, 0, 0.04); // an open bed with a load of gravel heaped in it
    p.box(orange, 0.12, 0.7, W * 0.96, bx + bodyLen / 2 - 0.05, 2.7, 0, 0.03); // the headboard over the cab
    for (const s of [-1, 1]) { p.slab(trim, bodyLen, 0.07, 0.07, bx, 2.36, s * (W * 0.48)); p.slab(trim, 0.05, 1.3, 0.05, bx - bodyLen * 0.3, 1.65, s * (W * 0.48 + 0.02)); p.slab(trim, 0.05, 1.3, 0.05, bx + bodyLen * 0.1, 1.65, s * (W * 0.48 + 0.02)); } // the rim of the bed and its ribs
    p.box(trim, 0.35, 0.3, W * 0.5, bx - bodyLen * 0.5 + 0.1, 1.0, 0, 0.02); }
  else if (variant === 'flatbed') { p.box(trim, bodyLen, 0.2, W, bx, 1.0, 0, 0.02); for (let i = 0; i < 3; i++) p.box(mat('#b88a52', 0.85), bodyLen * 0.28, 0.85, W * 0.8, bx - bodyLen * 0.3 + i * bodyLen * 0.3, 1.5, 0, 0.04); for (const s of [-1, 1]) p.slab(chrome, bodyLen, 0.04, 0.04, bx, 1.12, s * (W / 2));
    for (let i = 0; i < 3; i++) { const cx = bx - bodyLen * 0.3 + i * bodyLen * 0.3; for (const dz of [-0.45, 0.45]) p.slab(trim, 0.08, 0.9, W * 0.8 + 0.02, cx + dz * bodyLen * 0.1, 1.5, 0); p.slab(trim, bodyLen * 0.2, 0.02, 0.1, cx, 1.93, W * 0.25); } // straps over each crate
    for (let i = 0; i < 5; i++) for (const s of [-1, 1]) p.slab(trim, 0.06, 0.45, 0.06, bx - bodyLen / 2 + 0.3 + i * (bodyLen - 0.6) / 4, 1.3, s * (W / 2 - 0.02)); // stakes along the bed
    p.box(trim, 0.1, 1.5, W * 0.96, bx + bodyLen / 2 + 0.05, 1.75, 0, 0.02); } // a headboard behind the cab
  else { p.box(green, bodyLen, 2.4, W * 0.98, bx, 2.0, 0, 0.16); p.box(trim, 0.7, 1.2, W * 0.8, rear + 0.25, 1.4, 0, 0.04); p.slab(yellow, 0.05, 0.3, W * 0.7, rear + 0.02, 2.4, 0); for (const s of [-1, 1]) {
      const z = s * (W * 0.49 + 0.014);
      p.slab(white, bodyLen * 0.6, 0.12, 0.02, bx + 0.3, 2.45, z); // the pale stripe
      p.slab(trim, 0.03, 1.5, 0.02, bx + bodyLen * 0.12, 1.65, z); p.slab(trim, 0.03, 1.5, 0.02, bx - bodyLen * 0.28, 1.65, z); // the seams between the hopper, the packer and the tank
      p.box(trim, 0.9, 0.7, 0.03, bx - bodyLen * 0.08, 1.55, z, 0.01); p.slab(chrome, 0.7, 0.03, 0.035, bx - bodyLen * 0.08, 1.9, z); // an inspection hatch with a handle
      p.slab(yellow, 0.4, 0.4, 0.022, bx + bodyLen * 0.34, 1.5, z); p.slab(trim, 0.28, 0.06, 0.024, bx + bodyLen * 0.34, 1.5, z); // a hazard panel
      limb(p, trim, [rear + 0.2, 1.2], [rear + 0.7, 2.5], s * (W * 0.35), 0.1, 0.1); // a lifter arm up the back of the hopper
    }
    p.box(trim, 0.15, 0.12, W * 0.8, rear + 0.45, 2.55, 0, 0.02); // the rail the bins are tipped over
    p.box(orange, 0.2, 0.18, 0.4, cabX + 0.2, 3.05, 0, 0.04); p.slab(yellow, 0.21, 0.04, 0.41, cabX + 0.2, 3.12, 0); } // an amber beacon on the cab roof
  for (const x of [cabX + 0.1, rear + 1.4, rear + 2.7]) for (const s of [-1, 1]) wheel(p, x, s * (W / 2 - 0.05), 0.5, 0.32, x !== cabX + 0.1, { mat: trim, hw: W / 2 });
  p.box(trim, 0.12, 0.28, W * 0.96, L / 2 - 0.02, 0.5, 0, 0.03); p.box(trim, 0.1, 0.18, W * 0.9, rear + 0.02, 0.5, 0, 0.03);
  heavyRear(p, rear, W, rear + 1.4); if (variant === 'box') { rearDoors(p, rear + 0.1, W, 1.0, 3.2); for (const z of [-W * 0.2, W * 0.2]) p.slab(chrome, 0.03, 2.3, 0.03, rear + 0.088, 2.1, z); }
  for (const sd of [-1, 1]) { if (sd > 0) p.add(chrome, new THREE.CylinderGeometry(0.28, 0.28, 1.1, 14).rotateZ(Math.PI / 2), cabX - 1.5, 0.62, sd * (W / 2 - 0.2)); p.slab(trim, 1.1, 0.04, 0.3, cabX - 1.5, 0.9, sd * (W / 2 - 0.2)); } // a fuel tank on one side and a step on the other // locking bars on the box doors
  tailLamps(p, tail, L, W, 0.82, 0.25); indicators(p, indL, indR, L, W, 0.85); plates(p, L, 0.55);
  return { roofY: 2.95, roofX: cabX, belt: 1.5 };
}
function buildSemi(p, group, id, L, W, bodyMat, tail, indL, indR) {
  const rear = -L / 2, cabX = L / 2 - 1.2, trailerLen = L - 3.4;
  cab(p, bodyMat, cabX, W, 2.4);
  p.box(trim, 3.0, 0.3, W * 0.7, cabX - 2.2, 0.8, 0, 0.02); // the chassis behind the cab
  p.box(chrome, 0.3, 0.7, 0.14, cabX - 0.1, 3.0, W / 2 - 0.1, 0.02); p.box(chrome, 0.3, 0.7, 0.14, cabX - 0.1, 3.0, -W / 2 + 0.1, 0.02); // exhaust stacks
  const tx = rear + trailerLen / 2;
  const livery = [mat('#e9ebec', 0.65), mat('#2f5d8f', 0.6), mat('#c8d6e5', 0.6), mat('#d9d4c4', 0.7)][Math.floor(hash(id, 5) * 4)];
  p.box(livery, trailerLen, 2.9, W * 0.99, tx, 2.3, 0, 0.05);
  p.slab(trim, trailerLen, 0.4, W * 0.7, tx, 0.85, 0); // under the trailer
  const semiAxles = [cabX + 0.1, cabX - 3.1, cabX - 4.2, rear + 1.0, rear + 2.2];
  for (let i = 0; i < 7; i++) { const rx = tx - trailerLen / 2 + 0.4 + i * trailerLen / 7; if (semiAxles.some((ax) => Math.abs(rx - ax) < 1.0)) continue; for (const sd of [-1, 1]) p.slab(trim, 0.04, 2.5, 0.03, rx, 2.35, sd * (W / 2 + 0.005)); } // ribs, clear of the wheels
  for (const sd of [-1, 1]) {
    p.slab(trim, trailerLen - 3.2, 0.22, 0.04, tx + 0.4, 0.98, sd * (W / 2 + 0.01)); // a side guard rail between the axle sets
    p.slab(livery, trailerLen * 0.9, 0.12, 0.03, tx, 3.4, sd * (W / 2 + 0.012)); // a coloured stripe along the top
    p.slab(trim, 0.1, 0.9, 0.1, tx + trailerLen / 2 - 1.6, 0.55, sd * 0.9); p.slab(trim, 0.4, 0.06, 0.4, tx + trailerLen / 2 - 1.6, 0.1, sd * 0.9); // the landing legs
  }
  p.slab(trim, 0.8, 0.1, W * 0.5, tx + trailerLen / 2 - 0.6, 0.78, 0); // the kingpin plate
  for (const x of [cabX + 0.1, cabX - 3.1, cabX - 4.2, rear + 1.0, rear + 2.2]) for (const s of [-1, 1]) wheel(p, x, s * (W / 2 - 0.05), 0.52, 0.34, x !== cabX + 0.1, { mat: trim, hw: W / 2 });
  p.box(trim, 0.12, 0.28, W * 0.96, L / 2 - 0.02, 0.55, 0, 0.03);
  heavyRear(p, rear, W, rear + 1.0, 0.85); rearDoors(p, rear, W, 1.0, 3.6); for (const z of [-W * 0.32, -W * 0.12, W * 0.12, W * 0.32]) p.slab(chrome, 0.03, 2.6, 0.03, rear - 0.012, 2.3, z); // the trailer doors and their locking bars
  tailLamps(p, tail, L, W, 0.9, 0.25); indicators(p, indL, indR, L, W, 0.9); plates(p, L, 0.6);
  return { roofY: 3.3, roofX: cabX, belt: 1.5 };
}

// ---------- buses ----------
function buildBus(p, group, id, L, W, bodyMat, tail, indL, indR, kind) {
  const school = kind === 'school', double = kind === 'double', artic = kind === 'artic';
  const H = double ? 4.1 : 3.0;
  const body = school ? yellow : bodyMat;
  const doors = artic ? [L * 0.17, -L * 0.19] : [L * 0.17, -L * 0.1]; // between the axles, clear of the wheel wells
  const doorTop = double ? 2.4 : 2.5;
  // A band of side windows that stops at each door, so a door is never drawn over a window. Each window is its own pane.
  const gaps = [...doors.map((dx) => [dx - 0.68, dx + 0.68]), ...(artic ? [[-0.1 - 0.85, -0.1 + 0.85]] : [])].sort((u, v) => u[0] - v[0]); // doors, and the bellows of an articulated bus
  const windowBand = (x0, x1, y, h, d) => {
    const free = []; let at = x0;
    for (const [g0, g1] of gaps) { if (g0 > at) free.push([at, Math.min(g0, x1)]); at = Math.max(at, g1); }
    if (at < x1) free.push([at, x1]);
    for (const [f0, f1] of free) {
      if (f1 - f0 < 1.0) continue; // no slivers: a bay shorter than a proper window is left as body
      const n = Math.max(1, Math.round((f1 - f0) / 1.4)), pane = (f1 - f0) / n;
      for (let i = 0; i < n; i += 1) p.slab(glass, pane - 0.14, h, d, f0 + (i + 0.5) * pane, y, 0); // a window with a pillar of body between it and the next
    }
  };
  if (artic) {
    const front = L * 0.5 - 0.4, rearLen = L - front - 1.1; // two bodies joined by a bellows
    p.box(body, front, H - 0.2, W, L / 2 - front / 2, 0.45 + (H - 0.2) / 2, 0, 0.12);
    p.box(body, rearLen, H - 0.2, W, -L / 2 + rearLen / 2, 0.45 + (H - 0.2) / 2, 0, 0.12);
    p.box(trim, 1.2, H - 0.5, W * 0.9, L / 2 - front - 0.5, 0.45 + (H - 0.5) / 2, 0, 0.04); // the bellows
    windowBand(-L * 0.455, L * 0.395, 2.0, 0.95, W + 0.02); p.slab(body, 1.2, 0.2, W * 0.9, L / 2 - front - 0.5, 3.0, 0);
  } else {
    p.box(body, L, H - 0.2, W, 0, 0.45 + (H - 0.2) / 2, 0, 0.14);
    windowBand(-L * 0.46, L * 0.42, double ? 1.85 : 2.0, 0.95, W + 0.02);
    if (double) { const n = Math.round(L * 0.88 / 1.4), pane = L * 0.88 / n; for (let i = 0; i < n; i += 1) p.slab(glass, pane - 0.14, 0.9, W + 0.02, -L * 0.46 + (i + 0.5) * pane, 3.4, 0); p.slab(body, L * 0.9, 0.12, W + 0.02, -L * 0.02, 2.62, 0); }
  }
  // the windscreen in two halves round a centre pillar, with wipers and a sun visor, a destination sign over it, and for a double decker a second screen above
  p.box(glass, 0.06, 1.4, W * 0.92, L / 2 + 0.012, 1.95, 0, 0.01); p.slab(body, 0.08, 1.4, 0.08, L / 2 + 0.035, 1.95, 0); p.slab(body, 0.09, 0.08, W * 0.94, L / 2 + 0.03, 2.68, 0);
  for (const z of [-W * 0.22, W * 0.12]) p.slab(trim, 0.03, 0.03, 0.7, L / 2 + 0.05, 1.42, z);
  if (double) { p.box(glass, 0.06, 0.95, W * 0.92, L / 2 + 0.012, 3.4, 0, 0.01); p.slab(body, 0.08, 0.95, 0.08, L / 2 + 0.035, 3.4, 0); }
  p.box(trim, 0.07, 0.34, W * 0.72, L / 2 + 0.02, (double ? 4.0 : 2.88) + 0.0, 0, 0.01); p.slab(orange, 0.02, 0.12, W * 0.5, L / 2 + 0.058, double ? 4.0 : 2.88, 0); // the destination sign
  for (const s of [-1, 1]) { // doors and window frames
    for (const x of doors) { // a door: a frame round two glass leaves with a seam between
      // Layers on the side, from the body outward: the skirt and the pale band, the window pillars, then the doors on top, so nothing shows through a door.
      const z = s * (W / 2 + 0.05);
      const dh = doorTop - 0.4, gh = dh - 0.28; // the door runs from the sill up to the top of the windows
      p.slab(trim, 1.1, dh, 0.026, x, 0.4 + dh / 2, z); p.slab(glass, 0.46, gh, 0.03, x - 0.26, 0.55 + gh / 2, z + s * 0.004); p.slab(glass, 0.46, gh, 0.03, x + 0.26, 0.55 + gh / 2, z + s * 0.004);
      p.slab(chrome, 0.02, gh, 0.034, x, 0.55 + gh / 2, z + s * 0.008); p.slab(chrome, 1.0, 0.03, 0.034, x, 0.58, z + s * 0.008);
    }
  }
  if (!double && !school) p.box(trim, L * 0.22, 0.28, W * 0.6, -L * 0.2, H + 0.12, 0, 0.05); // the air conditioner on the roof
  if (school) {
    p.box(red, 0.05, 0.25, 0.4, L / 2 + 0.03, 2.85, W * 0.3, 0.02); p.box(red, 0.05, 0.25, 0.4, L / 2 + 0.03, 2.85, -W * 0.3, 0.02); }
  const axles = artic ? [L * 0.35, -L * 0.04, -L * 0.36] : double ? [L * 0.3, -L * 0.3] : [L * 0.3, -L * 0.28];
  for (const x of axles) for (const s of [-1, 1]) wheel(p, x, s * (W / 2 - 0.04), 0.5, 0.3, x !== axles[0], { mat: body, hw: W / 2 }); // wheels, twin at the back, each in a well
  const runs = artic ? [[-L * 0.46, -0.1 - 0.85], [-0.1 + 0.85, L * 0.46]] : [[-L * 0.46, L * 0.46]]; // the skirt and band stop at the bellows of an articulated bus
  for (const s of [-1, 1]) for (const [r0, r1] of runs) { p.slab(trim, r1 - r0, 0.2, 0.03, (r0 + r1) / 2, 0.5, s * (W / 2 + 0.008)); if (!school) p.slab(white, r1 - r0, 0.16, 0.026, (r0 + r1) / 2, 1.0, s * (W / 2 + 0.012)); } // the skirt and a pale band
  p.box(trim, 0.12, 0.3, W * 0.96, -L / 2 + 0.02, 0.5, 0, 0.03);
  fascia(p, L / 2, W, { headY: 0.88, grilleY: 0.98, grilleH: 0.5, grilleW: 0.4, bumperY: 0.5, bumperH: 0.3, inset: 0.36 });
  p.box(trim, 0.05, 0.8, W * 0.62, -L / 2 - 0.005, 1.0, 0, 0.01); for (let i = 0; i < 6; i += 1) p.slab(chrome, 0.02, 0.025, W * 0.58, -L / 2 - 0.03, 0.7 + i * 0.12, 0); // the engine grille
  p.box(glass, 0.05, double ? 0.7 : 0.85, W * 0.76, -L / 2 - 0.005, 2.25, 0, 0.01); if (double) p.box(glass, 0.05, 0.8, W * 0.76, -L / 2 - 0.005, 3.5, 0, 0.01); // the rear windows
  tailLamps(p, tail, L, W, 1.5, 0.26, true); indicators(p, indL, indR, L, W, 0.88); p.slab(plate, 0.02, 0.12, 0.42, -L / 2 - 0.01, 0.55, 0); mirrors(p, trim, L / 2 - 0.4, 2.3, W);
  return { roofY: H + 0.3, roofX: 0, belt: 2.0 };
}

// ---------- two and three wheelers ----------
// A bar between two points in the side view, for limbs.
function limb(p, material, [ax, ay], [bx, by], z, t = 0.13, tz = 0.13) {
  const len = Math.hypot(bx - ax, by - ay);
  p.add(material, new RoundedBoxGeometry(len + t * 0.6, t, tz, 2, Math.min(t, tz) * 0.42), (ax + bx) / 2, (ay + by) / 2, z, 0, 0, Math.atan2(by - ay, bx - ax)); // rounded, so a rider is not made of planks
}
// A rider seated on the hip point, leaning to the bars with hands on them, thighs to the knees and shins down to the foot rest.
function rider(p, id, hip, bar, foot, kneeUp, jacket, skin, helmet) {
  const trousers = mat(pickFrom(['#2b3a55', '#3a3a3d', '#4a4034', '#1f2a3a'], id, 14), 0.8);
  const [hx, hy] = hip, shoulder = [hx + 0.06, hy + 0.5], knee = [foot[0] + 0.12, hy + kneeUp];
  limb(p, jacket, hip, shoulder, 0, 0.3, 0.42); // the torso, leaning a little forward
  for (const s of [-1, 1]) {
    limb(p, jacket, [shoulder[0], shoulder[1] - 0.04], [bar[0], bar[1]], s * 0.21, 0.085, 0.085); // the arm to the grip
    limb(p, trousers, hip, knee, s * 0.15, 0.15, 0.15); // the thigh
    limb(p, trousers, knee, foot, s * 0.15, 0.13, 0.13); // the shin
    p.box(trim, 0.2, 0.08, 0.13, foot[0] + 0.05, foot[1] - 0.03, s * 0.15, 0.02); // the shoe
  }
  for (const s of [-1, 1]) p.add(jacket, new THREE.SphereGeometry(0.1, 10, 8), shoulder[0], shoulder[1] - 0.03, s * 0.22); // the shoulders
  p.add(jacket, new THREE.CylinderGeometry(0.08, 0.1, 0.1, 10), shoulder[0] + 0.03, shoulder[1] + 0.07, 0); // the collar
  p.add(skin, new THREE.SphereGeometry(0.1, 10, 8), shoulder[0] + 0.1, shoulder[1] + 0.17, 0);
  p.add(helmet, new THREE.SphereGeometry(0.17, 12, 10), shoulder[0] + 0.05, shoulder[1] + 0.23, 0);
}
// Two fork legs from the wheel up to the steering head, a stem, and a handlebar with a grip and a brake lever at each end and a mirror.
function bars(p, axleX, barX, axleY, barY, width) {
  const head = [barX - 0.04, barY - 0.1];
  for (const s of [-1, 1]) {
    limb(p, chrome, [axleX, axleY], head, s * 0.09, 0.035, 0.035);
    p.cylZ(trim, 0.021, 0.12, barX, barY, s * (width / 2 - 0.06), 8); // a grip
    p.slab(chrome, 0.12, 0.015, 0.02, barX + 0.06, barY - 0.015, s * (width / 2 - 0.1)); // the brake lever
    p.slab(chrome, 0.015, 0.14, 0.015, barX - 0.04, barY + 0.08, s * (width / 2 - 0.04)); p.box(trim, 0.06, 0.05, 0.1, barX - 0.04, barY + 0.16, s * (width / 2 - 0.04), 0.01); // a mirror on a stalk
  }
  limb(p, trim, head, [barX, barY], 0, 0.05, 0.08); // the stem
  p.cylZ(chrome, 0.013, width, barX, barY, 0, 8); // the bar
  p.cylY(chrome, 0.035, 0.1, head[0], head[1] + 0.02, 0, 8); // the steering head
}
// A mudguard: a curved plate over a wheel, from angle a0 to a1 (radians, 0 is the front, pi the back), standing off the tyre by gap.
function fender(p, material, cx, cy, r, a0, a1, width, gap = 0.04) {
  const pts = [], n = 7;
  for (let i = 0; i <= n; i += 1) { const a = a0 + (a1 - a0) * i / n; pts.push([cx + Math.cos(a) * (r + gap + 0.025), cy + Math.sin(a) * (r + gap + 0.025)]); }
  for (let i = n; i >= 0; i -= 1) { const a = a0 + (a1 - a0) * i / n; pts.push([cx + Math.cos(a) * (r + gap), cy + Math.sin(a) * (r + gap)]); }
  p.profile(material, pts, width, 0, 0.004);
}
// The back of a two wheeler: a mudguard with a plate and lamp hung from it, swing arms, shocks with springs, an exhaust with a silencer, foot pegs and a grab rail.
function twoWheelerRear(p, bodyMat, tail, L, wheelR, axleX, seatY) {
  fender(p, bodyMat, axleX, wheelR, wheelR, 0.35, Math.PI + 0.45, 0.2);
  p.box(plate, 0.02, 0.13, 0.2, axleX - wheelR - 0.04, wheelR + 0.14, 0, 0.005); // the plate
  p.box(trim, 0.06, 0.08, 0.22, axleX - wheelR - 0.03, wheelR + 0.3, 0, 0.01); // the lamp bracket
  p.box(tail, 0.07, 0.09, 0.2, axleX - wheelR - 0.03, wheelR + 0.3, 0, 0.01); // the tail lamp, on the mudguard
  for (const s of [-1, 1]) {
    limb(p, trim, [axleX, wheelR + 0.02], [axleX + 0.55, wheelR + 0.05], s * 0.11, 0.045, 0.045); // the swing arm
    limb(p, chrome, [axleX + 0.04, wheelR + 0.06], [axleX + 0.3, seatY - 0.12], s * 0.14, 0.03, 0.03); // the shock
    limb(p, red, [axleX + 0.08, wheelR + 0.14], [axleX + 0.26, seatY - 0.2], s * 0.14, 0.05, 0.05); // its spring
    p.box(trim, 0.16, 0.05, 0.08, 0.0, 0.26, s * 0.2, 0.01); // a foot peg
    limb(p, chrome, [axleX + 0.3, seatY + 0.06], [axleX + 0.05, seatY + 0.1], s * 0.13, 0.03, 0.03); // the grab rail
  }
  p.cylZ(chrome, 0.015, 0.26, axleX + 0.05, seatY + 0.1, 0, 6);
  p.add(chrome, new THREE.CylinderGeometry(0.035, 0.035, 0.7, 8).rotateZ(Math.PI / 2), axleX + 0.55, 0.3, 0.17); // the exhaust pipe
  p.add(chrome, new THREE.CylinderGeometry(0.065, 0.06, 0.36, 10).rotateZ(Math.PI / 2), axleX + 0.12, 0.34, 0.17); // the silencer
  p.add(trim, new THREE.CylinderGeometry(0.045, 0.045, 0.03, 10).rotateZ(Math.PI / 2), axleX - 0.07, 0.34, 0.17); // its dark tip
}
// Indicators on a two wheeler: an amber lamp on a short stalk, out to each side at the bars and at the tail, so they read as lamps and not as specks.
function bikeIndicators(p, indL, indR, front, rear) {
  for (const [x, y, reach, drop] of [[...front, 0.3, 0.0], [...rear, 0.2, 0.0]]) for (const [ind, sd] of [[indR, 1], [indL, -1]]) {
    p.slab(trim, 0.02, 0.02, reach - 0.06, x, y - drop, sd * (reach / 2 + 0.02)); // the stalk
    p.box(ind, 0.1, 0.07, 0.07, x, y, sd * (reach + 0.02), 0.02); // the lamp
  }
}
function buildMotorbike(p, group, id, L, W, bodyMat, tail, indL, indR) {
  const jacket = mat(pickFrom(JACKET, id, 6), 0.7), skin = mat(pickFrom(SKIN, id, 7), 0.8), helmet = mat(pickFrom(['#1c1c1f', '#e8e8e6', '#a52b2b', '#244d8f', '#c9b15a'], id, 8), 0.35, 0.3);
  wheel(p, L * 0.38, 0, 0.32, 0.14); wheel(p, -L * 0.38, 0, 0.32, 0.18);
  p.box(bodyMat, L * 0.5, 0.3, 0.3, 0.1, 0.62, 0, 0.1); // the tank
  p.box(trim, L * 0.35, 0.18, 0.28, -0.35, 0.58, 0, 0.05); // the engine
  p.box(seat, 0.5, 0.1, 0.28, -0.25, 0.78, 0, 0.03);
  bars(p, L * 0.38, L * 0.31, 0.32, 0.88, 0.56); // forks, stem and handlebars
  p.add(trim, new THREE.CylinderGeometry(0.11, 0.1, 0.14, 14).rotateZ(Math.PI / 2), L / 2 - 0.1, 0.8, 0); p.add(headMat, new THREE.CylinderGeometry(0.085, 0.085, 0.03, 14).rotateZ(Math.PI / 2), L / 2 - 0.02, 0.8, 0); // a round headlamp
  fender(p, bodyMat, L * 0.38, 0.32, 0.32, 0.2, Math.PI * 0.62, 0.17); // the front mudguard
  twoWheelerRear(p, bodyMat, tail, L, 0.32, -L * 0.38, 0.78);
  p.box(bodyMat, 0.5, 0.14, 0.26, -0.62, 0.8, 0, 0.05); // the tail section behind the seat
  rider(p, id, [-0.2, 0.86], [L * 0.31, 0.88], [-0.05, 0.3], 0.0, jacket, skin, helmet);
  bikeIndicators(p, indL, indR, [L / 2 - 0.12, 0.92], [-L / 2 + 0.1, 0.74]);
  return { roofY: 1.9, roofX: 0, belt: 1 };
}
function buildScooter(p, group, id, L, W, bodyMat, tail, indL, indR) {
  const jacket = mat(pickFrom(JACKET, id, 9), 0.7), skin = mat(pickFrom(SKIN, id, 10), 0.8), helmet = mat(pickFrom(['#e8e8e6', '#1c1c1f', '#c9b15a', '#4cb7a5'], id, 11), 0.35, 0.3);
  wheel(p, L * 0.36, 0, 0.24, 0.1); wheel(p, -L * 0.34, 0, 0.24, 0.12);
  p.box(bodyMat, L * 0.55, 0.25, 0.3, -0.25, 0.42, 0, 0.1); // the body behind the rider
  p.box(bodyMat, 0.3, 0.55, 0.3, L * 0.3, 0.55, 0, 0.1); // the front panel
  p.slab(trim, L * 0.35, 0.05, 0.28, 0.1, 0.32, 0); // the floor
  p.box(seat, 0.5, 0.08, 0.26, -0.35, 0.58, 0, 0.03); bars(p, L * 0.36, L * 0.3, 0.24, 1.0, 0.5);
  p.add(trim, new THREE.CylinderGeometry(0.1, 0.09, 0.12, 14).rotateZ(Math.PI / 2), L / 2 - 0.1, 0.82, 0); p.add(headMat, new THREE.CylinderGeometry(0.075, 0.075, 0.03, 14).rotateZ(Math.PI / 2), L / 2 - 0.03, 0.82, 0); // a round headlamp
  fender(p, bodyMat, L * 0.36, 0.24, 0.24, 0.2, Math.PI * 0.6, 0.14); // the front mudguard
  fender(p, bodyMat, -L * 0.34, 0.24, 0.24, 0.5, Math.PI + 0.3, 0.2); // the rear mudguard, which is part of the body
  p.box(plate, 0.02, 0.12, 0.18, -L / 2 - 0.02, 0.44, 0, 0.005); p.box(tail, 0.07, 0.1, 0.26, -L / 2 + 0.04, 0.6, 0, 0.02); // the plate and the tail lamp
  for (const sd of [-1, 1]) { limb(p, chrome, [-L * 0.1, 0.62], [-L * 0.42, 0.7], sd * 0.12, 0.025, 0.025); p.box(trim, 0.12, 0.05, 0.1, 0.12, 0.3, sd * 0.2, 0.01); } // the luggage rail and foot rests
  p.box(trim, 0.4, 0.05, 0.22, -L * 0.34, 0.78, 0, 0.01); // the rack
  p.add(chrome, new THREE.CylinderGeometry(0.05, 0.055, 0.5, 10).rotateZ(Math.PI / 2), -L * 0.28, 0.27, 0.17); // the exhaust
  rider(p, id, [-0.3, 0.68], [L * 0.3, 1.0], [0.2, 0.36], 0.05, jacket, skin, helmet);
  bikeIndicators(p, indL, indR, [L / 2 - 0.12, 0.98], [-L / 2 + 0.08, 0.66]);
  return { roofY: 1.8, roofX: 0, belt: 1 };
}
// ---------- emergency ----------
function lightBar(p, group, x, y, W, length = 0.5) {
  const blue = new THREE.Mesh(new THREE.BoxGeometry(length, 0.18, W * 0.2), mat(0x1b3d99, 0.4, 0, { emissive: 0x3d8bff, emissiveIntensity: 0 }));
  const redM = new THREE.Mesh(new THREE.BoxGeometry(length, 0.18, W * 0.2), mat(0x99191b, 0.4, 0, { emissive: 0xff3535, emissiveIntensity: 0 }));
  blue.position.set(x, y, W * 0.15); redM.position.set(x, y, -W * 0.15);
  group.add(blue, redM);
  return { blue, red: redM, glowB: [x, y + 0.5, W * 0.2], glowR: [x, y + 0.5, -W * 0.2] }; // where the glow of each lamp is, in the vehicle's frame. The scene lights it from a fixed set of lights (see SIREN_LIGHTS in main.js), because a light added or removed makes every lit material compile again
}
function buildAmbulance(p, group, id, L, W, bodyMat, tail, indL, indR) {
  const h = L / 2, boxTop = 2.4, cabTop = 2.02, base = 1.15, boxFront = L * 0.1;
  const xs = (y) => L * 0.22 + (cabTop - y) / (cabTop - base) * L * 0.13;
  // the silhouette: a tall patient box behind, a lower cab with a sloping windscreen, and a short bonnet
  p.profile(white, [[-h, 0.42], [-h, boxTop - 0.14], [-h + 0.16, boxTop], [boxFront, boxTop], [boxFront, cabTop], [L * 0.22, cabTop], [xs(base), base], [h - 0.3, 1.02], [h - 0.03, 0.95], [h, 0.72], [h, 0.42]], W, 0, 0.07);
  const A = [L * 0.22, cabTop], B = [xs(base), base], dx = B[0] - A[0], dy = B[1] - A[1], len = Math.hypot(dx, dy), n = [-dy / len, dx / len];
  const at = (t, off) => [A[0] + dx * t + n[0] * off, A[1] + dy * t + n[1] * off];
  p.profile(glass, [at(0.06, 0.075), at(0.94, 0.075), at(0.94, 0.1), at(0.06, 0.1)], W * 0.92, 0, 0.004);
  p.box(white, 0.08, 0.1, W * 0.96, boxFront, cabTop + 0.03, 0, 0.02); // the box overhangs the cab
  for (const sd of [-1, 1]) {
    const z = sd * (W / 2 + 0.006);
    p.profile(glass, [[L * 0.13, 1.92], [xs(1.92) - 0.04, 1.92], [xs(1.3) - 0.04, 1.3], [L * 0.13, 1.3]], 0.03, sd * W / 2, 0.004); // the cab window
    p.slab(trim, 0.014, 0.7, 0.012, L * 0.31, 0.85, z); p.slab(trim, 0.014, 1.5, 0.012, L * 0.12, 1.15, z); p.slab(chrome, 0.16, 0.025, 0.02, L * 0.17, 1.12, z + sd * 0.003); // the cab door
    p.box(glass, 0.8, 0.3, 0.03, -L * 0.08, 2.0, sd * W / 2, 0.01); // a frosted window in the box, above the lettering band and clear of the cross
    for (let i = 0; i < 10; i += 1) { // the chequered band along the side
      const x = -h + 0.35 + i * 0.4;
      p.slab(i % 2 ? yellow : green, 0.4, 0.17, 0.025, x, 1.0, sd * (W / 2 + 0.01)); p.slab(i % 2 ? green : yellow, 0.4, 0.17, 0.025, x, 1.17, sd * (W / 2 + 0.01));
    }
    p.slab(green, 1.3, 0.2, 0.025, -L * 0.1, 1.62, sd * (W / 2 + 0.01)); // the lettering band
    p.slab(red, 0.5, 0.15, 0.026, -L * 0.34, 1.95, sd * (W / 2 + 0.012)); p.slab(red, 0.15, 0.5, 0.026, -L * 0.34, 1.95, sd * (W / 2 + 0.012)); // a red cross
    p.slab(trim, L * 0.55, 0.09, 0.02, -L * 0.1, 0.4, sd * (W / 2 + 0.006)); // the skirt
    p.box(glass, 0.03, 0.6, W * 0.36, -h - 0.075, boxTop - 0.65, sd * W * 0.21, 0.01); // the rear door windows
    p.box(trim, 0.2, 0.28, 0.12, -h - 0.15, 0.6, sd * W * 0.4, 0.02); // the rear step
  }
  p.slab(trim, 0.025, 1.6, 0.03, -h - 0.078, 1.3, 0); // the line between the rear doors
  for (let i = 0; i < 4; i += 1) { p.slab(i % 2 ? yellow : green, 0.02, 0.17, W * 0.24, -h - 0.15, 1.0, (i < 2 ? -1 : 1) * W * (i % 2 ? 0.37 : 0.13)); } // chequers on the back
  p.slab(red, L * 0.34, 0.012, 0.12, -L * 0.2, boxTop + 0.008, 0); p.slab(red, 0.12, 0.012, L * 0.14, -L * 0.2, boxTop + 0.008, 0); // a red cross on the roof, for those looking down
  p.box(white, 0.5, 0.08, 0.5, -L * 0.36, boxTop + 0.05, 0, 0.02); // an air conditioner on the roof
  for (const sx of [0.3, -0.28]) for (const sd of [-1, 1]) wheel(p, sx * L, sd * (W / 2 - 0.04), 0.38, 0.26, false, { mat: white, hw: W / 2 });
  p.box(trim, 0.1, 0.24, W * 0.96, h - 0.01, 0.45, 0, 0.03); p.box(trim, 0.1, 0.24, W * 0.96, -h + 0.01, 0.45, 0, 0.03);
  fascia(p, h + 0.07, W, { headY: 0.88, grilleY: 0.8, grilleH: 0.3, grilleW: 0.42, bumperY: 0.5, bumperH: 0.26, inset: 0.34, lamp: 0.24 });
  tailLamps(p, tail, L + 0.14, W + 0.14, 1.55, 0.3, true); rearDoors(p, -h - 0.075, W, 0.6, 2.2); indicators(p, indL, indR, L, W, 0.72); p.slab(plate, 0.02, 0.12, 0.42, -h - 0.085, 0.55, 0); mirrors(p, white, L * 0.2, 1.6, W);
  return { roofY: cabTop + 0.02, roofX: L * 0.17, belt: 1.3, bar: 0.5 };
}
function buildFireEngine(p, group, id, L, W, bodyMat, tail, indL, indR) {
  const h = L / 2, cabLen = 2.6, cabX = h - cabLen / 2, rear = -h, bodyLen = L - cabLen - 0.05, bodyX = rear + bodyLen / 2, cabTop = 2.75, bodyTop = 2.55;
  // the cab: a tall box with a raked windscreen; the body behind it is lower and carries the lockers, pump and ladder
  const x0 = cabX - cabLen / 2, x1 = cabX + cabLen / 2;
  p.profile(red, [[x0, 0.7], [x0, cabTop - 0.12], [x0 + 0.12, cabTop], [x1 - 0.55, cabTop], [x1 - 0.12, 1.65], [x1, 1.5], [x1, 0.7]], W, 0, 0.08);
  screen(p, red, [x1 - 0.55, cabTop], [x1 - 0.12, 1.65], W, 0.09);
  p.box(red, bodyLen, bodyTop - 0.7, W * 0.99, bodyX, (bodyTop + 0.7) / 2, 0, 0.1);
  for (const sd of [-1, 1]) {
    const z = sd * (W / 2 + 0.006);
    p.profile(glass, [[x0 + 0.2, 2.5], [x1 - 0.62, 2.5], [x1 - 0.3, 1.8], [x0 + 0.2, 1.8]], 0.03, sd * W / 2, 0.004); // the cab windows, with a door seam between
    p.slab(trim, 0.014, 1.7, 0.012, cabX + 0.05, 1.55, z); p.slab(trim, 0.014, 1.7, 0.012, cabX - 0.95, 1.55, z); p.slab(chrome, 0.16, 0.025, 0.02, cabX - 0.2, 1.65, z + sd * 0.003);
    for (let i = 0; i < 4; i += 1) { // the equipment lockers, each a roller shutter
      const lx = rear + 0.95 + i * 1.6;
      p.slab(chrome, 1.35, 0.95, 0.02, lx, 1.85, sd * (W / 2 + 0.012)); // above the wheel flares, which reach 1.3 m
      for (let r = 1; r < 5; r += 1) p.slab(trim, 1.35, 0.012, 0.022, lx, 1.38 + r * 0.18, sd * (W / 2 + 0.014));
      p.slab(trim, 0.04, 0.12, 0.025, lx + 0.55, 1.5, sd * (W / 2 + 0.016));
    }
    for (let i = 0; i < 12; i += 1) { const cx = rear + 0.3 + i * 0.7; if ([cabX + 0.3, rear + 1.5, rear + 3.0].some((ax) => Math.abs(cx - ax) < 0.85)) continue; p.slab(i % 2 ? white : yellow, 0.4, 0.2, 0.026, cx, 0.92, sd * (W / 2 + 0.01)); } // a chequered reflective band, broken at the wheels
    p.slab(trim, L * 0.6, 0.1, 0.02, -L * 0.1, 0.62, z); // the skirt
    p.box(chrome, 0.35, 0.5, 0.06, x1 - 0.2, 1.1, sd * (W / 2 + 0.04), 0.02); // the pump panel's gauge
    p.box(trim, 0.3, 0.12, 0.34, rear - 0.1, 0.9 + sd * 0, sd * W * 0.35, 0.02); // the rear step
  }
  // the roof of the body: a ladder on two rails, a hose reel and an equipment rail, all seen from above
  for (const zz of [-0.4, 0.4]) p.slab(chrome, L * 0.58, 0.09, 0.1, -L * 0.1, bodyTop + 0.14, zz);
  for (let i = 0; i < 12; i += 1) p.slab(chrome, 0.05, 0.05, 0.84, -L * 0.37 + i * L * 0.05, bodyTop + 0.12, 0);
  p.cylZ(trim, 0.22, 0.5, -L * 0.37, bodyTop + 0.3, 0.7); p.cylZ(trim, 0.22, 0.5, -L * 0.37, bodyTop + 0.3, -0.7);
  for (let i = 0; i < 6; i += 1) { p.slab(i % 2 ? white : yellow, 0.06, 0.4, W * 0.9, rear - 0.005, 1.55, 0); } // chevrons on the back
  for (let i = 0; i < 8; i += 1) p.slab(i % 2 ? white : red, 0.026, 0.24, W * 0.48, rear - 0.012, 1.0 + (i >> 1) * 0.26, (i % 2 ? 1 : -1) * W * 0.25); // rear chevrons
  for (const wx of [cabX + 0.3, rear + 1.5, rear + 3.0]) for (const sd of [-1, 1]) wheel(p, wx, sd * (W / 2 - 0.05), 0.55, 0.34, wx !== cabX + 0.3, { mat: red, hw: W / 2 });
  fascia(p, h + 0.08, W, { headY: 1.05, grilleY: 1.05, grilleH: 0.6, grilleW: 0.46, bumperY: 0.62, bumperH: 0.34, inset: 0.4, lamp: 0.34 });
  p.cylZ(chrome, 0.1, W * 0.5, h + 0.2, 0.62, 0, 10); // the winch roller
  for (const sd of [-1, 1]) p.box(chrome, 0.12, 0.35, 0.1, x1 - 0.5, 2.25, sd * (W / 2 + 0.12), 0.02); // the mirrors
  p.box(trim, 0.45, 0.1, W * 0.92, rear - 0.2, 0.72, 0, 0.02); p.slab(yellow, 0.46, 0.012, W * 0.92, rear - 0.2, 0.775, 0); // a rear step with a yellow edge
  for (const sd of [-1, 1]) { p.slab(chrome, 0.05, 1.9, 0.05, rear - 0.03, 1.8, sd * W * 0.42); p.add(chrome, new THREE.CylinderGeometry(0.1, 0.1, 0.18, 10).rotateZ(Math.PI / 2), rear - 0.08, 1.0, sd * 0.5); } // a rear ladder and hose couplings
  for (let i = 0; i < 6; i += 1) p.slab(chrome, 0.04, 0.04, W * 0.8, rear - 0.03, 1.0 + i * 0.28, 0);
  tailLamps(p, tail, L + 0.2, W + 0.02, 1.9, 0.3, true); indicators(p, indL, indR, L, W, 1.0); p.slab(plate, 0.02, 0.14, 0.46, rear - 0.05, 0.7, 0);
  return { roofY: cabTop + 0.02, roofX: cabX - 0.3, belt: 2.0 };
}

// ---------- the one function the scene calls ----------
// cls is a simulator class. The look inside a class comes from the id, so the same vehicle always looks the same.
// kind says which look inside the class, from the simulation and the clock (a school bus, a bin lorry, a taxi). Left out, the id picks one, as in the galleries.
export function buildVehicle(cls, id, region = 'au', kind) {
  const group = new THREE.Group();
  const c = CLASSES[cls];
  const L = c.length, W = c.width;
  const tail = mat(0x6b1010, 0.5, 0, { emissive: 0xff2a2a, emissiveIntensity: 0.15 });
  const indL = mat(0x8a5a00, 0.5, 0, { emissive: 0xffa000, emissiveIntensity: 0 }), indR = indL.clone();
  group.userData = { tail, indL, indR, siren: null };
  const p = new Parts();
  let taxi = false;
  let colour = weighted(CAR_COLOURS, hash(id, 2));
  if (cls === 'car' && (kind === undefined ? hash(id, 14) < 0.07 : kind === 'taxi')) { taxi = true; colour = region === 'in' || hash(id, 15) < 0.4 ? '#f2c418' : '#f4f4f2'; }
  if (cls === 'police') colour = '#f1f3f5';
  const bodyMat = mat(colour, 0.38, 0.35, { });
  let extent;
  if (cls === 'car' || cls === 'police') extent = buildCar(p, group, id, L, W, bodyMat, tail, indL, indR, cls === 'police' ? 'police' : taxi ? 'taxi' : '');
  else if (cls === 'van') extent = buildVan(p, group, id, L, W, mat(pickFrom(['#f1f1ee', '#e4e6e8', '#2e4a6b', '#7c8085'], id, 16), 0.5, 0.2), tail, indL, indR, kind);
  else if (cls === 'truck') extent = buildTruck(p, group, id, L, W, mat(pickFrom(['#c0392b', '#2f5d8f', '#e9ebec', '#3d6b4a', '#d9a21b', '#7c8085'], id, 17), 0.55, 0.15), tail, indL, indR, kind);
  else if (cls === 'semi') extent = buildSemi(p, group, id, L, W, mat(pickFrom(['#c0392b', '#2f5d8f', '#e9ebec', '#1c1f24', '#d9a21b'], id, 18), 0.5, 0.2), tail, indL, indR);
  else if (cls === 'bus' || cls === 'artbus') {
    const busKind = cls === 'artbus' ? 'artic' : kind !== undefined ? (kind === 'school' || kind === 'double' ? kind : '') : hash(id, 19) < 0.12 ? 'school' : hash(id, 20) < 0.14 ? 'double' : '';
    extent = buildBus(p, group, id, L, W, mat(region === 'in' ? pickFrom(['#2f7d4a', '#c0392b', '#2f5d8f'], id, 21) : pickFrom(['#2a8c9c', '#2f5d8f', '#e9ebec', '#c0392b'], id, 21), 0.5, 0.2), tail, indL, indR, busKind);
  } else if (cls === 'bike') extent = buildMotorbike(p, group, id, L, W, mat(pickFrom(['#a52b2b', '#244d8f', '#1b1d21', '#c3c7cc', '#2f5d46'], id, 22), 0.4, 0.4), tail, indL, indR);
  else if (cls === 'scooter') extent = buildScooter(p, group, id, L, W, mat(pickFrom(['#e8e8e6', '#4cb7a5', '#c9b15a', '#7e5bb5', '#a52b2b', '#244d8f'], id, 23), 0.4, 0.3), tail, indL, indR);
  else if (cls === 'fire') extent = buildFireEngine(p, group, id, L, W, bodyMat, tail, indL, indR);
  else extent = buildAmbulance(p, group, id, L, W, bodyMat, tail, indL, indR); // 'amb'
  if (taxi) { /* the roof sign is part of buildCar */ }
  p.build(group);
  if (cls === 'scooter' || cls === 'bike') group.add(headlightBeam(L, 11)); // one lamp, one beam
  else for (const side of [-1, 1]) group.add(headlightBeam(L, 17, side * W * 0.3, 0.3)); // a beam from each of the two lamps, lit only at night, by the scene
  if (cls === 'amb' || cls === 'fire' || cls === 'police') group.userData.siren = lightBar(p, group, extent.roofX || 0, extent.roofY + 0.05, W);
  if (cls === 'police') { // blue and white panels on the sides
    const panel = new Parts();
    for (const s of [-1, 1]) { panel.slab(blueTrim, L * 0.42, 0.2, 0.02, 0, 0.64, s * (W / 2 + 0.014)); }
    panel.build(group);
  }
  return group;
}
