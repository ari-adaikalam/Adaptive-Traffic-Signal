// The live comparison on the Results sheet: the fixed plan and adaptive timing run side by side on the same seeded arrivals, in the browser, a little each frame, so the numbers build up.
// Emergency vehicles come in during the hour (the same calls to both plans, see emergencyEvents in sim/compare.js): the adaptive plan gives them priority, and the fixed plan has none, so an emergency
// vehicle there stops at a red and goes through when it is clear.
import { PRESETS, Simulation } from '../sim/traffic.js';
import { FULL_MIX, emergencyEvents, withFullMix } from '../sim/compare.js';
import { CAMERA_RIG } from '../sim/world.js';

const HOUR = 3600, STEPS_PER_FRAME = 40; // 4 simulated seconds a frame for each plan, which keeps a frame well under 16 ms on a laptop for the usual traffic

export function createLive({ demand, onUpdate, seed = 7 }) {
  const traffic = withFullMix(PRESETS[demand], demand === 'peak' ? FULL_MIX.rush : FULL_MIX.work);
  const fixed = new Simulation({ seed, mode: 'fixed', demand: traffic, config: { default_green: 40, max_green: 60 }, emergencyPriority: false });
  const adaptive = new Simulation({ seed, mode: 'adaptive', demand: traffic, ...CAMERA_RIG });
  const calls = emergencyEvents(seed, HOUR);
  let frame = 0, running = false, next = 0;
  const tick = () => {
    if (!running) return;
    for (let i = 0; i < STEPS_PER_FRAME && adaptive.time < HOUR; i += 1) {
      while (next < calls.length && calls[next].t <= adaptive.time) { const c = calls[next]; fixed.dispatchEmergency(c.approach, c.movement, c.kind); adaptive.dispatchEmergency(c.approach, c.movement, c.kind); next += 1; }
      fixed.step(); adaptive.step();
    }
    const f = fixed.summary(), a = adaptive.summary();
    onUpdate({ time: adaptive.time, fixed: f.meanDelay, adaptive: a.meanDelay, emergency: { fixed: f.emergency.meanWait, adaptive: a.emergency.meanWait, fixedCrossed: f.emergency.crossed, adaptiveCrossed: a.emergency.crossed } });
    if (adaptive.time < HOUR) frame = requestAnimationFrame(tick); else running = false;
  };
  return {
    start() { running = true; frame = requestAnimationFrame(tick); },
    stop() { running = false; cancelAnimationFrame(frame); },
  };
}
