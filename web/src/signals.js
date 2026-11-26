// The signal state machine. Port of traffic_controller/signals.py, which is the specification.
// One tick() is one second, so every run is deterministic and testable.
//
// Snapshot fields are snake_case so the shared JSON test vectors work unchanged in both languages.
// Read the Python module for the rules this machine guarantees. The shared vectors and the
// replayed random runs check that this port behaves identically.

import { WEEK_SECONDS, isActive } from './busLane.js';
import { crossingTimes, makeConfig } from './config.js';
import { ALL_MOVEMENTS, NUM_APPROACHES, buildPlan, compatible, opposite, shift } from './phases.js';
import { arrowGreenTime, busLaneGreenTime, greenTime, medianCounts, makeCounts, totalVehicles } from './timing.js';
import { isInt } from './checks.js';

export const GREEN = 'green';
export const YELLOW = 'yellow';
export const ALL_RED = 'all_red';
export const FLASH = 'flash';
export const FAULT = 'fault';
const RED = 'red';
const STOP = 'stop';
const WALK = 'walk';
const CLEAR = 'clear';
const FAULT_REASONS = ['manual', 'link', 'conflict'];
const EMERGENCY_MOVEMENTS = ['through', 'left', 'right'];
const MODES = ['adaptive', 'fixed'];
const MAX_VEHICLE_ID_LENGTH = 64;

function approachIndex(approach) {
  if (!isInt(approach) || approach < 1 || approach > NUM_APPROACHES) {
    throw new Error(`approach must be an int from 1 to ${NUM_APPROACHES}, got ${String(approach)}`);
  }
  return approach - 1;
}

function vehicleKey(vehicleId) {
  if (!(isInt(vehicleId) || typeof vehicleId === 'string')) throw new Error('vehicle id must be an int or a string');
  const key = String(vehicleId);
  if (key.length === 0 || key.length > MAX_VEHICLE_ID_LENGTH) {
    throw new Error(`vehicle id must be 1 to ${MAX_VEHICLE_ID_LENGTH} characters`);
  }
  return key;
}

const sum = (list) => list.reduce((a, b) => a + b, 0);

export class Controller {
  constructor({ config = null, plan = null, clockStartS = 0, powerOn = false } = {}) {
    if (!isInt(clockStartS) || clockStartS < 0 || clockStartS >= WEEK_SECONDS) {
      throw new Error('clockStartS must be an int from 0 to 604799');
    }
    this.clockStart = clockStartS;
    this.cfg = config || makeConfig();
    this.plan = plan ? [...plan] : buildPlan();
    if (this.plan.length < 2) throw new Error('a plan needs at least two phases');
    if (this.plan[0].kind !== 'T') throw new Error('a plan starts with a through phase');
    if (this.plan.filter((p) => p.kind === 'T').length < 2) throw new Error('a plan needs at least two through phases');
    this.time = 0;
    this.index = 0;
    this.next = 0;
    this.stage = GREEN;
    this.history = { T: [[], [], [], []], R: [[], [], [], []], B: [[], [], [], []], L: [[], [], [], []] };
    this.skips = this.plan.map(() => 0);
    this.latched = [false, false, false, false];
    this.served = [];
    this.elapsed = 0;
    this.held = false;
    this.period = 0;
    this.emergencies = new Map();
    this.cooling = new Map();
    this.cut = this.plan.map(() => false);
    this.followTime = 0; // seconds of this through green that the left arrow has been lit
    this.faulting = false; // a fault with fault_signal 'red' is running down: yellow, then all-red
    this.pedHold = [0, 0, 0, 0]; // seconds each pedestrian signal still flashes after such a fault, for people already crossing
    this.following = false; // left_follow is on for this period. Decided when the period opens, so the pedestrian signal never changes its schedule midway
    this.leftOpen = false;
    this.heldPeriod = false; // this green has been held for an emergency at some point
    this.timedOrigin = 0; // where the timed pedestrian schedule of a held green counts from, in seconds of green
    this.carries = false; // decided when the through yellow starts: the left arrow carries on into the arrow phase that follows
    this.clearOpen = false; // the shown left arrow (left_clear_arrow) has lit in this through phase
    this.clearCarries = false; // decided when the through yellow starts, as `carries` is, for the shown arrow
    this.owed = this.plan.map(() => false); // an arrow phase is owed the left window after a through phase that served pedestrians
    this.periodCut = false;
    this.periodEmergency = false;
    this.periodBus = false;
    this.extended = false;
    this.mode = 'adaptive';
    this.faultReason = null;
    this.recover = false;
    this.startup = false;
    this.startups = 0;
    this.remaining = this.plannedGreen(0);
    if (powerOn) this.beginStartup();
  }

  get snapshot() {
    return this.makeSnapshot();
  }

  // Advance one second and return the new state.
  tick() {
    this.time += 1;
    this.ageEmergencies();
    this.pedHold = this.pedHold.map((s) => Math.max(0, s - 1));
    if (this.faulting && this.stage === GREEN) {
      this.beginYellow(null);
      return this.makeSnapshot();
    }
    if (this.stage === FAULT) {
      if (this.recover) {
        this.recover = false;
        this.faultReason = null;
        this.beginStartup(this.cfg.fault_signal !== 'red'); // after an all-red fault there is nothing to flash: go through the all-red and start
      }
      return this.makeSnapshot();
    }
    if (this.stage === GREEN) {
      this.elapsed += 1;
      this.tickGreen();
      this.noteFollow();
      this.noteClear();
    } else {
      this.remaining -= 1;
      if (this.remaining <= 0) {
        if (this.stage === FLASH) this.endFlash();
        else if (this.stage === YELLOW) this.endYellow();
        else if (this.faulting) this.enterFault();
        else this.startGreen(this.next);
      }
    }
    return this.makeSnapshot();
  }

  fault(reason) {
    if (!FAULT_REASONS.includes(reason)) throw new Error(`reason must be one of ${FAULT_REASONS}, got ${String(reason)}`);
    if (this.stage === FAULT || this.faulting) return false;
    this.recover = false;
    if (this.cfg.fault_signal === 'red' && this.stage !== FLASH) {
      // Yellow, then all-red. A vehicle with a green gets its normal yellow, and a pedestrian already crossing keeps the flashing red man
      // for as long as the rest of the crossing takes. Nobody new is started.
      this.holdPedestrians();
      this.faultReason = reason;
      this.faulting = true;
      this.held = false;
      this.startup = false;
      return true; // the yellow starts on the next tick, as at the end of any green, so it is shown for its full time
    }
    this.faultReason = reason;
    this.enterFault();
    return true;
  }

  // How long each pedestrian signal that is on walk or flashing must keep flashing so that people already on the road can finish.
  holdPedestrians() {
    for (const n of this.served) {
      const state = this.pedestrianState(n);
      const [total] = this.crossing(n);
      let need = 0;
      if (state === WALK) need = total;
      else if (state === CLEAR) need = this.stage === GREEN ? Math.min(total, this.remaining + this.cfg.yellow) : this.stage === YELLOW ? this.remaining : 0;
      this.pedHold[n - 1] = Math.max(this.pedHold[n - 1], need);
    }
  }

  enterFault() {
    this.faulting = false;
    this.stage = FAULT;
    this.remaining = 1;
    this.startup = false;
    this.held = false;
    if (this.cfg.fault_signal !== 'red') this.served = [];
  }

  clearFault() {
    if (this.stage !== FAULT || this.recover) return false;
    this.recover = true;
    return true;
  }

  setMode(mode) {
    if (!MODES.includes(mode)) throw new Error(`mode must be one of ${MODES}, got ${String(mode)}`);
    this.mode = mode;
  }

  reportCounts(approach, counts) {
    this.record('T', approach, counts);
  }

  reportRightCounts(approach, counts) {
    this.record('R', approach, counts);
  }

  // The latest count of vehicles waiting to turn left from an approach. Needs a detector that can tell them from vehicles going
  // straight on. With left_arrow on, an approach with no fresh left count is unknown, so its arrow phase is never skipped.
  reportLeftCounts(approach, counts) {
    this.record('L', approach, counts);
  }

  reportBusCounts(approach, counts) {
    this.record('B', approach, counts);
  }

  record(group, approach, counts) {
    const index = approachIndex(approach);
    if (counts !== null && !(counts && typeof counts === 'object' && Object.isFrozen(counts) && 'cars' in counts)) {
      throw new Error('counts must be made with makeCounts, or null');
    }
    if (counts === null) {
      this.history[group][index] = [];
      return;
    }
    const reports = this.history[group][index];
    reports.push([counts, this.time]);
    while (reports.length > this.cfg.smoothing_frames) reports.shift();
  }

  requestCrossing(crossing) {
    const index = approachIndex(crossing);
    if (this.latched[index]) return false;
    this.latched[index] = true;
    return true;
  }

  // movement is what the vehicle will do: 'through' and 'left' are served by the through phase of the approach, 'right' by the right-turn arrow
  // phase, because a right turn crosses the opposing through traffic.
  pause(vehicleId, approach, movement = 'through') {
    const key = vehicleKey(vehicleId);
    const index = approachIndex(approach);
    if (!EMERGENCY_MOVEMENTS.includes(movement)) throw new Error(`movement must be one of ${EMERGENCY_MOVEMENTS}, got ${String(movement)}`);
    const kind = movement === 'right' ? 'R' : 'T';
    if (this.emergencies.has(key)) {
      const entry = this.emergencies.get(key);
      entry[0] = index;
      entry[2] = kind;
      return false;
    }
    if (this.cooling.has(key)) return false;
    if (this.emergencies.size >= this.cfg.max_emergencies) throw new Error('too many active emergency requests');
    this.emergencies.set(key, [index, 0, kind]);
    return true;
  }

  resume(vehicleId) {
    const key = vehicleKey(vehicleId);
    this.cooling.delete(key);
    return this.emergencies.delete(key);
  }

  // Demand

  fresh(group, approach) {
    if (this.mode === 'fixed') return null;
    const reports = this.history[group][approach - 1]
      .filter(([, t]) => this.time - t <= this.cfg.count_ttl).map(([c]) => c);
    return reports.length ? medianCounts(reports) : null;
  }

  plannedGreen(index) {
    const phase = this.plan[index];
    const arrow = phase.kind === 'R';
    const fallback = arrow ? Math.min(this.cfg.default_green, this.cfg.max_arrow_green) : this.cfg.default_green;
    const active = !arrow && this.busActive();
    const lanes = active ? Math.max(1, this.cfg.lanes_per_approach - 1) : this.cfg.lanes_per_approach;
    const needs = [];
    for (const approach of phase.approaches()) {
      const counts = arrow ? this.arrowCounts(approach) : this.fresh(phase.kind, approach);
      let need;
      if (counts === null) need = fallback;
      else need = arrow ? arrowGreenTime(counts, this.cfg) : greenTime(counts, this.cfg, lanes);
      if (active) {
        const bus = this.fresh('B', approach);
        need = Math.max(need, bus === null ? fallback : busLaneGreenTime(bus, this.cfg));
      }
      needs.push(need);
    }
    const green = needs.length ? Math.max(...needs) : fallback;
    return arrow && this.owed[index] ? Math.max(green, this.cfg.left_window) : green;
  }

  // What an arrow phase has to clear on one approach: its right turners and, with the left arrow, the left turners of the approach
  // before it, who use this phase. null if either is unknown.
  arrowCounts(approach) {
    const right = this.fresh('R', approach);
    if (!this.cfg.left_arrow || this.cfg.left_window > 0 || right === null) return right;
    const left = this.fresh('L', shift(approach, -1));
    if (left === null) return null;
    return makeCounts({ bikes: right.bikes + left.bikes, buses: right.buses + left.buses, cars: right.cars + left.cars, trucks: right.trucks + left.trucks });
  }

  busActive() {
    return isActive(this.cfg.bus_lane_windows, this.clockStart + this.time);
  }

  busWaiting(index) {
    if (!this.busActive() || this.plan[index].kind !== 'T') return false;
    return this.plan[index].approaches().some((a) => {
      const bus = this.fresh('B', a);
      return bus !== null && bus.buses > 0;
    });
  }

  crossingsFor(index) {
    const movements = [...this.plan[index].movements];
    return [1, 2, 3, 4].filter((n) => movements.every((m) => compatible(`C${n}`, m)));
  }

  // true if a pedestrian or any vehicle is known to wait, null if an approach is unknown, else false
  demand(index) {
    if (this.crossingsFor(index).some((n) => this.latched[n - 1])) return true;
    if (this.owed[index]) return true;
    let unknown = false;
    const phase = this.plan[index];
    const groups = phase.kind === 'T' && this.busActive() ? [phase.kind, 'B'] : [phase.kind];
    for (const approach of phase.approaches()) {
      for (const group of groups) {
        const counts = group === 'R' ? this.arrowCounts(approach) : this.fresh(group, approach);
        if (counts === null) unknown = true;
        else if (totalVehicles(counts) > 0) return true;
      }
    }
    return unknown ? null : false;
  }

  // Emergencies

  target() {
    for (const [approach] of this.emergencies.values()) return approach;
    return null;
  }

  targetPhase() {
    const target = this.target();
    if (target === null) return null;
    const kind = this.emergencies.values().next().value[2];
    const own = this.plan.findIndex((phase) => phase.movements.has(`${kind}${target + 1}`));
    return own >= 0 ? own : this.plan.findIndex((phase) => phase.movements.has(`T${target + 1}`)); // a plan with no arrow phase serves a right turn in the through phase
  }

  ageEmergencies() {
    for (const key of [...this.cooling.keys()]) {
      this.cooling.set(key, this.cooling.get(key) + 1);
      if (this.cooling.get(key) >= this.cfg.emergency_timeout) this.cooling.delete(key);
    }
    for (const key of [...this.emergencies.keys()]) {
      const entry = this.emergencies.get(key);
      entry[1] += 1;
      if (entry[1] >= this.cfg.emergency_timeout) {
        this.emergencies.delete(key);
        this.cooling.set(key, 0);
      }
    }
  }

  servedClearance1Max() {
    return this.served.length ? Math.max(...this.served.map((n) => this.crossing(n)[1] + this.cfg.turn_hold)) : 0;
  }

  tickGreen() {
    const target = this.targetPhase();
    if (target !== null) this.periodEmergency = true;
    if (target === this.index) {
      this.held = true;
      // The timed schedule starts a walk time before now, so a man that is on walk when the hold begins goes to flashing, never straight to solid red.
      if (!this.heldPeriod) this.timedOrigin = Math.max(0, this.elapsed - this.cfg.walk_min);
      this.heldPeriod = true;
      return;
    }
    if (target !== null && this.elapsed >= this.cfg.min_green) {
      this.remaining = Math.min(this.remaining, this.servedClearance1Max() + 1) - 1;
      if (this.remaining <= 0) this.beginYellow(null);
      return;
    }
    if (this.held) {
      this.held = false;
      if (this.served.length === 0) this.remaining = Math.min(this.remaining, this.cfg.min_green);
      return;
    }
    if (this.earlyGreenDue()) {
      const natural = this.remaining - 1;
      this.remaining = Math.min(this.remaining, this.servedClearance1Max() + 1) - 1;
      if (this.remaining < natural) {
        this.periodCut = true;
        this.periodBus = true;
      }
    } else {
      this.remaining -= 1;
    }
    if (this.remaining <= 0) this.endGreen();
  }

  mayRest() {
    return this.served.length === 0 && this.plan[this.index].kind === 'T';
  }

  markCut() {
    if (!this.periodEmergency) this.cut[this.index] = this.periodCut;
  }

  earlyGreenDue() {
    const cfg = this.cfg;
    if (!(cfg.bus_early_green && this.busActive() && !this.cut[this.index])) return false;
    if (this.elapsed < cfg.min_green || (this.served.length > 0 && this.elapsed < cfg.walk_min)) return false;
    if (this.busWaiting(this.index)) return false;
    const [upcoming] = this.selectNext(this.mayRest());
    return upcoming !== this.index && this.busWaiting(upcoming);
  }

  extensionDue() {
    const cfg = this.cfg;
    return cfg.bus_extension > 0 && !this.extended && this.served.length === 0
      && cfg.max_green - this.elapsed >= 1 && this.busWaiting(this.index);
  }

  // Stage changes

  beginStartup(flash = true) {
    this.startups += 1;
    this.served = [];
    this.held = false;
    this.elapsed = 0;
    this.periodCut = false;
    this.periodBus = false;
    this.extended = false;
    this.periodEmergency = false;
    this.skips = this.plan.map(() => 0);
    this.cut = this.plan.map(() => false);
    this.owed = this.plan.map(() => false);
    this.leftOpen = false;
    this.carries = false;
    this.clearOpen = this.clearCarries = false;
    this.following = false;
    this.followTime = 0;
    this.index = 0;
    this.next = 0;
    this.startup = true;
    if (flash && this.cfg.startup_flash > 0) {
      this.stage = FLASH;
      this.remaining = this.cfg.startup_flash;
    } else {
      this.endFlash();
    }
  }

  endFlash() {
    if (this.cfg.all_red > 0) {
      this.stage = ALL_RED;
      this.remaining = this.cfg.all_red;
    } else {
      this.startGreen(0);
    }
  }

  endGreen() {
    if (this.extensionDue()) {
      this.remaining = Math.min(this.cfg.bus_extension, this.cfg.max_green - this.elapsed);
      this.extended = true;
      this.periodBus = true;
      return;
    }
    const chosen = this.chooseNext(this.mayRest());
    if (chosen === this.index) {
      this.markCut();
      this.openPeriod(this.index);
      return;
    }
    this.beginYellow(chosen);
  }

  beginYellow(nextPhase) {
    this.markCut();
    // The left arrow carries on into the arrow phase after this one, unless an emergency has to be served first. An emergency is never made
    // to wait for it. If one arrives after the arrow was shown carrying on, the arrow turns yellow for the rest of the yellow and the all-red.
    this.carries = this.following && this.leftOpen && this.plan[this.index].kind === 'T'
      && nextPhase !== null && this.plan[nextPhase].kind === 'R' && this.targetPhase() === null;
    this.clearCarries = this.cfg.left_clear_arrow && this.clearOpen && this.plan[this.index].kind === 'T'
      && nextPhase !== null && this.plan[nextPhase].kind === 'R' && this.targetPhase() === null;
    this.next = nextPhase;
    this.stage = YELLOW;
    this.remaining = this.cfg.yellow;
    this.held = false;
  }

  // The next phase in cycle order that has demand, and the empty phases skipped to reach it.
  selectNext(mayRest) {
    const count = this.plan.length;
    const skipped = [];
    for (let step = 1; step < count; step += 1) {
      const candidate = (this.index + step) % count;
      if (this.demand(candidate) === false && this.skips[candidate] < this.cfg.max_skips) {
        skipped.push(candidate);
        continue;
      }
      return [candidate, skipped];
    }
    if (mayRest) return [this.index, skipped];
    for (let step = 1; step < count; step += 1) {
      const candidate = (this.index + step) % count;
      if (this.plan[candidate].kind === 'T') return [candidate, skipped];
    }
    throw new Error('a plan needs two through phases');
  }

  chooseNext(mayRest) {
    const [chosen, skipped] = this.selectNext(mayRest);
    for (const candidate of skipped) this.skips[candidate] += 1;
    if (chosen !== this.index) this.skips[chosen] = 0;
    return chosen;
  }

  endYellow() {
    if (this.faulting && this.cfg.all_red <= 0) {
      this.enterFault();
      return;
    }
    if (this.cfg.all_red > 0) {
      this.stage = ALL_RED;
      this.remaining = this.cfg.all_red;
    } else {
      this.startGreen(this.next);
    }
  }

  startGreen(index) {
    const target = this.targetPhase();
    let chosen = index;
    if (target !== null) chosen = target;
    else if (index === null) chosen = this.chooseNext(false);
    this.index = chosen;
    this.stage = GREEN;
    this.startup = false;
    this.openPeriod(chosen, target !== null);
  }

  openPeriod(index, emergency = false) {
    this.period += 1;
    this.elapsed = 0;
    this.held = false;
    this.periodCut = false;
    this.periodBus = false;
    this.extended = false;
    this.periodEmergency = emergency;
    const served = emergency ? [] : this.crossingsFor(index).filter((n) => this.latched[n - 1]);
    for (const n of served) this.latched[n - 1] = false;
    this.served = served;
    let need = 0;
    for (const n of served) need = Math.max(need, this.cfg.walk_min + this.crossing(n)[1] + this.cfg.turn_hold);
    this.remaining = Math.max(this.plannedGreen(index), need);
    this.owed[index] = false;
    this.leftOpen = false;
    this.heldPeriod = false;
    this.timedOrigin = 0;
    this.carries = false;
    this.clearOpen = this.clearCarries = false;
    this.followTime = 0;
    this.following = this.followScheduled();
    this.updateOwed(index);
  }

  // The arrow phase after a through phase is owed the left window when that through phase served pedestrians, unless the left arrow already ran
  // that long inside the through green.
  updateOwed(index) {
    const after = (index + 1) % this.plan.length;
    if (this.cfg.left_window > 0 && this.plan[index].kind === 'T' && this.plan[after].kind === 'R') {
      this.owed[after] = this.served.length > 0 && !(this.following && this.followTime >= this.cfg.left_window);
    }
  }

  // With left_follow, the left arrow of a through phase is lit once every crossing it served has its man solid red.
  followScheduled() {
    const cfg = this.cfg;
    if (!(cfg.left_follow && cfg.left_arrow)) return false;
    return cfg.left_follow_windows.length === 0 || isActive(cfg.left_follow_windows, this.clockStart + this.time);
  }

  followLit() {
    return this.following && this.stage === GREEN && this.plan[this.index].kind === 'T'
      && this.served.length > 0 && this.served.every((n) => this.pedestrianState(n) === STOP);
  }

  noteFollow() {
    if (this.stage !== GREEN || !this.followLit()) return;
    this.leftOpen = true;
    this.followTime += 1;
    this.updateOwed(this.index);
  }

  // The shown left arrow (left_clear_arrow) lights in a through phase that served pedestrians as soon as nobody is on walk, that is when the flashing red man starts, and stays latched for the rest of the phase.
  clearLit() {
    return this.stage === GREEN && this.plan[this.index].kind === 'T' && this.served.length > 0 && this.served.every((n) => this.pedestrianState(n) !== WALK);
  }

  noteClear() {
    if (this.cfg.left_clear_arrow && !this.clearOpen && this.clearLit()) this.clearOpen = true;
  }

  // What the left arrows show. The same as `arrows()` except in a through phase that served pedestrians: from the flashing red man the arrow is green, it turns yellow with the through yellow unless it carries on
  // into the arrow phase after this one (the arrow then stays green through the yellow and the all-red and the arrow phase takes over), and it is red in the all-red when it does not carry. Nothing reads this
  // but the page's signals, so vehicles and timings are exactly what `arrows()` gives.
  shownArrows() {
    const base = this.arrows();
    if (!this.cfg.left_clear_arrow || this.stage === FLASH || this.stage === FAULT) return base;
    const phase = this.plan[this.index];
    if (phase.kind !== 'T' || !this.clearOpen) return base;
    let state = RED;
    if (this.stage === GREEN) state = GREEN;
    else if (this.stage === YELLOW) state = this.clearCarries && this.targetPhase() === null ? GREEN : YELLOW;
    else if (this.stage === ALL_RED) state = this.clearCarries ? (this.targetPhase() === null ? GREEN : YELLOW) : RED;
    if (state === RED) return base;
    const ours = phase.approaches();
    return [1, 2, 3, 4].map((n) => (ours.includes(n) ? state : base[n - 1]));
  }

  crossing(n) {
    return crossingTimes(this.cfg.crossing_widths_cm[n - 1], this.cfg.walking_speed_cm_s, this.cfg.yellow);
  }

  pedestrianState(n) {
    if (this.faultReason !== null && this.cfg.fault_signal === 'red') return this.pedHold[n - 1] > 0 ? CLEAR : STOP;
    if (!this.served.includes(n)) return STOP;
    const hold = this.cfg.turn_hold;
    const [total, clearance1] = this.crossing(n);
    // With left_follow, and in a green that is held for an emergency, the pedestrian time runs from the start of the green and ends with the
    // crossing time. A held green has no countdown to go by, and without this the walk would stay on for as long as the hold lasts.
    const timed = this.following || (this.heldPeriod && this.cfg.hold_walk_timed); // for the rest of a green once it has been held
    const age = this.following ? this.elapsed : this.elapsed - this.timedOrigin;
    const done = timed && age >= this.cfg.walk_min + total; // the last starter has crossed
    if (this.stage === YELLOW) return hold > 0 || done ? STOP : CLEAR;
    if (this.stage === ALL_RED) return STOP;
    if (this.remaining <= hold || done) return STOP; // option two: the last seconds of green are for turners, with the man solid red
    const walking = this.remaining - hold > clearance1 && !(timed && age >= this.cfg.walk_min);
    return walking ? WALK : CLEAR;
  }

  // The left arrows. Each is lit with an arrow phase of the other pair of approaches, when the crossings are all red.
  arrows() {
    if (this.stage === FLASH || (this.stage === FAULT && this.cfg.fault_signal === 'flash')) return [FLASH, FLASH, FLASH, FLASH];
    if (this.stage === FAULT) return [RED, RED, RED, RED];
    const phase = this.plan[this.index];
    if (this.following && phase.kind === 'T' && this.leftOpen) {
      // The arrow carries on into the arrow phase after this one. Otherwise it ends the way every green ends, with a yellow, so a left turner
      // that cannot stop before the line is warned.
      let state = RED;
      if (this.stage === GREEN) state = this.followLit() ? GREEN : RED;
      else if (this.stage === YELLOW) state = this.carries && this.targetPhase() === null ? GREEN : YELLOW;
      else if (this.stage === ALL_RED) state = this.carries ? (this.targetPhase() === null ? GREEN : YELLOW) : RED;
      const ours = phase.approaches();
      if (state !== RED) return [1, 2, 3, 4].map((n) => (ours.includes(n) ? state : RED));
    }
    if (!this.cfg.left_arrow || phase.kind !== 'R' || !(this.stage === GREEN || this.stage === YELLOW)) return [RED, RED, RED, RED];
    const served = [...phase.movements].map((m) => Number(m[1]));
    return [1, 2, 3, 4].map((n) => (served.includes(opposite(n)) ? RED : this.stage));
  }

  makeSnapshot() {
    const phase = this.plan[this.index];
    const target = this.target();
    const lit = this.stage === GREEN || this.stage === YELLOW ? this.stage : RED;
    const flashing = this.stage === FLASH || (this.stage === FAULT && this.cfg.fault_signal === 'flash');
    const signals = {};
    for (const m of ALL_MOVEMENTS) {
      if (m[0] === 'C') signals[m] = this.pedestrianState(Number(m[1]));
      else signals[m] = flashing ? FLASH : phase.movements.has(m) ? lit : RED;
    }
    return {
      time: this.time,
      phase: this.startup || this.stage === FAULT ? '' : phase.name,
      stage: this.stage,
      remaining: this.remaining,
      signals,
      heads: [1, 2, 3, 4].map((n) => signals[`T${n}`]),
      pedestrian_requests: [1, 2, 3, 4].filter((n) => this.latched[n - 1]),
      period: this.period,
      emergency_approach: target === null ? null : target + 1,
      holding: this.stage === GREEN && this.targetPhase() === this.index,
      bus_lane_active: this.busActive(),
      bus_priority: this.periodBus,
      mode: this.mode,
      fault: this.faultReason,
      startups: this.startups,
      arrows: this.arrows(),
      shown_arrows: this.shownArrows(),
    };
  }
}

export { makeCounts, sum };
