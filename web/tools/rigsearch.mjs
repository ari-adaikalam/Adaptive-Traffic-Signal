// Which cameras, mounted where, cover the detection zone of one approach at the lowest cost? One simulation of the morning rush gives the frames. Every candidate camera is tested on
// every frame (see detectability.mjs for what "seen" means), and then every group of one, two or three cameras is scored on the share of vehicles that at least one of them sees, in each
// quarter of the zone. Usage: node tools/rigsearch.mjs [zone metres] [seeds] > rigs.json
import { PRESETS, Simulation } from '../src/sim/traffic.js';
import { camera, seenBy } from './detectability.mjs';

// Planning prices in US dollars, assumptions and not quotes (docs/simulation.md has the published figures they were checked against). One rig is the same on all four approaches.
export const PRICES = { camera: 800, existing: 1200, building: 1200, permit: 1500, pole: 8700, cablePerMetre: 90, shared: 10000 }; // mounting on an existing mast or lamp pole, a building bracket and its permit, a new 15 m pole with its camera fitting, data and power cable, and the processing unit and commissioning
const MOUNT_COST = { mast: PRICES.existing, arm: PRICES.existing, lamp: PRICES.existing, building: PRICES.building + PRICES.permit, pole: PRICES.pole };
export const rigCost = (cameras) => 4 * (cameras.reduce((sum, c) => sum + PRICES.camera + MOUNT_COST[c.mount], 0) + PRICES.cablePerMetre * (Math.max(...cameras.map((c) => Math.abs(c.at))) + 5)) + PRICES.shared;
const ZONE = Number(process.argv[2] || 100), seedCount = Number(process.argv[3] || 6), QUARTERS = [0, 1, 2, 3].map((q) => [q * ZONE / 4, (q + 1) * ZONE / 4]);
// Mounts: what a camera sits on decides its height, its distance from the road and its price (see PRICES in budget.mjs).
const MOUNTS = {
  mast: { x: 11.9, h: 8, kind: 'existing' }, // the signal mast pole, side view at the stop line only
  lamp: { x: 13.05, h: 8, kind: 'existing' }, // an existing lamp pole, 8 m up, every 32 m from 8.7 m
  building: { x: 13.2, h: 10, kind: 'building' }, // the face of a low building on the building line, 10 m up
  pole: { x: 10.8, h: 15, kind: 'pole' }, // a new 15 m pole on the footpath
};
const candidates = [];
candidates.push({ mount: 'mast', at: 0, fov: 130, cam: { x: MOUNTS.mast.x, h: 8, at: 0, aimAt: 0, aimX: 4.8, fov: 130 } });
candidates.push({ mount: 'arm', at: -2.3, fov: 90, cam: { x: 4.8, h: 7.3, at: -2.3, aimAt: 50, aimX: 4.8, fov: 90 } }); // on the mast arm, looking up the road
for (let at = 8.7; at <= ZONE + 40; at += 32) candidates.push({ mount: 'lamp', at, fov: 130, cam: { x: MOUNTS.lamp.x, h: 8, at, aimAt: at, aimX: 4.8, fov: 130 } });
for (const at of [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]) for (const mount of ['building', 'pole']) for (const fov of [110, 130]) candidates.push({ mount, at, fov, cam: { x: MOUNTS[mount].x, h: MOUNTS[mount].h, at, aimAt: at, aimX: 4.8, fov } });
const lens = candidates.map((c) => camera(c.cam));

const seen = candidates.map(() => []); const band = [];
for (let seed = 1; seed <= seedCount; seed += 1) {
  const sim = new Simulation({ seed, mode: 'adaptive', demand: { ...PRESETS.clock, clockStartS: 7.5 * 3600 }, lengthCounts: true, detectionZone: ZONE, approachLength: 400, exitRun: 100 });
  for (let i = 0; i < 900 * 10; i += 1) {
    sim.step();
    if (i < 300 * 10 || i % 50) continue;
    const vs = sim.vehicleList.filter((v) => v.approach === 1 && v.d > 3 && v.d <= ZONE);
    const results = lens.map((l) => seenBy(l, vs));
    for (const v of vs) { band.push(QUARTERS.findIndex(([lo, hi]) => v.d >= lo && v.d < hi)); candidates.forEach((_, k) => seen[k].push(results[k].get(v) ? 1 : 0)); }
  }
}
const n = band.length;
const score = (group) => {
  const hit = [0, 0, 0, 0], tot = [0, 0, 0, 0];
  for (let j = 0; j < n; j += 1) { tot[band[j]] += 1; if (group.some((k) => seen[k][j])) hit[band[j]] += 1; }
  return hit.map((h, q) => (tot[q] ? h / tot[q] : 1));
};
const out = [];
const K = candidates.length, label = (k) => `${candidates[k].mount} ${candidates[k].at} m ${candidates[k].fov}deg`;
const add = (group) => { const s = score(group); out.push({ cameras: group.map((k) => ({ mount: candidates[k].mount, at: candidates[k].at, fov: candidates[k].fov, h: candidates[k].cam.h })), labels: group.map(label), quarters: s, min: Math.min(...s), cost: rigCost(group.map((k) => ({ mount: candidates[k].mount, at: candidates[k].at }))) }); };
const MAX = Number(process.env.MAXCAM || 3);
for (let a = 0; a < K; a += 1) { add([a]); if (MAX >= 2) for (let b = a + 1; b < K; b += 1) { add([a, b]); } }
if (MAX >= 3) for (let a = 0; a < K; a += 1) for (let b = a + 1; b < K; b += 1) { if (score([a, b]).every((s) => s >= 0.95)) continue; for (let c = b + 1; c < K; c += 1) add([a, b, c]); }
console.log(JSON.stringify({ zone: ZONE, frames: n, rigs: out.filter((r) => r.min >= Number(process.env.MIN || 0.85)) }));
