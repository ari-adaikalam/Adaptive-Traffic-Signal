// A bike and scooter share hub for the empty pockets at the junction's corners, and the people who use it. Built in code like the other models, with no files.
//
// Everything is low (under 1.3 m, apart from the sign and its pole), so the hub never hides a vehicle from the angled view. The hub is made again on every visit with its own choices: how many bays and
// racks, which of them hold a scooter or a bike, how each one stands, which way round the furniture goes. People walk up the kerb side of the footpath, take a scooter or a bike and ride away, and now
// and then someone rides in and leaves one (hub-life.js).
//
// The hub is built in its own frame: u runs along the rect (0 to width), v across it (0 at the side next to the road, depth at the far side), y up. The kinds of thing are merged meshes with vertex
// colours, and the scooters and the bikes are instanced, so the whole hub is a handful of draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bikeLampGeometry, lampFront, lampRear, withNightGlow } from './night-glow.js';

const GREEN = 0x4fb83a, DARK = 0x262a31, STEEL = 0xaab2bc, WOOD = 0x93704d, WHITE = 0xf2f2ee, PALE = 0xeef3ea;

// A piece of a model: a geometry moved to (x, y, z), turned about the three axes, and painted one colour.
function part(geometry, colour, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  geometry.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
  const count = geometry.attributes.position.count, colours = new Float32Array(count * 3), c = new THREE.Color(colour);
  for (let i = 0; i < count; i += 1) colours.set([c.r, c.g, c.b], i * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return geometry.index ? geometry.toNonIndexed() : geometry; // all parts alike, so they merge
}
// A round bar between two points.
function bar(a, b, radius, colour) {
  const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), length = from.distanceTo(to), mid = from.clone().add(to).multiplyScalar(.5);
  const g = new THREE.CylinderGeometry(radius, radius, length, 6);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize()));
  return part(g, colour, mid.x, mid.y, mid.z);
}
const merged = (parts) => mergeGeometries(parts, false);

// A share scooter, standing, facing +z (along v). About 1.1 m long and 1.1 m to the handlebar.
export function scooterGeometry() {
  const wheel = (z) => part(new THREE.CylinderGeometry(.11, .11, .05, 12), DARK, 0, .11, z, 0, 0, Math.PI / 2);
  return merged([
    part(new THREE.BoxGeometry(.2, .05, .66), PALE, 0, .17, 0), // the deck, white so that it shows against the green pad
    part(new THREE.BoxGeometry(.13, .2, .14), GREEN, 0, .26, -.26), // the battery over the back wheel
    wheel(-.3), wheel(.32),
    bar([0, .17, .3], [0, 1.05, .22], .02, PALE), // the stem, leaning back a little
    bar([-.26, 1.07, .22], [.26, 1.07, .22], .015, DARK), // the handlebar
    part(new THREE.BoxGeometry(.07, .05, .04), WHITE, 0, .98, .24), // the light
    part(new THREE.BoxGeometry(.09, .03, .17), GREEN, 0, .22, .33), // the front mudguard
  ]);
}

// A hire bike, standing, facing +z. 1.7 m long.
export function bikeGeometry() {
  const wheel = (z) => part(new THREE.TorusGeometry(.32, .028, 5, 16), DARK, 0, .348, z, 0, Math.PI / 2, 0); // its lowest point is on the ground
  const bb = [0, .3, -.02], seat = [0, .88, -.2], head = [0, .9, .38];
  return merged([
    wheel(-.55), wheel(.55),
    bar(bb, seat, .022, GREEN), bar(seat, head, .022, GREEN), bar(bb, head, .024, GREEN), bar(head, [0, .34, .55], .018, DARK), // the frame and the fork
    bar(bb, [0, .34, -.55], .016, GREEN), bar(seat, [0, .34, -.55], .014, GREEN),
    bar([-.28, .98, .4], [.28, .98, .4], .014, DARK), bar(head, [0, .98, .4], .016, DARK), // the handlebar and its stem
    part(new THREE.BoxGeometry(.1, .04, .2), DARK, 0, .93, -.22), // the saddle
    part(new THREE.BoxGeometry(.34, .2, .28), GREEN, 0, 1.0, .6), // the front basket
    part(new THREE.BoxGeometry(.1, .22, .14), DARK, 0, .55, -.1), // the battery on the frame
  ]);
}

// An inverted U rack, 0.7 m wide and 0.8 m high, across u.
function hoopGeometry() {
  return merged([bar([-.35, 0, 0], [-.35, .8, 0], .022, STEEL), bar([.35, 0, 0], [.35, .8, 0], .022, STEEL), bar([-.35, .8, 0], [.35, .8, 0], .022, STEEL)]);
}

function signTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#2f9e44'; g.beginPath(); g.arc(64, 64, 62, 0, 7); g.fill(); g.strokeStyle = '#ffffff'; g.lineWidth = 5; g.beginPath(); g.arc(64, 64, 55, 0, 7); g.stroke();
  g.fillStyle = '#ffffff'; g.strokeStyle = '#ffffff'; g.lineCap = 'round'; g.lineWidth = 7; // a scooter, side on
  g.beginPath(); g.moveTo(34, 86); g.lineTo(88, 86); g.moveTo(88, 86); g.lineTo(80, 38); g.moveTo(72, 38); g.lineTo(92, 38); g.stroke();
  g.beginPath(); g.arc(38, 92, 9, 0, 7); g.arc(92, 92, 9, 0, 7); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

const FLOWERS = [0xe0475b, 0xf0b429, 0xf5f2ea, 0xb06ad4, 0xf08a3c];

// width (along u) and depth (along v), in metres. `rnd` gives numbers from 0 to 1 (Math.random, so that every visit has a hub of its own).
// Returns the group, the flat materials whose night light the page sets, and the slots (a place for a scooter or a bike) that the people use.
export function buildHub(width, depth, rnd = Math.random) {
  const group = new THREE.Group();
  const vertex = withNightGlow(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .55, metalness: .1 }));
  const add = (mesh, shadow = true) => { mesh.castShadow = shadow; mesh.receiveShadow = true; group.add(mesh); return mesh; };
  const between = (a, b) => a + rnd() * (b - a);

  // The parking zone: a green painted pad with white bays, 2.7 m across, laid on the ground (a little above it, and pushed forward in depth, as the street's marks are).
  const maxBays = Math.floor((width - 1.6) / 1.1), bays = Math.max(4, Math.min(maxBays, Math.round(maxBays * between(.7, 1))));
  const zoneW = bays * 1.1 + .6, zoneD = 2.7, zoneU = between(.4, Math.max(.4, width - zoneW - .4)), zoneV = 1.0;
  const flat = { roughness: .95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 };
  const zone = new THREE.MeshStandardMaterial({ color: 0x3f8f58, ...flat }), lines = new THREE.MeshStandardMaterial({ color: WHITE, ...flat, polygonOffsetFactor: -3, polygonOffsetUnits: -12 });
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(zoneW, zoneD).rotateX(-Math.PI / 2), zone); pad.position.set(zoneU + zoneW / 2, .03, zoneV + zoneD / 2); pad.receiveShadow = true; group.add(pad);
  const markings = [new THREE.PlaneGeometry(zoneW - .2, .08).rotateX(-Math.PI / 2).translate(zoneU + zoneW / 2, .035, zoneV + .12), new THREE.PlaneGeometry(zoneW - .2, .08).rotateX(-Math.PI / 2).translate(zoneU + zoneW / 2, .035, zoneV + zoneD - .12)];
  for (let i = 0; i <= bays; i += 1) markings.push(new THREE.PlaneGeometry(.07, zoneD - .2).rotateX(-Math.PI / 2).translate(zoneU + .3 + i * 1.1, .035, zoneV + zoneD / 2));
  group.add(Object.assign(new THREE.Mesh(mergeGeometries(markings.map((g) => (g.index ? g.toNonIndexed() : g))), lines), { receiveShadow: true }));

  // The slots. Every vehicle faces the road, so a person coming up from the footpath meets its handlebar and rides straight out. A scooter slot is a bay; a bike slot has its back wheel at a hoop.
  // `taken` says whether it holds one now.
  const scooterSlots = [], bikeSlots = [], fill = between(.55, .95);
  for (let i = 0; i < bays; i += 1) scooterSlots.push({ kind: 'scooter', u: zoneU + .3 + (i + .5) * 1.1, v: zoneV + 1.15, yaw: Math.PI + (rnd() - .5) * .28, nudge: (rnd() - .5) * .14, taken: rnd() < fill, reserved: false });
  const hoopV = zoneV + zoneD + 1.9, hoops = Math.max(3, Math.min(8, Math.floor((width - 1.4) / 1.5), Math.round(between(.6, 1) * 8))), rackU = (width - (hoops - 1) * 1.5) / 2;
  for (let i = 0; i < hoops; i += 1) bikeSlots.push({ kind: 'bike', hoop: rackU + i * 1.5, u: rackU + i * 1.5 - .08, v: hoopV + .95, yaw: Math.PI + (rnd() - .5) * .22, nudge: 0, taken: rnd() < fill, reserved: false });

  const scooters = new THREE.InstancedMesh(scooterGeometry(), vertex, scooterSlots.length), bikes = new THREE.InstancedMesh(bikeGeometry(), vertex, bikeSlots.length);
  const hoopMesh = new THREE.InstancedMesh(hoopGeometry(), vertex, hoops), m = new THREE.Matrix4(), none = new THREE.Matrix4().makeScale(0, 0, 0);
  // The lamps of the parked vehicles: a white one in front and a red one behind, in meshes of their own (they are lit at night, see night-glow.js), at the same places as the vehicles.
  const lampMeshes = (front, rear, count) => [new THREE.InstancedMesh(front, lampFront, count), new THREE.InstancedMesh(rear, lampRear, count)];
  const scooterLamps = lampMeshes(bikeLampGeometry.front.clone().translate(0, .98, .26), bikeLampGeometry.rear.clone().translate(0, .3, -.36), scooterSlots.length);
  const bikeLamps = lampMeshes(bikeLampGeometry.front.clone().translate(0, .93, .46), bikeLampGeometry.rear.clone().translate(0, .9, -.37), bikeSlots.length);
  const place = (slot, mesh, index) => { // the vehicle in its slot, or nothing when it has been taken
    const set = slot.kind === 'bike' ? bikeLamps : scooterLamps;
    if (!slot.taken) { mesh.setMatrixAt(index, none); for (const lamp of set) lamp.setMatrixAt(index, none); }
    else { m.compose(new THREE.Vector3(slot.u + slot.nudge, 0, slot.v), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), slot.yaw), new THREE.Vector3(1, 1, 1)); mesh.setMatrixAt(index, m); for (const lamp of set) lamp.setMatrixAt(index, m); }
    mesh.instanceMatrix.needsUpdate = true; for (const lamp of set) lamp.instanceMatrix.needsUpdate = true;
  };
  scooterSlots.forEach((slot, i) => { slot.mesh = scooters; slot.index = i; place(slot, scooters, i); });
  bikeSlots.forEach((slot, i) => { slot.mesh = bikes; slot.index = i; place(slot, bikes, i); m.makeTranslation(slot.u, 0, slot.v + .55); hoopMesh.setMatrixAt(i, m); }); // the hoop stands round the back wheel: the wheel goes through it, as a bike is locked to a hoop
  add(scooters); add(bikes); add(hoopMesh); for (const lamp of [...scooterLamps, ...bikeLamps]) add(lamp, false);

  // The rest of the pocket: a sign and a pay post at the end of the zone, benches and a flower bed along the far side with a low hedge behind, planters, a bin and a bike pump. `at` swaps the ends, so the
  // hub is not the same way round every time.
  const furniture = [], farV = depth - 1.1, flip = rnd() < .5, at = (u) => (flip ? width - u : u);
  let poleU = flip ? zoneU + zoneW + .5 : zoneU - .5; // at one end of the zone, outside it; at the other end if there is no room
  if (poleU < .4 || poleU > width - .4) poleU = flip ? zoneU - .5 : zoneU + zoneW + .5;
  poleU = Math.min(width - .3, Math.max(.3, poleU)); const poleV = zoneV + .3;
  furniture.push(bar([poleU, 0, poleV], [poleU, 2.4, poleV], .04, DARK), part(new THREE.BoxGeometry(.12, .12, .12), DARK, poleU, 2.4, poleV));
  const payU = Math.min(width - .4, Math.max(.4, poleU + (poleU < zoneU ? -.9 : .9))); // a pay and unlock post, with a screen, beside the sign
  furniture.push(part(new THREE.BoxGeometry(.5, 1.25, .36), DARK, payU, .63, zoneV + zoneD + .55), part(new THREE.BoxGeometry(.34, .24, .03), 0x9bd9ff, payU, 1.0, zoneV + zoneD + .35), part(new THREE.BoxGeometry(.5, .1, .4), GREEN, payU, 1.28, zoneV + zoneD + .55));
  for (const u of [width * .3, width * .62]) {
    furniture.push(part(new THREE.BoxGeometry(1.5, .06, .46), WOOD, at(u), .46, farV), part(new THREE.BoxGeometry(1.5, .42, .05), WOOD, at(u), .72, farV + .2, -.12));
    furniture.push(part(new THREE.BoxGeometry(.07, .46, .42), DARK, at(u) - .65, .23, farV), part(new THREE.BoxGeometry(.07, .46, .42), DARK, at(u) + .65, .23, farV));
  }
  furniture.push(part(new THREE.CylinderGeometry(.22, .2, .85, 10), 0x2f5d3a, at(width - .6), .43, farV), part(new THREE.CylinderGeometry(.24, .24, .06, 10), DARK, at(width - .6), .88, farV)); // the bin
  furniture.push(bar([at(width * .46), 0, farV - .7], [at(width * .46), 1.0, farV - .7], .03, STEEL), part(new THREE.BoxGeometry(.2, .12, .12), GREEN, at(width * .46), .92, farV - .7)); // the bike pump
  furniture.push(part(new THREE.BoxGeometry(width - .8, .6, .55), 0x3b6b3a, width / 2, .3, depth - .4)); // the hedge along the back
  for (const u of [width * .12, width * .8]) { // planters with shrubs
    furniture.push(part(new THREE.BoxGeometry(1.2, .5, .6), 0xb9b3a6, at(u), .25, farV));
    for (let k = 0; k < 3; k += 1) furniture.push(part(new THREE.IcosahedronGeometry(.3 + .06 * rnd(), 0), 0x3f7d3a, at(u) - .4 + k * .4, .75 + .06 * rnd(), farV + (rnd() - .5) * .1));
  }
  for (let k = 0; k < 14; k += 1) furniture.push(part(new THREE.IcosahedronGeometry(.07 + .03 * rnd(), 0), FLOWERS[Math.floor(rnd() * FLOWERS.length)], between(.6, width - .6), .64 + .06 * rnd(), depth - .4 + (rnd() - .5) * .3)); // flowers on the hedge
  add(new THREE.Mesh(merged(furniture), vertex));
  const sign = new THREE.Mesh(new THREE.CircleGeometry(.32, 20), new THREE.MeshStandardMaterial({ map: signTexture(), roughness: .6, side: THREE.DoubleSide }));
  sign.position.set(poleU, 2.0, poleV + .07); sign.castShadow = true; group.add(sign);

  return { group, zone, lines, vertex, height: 2.5, width, depth, scooterSlots, bikeSlots, place };
}

// A person standing on a scooter with both hands on the bar, as one group that faces +x like the other people. `walker` is a person from the page's own builder.
export function buildScooterRider(walker, vertex) {
  const group = new THREE.Group(), scooter = new THREE.Mesh(scooterGeometry(), vertex);
  scooter.rotation.y = Math.PI / 2; scooter.castShadow = true; // the scooter faces +z, the people +x
  walker.position.set(-.1, .2, 0); // the arms are set to the bar every frame by the page (they would hang otherwise)
  const lamps = [[bikeLampGeometry.front, lampFront, 0, .98, .26], [bikeLampGeometry.rear, lampRear, 0, .3, -.36]].map(([geometry, material, x, y, z]) => { const lamp = new THREE.Mesh(geometry, material); lamp.position.set(x, y, z); scooter.add(lamp); return lamp; }); // lit at night
  void lamps;
  group.add(scooter, walker); group.userData = { body: walker };
  return group;
}
