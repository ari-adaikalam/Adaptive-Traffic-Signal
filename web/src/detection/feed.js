// Between the detector and the controller: it keeps the latest result of each camera, decides whether it can be trusted, and hands the controller one count for a road or nothing. This file has no Three.js, no page and
// no model in it, so it runs under node and is tested there (web/test/detection_feed.test.js). The rules are the table "When detection fails" in docs/detector.md.
//
// A result is one camera's { lanes: [kerb, middle, right-turn] }, each lane { cars, trucks, buses, bikes }: the vehicles that camera counts, in the stretch of road it owns (postprocess.js, countFor).
//
//   A road's count needs EVERY camera of that road to have a trustworthy result that is not older than `maxAge`. With one camera missing the count would be too small, and a count that is too small shortens a green, so
//   the road's count is unknown (null) and the controller keeps to its default green and never skips a phase for it. Another road is not affected.
//   Where two cameras meet, a vehicle on the line between their stretches can be seen by both and counted by both, because each puts it on the road with a little error. A result may carry `vehicles` (the ones that
//   camera counted, each { cls, d, lateral }), and the vehicles of two neighbouring cameras that are within 3 m of the line between them, of one class, and within 1.5 m of each other along the road and 1.2 m across
//   are one vehicle, counted once.
//   A result is trusted unless it is malformed, or could not be true: more vehicles than the stretch can hold, or a change from this camera's last trusted result that is bigger than traffic can make in the time.
//   A rejected result is thrown away, and the camera's last trusted result carries on until it is too old.
//   After an outage (the last trusted result of the camera is old) the first new result is trusted without the change test, because the road may really have changed. The controller does not mix old and new:
//   it keeps the median of the last few reports that are younger than its own `count_ttl` (signals.js), so what was reported before the outage is gone by the time counts come back.
const CLASSES = ['cars', 'trucks', 'buses', 'bikes'];

export const DEFAULTS = {
  maxAge: 3, // seconds: a camera's result is used for this long, and then it is unknown
  maxPerStretch: 30, // a 40 m stretch of three lanes holds about 19 vehicles bumper to bumper; more than this is not a count of vehicles
  maxJump: 14, // vehicles: the most a camera's total can change from one trusted result to the next, within `maxAge`. A platoon of three lanes can enter at about 9 in a second.
  boundaries: null, // for each road, the distances (metres from the stop line) of the lines between its cameras' stretches, near to far: [[40], [40], [40], [40]]
  edge: 3, sameAlong: 1.5, sameAcross: 1.2, // how near the line, and how near each other, two reports must be to be one vehicle
};

const validLane = (lane) => lane && typeof lane === 'object' && CLASSES.every((c) => Number.isFinite(lane[c]) && lane[c] >= 0 && lane[c] === Math.round(lane[c]));
const validVehicles = (list) => list === undefined || (Array.isArray(list) && list.length <= 60 && list.every((v) => v && Number.isInteger(v.cls) && v.cls >= 0 && v.cls < CLASSES.length && Number.isFinite(v.d) && Number.isFinite(v.lateral)));
const laneGroup = (lateral) => (lateral > 6.4 ? 0 : lateral > 3.2 ? 1 : 2); // the kerb lane, the middle lane, the right-turn lane (postprocess.js laneOf)
const totalOf = (result) => result.lanes.reduce((n, lane) => n + CLASSES.reduce((m, c) => m + lane[c], 0), 0);

export class DetectionFeed {
  // `roads`: for each road (1 to 4), the cameras that count it, as an array of camera numbers.
  constructor(roads, options = {}) {
    this.roads = roads; this.options = { ...DEFAULTS, ...options };
    this.latest = new Map(); // camera -> { result, at, total }
    this.stats = { accepted: 0, rejected: 0, malformed: 0 };
  }

  // A camera has a new result, made at `time`. Returns true if it is trusted.
  submit(camera, time, result) {
    if (!result || !Array.isArray(result.lanes) || result.lanes.length !== 3 || !result.lanes.every(validLane) || !Number.isFinite(time) || !validVehicles(result.vehicles)) { this.stats.malformed += 1; return false; }
    const total = totalOf(result), last = this.latest.get(camera), o = this.options;
    const outage = !last || time - last.at > o.maxAge * 3, backwards = last && time < last.at; // a clock that went back is not a new result
    if (backwards || total > o.maxPerStretch || (!outage && Math.abs(total - last.total) > o.maxJump)) { this.stats.rejected += 1; return false; }
    this.latest.set(camera, { result, at: time, total }); this.stats.accepted += 1;
    return true;
  }

  fresh(camera, time) { const e = this.latest.get(camera); return e && time - e.at <= this.options.maxAge && time >= e.at ? e : null; }

  // The count of a road at `time` for the controller: { general, right, bus }, or null when it is unknown. `busLane` is whether the kerb lane is the bus lane now: its vehicles are then the bus lane's count and not
  // the general count.
  countsFor(road, time, busLane = false) {
    const cameras = this.roads[road - 1]; if (!cameras || !cameras.length) return null;
    const entries = cameras.map((c) => this.fresh(c, time)); if (entries.some((e) => !e)) return null;
    const empty = () => Object.fromEntries(CLASSES.map((c) => [c, 0])), general = empty(), right = empty(), bus = empty();
    for (const { result } of entries) for (const c of CLASSES) { (busLane ? bus : general)[c] += result.lanes[0][c]; general[c] += result.lanes[1][c]; right[c] += result.lanes[2][c]; }
    for (const { cls, lateral } of this.duplicates(road, entries)) { // a vehicle on the line between two cameras, counted by both
      const lane = laneGroup(lateral), group = lane === 2 ? right : lane === 0 && busLane ? bus : general, name = CLASSES[cls];
      if (group[name] > 0) group[name] -= 1;
    }
    return { general, right, bus };
  }

  // The vehicles that two neighbouring cameras of a road both counted, near the line between them: one per pair (see the top of this file).
  duplicates(road, entries) {
    const lines = this.options.boundaries && this.options.boundaries[road - 1], out = [];
    if (!lines) return out;
    for (let i = 0; i + 1 < entries.length && i < lines.length; i += 1) {
      const near = (entries[i].result.vehicles || []).filter((v) => Math.abs(v.d - lines[i]) <= this.options.edge), far = (entries[i + 1].result.vehicles || []).filter((v) => Math.abs(v.d - lines[i]) <= this.options.edge);
      const pairs = [];
      for (const a of near) for (const b of far) if (a.cls === b.cls && Math.abs(a.d - b.d) <= this.options.sameAlong && Math.abs(a.lateral - b.lateral) <= this.options.sameAcross) pairs.push([Math.abs(a.d - b.d) + Math.abs(a.lateral - b.lateral), a, b]);
      pairs.sort((p, q) => p[0] - q[0]);
      const used = new Set();
      for (const [, a, b] of pairs) if (!used.has(a) && !used.has(b)) { used.add(a); used.add(b); out.push({ cls: a.cls, lateral: (a.lateral + b.lateral) / 2 }); }
    }
    return out;
  }

  // For the page to show: 'on' when every camera has a fresh result, 'partial' when some have, 'off' when none has.
  status(time) {
    const all = this.roads.flat(), fresh = all.filter((c) => this.fresh(c, time)).length;
    return fresh === all.length ? 'on' : fresh === 0 ? 'off' : 'partial';
  }
}
