// All tunable numbers in one place, validated once. Port of traffic_controller/config.py.
// Keys are snake_case so the shared JSON test vectors work unchanged in both languages.

import { checkWindow } from './busLane.js';
import { checkInt, ceilDiv, isInt } from './checks.js';

export const DEFAULTS = Object.freeze({
  default_green: 10,
  yellow: 4,
  all_red: 2,
  min_green: 5,
  max_green: 60,
  lanes_per_approach: 2,
  bike_time: 2,
  bus_time: 6,
  car_time: 4,
  truck_time: 6,
  walk_min: 6,
  walking_speed_cm_s: 120,
  crossing_widths_cm: [1280, 1280, 1280, 1280],
  max_arrow_green: 15,
  smoothing_frames: 3,
  emergency_timeout: 60,
  max_emergencies: 16,
  bus_lane_windows: [[0, 4, 420, 540], [0, 4, 960, 1080]],
  bus_extension: 5,
  bus_early_green: true,
  startup_flash: 5,
  max_skips: 2,
  count_ttl: 10,
  left_arrow: true, // left turners also go on a left arrow in the arrow phase of the other pair, and a waiting one asks for that phase
  left_window: 0, // seconds of arrow phase owed to left turners after a through phase that served pedestrians. No left count is used. 0 is off.
  hold_walk_timed: false, // in a green held for an emergency, the pedestrian walk and flashing run from the start of the green and end in a solid red man, instead of following the frozen countdown.
  fault_signal: 'flash', // what a fault shows: 'flash' (all-way stop) or 'red' (every vehicle signal red, every pedestrian signal solid red).
  left_follow_windows: [[0, 4, 420, 540], [0, 4, 960, 1080]], // when left_follow is on it applies only inside these windows (same form as the bus lane). An empty list means always.
  left_clear_arrow: false, // DISPLAY ONLY. The left arrow shown for a through phase that served pedestrians starts with the flashing red man and carries on through the yellow and the all-red into the arrow phase, so a left turner who clears the junction then has an arrow. Vehicles, pedestrians and timings do not read it (`shown_arrows` in the snapshot, not `arrows`).
  left_follow: false, // the pedestrian signal ends when the crossing time ends, not with the green, and the left arrow then stays green until the next arrow phase ends.
  turn_hold: 0, // seconds of green kept after the pedestrians' flashing red man ends, for turning vehicles. 0 is off.
});

// Pedestrian clearance for one crossing, in whole seconds: [total, clearance 1].
// Total is the width over the walking speed, rounded up. Clearance 2 is the vehicle yellow,
// so clearance 1, the flashing that runs in green, is what is left.
export function crossingTimes(widthCm, speedCmS, yellow) {
  const total = ceilDiv(widthCm, speedCmS);
  return [total, Math.max(0, total - yellow)];
}

export function makeConfig(overrides = {}) {
  for (const key of Object.keys(overrides)) {
    if (!(key in DEFAULTS)) throw new Error(`unknown config key ${key}`);
  }
  const cfg = {
    ...DEFAULTS,
    crossing_widths_cm: [...DEFAULTS.crossing_widths_cm],
    bus_lane_windows: DEFAULTS.bus_lane_windows.map((w) => [...w]),
    left_follow_windows: DEFAULTS.left_follow_windows.map((w) => [...w]),
    ...overrides,
  };
  checkInt('default_green', cfg.default_green, 1);
  checkInt('yellow', cfg.yellow, 1);
  checkInt('all_red', cfg.all_red, 0);
  checkInt('min_green', cfg.min_green, 1);
  checkInt('max_green', cfg.max_green, 1);
  checkInt('lanes_per_approach', cfg.lanes_per_approach, 1);
  checkInt('bike_time', cfg.bike_time, 1);
  checkInt('bus_time', cfg.bus_time, 1);
  checkInt('car_time', cfg.car_time, 1);
  checkInt('truck_time', cfg.truck_time, 1);
  checkInt('max_skips', cfg.max_skips, 0);
  checkInt('count_ttl', cfg.count_ttl, 1);
  if (!Array.isArray(cfg.bus_lane_windows)) throw new Error('bus_lane_windows must be a list of windows');
  cfg.bus_lane_windows.forEach(checkWindow);
  if (typeof cfg.hold_walk_timed !== 'boolean') throw new Error('hold_walk_timed must be a bool');
  if (!['flash', 'red'].includes(cfg.fault_signal)) throw new Error("fault_signal must be 'flash' or 'red'");
  if (!Array.isArray(cfg.left_follow_windows)) throw new Error('left_follow_windows must be a list of windows');
  cfg.left_follow_windows.forEach(checkWindow);
  checkInt('bus_extension', cfg.bus_extension, 0);
  if (typeof cfg.bus_early_green !== 'boolean') throw new Error('bus_early_green must be a bool');
  if (typeof cfg.left_arrow !== 'boolean') throw new Error('left_arrow must be a bool');
  checkInt('startup_flash', cfg.startup_flash, 0);
  checkInt('emergency_timeout', cfg.emergency_timeout, 1);
  checkInt('max_emergencies', cfg.max_emergencies, 1);
  checkInt('max_arrow_green', cfg.max_arrow_green, 1);
  checkInt('smoothing_frames', cfg.smoothing_frames, 1);
  checkInt('walk_min', cfg.walk_min, 1);
  checkInt('walking_speed_cm_s', cfg.walking_speed_cm_s, 1);
  checkInt('turn_hold', cfg.turn_hold, 0);
  checkInt('left_window', cfg.left_window, 0);
  if (typeof cfg.left_follow !== 'boolean') throw new Error('left_follow must be a bool');
  if (typeof cfg.left_clear_arrow !== 'boolean') throw new Error('left_clear_arrow must be a bool');
  if (!Array.isArray(cfg.crossing_widths_cm) || cfg.crossing_widths_cm.length !== 4) {
    throw new Error('crossing_widths_cm must be a list of 4 widths');
  }
  cfg.crossing_widths_cm.forEach((w) => checkInt('crossing width', w, 1));
  if (cfg.max_green < cfg.min_green) throw new Error('max_green must be at least min_green');
  if (cfg.max_arrow_green < cfg.min_green) throw new Error('max_arrow_green must be at least min_green');
  if (!(cfg.min_green <= cfg.default_green && cfg.default_green <= cfg.max_green)) {
    throw new Error('default_green must lie between min_green and max_green');
  }
  for (const width of cfg.crossing_widths_cm) {
    const [, clearance1] = crossingTimes(width, cfg.walking_speed_cm_s, cfg.yellow);
    if (cfg.walk_min + clearance1 + cfg.turn_hold > cfg.max_green) throw new Error('a crossing needs more green than max_green allows');
  }
  void isInt;
  return Object.freeze(cfg);
}
