// How busy a junction is through the week, as a function of the clock. Pure: the same time always gives the same answer, with no random numbers.
// The page runs the simulation on this clock, so the sky, the traffic and the people can all follow it. Values are fractions of the peak.
// Day 0 is Monday, as in the bus lane schedule. The shapes are plausible for an inner city junction and are not measured data.

const WEEKDAY_VEHICLES = [0.06, 0.04, 0.03, 0.03, 0.05, 0.12, 0.3, 0.7, 1.0, 0.8, 0.6, 0.6, 0.7, 0.65, 0.6, 0.75, 0.95, 1.0, 0.8, 0.5, 0.35, 0.25, 0.15, 0.09];
const WEEKEND_VEHICLES = [0.1, 0.07, 0.05, 0.04, 0.04, 0.06, 0.1, 0.18, 0.3, 0.45, 0.6, 0.7, 0.75, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5, 0.4, 0.3, 0.22, 0.16, 0.12];
// People on foot. Almost nobody is out between about 11 pm and 5 am.
const WEEKDAY_PEOPLE = [0.01, 0, 0, 0, 0.01, 0.05, 0.2, 0.6, 1.0, 0.6, 0.4, 0.5, 0.8, 0.7, 0.4, 0.6, 0.9, 1.0, 0.7, 0.45, 0.35, 0.2, 0.08, 0.03];
const WEEKEND_PEOPLE = [0.05, 0.02, 0, 0, 0, 0.02, 0.06, 0.15, 0.3, 0.55, 0.8, 1.0, 1.0, 0.95, 0.85, 0.8, 0.75, 0.7, 0.6, 0.5, 0.4, 0.28, 0.15, 0.08];
// People in the park. The mornings and evenings are for joggers and dog walkers, the middle of the day for everyone else.
const WEEKDAY_PARK = [0, 0, 0, 0, 0, 0.08, 0.3, 0.45, 0.3, 0.2, 0.3, 0.55, 0.8, 0.7, 0.45, 0.5, 0.7, 0.8, 0.6, 0.35, 0.18, 0.08, 0.02, 0];
const WEEKEND_PARK = [0, 0, 0, 0, 0, 0.03, 0.15, 0.35, 0.55, 0.8, 1.0, 1.0, 1.0, 0.95, 0.9, 0.85, 0.75, 0.6, 0.45, 0.3, 0.15, 0.06, 0.02, 0];

const HOUR = 3600;
const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;

// The value at a time of the week, by linear interpolation between the hourly anchors, wrapping at midnight.
function at(weekday, weekend, weekSecond) {
  const second = ((weekSecond % WEEK) + WEEK) % WEEK;
  const day = Math.floor(second / DAY), hour = (second % DAY) / HOUR;
  const table = day <= 4 ? weekday : weekend;
  const i = Math.floor(hour), frac = hour - i;
  const nextTable = i === 23 && (day + 1) % 7 > 4 ? weekend : i === 23 ? weekday : table; // after 11 pm it blends into the next day's first hour
  return table[i] * (1 - frac) + nextTable[(i + 1) % 24] * frac;
}

export const vehicleFactor = (weekSecond) => at(WEEKDAY_VEHICLES, WEEKEND_VEHICLES, weekSecond);
export const pedestrianFactor = (weekSecond) => at(WEEKDAY_PEOPLE, WEEKEND_PEOPLE, weekSecond);
export const parkFactor = (weekSecond) => at(WEEKDAY_PARK, WEEKEND_PARK, weekSecond);

// The mix of vehicles at a time, as fractions that sum to one. Weekday rush hours have more buses, the working day more vans and trucks, and the
// night mostly cars and heavy trucks. In the Indian region (Chennai and Mumbai) scooters are a large part of the traffic.
const MIXES = {
  au: {
    night: { car: 0.7, van: 0.08, truck: 0.08, semi: 0.06, bus: 0.02, bike: 0.03, scooter: 0.03 },
    rush: { car: 0.62, van: 0.08, truck: 0.04, semi: 0.01, bus: 0.1, artbus: 0.03, bike: 0.05, scooter: 0.07 },
    work: { car: 0.6, van: 0.1, truck: 0.08, semi: 0.04, bus: 0.06, artbus: 0.02, bike: 0.05, scooter: 0.05 },
    other: { car: 0.7, van: 0.07, truck: 0.03, semi: 0.01, bus: 0.05, artbus: 0.01, bike: 0.06, scooter: 0.07 },
  },
  in: {
    night: { car: 0.38, van: 0.06, truck: 0.12, semi: 0.08, bus: 0.02, bike: 0.1, scooter: 0.24 },
    rush: { car: 0.3, van: 0.04, truck: 0.04, semi: 0.01, bus: 0.1, artbus: 0.01, bike: 0.12, scooter: 0.38 },
    work: { car: 0.3, van: 0.05, truck: 0.07, semi: 0.02, bus: 0.06, artbus: 0.01, bike: 0.12, scooter: 0.37 },
    other: { car: 0.34, van: 0.05, truck: 0.03, semi: 0.01, bus: 0.05, bike: 0.12, scooter: 0.4 },
  },
};
export function mixAt(weekSecond, region = 'au') {
  const second = ((weekSecond % WEEK) + WEEK) % WEEK;
  const day = Math.floor(second / DAY), hour = (second % DAY) / HOUR;
  const weekday = day <= 4;
  const rush = weekday && ((hour >= 7 && hour < 9.5) || (hour >= 16 && hour < 18.5));
  const night = hour < 5 || hour >= 23;
  const set = MIXES[region] || MIXES.au;
  if (night) return set.night;
  if (rush) return set.rush;
  if (weekday && hour >= 9.5 && hour < 16) return set.work;
  return set.other;
}

// Rain. People on foot cross the road less (an umbrella and a short trip: down to 40% in heavy rain, since the commuters still go), and fewer ride bikes and scooters, which becomes cars. The number of vehicles
// is the same. With no rain both return their input, so a dry run is exactly as it was.
export const wetPeople = (rain) => 1 - 0.6 * Math.min(1, Math.max(0, rain));
export function wetMix(mix, rain) {
  const r = Math.min(1, Math.max(0, rain));
  if (r === 0) return mix;
  const out = { ...mix }; let moved = 0;
  for (const k of ['bike', 'scooter']) if (out[k]) { const cut = out[k] * 0.7 * r; out[k] -= cut; moved += cut; }
  out.car = (out.car || 0) + moved;
  return out;
}

// Is it dark? Sunrise and sunset move through the year, and this is a fixed mid-latitude compromise.
export const isNight = (weekSecond) => {
  const hour = (((weekSecond % DAY) + DAY) % DAY) / HOUR;
  return hour < 5.75 || hour >= 19.25;
};

// ---- what kind of vehicle, and what kind of person, by the clock ----
// A vehicle's class (bus, truck, van, car) comes from the mix above. These pick the kind inside the class from the time, with a number from 0 to 1 that the caller
// takes from the vehicle itself, so the same vehicle is always the same kind and the random stream of the simulation is untouched.

const parts = (weekSecond) => {
  const second = ((weekSecond % WEEK) + WEEK) % WEEK;
  const day = Math.floor(second / DAY);
  return { day, hour: (second % DAY) / HOUR, weekday: day <= 4 };
};

// School runs on weekday mornings and afternoons. Outside those windows nothing school related is on the road.
export const isSchoolTime = (weekSecond) => {
  const { hour, weekday } = parts(weekSecond);
  return weekday && ((hour >= 7.25 && hour < 9.25) || (hour >= 14.75 && hour < 16.25));
};

export function vehicleKind(cls, weekSecond, r) {
  const { hour, weekday } = parts(weekSecond);
  if (cls === 'bus') {
    // School buses: many of the buses at the morning and afternoon runs, a few on excursions and after-school activities at midday and in the early evening,
    // a very few on a weekend outing in daylight, and none in the dark.
    const shareOfBuses = isSchoolTime(weekSecond) ? 0.3 : weekday && ((hour >= 9.25 && hour < 14.75) || (hour >= 16.25 && hour < 18)) ? 0.05 : !weekday && hour >= 9 && hour < 15 ? 0.02 : 0;
    if (r < shareOfBuses) return 'school';
    const day = hour >= 6 && hour < 22;
    return day && r > 0.86 ? 'double' : 'single';
  }
  if (cls === 'truck') {
    if (weekday && hour >= 4.5 && hour < 9.5 && r < 0.4) return 'garbage'; // the bin round is an early weekday job
    if (weekday && hour >= 6 && hour < 17 && r > 0.55) return r > 0.8 ? 'flatbed' : 'tipper'; // building work, in working hours
    return 'box';
  }
  if (cls === 'van') return hour >= 6 && hour < 19 && r < 0.6 ? 'delivery' : 'panel';
  if (cls === 'car') {
    const night = hour < 5 || hour >= 22;
    return r < (night ? 0.22 : weekday && hour >= 7 && hour < 9.5 ? 0.04 : 0.08) ? 'taxi' : '';
  }
  return '';
}

// Of the people at a crossing, how many are school children: only at school times, and about a fifth then.
export const studentShare = (weekSecond) => (isSchoolTime(weekSecond) ? 0.22 : 0);

// ---- emergency calls ----
// How many calls of each kind a junction like this gets an hour. Ambulances follow the day, fire engines are rare, and police are busiest at night at the weekend.
export const EMERGENCY_KINDS = ['amb', 'fire', 'police'];
export const EMERGENCY_MAX = { amb: 7, fire: 2, police: 7 }; // the most they can reach, for the thinning in the simulator
export function emergencyRate(kind, weekSecond) {
  const v = vehicleFactor(weekSecond), { day, hour } = parts(weekSecond);
  if (kind === 'amb') return 1.5 + 5 * v;
  if (kind === 'fire') return 0.4 + 1.2 * v;
  const lateWeekend = (day === 4 || day === 5) && (hour >= 22 || hour < 4);
  return (1 + 3 * v) * (lateWeekend ? 1.6 : 1);
}

// ---- what kind of walker, by the clock ----
// Joggers early and in the evening, commuters walking fast at the rush hours, and a good share of older people about in the middle of the day. r is from 0 to 1,
// taken from the person, so the same person is always the same kind.
export function walkerRole(weekSecond, r) {
  const { hour, weekday } = parts(weekSecond);
  if (((hour >= 5.5 && hour < 9.5) || (hour >= 16.5 && hour < 19.5)) && r < 0.07) return 'jogger';
  if (weekday && ((hour >= 7 && hour < 9.5) || (hour >= 16 && hour < 18.5)) && r > 0.55) return 'commuter';
  if (hour >= 9.5 && hour < 15 && r > 0.8) return 'elder';
  return '';
}
export const WALKER_SPEED = { jogger: [2.4, 3.0], commuter: [1.5, 1.7], elder: [1.1, 1.2], '': [1.2, 1.5] }; // metres a second
