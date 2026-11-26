// The shapes of a car park off a side street: the surface with its bay lines, the kerbs and footpaths, the hedges, the lamps, the signs, the wheel stops, and the door and sign of the building at the end of it. The numbers
// are in carpark-layout.js, which the cars' and people's moves use too, so a car is in its bay and a person at the door because both come from the same figures.
//
// Everything is in the group's own frame: x is `a` (along the street, 0 in the middle of the aisle) and z is minus `t` (into the block is toward -z), so the street is at +z. The page sets the group's position and its
// turn about y for each of the two car parks. Pieces are merged by material, so a car park is a handful of draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LOT, bays, depth, doorAt, halfWidth } from './carpark-layout.js';

export const PPM = 24; // pixels to the metre in the picture of the surface
const PAD_A = 11, PAD_BACK = 0.6, PAD_FRONT = 3; // how far the picture reaches: either side of the aisle, past the end, and out into the street
export const lotPicture = () => ({ width: 2 * PAD_A, height: depth() + PAD_BACK + PAD_FRONT, a0: -PAD_A, t0: -PAD_FRONT }); // in metres: the area it covers, from (a0, t0)

// Paints the surface on a canvas: asphalt over the car park and the apron to the street, the kerb round the edge and a white line between bays. Transparent elsewhere, so the ground shows through.
export function paintLot(canvas, { asphalt = '#43474d', line = '#f3f3ee', kerb = '#d6d2c8' } = {}) {
  const { width, height, a0, t0 } = lotPicture();
  canvas.width = Math.round(width * PPM); canvas.height = Math.round(height * PPM);
  const g = canvas.getContext('2d'), X = (a) => (a - a0) * PPM, Y = (t) => (t - t0) * PPM;
  const apronA0 = -6.2, apronA1 = 6.4; // the opening to the street, wide enough for the arc in and the arc out
  g.fillStyle = asphalt; g.fillRect(X(-halfWidth() - 0.6), Y(0), (2 * halfWidth() + 1.2) * PPM, (depth() + PAD_BACK) * PPM); // the car park
  g.fillRect(X(apronA0), Y(-2.6), (apronA1 - apronA0) * PPM, 2.7 * PPM); // the apron across the footpath, to the street's asphalt
  g.fillStyle = line; // the bay lines: a line at each side of every bay, from the aisle to the end of the bays
  for (const side of [1, -1]) for (let i = 0; i <= LOT.perSide; i += 1) {
    const t = LOT.entryT + i * LOT.bayW, a0b = side * LOT.aisle / 2, a1b = side * (LOT.aisle / 2 + LOT.bayD);
    g.fillRect(X(Math.min(a0b, a1b)), Y(t - 0.05), Math.abs(a1b - a0b) * PPM, 0.1 * PPM);
  }
  for (const side of [1, -1]) g.fillRect(X(side * (LOT.aisle / 2 + LOT.bayD) - 0.05), Y(LOT.entryT), 0.1 * PPM, LOT.perSide * LOT.bayW * PPM); // the back line of the bays
  g.fillStyle = kerb; // the kerb, at the sides and the far end. Across the front is the opening to the street, with no kerb.
  const w = 0.3; g.fillRect(X(-halfWidth() - 0.6), Y(0), w * PPM, (depth() + PAD_BACK) * PPM); g.fillRect(X(halfWidth() + 0.6 - w), Y(0), w * PPM, (depth() + PAD_BACK) * PPM);
  g.fillRect(X(-halfWidth() - 0.6), Y(depth() + PAD_BACK - w), (2 * halfWidth() + 1.2) * PPM, w * PPM);
}

// A square sign with a letter, as a texture: a white P on blue.
function signTexture(text, background, foreground, size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  g.fillStyle = background; g.fillRect(0, 0, size, size); g.strokeStyle = foreground; g.lineWidth = size / 16; g.strokeRect(size / 14, size / 14, size - size / 7, size - size / 7);
  g.fillStyle = foreground; g.font = `700 ${size * 0.62}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, size / 2, size / 2 + size * 0.04);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
// The name over the door, as a texture: white letters on a colour.
function nameTexture(text, background, foreground, accent) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = background; g.fillRect(0, 0, 512, 128); g.fillStyle = accent; g.fillRect(0, 0, 512, 12); g.fillRect(0, 116, 512, 12);
  g.fillStyle = foreground; g.font = '700 64px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 66);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

// `deps`: { lotMaterial, kerbMat, metalMat, lampMat }. kind: 'office' or 'restaurant'. Returns { group, front }, where `front` is t of the face of the building the page puts up behind it.
export function buildCarPark(kind, { lotMaterial, kerbMat, metalMat, lampMat }) {
  const group = new THREE.Group(), pieces = new Map();
  const add = (mat, geometry, a, y, t) => { geometry.translate(a, y, -t); if (!pieces.has(mat)) pieces.set(mat, []); pieces.get(mat).push(geometry); };
  const box = (mat, w, h, d, a, y, t) => add(mat, new THREE.BoxGeometry(w, h, d), a, y, t); // w along a, d along t
  const hedgeMat = new THREE.MeshStandardMaterial({ color: 0x3b6b3a, roughness: 0.95 }), stopMat = new THREE.MeshStandardMaterial({ color: 0xd9d6cc, roughness: 0.8 }), poleMat = metalMat;
  const front = depth() + 2.2, hw = halfWidth();

  // the surface, from its picture
  const pic = lotPicture();
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(pic.width, pic.height).rotateX(-Math.PI / 2), lotMaterial);
  surface.position.set(pic.a0 + pic.width / 2, 0.02, -(pic.t0 + pic.height / 2)); surface.receiveShadow = true; group.add(surface);

  // the footpaths: outside the bays on each side, and along the front of the building (the same pavement as the footpaths of the roads)
  for (const side of [1, -1]) box(kerbMat, 2.4, 0.08, front - 0.2, side * (hw + 1.6), 0.04, (front - 0.2) / 2 + 0.1);
  box(kerbMat, 2 * (hw + 2.8), 0.08, front - depth() - 0.6, 0, 0.04, depth() + 0.6 + (front - depth() - 0.6) / 2);
  // hedges along the outside of the footpaths, and a low one along each side of the opening to the street
  for (const side of [1, -1]) { box(hedgeMat, 0.9, 0.8, front - 7, side * (hw + 3.2), 0.4, (front - 7) / 2 + 5); box(hedgeMat, 0.9, 0.8, 2.6, side * 6.9, 0.4, -1.3); }
  // wheel stops at the end of each bay
  for (const b of bays()) box(stopMat, 0.3, 0.12, 1.4, b.side * (LOT.aisle / 2 + LOT.bayD - 0.5), 0.07, b.t);
  // lamps: two each side, a pole with a head at the top, and a sign at the opening
  for (const side of [1, -1]) for (const t of [LOT.entryT + 6, LOT.entryT + 22]) {
    box(poleMat, 0.12, 5.2, 0.12, side * (hw + 2.3), 2.6, t); box(poleMat, 0.9, 0.1, 0.14, side * (hw + 2.3) - side * 0.35, 5.2, t);
    add(lampMat, new THREE.SphereGeometry(0.22, 10, 8), side * (hw + 2.3) - side * 0.75, 5.05, t);
  }
  box(poleMat, 0.08, 2.6, 0.08, -7.0, 1.3, -1.4);
  const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshStandardMaterial({ map: signTexture('P', '#1f5fa8', '#ffffff'), roughness: 0.6, side: THREE.DoubleSide }));
  signMesh.position.set(-7.0, 2.55, 1.4); signMesh.rotation.y = 0; group.add(signMesh); // faces the street (+z) and, from behind, the car park

  for (const [mat, list] of pieces) { const mesh = new THREE.Mesh(mergeGeometries(list, false), mat); mesh.castShadow = mat !== lampMat && mat !== hedgeMat; mesh.receiveShadow = true; group.add(mesh); }

  // the front of the building: the door, a canopy over it, and the name above
  const door = doorAt(), name = kind === 'office' ? 'MERIDIAN HOUSE' : 'BURGER STOP';
  const glass = new THREE.MeshStandardMaterial({ color: 0x1f2a36, roughness: 0.15, metalness: 0.3 }), canopyMat = new THREE.MeshStandardMaterial({ color: kind === 'office' ? 0x9aa0a5 : 0xd2513d, roughness: 0.6 });
  const at = (mesh, a, y, t) => { mesh.position.set(a, y, -t); mesh.castShadow = true; group.add(mesh); return mesh; };
  at(new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.5, 0.12), glass), door.a, 1.25, front - 0.04);
  at(new THREE.Mesh(new THREE.BoxGeometry(6, 0.16, 2.2), canopyMat), door.a, 3.1, front - 1.0);
  for (const s of [-1, 1]) at(new THREE.Mesh(new THREE.BoxGeometry(0.1, 3.1, 0.1), poleMat), door.a + s * 2.8, 1.55, front - 2);
  const nameMesh = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.25), new THREE.MeshStandardMaterial({ map: nameTexture(name, kind === 'office' ? '#2b3a4a' : '#b3261e', '#ffffff', kind === 'office' ? '#7fb2e5' : '#f2c744'), roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0 }));
  nameMesh.material.emissiveMap = nameMesh.material.map; at(nameMesh, door.a, 4.4, front - 0.12); // faces the street (+z)
  group.userData.nameMaterial = nameMesh.material;
  return { group, front };
}
