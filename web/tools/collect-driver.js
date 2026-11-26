// Makes one run of the training set, inside the page. Not a module and not part of the site: it is read into the page by the person (or the script) making the set, with the dev server started as
//   python3 web/tools/serve.py --collect datasets/detection
// and the page opened with a seed, http://127.0.0.1:8765/?seed=12345 . Then, in the page:
//   await collectSession({ split: 'train', weather: 'clear', hour: 17.5, frames: 60 })
// Everything about a run is decided by its seed and its options, so a run can be made again. See docs/detector.md for what the options are for.
window.collectSession = async function collectSession(options = {}) {
  const o = { split: 'train', weather: 'clear', hour: 12, day: 1, frames: 60, gap: [8, 20], warmup: 90, keepEmpty: 0.15, size: 960, endpoint: '/collect', ...options };
  const s = window.__scene3d, seed = new URLSearchParams(location.search).get('seed');
  if (!s || !/^[0-9]{1,10}$/.test(seed || '')) throw new Error('open the page with ?seed=N first');
  const sim = s.sim;
  const session = `s${seed}`, next = (() => { let a = Number(seed) >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const frames = (count) => new Promise((resolve) => { let n = 0; const tick = () => (++n >= count ? resolve() : requestAnimationFrame(tick)); requestAnimationFrame(tick); });
  const advance = async (seconds) => { for (let i = 0; i < Math.round(seconds * 10); i += 1) sim.step(); await frames(3); }; // the simulation runs on, then the page draws it
  const start = Math.round(o.day * 86400 + o.hour * 3600 - sim.time); sim.clockStart = start; sim.controller.clockStart = start; // whole seconds, which the bus lane schedule needs; // the time of day, so the traffic, the light and the lamps follow it
  s.setNight(null); s.skyDome.setWeather(o.weather);
  await advance(o.warmup); s.skyDome.jump(); await frames(10); // the traffic for this hour is on the road, and the sky, the weather and the lamps are as they are at that hour, not eased in from before
  const out = { session, split: o.split, weather: o.weather, hour: o.hour, steps: 0, sent: 0, empty: 0, skipped: 0 };
  let frame = 0;
  while (out.steps < o.frames) {
    await advance(o.gap[0] + next() * (o.gap[1] - o.gap[0])); out.steps += 1;
    for (let camera = 0; camera < 8; camera += 1) {
      const f = s.exportFrame(camera, { outWidth: o.size }); if (!f) { out.skipped += 1; continue; }
      if (!f.labels.length && next() >= o.keepEmpty) { out.skipped += 1; continue; } // most pictures with nothing in them are left out, a few kept as examples of an empty road
      if (!f.labels.length) out.empty += 1;
      const body = { session, split: o.split, camera, frame: frame += 1, image: f.image, labels: f.labels.map((l) => l.line),
        meta: { seed: Number(seed), weather: o.weather, hour: o.hour, time: Math.round(f.time * 10) / 10, approach: f.approach, own: f.own, crop: f.crop, width: f.width, height: f.height, truth: f.truth,
          labels: f.labels.map((l) => ({ kind: l.kind, cls: l.cls, d: Math.round(l.d * 10) / 10, lane: l.lane, owned: l.owned, share: Math.round(l.share * 100) / 100 })) } };
      const reply = await fetch(o.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!reply.ok) throw new Error(`the collector said ${reply.status}: ${await reply.text()}`);
      out.sent += 1;
    }
  }
  return out;
};
