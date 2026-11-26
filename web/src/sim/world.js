// The physical world of the simulator: geometry, vehicle classes and car-following parameters.
// All lengths are metres, speeds metres per second, times seconds. Real scale, 60 km/h road.

export const APPROACH_LENGTH = 200; // from where vehicles appear to the stop line
export const DETECTION_ZONE = 60; // the camera sees this far back from the stop line

// Where the cameras are and what they can see, from tools/rigsearch.mjs. Each approach has two cameras on the faces of low buildings along the road, 10 m up, one about 20 m and
// one about 60 m from the stop line, looking across the road with a 130 degree lens at 4K. A camera that looks along the road loses a car behind a truck, and from the side nothing
// hides the vehicles behind it. The zone is 80 m. A longer one gains nothing, and 60 m or less loses to the fixed plan at the rush (tools/zone.mjs). In the morning rush the
// rig picks out 95% or more of the vehicles in every 20 m of the zone. `detectionCurve` is the share for each 20 m, set a little under the measured. Where there is no building, an
// existing lamp pole or a new pole takes the camera (docs/simulation.md). It is geometry only: a vehicle counts when it is at least 30 pixels wide, in frame and less than 60%
// hidden. Night, rain, glare, the distortion of a lens that wide and the detector's own misses are not in it. A long vehicle counts for the lane it takes up.
// Roof height of each class in metres, for what a camera sees of it.
export const VEHICLE_HEIGHT = { car: 1.5, van: 2.1, truck: 3.2, bus: 3.1, semi: 3.9, artbus: 3.1, bike: 1.5, scooter: 1.4, amb: 2.4, fire: 3.2, police: 1.5 };
export const CAMERA_RIG = {
  detectionZone: 80,
  detectionCurve: [[20, 0.97], [40, 0.94], [60, 0.98], [80, 0.94]],
  lengthCounts: true,
};
export const GEOFENCE = 120; // an ambulance asks for priority this far from the stop line
export const LANE_COUNT = 3; // 0 kerb (bus lane when active), 1 through, 2 right turn
export const KERB = 0;
export const THROUGH = 1;
export const RIGHT = 2;
// Stop line to the end of the turn, at most, in metres. The turns are worked out in tracks.js.
export const BOX_PATH = { through: 24, left: 16, right: 31 };
export const EXIT_RUN = 60; // a vehicle stays in the simulation this far past the box. The page asks for 640, out to where it is out of sight.
export const TURN_SPEED = 6;
export const MIN_SPAWN_GAP = 6;

// Car-following (intelligent driver model) per class. v0 desired speed, a max acceleration,
// b comfortable braking, T time headway, s0 standstill gap.
// The car values are calibrated so a queue discharges at a 2.1 s headway per lane, about 1700
// vehicles an hour, the saturation flow in the worked example of Queensland RPDM chapter 18
// section 18.16.3.6 (see docs/timing-sources.md). The other classes are scaled from the car.
export const CLASSES = {
  car: { length: 4.5, width: 1.9, v0: 16.7, a: 2.0, b: 2.5, T: 1.0, s0: 1.8 },
  truck: { length: 8, width: 2.5, v0: 15, a: 1.2, b: 2.0, T: 1.3, s0: 2.2 },
  bus: { length: 12, width: 2.6, v0: 14, a: 1.2, b: 2.0, T: 1.3, s0: 2.2 },
  bike: { length: 2, width: 0.8, v0: 15, a: 2.5, b: 3.0, T: 1.0, s0: 1.4 },
  amb: { length: 5.6, width: 2.1, v0: 18, a: 2.5, b: 3.0, T: 1.0, s0: 1.8 },
  // The rest are for the page's day. Their sizes and paces are plausible, not measured. The controller counts every class as one of four.
  van: { length: 5.3, width: 2.0, v0: 16, a: 1.8, b: 2.4, T: 1.1, s0: 2.0 },
  semi: { length: 16.5, width: 2.5, v0: 14, a: 0.9, b: 1.8, T: 1.4, s0: 2.5 }, // a prime mover with a trailer
  artbus: { length: 17.5, width: 2.6, v0: 14, a: 1.0, b: 2.0, T: 1.3, s0: 2.4 }, // an articulated bus
  scooter: { length: 1.8, width: 0.7, v0: 12, a: 1.8, b: 2.8, T: 1.0, s0: 1.3 },
  fire: { length: 9.5, width: 2.5, v0: 16, a: 1.2, b: 2.5, T: 1.2, s0: 2.2 }, // a fire engine: long, slow to pick up speed
  police: { length: 4.8, width: 1.9, v0: 20, a: 2.8, b: 3.0, T: 1.0, s0: 1.8 },
};
// Emergency vehicles ask for priority and are dodged around. Buses use the bus lane. Slow small vehicles keep to the kerb lane.
export const EMERGENCY = new Set(['amb', 'fire', 'police']);
export const isEmergency = (cls) => EMERGENCY.has(cls);
export const isBus = (cls) => cls === 'bus' || cls === 'artbus';
export const KERB_ONLY = new Set(['bike', 'scooter']);
// Too long to turn at this junction: the tail would swing across the next lane at the turn radius it has. They go straight on.
export const NO_TURN = new Set(['semi', 'artbus']);
// What the controller's counts see each class as: cars, trucks, buses or bikes.
export const COUNT_FIELD = { car: 'cars', van: 'cars', police: 'cars', amb: 'cars', truck: 'trucks', semi: 'trucks', fire: 'trucks', bus: 'buses', artbus: 'buses', bike: 'bikes', scooter: 'bikes' };

// Per-vehicle clearance times for the controller at real scale. A car clears a queue at about
// 2.1 s a vehicle, and the times here are 1.5 times that kind of figure (car 3, bike 2, bus 5, truck 5)
// because a queue also loses time when it starts. At the plain discharge times (2, 1, 3, 3) the
// green was too short for a long queue and adaptive lost to fixed timing at peak.
export const SIM_CONTROLLER_CONFIG = {
  car_time: 3, bike_time: 2, bus_time: 5, truck_time: 5, // 1.5 times the steady discharge time, chosen on tuning seeds 101 to 104, see docs/simulation.md
  crossing_widths_cm: [1920, 1920, 1920, 1920], // the same width the pedestrians walk
  left_window: 6, // a fixed 6 s arrow window after a through phase that served pedestrians, so no left count is needed. Chosen on seeds 101 to 104, confirmed on 201 to 210
  hold_walk_timed: true, // a held green does not leave the man on walk for the whole hold, which would stop the left turners and the ambulance behind them
  max_green: 40, // the simulated junction caps a green at 40 s, not the controller's 60. In the morning and evening rush the best fixed green is 40 to 50 s and 60 s is clearly worse, and a 40 s cap took 2 to 3 s off the rush delay with no change at midday (tools/cap, 8 seeds, docs/simulation.md)
  fault_signal: 'red', // a fault stops everything: every vehicle signal red and every pedestrian signal solid red
  left_clear_arrow: true, // the left arrow shows green from the flashing red man and carries on, so a turner who clears the junction has an arrow (display only)
  left_follow: true, // inside the weekday peak windows only (the default left_follow_windows): vehicle delay down about 9% at peak, pedestrian wait up about 10 s
};

export const DEFAULT_MIX = { car: 0.76, truck: 0.06, bus: 0.04, bike: 0.14 };
export const DEFAULT_TURNS = { through: 0.7, left: 0.15, right: 0.15 };
export const CROSSING_WIDTH_M = 19.2; // kerb to kerb across three lanes each way. The controller times the crossing on this.
export const CROSSING_PATH_M = 28; // the whole walk: 4.4 m from where they wait to the road, the road, and 4.4 m to where they wait on the far side
export const PEDESTRIAN_WALK_M = 100; // pedestrians walk in from, and out to, this far along the footpath. The page asks for 560, out of sight.

// Side streets. A third of the vehicles that start in the kerb lane come in from a side street on the kerb side and turn
// left onto the road. The page draws that. For the simulation it only sets where the approach starts, so the vehicle
// is otherwise ordinary and cannot change lane until it is on the main road.
export const SIDE_STREET_SPACING = 120; // along the road, from the junction
export const SIDE_STREET_COUNT = 6;
export const SIDE_STREET_TURN_RADIUS = 7;
export const STOP_LINE_M = 14.4; // from the middle of the junction to the stop line
export function sideStreetFor(id, lane, cls) {
  if (lane !== KERB || isEmergency(cls)) return 0;
  const h = Math.imul(id, 2654435761) >>> 0;
  return h % 3 === 0 ? 1 + (h >>> 8) % (SIDE_STREET_COUNT - 1) : 0; // the last street is too near where vehicles start
}
// Two in five of the vehicles that go straight on in the kerb lane turn left into a side street on the way out.
export function exitStreetFor(id, lane, movement, cls) {
  if (lane !== KERB || movement !== 'through' || isEmergency(cls)) return 0;
  const h = Math.imul(id, 2246822519) >>> 0;
  return h % 5 < 2 ? 1 + (h >>> 8) % SIDE_STREET_COUNT : 0; // two in five
}

// The distance from the stop line at which the turn from side street number via ends and the vehicle is on the main road.
export function joinDistance(via) {
  return via * SIDE_STREET_SPACING - STOP_LINE_M - 2 - SIDE_STREET_TURN_RADIUS;
}

// Lane changes. A vehicle held up by a slower one in free flow moves over when there is room.
export const LANE_CHANGE = {
  minD: 45, // not within this distance of the stop line, where the queue is
  lookAhead: 25, // the slower vehicle is closer than this
  slower: 1.5, // and slower than the wanted speed by this much, in m/s
  cooldown: 10, // seconds before the same vehicle may change again
  clearBehindOld: 10, // metres kept free behind it in the lane it leaves, because the move takes a moment
  turnerGap: 40, // a vehicle this close behind a stopped left turner may move to the through lane, as drivers do well before the head of the queue
  minSpeed: 0, // m/s. The slowest a vehicle may be to move over. 0 lets a standing queue go round a stopped left turner. A requirement of 2 stopped that and cost 20 s of delay at peak
  signal: 2, // seconds the indicator is on before it moves over
  seconds: 2.5, // how long the sideways move takes
};

// Pedestrians. They walk in single file along a line of the crossing, in one of four lanes, keeping left. Some have a
// companion in line with them: a dog on a lead behind, a child behind, or a pram ahead.
export const PEDESTRIAN_LANES = 2; // per direction. Two lanes each way is what fits on a footpath between the street trees and the lamps
export function pedestrianLane(id) {
  return id % PEDESTRIAN_LANES;
}
// How far a pedestrian and their companions reach ahead of and behind them, and how wide they are, in metres.
// The companion comes from the last digit of the id: 0 a dog, 1 a pram, 2 a child, 3 a child and a dog.
export function pedestrianExtent(id) {
  const kind = id % 10;
  const ahead = kind === 1 ? 1.05 : 0.3;
  const behind = kind === 3 ? 1.85 : kind === 0 ? 1.35 : kind === 2 ? 0.9 : 0.3;
  return { ahead, behind, width: 0.45 };
}
