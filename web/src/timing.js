// Green time from vehicle counts. One authoritative implementation, port of timing.py.
// Integer arithmetic only, so the result is exact and matches the Python.

import { checkInt, ceilDiv, isInt } from './checks.js';

export const MAX_COUNT_PER_CLASS = 1000;
const FIELDS = ['bikes', 'buses', 'cars', 'trucks'];

export function makeCounts(fields = {}) {
  for (const key of Object.keys(fields)) {
    if (!FIELDS.includes(key)) throw new Error(`unknown count ${key}`);
  }
  const counts = { bikes: 0, buses: 0, cars: 0, trucks: 0, ...fields };
  for (const name of FIELDS) {
    const value = checkInt(name, counts[name], 0);
    if (value > MAX_COUNT_PER_CLASS) throw new Error(`${name} must be at most ${MAX_COUNT_PER_CLASS}, got ${value}`);
  }
  return Object.freeze(counts);
}

// Class ids of the trained model: 0 bike, 1 bus, 2 car, 3 truck. Other ids are ignored.
export function countsFromClassIds(classIds) {
  const tally = [0, 0, 0, 0];
  for (const id of classIds) {
    if (!isInt(id)) throw new Error('class id must be an int');
    if (id >= 0 && id <= 3) tally[id] += 1;
  }
  return makeCounts({ bikes: tally[0], buses: tally[1], cars: tally[2], trucks: tally[3] });
}

function clearanceSeconds(counts, config) {
  return counts.cars * config.car_time + counts.buses * config.bus_time
    + counts.trucks * config.truck_time + counts.bikes * config.bike_time;
}

// Green for the through and left lanes: ceil(clearance time / lanes), clamped.
export function greenTime(counts, config, lanes = null) {
  const divisor = lanes === null ? config.lanes_per_approach : lanes;
  if (!isInt(divisor) || divisor < 1) throw new Error('lanes must be an int of at least 1');
  const seconds = ceilDiv(clearanceSeconds(counts, config), divisor);
  return Math.max(config.min_green, Math.min(config.max_green, seconds));
}

// Green for a right-turn arrow: the whole clearance time of its one lane, clamped.
export function arrowGreenTime(counts, config) {
  return Math.max(config.min_green, Math.min(config.max_arrow_green, clearanceSeconds(counts, config)));
}

// Green the bus lane needs: its whole clearance time, since it is one lane.
export function busLaneGreenTime(counts, config) {
  return Math.max(config.min_green, Math.min(config.max_green, clearanceSeconds(counts, config)));
}

// Per-class median of a few reports, taking the upper middle when the number is even.
export function medianCounts(reports) {
  if (reports.length === 0) throw new Error('need at least one report');
  const middle = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  return makeCounts({
    bikes: middle(reports.map((r) => r.bikes)),
    buses: middle(reports.map((r) => r.buses)),
    cars: middle(reports.map((r) => r.cars)),
    trucks: middle(reports.map((r) => r.trucks)),
  });
}

export function totalVehicles(counts) {
  return counts.bikes + counts.buses + counts.cars + counts.trucks;
}
