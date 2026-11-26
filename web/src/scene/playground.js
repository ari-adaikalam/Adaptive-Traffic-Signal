// The playground's equipment, built in code: a swing set and a slide with a platform, a ladder and a roof. Every part is attached to the one it hangs from or stands on: the chains from the bar to the seat, the
// legs from the ends of the bar to the ground, the posts under the platform, the ladder against its edge, the chute from the platform's edge to its supports. The numbers are in playground-layout.js, which the
// children's moves also use, so a child is where the seat and the chute really are.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SLIDE, SWING, chute, chuteAt, ladderFootX, seatTop, swingPivotY } from './playground-layout.js';

const material = (color, roughness = 0.6, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const STEEL = material(0x8d949c, 0.45, 0.5), POST = material(0x3d6fb5, 0.5), DECK = material(0xe8b53a, 0.7), CHUTE = material(0xf4d03f, 0.35), RAIL = material(0x3d6fb5, 0.5), ROOF = material(0xd2513d, 0.6);
const SEATS = [material(0xe0612b, 0.6), material(0x2f9e8f, 0.6)];

// Pieces collected by material and merged into one mesh each.
class Pieces {
  constructor() { this.byMaterial = new Map(); }
  add(mat, geometry, x, y, z, rx = 0, ry = 0, rz = 0) {
    geometry.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
    if (!this.byMaterial.has(mat)) this.byMaterial.set(mat, []);
    this.byMaterial.get(mat).push(geometry);
  }
  box(mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) { this.add(mat, new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz); }
  // A bar from one point to another, square in section.
  bar(mat, a, b, t) {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), dir = to.clone().sub(from), g = new THREE.BoxGeometry(t, dir.length(), t);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
    const mid = from.add(to).multiplyScalar(0.5); this.add(mat, g, mid.x, mid.y, mid.z);
  }
  into(group) { for (const [mat, list] of this.byMaterial) { const mesh = new THREE.Mesh(mergeGeometries(list, false), mat); mesh.castShadow = mesh.receiveShadow = true; group.add(mesh); } }
}

// The swing set, with its middle at the group's origin and its bar along z. The swings hang in x. Returns the group and, for each swing, its pivot (the group to turn about z) and where its seat is.
export function buildSwingSet() {
  const group = new THREE.Group(), frame = new Pieces(), top = SWING.beamY, half = SWING.beamLen / 2;
  frame.box(STEEL, 0.14, SWING.beamThick, SWING.beamLen, 0, top, 0); // the top bar
  for (const end of [-1, 1]) for (const side of [-1, 1]) frame.bar(STEEL, [0, top, end * half], [side * SWING.legSplay, 0, end * half], 0.12); // the legs: an A at each end, from the bar to the ground
  for (const end of [-1, 1]) frame.box(STEEL, 2 * SWING.legSplay * (1 - 1.0 / top), 0.06, 0.06, 0, 1.0, end * half); // a brace across each A, from one leg to the other at 1 m
  frame.into(group);
  const swings = SWING.seats.map((v, i) => {
    const pivot = new THREE.Group(), parts = new Pieces(), chainOffset = SWING.chainGap / 2;
    pivot.position.set(0, swingPivotY(), v);
    for (const side of [-1, 1]) {
      parts.box(STEEL, 0.07, 0.06, 0.07, 0, 0.03, side * chainOffset); // the hook on the bar
      parts.bar(STEEL, [0, 0, side * chainOffset], [0, -SWING.chain, side * chainOffset], 0.025); // the chain, from the hook to the seat
    }
    parts.box(SEATS[i % SEATS.length], SWING.seatD, SWING.seatThick, SWING.seatW, 0, -SWING.chain, 0); // the seat, between the ends of the two chains
    parts.into(pivot); group.add(pivot);
    return { pivot, seat: new THREE.Vector3(0, seatTop(), 0) };
  });
  return { group, swings };
}

// The slide, with the middle of its platform above the origin and the chute running toward +x.
export function buildSlide() {
  const group = new THREE.Group(), p = new Pieces(), h = SLIDE.deck, hd = SLIDE.deckHalf, c = chute(), top = c.top, roofY = h + 1.45;
  p.box(DECK, hd * 2, SLIDE.deckThick, hd * 2, 0, h, 0); // the platform
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.box(POST, 0.1, roofY - 0.05, 0.1, sx * (hd - 0.05), (roofY - 0.05) / 2, sz * (hd - 0.05)); // four posts, from the ground to the roof
  p.box(ROOF, hd * 2 + 0.4, 0.07, hd * 2 + 0.4, 0, roofY, 0); // the roof, resting on the posts
  p.box(ROOF, hd * 2 - 0.2, 0.07, hd * 2 - 0.2, 0, roofY + 0.07, 0); // a raised cap on it
  // Guard rails on the platform: both sides, and the near edge on either side of the ladder, and the far edge on either side of the chute. A rail has a top bar and, below it, a lower one.
  const gap = SLIDE.chuteW / 2 + 0.05;
  const rail = (a, b) => { p.bar(RAIL, [a[0], top + 0.55, a[1]], [b[0], top + 0.55, b[1]], 0.05); p.bar(RAIL, [a[0], top + 0.25, a[1]], [b[0], top + 0.25, b[1]], 0.04); };
  for (const sz of [-1, 1]) rail([-hd + 0.05, sz * (hd - 0.05)], [hd - 0.05, sz * (hd - 0.05)]);
  for (const sz of [-1, 1]) { rail([-hd + 0.05, sz * (hd - 0.05)], [-hd + 0.05, sz * 0.26]); rail([hd - 0.05, sz * (hd - 0.05)], [hd - 0.05, sz * gap]); }
  // The ladder leans on the platform's near edge, two rails with rungs, the foot on the ground.
  const foot = ladderFootX(), lw = 0.2;
  for (const sz of [-1, 1]) p.bar(STEEL, [foot, 0, sz * lw], [-hd, top, sz * lw], 0.05);
  const length = Math.hypot(-hd - foot, top);
  for (let s = 0.28; s < length - 0.1; s += 0.28) { const f = s / length; p.box(STEEL, 0.04, 0.04, lw * 2, foot + (-hd - foot) * f, top * f, 0); }
  // The chute, from the platform's edge down to the exit: a floor and a low wall on each side, turned to the slope, and two stands under it.
  const mid = chuteAt(c.length / 2), n = [Math.sin(c.angle), Math.cos(c.angle)]; // n is the surface's normal
  const floor = new THREE.BoxGeometry(c.length, 0.05, SLIDE.chuteW), wall = new THREE.BoxGeometry(c.length, 0.16, 0.05);
  const at = (surface, up) => ({ x: surface.x + n[0] * up, y: surface.y + n[1] * up });
  const f0 = at(mid, -0.025); p.add(CHUTE, floor, f0.x, f0.y, 0, 0, 0, -c.angle);
  for (const sz of [-1, 1]) { const w0 = at(mid, 0.08); p.add(RAIL, wall.clone(), w0.x, w0.y, sz * (SLIDE.chuteW / 2 + 0.025), 0, 0, -c.angle); }
  for (const s of [c.length * 0.5, c.length - 0.25]) { const q = chuteAt(s); for (const sz of [-1, 1]) p.bar(STEEL, [q.x, 0, sz * (SLIDE.chuteW / 2 + 0.05)], [q.x, q.y - 0.05, sz * (SLIDE.chuteW / 2 + 0.05)], 0.06); }
  p.into(group);
  return group;
}
