// How many of the vehicles on an approach could the cameras of a design actually see, from where they can really be mounted? Each camera has a position, an aim and a lens.
// A vehicle is missed by a camera if another, closer vehicle hides more than 60% of it from that angle, if it is narrower than 30 pixels on a 4K sensor, or if it is out of frame.
// The cameras of a design work together: a vehicle counts as seen if any one of them picks it out. Geometry only. Night, rain, glare, lens distortion and the detector's own misses
// are not in it. Shares are by distance from the stop line, in stretches of 30 m, over several seeds of one demand preset.
// Usage: node tools/detectability.mjs [demand preset] [seconds] [seeds]       (SHOW=designs only prints the list)
import { PRESETS, Simulation } from '../src/sim/traffic.js';
import { FULL_MIX, withFullMix } from '../src/sim/compare.js';
import { CLASSES, VEHICLE_HEIGHT } from '../src/sim/world.js';

const preset = process.argv[2] || 'peak', seconds = Number(process.argv[3] || 900), seeds = Array.from({ length: Number(process.argv[4] || 4) }, (_, i) => i + 1);
const ASPECT = 9 / 16; // a 4K frame is 16 by 9
const HEIGHT = VEHICLE_HEIGHT;
// Approach 1 comes from the -z side along x = 4.8 (the middle lane), the stop line at z = -15.3, and its traffic heads +z. `at` is metres from the stop line, up the road.
const LANE = 4.8, STOP = -15.3, MAST_X = 11.9, LAMP_X = 13.05, POLE_X = 10.8; // the signal mast pole and the lamp poles are existing, the camera poles are new, on the footpath
const mast = (fov, aimAt) => ({ x: LANE, h: 7.3, at: -2.3, aimAt, aimX: LANE, fov }); // on the signal mast arm, over the lanes, looking up the road
const side = (x, h, at, fov) => ({ x, h, at, aimAt: at, aimX: LANE, fov }); // looks across the road at the lane in front of it
const onLamp = (at, fov = 130) => side(LAMP_X, 8, at, fov); // on an existing 8 m lamp pole (lamp poles stand 32 m apart: 8.7, 40.7, 72.7, 104.7, 136.7 m)
const onPole = (at, fov = 130) => side(POLE_X, 15, at, fov); // on a new 15 m pole
export const DESIGNS = [
  { name: 'mast arm, 60 degree lens', cams: [mast(60, 40)] },
  { name: 'mast arm, 90 degree lens', cams: [mast(90, 50)] },
  { name: 'existing mast pole, side view at the stop line', cams: [side(MAST_X, 8, 0, 130)] },
  { name: 'existing lamp pole 40.7 m', cams: [onLamp(40.7)] },
  { name: 'existing lamp pole 72.7 m', cams: [onLamp(72.7)] },
  { name: 'new 15 m pole at 45 m', cams: [onPole(45)] },
  { name: 'new 15 m pole at 60 m', cams: [onPole(60)] },
  { name: 'mast pole + lamp pole 72.7 m', cams: [side(MAST_X, 8, 0, 130), onLamp(72.7)] },
  { name: 'two lamp poles 40.7 and 104.7 m', cams: [onLamp(40.7), onLamp(104.7)] },
  { name: 'mast pole + lamp poles 40.7 and 104.7 m', cams: [side(MAST_X, 8, 0, 130), onLamp(40.7), onLamp(104.7)] },
  { name: 'three lamp poles 40.7, 72.7, 104.7 m', cams: [onLamp(40.7), onLamp(72.7), onLamp(104.7)] },
  { name: 'two new poles at 45 and 115 m', cams: [onPole(45), onPole(115)] },
  { name: 'three new poles at 30, 88 and 140 m (the 3D scene)', cams: [onPole(30), onPole(88), onPole(140)] },
];
if (process.env.SHOW === 'designs') { console.log(DESIGNS.map((d) => d.name).join('\n')); process.exit(0); }

const sub = (a, b) => a.map((v, i) => v - b[i]), dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0), cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const n = Math.hypot(...a); return a.map((v) => v / n); };
export const camera = (c) => {
  const pos = [c.x, c.h, STOP - c.at], aim = [c.aimX, 0, STOP - c.aimAt], fwd = norm(sub(aim, pos)), right = norm(cross(fwd, [0, 1, 0])), tx = Math.tan((c.fov / 2) * Math.PI / 180);
  return { pos, fwd, right, up: cross(right, fwd), f: 1920 / tx, tx, ty: tx * ASPECT };
};
for (const d of DESIGNS) d.lens = d.cams.map(camera);
const area = (r) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
const inter = (a, b) => area({ x0: Math.max(a.x0, b.x0), x1: Math.min(a.x1, b.x1), y0: Math.max(a.y0, b.y0), y1: Math.min(a.y1, b.y1) });
function rectOf(cam, v) {
  const c = CLASSES[v.cls], cx = (v.pose.fx + v.pose.rx) / 2, cz = (v.pose.fz + v.pose.rz) / 2, h = Math.atan2(v.pose.fz - v.pose.rz, v.pose.fx - v.pose.rx), ch = Math.cos(h), sh = Math.sin(h);
  const xs = [], ys = [];
  for (const a of [-c.length / 2, c.length / 2]) for (const b of [-c.width / 2, c.width / 2]) for (const y of [0, HEIGHT[v.cls] || 2]) {
    const d = sub([cx + a * ch - b * sh, y, cz + a * sh + b * ch], cam.pos), z = dot(d, cam.fwd);
    if (z > 0.5) { xs.push(dot(d, cam.right) / z); ys.push(dot(d, cam.up) / z); }
  }
  return xs.length ? { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), slant: Math.hypot(cx - cam.pos[0], cam.pos[1] - 0, cz - cam.pos[2]) } : null;
}
export function seenBy(cam, vs) {
  const rects = new Map(vs.map((v) => [v, rectOf(cam, v)])), result = new Map();
  for (const v of vs) {
    const r = rects.get(v); if (!r) { result.set(v, false); continue; }
    let covered = 0; for (const o of vs) { const q = rects.get(o); if (o !== v && q && q.slant < r.slant) covered = Math.max(covered, inter(r, q) / (area(r) || 1)); }
    const inFrame = Math.abs((r.x0 + r.x1) / 2) < cam.tx && Math.abs((r.y0 + r.y1) / 2) < cam.ty;
    result.set(v, inFrame && covered <= 0.6 && cam.f * (r.x1 - r.x0) >= 30);
  }
  return result;
}

const BANDS = [[0, 30], [30, 60], [60, 90], [90, 120], [120, 150]];
export const measure = (design, demandPreset = preset, secs = seconds, seedList = seeds) => {
  const demand = withFullMix(PRESETS[demandPreset], demandPreset === 'peak' || demandPreset === 'bus_hours' ? FULL_MIX.rush : FULL_MIX.work);
  const tally = BANDS.map(() => ({ n: 0, seen: 0 }));
  for (const seed of seedList) {
    const sim = new Simulation({ seed, mode: 'adaptive', demand, lengthCounts: true, approachLength: 400, exitRun: 100 });
    for (let i = 0; i < secs * 10; i += 1) {
      sim.step();
      if (i < 300 * 10 || i % 10) continue;
      const vs = sim.vehicleList.filter((v) => v.approach === 1 && v.d > 3 && v.d <= 150);
      const results = design.lens.map((cam) => seenBy(cam, vs));
      for (const v of vs) {
        const b = BANDS.findIndex(([lo, hi]) => v.d >= lo && v.d < hi); if (b < 0) continue;
        tally[b].n += 1; if (results.some((r) => r.get(v))) tally[b].seen += 1;
      }
    }
  }
  return tally.map((t) => (t.n ? t.seen / t.n : 1));
};

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`${preset} demand, adaptive, full mix, one approach, ${seeds.length} seeds of ${seconds - 300} s after a 5 minute warm-up. Share of vehicles the cameras could pick out:\n`);
  console.log(`${'design'.padEnd(58)}${BANDS.map(([a, b]) => `${a}-${b} m`.padStart(9)).join('')}`);
  for (const d of DESIGNS) console.log(`${d.name.padEnd(58)}${measure(d).map((s) => `${(100 * s).toFixed(0)}%`.padStart(9)).join('')}`);
}
