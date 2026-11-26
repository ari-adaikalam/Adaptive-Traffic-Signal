// A fountain and a pond, built in code. Both are animated by `update(time, dt)` and add nothing to the scene but one group each.
// The fountain throws real arcs of water drops under gravity and the drops land in the basin with a ring spreading out from each. The pond has fish that swim
// among lily pads, reeds at the edge, ducks that swim, dip their heads and climb out onto the bank, and ripples wherever something touches the water.

import * as THREE from 'three';

function rng(seed) { let a = seed | 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const mat = (color, roughness = 0.7, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
const stone = mat('#cfc7b4', 0.9), darkStone = mat('#8f8a7c', 0.95);
const G = 9.8;

// Rings that spread over the water and fade, taken from a small pool so nothing is created while it runs.
class Ripples {
  constructor(parent, count, y, colour = 0xffffff) {
    this.list = [];
    const geo = new THREE.RingGeometry(0.92, 1, 28).rotateX(-Math.PI / 2);
    for (let i = 0; i < count; i += 1) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0, depthWrite: false }));
      m.position.y = y; m.visible = false; parent.add(m);
      this.list.push({ mesh: m, age: 1, life: 1.6, size: 1 });
    }
    this.next = 0;
  }
  spawn(x, z, size = 0.5, life = 1.6) {
    const r = this.list[this.next]; this.next = (this.next + 1) % this.list.length;
    r.age = 0; r.life = life; r.size = size; r.mesh.position.x = x; r.mesh.position.z = z; r.mesh.visible = true;
  }
  update(dt) {
    for (const r of this.list) {
      if (r.age >= r.life) { r.mesh.visible = false; continue; }
      r.age += dt;
      const f = Math.min(1, r.age / r.life);
      r.mesh.scale.setScalar(0.05 + f * r.size); r.mesh.material.opacity = (1 - f) * 0.55;
    }
  }
}

// ---------- the fountain ----------
export function buildFountain({ x, z, radius = 4.5, seed = 5 }) {
  const rand = rng(seed), group = new THREE.Group(); group.position.set(x, 0, z);
  const waterMat = mat('#8fd0ea', 0.15, { transparent: true, opacity: 0.8, metalness: 0.1 });
  // the basin: a stone wall with a lip, a floor, and the water just under the lip
  const wall = new THREE.Mesh(new THREE.LatheGeometry([[radius + 0.05, 0], [radius + 0.05, 0.72], [radius - 0.15, 0.78], [radius - 0.42, 0.72], [radius - 0.42, 0.1], [0.4, 0.1], [0.4, 0]].map(([r, y]) => new THREE.Vector2(r, y)), 40), stone);
  wall.castShadow = wall.receiveShadow = true; group.add(wall);
  const basinWater = new THREE.Mesh(new THREE.CircleGeometry(radius - 0.42, 40).rotateX(-Math.PI / 2), waterMat); basinWater.position.y = 0.6; group.add(basinWater);
  // a column with two bowls, each full of water, that overflow into the basin
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 2.7, 14), stone); column.position.y = 1.4; column.castShadow = true; group.add(column);
  const bowls = [[1.5, 1.45], [2.6, 0.95]];
  for (const [y, r] of bowls) {
    const bowl = new THREE.Mesh(new THREE.LatheGeometry([[0.25, 0], [r * 0.6, 0.06], [r, 0.3], [r + 0.06, 0.36], [r - 0.08, 0.34], [r * 0.55, 0.14], [0.25, 0.1]].map(([a, b]) => new THREE.Vector2(a, b)), 30), stone);
    bowl.position.y = y - 0.15; bowl.castShadow = true; group.add(bowl);
    const w = new THREE.Mesh(new THREE.CircleGeometry(r - 0.1, 28).rotateX(-Math.PI / 2), waterMat); w.position.y = y + 0.16; group.add(w);
  }
  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), stone); finial.position.y = 3.05; group.add(finial);

  // the drops: three kinds of jet, each a stream of drops following the same arc one after another
  const jets = [];
  jets.push({ kind: 'centre', n: 110, x: 0, y: 3.2, z: 0, vy: 7.6, vh: 0.25, scale: 1 }); // a tall jet from the top
  for (let i = 0; i < 10; i += 1) { const a = (i / 10) * Math.PI * 2; jets.push({ kind: 'ring', n: 26, x: Math.cos(a) * 1.0, y: 0.75, z: Math.sin(a) * 1.0, vy: 4.4, vh: 2.3, ax: Math.cos(a), az: Math.sin(a), scale: 1 }); } // arcs out into the basin
  for (const [y, r] of bowls) for (let i = 0; i < 6; i += 1) { const a = (i / 6) * Math.PI * 2 + y; jets.push({ kind: 'sheet', n: 18, x: Math.cos(a) * r, y: y + 0.18, z: Math.sin(a) * r, vy: 0, vh: 0.45, ax: Math.cos(a), az: Math.sin(a), scale: 1 }); } // overflow from the bowls
  let total = 0; for (const j of jets) { j.first = total; total += j.n; }
  const dropGeo = new THREE.SphereGeometry(0.04, 6, 5);
  const drops = new THREE.InstancedMesh(dropGeo, mat('#dff2ff', 0.2, { transparent: true, opacity: 0.8 }), total);
  group.add(drops);
  const offsets = Array.from({ length: total }, () => rand());
  const splash = new Ripples(group, 24, 0.62, 0xffffff);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  let splashClock = 0;
  return {
    group,
    update(time, dt) {
      // the jets breathe: the tall one rises and falls and every few seconds all of them swell
      const swell = 0.8 + 0.2 * Math.sin(time * 0.7) + 0.12 * Math.max(0, Math.sin(time * 0.21));
      let i = 0;
      for (const j of jets) {
        const vy = j.kind === 'centre' ? j.vy * swell : j.vy * (0.9 + 0.1 * swell);
        const flight = j.kind === 'sheet' ? Math.sqrt(2 * (j.y - 0.62) / G) : (vy + Math.sqrt(vy * vy + 2 * G * (j.y - 0.62))) / G;
        for (let k = 0; k < j.n; k += 1, i += 1) {
          const phase = ((time / flight * 0.9) + offsets[i] + k / j.n) % 1, t = phase * flight;
          const spread = j.kind === 'centre' ? (offsets[(i * 7) % total] - 0.5) * 0.5 : 0;
          const px = j.x + (j.ax ?? 0) * j.vh * t + spread * t * 0.4, pz = j.z + (j.az ?? 0) * j.vh * t + spread * t * 0.3;
          const py = j.y + vy * t - 0.5 * G * t * t;
          m4.compose(v3.set(px, Math.max(py, 0.6), pz), q, one); drops.setMatrixAt(i, m4);
        }
      }
      drops.instanceMatrix.needsUpdate = true;
      // a ring where the arcs and the tall jet come down
      splashClock += dt;
      if (splashClock > 0.07) {
        splashClock = 0;
        const j = jets[1 + Math.floor(rand() * 10)], a = Math.atan2(j.az, j.x), flight = (j.vy * (0.9 + 0.1 * swell) + Math.sqrt((j.vy * (0.9 + 0.1 * swell)) ** 2 + 2 * G * 0.13)) / G;
        const reach = j.vh * flight + 1.0;
        splash.spawn(Math.cos(a) * reach, Math.sin(a) * reach, 0.5, 1.3);
        if (rand() < 0.5) splash.spawn((rand() - 0.5) * 0.9, (rand() - 0.5) * 0.9, 0.7, 1.4);
      }
      splash.update(dt);
    },
  };
}

// ---------- the pond ----------
function makeFish(rand) {
  const g = new THREE.Group();
  const palette = [['#e8742a', '#f4efe6'], ['#f4efe6', '#e8742a'], ['#d9a21b', '#f4efe6'], ['#2a2a2c', '#e8742a'], ['#e8742a', '#2a2a2c']][Math.floor(rand() * 5)];
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), mat(palette[0], 0.5)); body.scale.set(0.4, 0.13, 0.15); g.add(body);
  const patch = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), mat(palette[1], 0.5)); patch.scale.set(0.18, 0.135, 0.152); patch.position.set(-0.03, 0.005, 0); g.add(patch);
  const tail = new THREE.Group(); tail.position.set(-0.19, 0, 0);
  const fin = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.18, 4).rotateZ(Math.PI / 2).scale(1, 0.15, 1), mat(palette[0], 0.6, { side: THREE.DoubleSide })); fin.scale.set(1, 1, 3); fin.position.set(-0.07, 0, 0); tail.add(fin); g.add(tail);
  const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.1, 4), mat(palette[0], 0.6)); dorsal.position.set(0, 0.07, 0); dorsal.rotation.z = -0.5; g.add(dorsal);
  g.userData.tail = tail;
  return g;
}
function makeDuck(rand, kind) {
  const g = new THREE.Group(), s = kind === 'duckling' ? 0.45 : 1;
  const male = kind === 'male';
  const bodyCol = kind === 'duckling' ? '#e8c64a' : male ? '#9b9b94' : '#8a6a45', breast = male ? '#6b3a22' : '#8a6a45', head = male ? '#1f6b43' : kind === 'duckling' ? '#e8c64a' : '#8a6a45';
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 9), mat(bodyCol, 0.8)); body.scale.set(0.42 * s, 0.2 * s, 0.24 * s); body.position.y = 0.07 * s; g.add(body);
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), mat(breast, 0.8)); chest.scale.set(0.2 * s, 0.19 * s, 0.22 * s); chest.position.set(0.14 * s, 0.1 * s, 0); g.add(chest);
  const neck = new THREE.Group(); neck.position.set(0.2 * s, 0.14 * s, 0); g.add(neck);
  const n = new THREE.Mesh(new THREE.CapsuleGeometry(0.035 * s, 0.1 * s, 3, 6), mat(head, 0.8)); n.position.set(0.02 * s, 0.07 * s, 0); n.rotation.z = -0.25; neck.add(n);
  const h = new THREE.Mesh(new THREE.SphereGeometry(0.06 * s, 10, 8), mat(head, 0.8)); h.position.set(0.05 * s, 0.15 * s, 0); neck.add(h);
  const bill = new THREE.Mesh(new THREE.BoxGeometry(0.07 * s, 0.015 * s, 0.04 * s), mat(kind === 'duckling' ? '#e08a3a' : male ? '#d9c43a' : '#d98a3a', 0.6)); bill.position.set(0.12 * s, 0.14 * s, 0); neck.add(bill);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.01 * s, 5, 4), mat('#101010', 0.5)); eye.position.set(0.085 * s, 0.17 * s, 0.045 * s); neck.add(eye); const eye2 = eye.clone(); eye2.position.z = -0.045 * s; neck.add(eye2);
  const tailT = new THREE.Mesh(new THREE.ConeGeometry(0.04 * s, 0.1 * s, 5).rotateZ(Math.PI / 2 + 0.4), mat(male ? '#1f2a36' : bodyCol, 0.8)); tailT.position.set(-0.22 * s, 0.12 * s, 0); g.add(tailT);
  const wing = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), mat(male ? '#7b6a55' : '#6b4f33', 0.8)); wing.scale.set(0.26 * s, 0.09 * s, 0.04 * s); wing.position.set(-0.03 * s, 0.13 * s, 0.1 * s); g.add(wing); const wing2 = wing.clone(); wing2.position.z = -0.1 * s; g.add(wing2);
  if (male) { const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.012, 8), mat('#f4efe6', 0.6)); ring.position.set(0.0, 0.07, 0); neck.add(ring); }
  const feet = []; for (const z of [0.05, -0.05]) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.07 * s, 0.01, 0.05 * s), mat('#d98a3a', 0.7)); f.position.set(0.02 * s, 0.01, z * s); g.add(f); feet.push(f); }
  g.userData = { neck, feet, body };
  return g;
}

export function buildPond({ x, z, rx, rz, seed = 9, jetty = true }) {
  const rand = rng(seed), group = new THREE.Group(); group.position.set(x, 0, z);
  const ripples = new Ripples(group, 40, 0.1, 0xffffff);
  // the water, a little above the dark bed that is painted on the ground, so the fish show through it
  const waterTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256; const ctx = c.getContext('2d');
    ctx.fillStyle = '#7fc0cf'; ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 70; i += 1) { ctx.strokeStyle = `rgba(255,255,255,${0.05 + rand() * 0.12})`; ctx.lineWidth = 1 + rand() * 2; ctx.beginPath(); const px = rand() * 256, py = rand() * 256; ctx.ellipse(px, py, 8 + rand() * 24, 2 + rand() * 6, rand() * 3, 0, Math.PI * 2); ctx.stroke(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 2); return t;
  })();
  const waterMat = new THREE.MeshStandardMaterial({ color: '#8bd0dc', map: waterTex, roughness: 0.1, metalness: 0.15, transparent: true, opacity: 0.62, depthWrite: false });
  const water = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), waterMat); water.scale.set(rx, 1, rz); water.position.y = 0.09; group.add(water);
  const bed = new THREE.Mesh(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), mat('#2f6b73', 0.9)); bed.scale.set(rx - 0.05, 1, rz - 0.05); bed.position.y = 0.02; group.add(bed);
  // stones round the edge, in an irregular ring, and a few in the water
  const rocks = [];
  for (let i = 0; i < 46; i += 1) {
    const a = (i / 46) * Math.PI * 2 + rand() * 0.1, r = 1.02 + rand() * 0.05;
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28 + rand() * 0.22, 0), rand() < 0.5 ? stone : darkStone);
    rock.position.set(Math.cos(a) * rx * r, 0.1, Math.sin(a) * rz * r); rock.scale.set(1.2, 0.55 + rand() * 0.3, 1); rock.rotation.y = rand() * 3; rock.castShadow = true; group.add(rock); rocks.push(rock);
  }
  // the jetty: planks on piles, from the bank at the east end out over the water, with rails
  const jetties = [];
  if (jetty) {
    const jx = rx - 4.4, j = new THREE.Group(); j.position.set(jx, 0, rz * 0.0); const wood = mat('#8a5a2b', 0.85), dark = mat('#5e3d1e', 0.9);
    for (let i = 0; i < 14; i += 1) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 1.5), i % 2 ? wood : mat('#94643a', 0.85)); p.position.set(i * 0.37, 0.42, 0); p.castShadow = true; j.add(p); }
    for (let i = 0; i < 5; i += 1) for (const s of [-1, 1]) { const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.8, 8), dark); pile.position.set(i * 1.3, 0.1, s * 0.7); j.add(pile); }
    for (const s of [-1, 1]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.05, 0.05), dark); rail.position.set(2.5, 0.95, s * 0.72); j.add(rail); for (let i = 0; i < 4; i += 1) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.55, 0.05), dark); post.position.set(i * 1.5, 0.7, s * 0.72); j.add(post); } }
    group.add(j); jetties.push({ x: jx + 2.6, z: 0, hx: 3.2, hz: 1.2 });
  }
  const inside = (px, pz, inset = 1) => ((px / (rx * inset)) ** 2 + (pz / (rz * inset)) ** 2) < 1;
  const onJetty = (px, pz) => jetties.some((j) => Math.abs(px - j.x) < j.hx && Math.abs(pz - j.z) < j.hz);
  const randomWaterPoint = (inset = 0.86) => { for (let k = 0; k < 30; k += 1) { const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * inset; const px = Math.cos(a) * rx * r, pz = Math.sin(a) * rz * r; if (!onJetty(px, pz)) return { x: px, z: pz }; } return { x: 0, z: 0 }; };

  // lily pads, some with a flower
  const pads = [];
  const padMats = [mat('#3f8a3a', 0.7, { side: THREE.DoubleSide }), mat('#4f9a44', 0.7, { side: THREE.DoubleSide }), mat('#2f7a3a', 0.7, { side: THREE.DoubleSide })];
  for (let i = 0; i < 26; i += 1) {
    const p = randomWaterPoint(0.8), r = 0.28 + rand() * 0.22;
    const pad = new THREE.Mesh(new THREE.CircleGeometry(r, 14, rand() * 6, 5.5).rotateX(-Math.PI / 2), padMats[i % 3]); pad.position.set(p.x, 0.11, p.z); group.add(pad); pads.push({ pad, y: 0.11, phase: rand() * 6 });
    if (rand() < 0.3) {
      const col = rand() < 0.5 ? '#f4a9c6' : '#f6f2ea';
      for (let k = 0; k < 6; k += 1) { const petal = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 5), mat(col, 0.6)); const a = (k / 6) * Math.PI * 2; petal.position.set(Math.cos(a) * 0.05, 0.07, Math.sin(a) * 0.05); petal.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6); pad.add(petal); }
      const heart = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), mat('#e8c64a', 0.6)); heart.position.y = 0.06; pad.add(heart);
    }
  }
  // reeds and bulrushes round the edge, swaying
  const reedGeo = new THREE.ConeGeometry(0.03, 1.5, 5).translate(0, 0.75, 0), headGeo = new THREE.CapsuleGeometry(0.03, 0.14, 3, 6).translate(0, 1.5, 0);
  const reeds = [];
  for (let i = 0; i < 70; i += 1) {
    const a = rand() * Math.PI * 2, r = 1.04 + rand() * 0.08, h = 0.7 + rand() * 0.9;
    if (jetty && Math.cos(a) > 0.65 && Math.abs(Math.sin(a)) < 0.3) continue; // keep the jetty clear
    const reed = new THREE.Group(); reed.position.set(Math.cos(a) * rx * r, 0.05, Math.sin(a) * rz * r); reed.scale.y = h;
    reed.add(new THREE.Mesh(reedGeo, mat(rand() < 0.5 ? '#5f8a3a' : '#79a043', 0.8)));
    if (rand() < 0.4) reed.add(new THREE.Mesh(headGeo, mat('#6b4a2a', 0.8)));
    reed.userData.phase = rand() * 6; group.add(reed); reeds.push(reed);
  }
  // fish
  const fish = [];
  for (let i = 0; i < 14; i += 1) {
    const f = makeFish(rand), p = randomWaterPoint(0.8); f.scale.setScalar(0.8 + rand() * 0.7); f.position.set(p.x, 0.045, p.z); group.add(f);
    fish.push({ mesh: f, heading: rand() * 6.28, speed: 0.25 + rand() * 0.35, target: randomWaterPoint(), phase: rand() * 6, surfaceAt: 4 + rand() * 20 });
  }
  // ducks: a pair, a mother with ducklings, and one more
  const ducks = [];
  const bank = (angle, out) => ({ x: Math.cos(angle) * rx * out, z: Math.sin(angle) * rz * out });
  const addDuck = (kind, leader = null, followIndex = 0) => {
    const mesh = makeDuck(rand, kind), p = randomWaterPoint(0.7);
    mesh.position.set(p.x, 0.09, p.z); group.add(mesh);
    ducks.push({ mesh, kind, state: 'swim', x: p.x, z: p.z, heading: rand() * 6.28, speed: kind === 'duckling' ? 0.5 : 0.35, target: randomWaterPoint(0.75), timer: rand() * 6, leader, followIndex, phase: rand() * 6, wake: 0, bankAngle: Math.PI * (0.55 + rand() * 0.5) });
    return ducks.at(-1);
  };
  addDuck('male'); addDuck('female');
  const mother = addDuck('female'); for (let i = 0; i < 4; i += 1) addDuck('duckling', mother, i + 1);
  addDuck('male');

  const steer = (o, tx, tz, dt, turn = 2.2) => { // turn smoothly toward a point
    const want = Math.atan2(tz - o.z, tx - o.x); let d = want - o.heading; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    o.heading += Math.max(-turn * dt, Math.min(turn * dt, d));
  };
  return {
    group,
    // where the ducks and fish are, in the pond's own frame, so something else can keep clear
    update(time, dt) {
      waterTex.offset.x = time * 0.004; waterTex.offset.y = time * 0.002;
      for (const p of pads) p.pad.position.y = p.y + Math.sin(time * 0.9 + p.phase) * 0.006;
      for (const r of reeds) r.rotation.set(Math.sin(time * 0.8 + r.userData.phase) * 0.06, 0, Math.cos(time * 0.6 + r.userData.phase) * 0.06);
      // fish drift to a spot, pick another, wag their tails, and now and then come up to the surface
      for (const f of fish) {
        const o = { x: f.mesh.position.x, z: f.mesh.position.z, heading: f.heading };
        if (Math.hypot(f.target.x - o.x, f.target.z - o.z) < 0.4 || !inside(o.x, o.z, 0.92)) f.target = randomWaterPoint(0.78);
        steer(o, f.target.x, f.target.z, dt, 1.6); f.heading = o.heading;
        const sp = f.speed * (1 + 0.3 * Math.sin(time * 0.7 + f.phase));
        f.mesh.position.x += Math.cos(f.heading) * sp * dt; f.mesh.position.z += Math.sin(f.heading) * sp * dt;
        f.mesh.rotation.y = -f.heading;
        f.mesh.userData.tail.rotation.y = Math.sin(time * (6 + sp * 8) + f.phase) * 0.5;
        f.surfaceAt -= dt;
        f.mesh.position.y = f.surfaceAt < 0 && f.surfaceAt > -1.2 ? 0.085 : 0.045 + Math.sin(time * 0.5 + f.phase) * 0.01;
        if (f.surfaceAt < -1.2) { f.surfaceAt = 6 + rand() * 25; ripples.spawn(f.mesh.position.x, f.mesh.position.z, 0.5, 1.5); }
      }
      // ducks: swim, dip their heads, preen, climb out onto the bank for a while and come back
      for (const d of ducks) {
        d.timer -= dt;
        const o = d;
        if (d.leader) { // a duckling stays behind its mother
          const L = d.leader, bx = L.x - Math.cos(L.heading) * 0.28 * d.followIndex, bz = L.z - Math.sin(L.heading) * 0.28 * d.followIndex;
          d.target = { x: bx, z: bz }; d.state = L.state === 'bank' || L.state === 'goBank' ? 'swim' : L.state === 'dabble' ? 'swim' : 'swim';
        }
        if (d.state === 'swim') {
          if (!d.leader && (Math.hypot(d.target.x - o.x, d.target.z - o.z) < 0.35 || onJetty(o.x, o.z))) { d.target = randomWaterPoint(0.72); }
          if (!d.leader && d.timer < 0) { const roll = rand(); if (roll < 0.35) { d.state = 'dabble'; d.timer = 1.6 + rand() * 1.4; } else if (roll < 0.5) { d.state = 'preen'; d.timer = 2 + rand() * 2; } else if (roll < 0.62 && d.kind !== 'duckling') { d.state = 'goBank'; const b = bank(d.bankAngle, 1.12); d.target = { x: b.x, z: b.z }; d.timer = 20; } else d.timer = 3 + rand() * 5; }
          steer(o, d.target.x, d.target.z, dt, d.leader ? 3 : 1.6);
          const dist = Math.hypot(d.target.x - o.x, d.target.z - o.z), sp = d.leader ? Math.min(0.9, 0.3 + dist * 1.6) : d.speed;
          if (dist > 0.05) { d.x += Math.cos(d.heading) * sp * dt; d.z += Math.sin(d.heading) * sp * dt; }
          d.wake -= dt; if (d.wake < 0 && dist > 0.1) { d.wake = 0.9 + rand() * 0.5; ripples.spawn(d.x, d.z, 0.35, 1.2); }
          d.mesh.userData.neck.rotation.z = 0; d.mesh.position.y = 0.075 + Math.sin(time * 1.3 + d.phase) * 0.004;
        } else if (d.state === 'dabble') { // tail up, head under
          d.mesh.userData.neck.rotation.z = -1.2; d.mesh.rotation.z = 0.5; d.mesh.position.y = 0.075;
          if (d.timer < 0) { d.state = 'swim'; d.timer = 3 + rand() * 6; d.mesh.rotation.z = 0; ripples.spawn(d.x, d.z, 0.5, 1.4); }
        } else if (d.state === 'preen') { d.mesh.userData.neck.rotation.z = Math.sin(time * 6) * 0.5 + 0.7; if (d.timer < 0) { d.state = 'swim'; d.timer = 3 + rand() * 6; d.mesh.userData.neck.rotation.z = 0; } }
        else if (d.state === 'goBank') { // out of the water, over the stones
          steer(o, d.target.x, d.target.z, dt, 2); d.x += Math.cos(d.heading) * 0.3 * dt; d.z += Math.sin(d.heading) * 0.3 * dt;
          if (Math.hypot(d.target.x - o.x, d.target.z - o.z) < 0.3) { d.state = 'bank'; d.timer = 7 + rand() * 8; }
          d.mesh.position.y = Math.min(0.2, d.mesh.position.y + dt * 0.1);
        } else if (d.state === 'bank') { // resting on the bank
          d.mesh.position.y = 0.2; d.mesh.userData.neck.rotation.z = Math.sin(time * 0.7 + d.phase) * 0.1;
          if (d.timer < 0) { d.state = 'swim'; d.timer = 4; d.target = randomWaterPoint(0.7); }
        }
        if (d.state === 'swim' && d.mesh.position.y > 0.08) d.mesh.position.y = Math.max(0.075, d.mesh.position.y - dt * 0.2);
        d.mesh.position.x = d.x; d.mesh.position.z = d.z; d.mesh.rotation.y = -d.heading;
      }
      ripples.update(dt);
    },
  };
}
