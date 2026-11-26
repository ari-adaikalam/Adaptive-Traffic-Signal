// A car park off a side street: where the bays are, and the paths the cars take into a bay and out of it, in metres. This file has no Three.js in it, so the shapes (carpark.js), the cars' and people's moves
// (carpark-life.js) and the tests (web/test/carpark.test.js) all use the same numbers.
//
// The frame: `a` runs along the side street, in the way the cars leaving the junction go (away from the main road), and `t` runs from the edge of the block, where the footpath of the side street ends (t = 0), into
// the block. The street is at negative t: the lane nearer the block is at LANE_NEAR (the lane the traffic turning in from the main road uses, with the block on its left, as in left-hand traffic) and the other at
// LANE_FAR. a = 0 is the middle of the aisle. Headings are angles in the (a, t) plane: 0 is along +a, PI / 2 is into the block.
//
// The car park is one aisle running into the block with ten bays down each side, square to the aisle. Cars come from the far end of the street in the far lane, cross the near lane and turn right into the aisle,
// and go into a bay nose first. They leave by backing out, swinging round to face the street, going down the aisle and turning left into the near lane, away from the junction.
import { CLASSES } from '../sim/world.js';
import { box, overlap } from '../sim/tracks.js';

export const CAR = CLASSES.car; // 4.5 m long and 1.9 m wide
export const LOT = {
  aisle: 8, bayW: 2.7, bayD: 5.2, perSide: 10, entryT: 4, turnEnd: 7, // the aisle, the bays (2.7 m wide: 0.8 m between two parked cars), the first bay's start, the space past the last bay
  rIn: 5, rBay: 4.5, rBack: 3, rOut: 4, back: 2.2, // turning radii: into the aisle, into a bay, backing out, out of the aisle; how far the car backs out in a straight line, past the bay's mouth
  laneNear: -4.5, laneFar: -8.5, // the two lanes of the street
  sidewalk: 1.0, // the footpath outside the bays, from the end of the bay
};
export const depth = () => LOT.entryT + LOT.perSide * LOT.bayW + LOT.turnEnd; // the aisle from the street to the end
export const halfWidth = () => LOT.aisle / 2 + LOT.bayD; // the car park from the middle of the aisle to the end of the bays
export const walkT = () => depth() + 1.2; // the walkway along the front of the building, a little past the end of the aisle
export const doorAt = () => ({ a: 0, t: depth() + 2.4 }); // the door, in the front of the building

// The bays: side +1 is the one at +a. A car in one is centred 2.5 m inside the aisle's edge, nose pointing out (to +a for side +1, to -a for side -1).
export function bays() {
  const out = [];
  for (const side of [1, -1]) for (let i = 0; i < LOT.perSide; i += 1) out.push({ id: out.length, side, index: i, a: side * (LOT.aisle / 2 + LOT.bayD / 2), t: LOT.entryT + (i + 0.5) * LOT.bayW, heading: side > 0 ? 0 : Math.PI });
  return out;
}

// ----- paths -----
// A path is a list of segments. A line goes from (a0, t0) to (a1, t1). An arc goes about the centre (ca, ct) with radius r from angle th0 to th1 (counterclockwise when th1 > th0). A segment with `reverse` is driven
// backwards: the car's nose points the opposite way to the one it moves.
export function makePath(segments) {
  const parts = []; let length = 0;
  for (const seg of segments) {
    const len = seg.type === 'line' ? Math.hypot(seg.a1 - seg.a0, seg.t1 - seg.t0) : Math.abs(seg.th1 - seg.th0) * seg.r;
    parts.push({ ...seg, from: length, len }); length += len;
  }
  return {
    length, segments: parts,
    // The car at distance s along the path: its centre, the way its nose points, whether it is going backwards, and the way it is going.
    at(s) {
      const d = Math.max(0, Math.min(length, s)); let part = parts[parts.length - 1];
      for (const p of parts) if (d <= p.from + p.len + 1e-9) { part = p; break; }
      const k = part.len > 0 ? Math.max(0, Math.min(1, (d - part.from) / part.len)) : 0;
      let a, t, travel;
      if (part.type === 'line') { a = part.a0 + (part.a1 - part.a0) * k; t = part.t0 + (part.t1 - part.t0) * k; travel = Math.atan2(part.t1 - part.t0, part.a1 - part.a0); }
      else { const th = part.th0 + (part.th1 - part.th0) * k, sign = Math.sign(part.th1 - part.th0); a = part.ca + part.r * Math.cos(th); t = part.ct + part.r * Math.sin(th); travel = th + sign * Math.PI / 2; }
      return { a, t, travel, heading: travel + (part.reverse ? Math.PI : 0), reverse: Boolean(part.reverse), segment: parts.indexOf(part), tag: part.tag };
    },
  };
}
const line = (a0, t0, a1, t1, extra = {}) => ({ type: 'line', a0, t0, a1, t1, ...extra });
const arc = (ca, ct, r, th0, th1, extra = {}) => ({ type: 'arc', ca, ct, r, th0, th1, ...extra });

// From the far lane to a bay, as a path that starts at (aStart, laneFar) heading -a (toward the junction), turns right into the aisle, goes down it, turns into the bay and stops in it.
// `tag` says where the car is: 'street', 'cross' (turning in, across the near lane), 'aisle', 'bay'.
export function arrivalPath(bay, aStart) {
  const s = bay.side, aLane = s * (LOT.aisle / 2 - LOT.rBay), tBay = bay.t; // aLane: the line down the aisle from which the car swings into the bay with the radius rBay
  // the turn into the aisle: a right turn from heading PI (-a) to heading PI / 2 (+t), ending on the aisle's line, with the radius rIn
  const entryCentreA = aLane + LOT.rIn, entryCentreT = LOT.laneFar + LOT.rIn; // the centre is on the +a side of the car, +t of it
  const xs = entryCentreA; // the arc starts straight above the centre, in the far lane
  const segs = [line(aStart, LOT.laneFar, xs, LOT.laneFar, { tag: 'street' })];
  segs.push(arc(entryCentreA, entryCentreT, LOT.rIn, -Math.PI / 2, -Math.PI, { tag: 'cross' })); // clockwise, to (aLane, entryCentreT)
  segs.push(line(aLane, entryCentreT, aLane, tBay - LOT.rBay, { tag: 'aisle' }));
  // into the bay: from heading +t to heading +a (side +1) or -a (side -1)
  if (s > 0) segs.push(arc(aLane + LOT.rBay, tBay - LOT.rBay, LOT.rBay, Math.PI, Math.PI / 2, { tag: 'bay' })); // clockwise
  else segs.push(arc(aLane - LOT.rBay, tBay - LOT.rBay, LOT.rBay, 0, Math.PI / 2, { tag: 'bay' })); // counterclockwise
  segs.push(line(s * LOT.aisle / 2, tBay, bay.a, tBay, { tag: 'bay' }));
  return makePath(segs);
}

// From a bay out into the street: backs straight out past the mouth of the bay, then backs round (the nose swings to face the street), goes forward down the aisle and turns left into the near lane and away.
export function departurePath(bay, aEnd = 700) {
  const s = bay.side, tBay = bay.t, mouth = s * LOT.aisle / 2, pa = mouth - s * LOT.back; // the car's centre when it is clear of the bay
  const centreA = pa, centreT = tBay + LOT.rBack, endA = pa - s * LOT.rBack, endT = tBay + LOT.rBack; // the back-round arc
  const segs = [line(bay.a, tBay, pa, tBay, { reverse: true, tag: 'bay' })];
  if (s > 0) segs.push(arc(centreA, centreT, LOT.rBack, -Math.PI / 2, -Math.PI, { reverse: true, tag: 'aisle' })); // the car's tail goes toward +t, round to face -t
  else segs.push(arc(centreA, centreT, LOT.rBack, -Math.PI / 2, 0, { reverse: true, tag: 'aisle' }));
  const exitTop = -0.5;
  segs.push(line(endA, endT, endA, exitTop, { tag: 'aisle' }));
  segs.push(arc(endA + LOT.rOut, exitTop, LOT.rOut, Math.PI, 1.5 * Math.PI, { tag: 'cross' })); // the left turn into the near lane
  segs.push(line(endA + LOT.rOut, LOT.laneNear, endA + aEnd, LOT.laneNear, { tag: 'street' }));
  return makePath(segs);
}

// ----- speeds -----
// The speed along a path: a limit for each tag, brought down in time to meet any lower limit ahead (at `decel`), and up from the start speed (at `accel`).
const LIMITS = { street: 14, cross: 4.5, aisle: 4, bay: 2 };
export function speedProfile(path, { v0 = 0, vEnd = 0, limits = {}, accel = 2.2, decel = 3, step = 0.25 } = {}) {
  const lim = { ...LIMITS, ...limits }, n = Math.max(1, Math.ceil(path.length / step)), ds = path.length / n, v = new Float64Array(n + 1);
  for (let i = 0; i <= n; i += 1) { const tag = path.at(i * ds).tag; v[i] = lim[tag] ?? lim.street; }
  v[0] = Math.min(v[0], v0); v[n] = Math.min(v[n], vEnd);
  for (let i = n - 1; i >= 0; i -= 1) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * decel * ds));
  for (let i = 0; i < n; i += 1) v[i + 1] = Math.min(v[i + 1], Math.sqrt(v[i] * v[i] + 2 * accel * ds));
  return (s) => { const x = Math.max(0, Math.min(n, s / ds)), i = Math.min(n - 1, Math.floor(x)); return v[i] + (v[i + 1] - v[i]) * (x - i); };
}

// The ground a car covers at a pose, as a box for the overlap test of the simulator (x is a, z is t).
export const footprint = (a, t, heading, margin = 0) => box(a, t, heading, CAR.length + 2 * margin, CAR.width + 2 * margin);
export { overlap };
