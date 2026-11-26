// The flat 2D view: the junction from above, drawn on one canvas from the same simulator. It is the page for a browser without WebGL, or one where the 3D scene fails to start, and
// it is what `?flat` shows. It has the same dock, the same Results sheet and the controls that make sense without a 3D scene.
import { Simulation, PRESETS } from '../sim/traffic.js';
import { CAMERA_RIG } from '../sim/world.js';
import { LANE_X, STOP_Y, CROSSING_HALF, pedestrianPose, rotate as rot } from '../sim/tracks.js';
import { createShell } from './shell.js';
import { dayName, clockOf } from './names.js';
import { createSound } from './sound.js';

const HALF_ROAD = 9.6, VIEW = 62; // metres of road shown from the middle to each edge of the screen
const STEP = 0.1;
const COLOURS = { car: '#5b8def', van: '#9fb6ff', truck: '#c98f4a', semi: '#a8794a', bus: '#e5b92f', artbus: '#e5b92f', bike: '#7e5bb5', scooter: '#4cb7a5', amb: '#f4f4f0', fire: '#d44b3a', police: '#2f3e6b' };
const LIGHT = { green: '#35c759', yellow: '#ffcc00', red: '#ff453a' };

const status = document.getElementById('status'); if (status) status.remove();
const canvas = document.createElement('canvas'); canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'The junction from above, with the vehicles and people on it');
document.body.prepend(canvas);
const ctx = canvas.getContext('2d');

// The page opens at the visitor's own time of day and day of the week, as the 3D page does.
const now = new Date(), weekSecond = ((now.getDay() + 6) % 7) * 86400 + now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
const sim = new Simulation({ seed: 11, mode: 'adaptive', demand: { ...PRESETS.clock, clockStartS: weekSecond - 600 }, ...CAMERA_RIG, config: { default_green: 40 } });
for (let i = 0; i < 1200; i += 1) sim.step(); // two minutes already running, so the queues are there when the page opens
let speed = 1, acc = 0, last = performance.now(), size = { w: 0, h: 0, scale: 1 };

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2), w = innerWidth, h = innerHeight;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
  size = { w, h, scale: Math.min(w, h) / (2 * VIEW) * 1.55, dpr };
}
addEventListener('resize', resize); resize();

// a colour that is `day` by day and `night` at night, blended by how far into night the page is
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const pick = (day, night, n) => { const a = rgb(day), b = rgb(night); return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * n)).join(',')})`; };
const clockText = () => { const t = Math.floor(sim.controller.clockStart + sim.snapshot.time) % 86400; return `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}`; };
const hour = () => (((sim.controller.clockStart + sim.snapshot.time) % 86400) / 3600);
const isDark = () => hour() < 5.75 || hour() >= 19.25;

const oneOf = (list) => list[Math.floor(Math.random() * list.length)];
const sound = createSound();
const shell = createShell({
  weatherNames: [], cameras: [], features: { light: false, weather: false, view: false, camera: false },
  hooks: {
    setMode: (fixed) => sim.setMode(fixed ? 'fixed' : 'adaptive'),
    setSpeed: (n) => { speed = n; },
    setSound: (on) => sound.set(on),
    ambulance: (approach) => sim.dispatchEmergency(approach, oneOf(['through', 'through', 'left', 'right']), oneOf(['amb', 'amb', 'fire', 'police'])),
    press: (approach) => sim.pressButton(approach),
  },
});

function draw(n) {
  const { w, h, scale, dpr } = size, dark = n > .5;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = pick('#dfe6d6', '#1b2233', n); ctx.fillRect(0, 0, w, h);
  ctx.save(); ctx.translate(w / 2, h / 2); ctx.scale(scale, scale);
  const reach = Math.hypot(w, h) / scale; // far enough to run off every edge of the screen
  // footpaths first, then the roads over them, so each road cuts the other's footpath
  ctx.fillStyle = pick('#d6d2c8', '#3a3f4a', n);
  for (const s of [-1, 1]) { ctx.fillRect(-reach, s * HALF_ROAD + (s > 0 ? 0 : -3.6), 2 * reach, 3.6); ctx.fillRect(s * HALF_ROAD + (s > 0 ? 0 : -3.6), -reach, 3.6, 2 * reach); }
  ctx.fillStyle = pick('#43474d', '#2a2f3a', n);
  ctx.fillRect(-reach, -HALF_ROAD, 2 * reach, 2 * HALF_ROAD); ctx.fillRect(-HALF_ROAD, -reach, 2 * HALF_ROAD, 2 * reach);
  // lane lines and the stop lines
  ctx.strokeStyle = dark ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.8)'; ctx.lineWidth = .12; ctx.setLineDash([2, 3]);
  for (let k = 0; k < 4; k += 1) for (const x of [3.2, 6.4]) { const [ax, az] = rot(k, x, -reach), [bx, bz] = rot(k, x, STOP_Y); ctx.beginPath(); ctx.moveTo(ax, az); ctx.lineTo(bx, bz); ctx.stroke(); }
  ctx.setLineDash([]); ctx.lineWidth = .35;
  for (let k = 0; k < 4; k += 1) { const [ax, az] = rot(k, 0, STOP_Y), [bx, bz] = rot(k, HALF_ROAD, STOP_Y); ctx.beginPath(); ctx.moveTo(ax, az); ctx.lineTo(bx, bz); ctx.stroke(); }
  // the crossings, red or green with the pedestrian signal
  const snap = sim.snapshot;
  for (let k = 0; k < 4; k += 1) {
    const sig = snap.signals[`C${k + 1}`], [cx, cz] = rot(k, HALF_ROAD / 2, STOP_Y - 3);
    ctx.save(); ctx.translate(cx, cz); ctx.rotate(k * Math.PI / 2); ctx.fillStyle = sig === 'walk' ? 'rgba(53,199,89,.55)' : sig === 'clear' ? 'rgba(255,204,0,.5)' : 'rgba(255,255,255,.28)'; ctx.fillRect(-HALF_ROAD / 2, -1.6, HALF_ROAD, 3.2); ctx.restore();
  }
  // vehicles, from the front and rear axle
  for (const v of sim.vehicleList) {
    const c = v.pose, x = (c.fx + c.rx) / 2, z = (c.fz + c.rz) / 2, a = Math.atan2(c.fz - c.rz, c.fx - c.rx);
    ctx.save(); ctx.translate(x, z); ctx.rotate(a); ctx.fillStyle = COLOURS[v.cls] || '#7a8696'; ctx.fillRect(-v.length / 2, -v.width / 2, v.length, v.width);
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(v.length / 2 - v.length * .22, -v.width / 2 + .15, v.length * .18, v.width - .3); // the windscreen at the front
    if (v.cls === 'amb' || v.cls === 'fire' || v.cls === 'police') { ctx.fillStyle = Math.floor(performance.now() / 160) % 2 ? '#ff453a' : '#4aa3ff'; ctx.fillRect(-.4, -.45, .8, .9); }
    ctx.restore();
  }
  // people
  ctx.fillStyle = pick('#1d2125', '#f2efe6', n);
  for (const p of sim.pedestrians) { const q = pedestrianPose(p); ctx.beginPath(); ctx.arc(q.x, q.z, .45, 0, Math.PI * 2); ctx.fill(); }
  // the signal heads: a dot at each stop line for the through lanes and one for the right turn arrow
  for (let k = 0; k < 4; k += 1) {
    const [x, z] = rot(k, HALF_ROAD + .9, STOP_Y), [rx, rz] = rot(k, HALF_ROAD + .9, STOP_Y + 1.4);
    ctx.fillStyle = LIGHT[snap.signals[`T${k + 1}`]] || LIGHT.red; ctx.beginPath(); ctx.arc(x, z, .7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = LIGHT[snap.signals[`R${k + 1}`]] || LIGHT.red; ctx.beginPath(); ctx.arc(rx, rz, .4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

let nightNow = isDark() ? 1 : 0;
function frame(t) {
  const dt = Math.min((t - last) / 1000, .1); last = t; acc += dt * speed;
  nightNow += ((isDark() ? 1 : 0) - nightNow) * (1 - Math.exp(-dt / .35)); shell.light(nightNow); // the page eases into night and back
  let steps = 0; while (acc >= STEP && steps < 40) { sim.step(); acc -= STEP; steps += 1; } if (steps >= 40) acc = 0;
  draw(nightNow); requestAnimationFrame(frame);
}
setInterval(() => { const week = sim.controller.clockStart + sim.snapshot.time; shell.update({ clockText: clockOf(week), dayText: dayName(week), snap: sim.snapshot, summary: { ...sim.summary(), queueNow: sim.queuedNow() } }); }, 250);
setInterval(() => { // the listener stands in the middle of the junction, looking north
  const traffic = [], sirens = [], ticks = [];
  for (const v of sim.vehicleList) { const c = v.pose, x = (c.fx + c.rx) / 2, z = (c.fz + c.rz) / 2; traffic.push({ id: v.id, cls: v.cls, x, z, v: v.v }); if (v.cls === 'amb' || v.cls === 'fire' || v.cls === 'police') sirens.push({ x, z }); }
  for (let k = 0; k < 4; k += 1) if (sim.snapshot.signals[`C${k + 1}`] === 'walk') { const [x, z] = rot(k, 0, STOP_Y - 3); ticks.push({ x, z }); }
  sound.update({ traffic, sirens, ticks, listener: { x: 0, z: 0, rx: 1, rz: 0 }, night: isDark() ? 1 : 0, rain: 0, wind: 0.1 });
}, 100);
requestAnimationFrame(frame);
