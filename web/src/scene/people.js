// People, a pram and a cyclist, built in code. A person faces +x and stands on the ground at the origin. The limbs are smooth, the knees bend, and each person is
// a different height and build, with their own clothes, hair, hat and bag, chosen from the id so the same person always looks the same.
// The scene drives them through `userData`: `legL`, `legR`, `kneeL`, `kneeR`, `armL`, `armR` swing about z, `body` holds everything, and `extras` follow.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { geometryKey } from './shape-key.js';
import { beamHook, bikeLampGeometry, lampFront, lampRear, withNightGlow } from './night-glow.js';

const MATERIAL = withNightGlow(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), 'night-glow-people', { beam: true }); // lifted a little at night, and lit by headlights (night-glow.js)
const SKIN = ['#f3d2b3', '#e8b98c', '#d09a6b', '#a9744d', '#7b4f35', '#5a3926'];
const HAIR = ['#1b1714', '#2f2118', '#4a3322', '#7a5a38', '#b08a55', '#c9c2b4', '#8f3b1f', '#0f0f10'];
const TOPS = ['#c8423a', '#2f6fb8', '#e8b53a', '#3d9a8b', '#6d4fa3', '#eceae2', '#37424f', '#d97aa0', '#4f8a3a', '#b8955a', '#8aa6c2', '#1f2a36', '#e9704a'];
const BOTTOMS = ['#2b3038', '#3b4a60', '#58483a', '#6a6f78', '#1f2a36', '#8a7a5e', '#b9b3a3'];
const SHOES = ['#1b1b1d', '#e9e7e0', '#4a3a2c', '#2f4a7a', '#a52b2b'];

function hash(id, salt = 0) { let h = (id * 2654435761 + salt * 40503) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13; return (h >>> 0) / 4294967296; }
const pick = (list, id, salt) => list[Math.floor(hash(id, salt) * list.length) % list.length];

// A set of coloured pieces that becomes one mesh.
//
// People of the same make-up (the same pieces in the same places: the same cut of clothes, hair, build of body) differ only in colour. So, as for the vehicles (see Parts in vehicles.js), the work of putting
// the pieces together is done once for each make-up, and the next person with the same pieces takes the stored positions and normals and adds their own colours. A piece is told by a key (for the helpers
// `capsule`, `sphere`, `cyl` and `box` it is their name and numbers, so on a repeat the piece is not even made, and for a geometry handed over ready made it is a hash of its numbers), and the colours are not in it.
const SHAPES = new Map(), SHAPE_LIMIT = 160; // kept make-ups, the least recently used going first
export const shapeStats = { built: 0, reused: 0 };
const colourOf = new Map(); // the red, green and blue of a colour written as text, made once
const rgb = (colour) => { // a colour that is not text or a number (a Color made on the spot) is not remembered
  const key = typeof colour === 'string' || typeof colour === 'number' ? colour : null;
  let c = key === null ? null : colourOf.get(key);
  if (!c) { const t = new THREE.Color(colour); c = [t.r, t.g, t.b]; if (key !== null) colourOf.set(key, c); }
  return c;
};
class Bake {
  constructor() { this.items = []; }
  // `geometry` is a geometry, or the description of one that a helper gives (see below).
  add(geometry, colour, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
    const later = geometry.make !== undefined;
    this.items.push({ geometry: later ? null : geometry, make: later ? geometry.make : null, key: later ? geometry.key : geometryKey(geometry), colour, x, y, z, sx, sy, sz, rx, ry, rz });
  }
  mesh() {
    const signature = this.items.map((item) => `${item.key}@${item.x},${item.y},${item.z},${item.sx},${item.sy},${item.sz},${item.rx},${item.ry},${item.rz}`).join('|');
    let shape = SHAPES.get(signature);
    if (shape) { SHAPES.delete(signature); SHAPES.set(signature, shape); shapeStats.reused += 1; }
    else {
      const list = this.items.map((item) => {
        const geometry = item.geometry || item.make(), g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
        g.deleteAttribute('uv');
        g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(item.x, item.y, item.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(item.rx, item.ry, item.rz)), new THREE.Vector3(item.sx, item.sy, item.sz)));
        const n = g.attributes.position.count, a = new Float32Array(n * 3), c = rgb(item.colour);
        for (let i = 0; i < n; i += 1) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; }
        g.setAttribute('color', new THREE.BufferAttribute(a, 3));
        return g;
      });
      const merged = mergeGeometries(list, false);
      shape = { position: merged.attributes.position, normal: merged.attributes.normal, counts: list.map((g) => g.attributes.position.count) };
      SHAPES.set(signature, shape); shapeStats.built += 1;
      if (SHAPES.size > SHAPE_LIMIT) SHAPES.delete(SHAPES.keys().next().value);
    }
    const geometry = new THREE.BufferGeometry(), colours = new Float32Array(shape.position.count * 3);
    let at = 0;
    this.items.forEach((item, k) => { const c = rgb(item.colour); for (let n = 0; n < shape.counts[k]; n += 1, at += 3) { colours[at] = c[0]; colours[at + 1] = c[1]; colours[at + 2] = c[2]; } });
    geometry.userData.sharesShape = true; geometry.setAttribute('position', shape.position); geometry.setAttribute('normal', shape.normal); geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    const m = new THREE.Mesh(geometry, MATERIAL); m.castShadow = true; m.onBeforeRender = beamHook; return m;
  }
}
// The helpers give a description, made into a geometry only when the make-up has not been seen before.
const capsule = (r, len) => ({ key: `capsule|${r}|${len}`, make: () => new THREE.CapsuleGeometry(r, len, 3, 8) });
const sphere = (r) => ({ key: `sphere|${r}`, make: () => new THREE.SphereGeometry(r, 10, 8) });
const cyl = (rt, rb, h, seg = 10) => ({ key: `cyl|${rt}|${rb}|${h}|${seg}`, make: () => new THREE.CylinderGeometry(rt, rb, h, seg) });
const box = (w, h, d) => ({ key: `box|${w}|${h}|${d}`, make: () => new THREE.BoxGeometry(w, h, d) });

// kind: 'adult', 'child' or 'elder'. Options let a caller force one: { kind, scale, companions }.
export function buildPerson(id, { kind, scale = 1 } = {}) {
  const age = kind || (hash(id, 1) < 0.1 ? 'child' : hash(id, 1) > 0.9 ? 'elder' : 'adult');
  const woman = hash(id, 2) < 0.5;
  const skin = pick(SKIN, id, 3), top = pick(TOPS, id, 4), bottom = pick(BOTTOMS, id, 5), shoe = pick(SHOES, id, 6);
  const hairColour = age === 'elder' ? pick(['#c9c2b4', '#e6e2d8', '#8a8a86'], id, 7) : pick(HAIR, id, 7);
  const height = (age === 'child' ? 0.66 + hash(id, 8) * 0.14 : woman ? 0.93 + hash(id, 8) * 0.09 : 0.98 + hash(id, 8) * 0.1) * scale;
  const build = age === 'child' ? 0.85 : 0.88 + hash(id, 9) * 0.3; // slight to broad
  const shorts = hash(id, 10) < 0.22, skirt = woman && hash(id, 11) < 0.3, longSleeve = hash(id, 12) < 0.55, jacket = hash(id, 13) < 0.3;
  const headScale = age === 'child' ? 1.3 : 1;

  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  body.scale.set(build * (height / 1.0), height, build * height); // x is the way they face, so depth takes the build; z is shoulder width
  const hipY = 0.92, shoulderY = 1.42;

  // the trunk, the head, the hair and anything worn
  const upper = new Bake();
  const trunkColour = jacket ? pick(['#2c3138', '#6b5a43', '#3d4b5c', '#8f3b1f', '#4f6a52'], id, 14) : top;
  const waist = woman ? 0.15 : 0.17, chest = woman ? 0.18 : 0.2;
  upper.add(new THREE.CylinderGeometry(chest * 1.08, waist, 0.52, 16), trunkColour, 0, 1.13, 0, 0.72, 1, 1.12); // the torso, wider across the shoulders than front to back
  upper.add(new THREE.SphereGeometry(chest * 1.08, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), trunkColour, 0, 1.39, 0, 0.72, 0.5, 1.12); // a rounded top to it, so the shoulders slope into the neck
  upper.add(cyl(waist - 0.025, waist + 0.03, 0.2, 16), skirt ? top : bottom, 0, hipY - 0.03, 0, 0.72, 1, 1.12); // hips, tucked just inside the torso so the two colours meet in a clean line
  if (skirt) upper.add(cyl(0.17, 0.27, 0.32, 14), pick(TOPS, id, 15), 0, hipY - 0.12, 0, 0.8, 1, 1); // a skirt
  upper.add(cyl(0.05, 0.055, 0.1, 8), skin, 0, shoulderY + 0.05, 0); // the neck
  const hs = headScale, hc = 0.01;
  upper.add(sphere(0.105), skin, hc, 1.6, 0, hs, 1.15 * hs, 0.95 * hs); // the head
  // a point on the face, by angle from straight ahead (az) and up (el), so the features follow the shape of the head
  const face = (az, el, out = 0) => [hc + (0.105 * hs + out) * Math.cos(az) * Math.cos(el), 1.6 + 0.12 * hs * Math.sin(el), (0.0998 * hs + out) * Math.sin(az) * Math.cos(el)];
  upper.add(sphere(0.02), skin, ...face(0, -0.12, 0.012)); // the nose
  for (const sd of [-1, 1]) {
    upper.add(sphere(0.012), '#1b1714', ...face(sd * 0.36, 0.08, 0.002), 0.5, 1, 1); // an eye
    upper.add(sphere(0.02), skin, ...face(sd * 1.5, -0.02, 0.006), 0.6, 1, 0.8); // an ear
  }
  const bald = hash(id, 16) >= 0.8 && !woman && age !== 'child';
  const hairStyle = Math.floor(hash(id, 16) * 5);
  const hairBack = woman && hairStyle < 3 ? 0.5 : 0.27;
  for (const sd of [-1, 1]) upper.add(box(0.008, 0.008, 0.032), bald ? '#4a4038' : hairColour, ...face(sd * 0.36, 0.34, 0.003)); // a brow
  upper.add(box(0.006, 0.007, 0.034), '#8a4646', ...face(0, -0.5, 0.002)); // the mouth
  if (!bald) { // hair: a skull cap over the top, a rounded mass behind the head, a fringe, and long hair or a bun by style
    upper.add(new THREE.SphereGeometry(0.1135, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.46), hairColour, hc, 1.603, 0, hs, 1.15 * hs, 0.95 * hs);
    upper.add(sphere(0.1), hairColour, hc - 0.045 * hs, 1.585, 0, 0.82 * hs, 1.0 * hs, 0.96 * hs); // the back of the head, down to the nape
    for (const sd of [-1, 1]) upper.add(sphere(0.045), hairColour, hc - 0.01, 1.6, sd * 0.09 * hs, 0.9, 1.1, 0.7); // sideburns over the ears
    if (woman && hairStyle < 3) upper.add(capsule(0.065, 0.26), hairColour, -0.085, 1.48, 0, 0.9, 1, 1.5); // long hair down the back
    if (hairStyle === 3) upper.add(sphere(0.055), hairColour, -0.1, 1.68, 0); // a bun
  }
  const hat = hash(id, 17);
  if (hat < 0.14) { upper.add(sphere(0.115), pick(['#1f2a36', '#a52b2b', '#e8e8e6', '#2f5d46'], id, 18), 0.01, 1.64, 0, 1.0 * headScale, 0.6 * headScale, 0.95 * headScale); upper.add(box(0.12, 0.012, 0.16), '#1f2a36', 0.12 * headScale, 1.62, 0); } // a cap with a peak
  else if (hat < 0.2) upper.add(cyl(0.2, 0.2, 0.012, 14), '#c8b47a', 0, 1.67, 0), upper.add(cyl(0.1, 0.11, 0.08, 12), '#c8b47a', 0, 1.7, 0); // a sun hat
  else if (hat < 0.28) upper.add(sphere(0.115), pick(['#a52b2b', '#2f5d46', '#e9704a'], id, 19), 0.01, 1.64, 0, 1.0 * headScale, 0.7 * headScale, 0.95 * headScale); // a beanie
  if (hash(id, 20) < 0.14) upper.add(box(0.03, 0.03, 0.2), '#101214', 0.1 * headScale, 1.62, 0); // sunglasses
  const bag = hash(id, 21);
  if (bag < 0.22) upper.add(box(0.14, 0.3, 0.26), pick(['#2c3138', '#a52b2b', '#2f6fb8', '#4f8a3a'], id, 22), -0.15, 1.22, 0); // a backpack
  else if (bag < 0.38) upper.add(box(0.1, 0.2, 0.26), pick(['#6b4a2a', '#2c3138', '#a52b2b'], id, 22), 0.02, 0.98, 0.21); // a shoulder bag at the hip
  if (hash(id, 23) < 0.16) upper.add(box(0.02, 0.1, 0.06), '#c9ced4', 0.1, 1.6, 0.12); // a phone held to the ear is not shown, but earphones are
  body.add(upper.mesh());

  // a leg: a thigh, a knee and a shin with a shoe
  const leg = (side) => {
    const hip = new THREE.Group(); hip.position.set(0, hipY, side * 0.095);
    const thigh = new Bake(), shin = new Bake();
    const legColour = skirt ? skin : bottom;
    thigh.add(capsule(0.075, 0.34), legColour, 0, -0.22, 0);
    const knee = new THREE.Group(); knee.position.set(0, -0.44, 0);
    shin.add(capsule(0.06, 0.34), shorts || skirt ? skin : bottom, 0, -0.22, 0);
    shin.add(capsule(0.045, 0.12), shoe, 0.06, -0.468, 0, 1, 0.85, 1.3, 0, 0, Math.PI / 2); // a rounded shoe
    shin.add(box(0.2, 0.016, 0.1), '#d8d4c8', 0.06, -0.503, 0); // a thin sole, no longer than the shoe
    hip.add(thigh.mesh()); knee.add(shin.mesh()); hip.add(knee); body.add(hip);
    return { hip, knee };
  };
  const L = leg(1), R = leg(-1);

  // an arm: a sleeve, a forearm and a hand
  const arm = (side) => {
    const sh = new THREE.Group(); sh.position.set(0, shoulderY - 0.02, side * (0.2 * build));
    const a = new Bake(); const sleeve = longSleeve || jacket ? trunkColour : top;
    a.add(sphere(0.055), sleeve, 0, -0.03, 0); // the round of the shoulder
    a.add(capsule(0.05, 0.25), sleeve, 0, -0.17, 0);
    a.add(capsule(0.042, 0.22), longSleeve || jacket ? trunkColour : skin, 0, -0.4, 0);
    a.add(sphere(0.045), skin, 0, -0.57, 0);
    sh.add(a.mesh()); body.add(sh);
    return sh;
  };
  const armL = arm(1), armR = arm(-1);
  if (age === 'elder') { body.rotation.z = 0.1; const stick = new Bake(); stick.add(cyl(0.012, 0.012, 0.85, 6), '#6b4a2a', 0, -0.4, 0); armR.add(stick.mesh()); } // stooped, with a stick
  root.userData = { legL: L.hip, legR: R.hip, kneeL: L.knee, kneeR: R.knee, armL, armR, body, offset: id * 0.83, extras: [], age, woman };
  return root;
}

// Sit on a seat that is 0.45 m up: hips down onto it, thighs forward, shins down. `standUp` undoes it.
export function poseSitting(g, seatHeight = 0.45) {
  const u = g.userData;
  u.body.position.y = -(0.92 - seatHeight - 0.06) * u.body.scale.y;
  u.legL.rotation.z = u.legR.rotation.z = Math.PI / 2;
  u.kneeL.rotation.z = u.kneeR.rotation.z = -Math.PI / 2;
  u.armL.rotation.z = 0.5; u.armR.rotation.z = 0.5;
  u.sitting = true;
}
export function standUp(g) {
  const u = g.userData;
  u.body.position.y = 0; u.legL.rotation.z = u.legR.rotation.z = 0; u.kneeL.rotation.z = u.kneeR.rotation.z = 0; u.armL.rotation.z = u.armR.rotation.z = 0; u.sitting = false;
}
// Walking: the legs swing and the knee on the back leg bends, the arms swing the other way.
export function walkPose(g, time, moving) {
  const u = g.userData;
  if (u.sitting) return;
  const s = Math.sin(time * 6.5 * (moving > 1 ? 1.5 : 1) + u.offset) * 0.55 * Math.min(moving, 1.8);
  u.legL.rotation.z = s; u.legR.rotation.z = -s;
  u.kneeL.rotation.z = -Math.max(0, -s) * 1.1; u.kneeR.rotation.z = -Math.max(0, s) * 1.1;
  u.armL.rotation.z = -s * 0.8; u.armR.rotation.z = s * 0.8;
  for (const e of u.extras || []) e.update(time, moving);
}

// A pram with a hood, a basket, spoked wheels and a baby. It faces +x, with the handle at the back.
export function buildPram(id) {
  const g = new THREE.Group();
  const colour = pick(['#2f6fb8', '#c8423a', '#3d9a8b', '#6d4fa3', '#37424f', '#e8b53a'], id, 30);
  const frame = new Bake();
  frame.add(box(0.62, 0.16, 0.36), colour, 0.05, 0.58, 0); // the bed
  frame.add(box(0.5, 0.2, 0.01), colour, 0.05, 0.7, 0.18); frame.add(box(0.5, 0.2, 0.01), colour, 0.05, 0.7, -0.18);
  frame.add(new THREE.CylinderGeometry(0.2, 0.2, 0.36, 12, 1, false, 0, Math.PI), pick(['#f2efe6', colour, '#2c3138'], id, 31), -0.12, 0.78, 0, 1, 1, 1, Math.PI / 2, 0, 0); // the hood, a half cylinder over the baby's end
  frame.add(box(0.46, 0.04, 0.3), '#2c3138', 0.0, 0.3, 0); // the basket underneath
  for (const z of [0.2, -0.2]) { frame.add(box(0.035, 0.5, 0.035), '#2c3138', -0.355, 0.82, z, 1, 1, 1, 0, 0, 0.3); frame.add(box(0.03, 0.03, 0.04), '#2c3138', 0.05, 0.45, z * 0.75, 1, 1, 8); } // the handle posts lean back from the bed
  frame.add(box(0.04, 0.04, 0.44), '#2c3138', -0.45, 1.05, 0); // the handle
  frame.add(sphere(0.07), SKIN[Math.floor(hash(id, 32) * 3)], 0.12, 0.72, 0); // the baby's head
  frame.add(sphere(0.075), '#f2efe6', 0.12, 0.76, 0, 1, 0.7, 1); // a hat
  const wheelsBake = new Bake();
  const wheels = [];
  for (const [x, z] of [[0.26, 0.2], [0.26, -0.2], [-0.2, 0.2], [-0.2, -0.2]]) {
    const w = new Bake();
    w.add(new THREE.TorusGeometry(0.11, 0.02, 6, 14), '#1b1d21', 0, 0, 0);
    for (let i = 0; i < 3; i += 1) w.add(box(0.2, 0.012, 0.012), '#c9ced4', 0, 0, 0, 1, 1, 1, 0, 0, i * Math.PI / 3);
    const m = w.mesh(); m.position.set(x, 0.11, z); g.add(m); wheels.push(m);
  }
  g.add(frame.mesh());
  void wheelsBake;
  return { mesh: g, update(time, moving) { for (const w of wheels) w.rotation.z = -time * 4 * Math.min(moving, 1.5); } };
}

// A bicycle with a rider. The bike is a diamond frame on two spoked wheels, and the rider leans forward with bent knees, pedalling.
export function buildCyclist(id, frame = null) { // `frame`: the colour of the frame, when it is not left to the id (a hire bike is always green)
  const g = new THREE.Group();
  const frameColour = frame || pick(['#c8423a', '#2f6fb8', '#e8b53a', '#3d9a8b', '#1b1d21', '#e9e7e0'], id, 40);
  const bike = new Bake();
  const tube = (x1, y1, x2, y2, colour = frameColour, r = 0.022) => { const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy); bike.add(cyl(r, r, len, 6), colour, (x1 + x2) / 2, (y1 + y2) / 2, 0, 1, 1, 1, 0, 0, Math.atan2(dx, -dy) * -1 + Math.PI); };
  const wheelBase = 1.0, r = 0.34;
  const rear = [-wheelBase / 2, r], front = [wheelBase / 2, r], bottom = [-0.08, 0.3], seatTop = [-0.22, 0.95], headTop = [0.4, 0.95], seatJoin = [-0.2, 0.84];
  tube(...rear, ...bottom); tube(...bottom, ...front); tube(...rear, ...seatJoin); tube(...bottom, ...seatJoin); tube(...seatJoin, ...headTop); tube(...bottom, 0.36, 0.84); tube(0.36, 0.84, ...front);
  bike.add(box(0.2, 0.05, 0.1), '#1b1d21', -0.26, 0.97, 0); // the saddle
  bike.add(box(0.04, 0.04, 0.5), '#1b1d21', 0.4, 0.99, 0); // the handlebars
  bike.add(box(0.14, 0.07, 0.05), '#1b1d21', -0.05, 0.3, 0.07); bike.add(box(0.14, 0.07, 0.05), '#1b1d21', -0.05, 0.3, -0.07); // the pedals
  g.add(bike.mesh());
  const lampOn = new THREE.Mesh(bikeLampGeometry.front, lampFront), lampBack = new THREE.Mesh(bikeLampGeometry.rear, lampRear); // a white lamp on the bars and a red one under the saddle, lit at night
  lampOn.position.set(0.46, 0.93, 0); lampBack.position.set(-0.37, 0.9, 0); g.add(lampOn, lampBack);
  const wheels = [rear, front].map(([x, y]) => {
    const w = new Bake();
    w.add(new THREE.TorusGeometry(r - 0.03, 0.03, 6, 20), '#1b1d21', 0, 0, 0); // the tyre's outside is r from the hub, so it rests on the ground and does not go into it
    for (let i = 0; i < 4; i += 1) w.add(box(r * 2 - 0.04, 0.008, 0.008), '#c9ced4', 0, 0, 0, 1, 1, 1, 0, 0, i * Math.PI / 4);
    const m = w.mesh(); m.position.set(x, y, 0); g.add(m); return m;
  });
  const rider = buildPerson(id + 700, { kind: 'adult' });
  rider.position.set(-0.22, 0.05, 0);
  const u = rider.userData, h = u.body.scale.y, lean = -0.55, sin = Math.sin(lean), cos = Math.cos(lean);
  const hip = [-0.26, 1.06], grip = [0.38, 1.0]; // the hip joint just above the saddle, and the hands on the bars
  u.body.rotation.z = lean; // the body leans forward from the hips, which sit on the saddle
  u.body.position.set(hip[0] - rider.position.x + sin * 0.92 * h, hip[1] - rider.position.y - cos * 0.92 * h, 0);
  const shoulder = [hip[0] - sin * 0.48 * h, hip[1] + cos * 0.48 * h];
  u.armL.rotation.z = u.armR.rotation.z = Math.atan2(grip[1] - shoulder[1], grip[0] - shoulder[0]) + Math.PI / 2 - lean; // the arms reach the grips
  g.add(rider);
  g.userData = { wheels, rider, u, hip, lean, h };
  return g;
}
// The pedals turn on a crank round the bottom bracket, and each leg is two bones reaching from the hip to its pedal, the knee bending forward.
export function animateCyclist(g, time, moving) {
  const { wheels, u, hip, lean, h } = g.userData, k = Math.min(moving, 1), crank = -time * 7 * k; // the crank turns clockwise as seen with the front to the right: the pedal goes up, forward, down and back
  for (const w of wheels) w.rotation.z = -time * 11 * Math.min(moving, 2);
  const thigh = 0.44 * h, shin = 0.46 * h;
  [[u.legL, u.kneeL, 0], [u.legR, u.kneeR, Math.PI]].forEach(([legBone, kneeBone, phase]) => {
    const fx = -0.05 + 0.17 * Math.cos(crank + phase), fy = 0.3 + 0.17 * Math.sin(crank + phase) + 0.05;
    const dx = fx - hip[0], dy = fy - hip[1], dist = Math.min(Math.hypot(dx, dy), (thigh + shin) * 0.999);
    const bend = Math.acos(Math.max(-1, Math.min(1, (thigh * thigh + dist * dist - shin * shin) / (2 * thigh * dist))));
    const thighAngle = Math.atan2(dy, dx) + bend; // the knee comes forward
    const kx = hip[0] + Math.cos(thighAngle) * thigh, ky = hip[1] + Math.sin(thighAngle) * thigh;
    const shinAngle = Math.atan2(fy - ky, fx - kx);
    legBone.rotation.z = thighAngle + Math.PI / 2 - lean; kneeBone.rotation.z = shinAngle - thighAngle;
  });
}

// Where a hand is, in the walker's frame, and a way to pose an arm so the hand is as near a target as it can be. It tries the angles once,
// so a hand rests on a pram handle, another hand, or a lead and not in the air beside it.
export function handOf(root, arm) {
  root.updateMatrixWorld(true);
  const hand = new THREE.Vector3(0, -0.57, 0);
  arm.localToWorld(hand);
  return root.worldToLocal(hand);
}
export function reachWith(root, arm, target, { zMin = -0.4, zMax = 1.6, xMin = -0.7, xMax = 0.7 } = {}) {
  // Tries every angle of the arm on a grid and keeps the one that puts the hand nearest the target. Only the arm moves, so only its own matrix is worked out each time (the rest of the body is brought up to
  // date once). Bringing the whole body up to date for each of the 1,750 angles would take about 1.5 ms a call and about 20 ms for a child's hand, for the same numbers.
  const was = [arm.rotation.x, arm.rotation.z];
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert(), hand = new THREE.Vector3();
  let best = { x: 0, z: 0, d: Infinity };
  for (let z = zMin; z <= zMax; z += 0.04) for (let x = xMin; x <= xMax; x += 0.04) {
    arm.rotation.set(x, 0, z);
    arm.updateMatrix(); arm.matrixWorld.multiplyMatrices(arm.parent.matrixWorld, arm.matrix);
    hand.set(0, -0.57, 0).applyMatrix4(arm.matrixWorld).applyMatrix4(inverse);
    const d = hand.distanceTo(target);
    if (d < best.d) best = { x, z, d };
  }
  arm.rotation.set(was[0], 0, was[1]);
  return best;
}
