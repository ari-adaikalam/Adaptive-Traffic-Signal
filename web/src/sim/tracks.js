// Where every vehicle and pedestrian is, in metres on the ground, for the page to draw and for the tests to check.
// The simulation works along lanes. This turns that into positions: the front axle follows the lane and the turn,
// the rear axle trails behind it, and a vehicle that has left the junction carries on out along the road.
// World axes: x and z on the ground. Approach k (0 to 3) is the junction rotated k quarter turns.

import {
  BOX_PATH, KERB, SIDE_STREET_COUNT, SIDE_STREET_SPACING, SIDE_STREET_TURN_RADIUS, joinDistance, pedestrianExtent, pedestrianLane,
} from './world.js';

export const Q = Math.PI / 2;
export const LANE_WIDTH = 3.2;
export const HALF_ROAD = LANE_WIDTH * 3; // the road is three lanes each way
// Layout of an approach, in metres, in its own frame (x across the road, y toward the junction, the middle of the junction at 0).
// Going in: the stop line, then the zebra crossing, which lies within the rounded corners, then the junction.
export const CROSSING_Y = -12; // the middle of the zebra crossing
export const CROSSING_HALF = 1.6; // it is 3.2 m wide, so it runs from 13.6 m to 10.4 m out
export const STOP_Y = -(HALF_ROAD + 4.8); // the stop line, 14.4 m out
export const LANE_X = [8.0, 4.8, 1.6]; // kerb, through and right turn, from the median
export const WHEELBASE = { car: 2.7, truck: 5, bus: 6, bike: 1.5, amb: 3.5, van: 3.3, semi: 9.5, artbus: 7.5, scooter: 1.2, fire: 5.0, police: 2.7 };
// The pavement corners are rounded with this radius, which is what lets a bus or truck swing round them on the asphalt.
// In the frame of an approach the corner is at x = HALF_ROAD, y = -HALF_ROAD and the arc is centred at (HALF_ROAD + r, -HALF_ROAD - r).
export const CORNER_RADIUS = 8;
// Is this point, in the frame of an approach, on the pavement near that corner? (Outside the corner it is the road.)
export function onPavementCorner(x, y) {
  const c = HALF_ROAD + CORNER_RADIUS;
  if (x < HALF_ROAD || y > -HALF_ROAD) return false;
  return x > c || y < -c || Math.hypot(x - c, y + c) < CORNER_RADIUS;
}

// A turn starts at the stop line, sweeps wide enough for a bus, stays on the asphalt and ends in the middle of an exit lane:
// a left turn from the kerb lane into the second lane out (radius 9.6) and a right turn from the right-turn lane into the
// second lane out (radius 19.2). A tighter turn swings a bus's tail into the lanes of the opposing traffic.
export const TURN_START = 0; // metres from the stop line
export const turnRadius = (movement) => (movement === 'left' ? 9.6 : 19.2);
// How far into the left turn out of the junction into a side street a vehicle is. Negative before it starts.
export function exitTurnProgress(v) {
  return v.exitVia ? STOP_Y - v.d - (v.exitVia * SIDE_STREET_SPACING - 2 - SIDE_STREET_TURN_RADIUS) : -Infinity;
}
export const turnLength = (movement, lx) => TURN_START + Q * turnRadius(movement, lx);
const TURN_R = SIDE_STREET_TURN_RADIUS;
const STEP = SIDE_STREET_SPACING;

// The zebra crossing where each side street meets a main road. It lies across the footpath, so the people walking along it cross the street on it, and a vehicle gives way to them
// (the Australian rule). In the frame of an approach it runs from MOUTH_ZEBRA_NEAR to MOUTH_ZEBRA_FAR out from the middle of the road, and across the whole street. The walking lanes
// (11.2 to 12.6 m out) are inside it.
export const STREET_WIDTH = 8;
export const MOUTH_ZEBRA_NEAR = HALF_ROAD, MOUTH_ZEBRA_FAR = 12.8; // from the edge of the road, so there is no gap, and 3.2 m long like the zebras of the junction
const MOUTH_REACH = 2; // metres either side of the stripes along the footpath: a person this near is about to cross, or has just stepped on
export const MOUTH_STOP = 2; // metres a vehicle stops short of the stripes
// All 48: four approach frames, the two sides of the road in each, and the six streets. `x, z` is the middle in the world and `hx, hz` the half sizes.
// A zebra is named by the approach frame it is seen in (k, 0 to 3), the side of the road in that frame (1 is the kerb side of the way in, -1 the other) and the street number n.
export const mouthKey = (k, side, n) => k * 100 + (side > 0 ? 0 : 50) + n;
export const mouthZebras = () => {
  const out = [];
  for (let k = 0; k < 4; k += 1) for (const side of [-1, 1]) for (let n = 1; n <= SIDE_STREET_COUNT; n += 1) {
    const [x, z] = rotate(k, side * (MOUTH_ZEBRA_NEAR + MOUTH_ZEBRA_FAR) / 2, -n * STEP), across = (MOUTH_ZEBRA_FAR - MOUTH_ZEBRA_NEAR) / 2, along = STREET_WIDTH / 2;
    out.push({ k, side, n, key: mouthKey(k, side, n), x, z, hx: k % 2 ? along : across, hz: k % 2 ? across : along });
  }
  return out;
};
// Is a person at (x, z) on a zebra, or within MOUTH_REACH of its stripes along the footpath?
export function onMouthZebra(zebra, x, z) {
  const [ex, ez] = rotate((4 - zebra.k) % 4, x, z), [cx, cz] = rotate((4 - zebra.k) % 4, zebra.x, zebra.z); // in the frame of the zebra's own approach
  return Math.abs(ex - cx) <= (MOUTH_ZEBRA_FAR - MOUTH_ZEBRA_NEAR) / 2 + 0.8 && Math.abs(ez - cz) <= STREET_WIDTH / 2 + MOUTH_REACH;
}
// How far a vehicle's front is along its turn when it first reaches the stripes, for one coming out of a side street (it comes in from the far edge) and one turning into it (from the near edge).
export const joinerZebraStart = (lx) => TURN_R * (Q - Math.asin(Math.min(1, Math.max(-1, (lx + TURN_R - MOUTH_ZEBRA_FAR) / TURN_R))));
export const exitZebraStart = (lx) => TURN_R * Math.acos(Math.min(1, Math.max(-1, (lx + TURN_R - MOUTH_ZEBRA_NEAR) / TURN_R)));

export const rotate = (k, x, y) => {
  const c = [1, 0, -1, 0][k], s = [0, 1, 0, -1][k];
  return [x * c - y * s, x * s + y * c];
};

// The front axle of a vehicle and the way the road runs there. lx is how far across the road it is, which eases from
// one lane to the next on a lane change.
export function vehiclePose(v, lx = LANE_X[v.lane]) {
  const k = v.approach - 1;
  let fx = lx, fy = STOP_Y - v.d, hl = Q;
  const via = v.via, joinD = via ? joinDistance(via) : 0;
  if (via && v.d > joinD) { // still on the side street it came in from, or turning left off it
    const s = v.d - joinD, arc = Q * TURN_R, ys = -via * STEP + 2;
    if (s <= arc) { const th = Q - s / TURN_R; fx = lx + TURN_R - TURN_R * Math.sin(th); fy = ys + TURN_R * (1 - Math.cos(th)); hl = Math.PI - th; }
    else { fx = lx + TURN_R + (s - arc); fy = ys; hl = Math.PI; }
  }
  if (v.d < 0 && v.movement !== 'through') {
    const u = -v.d - TURN_START; // how far round the turn
    if (u > 0) {
      const R = turnRadius(v.movement, lx), arc = Q * R, th = Math.min(1, u / arc) * Q, edge = STOP_Y + TURN_START;
      if (v.movement === 'left') { fx = lx + R - R * Math.cos(th); fy = edge + R * Math.sin(th); hl = Q - th; }
      else { fx = lx - R + R * Math.cos(th); fy = edge + R * Math.sin(th); hl = Q + th; }
      const run = Math.max(0, u - arc); // past the end of the turn it carries straight on along the exit road
      fx += Math.cos(hl) * run; fy += Math.sin(hl) * run;
    }
  }
  if (v.exitVia && v.movement === 'through' && v.d < 0) { // on the way out, a left turn into a side street
    const y0 = v.exitVia * STEP - 2 - TURN_R, u = fy - y0;
    if (u > 0) {
      const th = Math.min(1, u / (Q * TURN_R)) * Q;
      fx = lx + TURN_R - TURN_R * Math.cos(th); fy = y0 + TURN_R * Math.sin(th); hl = Q - th;
      const run = Math.max(0, u - Q * TURN_R); fx += Math.cos(hl) * run; fy += Math.sin(hl) * run;
    }
  }
  const overhang = (v.length - WHEELBASE[v.cls]) / 2; // the path is the bumper's, the axle is behind it
  const [x, z] = rotate(k, fx - Math.cos(hl) * overhang, fy - Math.sin(hl) * overhang);
  return { x, z, h: hl + k * Q };
}

// The front axle has moved to p. The rear axle stays a wheelbase behind it, on the line from where it was.
// straight: the vehicle is moving sideways while crawling or standing, as in a queue where one car goes round a stopped left turner. A car
// cannot really do that, but swinging the tail around the rear axle leaves it skewed across two lanes for as long as it stands there. So it
// stays straight and slides across.
export function trail(c, p, wb, straight = false) {
  if (straight) return { fx: p.x, fz: p.z, rx: p.x - Math.cos(p.h) * wb, rz: p.z - Math.sin(p.h) * wb, h: p.h };
  const dx = p.x - c.rx, dz = p.z - c.rz, d = Math.hypot(dx, dz) || 1;
  return { fx: p.x, fz: p.z, rx: p.x - dx / d * wb, rz: p.z - dz / d * wb, h: p.h };
}

// A pedestrian lives on one line, the line of the crossing, which runs along the footpaths on both sides of it.
// They walk in, wait at the kerb, cross and walk out. Companions (a dog, a child, a pram) are in line with them.
// They wait 4.4 m back from the road edge, on the footpath of the street that crosses, beyond the rounded corner and clear of the
// walking lanes of the other crossing at that corner. Waiting closer would put the two crossings' queues on each other's path.
export const KERB_GAP = 4.4;
export function pedestrianPose(p) {
  const stand = HALF_ROAD + KERB_GAP;
  let along;
  if (p.state === 'approaching') along = -p.dir * (stand + p.toKerb);
  else if (p.state === 'waiting') along = -p.dir * (stand + p.toKerb);
  else if (p.state === 'crossing') along = -p.dir * stand + p.dir * Math.min(p.progress, 2 * stand);
  else along = p.dir * (stand + p.away);
  const lane = pedestrianLane(p.id);
  return walkingPose(p, along, lane);
}
export const WALK_CENTRE = -11.9; // the middle of the walking band, 2.3 m from the road edge, between the street trees (10.5 m out) and the lamps (13.05 m out)
export const WALK_LANE_SPACING = 0.46; // wider than a pedestrian, so a neighbour never blocks
export const walkAcross = (dir, lane) => WALK_CENTRE - dir * (0.25 + lane * WALK_LANE_SPACING); // keep left, so the two directions pass each other
function walkingPose(p, along, lane) {
  const across = walkAcross(p.dir, lane) + (p.sidestep || 0); // a pedestrian who turned round eases from the lane they were in into the new one
  const [x, z] = rotate(p.crossing - 1, along, across);
  return { x, z, h: (p.dir > 0 ? 0 : Math.PI) + (p.crossing - 1) * Q };
}

// An oriented rectangle on the ground, for overlap checks.
export function box(cx, cz, h, length, width, ahead = length / 2) {
  const c = Math.cos(h), s = Math.sin(h), mid = ahead - length / 2; // mid: how far the centre of the rectangle is ahead of cx, cz
  return { x: cx + c * mid, z: cz + s * mid, c, s, hl: length / 2, hw: width / 2 };
}
// How far two rectangles overlap, in metres, as a signed number: positive is how deep they are into each other and negative is
// the gap between them, measured along the axis where they are furthest apart (a lower bound of the true distance).
export function overlap(a, b) {
  let least = Infinity;
  for (const axis of [[a.c, a.s], [-a.s, a.c], [b.c, b.s], [-b.s, b.c]]) {
    const dist = Math.abs((b.x - a.x) * axis[0] + (b.z - a.z) * axis[1]);
    const ra = a.hl * Math.abs(a.c * axis[0] + a.s * axis[1]) + a.hw * Math.abs(-a.s * axis[0] + a.c * axis[1]);
    const rb = b.hl * Math.abs(b.c * axis[0] + b.s * axis[1]) + b.hw * Math.abs(-b.s * axis[0] + b.c * axis[1]);
    least = Math.min(least, ra + rb - dist); // the most negative value is the widest gap
  }
  return least;
}

// Which indicator a vehicle has on, if any: 'left', 'right' or null. It signals before a lane change and for the whole of a turn.
export function indicatorOf(v, time) {
  if (v.pendingTo !== null) return v.pendingTo === KERB ? 'left' : 'right';
  if (time < v.signalUntil) return v.signalSide;
  if ((v.movement === 'left' || v.movement === 'right') && v.d < 45 && v.d > -turnLength(v.movement, v.lx)) return v.movement;
  if (v.via) { const join = joinDistance(v.via); if (v.d > join && v.d < join + Q * TURN_R + 25) return 'left'; }
  if (v.exitVia) { const u = exitTurnProgress(v); if (u > -25 && u < Q * TURN_R) return 'left'; }
  return null;
}

// What the page needs each frame: every vehicle's front and rear axle now and one step ago, so it can draw them between.
export class Tracks {
  constructor(sim) {
    this.sim = sim;
    this.vehicles = new Map(); // id -> { id, cls, length, width, prev, curr, v, braking, vehicle, mesh }
    this.removed = []; // entries that have left the simulation, for the page to take off the screen
  }

  // Call after every simulation step.
  capture() {
    const seen = new Set();
    for (const v of this.sim.vehicleList) {
      seen.add(v.id);
      let s = this.vehicles.get(v.id);
      if (!s) {
        s = { id: v.id, cls: v.cls, length: v.length, width: v.width, prev: v.pose, curr: v.pose, v: v.v, braking: false, vehicle: v, mesh: null };
        this.vehicles.set(v.id, s);
      } else {
        s.prev = s.curr; s.curr = v.pose;
      }
      s.braking = v.v < s.v - 0.02 || (v.v < 0.5 && v.d > 0);
      s.v = v.v; s.vehicle = v;
    }
    for (const [id, s] of this.vehicles) {
      if (seen.has(id)) continue;
      this.vehicles.delete(id);
      this.removed.push(s);
    }
  }

  // Everything on the ground right now as rectangles, for overlap checks: { kind, id, what, ...box }.
  footprints() {
    const list = [];
    for (const v of this.sim.vehicleList) {
      const c = v.pose;
      list.push({ kind: 'vehicle', id: v.id, what: v, ...box((c.fx + c.rx) / 2, (c.fz + c.rz) / 2, Math.atan2(c.fz - c.rz, c.fx - c.rx), v.length, v.width) });
    }
    for (const p of this.sim.pedestrians) {
      const pose = pedestrianPose(p), e = pedestrianExtent(p.id);
      list.push({ kind: 'pedestrian', id: p.id, what: p, ...box(pose.x, pose.z, pose.h, e.ahead + e.behind, e.width, e.ahead) });
    }
    return list;
  }
}
