// The two settings for left turners: left_window (a fixed arrow window after pedestrians, no left count) and left_follow (the pedestrian
// signal ends with the crossing time and the left arrow carries on to the end of the next arrow phase).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Controller } from '../src/signals.js';
import { crossingTimes, makeConfig } from '../src/config.js';
import { buildPlan } from '../src/phases.js';
import { makeCounts } from '../src/timing.js';

const cars = (n) => makeCounts({ bikes: 0, buses: 0, cars: n, trucks: 0 });

// Runs the controller with the same counts every second and one press of crossing 2 at the fourth second. Returns every snapshot.
function run(config, { through = 0, right = 0, press = true, seconds = 400, clockStartS = 0 } = {}) {
  const c = new Controller({ config: makeConfig(config), plan: buildPlan(true), clockStartS });
  const trace = [];
  for (let i = 0; i < seconds; i += 1) {
    for (const a of [1, 2, 3, 4]) {
      c.reportCounts(a, cars(a % 2 ? through : 1));
      c.reportRightCounts(a, cars(a === 2 || a === 4 ? right : 0));
    }
    if (press && i === 3) c.requestCrossing(2); // served when the next through phase for it opens
    trace.push(c.tick());
  }
  return trace;
}
const periodOf = (trace, period) => trace.filter((s) => s.period === period);
// The through period that served crossing 2.
const served = (trace) => trace.find((s) => s.phase === 'T13' && s.signals.C2 === 'walk');

test('with left_window an arrow phase is owed after a through phase that served pedestrians, and lasts at least the window', () => {
  const trace = run({ left_window: 6 });
  const first = served(trace);
  assert.ok(first, 'crossing 2 was served');
  const arrow = trace.find((s) => s.time > first.time && s.phase === 'R24' && s.stage === 'green');
  assert.ok(arrow, 'the arrow phase ran although nobody waited on the right');
  assert.ok(arrow.remaining >= 6, `arrow green ${arrow.remaining}`);
});

test('with left_window no arrow phase is owed after a through phase that served nobody', () => {
  const trace = run({ left_window: 6 }, { press: false, seconds: 40 });
  const firstT24 = trace.findIndex((s) => s.phase === 'T24');
  assert.ok(firstT24 > 0, 'the cycle went on to T24');
  assert.ok(!trace.slice(0, firstT24).some((s) => s.phase === 'R24'), 'the empty arrow phase was skipped');
});

test('left_window does not use a left count', () => {
  const c = new Controller({ config: makeConfig({ left_window: 6 }), plan: buildPlan(true) });
  c.reportRightCounts(2, cars(0));
  c.reportLeftCounts(1, cars(30));
  assert.equal(c.arrowCounts(2).cars, 0);
});

test('with left_follow the man ends with the crossing time and the left arrow runs from then to the end of the arrow phase', () => {
  const config = { left_window: 6, left_follow: true, left_follow_windows: [] };
  const cfg = makeConfig(config);
  const [total] = crossingTimes(cfg.crossing_widths_cm[1], cfg.walking_speed_cm_s, cfg.yellow);
  const trace = run(config, { through: 40, right: 3 });
  const first = served(trace);
  const period = periodOf(trace, first.period);
  const green = period.filter((s) => s.stage === 'green');
  assert.ok(green.length > 30, `a long green, ${green.length} s`);
  const states = green.map((s) => s.signals.C2);
  const walk = states.filter((x) => x === 'walk').length, clear = states.filter((x) => x === 'clear').length;
  assert.equal(walk, cfg.walk_min, 'the minimum walk');
  assert.equal(clear, total, 'the whole crossing time, flashing');
  assert.ok(states.slice(-5).every((x) => x === 'stop'), 'the man is solid red for the rest of the green');
  // the arrow is green exactly while the man is solid red in the green, then through the yellow
  for (const s of green) assert.equal(s.arrows[0] === 'green', s.signals.C2 === 'stop', `second ${s.time}`);
  assert.ok(period.filter((s) => s.stage === 'yellow').every((s) => s.arrows[0] === 'green' && s.arrows[2] === 'green'), 'the arrow carries on through the yellow into the arrow phase');
  // the next phase is the right-turn arrow phase, so the arrow stays green through the all-red into it
  const after = trace.filter((s) => s.time > period.at(-1).time).slice(0, 12);
  const allRed = period.filter((s) => s.stage === 'all_red'); // the all-red belongs to the period it ends
  assert.ok(allRed.length > 0 && allRed.every((s) => s.arrows[0] === 'green'), 'arrow carries through the all-red');
  const arrowPhase = after.find((s) => s.phase === 'R24' && s.stage === 'green');
  assert.ok(arrowPhase && arrowPhase.arrows[0] === 'green' && arrowPhase.arrows[1] === 'red');
});

test('with left_follow the left arrow turns red before a through phase that conflicts with it', () => {
  const trace = run({ left_window: 6, left_follow: true, left_follow_windows: [] }, { through: 40, right: 0 });
  for (let i = 1; i < trace.length; i += 1) {
    const s = trace[i];
    if (s.arrows[0] === 'green' || s.arrows[2] === 'green') {
      assert.ok(['T13', 'R24'].includes(s.phase) || s.stage === 'all_red', `left arrow 1 lit in ${s.phase} ${s.stage}`);
      if (s.stage === 'all_red' && s.phase === 'T13') assert.equal(trace[i + 1].phase === 'T24' && trace[i + 1].stage === 'green', false, 'arrow lit into a conflicting green');
    }
  }
});

test('with left_follow an arrow that does not carry on ends with a yellow, never straight from green to red', () => {
  const trace = run({ left_window: 6, left_follow: true, left_follow_windows: [] }, { through: 40, right: 0 });
  let sawYellow = false;
  for (let i = 1; i < trace.length; i += 1) {
    const before = trace[i - 1].arrows[0], now = trace[i].arrows[0];
    assert.ok(!(before === 'green' && now === 'red' && trace[i].phase === trace[i - 1].phase), `green to red at ${trace[i].time}`);
    if (trace[i].phase[0] === 'T' && now === 'yellow') sawYellow = true;
  }
  assert.ok(sawYellow, 'an arrow yellow was shown');
});

test('with left_follow a crossing is never walk or flashing while a left arrow is green', () => {
  const trace = run({ left_window: 6, left_follow: true, left_follow_windows: [] }, { through: 40, right: 3 });
  for (const s of trace) {
    if (s.arrows.includes('green')) assert.ok(['C1', 'C2', 'C3', 'C4'].every((m) => s.signals[m] === 'stop'), `second ${s.time}`);
  }
});

test('the left turner settings are off by default', () => {
  const trace = run({}, { through: 40, right: 3 });
  assert.ok(trace.every((s) => !(s.phase[0] === 'T' && s.arrows.includes('green'))));
});

function untilYellowWithArrow(c, feed) {
  for (let i = 0; i < 600; i += 1) {
    feed(c, i);
    const s = c.tick();
    if (s.phase === 'T13' && s.stage === 'yellow' && s.arrows[0] === 'green') return s;
  }
  throw new Error('no yellow with a carried arrow');
}
const feedBusy = (c, i) => {
  for (const a of [1, 2, 3, 4]) { c.reportCounts(a, cars(a % 2 ? 40 : 1)); c.reportRightCounts(a, cars(a === 2 || a === 4 ? 3 : 0)); }
  if (i === 3) c.requestCrossing(2);
};

test('an emergency that arrives while the left arrow carries on is served on time, and the arrow ends with a yellow, never straight from green to red', () => {
  const withArrow = new Controller({ config: makeConfig({ left_window: 6, left_follow: true, left_follow_windows: [] }), plan: buildPlan(true) });
  untilYellowWithArrow(withArrow, feedBusy);
  withArrow.pause('ambulance', 2); // through phase T24, which conflicts with left arrow 1
  const trace = [];
  for (let i = 0; i < 40; i += 1) { feedBusy(withArrow, 100 + i); trace.push(withArrow.tick()); }
  // On time: the emergency phase opens right after the through yellow and the all-red, with no arrow phase in between.
  const firstGreen = trace.find((s) => s.stage === 'green');
  assert.equal(firstGreen.phase, 'T24');
  for (let i = 1; i < trace.length; i += 1) {
    const before = trace[i - 1], now = trace[i];
    if (before.arrows[0] === 'green') assert.ok(now.arrows[0] !== 'red', `green to red at ${now.time}`);
    if (now.phase === 'T24' && now.stage === 'green') assert.ok(now.arrows.every((a) => a === 'red'), 'no left arrow in the conflicting phase');
  }
  assert.ok(trace.some((s) => s.arrows[0] === 'yellow'), 'the arrow showed yellow');
});

test('a window owed to a through phase that an emergency cut short does not outlive the cycle', () => {
  const c = new Controller({ config: makeConfig({ left_window: 6 }), plan: buildPlan(true) });
  let opened = false;
  for (let i = 0; i < 400; i += 1) {
    feedBusy(c, i);
    const s = c.tick();
    if (!opened && s.phase === 'T13' && s.signals.C2 === 'walk') { opened = true; c.pause('ambulance', 2); }
    if (opened && s.phase === 'T13' && s.stage === 'green' && s.signals.C2 === 'stop' && i > 100) break;
  }
  assert.ok(opened, 'crossing 2 was served');
  // After the emergency, nobody presses a button. A full cycle later no arrow phase is owed anything.
  c.resume('ambulance');
  const live = [];
  for (let i = 0; i < 300; i += 1) {
    for (const a of [1, 2, 3, 4]) { c.reportCounts(a, cars(1)); c.reportRightCounts(a, cars(0)); }
    live.push(c.tick());
  }
  assert.deepEqual(c.owed, [false, false, false, false]);
  assert.ok(live.some((s) => s.phase === 'T24' && s.stage === 'green'), 'the cycle went on');
});

const MONDAY = (h, m = 0, sec = 0) => h * 3600 + m * 60 + sec; // seconds into a Monday

test('left_follow applies only inside its windows: on at the morning peak, off at noon', () => {
  const config = { left_window: 6, left_follow: true };
  const peak = run(config, { through: 40, right: 3, clockStartS: MONDAY(7, 30) });
  const noon = run(config, { through: 40, right: 3, clockStartS: MONDAY(12) });
  assert.ok(peak.some((s) => s.phase === 'T13' && s.arrows[0] === 'green'), 'the left arrow runs inside the through phase at the peak');
  assert.ok(noon.every((s) => !(s.phase[0] === 'T' && s.arrows.includes('green'))), 'and never at noon');
  // At noon the man stays on walk or flashing for the whole green, as without the option.
  const served = noon.find((s) => s.phase === 'T13' && s.signals.C2 === 'walk');
  const period = noon.filter((s) => s.period === served.period && s.stage === 'green');
  assert.ok(period.every((s) => s.signals.C2 !== 'stop'));
});

test('a window that ends in the middle of a green does not change that green: the man never goes back from solid red to walking or flashing', () => {
  const config = { left_window: 6, left_follow: true };
  // 08:59:00 on a Monday. The pedestrian is served at about 08:59:34 in a 60 s green, and the peak window ends at 09:00, in the middle of it.
  const trace = run(config, { through: 40, right: 3, clockStartS: MONDAY(8, 59, 0), seconds: 300 });
  const served = trace.find((s) => s.phase === 'T13' && s.signals.C2 === 'walk');
  assert.ok(served && served.time < 60, 'served inside the window');
  for (const crossing of ['C1', 'C2', 'C3', 'C4']) {
    let stopped = false, period = null;
    for (const s of trace) {
      if (s.period !== period) { period = s.period; stopped = false; }
      if (s.stage === 'green' || s.stage === 'yellow') {
        if (s.signals[crossing] === 'stop' && s.stage === 'green' && s.phase[0] === 'T') stopped = true;
        else if (stopped && s.phase[0] === 'T') assert.equal(s.signals[crossing], 'stop', `${crossing} left solid red at ${s.time}`);
      }
    }
  }
  assert.ok(trace.some((s) => s.phase[0] === 'T' && s.arrows.includes('green')), 'the arrow ran in the green that began inside the window');
});

test('an empty list of windows means left_follow applies all day', () => {
  const trace = run({ left_window: 6, left_follow: true, left_follow_windows: [] }, { through: 40, right: 3, clockStartS: MONDAY(12) });
  assert.ok(trace.some((s) => s.phase === 'T13' && s.arrows[0] === 'green'));
});
