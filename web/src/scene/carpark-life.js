// The comings and goings of a car park: how full it should be at each hour, cars arriving from the far end of the side street and going into a bay, the people who walk to the door, and the same in reverse. This file has
// no Three.js in it, so it runs under node and is tested there (web/test/carpark_life.test.js). The page gives it ways to make and place cars and people, and what the simulated traffic on the street is doing.
//
// Rules, like the page's own pedestrians and vehicles:
//   - One thing at a time in the car park: a car going in or out, and the person who walks between it and the door, have the car park until they are done. Others wait (a car waits in the far lane).
//   - A car crosses the near lane of the street, where the simulated traffic goes, only when no simulated vehicle is near enough to reach it, and a car going out waits at the end of the aisle for the same.
//   - A person walks between the parked cars only along the gap between two, and no car moves while anyone is in the bays.
//   - Nobody blinks out of sight: a car comes in from the far end of the street (out of sight, in the haze) and goes out the same way; a person comes out of the car's door or the building's door and goes into the
//     other, fading over a third of a second at the door.
//   - How full the car park is follows the hour and the day (officeTarget, restaurantTarget): an office fills from 7 to 9:30 on a weekday and empties from 16:30 to 19:00, with one or two cars at night; a restaurant
//     fills at lunch and in the evening.
import { CAR, LOT, arrivalPath, bays, depth, departurePath, halfWidth, speedProfile } from './carpark-layout.js';

export const FAR = 640; // metres up the street from the aisle that a car comes in from
const WALK_SPEED = 1.35, SUB_STEP = 0.05, FADE = 0.35, ACCEL = 2.2, DECEL = 3;
export const front = () => depth() + 2.2; // t of the face of the building
const walkT = () => front() - 1.4; // the walkway along it

// How full a car park should be, as a share of its bays, at an hour of the day (0 to 24).
const ramp = (h, h0, h1, v0, v1) => v0 + (v1 - v0) * Math.min(1, Math.max(0, (h - h0) / (h1 - h0)));
export function officeTarget(hour, weekend) {
  if (weekend) return hour >= 9 && hour < 17 ? 0.2 : 0.1;
  if (hour < 6.5) return 0.1;
  if (hour < 7) return ramp(hour, 6.5, 7, 0.1, 0.15);
  if (hour < 9.5) return ramp(hour, 7, 9.5, 0.15, 1);
  if (hour < 12) return 1;
  if (hour < 13) return 0.85; // lunch
  if (hour < 16.5) return 1;
  if (hour < 19) return ramp(hour, 16.5, 19, 1, 0.1);
  return 0.1;
}
export function restaurantTarget(hour, weekend) {
  const bump = weekend ? 0.1 : 0;
  let v;
  if (hour < 5.5) v = 0.05; else if (hour < 7) v = 0.1; else if (hour < 10) v = 0.3; else if (hour < 11.5) v = 0.45; else if (hour < 14) v = 0.95;
  else if (hour < 17) v = 0.5; else if (hour < 18) v = 0.7; else if (hour < 20.5) v = 1; else if (hour < 22) v = 0.6; else v = 0.25;
  return Math.min(1, v + bump);
}

// adapter: { makeCar(id), makeWalker(id), addCar(obj), removeCar(obj), addWalker(obj), removeWalker(obj),
//            poseCar(obj, { a, t, heading, reverse, signal: 'left' | 'right' | null, braking, moving }), poseWalker(obj, { a, t, heading, moving, fade }) }
export function createCarPark({ kind, rnd = Math.random, adapter, hour = 12, weekend = false }) {
  const target = kind === 'office' ? officeTarget : restaurantTarget;
  const list = bays().map((b) => ({ ...b, state: 'free', car: null, stayUntil: 0, parkedAt: -1e9, wait: 0, owner: null })); // state: free, arriving, parked (the owner is inside), leaving
  let busy = null, now = 0, lastSpawn = -1e9, lastLeave = -1e9, ids = 1, hourNow = hour, weekendNow = weekend, incoming = null;
  const stats = { arrived: 0, left: 0, maxParked: 0 };
  const cars = new Set(), walkers = new Set(), outgoing = []; // everything the page has to move

  const parked = () => list.filter((b) => b.state === 'parked').length;
  const wanted = () => Math.round(target(hourNow, weekendNow) * list.length);
  const stayFor = () => (kind === 'office' ? (wanted() >= 5 ? Infinity : 600 + rnd() * 1800) : 180 + rnd() * 420);
  const colourId = () => 1 + Math.floor(rnd() * 1e6);

  // ----- people -----
  // A route in the car park: from the side of a parked car, along the gap between it and the next, out to the footpath, along the front of the building and to the door.
  function routeFor(bay, gapSide) {
    const s = bay.side, tg = bay.t + gapSide * LOT.bayW / 2, out = s * (halfWidth() + LOT.sidewalk * 0.6);
    return [{ a: bay.a, t: bay.t + gapSide * (CAR.width / 2 + 0.15) }, { a: bay.a, t: tg }, { a: out, t: tg }, { a: out, t: walkT() }, { a: 0, t: walkT() }, { a: 0, t: front() - 0.15 }];
  }
  const gapSideOf = (bay) => (bay.index === 0 ? 1 : bay.index === LOT.perSide - 1 ? -1 : rnd() < 0.5 ? 1 : -1); // never the side of the end where there is no neighbour to squeeze past: the free side is fine either way
  function showWalker(w) { adapter.poseWalker(w.obj, { a: w.a, t: w.t, heading: w.heading, moving: w.moving, fade: Math.min(1, w.fade / FADE) * (w.fadeOut === null ? 1 : Math.max(0, w.fadeOut / FADE)) }); }
  function startWalker(bay, route, then) {
    const w = { obj: adapter.makeWalker(ids++), route, at: 0, a: route[0].a, t: route[0].t, heading: 0, fade: 0, fadeOut: null, then, bay, moving: true };
    w.heading = Math.atan2(route[1].t - w.t, route[1].a - w.a);
    adapter.addWalker(w.obj); walkers.add(w); showWalker(w);
  }
  function stepWalker(w, dt) {
    w.fade += dt;
    if (w.fadeOut !== null) { w.fadeOut -= dt; w.moving = false; showWalker(w); if (w.fadeOut <= 0) { adapter.removeWalker(w.obj); walkers.delete(w); w.then(); } return; }
    if (w.at >= w.route.length - 1) { w.fadeOut = FADE; return; }
    const to = w.route[w.at + 1], dx = to.a - w.a, dz = to.t - w.t, d = Math.hypot(dx, dz), step = WALK_SPEED * dt;
    let turn = Math.atan2(dz, dx) - w.heading; turn -= Math.round(turn / (2 * Math.PI)) * 2 * Math.PI; w.heading += Math.max(-dt * 8, Math.min(dt * 8, turn));
    if (d <= step) { w.a = to.a; w.t = to.t; w.at += 1; } else { w.a += dx / d * step; w.t += dz / d * step; }
    w.moving = true; showWalker(w);
  }

  // ----- cars -----
  const placeCar = (car, pose, extra = {}) => adapter.poseCar(car.obj, { a: pose.a, t: pose.t, heading: pose.heading, reverse: Boolean(pose.reverse), signal: null, braking: false, moving: false, ...extra });
  // The simulated traffic on this street, near the car park: what a car must keep clear of. `ctx.street` is a list of { a, v } for the simulated vehicles in the near lane, `a` as along the aisle's centre line.
  const nearLaneClear = (aAt, street) => !street.some((o) => o.a > aAt - 80 && o.a < aAt + 20); // 80 m is more than a vehicle at 16.7 m/s covers in the 4 s that crossing takes
  const outgoingOnStreet = (aAt) => outgoing.some((o) => o.phase === 'street' && o.car.a > aAt - 30 && o.car.a < aAt + 15);

  function spawnArrival() {
    const free = list.filter((b) => b.state === 'free');
    if (!free.length) return;
    const bay = free[Math.floor(rnd() * free.length)], path = arrivalPath(bay, FAR), car = { obj: adapter.makeCar(colourId()), a: FAR, t: LOT.laneFar };
    bay.state = 'arriving'; adapter.addCar(car.obj); cars.add(car);
    incoming = { car, bay, path, speed: speedProfile(path, { v0: 14, vEnd: 0 }), s: 0, v: 14, phase: 'street', hold: path.segments[1].from - 1.2 }; // it stops at `hold`, in the far lane, until it may turn in
    placeCar(car, path.at(0)); lastSpawn = now;
  }

  function stepIncoming(dt, ctx) {
    const c = incoming, { path } = c;
    if (c.phase === 'street' && c.s > c.hold - 12) { // may it turn in? Only when the car park is free and the near lane is clear of what could reach the crossing: asked again at every step, until it has passed the point 12 m before the hold, where it can no longer stop in time
      const crossA = path.at(c.hold + 1.2).a;
      if (busy === null && nearLaneClear(crossA, ctx.street) && !outgoingOnStreet(crossA)) { c.phase = 'go'; busy = { kind: 'arrive', bay: c.bay }; }
    }
    let vmax = c.speed(c.s);
    if (c.phase === 'street') vmax = Math.min(vmax, Math.sqrt(2 * DECEL * Math.max(0, c.hold - c.s)));
    c.v = Math.max(0, c.v + Math.max(-DECEL * dt, Math.min(ACCEL * dt, vmax - c.v)));
    c.s += c.v * dt;
    if (c.phase === 'street' && c.s >= c.hold) { c.s = c.hold; c.v = 0; }
    const p = path.at(c.s); c.car.a = p.a; c.car.t = p.t;
    placeCar(c.car, p, { signal: p.tag === 'cross' ? 'right' : null, braking: c.v < vmax - 0.3, moving: true });
    if (c.s >= path.length - 0.03) { // in the bay
      cars.delete(c.car); incoming = null; stats.arrived += 1;
      const bay = c.bay; bay.car = c.car; placeCar(c.car, { a: bay.a, t: bay.t, heading: bay.heading });
      bay.wait = 1; bay.owner = 'getting out'; // the person gets out after a moment and walks to the door
    }
  }

  function startLeave(bay) { // the owner comes out of the door, walks to the car and gets in
    busy = { kind: 'leave', bay }; bay.state = 'leaving'; lastLeave = now;
    startWalker(bay, routeFor(bay, gapSideOf(bay)).reverse(), () => { bay.wait = 1; bay.owner = 'sitting'; });
  }
  function driveOut(bay) {
    const path = departurePath(bay, 700), car = bay.car; bay.car = null; bay.owner = null;
    const o = { car: { obj: car.obj, a: bay.a, t: bay.t }, bay, path, speed: speedProfile(path, { v0: 1, vEnd: 17, limits: { street: 17 } }), s: 0, v: 0, phase: 'lot', hold: path.segments[3].from }; // the exit arc starts at the end of the aisle
    cars.add(o.car); outgoing.push(o); placeCar(o.car, path.at(0));
  }
  function stepOutgoing(o, dt, ctx) {
    const { path } = o;
    let vmax = o.speed(o.s);
    if (o.phase === 'lot') { // goes along the aisle, and waits at the end of it if the street is not clear
      const mergeA = path.at(Math.min(path.length, o.hold + 6)).a;
      if (!nearLaneClear(mergeA, ctx.street) && o.s < o.hold) vmax = Math.min(vmax, Math.sqrt(2 * DECEL * Math.max(0, o.hold - 0.3 - o.s)));
    } else { // on the street: no faster than a simulated vehicle ahead
      const lead = ctx.street.filter((q) => q.a > o.car.a + 4).sort((p, q) => p.a - q.a)[0];
      if (lead && lead.a - o.car.a < 60) vmax = Math.min(vmax, Math.max(0, lead.v));
    }
    o.v = Math.max(0, o.v + Math.max(-DECEL * dt, Math.min(ACCEL * dt, vmax - o.v)));
    o.s = Math.min(path.length, o.s + o.v * dt);
    const p = path.at(o.s); o.car.a = p.a; o.car.t = p.t;
    if (o.phase === 'lot' && p.tag === 'street') { o.phase = 'street'; busy = null; stats.left += 1; o.bay.state = 'free'; } // out of the car park: it is free again
    placeCar(o.car, p, { signal: p.tag === 'cross' ? 'left' : null, braking: o.v < vmax - 0.3, moving: true });
    if (o.s >= path.length - 0.05) { adapter.removeCar(o.car.obj); cars.delete(o.car); outgoing.splice(outgoing.indexOf(o), 1); }
  }

  // what happens when a bay's timer runs out: the owner of an arrived car steps out; the owner of a leaving car is in and the car goes
  function afterWait(bay) {
    if (bay.owner === 'getting out') { bay.owner = 'walking'; startWalker(bay, routeFor(bay, gapSideOf(bay)), () => { bay.state = 'parked'; bay.owner = 'inside'; bay.parkedAt = now; bay.stayUntil = now + stayFor(); busy = null; }); }
    else if (bay.owner === 'sitting') driveOut(bay);
  }

  // ----- the day -----
  for (let i = 0, n = Math.min(list.length, Math.round(wanted() * (0.8 + rnd() * 0.2))), order = list.slice().sort(() => rnd() - 0.5); i < n; i += 1) { // the cars already there when the page opens
    const b = order[i], car = { obj: adapter.makeCar(colourId()), a: b.a, t: b.t };
    adapter.addCar(car.obj); b.car = car; b.state = 'parked'; b.owner = 'inside'; placeCar(car, { a: b.a, t: b.t, heading: b.heading });
    b.stayUntil = kind === 'office' && wanted() >= 5 ? Infinity : rnd() * (kind === 'office' ? 1800 : 400);
  }
  stats.maxParked = parked();

  function planDay(ctx) {
    const want = wanted(), have = parked() + (incoming ? 1 : 0), gap = kind === 'office' ? 40 + rnd() * 20 : 25 + rnd() * 20;
    if (!incoming && have < want && now - lastSpawn > gap && list.some((b) => b.state === 'free')) spawnArrival(); // fuller when it should be: one car at a time, a little apart
    const arrivalWaiting = incoming && incoming.phase === 'street' && incoming.s > incoming.hold - 30; // a car that is here has its turn before the next one leaves
    if (!busy && !arrivalWaiting && now - lastLeave > 10 && nearLaneClear(0, ctx.street)) { // emptier when it should be, or a car has stayed its time
      const over = parked() > want + (kind === 'office' ? 0.5 : 1);
      const pick = list.filter((b) => b.state === 'parked' && now - b.parkedAt > 60 && (over || (b.stayUntil <= now && (kind !== 'restaurant' || parked() > Math.max(1, want - 2)))));
      if (pick.length) startLeave(pick[Math.floor(rnd() * pick.length)]);
    }
  }

  return {
    stats, bays: list, get busy() { return busy; }, get parked() { return parked(); }, get cars() { return cars; }, get walkers() { return walkers; },
    get incoming() { return incoming; }, get outgoing() { return outgoing; }, get wanted() { return wanted(); },
    // Advances the car park by dt seconds. ctx = { hour, weekend, street: [{ a, v }] }.
    update(dtRaw, ctx) {
      hourNow = ctx.hour; weekendNow = ctx.weekend;
      let left = Math.min(dtRaw, 2);
      while (left > 1e-9) {
        const dt = Math.min(SUB_STEP, left); left -= dt; now += dt;
        for (const w of [...walkers]) stepWalker(w, dt);
        if (incoming) stepIncoming(dt, ctx);
        for (const o of [...outgoing]) stepOutgoing(o, dt, ctx);
        for (const b of list) if (b.wait > 0) { b.wait -= dt; if (b.wait <= 0) afterWait(b); }
        planDay(ctx);
        if (parked() > stats.maxParked) stats.maxParked = parked();
      }
    },
  };
}
