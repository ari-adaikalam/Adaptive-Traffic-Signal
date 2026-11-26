// The bus lane schedule: a pure function of the clock. Port of traffic_controller/bus_lane.py.
// A window is [first day, last day, start minute, end minute]. Days run 0 (Monday) to 6 (Sunday),
// both ends included. Minutes run 0 to 1440 and the end is not included.

import { isInt } from './checks.js';

export const WEEK_SECONDS = 7 * 24 * 3600;
const DAY_SECONDS = 24 * 3600;

export function checkWindow(window) {
  if (!Array.isArray(window) || window.length !== 4 || !window.every(isInt)) {
    throw new Error('a bus lane window is 4 ints');
  }
  const [first, last, start, end] = window;
  if (!(first >= 0 && first <= last && last <= 6)) throw new Error('window days must satisfy 0 <= first <= last <= 6');
  if (!(start >= 0 && start < end && end <= 1440)) throw new Error('window minutes must satisfy 0 <= start < end <= 1440');
  return window;
}

export function isActive(windows, weekSecond) {
  if (!isInt(weekSecond) || weekSecond < 0) throw new Error('weekSecond must be a non-negative int');
  const second = weekSecond % WEEK_SECONDS;
  const day = Math.floor(second / DAY_SECONDS);
  const minute = Math.floor((second % DAY_SECONDS) / 60);
  return windows.some(([first, last, start, end]) => first <= day && day <= last && start <= minute && minute < end);
}
