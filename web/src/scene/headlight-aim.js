// Which headlights light what. For every vehicle and person (a target) it picks the beams that really fall on them: a beam lights a target when the target is inside the cone of the beam and nothing stands
// in the way between the lamps and it. Plain numbers, so Node tests it (test/headlight_aim.test.js). The page turns the answer into light on the surface (night-glow.js).
//
//   - The beam is a cone that widens from the nose, as the picture of the beam on the road does: its half width at a distance is (0.18 + 0.82 * distance / reach) * reach * spread / 2, and a margin for the
//     lamp that is off the middle.
//   - A target is tested at five points, its middle and the middles of its four sides, so a vehicle that is only partly in the cone is lit too, and a long bus crossing in front is lit where the beam is on it.
//   - Another vehicle between the lamp and the point shadows it. A person behind a vehicle, or a vehicle behind a queue, is not lit.
//   - A target is lit by at most two beams, the two strongest from different vehicles, as an oncoming vehicle and the one behind both light the vehicle in front.
// Everything is in the model frame of the scene: a vehicle faces (cos yaw, -sin yaw) when its mesh is turned by `yaw`, and its right is (sin yaw, cos yaw).

export const MAX_BEAMS = 2;
export const SPARE = 0.1; // metres a body is shrunk by in the shadow test, so a beam that only grazes the corner of a body still passes
const NOSE_FRACTION = 0.18;

const forward = (yaw) => [Math.cos(yaw), -Math.sin(yaw)], right = (yaw) => [Math.sin(yaw), Math.cos(yaw)];
export const coneHalf = (beam, along) => (NOSE_FRACTION + (1 - NOSE_FRACTION) * Math.min(1, along / beam.reach)) * beam.reach * beam.spread / 2 + beam.extra;

// Does the segment from (ax, az) to (bx, bz) pass through the body? (the slab test, in the body's own frame)
export function blocked(ax, az, bx, bz, body) {
  const f = forward(body.yaw), r = right(body.yaw), hu = body.length / 2 - SPARE, hv = body.width / 2 - SPARE;
  const toLocal = (x, z) => [(x - body.x) * f[0] + (z - body.z) * f[1], (x - body.x) * r[0] + (z - body.z) * r[1]];
  const [u0, v0] = toLocal(ax, az), [u1, v1] = toLocal(bx, bz), du = u1 - u0, dv = v1 - v0;
  let lo = 0, hi = 1;
  for (const [p, d, h] of [[u0, du, hu], [v0, dv, hv]]) {
    if (Math.abs(d) < 1e-9) { if (Math.abs(p) > h) return false; continue; }
    let t1 = (-h - p) / d, t2 = (h - p) / d; if (t1 > t2) [t1, t2] = [t2, t1];
    lo = Math.max(lo, t1); hi = Math.min(hi, t2); if (lo > hi) return false;
  }
  return true;
}

// attackers: [{ id, x, z, yaw, start, reach, spread, extra }]. bodies: [{ id, x, z, yaw, length, width }] (every vehicle, which can shadow). targets: [{ id, x, z, yaw, length, width }].
// Returns a Map from target id to up to MAX_BEAMS of { from, score, x, z, ax, az, reach, spread, extra }, strongest first.
export function pickBeams(attackers, bodies, targets) {
  const out = new Map();
  const lamps = attackers.map((a) => { const [fx, fz] = forward(a.yaw); return { ...a, fx, fz, nx: a.x + fx * a.start, nz: a.z + fz * a.start, rx: -fz, rz: fx }; }); // rx, rz: across the beam
  for (const t of targets) {
    const [tfx, tfz] = forward(t.yaw), [trx, trz] = right(t.yaw), hl = t.length / 2, hw = t.width / 2;
    const points = [[t.x, t.z], [t.x + tfx * hl, t.z + tfz * hl], [t.x - tfx * hl, t.z - tfz * hl], [t.x + trx * hw, t.z + trz * hw], [t.x - trx * hw, t.z - trz * hw]];
    const found = [];
    for (const a of lamps) {
      if (a.id === t.id || Math.hypot(t.x - a.nx, t.z - a.nz) > a.reach + hl + 1) continue;
      let best = null;
      for (const [px, pz] of points) {
        const dx = px - a.nx, dz = pz - a.nz, along = dx * a.fx + dz * a.fz, across = Math.abs(dx * a.rx + dz * a.rz);
        if (along <= 0 || along > a.reach) continue;
        const half = coneHalf(a, along); if (across >= half) continue;
        const score = (1 - along / a.reach) ** 1.4 * (1 - across / half) ** 0.9; if (best && score <= best.score) continue;
        const mx = (a.nx + px) / 2, mz = (a.nz + pz) / 2, half2 = Math.hypot(dx, dz) / 2; // only the bodies near the segment are tested
        if (bodies.some((b) => b.id !== a.id && b.id !== t.id && Math.hypot(b.x - mx, b.z - mz) < half2 + b.length && blocked(a.nx, a.nz, px, pz, b))) continue;
        best = { from: a.id, score, x: a.nx, z: a.nz, ax: a.fx, az: a.fz, reach: a.reach, spread: a.spread, extra: a.extra };
      }
      if (best && best.score > 0.01) found.push(best);
    }
    if (found.length) out.set(t.id, found.sort((p, q) => q.score - p.score).slice(0, MAX_BEAMS));
  }
  return out;
}

// How far a lamp's beam runs along the road before it meets another vehicle: the first body that the ray from the lamp enters. Infinity when nothing is in the way. This is the same test of "in the way" as the
// shadows in pickBeams, so a vehicle that cuts the beam short on the road is the vehicle that is lit by it, and one that is not in the way does not shorten it. A body that the lamp is already inside (two vehicles
// overlapping in a tight turn) is ignored, so the beam does not collapse for a moment.
export function rayDistance(ox, oz, dx, dz, body) {
  const f = forward(body.yaw), r = right(body.yaw), hu = body.length / 2 - SPARE, hv = body.width / 2 - SPARE;
  const px = ox - body.x, pz = oz - body.z, u0 = px * f[0] + pz * f[1], v0 = px * r[0] + pz * r[1], du = dx * f[0] + dz * f[1], dv = dx * r[0] + dz * r[1];
  let lo = -Infinity, hi = Infinity;
  for (const [p, d, h] of [[u0, du, hu], [v0, dv, hv]]) {
    if (Math.abs(d) < 1e-9) { if (Math.abs(p) > h) return Infinity; continue; }
    let t1 = (-h - p) / d, t2 = (h - p) / d; if (t1 > t2) [t1, t2] = [t2, t1];
    lo = Math.max(lo, t1); hi = Math.min(hi, t2); if (lo > hi) return Infinity;
  }
  return lo > 0 ? lo : Infinity; // lo <= 0: the lamp is inside the body or the body is behind it
}

export function beamFree(lamp, bodies, selfId) { // lamp: { x, z, dx, dz, reach }
  let free = lamp.reach;
  for (const b of bodies) {
    if (b.id === selfId || Math.hypot(b.x - lamp.x, b.z - lamp.z) > lamp.reach + b.length) continue;
    const t = rayDistance(lamp.x, lamp.z, lamp.dx, lamp.dz, b);
    if (t < free) free = t;
  }
  return free;
}

// A length that follows its target over time: it shortens quickly when something comes into the way and lengthens more slowly when the way clears, as a driver's eye takes it, and never jumps. `dt` in seconds.
export const BEAM_SHRINK_TAU = 0.12, BEAM_GROW_TAU = 0.35;
export function easeBeam(current, target, dt) {
  const tau = target < current ? BEAM_SHRINK_TAU : BEAM_GROW_TAU;
  return current + (target - current) * (1 - Math.exp(-Math.max(0, dt) / tau));
}
