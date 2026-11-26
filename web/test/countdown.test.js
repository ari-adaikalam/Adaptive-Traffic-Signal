// The seconds ahead that the poles and the status card show (src/countdown.js), checked against what the controller then really does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Controller } from '../src/signals.js';
import { makeConfig } from '../src/config.js';
import { makeCounts } from '../src/timing.js';
import { forecast, flashingSeconds, countdownText } from '../src/countdown.js';
import { describeSignals, describePedestrians } from '../src/page/names.js';

const cars = (n) => makeCounts({ bikes: 0, buses: 0, cars: n, trucks: 0 });
const lit = (snap, a) => [snap.signals[`T${a}`], snap.signals[`R${a}`], snap.arrows[a - 1]].some((state) => state === 'green' || state === 'yellow');

// A small seeded generator, so the runs are the same every time.
function random(seed) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; }

// One run with traffic that changes every 15 seconds and crossing buttons pressed now and then, with what was said at each second kept beside what happened.
function run(config, seconds, seed = 21) {
  const rnd = random(seed), c = new Controller({ config });
  let level = [4, 4, 4, 4];
  const snaps = [], said = [], flashing = [];
  for (let s = 0; s < seconds; s += 1) {
    if (s % 15 === 0) level = level.map(() => Math.floor(rnd() * 12));
    for (let a = 1; a <= 4; a += 1) { c.reportCounts(a, cars(level[a - 1])); c.reportRightCounts(a, cars(level[a - 1] > 6 ? 2 : 0)); }
    if (rnd() < 0.03) c.requestCrossing(1 + Math.floor(rnd() * 4));
    snaps.push(c.tick()); said.push(forecast(c)); flashing.push([1, 2, 3, 4].map((n) => flashingSeconds(c, n)));
  }
  return { snaps, said, flashing };
}
const wait = (snaps, from, test) => { let k = 0; while (from + k < snaps.length && !test(snaps[from + k])) k += 1; return from + k < snaps.length ? k : null; };

test('a red road is told the seconds to its next light, and they are right almost every time', () => {
  const { snaps, said } = run(undefined, 5400);
  let checked = 0, right = 0;
  for (let t = 5; t < snaps.length - 450; t += 1) for (let a = 1; a <= 4; a += 1) {
    const f = said[t][a - 1];
    if (!f || f.kind !== 'exact') continue;
    checked += 1;
    if (wait(snaps, t, (s) => lit(s, a)) === f.seconds) right += 1;
  }
  assert.ok(checked > 5000, `only ${checked} samples`);
  assert.ok(right / checked >= 0.98, `${right} of ${checked} were exact`); // the misses are traffic that arrived after the forecast, which moves a green by a second
});

test('a road with a light on, its main light or its arrow, is told nothing', () => {
  const { snaps, said } = run(undefined, 1800);
  let lit = 0;
  for (let t = 5; t < snaps.length; t += 1) for (let a = 1; a <= 4; a += 1) {
    const s = snaps[t], on = [s.signals[`T${a}`], s.signals[`R${a}`], (s.shown_arrows || s.arrows)[a - 1]].some((x) => x === 'green' || x === 'yellow');
    if (on && s.stage !== 'fault' && s.stage !== 'flash') { lit += 1; assert.equal(said[t][a - 1], null, `road ${a} at ${t}`); }
  }
  assert.ok(lit > 500);
  const c = new Controller({});
  for (let i = 1; i <= 4; i += 1) { c.reportCounts(i, cars(4)); c.reportRightCounts(i, cars(0)); }
  for (let i = 0; i < 5; i += 1) c.tick();
  c.pause('ambulance', 1);
  for (let i = 0; i < 60 && !c.snapshot.holding; i += 1) c.tick();
  assert.ok(c.snapshot.holding, 'the green is held');
  assert.equal(forecast(c)[0], null);
});

test('while a green is held for an emergency vehicle the waiting roads are told nothing, and are told a number again when it ends', () => {
  const c = new Controller({});
  for (let i = 1; i <= 4; i += 1) { c.reportCounts(i, cars(4)); c.reportRightCounts(i, cars(0)); }
  for (let i = 0; i < 5; i += 1) c.tick();
  c.pause('ambulance', 1);
  for (let i = 0; i < 60 && !c.snapshot.holding; i += 1) c.tick();
  assert.ok(c.snapshot.holding);
  for (let held = 0; held < 8; held += 1) {
    const said = forecast(c);
    for (let a = 1; a <= 4; a += 1) if (!lit(c.snapshot, a)) assert.equal(said[a - 1], null, `road ${a} is waiting during the hold`); // a guess here fell for a while and then dropped
    c.tick();
  }
  c.resume('ambulance', 1);
  for (let i = 0; i < 40 && c.snapshot.holding; i += 1) c.tick();
  assert.ok(!c.snapshot.holding, 'the hold has ended');
  const after = forecast(c);
  assert.ok(after.some((f, i) => !lit(c.snapshot, i + 1) && f && f.kind === 'exact'), 'a waiting road is told a number');
});

test('with no left arrows a road can be further off, and then the answer is a bound that is always true', () => {
  const { snaps, said } = run(makeConfig({ left_arrow: false }), 5400);
  let bounds = 0;
  for (let t = 5; t < snaps.length - 450; t += 1) for (let a = 1; a <= 4; a += 1) {
    const f = said[t][a - 1];
    if (!f || f.kind !== 'more') continue;
    bounds += 1;
    assert.ok(wait(snaps, t, (s) => lit(s, a)) > f.seconds, `at ${t}, road ${a}: said more than ${f.seconds}`);
  }
  assert.ok(bounds > 100, `only ${bounds} bounds`);
});

test('the flashing red man counts down to its end, exactly', () => {
  const { snaps, flashing } = run(undefined, 5400);
  let checked = 0, right = 0;
  for (let t = 5; t < snaps.length - 450; t += 1) for (let n = 1; n <= 4; n += 1) {
    const f = flashing[t][n - 1];
    if (f === null) { assert.notEqual(snaps[t].signals[`C${n}`], 'clear'); continue; }
    checked += 1;
    if (wait(snaps, t, (s) => s.signals[`C${n}`] !== 'clear') === f) right += 1;
  }
  assert.ok(checked > 500, `only ${checked} samples`);
  assert.ok(right / checked >= 0.99, `${right} of ${checked}`);
});

test('nothing is said during startup or a fault', () => {
  const c = new Controller({ powerOn: true });
  assert.deepEqual(forecast(c), [null, null, null, null]);
  const d = new Controller({});
  d.fault('link');
  assert.deepEqual(forecast(d), [null, null, null, null]);
});

test('looking ahead changes nothing: a controller that is asked every second does the same as one that is not', () => {
  const rnd = random(5), a = new Controller({}), b = new Controller({});
  for (let s = 0; s < 1500; s += 1) {
    const n = Math.floor(rnd() * 12);
    for (const c of [a, b]) for (let i = 1; i <= 4; i += 1) { c.reportCounts(i, cars(n)); c.reportRightCounts(i, cars(n > 6 ? 2 : 0)); }
    forecast(a); [1, 2, 3, 4].forEach((i) => flashingSeconds(a, i));
    assert.deepEqual(a.tick(), b.tick(), `at second ${s}`);
  }
});

test('the text on a head or the plan', () => {
  assert.equal(countdownText({ kind: 'exact', seconds: 14 }), '14');
  assert.equal(countdownText({ kind: 'now', seconds: 3 }), '3');
  assert.equal(countdownText({ kind: 'more', seconds: 25 }), '>25');
  assert.equal(countdownText({ kind: 'exact', seconds: 250 }), '99');
  assert.equal(countdownText({ kind: 'now', seconds: null }), '');
  assert.equal(countdownText(null), '');
});

test('the status card gives the seconds of every state that has an end', () => {
  const base = { stage: 'green', phase: 'T13', remaining: 12, holding: false, emergency_approach: null };
  assert.deepEqual(describeSignals(base), { title: 'North and south roads: straight on and left turns', detail: 'Green, 12 s left' });
  assert.equal(describeSignals({ ...base, stage: 'yellow', remaining: 3 }).detail, 'Yellow, 3 s left');
  assert.deepEqual(describeSignals({ ...base, stage: 'all_red', remaining: 2 }), { title: 'Everything red', detail: '2 s left' });
  assert.equal(describeSignals({ ...base, emergency_approach: 2 }).detail, 'Green, north and south, 12 s left');
  assert.equal(describeSignals({ ...base, emergency_approach: 2, holding: true }).detail, 'Green, north and south');
  assert.equal(describeSignals({ ...base, emergency_approach: 2, stage: 'yellow', remaining: 4 }).detail, 'Yellow, north and south, 4 s left');
  assert.equal(describeSignals({ ...base, emergency_approach: 2, stage: 'all_red', remaining: 2 }).detail, 'Everything red, 2 s left');
  const flashing = { signals: { C1: 'clear', C2: 'stop', C3: 'stop', C4: 'stop' }, pedestrian_requests: [] };
  assert.equal(describePedestrians(flashing, 6), 'Finishing: north road, 6 s left');
  assert.equal(describePedestrians(flashing), 'Finishing: north road');
});

test('the status card names the carried left arrow in the all-red, and says everything red when there is none', () => {
  const base = { stage: 'all_red', phase: 'T13', remaining: 2, holding: false, emergency_approach: null, arrows: ['red', 'red', 'red', 'red'] };
  assert.deepEqual(describeSignals({ ...base, shown_arrows: ['green', 'red', 'green', 'red'] }), { title: 'North and south roads: left arrows', detail: 'Green' });
  assert.deepEqual(describeSignals({ ...base, shown_arrows: ['red', 'red', 'red', 'red'] }), { title: 'Everything red', detail: '2 s left' });
});
