// A green that is held for an emergency must not leave the pedestrian signal on walk for the whole hold.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Controller } from '../src/signals.js';
import { crossingTimes, makeConfig } from '../src/config.js';
import { buildPlan } from '../src/phases.js';
import { makeCounts } from '../src/timing.js';

const cars = (n) => makeCounts({ bikes: 0, buses: 0, cars: n, trucks: 0 });
const feed = (c) => { for (const a of [1, 2, 3, 4]) { c.reportCounts(a, cars(a % 2 ? 40 : 1)); c.reportRightCounts(a, cars(0)); } };

test('a held green gives the pedestrians their walk and flashing time and then a solid red man', () => {
  const cfg = makeConfig({ hold_walk_timed: true });
  const [total] = crossingTimes(cfg.crossing_widths_cm[1], cfg.walking_speed_cm_s, cfg.yellow);
  const c = new Controller({ config: cfg, plan: buildPlan(true) });
  for (let i = 0; i < 400; i += 1) { // run to a through phase that has served crossing 2 and is walking
    feed(c);
    if (i === 3) c.requestCrossing(2);
    const s = c.tick();
    if (s.phase === 'T13' && s.stage === 'green' && s.signals.C2 === 'walk' && s.period > 1) break;
  }
  c.pause('ambulance', 3); // approach 3 is in this phase, so the green is held
  const states = [];
  for (let i = 0; i < 40; i += 1) { feed(c); c.requestCrossing(2); c.requestCrossing(4); const s = c.tick(); states.push([s.signals.C2, s.holding, s.remaining]); }
  assert.ok(states.every(([, holding]) => holding), 'the green is held the whole time');
  const walk = states.filter(([x]) => x === 'walk').length, clear = states.filter(([x]) => x === 'clear').length;
  assert.ok(walk <= cfg.walk_min, `walk shows at most ${cfg.walk_min} s, not ${walk}`);
  assert.ok(clear <= total, `flashing at most ${total} s, not ${clear}`);
  assert.equal(states.at(-1)[0], 'stop', 'and the man ends solid red');
  let stopped = false;
  for (const [x] of states) { if (x === 'stop') stopped = true; else assert.ok(!stopped, 'the man came back after going solid red'); }
});

test('when the hold ends the pedestrian signal carries on in order: it never goes from flashing or red back to walk', () => {
  const cfg = makeConfig({ hold_walk_timed: true });
  const c = new Controller({ config: cfg, plan: buildPlan(true) });
  for (let i = 0; i < 400; i += 1) {
    feed(c);
    if (i === 3) c.requestCrossing(2);
    const s = c.tick();
    if (s.phase === 'T13' && s.stage === 'green' && s.signals.C2 === 'walk' && s.period > 1) break;
  }
  c.pause('ambulance', 3);
  const rank = { walk: 0, clear: 1, stop: 2 };
  let worst = 0;
  for (let i = 0; i < 90; i += 1) {
    feed(c);
    if (i === 8) c.resume('ambulance'); // the ambulance has gone through, so the hold ends
    const s = c.tick();
    if (s.period !== 0 && s.phase === 'T13' && (s.stage === 'green' || s.stage === 'yellow')) {
      assert.ok(rank[s.signals.C2] >= worst, `the man went back from ${Object.keys(rank)[worst]} to ${s.signals.C2} at ${s.time}`);
      worst = Math.max(worst, rank[s.signals.C2]);
    }
  }
});

test('a hold that starts late in a long green sends the man from walk to flashing first, never straight to solid red', () => {
  const cfg = makeConfig({ hold_walk_timed: true });
  const [total] = crossingTimes(cfg.crossing_widths_cm[1], cfg.walking_speed_cm_s, cfg.yellow);
  const c = new Controller({ config: cfg, plan: buildPlan(true) });
  let greenFor = 0, last = null;
  for (let i = 0; i < 900; i += 1) { // a through green that has been on for longer than the walk and flashing time, with the man still on walk
    feed(c);
    if (i === 3) c.requestCrossing(2);
    const s = c.tick();
    greenFor = s.phase === last && s.stage === 'green' ? greenFor + 1 : 0; last = s.phase;
    if (s.phase === 'T13' && s.stage === 'green' && s.signals.C2 === 'walk' && s.period > 1 && greenFor > cfg.walk_min + total) break;
  }
  assert.ok(greenFor > cfg.walk_min + total, 'found a long green with the man on walk');
  c.pause('ambulance', 3);
  let before = 'walk';
  for (let i = 0; i < 60; i += 1) {
    feed(c);
    const s = c.tick();
    assert.ok(!(before === 'walk' && s.signals.C2 === 'stop'), `walk went straight to stop at ${s.time}`);
    before = s.signals.C2;
  }
  assert.equal(before, 'stop');
});
