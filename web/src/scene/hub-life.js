// The people of a share hub (see hub.js): someone comes out of the shop next to it, walks to a vehicle, unlocks it and rides off along the kerb side of the footpath, and now and then someone rides in, leaves
// a vehicle in a free place and walks off. This file has no Three.js in it, so it runs under node and is tested there (web/test/hub_life.test.js). The page hands it what it has: a way to turn the hub's
// own frame into the world, the people's builders, the pedestrians of the simulation, and how busy the day is.
//
// The hub's frame: u runs along the hub (0 to width), v across it (0 at the side next to the road, negative toward the road). A route is a list of [u, v] points, and [u, v, true] marks a gate: wait there
// until the way is clear before going on.
//
// Rules, like the page's own pedestrians and vehicles:
//   - Events are random and follow the time of day: a Poisson process whose rate is a peak rate times `demand()`, the same day pattern the pedestrians follow (src/sim/daily.js).
//   - Only a few people at a time, never two on the same vehicle (a slot is reserved from the moment someone sets out for it until they have taken it or left it), only one ride at a time in either
//     direction (so nobody meets anybody head on on the kerb side), and only one person at a time among the bays, where the ways between the vehicles are one person wide.
//   - Nobody walks through anybody: a person who has another in front of them, within 1.4 m, waits (a person coming the other way gives way to the one with the lower number). A wait of over 6 s is given up,
//     so two people can never hold each other for ever.
//   - The kerb side of the footpath is crossed to the hub only where no pedestrian of the simulation is on the way: none within 1 m of the line, and none walking within 3 m of it.
//   - Everyone is visible all through: a person who takes a vehicle becomes a rider at the same place in the same frame, and the other way round. Only the first appearance at the shop or the far end,
//     and the last at either, fade over half a second.

export const BAND_V = -4.2; // the kerb side: the hub stands 1 m back from the 3.6 m footpath, and the middle of the kerb side is 0.35 m from the road's edge
export const LANES_V = [-3.1, -1.5]; // v of the pedestrians' lanes at the hub's edge
export const AISLE_IN = .35, AISLE_OUT = -.35; // the strip between the footpath and the parking zone, where people walk inside the hub: one lane in, one lane out, so nobody meets anybody head on
export const AISLE_V = AISLE_IN;
// The footpath is a slab 0.16 m high, from v = -4.6 to -1; a person goes up or down to it over a dropped kerb between v = -0.6 and -1.4, and the ground of the hub is level. Without this, riders on the
// footpath were drawn 0.16 m into it.
export const SLAB_TOP = .16;
export const groundHeight = (v) => (v >= -.6 ? 0 : v <= -1.4 ? SLAB_TOP : SLAB_TOP * (-.6 - v) / .8);
export const WALK_SPEED = 1.35, SCOOTER_SPEED = 3.8, BIKE_SPEED = 4.6; // m/s
export const PEAK_RATE = 1 / 45; // events a second at the busiest time of day, for one hub
export const MIN_GAP = 8; // seconds between events
export const MAX_ACTORS = 3;
const ZONE_V = .6; // v from which the bays begin
export const FOLLOW_GAP = 1.4, STALL = 6; // metres kept to the person in front, and seconds after which a wait is given up
const PATIENCE = 20; // seconds a rider coming in waits at the kerb side for the way across, before riding on

export function createHubLife(hub, { scene, to, builders, pedestrians, demand = () => 1, rnd = Math.random }) {
  const actors = [], reach = hub.width + 45, door = hub.width + 1.3; // riders come from and go to a point 45 m along the footpath, and walkers come out of and go into the shop next to the hub
  let ids = 5000 + Math.floor(rnd() * 900), clock = 0, next = gap(), seq = 0;
  const stats = { events: 0, skipped: 0, gaveUp: 0 };
  function gap() { return MIN_GAP - Math.log(1 - rnd()) / (PEAK_RATE * Math.max(.03, demand())); }

  // Is the way across the pedestrians' lanes at u clear of the simulation's pedestrians?
  function clear(u) {
    const points = [BAND_V, LANES_V[0] - .4, (LANES_V[0] + LANES_V[1]) / 2, LANES_V[1] + .4, 0].map((v) => to(u, v));
    return !pedestrians().some((ped) => points.some((p) => {
      const d = Math.hypot(ped.px - p.x, ped.pz - p.z);
      return d < 1 || (d < 3 && (ped.state === 'approaching' || ped.state === 'leaving'));
    }));
  }
  const bearing = (a, b) => { const p = to(a[0], a[1]), q = to(b[0], b[1]); return Math.atan2(q.z - p.z, q.x - p.x); };
  const slots = () => [...hub.scooterSlots, ...hub.bikeSlots];
  const speedOf = (slot) => (slot.kind === 'bike' ? BIKE_SPEED : SCOOTER_SPEED);
  const standing = (slot) => [slot.u + slot.nudge + .55, slot.v]; // beside the vehicle, where a person stands to take it or has just left it
  const onVehicle = (slot) => [slot.u + slot.nudge, slot.v];

  // `seen`: the person fades in over half a second (at the shop or the far end), not when they take over from someone else.
  function spawn(kind, route, speed, arrive, { facing = null, seen = true, rental = false } = {}) {
    const mesh = kind === 'walk' ? builders.walker(ids++) : kind === 'bike' ? builders.rider(ids++) : builders.scooterRider(ids++);
    scene.add(mesh);
    const a = { id: seq += 1, kind, mesh, route, at: 0, u: route[0][0], v: route[0][1], speed, arrive, age: seen ? 0 : 1, rental, out: null, pause: 0, then: null, gated: -1, blocked: 0, gateWait: 0, patient: false, moving: false,
      h: facing === null ? bearing(route[0], route[1]) : bearing([0, 0], [Math.sin(facing), Math.cos(facing)]) };
    show(a, 0); actors.push(a); return a;
  }
  function show(a, time) {
    const p = to(a.u, a.v); a.mesh.position.set(p.x, groundHeight(a.v), p.z); a.mesh.rotation.y = -a.h;
    a.mesh.scale.setScalar(Math.max(.001, Math.min(1, a.age / .5) * (a.out === null ? 1 : Math.max(0, a.out) / .5))); // into and out of sight over half a second
    if (a.kind === 'walk') builders.animateWalker(a.mesh, time, a.moving ? 1 : 0);
    else if (a.kind === 'bike') builders.animateRider(a.mesh, time, a.moving ? 1.5 : 0);
    else builders.animateScooter(a.mesh, time, a.moving ? 1 : 0);
  }
  function remove(a) { scene.remove(a.mesh); a.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); actors.splice(actors.indexOf(a), 1); } // each person has a geometry of their own

  // Someone walks in from the shop, goes to a vehicle, unlocks it, steps onto it and rides off the way they came.
  const riding = () => actors.some((a) => a.kind !== 'walk' || a.rental); // a ride is under way: a rider, or a person on their way to a vehicle
  function rent() {
    const options = slots().filter((s) => s.taken && !s.reserved);
    if (!options.length || riding()) return false;
    const slot = options[Math.floor(rnd() * options.length)], [su, sv] = standing(slot);
    slot.reserved = true;
    spawn('walk', [[door, AISLE_IN], [su, AISLE_IN, 'zone'], [su, sv], onVehicle(slot)], WALK_SPEED, (a) => {
      a.pause = 1.2 + rnd(); // a moment to unlock it
      a.then = () => {
        slot.taken = false; hub.place(slot, slot.mesh, slot.index); remove(a);
        const rider = spawn(slot.kind === 'bike' ? 'bike' : 'scooter', [onVehicle(slot), [slot.u + slot.nudge, AISLE_OUT, true], [slot.u + slot.nudge, BAND_V], [reach, BAND_V]], speedOf(slot), null, { facing: slot.yaw, seen: false });
        rider.hold = { slot, until: 1 }; // the place is let go when the rider has left it
      };
    }, { rental: true });
    return true;
  }
  // Someone rides in from the far end, stops at a free place, leaves the vehicle there and walks off into the shop.
  function giveBack() {
    const options = slots().filter((s) => !s.taken && !s.reserved);
    if (!options.length || riding()) return false;
    const slot = options[Math.floor(rnd() * options.length)], [su, sv] = standing(slot);
    slot.reserved = true;
    const a = spawn(slot.kind === 'bike' ? 'bike' : 'scooter', [[reach, BAND_V], [slot.u + slot.nudge, BAND_V, true], [slot.u + slot.nudge, AISLE_OUT, 'zone'], onVehicle(slot)], speedOf(slot), (rider) => {
      rider.pause = .7 + rnd() * .5;
      rider.then = () => {
        slot.taken = true; slot.yaw = (rnd() - .5) * .5; hub.place(slot, slot.mesh, slot.index); remove(rider); // left the way it came in, facing along v
        const walker = spawn('walk', [onVehicle(slot), [su, sv], [su, AISLE_OUT], [door, AISLE_OUT]], WALK_SPEED, null, { seen: false });
        walker.hold = { slot, until: 1 }; // the place is let go when they have stepped away from it
      };
    });
    a.slot = slot; // a rider who has to give up waiting at the gate lets the place go (see update)
    return true;
  }

  const zoneFree = (a) => !actors.some((o) => o !== a && o.out === null && o.v > ZONE_V - 1e-6); // nobody else is among the bays
  // The nearest person with a claim to the way in front of this one, as { d }, or null. A person in front goes first. Two facing each other: the one with the lower number goes first.
  function inFront(a) {
    const ax = Math.cos(a.h), az = Math.sin(a.h), pa = to(a.u, a.v);
    let best = null;
    for (const o of actors) {
      if (o === a || o.out !== null) continue;
      const po = to(o.u, o.v), dx = po.x - pa.x, dz = po.z - pa.z, d = Math.hypot(dx, dz);
      if (d > FOLLOW_GAP || (dx * ax + dz * az) <= 0) continue; // o is not in the way
      const facingMe = (-dx * Math.cos(o.h) + -dz * Math.sin(o.h)) > 0 && (Math.cos(o.h) * ax + Math.sin(o.h) * az) < 0; // o is coming toward a
      if (facingMe && a.id < o.id) continue; // head on: this one has the way
      if (!best || d < best.d) best = { d };
    }
    return best;
  }

  return {
    stats,
    get busy() { return actors.length; },
    get kinds() { return actors.map((a) => a.kind); },
    get debug() { return actors.map((a) => ({ id: a.id, kind: a.kind, at: a.at, u: +a.u.toFixed(2), v: +a.v.toFixed(2), pause: +a.pause.toFixed(1), blocked: +a.blocked.toFixed(1), hold: Boolean(a.hold), route: a.route.map((p) => p.slice(0, 2).map((x) => +x.toFixed(1)).join(',')).join(' > ') })); },
    update(time, dtRaw) {
      const dt = Math.min(.1, dtRaw); // a stop of the page must not make everyone jump
      clock += dt;
      if (clock >= next) {
        next = clock + gap();
        if (actors.length < MAX_ACTORS) {
          const taken = slots().filter((s) => s.taken && !s.reserved).length, open = slots().filter((s) => !s.taken && !s.reserved).length;
          const tryRent = rnd() < .5 + .4 * (taken - open) / Math.max(1, taken + open); // a person taking one more often than someone leaving one, while there are some to take
          if (!(tryRent ? (rent() || giveBack()) : (giveBack() || rent()))) stats.skipped += 1; else stats.events += 1;
        } else stats.skipped += 1;
      }
      for (const a of [...actors]) {
        a.moving = false; a.age += dt;
        if (a.hold && a.at >= a.hold.until) { a.hold.slot.reserved = false; a.hold = null; }
        if (a.pause > 0) { a.pause -= dt; if (a.pause <= 0) a.then(); else show(a, time); continue; }
        let budget = a.speed * dt;
        if (!a.route[a.at + 1]) { // at the end of the route
          if (a.arrive) { const f = a.arrive; a.arrive = null; f(a); } else { a.out = (a.out === null ? .5 : a.out) - dt; if (a.out <= 0) remove(a); else show(a, time); }
          continue;
        }
        const gate = a.route[a.at][2];
        if (gate && a.gated !== a.at) { // at a gate: the way must be clear (true: the lanes of the pedestrians; 'zone': no one else among the bays)
          if (gate === 'zone' ? zoneFree(a) : clear(a.u)) { a.gated = a.at; a.gateWait = 0; }
          else {
            a.gateWait += dt;
            if (gate === true && a.slot && a.gateWait > PATIENCE && a.kind !== 'walk') { // a rider coming in who has waited long enough rides on: the place is let go and the ride ends at the far end
              a.slot.reserved = false; a.slot = null; stats.gaveUp += 1; a.route = [[a.u, a.v], [reach, BAND_V]]; a.at = 0; a.arrive = null; a.gated = -1;
            } else { show(a, time); continue; }
          }
        }
        const ahead = inFront(a); // the person in front: stay 1 m behind a slower one, wait for one that has the way
        if (ahead) { budget = Math.min(budget, Math.max(0, ahead.d - .9)); if (budget < 1e-6) { a.blocked += dt; if (a.blocked < STALL) { show(a, time); continue; } budget = a.speed * dt; } else a.blocked = 0; } else a.blocked = 0;
        while (budget > 1e-9 && a.route[a.at + 1]) { // move along the route, round corners within the step
          const target = a.route[a.at + 1], dx = target[0] - a.u, dv = target[1] - a.v, d = Math.hypot(dx, dv);
          let turn = bearing([a.u, a.v], target) - a.h; turn -= Math.round(turn / (2 * Math.PI)) * 2 * Math.PI;
          a.h += Math.max(-dt * 6, Math.min(dt * 6, turn)); // they turn toward the next point and not at once
          if (d <= budget) { a.u = target[0]; a.v = target[1]; a.at += 1; budget -= d; a.moving = true; if (a.route[a.at][2] && a.gated !== a.at) break; } else { a.u += dx / d * budget; a.v += dv / d * budget; budget = 0; a.moving = true; }
        }
        show(a, time);
      }
    },
    dispose() { for (const a of [...actors]) { if (a.slot) a.slot.reserved = false; if (a.hold) a.hold.slot.reserved = false; remove(a); } },
  };
}
