// One run of the delay measurement, inside the page. Not a module and not part of the site: delay-run.mjs reads it into the page. The page is opened with a seed, so the traffic is the same in every mode.
//   await delayRun({ mode: 'detector' | 'rig' | 'fixed', hour: 17.5, day: 0, weather: 'clear', warmup: 420, settle: 30, seconds: 1800 })
// 'rig' is the adaptive controller with the simulator's own camera counts (what every number in docs/simulation.md uses), 'detector' is the adaptive controller reading the model through the page's detector, 'fixed'
// is the fixed plan. The warm-up always runs on the rig's counts, so the road is in the same state when the modes part.
//
// The detector works in real time on the page. Here the simulation is stepped by hand, so the run does not have to take as long as the traffic does: after each step the page draws one frame, which makes the
// camera picture, and the step after it waits until the picture's result is back. A picture is taken every step but the fifth (8 a second, about what the page makes), and the result is dated at the time of the
// picture. On the page the model's 36 ms is added, which is small against the 10 s a count may be old (`count_ttl`) and the 3 s a camera's result is used for.
window.delayRun = async function delayRun(options = {}) {
  const o = { mode: 'rig', hour: 12, day: 0, weather: 'clear', warmup: 420, settle: 30, seconds: 1800, trace: false, ...options };
  const s = window.__scene3d, sim = s.sim, det = s.detector;
  if (!s || !s.step) throw new Error('the page has no step hook');
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  s.speed = 0; // the page's own clock stops, and only `s.step()` moves the simulation
  s.setNight(null); s.skyDome.setWeather(o.weather);
  const start = Math.round(o.day * 86400 + o.hour * 3600 - sim.time); sim.clockStart = start; sim.controller.clockStart = start; // whole seconds, which the bus lane schedule needs
  for (let i = 0; i < 20; i += 1) await frame();
  s.skyDome.jump(); for (let i = 0; i < 10; i += 1) await frame();
  sim.setMode(o.mode === 'fixed' ? 'fixed' : 'adaptive');

  const tally = { ticks: 0, unknown: 0, seen: 0, real: 0, abs: 0, samples: 0 };
  const sum = (g) => Object.values(g).reduce((n, v) => n + v, 0), lastGot = [null, null, null, null], trace = [];
  const watch = (source) => (road, time) => { // counts what the detector gave the controller, and how far it was from the truth
    const got = source(road, time); tally.ticks += 1; lastGot[road - 1] = got ? sum(got.general) + sum(got.right) + sum(got.bus) : null;
    if (!got) { tally.unknown += 1; return got; }
    const t = sim.truth && sim.truth[road - 1];
    if (t) { const a = sum(got.general) + sum(got.right) + sum(got.bus), b = sum(t.general) + sum(t.right) + sum(t.bus); tally.seen += a; tally.real += b; tally.abs += Math.abs(a - b); tally.samples += 1; }
    return got;
  };

  const frames = { warm: Math.round(o.warmup / sim.dt), settle: Math.round(o.settle / sim.dt), measure: Math.round(o.seconds / sim.dt) };
  for (let i = 0; i < frames.warm; i += 1) s.step(); // the warm-up needs no pictures
  if (o.mode === 'detector') {
    det.wall = () => sim.time; det.interval = 0.1; // the detector's clock is the simulation's, and it takes a picture at every step
    sim.countSource = watch(det.source); det.start();
    for (let i = 0; i < 600 && det.state !== 'on'; i += 1) { if (det.state === 'error') throw new Error(`detector: ${det.message}`); await pause(100); }
    if (det.state !== 'on') throw new Error('the detector did not start in 60 s');
  }
  const before = () => ({ delay: [...sim.stats.delay.all], crossed: sim.stats.crossed, qs: sim.stats.queueSum, qn: sim.stats.queueSamples, pw: sim.stats.ped.waitSum, pn: sim.stats.ped.started });
  let k = 0, steps = 0, longest = 0;
  const lastGreen = {}, worstGap = {}; // for each through light: when it last was green, and the longest time it went without
  const run = async (count, measured) => {
    for (let i = 0; i < count; i += 1) {
      s.step(); steps += 1; k += 1;
      if (o.mode === 'detector') {
        if (k % 5 === 0) det.lastAt = sim.time; // no picture on every fifth step, so 4 pictures in 5 steps: 8 a second
        await frame();
        while (det.busy) await pause(1);
      }
      if (measured && o.trace && k % 10 === 0) { // once a second: the time, the phase, the vehicles waiting on each road, what the detector gave the controller and the true count (both added over a road's lanes)
        const truth = sim.truth ? sim.truth.map((t) => sum(t.general) + sum(t.right) + sum(t.bus)) : null;
        trace.push([Math.round(sim.time), sim.snapshot.phase, sim.snapshot.stage, Math.round(sim.snapshot.remaining), sim.lanes.map((a) => a.reduce((n, lane) => n + lane.length, 0)), [...lastGot], truth]);
      }
      if (measured) {
        for (const [name, state] of Object.entries(sim.snapshot.signals)) { // the through light of each road: T1 to T4
          if (name[0] !== 'T') continue;
          if (lastGreen[name] === undefined) lastGreen[name] = sim.time;
          if (state === 'green') { worstGap[name] = Math.max(worstGap[name] || 0, sim.time - lastGreen[name]); lastGreen[name] = sim.time; }
        }
      }
    }
  };
  const t0 = performance.now();
  await run(frames.settle, false);
  const a = before(), tickBefore = { ...tally };
  await run(frames.measure, true);
  const b = before();
  longest = Math.max(0, ...Object.values(worstGap));
  const n = b.delay[1] - a.delay[1];
  if (o.mode === 'detector') det.stop();
  return {
    mode: o.mode, hour: o.hour, day: o.day, weather: o.weather, seconds: o.seconds, wallSeconds: Math.round((performance.now() - t0) / 100) / 10,
    vehicles: n, meanDelay: n > 0 ? (b.delay[0] - a.delay[0]) / n : null, crossed: b.crossed - a.crossed,
    meanQueue: b.qn > a.qn ? (b.qs - a.qs) / (b.qn - a.qn) : null, pedestrianWait: b.pn > a.pn ? (b.pw - a.pw) / (b.pn - a.pn) : null, longestWithoutGreen: Math.round(longest * 10) / 10,
    trace: o.trace ? trace : undefined, rain: sim.rain, snapshotKeys: Object.keys(sim.snapshot),
    detector: o.mode === 'detector' ? { ticks: tally.ticks - tickBefore.ticks, unknown: tally.unknown - tickBefore.unknown, mean: det.status().ms, meanAbsError: tally.samples ? tally.abs / tally.samples : null, seen: tally.seen, real: tally.real, rejected: det.feed.stats.rejected, malformed: det.feed.stats.malformed } : null,
  };
};
