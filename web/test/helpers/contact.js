// Finds things that overlap on the ground in a running simulation: vehicle with vehicle, vehicle with pedestrian and
// pedestrian with pedestrian. Used by the tests and by the stress runs that look for what the tests do not cover yet.
import { overlap } from '../../src/sim/tracks.js';

const CELL = 12;
const key = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;

function describe(item, sim) {
  if (item.kind === 'vehicle') {
    const v = item.what;
    return `${v.cls}/${v.movement}/a${v.approach}/L${v.lane}/d${Math.round(v.d)}/v${v.v.toFixed(1)}`;
  }
  const p = item.what;
  return `ped/${p.state}/c${p.crossing}${p.progress > 0 ? `/p${p.progress.toFixed(1)}` : ''}`;
}

// Every pair that overlaps by more than `minDepth` metres right now: [{ kind, depth, a, b, ... }].
export function contacts(sim, minDepth = 0.1) {
  const items = [];
  for (const v of sim.vehicleList) items.push({ kind: 'vehicle', what: v, box: sim.vehicleBox(v.pose, v), x: v.pose.fx, z: v.pose.fz });
  for (const p of sim.pedestrians) if (Math.abs(p.px) < 900 && Math.abs(p.pz) < 900) items.push({ kind: 'pedestrian', what: p, box: sim.pedestrianBox(p), x: p.px, z: p.pz });
  const cells = new Map();
  for (const it of items) { const k = key(it.x, it.z); const l = cells.get(k); if (l) l.push(it); else cells.set(k, [it]); }
  const out = [];
  for (const it of items) {
    const ix = Math.floor(it.x / CELL), iz = Math.floor(it.z / CELL);
    for (let dx = -1; dx <= 1; dx += 1) for (let dz = -1; dz <= 1; dz += 1) {
      const l = cells.get(`${ix + dx},${iz + dz}`); if (!l) continue;
      for (const other of l) {
        if (other === it || (other.kind === it.kind && other.what.id <= it.what.id) || (other.kind !== it.kind && it.kind === 'pedestrian')) continue;
        const depth = overlap(it.box, other.box);
        if (depth > minDepth) out.push({ kinds: it.kind[0] + other.kind[0], depth, a: describe(it, sim), b: describe(other, sim), idA: it.what.id, idB: other.what.id, x: it.x, z: it.z });
      }
    }
  }
  return out;
}

// Runs a simulation and records every new contact, once per pair, with when and in which signal phase it started.
export function watch(sim, seconds, { minDepth = 0.1, each = () => {} } = {}) {
  const found = new Map();
  const steps = Math.round(seconds / sim.dt);
  for (let i = 0; i < steps; i += 1) {
    sim.step();
    each(sim);
    for (const c of contacts(sim, minDepth)) {
      const id = `${c.idA}:${c.idB}`, seen = found.get(id);
      if (!seen) found.set(id, { ...c, time: sim.time, phase: `${sim.snapshot.phase}/${sim.snapshot.stage}`, worst: c.depth });
      else seen.worst = Math.max(seen.worst, c.depth);
    }
  }
  return [...found.values()];
}
