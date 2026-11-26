// The traffic simulator. It runs the real controller (../signals.js) against simulated traffic.
//
// What it models: Poisson arrivals with a class mix and turning split, car-following with
// the intelligent driver model, stopping at red and at yellow when a stop is comfortable,
// a camera that counts vehicles in a zone and reports to the controller once a second, a time
// of day that makes the bus lane active, pedestrians who press the button and cross at their own
// speed, emergency vehicles that ask for priority at a geofence, and faults.
//
// What it does not model: passing on the far side of the road or left turns out of the bus lane.
// Nothing moves into a space that something else occupies, so vehicles give way to each other and
// to pedestrians. See docs.

import { makeConfig } from '../config.js';
import { buildPlan, compatible } from '../phases.js';
import { Controller } from '../signals.js';
import { makeCounts } from '../timing.js';
import { EMERGENCY_KINDS, EMERGENCY_MAX, WALKER_SPEED, emergencyRate, mixAt, pedestrianFactor, studentShare, vehicleFactor, vehicleKind, walkerRole, wetMix, wetPeople } from './daily.js';
import { makeRng } from './rng.js';
import { CROSSING_HALF, CROSSING_Y, LANE_X, MOUTH_STOP, STOP_Y, TURN_START, WHEELBASE, box, exitTurnProgress, exitZebraStart, joinerZebraStart, mouthKey, mouthZebras, onMouthZebra, overlap, pedestrianPose, rotate as rotateFrame, trail, turnLength, turnRadius, vehiclePose, walkAcross } from './tracks.js';
import {
  APPROACH_LENGTH, BOX_PATH, CLASSES, CROSSING_PATH_M, DEFAULT_MIX, DEFAULT_TURNS, DETECTION_ZONE, EXIT_RUN, GEOFENCE, LANE_CHANGE, PEDESTRIAN_WALK_M,
  SIDE_STREET_SPACING, exitStreetFor, joinDistance, pedestrianExtent, pedestrianLane, sideStreetFor,
  COUNT_FIELD, KERB, KERB_ONLY, LANE_COUNT, NO_TURN, MIN_SPAWN_GAP, RIGHT, SIM_CONTROLLER_CONFIG, THROUGH, TURN_SPEED, isBus, isEmergency,
} from './world.js';

const CLEARANCE = 0.25; // metres kept between vehicles, and the room a pedestrian is given
const MOUTH_ZEBRAS = mouthZebras();
const NEAR_JUNCTION = 40; // metres from the middle. Pedestrians this close avoid vehicles. Further out the vehicle gives way.
const LONG_TURNER = 6; // metres. A left turner this long waits for pedestrians at the line, not in the turn
const SQUEEZE_AFTER = 6; // seconds stuck before a vehicle may squeeze closer than that, a little at a time
const SIDE_TURN_GIVE_UP = 3; // seconds a vehicle may be held in its turn into a side street before it drops the turn
const SQUEEZE_MAX = 0.6; // and the most it may squeeze, in metres, so a stuck pair always works itself free

// Things on the ground, kept in square cells so that a check only looks at what is close.
class Grid {
  constructor(cell = 16) { this.cell = cell; this.cells = new Map(); }
  key(ix, iz) { return (ix + 256) * 1024 + (iz + 256); }
  add(item, x, z) {
    const k = this.key(Math.floor(x / this.cell), Math.floor(z / this.cell)), list = this.cells.get(k);
    if (list) list.push(item); else this.cells.set(k, [item]);
  }
  near(x, z, out) {
    out.length = 0;
    const ix = Math.floor(x / this.cell), iz = Math.floor(z / this.cell);
    for (let dx = -1; dx <= 1; dx += 1) for (let dz = -1; dz <= 1; dz += 1) {
      const list = this.cells.get(this.key(ix + dx, iz + dz));
      if (list) for (let i = 0; i < list.length; i += 1) out.push(list[i]);
    }
    return out;
  }
}

export const PRESETS = {
  light: { rates: [250, 250, 250, 250], pedRate: 60, clockStartS: 12 * 3600 },
  moderate: { rates: [500, 500, 500, 500], pedRate: 120, clockStartS: 12 * 3600 },
  peak: { rates: [750, 750, 750, 750], pedRate: 180, clockStartS: 12 * 3600 },
  uneven: { rates: [800, 250, 800, 250], pedRate: 120, clockStartS: 12 * 3600 },
  // A day squeezed into an hour, in steps of about 8 minutes: quiet, a rise, the main road heavy, a lull, the side road heavy, then quiet again.
  // The rates are per approach, in vehicles an hour. A single fixed plan has to serve all of it.
  day: { rates: [500, 500, 500, 500], pedRate: 120, clockStartS: 12 * 3600, profile: [
    [0, [250, 250, 250, 250]], [450, [500, 400, 500, 400]], [900, [900, 350, 900, 350]], [1350, [400, 400, 400, 400]],
    [1800, [350, 900, 350, 900]], [2250, [550, 450, 550, 450]], [2700, [300, 300, 300, 300]], [3150, [200, 200, 200, 200]]] },
  // The page's day: demand follows the clock (see daily.js), from Monday 8 am. Pedestrians are not all alike: some never press the button, they come
  // in groups and in busy and quiet spells, and one who waits too long gives up and walks away.
  clock: { rates: [750, 750, 750, 750], pedRate: 180, clockStartS: 8 * 3600, daily: { vehiclePeak: 750, pedPeak: 180, autoEmergencies: true },
    pedBehaviour: { pressShare: 0.7, groupShare: 0.25, quiet: true, patience: [45, 140], turnShare: 0.3 } },
  bus_hours: { rates: [500, 500, 500, 500], pedRate: 120, mix: { car: 0.7, truck: 0.05, bus: 0.12, bike: 0.13 }, clockStartS: 7 * 3600 + 30 * 60 },
};

const PEDESTRIAN_MOOD_MAX = 1.5; // the busiest a spell of pedestrians gets, as a multiple of the usual rate
const RED_RUN_SPEED = 11; // m/s, 40 km/h: the speed of an emergency vehicle that goes through a red or a yellow
const EMERGENCY_SPAWN = 240; // metres from the line where an emergency vehicle comes in on a long road: about 14 s away at its speed, and just outside the 120 m where it asks for priority
const AMBULANCE_LINE = 15; // metres: the last stretch before the line, where an ambulance no longer changes lane. It is the only distance limit: an ambulance dodges from wherever it is blocked, and the traffic around it gives way wherever it is.
const SIGNAL_KEY = (approach, lane) => (lane === RIGHT ? `R${approach}` : `T${approach}`);
const vehicleKey = (v) => (v.lane === RIGHT ? `R${v.approach}` : v.movement === 'left' ? `L${v.approach}` : `T${v.approach}`);
const opposite = (n) => ((n + 1) % 4) + 1;
// Which movements may be in the junction together. The controller's table treats a through-and-left movement as one, so it cannot say
// that a left turn clears an arrow phase. This one is from the swept paths of a bus on each movement, and for left turns only.
const compat = (a, b) => {
  if (a[0] !== 'L' && b[0] !== 'L') return compatible(a, b);
  const [l, o] = a[0] === 'L' ? [a, b] : [b, a], i = Number(l[1]), j = Number(o[1]);
  if (o[0] === 'T') return j === i || j === opposite(i);
  if (o[0] === 'L') return true;
  return j !== opposite(i); // a right turn from the opposite approach exits into the same lane as this left turn
};
const clampValue = (x, low, high) => Math.max(low, Math.min(high, x));

// Where a pedestrian stands after crossing is next to the kerb of another crossing (the one across the other road at that corner). For each crossing and
// direction, the crossing and direction that start there, and how far the walk is, found from the poses themselves so it cannot drift from them.
const CORNER = new Map();
for (let j = 1; j <= 4; j += 1) for (const dir of [1, -1]) {
  const end = pedestrianPose({ id: 2, crossing: j, dir, state: 'leaving', toKerb: 0, progress: 0, away: 0 });
  let best = null;
  for (let j2 = 1; j2 <= 4; j2 += 1) for (const d2 of [1, -1]) {
    if (j2 === j) continue;
    const at = pedestrianPose({ id: 2, crossing: j2, dir: d2, state: 'waiting', toKerb: 0, progress: 0, away: 0 }), gap = Math.hypot(at.x - end.x, at.z - end.z);
    if (!best || gap < best.gap) best = { crossing: j2, dir: d2, gap };
  }
  CORNER.set(`${j}:${dir}`, best);
}

const REFERENCE_FOR = { cars: 'car', trucks: 'truck', buses: 'bus', bikes: 'bike' }; // the ordinary vehicle each count is of
const whole = (counts) => Object.fromEntries(Object.entries(counts).map(([k, n]) => [k, Math.round(n)]));

export class Simulation {
  constructor({ seed = 1, mode = 'adaptive', demand = PRESETS.moderate, config = {}, clockStartS = null, dt = 0.1,
    detectionMiss = 0, detectionCurve = null, countSource = null, lengthCounts = false, powerOn = false, approachLength = APPROACH_LENGTH, exitRun = EXIT_RUN, pedestrianWalk = PEDESTRIAN_WALK_M, detectionZone = DETECTION_ZONE, leftWaitsForWalk = false, emergencyPriority = true } = {}) {
    this.detectionZone = detectionZone;
    // A left turner holds at the stop line while the green man shows for the crossing it will turn across, and moves up (to wait short of the crossing if people are still on it) once the flashing red man starts, which is
    // when the left arrow the page shows turns green. Without it, a left turner pulls into the junction during the walk. Off by default, because the results in docs/results.md are measured without it.
    this.leftWaitsForWalk = leftWaitsForWalk;
    // A signal that gives emergency vehicles priority asks the controller to hold or change for them from 120 m out. A plain fixed-time signal has no such thing: an emergency vehicle there waits for its green like
    // anyone else (it still moves through the traffic as the simulator moves emergency vehicles, and the traffic still slows for it). Without priority the controller never hears of it.
    this.emergencyPriority = emergencyPriority;
    this.seed = seed;
    this.approachLength = approachLength; // the page sets a long road so vehicles start out of sight
    this.pedestrianWalk = pedestrianWalk; // how far out pedestrians start and finish
    this.exitRun = exitRun; // and a long road out, so they leave out of sight
    this.dt = dt;
    this.stepsPerSecond = Math.round(1 / dt);
    this.demand = { mix: DEFAULT_MIX, turns: DEFAULT_TURNS, ...demand };
    this.clockStart = clockStartS ?? this.demand.clockStartS ?? 12 * 3600;
    this.daily = this.demand.daily || null; // demand that follows the clock
    this.rain = 0; // 0 to 1, set by the page from the weather (clock demand only): fewer people on foot and fewer bikes and scooters, see wetMix and wetPeople in daily.js
    this.pedBehaviour = this.demand.pedBehaviour || null;
    this.detectionMiss = detectionMiss;
    // Where the controller's counts come from. By default the simulator counts its own vehicles in the detection zone, through the camera model below. With a `countSource(approach, time)` they come from a detector
    // instead (the page's, see src/detection/feed.js): it returns { general, right, bus }, each as { cars, trucks, buses, bikes }, or null when it has no trustworthy count for that approach. A null is not reported at
    // all, so the controller's last reports age out after `count_ttl` seconds and it falls back to the default green and never skips a phase on a count it does not have (see `fresh` in signals.js). The true counts
    // are still worked out each second (`truth`), for comparison; they are never given to the controller in this mode.
    this.countSource = countSource;
    this.truth = null;
    this.detectionCurve = detectionCurve; // [[metres, share of vehicles the camera picks out up to there], ...], measured for where the cameras are mounted (tools/detectability.mjs)
    this.lengthCounts = lengthCounts; // count a long vehicle as the lane it takes up
    this.controller = new Controller({
      config: makeConfig({ ...SIM_CONTROLLER_CONFIG, ...config }), plan: buildPlan(true),
      clockStartS: clockStartS ?? this.demand.clockStartS ?? 12 * 3600, powerOn,
    });
    this.controller.setMode(mode);
    this.snapshot = this.controller.snapshot;
    this.time = 0;
    this.stepCount = 0;
    this.nextId = 1;
    this.emergencyCount = 0;
    this.arrivalRng = [1, 2, 3, 4].map((a) => makeRng(seed * 1000 + a));
    this.pedRng = makeRng(seed * 1000 + 11);
    this.noiseRng = makeRng(seed * 1000 + 12);
    this.emergencyRng = makeRng(seed * 1000 + 13);
    this.nextEmergency = EMERGENCY_KINDS.map((kind) => (this.daily?.autoEmergencies ? this.emergencyRng.gap(EMERGENCY_MAX[kind]) : Infinity)); // calls that come by themselves, by the clock
    this.nextArrival = this.arrivalRng.map((rng, i) => rng.gap(this.candidateRate(i)));
    this.pedMood = [1, 2, 3, 4].map(() => ({ factor: 1, until: 0 })); // busy and quiet spells at each crossing
    this.nextPedestrian = [1, 2, 3, 4].map(() => this.pedRng.gap(this.pedestrianCandidateRate()));
    this.entry = [[], [], [], []];
    this.lanes = [0, 1, 2, 3].map(() => Array.from({ length: LANE_COUNT }, () => []));
    this.pedestrians = [];
    this.busyMouths = new Set(); // the side street zebras that someone is on or about to step on, found once a step
    this.vehicleList = [];
    this.carGrid = new Grid();
    this.pedGrid = new Grid();
    this.scratchCars = [];
    this.scratchPeds = [];
    this.changers = []; // vehicles that moved lane within the last LANE_CHANGE.seconds
    this.laneLead = new Map();
    this.flashRelease = -Infinity;
    this.flashHead = null;
    this.lastInBox = [];
    this.stats = {
      arrived: Object.fromEntries(Object.keys(CLASSES).map((k) => [k, 0])), crossed: 0, exited: 0,
      delay: { all: [0, 0], ...Object.fromEntries(Object.keys(CLASSES).map((k) => [k, [0, 0]])) },
      emergency: { sum: 0, n: 0, max: 0, waits: [], redRuns: 0 }, // the wait of every emergency vehicle that has crossed: from the moment it is on the road to the stop line, less the time to drive in
      laneChanges: 0, holds: 0, stops: 0, redRuns: 0, boxConflictSteps: 0, queueSum: 0, queueSamples: 0, queueMax: 0, backlogMax: 0,
      ped: { arrived: 0, started: 0, waitSum: 0, waitMax: 0, crossed: 0, gaveUp: 0, spawned: 0 },
    };
  }

  // Control

  dispatchAmbulance(approach, movement = 'through') {
    return this.dispatchEmergency(approach, movement, 'amb');
  }

  // An ambulance, a fire engine or a police car, going straight on or turning.
  dispatchEmergency(approach, movement = 'through', kind = 'amb') {
    if (!isEmergency(kind)) throw new Error(`${kind} is not an emergency vehicle`);
    // A count of its own: nextId only moves when something spawns, so two vehicles sent in the same moment would share an id, the controller (which keeps one request for each id) would hold one request for both, and the first to cross would cancel the other's.
    this.emergencyCount += 1;
    const id = `${kind}-e${this.emergencyCount}`;
    this.entry[approach - 1].unshift({ born: this.time, cls: kind, movement, emergency: true, vid: id });
    return id;
  }

  pressButton(crossing) {
    return this.controller.requestCrossing(crossing);
  }

  fault(reason = 'manual') {
    return this.controller.fault(reason);
  }

  clearFault() {
    return this.controller.clearFault();
  }

  setMode(mode) {
    this.controller.setMode(mode);
  }

  run(seconds) {
    const steps = Math.round(seconds / this.dt);
    for (let i = 0; i < steps; i += 1) this.step();
    return this;
  }

  step() {
    this.findBusyMouths();
    this.time += this.dt;
    this.stepCount += 1;
    this.spawn();
    this.callEmergencies();
    this.updateVehicles();
    this.updatePedestrians();
    if (this.stepCount % this.stepsPerSecond === 0) this.controlTick();
  }

  // Emergency calls: a stream of possible calls at the most a kind can reach, each kept with the chance for the hour. Never more than three on the way at once.
  callEmergencies() {
    EMERGENCY_KINDS.forEach((kind, i) => {
      while (this.nextEmergency[i] <= this.time) {
        const rng = this.emergencyRng;
        this.nextEmergency[i] += rng.gap(EMERGENCY_MAX[kind]);
        if (rng.next() >= emergencyRate(kind, this.clockStart + this.time) / EMERGENCY_MAX[kind]) continue;
        const onTheWay = this.vehicleList.filter((v) => isEmergency(v.cls)).length + this.entry.reduce((n, q) => n + q.filter((e) => e.emergency).length, 0);
        const approach = 1 + Math.floor(rng.next() * 4), movement = rng.pick({ through: 0.6, left: 0.2, right: 0.2 });
        if (onTheWay < 3) this.dispatchEmergency(approach, movement, kind);
      }
    });
  }

  // Arrivals

  spawn() {
    for (let a = 1; a <= 4; a += 1) {
      const rng = this.arrivalRng[a - 1];
      while (this.nextArrival[a - 1] <= this.time) {
        const born = this.nextArrival[a - 1];
        if (this.daily) {
          this.nextArrival[a - 1] += rng.gap(this.candidateRate(a - 1));
          if (rng.next() >= vehicleFactor(this.clockStart + born)) continue; // thinned out at this hour
        }
        const cls = rng.pick(this.daily ? wetMix(mixAt(this.clockStart + born, this.daily.region), this.rain) : this.demand.mix);
        const picked = rng.pick(this.demand.turns); // drawn for every vehicle, so the others do not change when a long one has to go straight
        const movement = NO_TURN.has(cls) ? 'through' : picked;
        // The kind inside the class (a school bus, a bin lorry, a taxi) comes from the clock and a number made from this arrival, not from the random stream.
        const kind = this.daily ? vehicleKind(cls, this.clockStart + born, ((Math.imul(Math.round(born * 1000) + a * 7919, 2654435761) >>> 0) % 10000) / 10000) : '';
        this.entry[a - 1].push({ born, cls, movement, kind });
        this.stats.arrived[cls] += 1;
        if (!this.daily) this.nextArrival[a - 1] += rng.gap(this.rateAt(a - 1, born));
      }
      this.admit(a);
    }
  }

  // The arrival rate of an approach at a time. A demand profile, [[from second, [rate per approach]], ...], changes the rates over the run, so
  // a run can be a day with quiet hours and a peak on each road. Without a profile the rates are steady.
  // With demand that follows the clock, arrivals are generated at the peak rate and thinned to the rate of the moment, which is exactly a Poisson
  // process whose rate changes, and it keeps working through hours when the rate is nothing.
  candidateRate(index) {
    return this.daily ? this.daily.vehiclePeak * (this.daily.shares ? this.daily.shares[index] : 1) : this.rateAt(index, 0);
  }

  rateAt(index, time) {
    const profile = this.demand.profile;
    if (!profile) return this.demand.rates[index];
    let rates = profile[0][1];
    for (const [from, r] of profile) if (time >= from) rates = r;
    return rates[index];
  }

  chooseLane(arrival, approach) {
    const active = this.snapshot.bus_lane_active;
    if (isBus(arrival.cls)) return arrival.movement === 'right' ? RIGHT : KERB; // a bus turning right uses the right turn lane too
    const queue = (lane) => this.lanes[approach - 1][lane].filter((v) => v.d > 0).length;
    if (isEmergency(arrival.cls)) { // a turn from its own lane, else the shorter queue, and the bus lane is open to it
      if (arrival.movement === 'right') return RIGHT;
      if (arrival.movement === 'left') return KERB;
      return queue(KERB) < queue(THROUGH) ? KERB : THROUGH;
    }
    if (arrival.movement === 'right') return RIGHT;
    if (arrival.movement === 'left') return KERB; // a left turn is made from the kerb lane, even a bus lane. In real life that is allowed only for the last stretch.
    if (KERB_ONLY.has(arrival.cls)) return KERB; // (a bike turning right was sent to the right turn lane above)
    if (active) return THROUGH;
    return queue(KERB) < queue(THROUGH) ? KERB : THROUGH;
  }

  admit(approach) {
    const waiting = this.entry[approach - 1];
    this.stats.backlogMax = Math.max(this.stats.backlogMax, waiting.length);
    while (waiting.length > 0) {
      const arrival = waiting[0];
      const props = CLASSES[arrival.cls];
      let lane = this.lanes[approach - 1][this.chooseLane(arrival, approach)], d = this.approachLength, last = lane[lane.length - 1];
      if (arrival.emergency && this.approachLength > EMERGENCY_SPAWN) { // an emergency vehicle comes in close to the junction, so it is not minutes away when the visitor sends it
        const slot = this.emergencySlot(approach, lane, props);
        if (!slot) break;
        ({ lane, d, last } = slot);
      } else if (last && this.approachLength - (last.d + last.length) < MIN_SPAWN_GAP + props.s0) break;
      waiting.shift();
      const laneIndex = this.lanes[approach - 1].indexOf(lane);
      const entering = {
        id: this.nextId, vid: arrival.vid || `v-${this.nextId}`, cls: arrival.cls, kind: arrival.kind || '', movement: arrival.movement,
        approach, lane: laneIndex, length: props.length, width: props.width, d,
        v: last ? Math.min(props.v0, last.v + 3) : props.v0, born: arrival.born, emergency: Boolean(arrival.emergency),
        requested: false, committed: false, released: false, crossed: false, wasStopped: false, stoppedSince: null,
        via: sideStreetFor(this.nextId, laneIndex, arrival.cls), lcAt: -Infinity, lx: LANE_X[laneIndex], pose: null, exitVia: exitStreetFor(this.nextId, laneIndex, arrival.movement, arrival.cls),
        pendingTo: null, pendingSince: 0, signalSide: null, signalUntil: -Infinity, held: 0, stall: 0, inside: false, enteredAt: Infinity,
      };
      const at = lane.findIndex((o) => o.d > d); // the lane is kept in order of distance from the line
      lane.splice(at < 0 ? lane.length : at, 0, entering);
      this.placeVehicle(entering);
      this.nextId += 1;
    }
  }

  // A free place in the lane for an emergency vehicle, EMERGENCY_SPAWN metres from the line or a little further back. Null while there is none.
  emergencySlot(approach, chosen, props) {
    const lanes = [chosen], gap = MIN_SPAWN_GAP + props.s0; // only its own lane, since a right turn or a left turn has to start in the lane for it
    for (let back = 0; back <= 120; back += 12) {
      const d = EMERGENCY_SPAWN + back;
      for (const lane of lanes) {
        const ahead = lane.filter((o) => o.d <= d).pop(), behind = lane.find((o) => o.d > d);
        if (ahead && d - (ahead.d + ahead.length) < gap) continue;
        if (behind && behind.d - (d + props.length) < gap) continue;
        return { lane, d, last: ahead || null };
      }
    }
    return null;
  }

  // Vehicles

  stopWall(v, signals) {
    if (v.emergency && v.released && v.d > 3 && signals[SIGNAL_KEY(v.approach, v.lane)] !== 'green' && !this.emergencyMayProceed(v)) { v.released = false; this.stats.emergency.redRuns -= 1; } // something has come into its way since it was let go: it brakes for the line again
    if (v.d <= 0 || v.committed || v.released) return false; // across the line, or committed to cross it
    let state = signals[SIGNAL_KEY(v.approach, v.lane)];
    if (v.movement === 'left' && state !== 'green' && this.snapshot.arrows[v.approach - 1] !== 'red') state = this.snapshot.arrows[v.approach - 1] === 'flash' ? state : this.snapshot.arrows[v.approach - 1]; // the left arrow
    if (v.emergency && state !== 'green' && this.emergencyMayProceed(v)) { v.released = true; this.stats.emergency.redRuns += 1; return false; } // a red or a yellow does not hold an emergency vehicle when the way is clear
    const stopDecel = (v.v * v.v) / (2 * Math.max(v.d - 0.5, 0.1));
    if (state === 'green') { // on green, still do not go in unless the whole vehicle will fit beyond the junction
      if (v.d > Math.max(14, v.v * v.v / 6 + 4) || stopDecel > 4) return false; // look ahead by the braking distance
      // A turning vehicle pulls forward to wait just short of the crossing it is turning across (see crossingWall), so that it can
      // turn the moment the pedestrians have cleared. Only a vehicle going straight on waits at the line for pedestrians.
      // A long vehicle turning left does not go in while people are on the crossing it will drive over. Waiting in the turn, its body would lie across the lane beside it
      // and hold up whatever is going straight on there for as long as the people take. It waits at the line, where it blocks only its own lane.
      return this.junctionOccupied(v) || this.exitBlocked(v) || (v.movement === 'through' && this.pedestrianInPath(v)) || (v.movement === 'left' && v.length >= LONG_TURNER && this.pedestrianAtExit(v)) || (this.leftWaitsForWalk && v.movement === 'left' && signals[`C${this.exitCrossing(v)}`] === 'walk');
    }
    if (state === 'yellow') {
      if (stopDecel > 3.5) { v.committed = true; return false; }
      return true;
    }
    if (stopDecel > 8) {
      v.committed = true;
      this.stats.redRuns += 1;
      return false;
    }
    return true;
  }

  // The crossing a vehicle will drive over on its way out of the junction.
  exitCrossing(v) {
    return (v.approach + (v.movement === 'left' ? 0 : v.movement === 'through' ? 1 : 2)) % 4 + 1;
  }

  // How far a vehicle may go before it must stop for people crossing, or null: the nearer of the junction's crossing and the zebra at a side street.
  wallAhead(v) {
    const a = this.crossingWall(v), b = this.mouthWall(v);
    return a === null ? b : b === null ? a : Math.min(a, b);
  }

  // Inside the junction, a vehicle stops a metre short of the crossing it is about to drive over while anyone is crossing there,
  // and never on it, so nobody ends up walking into the side of a vehicle. Returns how far it has to go to that line, or null.
  crossingWall(v) {
    if (v.d >= 0 || v.d <= -BOX_PATH[v.movement] || !this.pedestrianAtExit(v)) return null;
    const at = this.zebraDistance(v);
    return -v.d < at ? at + v.d : null;
  }

  // The Australian rule for a turn: give way to pedestrians on the road you are turning into. A vehicle must wait while anyone is
  // crossing the exit crossing, or waiting at its kerb with the signal on walk or flashing, until they are 2 m past the place where
  // the vehicle will drive over. Pedestrians who have crossed that far, or who are only walking along the footpath, or who are
  // waiting while the signal is red, do not hold it up. So a vehicle goes between people, and only when none are coming.
  pedestrianAtExit(v) {
    const c = this.exitCrossing(v), signal = this.snapshot.signals[`C${c}`], k = c - 1;
    const cos = [1, 0, -1, 0][k], sin = [0, 1, 0, -1][k];
    const p = vehiclePose({ ...v, d: -(this.zebraDistance(v) + 1.5) }, v.lx), at = p.x * cos + p.z * sin; // where it will cross, along the crossing
    for (const ped of this.pedestrians) {
      if (ped.crossing !== c) continue;
      if (ped.state !== 'crossing' && !(ped.state === 'waiting' && signal === 'walk')) continue; // waiting ones only while they can step out
      if ((ped.px * cos + ped.pz * sin - at) * ped.dir < 2) return true; // not yet 2 m past the vehicle's lane, in the way they are walking
    }
    return false;
  }

  // The Australian rule at a zebra: give way to anyone on it. At the mouth of a side street the people walking along the footpath cross the street on a zebra, so a vehicle coming out of
  // the street, or turning into it, stops short of the stripes while anyone is on them or about to step on, and goes on when they have crossed. A vehicle already on the stripes carries on,
  // and the pedestrian waits for it (see farBlocked). This finds the zebras with someone on or near them.
  findBusyMouths() {
    this.busyMouths.clear();
    for (const ped of this.pedestrians) {
      if (Math.abs(ped.px) < 80 && Math.abs(ped.pz) < 80) continue; // the first side street is 120 m out
      for (const z of MOUTH_ZEBRAS) if (!this.busyMouths.has(z.key) && onMouthZebra(z, ped.px, ped.pz)) { this.busyMouths.add(z.key); break; }
    }
  }

  // How far the front of a vehicle may go before it must stop for a busy zebra, or null.
  mouthWall(v) {
    if (this.busyMouths.size === 0) return null;
    let key, gap;
    if (v.via && v.d > joinDistance(v.via)) {
      key = mouthKey(v.approach - 1, 1, v.via);
      gap = v.d - joinDistance(v.via) - joinerZebraStart(v.lx);
    } else if (v.exitVia && v.movement === 'through' && v.d < 0) {
      key = mouthKey((v.approach + 1) % 4, -1, v.exitVia); // the street it turns into is on the other road, on the side that is the far side in that road's own frame
      gap = exitZebraStart(v.lx) - exitTurnProgress(v);
    } else return null;
    return gap > 0 && this.busyMouths.has(key) ? gap - MOUTH_STOP : null; // a vehicle at the stripes already has no wall
  }

  // The distance from the stop line at which the front of the vehicle is a metre short of the crossing it will drive over.
  zebraDistance(v) {
    if (v.movement === 'through') return -STOP_Y + 10.4 - 1; // the far crossing begins 10.4 m out
    const R = turnRadius(v.movement), edge = v.movement === 'left' ? 9.4 : -9.4; // the exit crossing, less a metre
    const c = v.movement === 'left' ? (v.lx + R - edge) / R : (edge - v.lx + R) / R;
    return TURN_START + R * Math.acos(Math.max(-1, Math.min(1, c)));
  }

  // Is a vehicle in the junction on its way to drive over this crossing? A pedestrian waits for it rather than the other way
  // round, so that no vehicle ever has to stop in the middle of the junction for someone who stepped out in front of it.
  vehicleHeadedFor(crossing) {
    return this.vehicleList.some((v) => {
      if (v.d >= 0 || v.d <= -BOX_PATH[v.movement] || this.exitCrossing(v) !== crossing) return false;
      const z = this.zebraDistance(v), front = -v.d;
      if (front > z + v.length + 1) return false; // already past it
      if (front <= z && v.v < 0.5 && this.pedestrianAtExit(v)) return false; // waiting short of the crossing for the pedestrians, who may go
      return true;
    });
  }

  // May these two movements be in the junction at once? A left turn counts as part of its approach's through movement, as the controller
  // does, unless the left arrow is on.
  together(a, b) {
    return this.controller.cfg.left_arrow ? compat(a, b) : compatible(a.replace('L', 'T'), b.replace('L', 'T'));
  }

  // Is any vehicle, moving or standing, on this crossing? A pedestrian does not step out while one is. A turner waiting in the junction for
  // the pedestrians on its exit crossing can be sitting across the crossing of its own approach.
  crossingOccupied(crossing) {
    const k = crossing - 1;
    const [x, z] = rotateFrame(k, 0, CROSSING_Y);
    const stripBox = box(x, z, k * Math.PI / 2, 2 * 12, 2 * CROSSING_HALF); // 24 m along the crossing, 3.2 m across
    for (const v of this.vehicleList) if (v.pose && overlap(stripBox, this.vehicleBox(v.pose, v)) > -0.3) return true;
    return false;
  }

  // Is a vehicle with a movement that conflicts with this one still in the junction? The signals leave a gap between phases
  // for that, but a vehicle that was held up for a pedestrian can still be there, and the next one must wait for it.
  // An emergency vehicle does not wait for a red or a yellow when the way is clear: it slows and goes through, as the road rules let it. This is true with or without priority from the signal (the priority
  // only gets the green sooner, so that fewer others have to be stopped). From 30 m out (or its braking distance, if it is going faster than about 13 m/s), and again at every step until it has gone, it asks whether it can cross now. It can when nobody is on the crossing in
  // its way, nothing that crosses its path is in the junction, and nothing that crosses its path and has a light (so it is going, or about to) can still get there before it has crossed: a vehicle that is nearer
  // than it can stop in (v squared over 6, and at least 14 m), plus 8 m, plus the way it travels while this one gets to the line and through. One standing at its own red is not in the way. While it cannot, it
  // brakes for the line like any other vehicle, and goes the moment it can, from a standing start if it has come to one. The ones that cross its path and then wait for it, because a vehicle does not enter a
  // junction that something crossing its path is in (see junctionOccupied). It does not wait for the queue ahead to move aside: only a vehicle that has got to the line in its own lane can go, and the
  // simulator does not move a standing queue out of the way (it changes lane to a free one, see changeAmbulanceLanes).
  emergencyMayProceed(v) {
    if (v.d <= 0 || v.d > Math.max(30, v.v * v.v / 6 + 8)) return false;
    if ((v.movement === 'through' && this.pedestrianInPath(v)) || (v.movement !== 'through' && this.pedestrianAtExit(v))) return false; // people on the crossing have the way, as for any vehicle
    const key = vehicleKey(v), box = BOX_PATH[v.movement];
    const signals = this.snapshot.signals, arrows = this.snapshot.arrows;
    const lit = (o) => o.committed || o.released || signals[SIGNAL_KEY(o.approach, o.lane)] !== 'red' || (o.movement === 'left' && arrows[o.approach - 1] !== 'red'); // has a light, or is committed or let go, so it is going or about to go
    const crossing = (v.d + box) / Math.max(v.v, RED_RUN_SPEED / 2); // seconds for it to get to the line and across
    return !this.vehicleList.some((o) => o !== v && o.d > -BOX_PATH[o.movement] && !this.together(vehicleKey(o), key)
      && (o.d < 0 || (lit(o) && o.d < Math.max(14, o.v * o.v / 6 + 4) + 8 + 1.5 * o.v * crossing)));
  }
  junctionOccupied(v) {
    const key = vehicleKey(v);
    // An emergency vehicle that has been let go through a red and is about to cross the line counts as in the junction already, so the traffic that gets its green a moment later waits for it.
    return this.vehicleList.some((o) => o !== v && ((o.d < 0 && o.d > -BOX_PATH[o.movement]) || (o.emergency && o.released && o.d >= 0 && o.d < 8)) && !this.together(vehicleKey(o), key));
  }

  // Is a pedestrian who is walking, not just standing at the kerb, anywhere along the path the vehicle is about to drive?
  pedestrianInPath(v) {
    const end = v.movement === 'through' ? BOX_PATH.through : turnLength(v.movement, v.lx), wb = WHEELBASE[v.cls];
    for (let s = 3; s <= end + 4; s += 4) {
      const f = vehiclePose({ ...v, d: -s }, v.lx), r = vehiclePose({ ...v, d: -s + wb }, v.lx);
      const spot = box((f.x + r.x) / 2, (f.z + r.z) / 2, Math.atan2(f.z - r.z, f.x - r.x), v.length, v.width + 0.6);
      for (const n of this.pedGrid.near(spot.x, spot.z, this.scratchPeds)) if (n.ped.state !== 'waiting' && overlap(spot, this.pedestrianBox(n.ped)) > 0) return true;
    }
    return false;
  }

  // Would the vehicle, once through, have room? It must not enter a junction it cannot leave.
  exitBlocked(v) {
    const end = v.movement === 'through' ? BOX_PATH.through : turnLength(v.movement, v.lx), wb = WHEELBASE[v.cls], d = -(end + 1) - 0.5;
    const f = vehiclePose({ ...v, d }, v.lx), r = vehiclePose({ ...v, d: d + wb }, v.lx);
    const spot = box((f.x + r.x) / 2, (f.z + r.z) / 2, Math.atan2(f.z - r.z, f.x - r.x), v.length + 1, v.width + 0.4);
    for (const o of this.carGrid.near(spot.x, spot.z, this.scratchCars)) {
      if (o !== v && o.v < 3 && o.pose && overlap(spot, this.vehicleBox(o.pose, o)) > 0) return true;
    }
    for (const n of this.pedGrid.near(spot.x, spot.z, this.scratchPeds)) {
      if (n.ped.state !== 'waiting' && overlap(spot, this.pedestrianBox(n.ped)) > 0) return true;
    }
    return false;
  }

  // Is a pedestrian crossing, or about to step out, on this crossing?
  crossingBusy(crossing) {
    return this.pedestrians.some((p) => p.crossing === crossing && p.state === 'crossing');
  }

  // The vehicle waiting longest at a stop line while the signals flash gets to go next.
  chooseFlashHead(signals) {
    this.flashHead = null;
    // Only while faulted. The five second flash before the signals restart is too short for a vehicle to clear the box.
    if (this.snapshot.stage !== 'fault') return;
    let best = null;
    for (const approach of this.lanes) {
      for (const lane of approach) {
        const front = lane[0];
        if (front && front.d > 0 && front.d < 4 && front.v < 0.3 && !front.released && !front.committed) {
          if (front.stoppedSince !== null && (best === null || front.stoppedSince < best.stoppedSince)) best = front;
        }
      }
    }
    // An all-way stop: go one at a time, and only when nothing conflicting is in the box or still coming in fast.
    const approaching = this.lanes.flat(2).filter((other) => other.d > 0 && other.d < 40 && (other.committed || other.v > 2));
    const clear = best && ![...this.lastInBox, ...approaching].some((other) => !this.together(vehicleKey(other), vehicleKey(best)));
    if (best && clear && this.time - this.flashRelease >= 3 && signals[SIGNAL_KEY(best.approach, best.lane)] === 'flash') {
      best.released = true;
      this.flashRelease = this.time;
    }
  }

  acceleration(v, leader, wall, crossingGap = null) {
    const c = CLASSES[v.cls];
    let desired = c.v0;
    if (v.joining) desired = Math.min(desired, 7); // an ambulance heading for its turn lane slows so that a gap can open
    if (v.slowUntil > this.time) desired = Math.min(desired, 5); // easing off for an ambulance
    if (v.emergency && v.released && v.d < 40 && v.d > -BOX_PATH[v.movement] - 10) desired = Math.min(desired, RED_RUN_SPEED); // through a red or a yellow it slows to about 40 km/h, as a driver does
    if (v.movement !== 'through') {
      if (v.d < 0 && v.d > -BOX_PATH[v.movement]) desired = TURN_SPEED;
      else if (v.d >= 0 && v.d < 25) desired = Math.min(desired, TURN_SPEED + v.d * 0.4);
    }
    const into = exitTurnProgress(v); // slow for the left turn into a side street on the way out
    if (into > -25 && into < 12) desired = Math.min(desired, TURN_SPEED + Math.max(0, -into) * 0.4);
    let interaction = 0;
    const consider = (gap, leaderSpeed) => {
      const sStar = c.s0 + Math.max(0, v.v * c.T + (v.v * (v.v - leaderSpeed)) / (2 * Math.sqrt(c.a * c.b)));
      interaction = Math.max(interaction, (sStar / Math.max(gap, 0.1)) ** 2);
    };
    if (leader && (leader.d > -8 || leader.movement === v.movement)) consider(v.d - (leader.d + leader.length), leader.v);
    const a = v.yieldTo; // an ambulance that wants to move into this lane just ahead: keep a good gap behind where it will be
    if (a && this.time < v.yieldUntil && a.d > -8 && a.d < v.d) consider(v.d - (a.d + a.length) - 6, a.v);
    if (wall) consider(v.d - 0.5, 0);
    if (crossingGap !== null) consider(Math.max(crossingGap, 0.1), 0);
    return clampValue(c.a * (1 - (v.v / desired) ** 4 - interaction), -9, c.a);
  }

  // A vehicle held up by a slower one in free flow moves to the next lane when there is room. It checks once a second and
  // switches its indicator on first. It moves over only after the indicator has been on for LANE_CHANGE.signal seconds and
  // the room is still there.
  changeLanes() {
    const active = this.snapshot.bus_lane_active;
    for (const lanes of this.lanes) {
      for (const from of [KERB, THROUGH]) {
        const lane = lanes[from], to = from === KERB ? THROUGH : KERB;
        for (let i = lane.length - 1; i >= 0; i -= 1) {
          const v = lane[i];
          if (isEmergency(v.cls)) continue; // emergency vehicles have their own rules below
          if (!this.canMoveOver(v, i, lane, lanes, to, active)) { v.pendingTo = null; continue; }
          if (v.pendingTo !== to) { v.pendingTo = to; v.pendingSince = this.time; continue; }
          if (this.time - v.pendingSince < LANE_CHANGE.signal) continue;
          this.moveToLane(v, i, lane, lanes, from, to);
        }
      }
      this.changeAmbulanceLanes(lanes);
    }
  }

  moveToLane(v, i, lane, lanes, from, to) {
    lane.splice(i, 1);
    const at = lanes[to].findIndex((o) => o.d > v.d);
    if (at < 0) lanes[to].push(v); else lanes[to].splice(at, 0, v);
    v.lane = to; v.lcAt = this.time; v.lcFrom = from; v.pendingTo = null;
    this.changers.push(v);
    v.signalSide = to === KERB ? 'left' : 'right'; v.signalUntil = this.time + LANE_CHANGE.seconds;
    this.stats.laneChanges += 1;
  }

  // Ambulances change lane to get through: any of them, whether they mean to go straight on or turn. A turning one heads back to its turn lane
  // well before the junction, with the vehicles behind the gap easing off, and if it still is not there 15 m from the line it takes the route
  // its lane allows and tells the signals, so that it never enters the junction from the wrong lane.
  changeAmbulanceLanes(lanes) {
    const neighbours = { [KERB]: [THROUGH], [THROUGH]: [KERB, RIGHT], [RIGHT]: [THROUGH] };
    for (const from of [KERB, THROUGH, RIGHT]) {
      const lane = lanes[from];
      for (let i = lane.length - 1; i >= 0; i -= 1) {
        const a = lane[i];
        if (!isEmergency(a.cls)) continue;
        const turnLane = a.movement === 'left' ? KERB : a.movement === 'right' ? RIGHT : null;
        a.joining = false;
        // Out of time: go the way this lane goes. It decides while it can still stop for what that route meets, at the 4 m/s2 the stop line rule
        // allows (v squared over 8), with some margin, and never later than the line zone.
        if (turnLane !== null && a.lane !== turnLane && a.d < Math.max(AMBULANCE_LINE, a.v * a.v / 4 + 3) && a.d > 0) {
          a.movement = 'through';
          if (a.requested) { try { this.controller.pause(a.vid, a.approach, 'through'); } catch (error) { a.requested = true; } }
          continue;
        }
        let acted = false;
        for (const to of neighbours[from]) {
          const decision = this.ambulanceDecision(a, i, lane, lanes, to);
          if (decision === 1) this.askToYield(a, to, lanes);
          if (decision !== 2) continue;
          if (a.pendingTo !== to) { a.pendingTo = to; a.pendingSince = this.time; acted = true; break; }
          if (this.time - a.pendingSince < 1) { acted = true; break; } // a short warning
          this.moveToLane(a, i, lane, lanes, from, to);
          acted = true;
          break;
        }
        if (!acted) a.pendingTo = null;
      }
    }
  }

  // What an ambulance wants to do about changing to a neighbouring lane: 0 stay, 1 it wants to go but the vehicles just behind the gap are too
  // close, 2 go. It moves over while it is rolling when the other lane has clearly more free road ahead, and the bus lane is open to it. A turning
  // ambulance may pass in the lane next to its turn lane, and goes back to its turn lane whenever that is nearly as good, taking smaller gaps.
  ambulanceDecision(v, i, lane, lanes, to) {
    if (v.committed || v.released || v.exitVia || v.d < AMBULANCE_LINE || this.time - v.lcAt < 2) return 0;
    const turnLane = v.movement === 'left' ? KERB : v.movement === 'right' ? RIGHT : null;
    const pair = v.movement === 'right' ? [THROUGH, RIGHT] : [KERB, THROUGH];
    if (!pair.includes(v.lane) || !pair.includes(to)) return 0;
    const joining = turnLane !== null && to === turnLane;
    if (v.v < (joining ? 1.5 : 3)) return 0;
    const freeAhead = (list) => {
      let gap = Infinity;
      for (const o of list) if (o !== v && o.d < v.d) gap = Math.min(gap, v.d - (o.d + o.length));
      return gap;
    };
    const here = freeAhead(lane), there = freeAhead(lanes[to]);
    const leader = i > 0 ? lane[i - 1] : null;
    const worth = joining ? there >= here - 8 : there > here + 12 && (here < 25 || (leader && leader.v < v.v - 2));
    if (!worth) return 0;
    if (joining) v.joining = true; // it slows down so that a gap can open
    const ahead = joining ? 3 : 4, behind = joining ? 3 : 4, closing = joining ? 1 : 1.5, give = joining ? 0.3 : 0.5;
    let tooClose = false;
    for (const o of lanes[to]) {
      if (o.d < v.d) { if (v.d - (o.d + o.length) < ahead + Math.max(0, v.v - o.v) * closing) return 0; } // not enough room ahead, and nobody can give that
      else if (o.d - (v.d + v.length) < behind + o.v * give + Math.max(0, o.v - v.v)) tooClose = true; // the one behind can give way
    }
    const follower = lane[i + 1];
    if (follower && follower.d - (v.d + v.length) <= 1) return 0;
    return tooClose ? 1 : 2;
  }

  // The traffic around an ambulance eases off so that it can go through at full speed. Vehicles ahead of it carry on to wherever they were going.
  // One that is level with it, or that it has already passed, slows down, and while the ambulance is at the stop line or in the junction so does
  // every vehicle waiting to enter. Nothing is stopped by this and nothing changes its route, so it only takes speed out of the vehicles that could meet it.
  ambulanceBubble() {
    const ambulances = this.vehicleList.filter((v) => isEmergency(v.cls) && (!v.crossed || v.d > -25));
    if (ambulances.length === 0) return;
    for (const v of this.vehicleList) {
      if (isEmergency(v.cls) || v.d <= 0) continue;
      for (const a of ambulances) {
        const near = v.approach === a.approach
          ? a.d > 0 && (v.lane === a.lane ? v.d > a.d : v.d - a.d > -(v.length + 3)) // behind it, or beside it in another lane. One ahead in its own lane carries on and clears the way
          : (a.d < 2 * AMBULANCE_LINE && a.d > -25 && v.d < 3 * AMBULANCE_LINE);
        if (near) { v.slowUntil = this.time + 1.5; break; }
      }
    }
  }

  // The vehicles in the other lane that are just behind the ambulance ease off so that it can move over.
  askToYield(a, to, lanes) {
    for (const o of lanes[to]) {
      if (isEmergency(o.cls) || o.d <= a.d) continue;
      o.yieldTo = a; o.yieldUntil = this.time + 2;
    }
  }

  canMoveOver(v, i, lane, lanes, to, active) {
    const c = CLASSES[v.cls];
    if (i < 1 || (to === KERB && active) || v.movement !== 'through') return false; // the bus lane is for buses, and a turn stays in its lane
    if (isBus(v.cls) || isEmergency(v.cls) || v.committed || v.released || v.exitVia) return false; // one headed for a side street stays in the kerb lane
    if (this.heldUpByTurner(v, i, lane, lanes, to)) return true;
    if (this.time - v.lcAt < LANE_CHANGE.cooldown || v.d < LANE_CHANGE.minD || (v.via && v.d > joinDistance(v.via))) return false;
    const leader = lane[i - 1];
    const gapToLeader = v.d - (leader.d + leader.length);
    if (leader.d <= 0 || gapToLeader > LANE_CHANGE.lookAhead || gapToLeader < 4 + Math.max(0, v.v - leader.v)) return false;
    if (!(leader.v > 2 && leader.v < c.v0 - LANE_CHANGE.slower && v.v > leader.v - 1)) return false;
    const follower = lane[i + 1];
    if (follower && follower.d - (v.d + v.length) < LANE_CHANGE.clearBehindOld) return false;
    let ahead = null, behind = null;
    for (const o of lanes[to]) {
      if (o.d < v.d) { if (!ahead || o.d > ahead.d) ahead = o; } else if (!behind || o.d < behind.d) behind = o;
    }
    if (ahead && ahead.d > -8 && !(v.d - (ahead.d + ahead.length) >= c.s0 + c.T * v.v + 4 && ahead.v >= leader.v + 0.5)) return false;
    if (behind && behind.d - (v.d + v.length) < 6 + behind.v * 0.6 + 2 * Math.max(0, behind.v - v.v)) return false;
    return true;
  }

  // A vehicle going straight in the kerb lane, behind a left turner that is waiting for pedestrians, moves to the through lane when
  // there is room, as drivers do.
  heldUpByTurner(v, i, lane, lanes, to) {
    if (i < 1 || to !== THROUGH || v.lane !== KERB || v.movement !== 'through' || this.time - v.lcAt < LANE_CHANGE.cooldown) return false;
    const leader = lane[i - 1], gap = v.d - (leader.d + leader.length);
    if (leader.movement !== 'left' || leader.v > 2 || gap > LANE_CHANGE.turnerGap || v.d < 4) return false;
    if (v.v < LANE_CHANGE.minSpeed) return false; // a car cannot move sideways while standing: it goes round the turner while it is rolling, not from the queue
    const follower = lane[i + 1];
    // A standing queue may close right up behind it, and the follower keeps it as its leader while it eases across (see leaderOf).
    if (follower && follower.d - (v.d + v.length) < 1.5 + Math.max(0, follower.v - v.v) * LANE_CHANGE.seconds) return false; // a follower that is closing needs the distance it covers meanwhile
    for (const o of lanes[to]) {
      const ahead = o.d < v.d, gapTo = ahead ? v.d - (o.d + o.length) : o.d - (v.d + v.length);
      // Ahead, it needs the road it covers while moving over, so that it can finish the move and straighten before it has to stop.
      if (gapTo < 3 + (ahead ? v.v * LANE_CHANGE.seconds : Math.max(0, o.v - v.v))) return false;
    }
    return true;
  }

  // Where a vehicle is on the ground. The front axle follows the lane and the turn and the rear axle trails behind it.
  placeVehicle(v) {
    const wb = WHEELBASE[v.cls], p = vehiclePose(v, v.lx);
    v.pose = v.pose ? trail(v.pose, p, wb) : { fx: p.x, fz: p.z, rx: p.x - Math.cos(p.h) * wb, rz: p.z - Math.sin(p.h) * wb, h: p.h };
  }

  vehicleBox(pose, v) {
    if (pose === v.pose && v.box) return v.box;
    const b = box((pose.fx + pose.rx) / 2, (pose.fz + pose.rz) / 2, Math.atan2(pose.fz - pose.rz, pose.fx - pose.rx), v.length, v.width);
    if (pose === v.pose) v.box = b;
    return b;
  }

  // Right of way, as [class, key]. A pedestrian already crossing goes first, then vehicles already in the junction (the one
  // that got in first before the others), then pedestrians not yet crossing, then vehicles still outside. A lower class, or
  // a lower key in the same class, has the right of way. Because this is a strict order, nothing can wait for something
  // that is waiting for it.
  priority(entity, isPedestrian) {
    if (isPedestrian) return [entity.state === 'crossing' && entity.progress > 0 ? 0 : 2, -this.pedestrianAhead(entity), entity.id]; // the one furthest along goes first
    if (entity.d < 0 && entity.d > -BOX_PATH[entity.movement]) return [1, entity.enteredAt, entity.id]; // in the junction
    return entity.via && entity.d > joinDistance(entity.via) ? [4, entity.d, entity.id] : [3, entity.d, entity.id]; // joining from a side street gives way to the road
  }

  // How far along its walk a pedestrian is, so that in a line the one in front goes first.
  pedestrianAhead(p) {
    return p.state === 'approaching' || p.state === 'waiting' ? -p.toKerb : p.state === 'crossing' ? p.progress : CROSSING_PATH_M + p.away;
  }

  // Does vehicle o have the right of way over vehicle v? In a queue, in the same lane of the same approach, the one in front goes first.
  goesBefore(o, v) {
    if (o.approach === v.approach && o.lane === v.lane) return o.d < v.d;
    return this.hasPriority(o.rank, v.rank);
  }

  hasPriority(a, b) {
    for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] < b[i];
    return false;
  }

  // Where a vehicle will be after some seconds at its present speed, as a box on the ground. The rear axle is placed a
  // wheelbase back along the path, which is a little wider than the real sweep, so the look ahead errs on the safe side.
  vehicleBoxAhead(o, index, seconds) {
    if (!o.ahead) o.ahead = [null, null, null];
    return o.ahead[index] || (o.ahead[index] = this.computeBoxAhead(o, seconds));
  }

  computeBoxAhead(o, seconds) {
    const wb = WHEELBASE[o.cls], d = o.d - Math.max(o.v, 3) * seconds;
    const f = vehiclePose({ ...o, d }, o.lx), r = vehiclePose({ ...o, d: d + wb }, o.lx);
    return box((f.x + r.x) / 2, (f.z + r.z) / 2, Math.atan2(f.z - r.z, f.x - r.x), o.length, o.width);
  }

  // Nothing moves into a space that something else occupies. A vehicle whose next position would overlap something that has
  // the right of way stays where it was and gives way. A vehicle about to enter the junction also keeps clear of where the
  // ones in front of it are about to swing. Overlap that is already there may not get worse, so two vehicles that touch
  // can still pull apart.
  settle(vehicles) {
    const peds = new Grid(), cars = new Grid(), nearCars = [], nearPeds = [];
    for (const ped of this.pedestrians) if (this.pedestrianMatters(ped)) peds.add({ ped, box: this.pedestrianBox(ped), priority: this.priority(ped, true) }, ped.px, ped.pz);
    for (const v of vehicles) { v.ahead = null; v.inherit = null; v.rank = this.priority(v, false); cars.add(v, v.pose.fx, v.pose.fz); }
    // The vehicle in front of one that is already in the junction cannot be made to wait for anything that the one behind
    // it would give way to, because the one behind cannot move until it does. So it takes the better of the two rights of way.
    for (const approach of this.lanes) for (const lane of approach) {
      let best = null;
      for (let i = lane.length - 1; i >= 0; i -= 1) {
        const v = lane[i];
        if (best && this.hasPriority(best, v.rank)) { v.inherit = [best[0], best[1], v.id]; v.rank = v.inherit; }
        if (v.rank[0] === 1 && (!best || this.hasPriority(v.rank, best))) best = v.rank;
      }
    }
    const step = (LANE_X[0] - LANE_X[THROUGH]) / LANE_CHANGE.seconds * this.dt;
    vehicles.sort((a, b) => a.d - b.d);
    // Vehicles that are merging in from a side street. Their tails swing across the lanes beside them, so a vehicle close to one is not left to the car-following shortcut below (that shortcut assumes
    // nothing but its leader can be in its way, and a fast vehicle in the next lane drove into the swinging tail of a slow semi that was joining the road).
    const merging = vehicles.filter((o) => o.via && o.d > joinDistance(o.via) - 15 && o.d < joinDistance(o.via) + 20);
    for (const v of vehicles) {
      v.blockedBy = 0; // whose body is in this vehicle's way this step, so a pair holding each other can be told apart from a queue
      if (v.d < 0 && !v.inside) { v.inside = true; v.enteredAt = this.time; const own = this.priority(v, false); v.rank = v.inherit && this.hasPriority(v.inherit, own) ? v.inherit : own; } else if (v.d >= 0) v.inside = false;
      v.lx += Math.max(-step, Math.min(step, LANE_X[v.lane] - v.lx));
      if (v.exitVia && this.sideStreetTurnBlocked(v, cars, nearCars)) v.exitVia = 0;
      const old = v.pose, wb = WHEELBASE[v.cls];
      const onApproach = v.d > 0 && !v.exitVia && (!v.via || v.d < joinDistance(v.via) - 1);
      const onExitRun = v.d < -(BOX_PATH[v.movement] + v.length) && (!v.exitVia || exitTurnProgress(v) < -v.length); // past the junction and before any side street turn
      const sliding = v.v < 1.5 && (onApproach || onExitRun); // crawling or standing on the straight road, where the body is just along the lane
      const next = trail(old, vehiclePose(v, v.lx), wb, sliding);
      // On the open road, in its own lane, a vehicle follows the one ahead by the car-following rule and cannot overlap it, so only the
      // stretch near the junction, a lane change, and the mouth of a side street need the body checks.
      const mouth = v.via ? joinDistance(v.via) : 0;
      if (v.d > 45 && Math.abs(v.lx - LANE_X[v.lane]) < 1e-6 && !(v.via && v.d > mouth - 15 && v.d < mouth + 20) && !v.pendingTo && !merging.some((o) => o !== v && o.approach === v.approach && Math.abs(o.d - v.d) < (o.length + v.length) / 2 + 12)) { v.stall = 0; v.pose = next; v.box = null; continue; }
      const mine = this.vehicleBox(next, v), now = this.vehicleBox(old, v);
      const allow = v.d < 0 ? Math.min(SQUEEZE_MAX, Math.max(0, v.stall - SQUEEZE_AFTER * 10) * 0.005) : 0; // only inside the junction, where a swinging tail can lock two vehicles // how far into the clearance it may go
      const worse = (other) => { const after = overlap(mine, other) + CLEARANCE - allow; return after > 0 && after > overlap(now, other) + CLEARANCE - allow + 0.001; };
      let blocked = false;
      for (const o of cars.near(mine.x, mine.z, nearCars)) {
        if (o === v) continue;
        const ox = (o.pose.fx + o.pose.rx) / 2 - mine.x, oz = (o.pose.fz + o.pose.rz) / 2 - mine.z, d2 = ox * ox + oz * oz, touch = (v.length + o.length) / 2 + 1.5;
        if (d2 <= touch * touch && worse(this.vehicleBox(o.pose, o))) { blocked = true; v.blockedBy = o.id; v.why = `body of ${o.cls}/${o.movement}/a${o.approach}/d${o.d.toFixed(0)}`; break; } // never into a vehicle, whoever has the right of way
        // and keep clear of where one with the right of way, that is moving, is about to swing (about 3 seconds at turning speed)
        // Only while o is still in the junction or its tail is (a vehicle on the straight exit road sweeps nothing, and two vehicles in one exit lane would otherwise hold each other: the one ahead waits for the one behind)
        if (o.blockedBy !== v.id && o.v > 0.5 && o.d < 0 && o.d > -BOX_PATH[o.movement] - o.length && v.d < 25 && d2 <= 400 && this.goesBefore(o, v) && [0.8, 1.6, 2.4].some((t, i) => overlap(mine, this.vehicleBoxAhead(o, i, t)) > -CLEARANCE)) { blocked = true; v.why = `swing of ${o.cls}/${o.movement}/a${o.approach}/d${o.d.toFixed(0)}`; break; }
      }
      if (!blocked) for (const n of peds.near(mine.x, mine.z, nearPeds)) if (this.hasPriority(n.priority, v.rank) && worse(n.box)) { blocked = true; v.why = `ped ${n.ped.state} c${n.ped.crossing}`; break; }
      if (blocked) {
        v.d = v.prevD; v.v = 0; v.held += 1; v.stall += 1; this.stats.holds += 1;
        if (v.exitVia && v.stall > SIDE_TURN_GIVE_UP * 10) v.exitVia = 0; // stuck against a neighbour in its turn: carry straight on instead
        continue;
      }
      if (allow <= 0) v.stall = 0; // a vehicle that got through only by squeezing keeps its allowance, so it can finish the squeeze
      v.pose = next; v.box = null;
    }
    this.carGrid = new Grid();
    for (const v of vehicles) this.carGrid.add(v, v.pose.fx, v.pose.fz);
  }

  // The left turn into a side street on the way out swings the body toward the through lane first. It is not started with a vehicle
  // alongside, because the two would then hold each other for good (the swing cannot finish, the neighbour cannot pass).
  sideStreetTurnBlocked(v, cars, near) {
    const into = exitTurnProgress(v);
    if (into <= -10 || into >= 2) return false;
    cars.near(v.pose.fx, v.pose.fz, near);
    return near.some((o) => o !== v && o.approach === v.approach && o.lane !== v.lane && Math.abs(o.d - v.d) < (o.length + v.length) / 2 + 3);
  }

  // The vehicle ahead in the same lane. A vehicle that has just moved to the next lane is still partly in this one while it eases across,
  // so for those 2.5 s the one behind keeps it as its leader if it is the nearer.
  leaderOf(v, i, lane) {
    let leader = i > 0 ? lane[i - 1] : null;
    for (const o of this.changers) {
      if (o.lcFrom !== v.lane || o.approach !== v.approach || o.d >= v.d) continue;
      if (!leader || o.d > leader.d) leader = o;
    }
    return leader;
  }

  updateVehicles() {
    const dt = this.dt;
    this.changers = this.changers.filter((o) => this.time - o.lcAt < LANE_CHANGE.seconds);
    const signals = this.snapshot.signals;
    if (this.stepCount % this.stepsPerSecond === 3) { this.changeLanes(); this.ambulanceBubble(); }
    this.chooseFlashHead(signals);
    const vehicles = [];
    for (const approachLanes of this.lanes) {
      for (const lane of approachLanes) {
        const accelerations = lane.map((v, i) => this.acceleration(v, this.leaderOf(v, i, lane), this.stopWall(v, signals), this.wallAhead(v)));
        lane.forEach((v, i) => {
          v.v = Math.max(0, v.v + accelerations[i] * dt);
          v.prevD = v.d;
          v.d -= v.v * dt;
        });
        for (let i = 0; i < lane.length; i += 1) {
          const v = lane[i];
          const leader = i > 0 ? lane[i - 1] : null;
          if (leader && (leader.d > -8 || leader.movement === v.movement)) {
            const minD = leader.d + leader.length + 0.3;
            if (v.d < minD) { v.d = minD; v.v = Math.min(v.v, leader.v); }
          }
          if (v.committed && v.d > 0.2 && v.v < 0.3) v.committed = false; // it stopped after all, behind another vehicle, so it is no longer committed
          if (v.d < 0.5 && v.d > -0.0 && !v.crossed && !v.committed && !v.released && this.stopWall(v, signals) === true) {
            v.d = 0.5;
            v.v = 0;
          }
          this.afterMove(v);
        }
        for (let i = lane.length - 1; i >= 0; i -= 1) {
          const v = lane[i];
          if (v.d <= -BOX_PATH[v.movement] - this.exitRun) {
            lane.splice(i, 1);
            this.stats.exited += 1;
            if (v.emergency && v.requested) this.controller.resume(v.vid);
          } else vehicles.push(v);
        }
      }
    }
    this.settle(vehicles);
    this.vehicleList = vehicles;
    const inBox = vehicles.filter((v) => v.d < 0 && v.d > -BOX_PATH[v.movement]);
    this.countBoxConflicts(inBox);
    this.lastInBox = inBox;
  }

  afterMove(v) {
    const stoppedNow = v.v < 0.3 && v.d > 0.5;
    if (stoppedNow && !v.wasStopped) {
      this.stats.stops += 1;
      v.stoppedSince = this.time;
    }
    if (!stoppedNow) v.stoppedSince = stoppedNow ? v.stoppedSince : null;
    v.wasStopped = stoppedNow;
    if (v.emergency && this.emergencyPriority && !v.requested && v.d <= GEOFENCE) {
      v.requested = true;
      try { this.controller.pause(v.vid, v.approach, v.movement); } catch (error) { v.requested = false; }
    }
    if (v.d < 0 && !v.crossed) {
      v.crossed = true;
      this.stats.crossed += 1;
      const delay = Math.max(0, this.time - v.born - this.approachLength / CLASSES[v.cls].v0);
      for (const key of ['all', v.cls]) {
        this.stats.delay[key][0] += delay;
        this.stats.delay[key][1] += 1;
      }
      if (v.emergency) { const e = this.stats.emergency; e.sum += delay; e.n += 1; e.max = Math.max(e.max, delay); e.waits.push(delay); }
      if (v.emergency && v.requested) this.controller.resume(v.vid);
    }
  }

  countBoxConflicts(inBox) {
    for (let i = 0; i < inBox.length; i += 1) {
      for (let j = i + 1; j < inBox.length; j += 1) {
        if (!this.together(vehicleKey(inBox[i]), vehicleKey(inBox[j]))) {
          this.stats.boxConflictSteps += 1;
          return;
        }
      }
    }
  }

  // Pedestrians

  pedestrianBox(ped) {
    if (!ped.box) {
      const pose = ped.pose || (ped.pose = pedestrianPose(ped)), e = pedestrianExtent(ped.id);
      ped.box = box(pose.x, pose.z, pose.h, e.ahead + e.behind, e.width, e.ahead);
    }
    return ped.box;
  }

  // Would the pedestrian's new position run into something that was not already in the way?
  // Far from the junction a pedestrian walks along a footpath, so only the one ahead in the same lane matters, and a vehicle where it
  // crosses the footpath at the mouth of a side street. That is a gap on one line and a distance, with no boxes to test.
  farBlocked(ped) {
    const lead = this.laneLead.get(ped.id);
    if (lead !== undefined) {
      const mine = pedestrianExtent(ped.id), theirs = pedestrianExtent(lead.id);
      if (lead.ahead - this.pedestrianAhead(ped) < mine.ahead + theirs.behind + 0.3) return true;
    }
    const along = ped.state === 'approaching' ? ped.toKerb : ped.away; // metres out from the kerb
    const nearMouth = Math.abs(((along + 14 + 60) % SIDE_STREET_SPACING) - 60) < 10;
    if (nearMouth) {
      const mine = this.pedestrianBox(ped);
      for (const v of this.carGrid.near(mine.x, mine.z, this.scratchCars)) {
        if (v.v > 0.3 && overlap(mine, this.vehicleBox(v.pose, v)) > -0.12) return true;
      }
    }
    return false;
  }

  // Can this pedestrian meet a vehicle? Only near the junction, or where a vehicle crosses the footpath at the mouth of a side street.
  pedestrianMatters(ped) {
    if (Math.abs(ped.px) <= 80 && Math.abs(ped.pz) <= 80) return true;
    if (ped.state !== 'approaching' && ped.state !== 'leaving') return true;
    const along = ped.state === 'approaching' ? ped.toKerb : ped.away;
    return Math.abs(((along + 14 + 60) % SIDE_STREET_SPACING) - 60) < 10;
  }

  // For each pedestrian far out, the one directly ahead of them in the same lane (the nearest with a greater distance along).
  findLaneLeads() {
    const lines = new Map();
    for (const ped of this.pedestrians) {
      const key = `${ped.crossing}:${ped.dir}:${pedestrianLane(ped.id)}`, list = lines.get(key);
      const entry = { id: ped.id, ahead: this.pedestrianAhead(ped) };
      if (list) list.push(entry); else lines.set(key, [entry]);
    }
    this.laneLead.clear();
    for (const list of lines.values()) {
      list.sort((a, b) => a.ahead - b.ahead);
      for (let i = 0; i + 1 < list.length; i += 1) this.laneLead.set(list[i].id, list[i + 1]);
    }
  }

  pedestrianBlocked(ped, now) {
    if ((ped.state === 'approaching' || ped.state === 'leaving') && (Math.abs(ped.px) > 60 || Math.abs(ped.pz) > 60)) return this.farBlocked(ped);
    const mine = this.pedestrianBox(ped), mine0 = this.priority(ped, true), margin = 0.12 - Math.min(SQUEEZE_MAX / 2, Math.max(0, ped.stall - SQUEEZE_AFTER * 10) * 0.003);
    const worse = (other) => { const after = overlap(mine, other) + margin; return after > 0 && after > overlap(now, other) + margin + 0.001; };
    // Pedestrians keep a gap only to the one directly ahead of them in their own lane. The two directions walk in separate lanes,
    // so nobody ever has to wait for someone coming the other way.
    const lane = pedestrianLane(ped.id), here = this.pedestrianAhead(ped);
    for (const n of this.pedGrid.near(mine.x, mine.z, this.scratchPeds)) {
      const o = n.ped;
      if (o === ped || o.dir !== ped.dir || pedestrianLane(o.id) !== lane || this.pedestrianAhead(o) <= here) continue;
      if (worse(this.pedestrianBox(o))) return true;
    }
    // A pedestrian never waits for a vehicle near the junction. Vehicles give way to pedestrians there (see pedestrianAtExit), and a
    // pedestrian only steps onto a crossing when no vehicle is about to drive over it. Further out, where a vehicle crosses the
    // footpath from a side street, the pedestrian waits for a vehicle that is moving, and never for one that is stopped, so
    // the two cannot wait for each other.
    if (Math.abs(mine.x) >= NEAR_JUNCTION || Math.abs(mine.z) >= NEAR_JUNCTION) {
      for (const v of this.carGrid.near(mine.x, mine.z, this.scratchCars)) if (v.v > 0.3 && worse(this.vehicleBox(v.pose, v))) return true;
    }
    return false;
  }

  // Is someone ahead of this pedestrian in the same lane still waiting? The queue steps out in order.
  waitingAhead(ped) {
    const lane = pedestrianLane(ped.id), here = this.pedestrianAhead(ped);
    for (const n of this.pedGrid.near(ped.px, ped.pz, this.scratchPeds)) {
      const o = n.ped;
      if (o !== ped && o.state === 'waiting' && o.crossing === ped.crossing && o.dir === ped.dir && pedestrianLane(o.id) === lane && this.pedestrianAhead(o) > here) return true;
    }
    return false;
  }

  // Someone who has just crossed may carry on along the footpath, or turn the corner and wait for the crossing over the other road.
  turnAtCorner(ped) {
    const next = CORNER.get(`${ped.crossing}:${ped.dir}`);
    if (!next || next.gap > 4) return;
    ped.crossing = next.crossing; ped.dir = next.dir; ped.state = 'approaching'; ped.toKerb = this.queueSpot(ped, next.crossing, next.dir); ped.progress = 0; ped.away = 0; ped.sidestep = 0;
    ped.counted = false; ped.turns = (ped.turns || 0) + 1; ped.pose = pedestrianPose(ped); ped.px = ped.pose.x; ped.pz = ped.pose.z; ped.box = null;
  }

  // Can someone who has run out of patience walk back out now? Not while people are leaving onto the side they would step into, and not while turning round would swing their companion
  // (a pram goes from behind them to in front of them) into someone in the queue. They wait for that to clear, and the next walk may come first.
  leavingClear(ped) {
    const start = Math.max(0, ped.toKerb), mine = pedestrianExtent(ped.id);
    // in either lane of that side, since they cross one to reach theirs, and including those about to step off the crossing onto it
    const leaving = this.pedestrians.some((o) => o !== ped && o.crossing === ped.crossing && o.dir === -ped.dir && (o.state === 'leaving' ? Math.abs(o.away - start) < pedestrianExtent(o.id).behind + mine.ahead + 1.2 : o.state === 'crossing' && o.progress > CROSSING_PATH_M - 3));
    if (leaving) return false;
    return !this.pedestrians.some((o) => { // turned round, their front and back are swapped
      if (o === ped || (o.state !== 'waiting' && o.state !== 'approaching') || o.crossing !== ped.crossing || o.dir !== ped.dir) return false;
      const theirs = pedestrianExtent(o.id);
      return o.toKerb - theirs.ahead < ped.toKerb + mine.ahead + 0.1 && o.toKerb + theirs.behind > ped.toKerb - mine.behind - 0.1;
    });
  }

  // Where someone who turns the corner joins the queue at the kerb: at the kerb if their lane is clear there, and otherwise behind whoever is waiting or walking up in it.
  // Put at the kerb regardless, they stood on top of the person already waiting there.
  queueSpot(ped, crossing, dir) {
    const lane = pedestrianLane(ped.id), mine = pedestrianExtent(ped.id);
    const others = this.pedestrians.filter((o) => o !== ped && o.crossing === crossing && o.dir === dir && pedestrianLane(o.id) === lane && (o.state === 'waiting' || o.state === 'approaching')).sort((a, b) => a.toKerb - b.toKerb);
    let spot = 0;
    for (const o of others) {
      const theirs = pedestrianExtent(o.id);
      if (spot - mine.ahead < o.toKerb + theirs.behind + 0.15 && spot + mine.behind + 0.15 > o.toKerb - theirs.ahead) spot = o.toKerb + theirs.behind + mine.ahead + 0.15;
    }
    return spot;
  }

  // The scene hands a person from the park to the footpath here (they walk toward the kerb of this crossing from toKerb metres away), and takes one back.
  adoptPedestrian(j, dir, toKerb) {
    const ped = this.addPedestrian(j, this.time, dir);
    ped.toKerb = toKerb; ped.pose = pedestrianPose(ped); ped.px = ped.pose.x; ped.pz = ped.pose.z;
    this.stats.ped.spawned -= 1; // they were already counted when the park first had them
    return ped;
  }
  releasePedestrian(ped) {
    const i = this.pedestrians.indexOf(ped);
    if (i >= 0) this.pedestrians.splice(i, 1);
  }

  startWaiting(ped, signals) {
    ped.state = 'waiting'; ped.arrived = this.time;
    this.stats.ped.arrived += 1;
    if (ped.presser !== false && signals[`C${ped.crossing}`] !== 'walk') this.controller.requestCrossing(ped.crossing);
  }

  // Pedestrians walk in single file, in one of three lanes, keeping left. They never walk into each other or into a vehicle:
  // one that is blocked waits, and one blocked near the kerb joins the queue where it stands.
  // The rate at which candidate pedestrians are generated at a crossing. With a clock or with busy and quiet spells it is the highest rate there can be,
  // and each candidate is kept with the probability of the moment. Without either it is the plain steady rate.
  pedestrianCandidateRate() {
    const top = this.daily ? this.daily.pedPeak : this.demand.pedRate ?? 0;
    return this.pedBehaviour?.quiet ? top * PEDESTRIAN_MOOD_MAX : top;
  }

  // Is the pedestrian candidate born at this time kept?
  pedestrianKept(j, born) {
    if (!this.daily && !this.pedBehaviour?.quiet) return true;
    const mood = this.pedMood[j - 1];
    if (born >= mood.until && this.pedBehaviour?.quiet) { // a new spell: mostly ordinary, sometimes quiet, sometimes a rush
      const roll = this.pedRng.next();
      if (roll < 0.28) { mood.factor = 0.04; mood.until = born + 60 + this.pedRng.next() * 240; } // nobody for a while
      else if (roll < 0.42) { mood.factor = PEDESTRIAN_MOOD_MAX; mood.until = born + 30 + this.pedRng.next() * 60; }
      else { mood.factor = 1; mood.until = born + 60 + this.pedRng.next() * 180; }
    }
    const level = this.daily ? pedestrianFactor(this.clockStart + born) * wetPeople(this.rain) : 1;
    const moodFactor = this.pedBehaviour?.quiet ? mood.factor / PEDESTRIAN_MOOD_MAX : 1;
    return this.pedRng.next() < level * moodFactor;
  }

  addPedestrian(j, born, dir) {
    const speed = 1.2 + this.pedRng.next() * 0.3;
    // the kind of walker follows the clock; it comes from the person's number, so the random stream is not touched, and it sets the pace within the kind's range
    const role = this.daily ? walkerRole(this.clockStart + born, ((Math.imul(this.nextId + 3, 2654435761) >>> 0) % 1000) / 1000) : '';
    const [slow, fast] = WALKER_SPEED[role];
    // dir is the way they cross along the line of the crossing, and they walk in from the far end of the footpath
    const ped = { id: this.nextId, crossing: j, dir: dir ?? (this.nextId % 2 ? 1 : -1), state: 'approaching', born, toKerb: this.pedestrianWalk - (this.time - born) * speed, speed: role ? slow + (speed - 1.2) / 0.3 * (fast - slow) : speed, role, progress: 0, away: 0, px: 0, pz: 0, stall: 0 };
    if (this.daily && ((Math.imul(this.nextId, 2246822519) >>> 0) % 1000) / 1000 < studentShare(this.clockStart + born)) ped.student = true; // a school child, at school times
    const b = this.pedBehaviour;
    if (b) { // not everyone presses the button, and the ones who do not give up sooner
      ped.presser = this.pedRng.next() < b.pressShare;
      ped.patience = ped.presser ? 300 : b.patience[0] + this.pedRng.next() * (b.patience[1] - b.patience[0]);
    }
    this.nextId += 1;
    this.stats.ped.spawned += 1;
    ped.pose = pedestrianPose(ped); ped.px = ped.pose.x; ped.pz = ped.pose.z;
    this.pedestrians.push(ped);
    return ped;
  }

  updatePedestrians() {
    const signals = this.snapshot.signals;
    for (let j = 1; j <= 4; j += 1) {
      while (this.nextPedestrian[j - 1] <= this.time) {
        const born = this.nextPedestrian[j - 1];
        this.nextPedestrian[j - 1] += this.pedRng.gap(this.pedestrianCandidateRate());
        if (!this.pedestrianKept(j, born)) continue;
        const first = this.addPedestrian(j, born);
        if (this.pedBehaviour && this.pedRng.next() < this.pedBehaviour.groupShare) { // a group: two to four, walking together
          const size = 2 + Math.floor(this.pedRng.next() * 3);
          for (let k = 1; k < size; k += 1) this.addPedestrian(j, born + k * 0.9, first.dir);
        }
      }
    }
    this.findLaneLeads();
    this.pedGrid = new Grid();
    for (const ped of this.pedestrians) if (this.pedestrianMatters(ped)) this.pedGrid.add({ ped, priority: this.priority(ped, true) }, ped.px, ped.pz);
    for (let i = this.pedestrians.length - 1; i >= 0; i -= 1) {
      const ped = this.pedestrians[i];
      const now = this.pedestrianBox(ped), nowPose = ped.pose, saved = { toKerb: ped.toKerb, progress: ped.progress, away: ped.away, state: ped.state };
      let moving = false;
      if (ped.state === 'approaching') { ped.toKerb -= ped.speed * this.dt; moving = true; }
      else if (ped.state === 'leaving') { if (!ped.sidestep || Math.abs(ped.sidestep) < 0.05) ped.away += ped.speed * this.dt; moving = true; } // one who turned back first moves across into the other lane, and only then walks, so they do not clip the queue they pass
      else if (ped.state === 'waiting') {
        if (signals[`C${ped.crossing}`] === 'walk' && !this.vehicleHeadedFor(ped.crossing) && !this.crossingOccupied(ped.crossing) && !this.waitingAhead(ped)) {
          ped.state = 'crossing'; ped.progress = -ped.toKerb; // one that waits back from the kerb first walks up to it
          if (!ped.counted) { // count a pedestrian's wait once, even if a walk ends before they reach the kerb
            ped.counted = true;
            const wait = this.time - ped.arrived;
            this.stats.ped.started += 1;
            this.stats.ped.waitSum += wait;
            this.stats.ped.waitMax = Math.max(this.stats.ped.waitMax, wait);
          }
        } else if (this.snapshot.stage !== 'fault' && this.snapshot.stage !== 'flash' && this.time - ped.arrived > 1.5
          && ped.presser !== false && !this.snapshot.pedestrian_requests.includes(ped.crossing) && signals[`C${ped.crossing}`] === 'stop') {
          this.controller.requestCrossing(ped.crossing); // a press that was served before this pedestrian could start
        }
      }
      if (ped.state === 'waiting' && ped.patience !== undefined && this.time - ped.arrived > ped.patience && this.leavingClear(ped)) {
        // gives up and walks back out the way they came: a pedestrian leaving in the other direction, from where they stand
        const lane = pedestrianLane(ped.id), from = walkAcross(ped.dir, lane);
        ped.dir = -ped.dir; ped.state = 'leaving'; ped.away = Math.max(0, ped.toKerb); ped.toKerb = 0; ped.gaveUp = true;
        ped.sidestep = from - walkAcross(ped.dir, lane); // and eases across over the next second or two, so it is not a jump
        this.stats.ped.gaveUp += 1;
      }
      if (ped.state === 'crossing' && ped.progress <= 0 && signals[`C${ped.crossing}`] !== 'walk') {
        // the walk ended before they reached the kerb, so they wait for the next one instead of stepping out
        ped.state = 'waiting'; ped.toKerb = -ped.progress; ped.progress = 0;
      }
      if (ped.state === 'crossing') { ped.progress += ped.speed * this.dt; moving = true; }
      if (ped.sidestep) ped.sidestep -= Math.sign(ped.sidestep) * Math.min(Math.abs(ped.sidestep), 0.8 * this.dt);
      if (moving) { ped.pose = pedestrianPose(ped); ped.box = null; } // where they would be after this step
      if (moving && this.pedestrianBlocked(ped, now)) {
        ped.stall += 1;
        ped.toKerb = saved.toKerb; ped.progress = saved.progress; ped.away = saved.away; ped.pose = nowPose; ped.box = now;
        if (saved.state === 'waiting' && ped.state === 'crossing') ped.state = 'waiting'; // a step out that was refused is no step out: they stay where they queue, not on the kerb line
        if (ped.state === 'approaching' && ped.toKerb < 10) this.startWaiting(ped, signals);
      } else if (moving) {
        ped.stall = 0;
      }
      if (ped.stall === 0 && ped.state === 'approaching' && ped.toKerb <= 0) {
        ped.toKerb = 0; this.startWaiting(ped, signals);
      } else if (ped.state === 'crossing' && ped.progress >= CROSSING_PATH_M) {
        this.stats.ped.crossed += 1;
        ped.state = 'leaving';
        if (this.pedBehaviour?.turnShare && (ped.turns || 0) < 2 && ((Math.imul(ped.id + 17 * (ped.turns || 0), 2654435761) >>> 0) % 1000) / 1000 < this.pedBehaviour.turnShare) this.turnAtCorner(ped); // from the person's number, so what the signals do cannot change the random stream
      } else if (ped.state === 'leaving' && ped.away >= this.pedestrianWalk) {
        this.pedestrians.splice(i, 1);
        continue;
      }
      ped.pose = pedestrianPose(ped); ped.box = null; ped.px = ped.pose.x; ped.pz = ped.pose.z;
    }
  }

  // Detection and control, once a second

  // Does the camera miss a vehicle this far from the stop line? With a curve, by the share its mounting can pick out at that distance. Otherwise one chance for all.
  missed(d) {
    if (this.detectionCurve) { const step = this.detectionCurve.find(([to]) => d <= to) || this.detectionCurve.at(-1); return this.noiseRng.next() >= step[1]; }
    return this.detectionMiss > 0 && this.noiseRng.next() < this.detectionMiss;
  }

  // What a detected vehicle adds to its count. By default one, as the camera model counts it. With lengthCounts a long one adds what it takes up of the lane, in the
  // units of the ordinary vehicle of its count (a semi is nearly two trucks, an articulated bus about one and a half buses), and the total is rounded at the end.
  countWeight(cls, field) {
    if (!this.lengthCounts) return 1;
    const ref = REFERENCE_FOR[field], c = CLASSES[cls], r = CLASSES[ref];
    return Math.max(1, (c.length + c.s0) / (r.length + r.s0));
  }

  // The true counts of an approach, the way the detector's are grouped: the general lanes (the kerb lane too, unless it is the bus lane), the right-turn lane and the bus lane. No camera model, no misses.
  trueCounts(a, active) {
    const general = { bikes: 0, buses: 0, cars: 0, trucks: 0 }, right = { ...general }, bus = { ...general };
    this.lanes[a - 1].forEach((lane, laneIndex) => {
      for (const v of lane) {
        if (!(v.d > 0 && v.d <= this.detectionZone)) continue;
        (laneIndex === RIGHT ? right : laneIndex === KERB && active ? bus : general)[COUNT_FIELD[v.cls]] += 1;
      }
    });
    return { general, right, bus };
  }

  controlTick() {
    const active = this.snapshot.bus_lane_active;
    if (this.countSource) { // the counts come from a detector
      this.truth = [1, 2, 3, 4].map((a) => this.trueCounts(a, active));
      for (let a = 1; a <= 4; a += 1) {
        const got = this.countSource(a, this.time);
        if (!got) continue; // nothing to report: the controller's counts for this approach go stale, which it treats as unknown
        this.controller.reportCounts(a, makeCounts(whole(got.general)));
        this.controller.reportRightCounts(a, makeCounts(whole(got.right)));
        if (active) this.controller.reportBusCounts(a, makeCounts(whole(got.bus)));
      }
      this.snapshot = this.controller.tick();
      this.sampleQueues();
      return;
    }
    for (let a = 1; a <= 4; a += 1) {
      const general = { bikes: 0, buses: 0, cars: 0, trucks: 0 };
      const right = { bikes: 0, buses: 0, cars: 0, trucks: 0 };
      const bus = { bikes: 0, buses: 0, cars: 0, trucks: 0 };
      this.lanes[a - 1].forEach((lane, laneIndex) => {
        for (const v of lane) {
          if (!(v.d > 0 && v.d <= this.detectionZone)) continue;
          if (this.missed(v.d)) continue;
          const field = COUNT_FIELD[v.cls];
          const target = laneIndex === RIGHT ? right : laneIndex === KERB && active ? bus : general;
          target[field] += this.countWeight(v.cls, field);
        }
      });
      this.controller.reportCounts(a, makeCounts(whole(general)));
      this.controller.reportRightCounts(a, makeCounts(whole(right)));
      if (this.controller.cfg.left_arrow && this.controller.cfg.left_window === 0) { // a detector that can tell left turners from vehicles going straight on
        const left = { bikes: 0, buses: 0, cars: 0, trucks: 0 };
        for (const lane of this.lanes[a - 1]) {
          for (const v of lane) {
            if (v.movement !== 'left' || !(v.d > 0 && v.d <= this.detectionZone)) continue;
            if (this.missed(v.d)) continue;
            left[COUNT_FIELD[v.cls]] += 1;
          }
        }
        this.controller.reportLeftCounts(a, makeCounts(left));
      }
      if (active) this.controller.reportBusCounts(a, makeCounts(whole(bus)));
    }
    this.snapshot = this.controller.tick();
    this.sampleQueues();
  }

  // Vehicles waiting on each approach right now: those stopped in the lanes, and those held back at the entry.
  queuedByApproach() {
    return this.lanes.map((lanes, a) => this.entry[a].length + lanes.reduce((n, lane) => n + lane.filter((v) => v.v < 1 && v.d > 0.5).length, 0));
  }

  queuedNow() { return this.queuedByApproach().reduce((a, b) => a + b, 0); }

  sampleQueues() {
    const queued = this.queuedByApproach();
    for (const q of queued) this.stats.queueMax = Math.max(this.stats.queueMax, q);
    this.stats.queueSum += queued.reduce((a, b) => a + b, 0);
    this.stats.queueSamples += 1;
  }

  // Results

  summary() {
    const s = this.stats;
    const mean = ([sum, n]) => (n > 0 ? sum / n : null);
    const hours = this.time / 3600;
    const inSystem = this.lanes.flat().reduce((n, lane) => n + lane.length, 0) + this.entry.reduce((n, q) => n + q.length, 0);
    return {
      seconds: this.time,
      arrived: { ...s.arrived },
      arrivedTotal: Object.values(s.arrived).reduce((a, b) => a + b, 0),
      crossed: s.crossed,
      exited: s.exited,
      laneChanges: s.laneChanges,
      inSystem,
      throughputPerHour: hours > 0 ? s.crossed / hours : 0,
      meanDelay: mean(s.delay.all),
      emergency: { crossed: s.emergency.n, redRuns: s.emergency.redRuns, meanWait: s.emergency.n > 0 ? s.emergency.sum / s.emergency.n : null, worstWait: s.emergency.n > 0 ? s.emergency.max : null, waits: [...s.emergency.waits] },
      meanDelayByClass: Object.fromEntries(Object.keys(CLASSES).map((k) => [k, mean(s.delay[k])])),
      stopsPerVehicle: s.crossed > 0 ? s.stops / s.crossed : null,
      redRuns: s.redRuns,
      boxConflictSteps: s.boxConflictSteps,
      meanQueue: s.queueSamples > 0 ? s.queueSum / s.queueSamples : 0,
      maxQueueOnOneApproach: s.queueMax,
      maxEntryBacklog: s.backlogMax,
      pedestrians: {
        arrived: s.ped.arrived, spawned: s.ped.spawned, crossed: s.ped.crossed, gaveUp: s.ped.gaveUp,
        meanWait: s.ped.started > 0 ? s.ped.waitSum / s.ped.started : null, maxWait: s.ped.waitMax,
      },
    };
  }
}
