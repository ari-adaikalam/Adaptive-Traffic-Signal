// The people of a courtyard (see courtyard-layout.js): they come in at the end of a path, walk to a seat on a bench or at the cafe, sit for a while, and walk out again. This file has no Three.js in it, so it
// runs under node and is tested there (web/test/courtyard_life.test.js). The page hands it a way to make and pose a person.
//
// Rules, like the page's other people:
//   - People arrive at random, at a rate that follows the time of day: `demand('bench')` is the park's pattern (nobody on the benches from the late evening to dawn, most at midday and at the weekend) and
//     `demand('cafe')` the footpath's, and the page lowers both in rain. The cafe is open from 7:00 to 21:30 (`hour()`). A seat is reserved from the moment someone sets out for it until they leave it,
//     so nobody sits on anybody. Only the seats there are, so a courtyard fills up and then stops.
//   - When a place closes, or the day's pattern falls to nothing, or it rains, those sitting there get up and go, within the next minute, so the courtyard is empty at night.
//   - Each end of a path is a corridor one person wide (a path is 3 m, and a bench takes the middle of it), so only one person at a time walks in or out of an entrance. Someone who wants to leave waits on
//     the seat until the way is free.
//   - Everyone is visible all through. Only the first appearance at an entrance and the last there fade, over a third of a second.
//   - When the page opens the courtyard is already part full, as it would be on any day, with the people seated.
import { seatsOf } from './courtyard-layout.js';

export const WALK_SPEED = 1.2; // m/s
export const PEAK_RATE = { bench: 1 / 14, cafe: 1 / 18 }; // arrivals a second at the busiest time, for one courtyard's benches and for its cafe
export const CAFE_OPEN = [7, 21.5]; // hours of the day
const GONE = 0.02; // below this share of its busiest time a place counts as empty, and nobody stays
export const FADE = 0.35;
const STAY = { bench: [60, 260], cafe: [150, 480] }; // seconds sitting, from and to

export function createCourtyardLife(yard, { adapter, demand = () => 1, hour = () => 12, rnd = Math.random }) {
  const seats = seatsOf(yard).map((s) => ({ ...s, owner: null })), corridors = { n: null, s: null, w: null, e: null };
  const walkers = new Set(), stats = { arrived: 0, left: 0 };
  let ids = 1, now = 0;
  const next = { bench: gap('bench'), cafe: gap('cafe') };
  const open = (kind) => (kind === 'cafe' ? hour() >= CAFE_OPEN[0] && hour() < CAFE_OPEN[1] : true) && demand(kind) >= GONE;
  const between = ([a, b]) => a + rnd() * (b - a);
  function gap(kind) { return -Math.log(1 - rnd()) / (PEAK_RATE[kind] * Math.max(GONE, demand(kind))); }

  function show(w) {
    const out = w.fadeOut === null ? 1 : Math.max(0, w.fadeOut / FADE);
    adapter.poseWalker(w.obj, { x: w.x, z: w.z, heading: w.heading, moving: w.phase !== 'sit', sitting: w.phase === 'sit', fade: Math.min(1, w.fade / FADE) * out });
  }
  function make(seat, phase) {
    const route = seat.route.map(([x, z]) => ({ x, z })), w = { obj: adapter.makeWalker(ids++), seat, route: phase === 'in' ? route : route.slice().reverse(), at: 0, x: 0, z: 0, heading: 0, fade: 0, fadeOut: null, phase, timer: 0, speed: WALK_SPEED * (0.9 + 0.25 * rnd()) };
    adapter.addWalker(w.obj); walkers.add(w); return w;
  }
  function sitDown(w) { w.phase = 'sit'; w.x = w.seat.x; w.z = w.seat.z; w.heading = w.seat.facing; w.timer = between(STAY[w.seat.kind]); show(w); }
  function start(seat) { // a person arrives at an entrance and heads for the seat
    seat.owner = true; corridors[seat.entrance] = true; stats.arrived += 1;
    const w = make(seat, 'in'); w.x = w.route[0].x; w.z = w.route[0].z; w.heading = Math.atan2(w.route[1].z - w.z, w.route[1].x - w.x); show(w);
  }
  function seatNow(seat) { // a person who was here already
    seat.owner = true; const w = make(seat, 'in'); w.fade = FADE; sitDown(w); w.timer = rnd() * between(STAY[seat.kind]);
  }
  for (const s of seats) if (open(s.kind) && rnd() < Math.min(1, demand(s.kind)) * 0.6) seatNow(s);

  function step(w, dt) {
    w.fade += dt;
    if (w.phase === 'sit') { if (!w.closing && !open(w.seat.kind)) { w.closing = true; w.timer = Math.min(w.timer, rnd() * 50); } w.timer -= dt; if (w.timer <= 0 && !corridors[w.seat.entrance]) { corridors[w.seat.entrance] = true; w.phase = 'out'; w.route = w.seat.route.map(([x, z]) => ({ x, z })).reverse(); w.at = 0; w.x = w.seat.x; w.z = w.seat.z; } show(w); return; }
    if (w.fadeOut !== null) { w.fadeOut -= dt; show(w); if (w.fadeOut <= 0) { adapter.removeWalker(w.obj); walkers.delete(w); corridors[w.seat.entrance] = null; w.seat.owner = null; stats.left += 1; } return; }
    let room = w.speed * dt;
    while (room > 0 && w.at < w.route.length - 1) {
      const a = w.route[w.at + 1], dx = a.x - w.x, dz = a.z - w.z, d = Math.hypot(dx, dz);
      if (d > 1e-9) w.heading = Math.atan2(dz, dx);
      if (d <= room) { w.x = a.x; w.z = a.z; room -= d; w.at += 1; } else { w.x += dx / d * room; w.z += dz / d * room; room = 0; }
    }
    if (w.at >= w.route.length - 1) { if (w.phase === 'in') { corridors[w.seat.entrance] = null; sitDown(w); return; } w.fadeOut = FADE; }
    show(w);
  }
  // The first point of a walk in is where the person appears, which may be a step away from where the last one left: a walker coming in waits for no one, because the corridor is held until they are seated.
  function update(dt) {
    now += dt;
    for (const kind of ['bench', 'cafe']) {
      next[kind] -= dt;
      if (next[kind] > 0) continue;
      next[kind] = gap(kind);
      const free = open(kind) ? seats.filter((s) => s.kind === kind && !s.owner && !corridors[s.entrance]) : [];
      if (free.length) start(free[Math.floor(rnd() * free.length)]);
    }
    for (const w of [...walkers]) step(w, dt);
  }
  return { seats, stats, walkers, update, get seated() { return seats.filter((s) => s.owner).length; }, get time() { return now; } };
}
