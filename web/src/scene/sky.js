// The sky: the sun and the moon on their arcs, a sky that blends through dawn and dusk, stars, clouds, birds, and weather (cloud, rain, fog). Built in code, no image files.
// The caller gives it the hour of the day each frame. It sets the sun light, the hemisphere light and the fog, and hands back how dark it is, so the lamps and windows can follow.

import * as THREE from 'three';
import { roundFade } from './textures.js';
import { sunAt as sunPosition, sideOf, lerpAngle } from './sun.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const RAD = Math.PI / 180, TAU = Math.PI * 2;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const fract = (x) => x - Math.floor(x);

// Sunrise and sunset are fixed at 05:45 and 19:15, the same as `isNight` in sim/daily.js, so the road and the sky agree.
const MOON_PEAK = 58;

// Where the visitor is. The browser does not say without asking, and the page does not ask, so the time zone stands in for it: it names a city, and the city gives the latitude and longitude the
// sun needs. A zone that is not listed gets its middle meridian from its offset and a latitude of 35 degrees north, so the sun still sets about when the clock says it should.
const PLACES = {
  'Asia/Kolkata': [20.6, 79], 'Asia/Calcutta': [20.6, 79], 'Asia/Colombo': [7.9, 80.7], 'Asia/Dhaka': [23.8, 90.4], 'Asia/Karachi': [24.9, 67], 'Asia/Kathmandu': [27.7, 85.3],
  'Asia/Dubai': [25.2, 55.3], 'Asia/Riyadh': [24.7, 46.7], 'Asia/Tehran': [35.7, 51.4], 'Asia/Singapore': [1.35, 103.8], 'Asia/Kuala_Lumpur': [3.1, 101.7], 'Asia/Bangkok': [13.75, 100.5],
  'Asia/Jakarta': [-6.2, 106.85], 'Asia/Manila': [14.6, 121], 'Asia/Ho_Chi_Minh': [10.8, 106.6], 'Asia/Hong_Kong': [22.3, 114.2], 'Asia/Shanghai': [31.2, 121.5], 'Asia/Taipei': [25, 121.6],
  'Asia/Seoul': [37.6, 127], 'Asia/Tokyo': [35.7, 139.7],
  'Australia/Sydney': [-33.9, 151.2], 'Australia/Melbourne': [-37.8, 145], 'Australia/Brisbane': [-27.5, 153], 'Australia/Adelaide': [-34.9, 138.6], 'Australia/Perth': [-32, 115.9],
  'Australia/Darwin': [-12.5, 130.8], 'Australia/Hobart': [-42.9, 147.3], 'Pacific/Auckland': [-36.85, 174.8],
  'Europe/London': [51.5, -0.1], 'Europe/Paris': [48.9, 2.35], 'Europe/Berlin': [52.5, 13.4], 'Europe/Madrid': [40.4, -3.7], 'Europe/Rome': [41.9, 12.5], 'Europe/Moscow': [55.75, 37.6],
  'Europe/Istanbul': [41, 29], 'Africa/Cairo': [30, 31.2], 'Africa/Johannesburg': [-26.2, 28], 'Africa/Lagos': [6.5, 3.4], 'Africa/Nairobi': [-1.3, 36.8],
  'America/New_York': [40.7, -74], 'America/Chicago': [41.9, -87.6], 'America/Denver': [39.7, -105], 'America/Los_Angeles': [34.05, -118.2], 'America/Toronto': [43.65, -79.4],
  'America/Mexico_City': [19.4, -99.1], 'America/Sao_Paulo': [-23.55, -46.6], 'America/Argentina/Buenos_Aires': [-34.6, -58.4], 'America/Bogota': [4.7, -74.1],
};
const TZ_EAST = -new Date().getTimezoneOffset() / 60; // hours east of Greenwich, now
const PLACE = (() => {
  let zone = ''; try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* no Intl: the offset alone is used */ }
  const known = PLACES[zone];
  return known ? { lat: known[0], lon: known[1], known: true, city: zone.split('/').pop().replace(/_/g, ' ') } : { lat: 35, lon: TZ_EAST * 15, known: false, city: '' };
})();
export const VISITOR = PLACE; // `known` is false for a time zone that is not listed, and then the weather is not asked for either: a guessed place would give someone else's weather

const sunAt = (hour, day) => sunPosition(hour, day, PLACE.lat, PLACE.lon, TZ_EAST); // sun.js: the true height and bearing for this place
const SIDE = sideOf(PLACE.lat); // the sun crosses the sky south of overhead in the north and north of it in the south
const dayOfYear = (ms) => { const d = new Date(ms); return Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(d.getFullYear(), 0, 1)) / 86400000) + 1; };
const GLIDE = 1.5, OUTPUT_EASE = 0.12, WEATHER_EASE = 0.9; // seconds: about how long the sky takes to settle after a change
const SYNODIC = 29.530588853, NEW_MOON = Date.UTC(2000, 0, 6, 18, 14); // the length of a lunar month in days, and a known new moon

// The sky colours at a few heights of the sun, in degrees, blended between. Top is straight up, bottom is the horizon.
const PALETTE = [
  [-18, '#050a1d', '#17224a'], [-9, '#0d1740', '#35356a'], [-3, '#1d3a7a', '#d9776a'],
  [2, '#2f62b0', '#f4a868'], [9, '#3a7cc8', '#f6d4a2'], [25, '#2f86e0', '#bfe0f7'],
].map(([el, top, bottom]) => ({ el, top: new THREE.Color(top), bottom: new THREE.Color(bottom) }));

// How bright a sky is: the horizon counts most, since that is the part of the sky the ground sees most of. The day value is the clear sky at the highest height in the table.
const skyLuminance = (top, bottom) => .35 * (top.r * .3 + top.g * .55 + top.b * .15) + .65 * (bottom.r * .3 + bottom.g * .55 + bottom.b * .15);
const DAY_SKY_LUMINANCE = skyLuminance(PALETTE[PALETTE.length - 1].top, PALETTE[PALETTE.length - 1].bottom), SKY_LOOK_CURVE = 0.75, TWILIGHT_AMBIENT = 1.1;

// What each kind of weather asks for. `cover` is how much of the sky is cloud, `dark` how much it dims the light, `rain` the rain, `mist` the fog.
const WEATHER = {
  clear: { cover: .1, dark: 0, rain: 0, mist: 0 },
  partly: { cover: .5, dark: .1, rain: 0, mist: 0 },
  overcast: { cover: 1, dark: .5, rain: 0, mist: .1 },
  rain: { cover: 1, dark: .75, rain: 1, mist: .35 },
  fog: { cover: .6, dark: .3, rain: 0, mist: 1 },
};
export const WEATHER_NAMES = Object.keys(WEATHER);

// One weather for the whole of a real day, picked from the date, so a visitor sees the same sky all day and a different one tomorrow.
function weatherOfDay(dayNumber) {
  const r = fract(Math.sin(dayNumber * 127.1 + 311.7) * 43758.5453);
  return r < .4 ? 'clear' : r < .65 ? 'partly' : r < .8 ? 'overcast' : r < .92 ? 'rain' : 'fog';
}

export const moonPhase = (ms) => fract((ms - NEW_MOON) / 86400000 / SYNODIC); // 0 new, 0.5 full

function paletteAt(el) {
  const top = new THREE.Color(), bottom = new THREE.Color();
  let i = 0;
  while (i < PALETTE.length - 2 && el > PALETTE[i + 1].el) i += 1;
  const a = PALETTE[i], b = PALETTE[i + 1], t = Math.min(1, Math.max(0, (el - a.el) / (b.el - a.el)));
  return { top: top.copy(a.top).lerp(b.top, t), bottom: bottom.copy(a.bottom).lerp(b.bottom, t) };
}

const direction = (el, az, out = new THREE.Vector3()) => out.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)); // east is +x, south is +z

const glowTexture = () => roundFade(128, [[0, .55], [.25, .16], [1, 0]]); // the glow round the moon

export function createSky(scene, { sun, hemi }) {
  const dome = new THREE.Group(); dome.renderOrder = -3; scene.add(dome); // follows the camera, so it is always at the same distance

  // ---- the dome: a gradient, a glow on the horizon where the sun is, and the sun itself ----
  const domeMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, glow: { value: 1 }, dusk: { value: 0 }, duskColor: { value: new THREE.Color('#ff8f4a') } },
    vertexShader: 'varying vec3 p; void main() { p = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; uniform float glow; uniform float dusk; uniform vec3 duskColor; varying vec3 p;
      void main() {
        float t = clamp(p.y * 1.7, 0.0, 1.0);
        vec3 col = mix(bottom, top, pow(t, 0.65));
        float s = max(dot(normalize(p), sunDir), 0.0);
        vec3 side = normalize(vec3(sunDir.x, 0.0, sunDir.z) + 1e-5);
        float band = pow(max(dot(normalize(vec3(p.x, 0.0, p.z) + 1e-5), side), 0.0), 3.0) * (1.0 - smoothstep(0.0, 0.5, p.y));
        col += dusk * duskColor * band * 0.55;
        col += glow * (vec3(1.0, 0.93, 0.75) * pow(s, 900.0) * 2.0 + vec3(1.0, 0.82, 0.55) * pow(s, 28.0) * 0.12);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const domeMesh = new THREE.Mesh(new THREE.SphereGeometry(1450, 32, 16), domeMaterial); domeMesh.renderOrder = -3; dome.add(domeMesh);

  // ---- stars: a few thousand points, with a faint band of the Milky Way, turning slowly through the night ----
  const STARS = 2600, starPos = new Float32Array(STARS * 3), starSize = new Float32Array(STARS), starPhase = new Float32Array(STARS), starTint = new Float32Array(STARS * 3);
  const bandAxis = new THREE.Vector3(.3, .8, -.5).normalize(), bandU = new THREE.Vector3(1, 0, 0).cross(bandAxis).normalize(), bandV = bandAxis.clone().cross(bandU);
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < STARS; i += 1) {
    const v = new THREE.Vector3();
    if (i < STARS * .3) { const a = rnd() * TAU, spread = (rnd() + rnd() + rnd() - 1.5) * .22; v.copy(bandU).multiplyScalar(Math.cos(a)).addScaledVector(bandV, Math.sin(a)).addScaledVector(bandAxis, spread).normalize(); }
    else { const z = rnd() * 2 - 1, a = rnd() * TAU, r = Math.sqrt(1 - z * z); v.set(r * Math.cos(a), z, r * Math.sin(a)); }
    starPos.set([v.x * 1400, v.y * 1400, v.z * 1400], i * 3);
    const bright = rnd() ** 6; starSize[i] = 1.2 + bright * 2.6 + (i < STARS * .3 ? -.4 : 0); starPhase[i] = rnd() * TAU;
    const warm = rnd(); starTint.set([.8 + .2 * warm, .86 + .1 * warm, 1 - .25 * warm], i * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3)); starGeo.setAttribute('size', new THREE.BufferAttribute(starSize, 1));
  starGeo.setAttribute('phase', new THREE.BufferAttribute(starPhase, 1)); starGeo.setAttribute('tint', new THREE.BufferAttribute(starTint, 3));
  const starMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
    uniforms: { alpha: { value: 0 }, time: { value: 0 }, scale: { value: 1 } },
    vertexShader: `attribute float size; attribute float phase; attribute vec3 tint; uniform float time; uniform float scale; varying vec3 c; varying float a;
      void main() {
        vec3 d = normalize(position);
        a = smoothstep(0.02, 0.22, d.y) * (0.75 + 0.25 * sin(time * 2.1 + phase * 3.0));
        c = tint;
        gl_PointSize = size * scale;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `uniform float alpha; varying vec3 c; varying float a;
      void main() { float r = length(gl_PointCoord - 0.5) * 2.0; float k = 1.0 - smoothstep(0.2, 1.0, r); gl_FragColor = vec4(c, min(1.0, k * a * alpha * 1.8)); }`,
  });
  const stars = new THREE.Points(starGeo, starMaterial); stars.renderOrder = -2; stars.frustumCulled = false;
  const starSpin = new THREE.Group(); starSpin.add(stars); dome.add(starSpin);
  const starAxis = new THREE.Vector3(.35, .8, -.4).normalize();

  // ---- the moon: a disc lit from the side by the phase, with dark seas, and earthshine on the unlit part ----
  const moonUniforms = { toSun: { value: new THREE.Vector3(0, 0, 1) }, bright: { value: 1 } };
  const moonMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, uniforms: moonUniforms,
    vertexShader: 'varying vec3 n; varying vec3 q; void main() { n = normalize(position); q = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 toSun; uniform float bright; varying vec3 n; varying vec3 q;
      float h(vec3 x) { return fract(sin(dot(x, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      float noise(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z); }
      void main() {
        float lit = smoothstep(-0.04, 0.08, dot(n, toSun));
        float seas = noise(n * 3.2) * 0.55 + noise(n * 9.0) * 0.3;
        vec3 surface = mix(vec3(0.62, 0.62, 0.6), vec3(0.97, 0.96, 0.9), seas);
        vec3 col = surface * lit * bright + vec3(0.05, 0.07, 0.11) * (1.0 - lit) * 0.3;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const moonGroup = new THREE.Group(); dome.add(moonGroup);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(34, 32, 20), moonMaterial); moon.renderOrder = -1; moonGroup.add(moon);
  const moonGlow = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xa9c0ff, fog: false, opacity: .5 }));
  moonGlow.renderOrder = -1.5; moonGlow.position.z = -2; moonGroup.add(moonGlow);

  // ---- clouds: each is a few merged blobs. How many are showing, and how big, follows the cover. ----
  const CLOUDS = 38, cloudMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: .38, roughness: 1, flatShading: true }), clouds = [];
  for (let i = 0; i < CLOUDS; i += 1) {
    const parts = [], count = 6 + (i % 4);
    for (let j = 0; j < count; j += 1) {
      const r = 11 + rnd() * 9, g = new THREE.IcosahedronGeometry(r, 1); g.scale(1.25, .55, 1);
      g.translate((j - count / 2) * 15 + rnd() * 7, (j % 2) * 3 + rnd() * 3, (rnd() - .5) * 26); parts.push(g);
    }
    const mesh = new THREE.Mesh(mergeGeometries(parts), cloudMaterial);
    mesh.position.set((rnd() - .5) * 900, 125 + rnd() * 70, (rnd() - .5) * 900); mesh.rotation.y = rnd() * Math.PI;
    mesh.userData = { threshold: i / CLOUDS, scale: .75 + rnd() * .6 }; scene.add(mesh); clouds.push(mesh);
  }

  // ---- birds: a few flocks in a loose V, circling over the city by day ----
  const birdMaterial = new THREE.MeshBasicMaterial({ color: 0x2b2f36, side: THREE.DoubleSide });
  const wingGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, .25, 0, 0, -.18, .85, .02, -.1], 3)); // a swept triangle, from the body out along +x
  const bodyGeo = new THREE.ConeGeometry(.09, .55, 5).rotateX(-Math.PI / 2);
  const makeBird = () => {
    const bird = new THREE.Group(), left = new THREE.Group(), right = new THREE.Group();
    bird.add(new THREE.Mesh(bodyGeo, birdMaterial));
    const lw = new THREE.Mesh(wingGeo, birdMaterial), rw = new THREE.Mesh(wingGeo, birdMaterial); rw.scale.x = -1; left.add(lw); right.add(rw); bird.add(left, right);
    bird.scale.setScalar(1.1); bird.userData = { left, right };
    return bird;
  };
  const flocks = [[7, 95, 66, .6, 0], [5, 140, 82, .9, 2.1], [9, 70, 58, 1.1, 4.0], [4, 120, 90, .75, 5.2]].map(([size, radius, height, spin, phase], k) => {
    const birds = Array.from({ length: size }, () => { const b = makeBird(); scene.add(b); return b; });
    return { birds, radius, height, spin, phase, centre: [(k - 1.5) * 35, 0] };
  });

  // ---- rain: streaks that fall in a column round the camera target and wrap, all moved on the graphics card ----
  const DROPS = 7000, rainBase = new Float32Array(DROPS * 2 * 3), rainEnd = new Float32Array(DROPS * 2);
  for (let i = 0; i < DROPS; i += 1) { const x = (rnd() - .5) * 120, y = rnd() * 70, z = (rnd() - .5) * 120; for (let e = 0; e < 2; e += 1) { rainBase.set([x, y, z], (i * 2 + e) * 3); rainEnd[i * 2 + e] = e; } }
  const rainGeo = new THREE.BufferGeometry(); rainGeo.setAttribute('position', new THREE.BufferAttribute(rainBase, 3)); rainGeo.setAttribute('end', new THREE.BufferAttribute(rainEnd, 1));
  const rainMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, uniforms: { time: { value: 0 }, rain: { value: 0 }, centre: { value: new THREE.Vector3() } },
    vertexShader: `attribute float end; uniform float time; uniform vec3 centre; uniform float rain; varying float a;
      void main() {
        float y = mod(position.y - time * 24.0, 70.0);
        vec2 off = mod(position.xz - centre.xz + 60.0, 120.0) - 60.0;
        vec3 p = vec3(centre.x + off.x + y * 0.15 + end * 0.14, y + end * 0.9, centre.z + off.y);
        a = rain * 0.32 * smoothstep(0.0, 2.0, y);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: 'varying float a; void main() { gl_FragColor = vec4(0.72, 0.8, 0.9, a); }',
  });
  const rainLines = new THREE.LineSegments(rainGeo, rainMaterial); rainLines.frustumCulled = false; rainLines.visible = false; scene.add(rainLines);

  // ---- state ----
  const view = { sunEl: -20 * RAD, sunAz: 0, moonEl: -30 * RAD, moonAz: 0 }; // what is shown now, eased toward where it should be
  const now = { cover: .1, dark: 0, rain: 0, mist: 0, wet: 0 };
  let weatherChoice = 'auto', liveWeather = null, first = true, lastWeather = 'clear', startedAt = null, lastMs = 0, snapWeather = false; // liveWeather: the weather now near the visitor, when it could be fetched
  // The lighting is eased in time. The sun's height passes through the narrow band of dusk in a fraction of a second whenever the look is switched, so the outputs themselves (the sky colours,
  // the strength of the sun and the moon, how dark it is) glide to their new values over a few seconds. In the normal run of a day they barely lag.
  const memo = {}; let easeK = 1, lastLock = null, glide = null, lastEl = 0, lampLag = 0;
  const LAMP_ON_LAG = 5, LAMP_OFF_LAG = 1.5; // degrees of the sun's height
  const BAND_LO = -3 * RAD, BAND_HI = 18 * RAD, OUTSIDE = .12; // the heights where the light changes, which the glide takes most of its time over
  const warp = (a) => (a < BAND_LO ? BAND_LO + (a - BAND_LO) * OUTSIDE : a > BAND_HI ? BAND_HI + (a - BAND_HI) * OUTSIDE : a);
  const unwarp = (u) => (u < BAND_LO ? BAND_LO + (u - BAND_LO) / OUTSIDE : u > BAND_HI ? BAND_HI + (u - BAND_HI) / OUTSIDE : u);
  const ease = (key, value) => (memo[key] = memo[key] === undefined ? value : memo[key] + (value - memo[key]) * easeK);
  const easeColour = (key, colour) => { const m = memo[key] || (memo[key] = colour.clone()); m.lerp(colour, easeK); return m; };
  const sunDir = new THREE.Vector3(), moonDir = new THREE.Vector3(), lightDir = new THREE.Vector3(), tmp = new THREE.Color(), grey = new THREE.Color();

  function update({ hour, ms, time, dt, lock = null, centre, pixelRatio = 1, calm = 1 }) {
    // where the sun and the moon should be
    const phase = moonPhase(ms), illum = (1 - Math.cos(TAU * phase)) / 2;
    const where = sunAt(hour, dayOfYear(ms)), hm = (((hour - 24 * phase) % 24) + 24) % 24, um = (hm - 6) / 12;
    let want = { sunEl: where.el, sunAz: where.az, moonEl: MOON_PEAK * RAD * Math.sin(Math.PI * um), moonAz: SIDE * Math.PI * um }; // the moon rises in the east and sets in the west, over the same side of the sky as the sun
    // the held lights have no clock, so their bearings are chosen: noon and night near south (north in the southern hemisphere), and the dawn and dusk in the south-east and south-west, as in a winter day
    if (lock === 1) want = { sunEl: -30 * RAD, sunAz: SIDE * 1.9, moonEl: 42 * RAD, moonAz: SIDE * 1.9 }; // the sun sets and the moon rises in the same direction, so the shadows only shorten and do not swing round
    if (lock === 0) want = { sunEl: 56 * RAD, sunAz: SIDE * 1.55, moonEl: -30 * RAD, moonAz: SIDE * 1.9 };
    if (lock === 'dawn') want = { sunEl: 8 * RAD, sunAz: SIDE * 0.5, moonEl: 8 * RAD, moonAz: SIDE * (Math.PI - 0.35) }; // the sun just up in the east, the moon low in the west
    if (lock === 'dusk') want = { sunEl: 7 * RAD, sunAz: SIDE * 2.2, moonEl: 8 * RAD, moonAz: SIDE * 0.35 }; // the sun low in the west, the moon rising in the east
    easeK = first ? 1 : 1 - Math.exp(-dt / OUTPUT_EASE);
    // A switch to day or night moves the sun and the moon over GLIDE seconds, and every output below (the sky, the lights, the shadows, the windows) is worked out from where they are, so all of it
    // moves together. The sun's height is stretched through the dusk, where nearly everything changes, so that stays a smooth change and not a flash. In the normal run of a day the sky just follows the clock.
    const firstFrame = first;
    if (startedAt === null) startedAt = ms;
    lastMs = ms;
    if (first) { Object.assign(view, want); lastLock = lock; }
    else if (lock !== lastLock) { glide = { t: 0, from: { ...view } }; lastLock = lock; }
    first = false;
    if (glide) {
      glide.t += dt; const p = Math.min(1, glide.t / GLIDE), e = p;
      for (const key of ['sunEl', 'moonEl']) view[key] = unwarp(lerp(warp(glide.from[key]), warp(want[key]), e));
      for (const key of ['sunAz', 'moonAz']) view[key] = lerpAngle(glide.from[key], want[key], e);
      if (p >= 1) glide = null;
    } else Object.assign(view, want);
    const el = view.sunEl / RAD;
    // The first frame starts from the state it should be in, not from a default that then eases to it. The lamps' lag depends on whether the sun is going down or coming up (evening or morning),
    // which is not known from a single height, and the weather starts clear, so a page opened at dusk showed the lamps lit, then dimmed, then slowly lit again as the weather came in.
    if (firstFrame) { lastEl = el; lampLag = lock === 1 || lock === 'dusk' ? LAMP_ON_LAG : lock === 0 || lock === 'dawn' ? -LAMP_OFF_LAG : hour >= 12 ? LAMP_ON_LAG : -LAMP_OFF_LAG; }
    direction(view.sunEl, view.sunAz, sunDir); direction(view.moonEl, view.moonAz, moonDir);

    // weather: the chosen one, or the one for today, eased in
    const name = weatherChoice === 'auto' ? liveWeather || weatherOfDay(Math.floor((ms + TZ_EAST * 3600000) / 86400000)) : weatherChoice; lastWeather = name;
    const target = { ...WEATHER[name] };
    if (name === 'fog' && weatherChoice === 'auto' && !liveWeather) target.mist = 1 - .85 * smooth(7.5, 11.5, hour); // fog lifts in the morning
    const weatherK = 1 - Math.exp(-dt / WEATHER_EASE);
    const settle = firstFrame || snapWeather; snapWeather = false; // the first frame, and the live weather if it arrives in the first few seconds, are the starting state and are not eased in
    for (const key of ['cover', 'dark', 'rain', 'mist']) now[key] = settle ? target[key] : lerp(now[key], target[key], weatherK);
    if (settle) { now.wet = target.rain > .3 ? 1 : 0; easeK = 1; } // easeK 1: the sky colours and the lamps, which ease toward what the weather gives, take it at once too
    now.wet = now.rain > .3 ? lerp(now.wet, 1, Math.min(1, dt * .15)) : lerp(now.wet, 0, Math.min(1, dt * .012)); // the roads dry slowly

    // the colour of the sky, grayed and dimmed by cloud
    const { top, bottom } = paletteAt(el), dusk = smooth(-12, -2, el) * (1 - smooth(2, 12, el));
    const grayMix = Math.min(1, now.cover * now.cover * .65 + now.mist * .5 + now.rain * .15);
    for (const c of [top, bottom]) { const l = c.r * .3 + c.g * .55 + c.b * .15; grey.setRGB(l, l, l * 1.03); c.lerp(grey, grayMix).multiplyScalar(1 - .38 * now.dark); }
    const topNow = easeColour('top', top), bottomNow = easeColour('bottom', bottom);
    domeMaterial.uniforms.top.value.copy(topNow); domeMaterial.uniforms.bottom.value.copy(bottomNow);
    domeMaterial.uniforms.sunDir.value.copy(sunDir);
    domeMaterial.uniforms.glow.value = ease('glow', (1 - smooth(-3, 3, -el)) * (1 - now.cover * .9));
    domeMaterial.uniforms.dusk.value = ease('dusk', dusk * (1 - now.cover * .7));
    scene.fog.color.copy(bottomNow);
    scene.fog.near = lerp(150, 22, Math.min(1, now.mist + now.rain * .3)); scene.fog.far = lerp(340, 250, Math.min(1, now.mist + now.rain * .3));

    // how dark it is, from the sun's height. The windows and lamps follow this.
    const night = ease('night', 1 - smooth(-6, 5, el)), day = ease('day', smooth(-1, 14, el));

    // When the lamps, windows and headlights are on follows how bright it is: the light from the sun, dimmed by rain and cloud. As the daylight fades they come on a few at a time, and by the time it
    // is dark they are all on. The same happens in the daytime when rain or heavy cloud darkens it. The moon does not turn them off.
    // The lamps and windows come on a little after the sun has gone down, and go off a little after it has come up, so they are never lit in strong daylight and are not cut off in the first light.
    if (Math.abs(el - lastEl) > 1e-5) { lampLag = el < lastEl ? LAMP_ON_LAG : -LAMP_OFF_LAG; lastEl = el; }
    if (lock === 'dusk') lampLag = LAMP_ON_LAG; else if (lock === 'dawn') lampLag = -LAMP_OFF_LAG; // a held dusk or dawn looks the same however it was reached (the lamps are lit by the evening's lag, or the morning's)
    const brightness = smooth(-1, 14, el + ease('lampLag', lampLag)) * (1 - .72 * now.dark); // from the sun's height itself, not the eased `day`, so the lights are eased once and keep up with the sky
    const lights = ease('lights', 1 - smooth(.12, .8, brightness));

    // the lights
    const sunI = ease('sunI', 3.3 * day * (1 - .72 * now.dark)), moonUp = smooth(-2, 10, view.moonEl / RAD);
    const moonI = ease('moonI', night * (.35 + .5 * illum * moonUp) * (1 - .35 * now.dark));
    lightDir.copy(sunDir).multiplyScalar(sunI).addScaledVector(moonDir, moonI * 1.0).normalize();
    const lightEl = Math.max(Math.asin(lightDir.y), 14 * RAD), horizontal = Math.hypot(lightDir.x, lightDir.z) || 1; // no long flat shadows, and the light never from below
    sun.position.set(lightDir.x / horizontal * Math.cos(lightEl), Math.sin(lightEl), lightDir.z / horizontal * Math.cos(lightEl)).multiplyScalar(80);
    sun.intensity = sunI + moonI;
    sun.color.copy(easeColour('sunColour', new THREE.Color('#ff8a3d').lerp(tmp.set('#ffe7bd'), smooth(0, 22, el)).lerp(tmp.set('#9fb4ff'), moonI / (sunI + moonI + 1e-4))));
    // The light the sky gives the ground follows how bright the sky is, so the ground and the sky always look like the same moment. A low sun lights the sky long before it is dark on the ground
    // would suggest from the sun's height alone: at dusk the sky is still half as bright as at noon. `skyLook` is the sky's brightness (its horizon and its top, after cloud and rain have dimmed and greyed
    // them) as a share of a clear day's, and the sky's own light on the ground (the hemisphere light) is never less than that share of its day strength. The sun's direct light is still its own.
    const skyLook = Math.min(1, ease('skyLook', skyLuminance(topNow, bottomNow) / DAY_SKY_LUMINANCE) ** SKY_LOOK_CURVE), lookDay = Math.max(day, skyLook);
    const afterglow = TWILIGHT_AMBIENT * skyLook ** 1.1 * (1 - day); // the sky's own light on the ground while the sun is low or gone, at its strongest at dusk and dawn
    hemi.intensity = (.5 + .28 * lookDay) * (1 + .25 * now.cover) + afterglow * (1 - .5 * now.cover);
    hemi.color.set('#6a7fb8').lerp(tmp.set('#cfe4ff'), lookDay);

    // the stars, the moon, the clouds
    starMaterial.uniforms.alpha.value = ease('stars', smooth(6, 14, -el) * (1 - now.cover * .95) * (1 - .5 * illum * moonUp) * (1 - now.mist * .9));
    starMaterial.uniforms.time.value = time; starMaterial.uniforms.scale.value = pixelRatio * 1.9;
    starSpin.quaternion.setFromAxisAngle(starAxis, (hour / 24) * TAU);
    moonGroup.position.copy(moonDir).multiplyScalar(1330); moonGroup.lookAt(0, 0, 0); moonGroup.rotateY(Math.PI); // the visible face turns to the middle
    moonGroup.visible = view.moonEl > -4 * RAD;
    moonMaterial.uniforms.bright.value = 1 + .15 * night; moonGlow.material.opacity = .55 * (illum * .8 + .2) * (1 - now.cover * .85) * (night * .9 + .1) * (1 - day);
    const sideSun = Math.sin(TAU * phase); // the lit side, in the moon's own frame, east to west
    moonUniforms.toSun.value.set(-sideSun * .98, .08, Math.cos(TAU * phase));
    const cloudColour = tmp.set('#ffffff').lerp(grey.set('#5b6573'), now.dark * .9).lerp(grey.set('#ff9a6a'), dusk * .5 * (1 - now.cover)).multiplyScalar(lerp(1, .22, night));
    cloudMaterial.color.copy(cloudColour); cloudMaterial.emissive.copy(cloudColour); cloudMaterial.emissiveIntensity = .38 * (1 - night * .85);
    for (const c of clouds) {
      const grow = smooth(c.userData.threshold * .9, c.userData.threshold * .9 + .14, now.cover), s = c.userData.scale * (1 + .7 * now.cover) * grow;
      c.visible = s > .02; c.scale.set(s, s * (1 - .25 * now.cover), s);
      c.position.x += dt * calm * (1.2 + 1.5 * now.cover); if (c.position.x > 560) c.position.x = -560;
    }

    // birds by day, not in rain or fog
    const birdsOut = day > .25 && now.rain < .25 && now.mist < .6;
    for (const f of flocks) {
      for (const [i, bird] of f.birds.entries()) {
        bird.visible = birdsOut; if (!birdsOut) continue;
        const a = f.phase + time * f.spin * 9 / f.radius * 1.0, rank = Math.ceil(i / 2), side = i === 0 ? 0 : i % 2 ? 1 : -1;
        const cx = f.centre[0] + Math.cos(a) * f.radius, cz = f.centre[1] + Math.sin(a) * f.radius, heading = Math.atan2(Math.cos(a), -Math.sin(a)); // along the circle
        const ox = side * rank * 2.6, oz = rank * 2.2; // behind and to the side, in the flock's own frame
        const c = Math.cos(heading), s = Math.sin(heading);
        bird.position.set(cx + ox * s + oz * -c, f.height + Math.sin(time * 1.3 + i * 1.7) * 1.4 + (i % 3) * .8, cz + -ox * c + oz * -s);
        bird.rotation.set(0, -heading + Math.PI / 2, Math.sin(a * 3) * .12);
        const flap = Math.sin(time * (7 + i % 3) + i) * .75 + (Math.sin(time * .5 + i) > .7 ? -.7 : 0); // now and then a glide
        bird.userData.left.rotation.z = flap; bird.userData.right.rotation.z = -flap;
      }
    }

    // rain
    rainLines.visible = now.rain > .02; rainMaterial.uniforms.rain.value = now.rain; rainMaterial.uniforms.time.value = time; rainMaterial.uniforms.centre.value.set(centre ? centre.x : 0, 0, centre ? centre.z : 0);
    return { night, lights, day, look: skyLook, wet: now.wet, rain: now.rain, cover: now.cover, el, illum, phase, weather: lastWeather, sunDir, moonDir };
  }

  return {
    group: dome, update,
    follow(position) { dome.position.copy(position); },
    setWeather(name) { weatherChoice = name; },
    jump() { first = true; }, // the next frame takes the time of day, the weather and the lamps as they should be, as on a page just opened, with nothing eased in (for making the training set)
    setLiveWeather(name) { if (liveWeather === null && startedAt !== null && lastMs - startedAt < 6000) snapWeather = true; liveWeather = name; },
    get liveWeather() { return liveWeather; },
    get weather() { return weatherChoice; },
  };
}
