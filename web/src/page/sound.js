// The sound of the junction, made in the browser with Web Audio, so there are no sound files and nothing to license. It is off until the visitor turns it on, and it is spatial: the nearer a
// source is to the camera, the louder it is, and it is panned to the left or right by where it is. The page calls `update` a few times a second with what is near the camera.
//   traffic: [{ id, cls, x, z, v }]   vehicles, with their speed in m/s      sirens: [{ x, z }]   emergency vehicles
//   ticks: [{ x, z }]                 crossings that show walk               listener: { x, z, rx, rz }   the camera, and the direction of its right hand
//   night, day, rain, wind            0 to 1
// Layers: an engine for each of the nearest vehicles (its pitch follows its speed through the gears, and it is louder when it accelerates), the tyres and the city, horns now and then, rain,
// wind, sirens, the pedestrian tick, a few birds by day and crickets at night (each cricket is its own, chirping in short bursts with pauses, see `chirp`).

const noiseBuffer = (ctx, seconds = 7) => { // a loop of noise, a little brown so that it is soft
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate), data = buffer.getChannelData(0); let last = 0;
  for (let i = 0; i < data.length; i += 1) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; data[i] = last * 3.5; }
  return buffer;
};
const near = (d, scale) => 1 / (1 + (d / scale) ** 2); // loudness of a source at distance d, which is half at `scale`
const hash = (id) => ((Math.imul(id + 1, 2654435761) >>> 0) % 1000) / 1000; // a steady number from 0 to 1 for a vehicle, so each one keeps its own voice

// An engine by class: the pitch of its fundamental at idle and flat out, how loud it is, how much of the harshness gets through the filter, and the pitch and tone of its horn.
const ENGINES = {
  car: { idle: 30, top: 110, vol: 0.5, cut: 650, horn: [420, 520] }, van: { idle: 27, top: 95, vol: 0.55, cut: 600, horn: [380, 470] },
  truck: { idle: 20, top: 66, vol: 0.85, cut: 520, horn: [170, 215] }, semi: { idle: 17, top: 58, vol: 0.95, cut: 480, horn: [150, 190] },
  bus: { idle: 19, top: 60, vol: 0.85, cut: 500, horn: [280, 350] }, artbus: { idle: 18, top: 58, vol: 0.9, cut: 480, horn: [270, 340] },
  bike: { idle: 42, top: 175, vol: 0.5, cut: 1500, horn: [760, 760] }, scooter: { idle: 58, top: 190, vol: 0.38, cut: 1800, horn: [820, 820] },
  amb: { idle: 24, top: 80, vol: 0.7, cut: 560, horn: [400, 500] }, fire: { idle: 18, top: 62, vol: 0.9, cut: 480, horn: [160, 200] }, police: { idle: 30, top: 105, vol: 0.55, cut: 650, horn: [420, 520] },
};
const GEARS = [0, 3, 6.5, 10.5, 15, 99]; // speeds in m/s where a car changes up
const rpm = (v) => { let g = 0; while (v >= GEARS[g + 1]) g += 1; const r = Math.min(1, (v - GEARS[g]) / (GEARS[g + 1] - GEARS[g])); return g === 0 ? 0.1 + 0.9 * r : 0.3 + 0.7 * r; };
const VOICES = 14, HEARD = 75; // engines at once, and how far away a vehicle can still have one

export function createSound() {
  let ctx = null, master = null, meter = null, on = false;
  const layers = {}, voices = [];
  let nextTick = 0, nextBird = 0, nextHorn = 0;

  function build() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
    meter = ctx.createAnalyser(); meter.fftSize = 1024; master.connect(meter); // only for `level`
    const loop = (filterType, freq, q = 0.7) => { // a looping noise layer with its own filter and gain
      const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx); src.loop = true;
      const filter = ctx.createBiquadFilter(); filter.type = filterType; filter.frequency.value = freq; filter.Q.value = q;
      const gain = ctx.createGain(); gain.gain.value = 0; src.connect(filter); filter.connect(gain); gain.connect(master); src.start();
      return { gain, filter };
    };
    layers.road = loop('lowpass', 300); layers.hiss = loop('bandpass', 1400, 0.6); layers.rain = loop('highpass', 1200); layers.wind = loop('bandpass', 260, 0.5);
    // the siren: a sawtooth that wails between two pitches, panned left or right by where the vehicle is
    const siren = ctx.createOscillator(), wail = ctx.createOscillator(), wailDepth = ctx.createGain(), sirenGain = ctx.createGain(), pan = ctx.createStereoPanner();
    siren.type = 'sawtooth'; siren.frequency.value = 850; wail.frequency.value = 0.45; wailDepth.gain.value = 260; sirenGain.gain.value = 0;
    const soften = ctx.createBiquadFilter(); soften.type = 'lowpass'; soften.frequency.value = 2200; soften.Q.value = 0.5; // takes the rasp off the top of the sawtooth
    wail.connect(wailDepth); wailDepth.connect(siren.frequency); siren.connect(soften); soften.connect(sirenGain); sirenGain.connect(pan); pan.connect(master); siren.start(); wail.start();
    layers.siren = { gain: sirenGain, pan };
    // the engine voices: two oscillators an octave apart through a low-pass filter, which stay silent until a vehicle is given to them
    for (let i = 0; i < VOICES; i += 1) {
      const a = ctx.createOscillator(), b = ctx.createOscillator(), mixB = ctx.createGain(), filter = ctx.createBiquadFilter(), gain = ctx.createGain(), p = ctx.createStereoPanner();
      a.type = 'sawtooth'; b.type = 'square'; mixB.gain.value = 0.45; filter.type = 'lowpass'; filter.Q.value = 1.2; gain.gain.value = 0;
      a.connect(filter); b.connect(mixB); mixB.connect(filter); filter.connect(gain); gain.connect(p); p.connect(master); a.start(); b.start();
      voices.push({ a, b, filter, gain, pan: p, id: null, lastV: 0, lastAt: 0 });
    }
  }

  // short sounds, played when they are due
  const blip = (freq, length, gain, pan = 0, glide = 0) => {
    const osc = ctx.createOscillator(), g = ctx.createGain(), p = ctx.createStereoPanner(), t = ctx.currentTime;
    osc.frequency.setValueAtTime(freq, t); if (glide) osc.frequency.linearRampToValueAtTime(freq + glide, t + length);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + length * 0.2); g.gain.linearRampToValueAtTime(0, t + length); p.pan.value = Math.max(-1, Math.min(1, pan));
    osc.connect(g); g.connect(p); p.connect(master); osc.start(t); osc.stop(t + length + 0.02);
  };
  const honk = (pitch, length, gain, pan) => { // two notes together through a filter, as a horn sounds
    const t = ctx.currentTime, g = ctx.createGain(), filter = ctx.createBiquadFilter(), p = ctx.createStereoPanner();
    filter.type = 'lowpass'; filter.frequency.value = 2200; p.pan.value = Math.max(-1, Math.min(1, pan));
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.02); g.gain.setValueAtTime(gain, t + length - 0.04); g.gain.linearRampToValueAtTime(0, t + length);
    for (const f of pitch) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(filter); o.start(t); o.stop(t + length + 0.02); }
    filter.connect(g); g.connect(p); p.connect(master);
  };
  // One chirp of a cricket: a burst of three to five short pulses of a high, soft tone, at `when` (audio time). Each pulse rises in pitch a little as it sounds, as a cricket's does.
  const chirp = (when, freq, gain, pan, pulses) => {
    const p = ctx.createStereoPanner(); p.pan.value = pan; p.connect(master);
    for (let i = 0; i < pulses; i += 1) {
      const o = ctx.createOscillator(), g = ctx.createGain(), at = when + i * 0.052;
      o.type = 'sine'; o.frequency.setValueAtTime(freq, at); o.frequency.linearRampToValueAtTime(freq * 1.025, at + 0.032);
      g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(gain, at + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.036);
      o.connect(g); g.connect(p); o.start(at); o.stop(at + 0.045);
    }
  };
  // Five crickets, each with its own pitch, place, and rhythm: a chirp, then a pause of about a second (a little different every time), and now and then a longer rest.
  const crickets = Array.from({ length: 5 }, (_, i) => ({ freq: 4200 + i * 230 + Math.random() * 120, pan: (i - 2) * 0.4 + (Math.random() - 0.5) * 0.2, next: Math.random() * 2, period: 0.9 + Math.random() * 0.7 }));
  function crickets_(t, level) {
    for (const c of crickets) {
      if (c.next > t + 0.6) continue;
      if (level > 0.05 && c.next >= t - 0.1) chirp(Math.max(c.next, t), c.freq, 0.011 * level, c.pan, 3 + Math.floor(Math.random() * 3));
      c.next = Math.max(c.next, t) + c.period * (0.85 + Math.random() * 0.3) + (Math.random() < 0.12 ? 1.5 + Math.random() * 2.5 : 0);
    }
  }
  const sideOf = (listener, x, z, d) => ((x - listener.x) * listener.rx + (z - listener.z) * listener.rz) / (d || 1);

  function engines(traffic, listener, t) {
    const near2 = traffic.map((v) => ({ v, d: Math.hypot(v.x - listener.x, v.z - listener.z) })).filter((o) => o.d < HEARD && o.v.id !== undefined).sort((p, q) => p.d - q.d).slice(0, VOICES);
    const keep = new Set(near2.map((o) => o.v.id));
    for (const voice of voices) if (voice.id !== null && !keep.has(voice.id)) { voice.id = null; voice.gain.gain.setTargetAtTime(0, t, 0.15); } // out of earshot: fade away
    const byId = new Map(voices.filter((v) => v.id !== null).map((v) => [v.id, v]));
    for (const { v, d } of near2) {
      let voice = byId.get(v.id);
      if (!voice) { voice = voices.find((o) => o.id === null); if (!voice) continue; voice.id = v.id; voice.lastV = v.v; voice.lastAt = t; byId.set(v.id, voice); }
      const e = ENGINES[v.cls] || ENGINES.car, detune = 0.92 + hash(v.id) * 0.16, dt = Math.max(0.05, t - voice.lastAt), accel = (v.v - voice.lastV) / dt; voice.lastV = v.v; voice.lastAt = t;
      const r = v.v < 0.3 ? 0 : rpm(v.v), f = e.idle * (1 + (e.top / e.idle - 1) * r) * detune;
      const load = v.v < 0.3 ? 0.22 : accel > 0.4 ? 1 : accel < -0.6 ? 0.3 : 0.5; // idling (a soft low note), pulling away, braking, cruising
      voice.a.frequency.setTargetAtTime(f, t, 0.08); voice.b.frequency.setTargetAtTime(f * 0.5, t, 0.08);
      voice.filter.frequency.setTargetAtTime(e.cut * (0.7 + 1.1 * r + 0.5 * load), t, 0.1);
      voice.gain.gain.setTargetAtTime(0.05 * e.vol * load * near(d, 14), t, 0.12);
      voice.pan.pan.setTargetAtTime(sideOf(listener, v.x, v.z, d), t, 0.1);
    }
  }

  return {
    get on() { return on; },
    // the loudness of what is playing now, 0 to 1 (root mean square), and how the audio context stands
    level() { if (!meter) return { rms: 0, state: 'off' }; const data = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(data); let sum = 0; for (const v of data) sum += v * v; return { rms: Math.sqrt(sum / data.length), state: ctx.state }; },
    async set(value) {
      on = Boolean(value);
      if (on && !ctx) build();
      if (!ctx) return on;
      if (on) await ctx.resume();
      master.gain.cancelScheduledValues(ctx.currentTime); master.gain.linearRampToValueAtTime(on ? 0.9 : 0, ctx.currentTime + 0.4);
      return on;
    },
    update({ traffic = [], sirens = [], ticks = [], listener, night = 0, day = 1 - night, rain = 0, wind = 0.1 }) {
      if (!ctx || !on || !listener) return;
      const t = ctx.currentTime, to = (param, value) => param.setTargetAtTime(value, t, 0.25);
      let load = 0, speed = 0;
      for (const v of traffic) { const d = Math.hypot(v.x - listener.x, v.z - listener.z), w = near(d, 22); load += w; speed += w * Math.min(v.v, 16) / 16; }
      // What you hear standing at a junction is not a steady hum: it is vehicles coming and going. So the low rumble and the tyres follow the traffic that is actually near (almost nothing between vehicles, a swell as
      // one passes), and the wind comes in slow gusts. Nothing here sits at a fixed level.
      const gust = 0.65 + 0.35 * Math.sin(t * 0.31) * Math.sin(t * 0.113 + 1.7);
      to(layers.road.gain.gain, Math.min(0.06, 0.004 + 0.011 * load)); to(layers.hiss.gain.gain, Math.min(0.05, 0.016 * speed));
      to(layers.rain.gain.gain, rain * 0.12); to(layers.wind.gain.gain, (0.006 + wind * 0.05) * gust);
      engines(traffic, listener, t);
      let loudest = 0, pan = 0;
      for (const s of sirens) { const dx = s.x - listener.x, dz = s.z - listener.z, d = Math.hypot(dx, dz), l = near(d, 45); if (l > loudest) { loudest = l; pan = (dx * listener.rx + dz * listener.rz) / (d || 1); } }
      to(layers.siren.gain.gain, loudest * 0.18); to(layers.siren.pan.pan, pan);
      crickets_(t, night * (1 - rain)); // they sing at night, and stop in the rain
      if (t >= nextTick && ticks.length) { // the pedestrian tick, 4 a second, from the nearest crossing that shows walk
        let best = null, bd = Infinity; for (const k of ticks) { const d = Math.hypot(k.x - listener.x, k.z - listener.z); if (d < bd) { bd = d; best = k; } }
        const gain = 0.16 * near(bd, 30); if (gain > 0.004) blip(1500, 0.035, gain, sideOf(listener, best.x, best.z, bd));
        nextTick = t + 0.25;
      }
      if (t >= nextHorn) { // now and then a driver sounds a horn, usually one of the nearer vehicles, and sometimes twice
        const close = traffic.map((v) => ({ v, d: Math.hypot(v.x - listener.x, v.z - listener.z) })).filter((o) => o.d < 120 && o.v.cls).sort((p, q) => p.d - q.d).slice(0, 12);
        if (close.length >= 3) {
          const { v, d } = close[Math.floor(Math.random() ** 2 * close.length)], e = ENGINES[v.cls] || ENGINES.car, gain = 0.2 * near(d, 40), pan = sideOf(listener, v.x, v.z, d);
          const long = Math.random() < 0.25; honk(e.horn, long ? 0.8 : 0.22, gain, pan);
          if (!long && Math.random() < 0.4) setTimeout(() => ctx && on && honk(e.horn, 0.22, gain, pan), 330);
        }
        nextHorn = t + 12 + Math.random() * 30 / Math.max(0.6, Math.min(2, close.length / 6)); // every so often, and a little more in busier traffic
      }
      if (t >= nextBird) { // a few birds by day, and long gaps between them: a tweet of two to four quick notes, each falling a little
        if (day > 0.6 && rain < 0.2 && Math.random() < 0.6) {
          const f = 2300 + Math.random() * 1300, pan = Math.random() * 1.6 - 0.8, notes = 2 + Math.floor(Math.random() * 3);
          for (let i = 0; i < notes; i += 1) setTimeout(() => ctx && on && blip(f * (1 + 0.08 * (i % 2)), 0.08, 0.024 * day, pan, -350), i * 120);
        }
        nextBird = t + 14 + Math.random() * 26;
      }
    },
  };
}
