// The 3D page: the scene, the people, the vehicles, the signals and the lighting. Loaded by index.html when the browser has WebGL. The page around it is src/page/shell.js.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Simulation, PRESETS } from '../sim/traffic.js';
import { parkFactor, pedestrianFactor } from '../sim/daily.js';
import { buildVehicle, headMat, beamMat, GLOSS, MATTE } from './vehicles.js';
import { beamFree, easeBeam, pickBeams } from './headlight-aim.js';
import { buildFountain, buildPond } from './water.js';
import { buildTrees } from './trees.js';
import { buildHub, buildScooterRider } from './hub.js';
import { createHubLife } from './hub-life.js';
import { releaseModel } from './shape-key.js';
import { LiveDetector } from '../detection/live.js';
import { measure, step as fingersStep } from './touch-gestures.js';
import { CLASSES as COUNT_CLASSES, CLASS_OF, MASK_TOP, cameraFrom, cropBox, inLanes, labelsFor, laneMask, owns, rigSegments, stripCorners, yoloLine } from '../detection/labels.js';
import { cafeTables, hasCafe } from './courtyard-layout.js';
import { createCourtyardLife } from './courtyard-life.js';
import { lampFront, lampRear, nightGlow, withNightGlow } from './night-glow.js';
import { footpathHeight } from './footpath.js';
import { buildCarPark, lotPicture, paintLot } from './carpark.js';
import { createCarPark, front as carparkFront } from './carpark-life.js';
import { halfWidth as carparkHalfWidth, depth as carparkDepth } from './carpark-layout.js';
import { buildSlide, buildSwingSet } from './playground.js';
import { createPlayLife } from './playground-life.js';
import { SLIDE_AT, SWING_AT, obstacles as playObstacles } from './playground-layout.js';
import { createSky, WEATHER_NAMES, VISITOR } from './sky.js';
import { fetchLiveWeather } from './weather.js';
import { roundFade, lightTexture, ADDITIVE_CURVE } from './textures.js';
import { createShell } from '../page/shell.js';
import { createSound } from '../page/sound.js';
import { roadName, dayName, clockOf } from '../page/names.js';
import { animateCyclist as animateCyclistModel, buildCyclist as buildCyclistModel, buildPerson, buildPram as buildPramModel, poseSitting, standUp, walkPose, handOf, reachWith } from './people.js';
import { CLASSES, SIDE_STREET_SPACING, CAMERA_RIG, VEHICLE_HEIGHT } from '../sim/world.js';
import { CORNER_RADIUS, CROSSING_HALF, CROSSING_Y, LANE_X, MOUTH_ZEBRA_FAR, MOUTH_ZEBRA_NEAR, STOP_Y, STREET_WIDTH, Tracks, WHEELBASE, indicatorOf, mouthZebras, pedestrianPose, rotate as rot } from '../sim/tracks.js';
import { forecast, flashingSeconds } from '../countdown.js';
import { collectTriangles, createTriangleGrid } from './clearance.js';

// ---------- geometry of the junction, in metres. The flat styles it started from are not in the repository ----------
// How much of the city is built. The simulation has 6 side streets on each side of each road (SIDE_STREET_COUNT, and vehicles use all of them), but only the first two are drawn, with the blocks between,
// and the haze closes in beyond them (the fog below), so the junction, the park and the car parks are the scene and what lies past is a vehicle coming out of the haze.
const DRAWN_STREETS = 2;
const LANE = 3.2, H = LANE * 3, YS = STOP_Y, Q = Math.PI / 2, LEG = 44;
const FOOT = 3.6, EDGE_OF_ROAD = H + FOOT; // the footpath ends here, and the buildings begin
const APPROACH = 700, FAR = 760; // vehicles start 700 m out. The fog is solid well before that, and the camera cannot get closer than 500 m to the start
const TAU = Math.PI * 2, RAD = Math.PI / 180, CAMERA_HFOV = 130 * RAD; // the detection cameras have a 130 degree lens

// ---------- palette: red, amber and green stay reserved for signals ----------
const PALETTE = ['#5b8def', '#7e5bb5', '#4cb7a5', '#f08cb0', '#f2efe6', '#7a8696', '#2f3e6b', '#9fb6ff', '#c9a7ff'];
const COLORS = { ground: '#a8cf95', walk: '#b6b2a9', asphalt: '#43474d', line: '#f3f3ee', busRed: '#b94a40' };

// ---------- renderer, scene, camera ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: true });
// A phone or a tablet (a touch screen, or a device that says it has 4 GB or less) gets a lower pixel ratio and a smaller shadow map: the sharpness lost is little on a small screen, and the memory and the work
// saved are a good part of what lets the page run there at all.
const SMALL_DEVICE = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || (navigator.deviceMemory && navigator.deviceMemory <= 4);
const PIXEL_CAP = SMALL_DEVICE ? 1.5 : 2;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PIXEL_CAP));
renderer.shadowMap.enabled = true;
renderer.shadowMap.autoUpdate = false; // the shadow map is drawn every second frame (see the frame loop), which halves the cost of shadows and moves a vehicle's shadow by no more than a few centimetres between draws
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 2, 1600); // a near plane of 2 m is as near as the viewpoint can come (3 m from what it looks at), and it gives the depth buffer more precision
camera.position.set(58, 62, 68);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.maxPolarAngle = 1.5; // never under the ground, and the horizon can be reached
controls.minDistance = 3; // close enough to stand beside a pedestrian
controls.maxDistance = 140;
controls.zoomToCursor = true;
// The scheme of a map, so nobody needs telling: one finger or a drag moves the ground under it, two fingers (or a right drag) turn the view and a pinch (or the wheel) zooms toward the pointer.
// A touch screen with one finger and a mouse with the left button do the thing that is done most, which is to move about; turning is the second finger or the other button.
controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
controls.touches = { ONE: THREE.TOUCH.PAN, TWO: -1 }; // one finger is the controls' own; two fingers are the map gestures below (a pinch, a twist, a swipe up or down, a drag sideways), which OrbitControls does not have
controls.screenSpacePanning = false; // pan along the ground, so the horizon never tilts
controls.panSpeed = 1; // the ground stays under the finger or the pointer, not ahead of it
const panLimit = 140; // far enough to reach the park, the first streets beyond it and the far camera poles
controls.addEventListener('change', () => {
  controls.target.x = Math.max(-panLimit, Math.min(panLimit, controls.target.x));
  controls.target.z = Math.max(-panLimit, Math.min(panLimit, controls.target.z));
});

const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x8a8f70, .75);
const sun = new THREE.DirectionalLight(0xffe7bd, 3.3);
sun.position.set(34, 56, 24);
sun.castShadow = true;
sun.shadow.mapSize.set(SMALL_DEVICE ? 1024 : 2048, SMALL_DEVICE ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -52, right: 52, top: 52, bottom: -52, near: 1, far: 160 });
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.07; // a larger offset stops the shadow map from speckling flat ground, which some graphics drivers show where others do not
scene.add(hemi, sun);
// A light haze that only starts far out and takes the colour of the sky at the horizon. It hides where the city and the roads end.
scene.fog = new THREE.Fog(0xbfe0f7, 150, 340);
const skyDome = createSky(scene, { sun, hemi }); // sun, moon, stars, clouds, birds and weather, from src/scene/sky.js
// The weather near the visitor's city, asked for now and every 20 minutes. If it cannot be fetched the sky keeps the daily pick, and says so in the Controls panel.
let weatherReady = Promise.resolve(); // settles when the first answer about the weather is in, or has failed
if (VISITOR.known) {
  // The last answer is kept (for three hours), so a page opened again starts with the weather it had and not with the daily pick, which the answer would then replace with a visible change of sky and lamps.
  try { const kept = JSON.parse(localStorage.getItem('liveWeather') || 'null'); if (kept && Date.now() - kept.at < 3 * 3600 * 1000 && WEATHER_NAMES.includes(kept.name)) skyDome.setLiveWeather(kept.name); } catch (error) { /* no storage: the first answer comes from the network */ }
  const refreshWeather = (starting = false) => fetchLiveWeather(VISITOR.lat, VISITOR.lon, fetch, 15000)
    .then((name) => { skyDome.setLiveWeather(name); try { if (name) localStorage.setItem('liveWeather', JSON.stringify({ name, at: Date.now() })); } catch (error) { /* private window */ } })
    .catch((error) => { console.warn(`live weather unavailable, using the daily pick: ${error.message}`); if (!starting) skyDome.setLiveWeather(null); }); // at the start the kept answer, if there is one, stays
  // The first request goes out now, before the scene is built, so the answer is in when the first frame is drawn (see the end of this file). Its time-out is long, because the build holds the page for seconds.
  weatherReady = refreshWeather(true); setInterval(refreshWeather, 20 * 60 * 1000);
}
const wetMaterials = []; // the road surfaces, which turn glossy in the rain
// Every flat surface that is walked or driven on is lit by diffuse light only. A shiny highlight from the sun or the moon depends on where the viewpoint is, so the same patch of road or ground would be a
// different grey as the view turns. specularIntensity 0 removes it. The wet road in the rain turns it back on, by design (see the weather update in the frame loop).
const groundMaterial = (parameters) => new THREE.MeshPhysicalMaterial(parameters); // the roads, as they were
// stencil: the pavement marks its pixels (1) so that the road glow skips them. Only the raised pieces do (the slabs, the corner pieces, the park paths): the ground plane is drawn under the roads and, drawn first, would
// mark the pixels under them, which stopped the glow on the roads beyond 48 m and made them black.
const paveMaterial = (parameters, marksStencil = true) => new THREE.MeshPhysicalMaterial({ ...parameters, specularIntensity: 0, ...(marksStencil ? { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp } : {}) }); // the pavement, which has no highlight, so it is the same grey from every side


// ---------- ground texture, painted once from the same flat drawing as the 2D mockup ----------
// Lane arrows, drawn in metres with the driver heading toward +y (down the page). x, y is the middle of the arrow, which is about 4.6 m long.
function arrow(ctx, x, y, kind) {
  ctx.save(); ctx.fillStyle = COLORS.line; ctx.strokeStyle = COLORS.line;
  if (kind === 'straight') {
    ctx.beginPath(); ctx.rect(x - .17, y - 2.3, .34, 3.4); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - .8, y + 1.0); ctx.lineTo(x + .8, y + 1.0); ctx.lineTo(x, y + 2.3); ctx.closePath(); ctx.fill();
  } else { // a turn: the shaft comes forward, bends and ends in a head. 'right' bends to the driver's right, which is toward -x.
    const s = kind === 'right' ? -1 : 1;
    ctx.lineWidth = .34; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(x, y - 2.3); ctx.lineTo(x, y); ctx.quadraticCurveTo(x, y + 1.1, x + s * 1.1, y + 1.1); ctx.lineTo(x + s * 1.2, y + 1.1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + s * 1.1, y + .35); ctx.lineTo(x + s * 2.3, y + 1.1); ctx.lineTo(x + s * 1.1, y + 1.85); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}
// BUS above LANE, standing upright for the driver and stretched along the road so it can be read from a distance.
// cx, cy is the middle of the lane. The lane is 3.2 m wide, so each word is about 2.5 m across.
function busText(ctx, cx, cy, turn = Math.PI) {
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(turn); ctx.scale(1, 2.6);
  ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.font = 'bold .98px "Helvetica Neue", Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('BUS', 0, -.62); ctx.fillText('LANE', 0, .62);
  ctx.restore();
}
// The pavement is not painted into the road. Where it is, the picture is transparent and the pavement under it shows (the kerb slabs and the ground), so there is only one pavement, in one colour, and
// it is not lit by the road's light or cut by shadows in a different way from the pavement beside it.
// The road picture holds only the asphalt, the marks, the bus lane and the zebra crossings. Where the pavement goes it is see-through (alphaTest), and the pavement shapes cover the ends of the zebra stripes, as the painted corners did.
function paintGround(ctx) {
  for (let k = 0; k < 4; k += 1) {
    ctx.save(); ctx.rotate(k * Q);
    ctx.fillStyle = COLORS.asphalt; ctx.fillRect(-H, -LEG, 2 * H, LEG - H + .05);
    ctx.fillStyle = COLORS.busRed; ctx.fillRect(2 * LANE, -LEG, LANE, LEG + YS);
    busText(ctx, 8, -22); busText(ctx, 8, -38);
    ctx.fillStyle = COLORS.busRed; ctx.fillRect(-3 * LANE, -LEG, LANE, LEG + YS); // the bus lane on the way out, on the other side of the road: it ends where the lane coming in does, at the line of the zebra, so the two read as one pair
    busText(ctx, -8, -22, 0); busText(ctx, -8, -38, 0);
    ctx.fillStyle = COLORS.line;
    ctx.fillRect(-.08, -LEG, .16, LEG + YS);
    for (let y = -LEG; y < YS - 3; y += 6) for (const x of [-6.4, -3.2, 3.2]) ctx.fillRect(x - .07, y, .14, 3);
    ctx.fillRect(6.4 - .08, -LEG, .16, LEG + YS);
    ctx.fillRect(-(H + 1.2), YS - .25, 2 * (H + 1.2), .5); // the line across the whole road, on to both kerbs (the kerb's pavement covers what is past them), so the lanes going out have it as well as the lanes coming in
    for (const y of [-19, -35]) { arrow(ctx, 4.8, y, 'straight'); arrow(ctx, 1.6, y, 'right'); }
    ctx.restore();
  }
  ctx.fillStyle = COLORS.asphalt; ctx.fillRect(-H, -H, 2 * H, 2 * H);
  for (let k = 0; k < 4; k += 1) { // the rounded corners: the road widens into a curve of CORNER_RADIUS
    const r = CORNER_RADIUS, cx = H + r, cy = -H - r;
    ctx.save(); ctx.rotate(k * Q); ctx.fillStyle = COLORS.asphalt;
    ctx.beginPath(); ctx.moveTo(H - .02, -H + .02); ctx.lineTo(cx, -H + .02); ctx.arc(cx, cy, r, Math.PI / 2, Math.PI, false); ctx.lineTo(H - .02, -H + .02); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  // The zebra crossings. Each is 13 stripes centred on the middle of the road, and the stripes run on over the rounded corner to
  // the pavement. At a corner the two crossings meet on the diagonal, and each keeps its own side of it, so both are cut the same
  // way and the corner is symmetrical about that diagonal. The pavement is painted over the ends, which follows the curve.
  const yA = CROSSING_Y - CROSSING_HALF, yB = CROSSING_Y + CROSSING_HALF, r = CORNER_RADIUS, cx = H + r, cy = -H - r;
  for (let k = 0; k < 4; k += 1) {
    ctx.save(); ctx.rotate(k * Q);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(100, -100); ctx.lineTo(-100, -100); ctx.closePath(); ctx.clip(); // this crossing's side: |x| + y <= 0
    ctx.fillStyle = COLORS.line;
    for (let i = -9; i <= 9; i += 1) ctx.fillRect(i * 1.4 - .35, yA, .7, yB - yA);
    ctx.restore();
  }
  for (let k = 0; k < 4; k += 1) { ctx.save(); ctx.rotate(k * Q); ctx.fillStyle = COLORS.busRed; ctx.beginPath(); busCornerPath(ctx); ctx.fill(); ctx.save(); ctx.scale(-1, 1); busCornerPath(ctx); ctx.fill(); ctx.restore(); ctx.fillStyle = COLORS.line; ctx.fillRect(H - .06, YS - .25, 1.4, .5); ctx.fillRect(-H - 1.34, YS - .25, 1.4, .5); ctx.restore(); } // the lane's red out to the kerb at the corner
  // The pavement (the footpaths, the corners and the ground between the blocks) is not painted here. It is solid shapes laid over this picture (see the pavement below), so that it is one thing in one colour.
}
// The bus lane at the corner. The lane is 3.2 m wide, but the road widens into the rounded corner before the stop line, so a sliver of road is left between the lane and the kerb. This is its outline (in the
// approach frame): the lane's edge, the start of the curve, along the curve to the stop line, and back. The lane's red is painted into it and the bus lane overlay includes it, so the red reaches the kerb.
function busCornerPath(g) {
  const r = CORNER_RADIUS, cx = H + r, cy = -H - r, end = Math.PI - Math.asin((YS - cy) / r);
  g.moveTo(H - .06, YS + .02); g.lineTo(H - .06, cy); g.lineTo(H, cy); g.arc(cx, cy, r, Math.PI, end, true); g.lineTo(H - .06, YS + .02); g.closePath(); // starts a little inside the lane, so there is no seam between them
}
const groundCanvas = document.createElement('canvas');
groundCanvas.width = groundCanvas.height = 4096;
{
  const ctx = groundCanvas.getContext('2d');
  const s = groundCanvas.width / (2 * LEG);
  ctx.translate(groundCanvas.width / 2, groundCanvas.height / 2); ctx.scale(s, s);
  paintGround(ctx);
}
const groundTexture = new THREE.CanvasTexture(groundCanvas);
groundTexture.colorSpace = THREE.SRGBColorSpace;
groundTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
const roadPlane = new THREE.Mesh(new THREE.PlaneGeometry(2 * LEG, 2 * LEG), groundMaterial({ map: groundTexture, roughness: .95, alphaTest: .97 })); wetMaterials.push(roadPlane.material);
roadPlane.rotation.x = -Math.PI / 2; roadPlane.receiveShadow = true; scene.add(roadPlane);
// The ground under everything is only 2 cm below the roads. Where the graphics hardware keeps a shallow depth buffer the two fight for each pixel at a distance and speckle the road, so the
// ground is pushed back in the depth buffer by a few of the smallest steps it can tell apart. A polygon offset does that whatever the precision is.
const base = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), paveMaterial({ color: COLORS.walk, roughness: 1, polygonOffset: true, polygonOffsetFactor: 6, polygonOffsetUnits: 24 }, false)), BASE_COLOUR = new THREE.Color(COLORS.walk); // the ground under everything, and its colour in daylight
base.rotation.x = -Math.PI / 2; base.position.y = -.02; base.receiveShadow = true; scene.add(base);

// raised kerbs along the roads
const kerbMat = paveMaterial({ color: COLORS.walk, roughness: .9 }), KERB_BASE = kerbMat.color.clone(); // its colour in daylight, which the night correction is multiplied onto
// The footpath is cut where a side street meets the road, so that the street joins it and the zebra crossing lies on the street's own asphalt (see the side streets below).
const STREET_W = STREET_WIDTH;
const KERB_PIECES = []; // [from, to] along the road, measured out from the middle of the junction
{
  let from = LEG;
  for (let n = 1; n <= DRAWN_STREETS; n += 1) { KERB_PIECES.push([from, n * SIDE_STREET_SPACING - STREET_W / 2]); from = n * SIDE_STREET_SPACING + STREET_W / 2; }
  KERB_PIECES.push([from, FAR]); // from the end of the corner pavement to the horizon
}
for (let k = 0; k < 4; k += 1) {
  for (const side of [-1, 1]) for (const [start, end] of KERB_PIECES) {
    const w = FOOT, len = end - start;
    const [x, z] = rot(k, side * (H + w / 2), -(start + len / 2));
    const kerb = new THREE.Mesh(new THREE.BoxGeometry(k % 2 ? len : w, .16, k % 2 ? w : len), kerbMat);
    kerb.position.set(x, .08, z); kerb.receiveShadow = true; kerb.castShadow = true; scene.add(kerb);
  }
}

// The pavement at the four corners of the junction, as solid pieces as high as the kerb slabs (0.16 m). Each runs along the two footpaths beside the crossing roads (the 3.6 m from the road out to EDGE_OF_ROAD) and
// has the rounded inner corner of the road (radius CORNER_RADIUS). They stand above the street light (at 0.06 m), so the light never shows through them, and they share the kerb material with the slabs.
// They stop at EDGE_OF_ROAD: past that is the block (the park and the buildings), where the ground below shows.
for (let k = 0; k < 4; k += 1) {
  const R = CORNER_RADIUS, edge = EDGE_OF_ROAD, shape = new THREE.Shape(), rim = [];
  for (let i = 0; i <= 24; i += 1) { const t = (-90 - 90 * i / 24) * RAD; rim.push([H + R + R * Math.cos(t), H + R + R * Math.sin(t)]); } // from (H + R, H) round to (H, H + R), in x and v = -z
  shape.moveTo(H, LEG); shape.lineTo(edge, LEG); shape.lineTo(edge, edge); shape.lineTo(LEG, edge); shape.lineTo(LEG, H); for (const [x, v] of rim) shape.lineTo(x, v); shape.lineTo(H, LEG);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: .16, bevelEnabled: false }).rotateX(-Math.PI / 2).rotateY(-k * Q);
  const piece = new THREE.Mesh(geometry, kerbMat); piece.receiveShadow = true; piece.castShadow = true; scene.add(piece);
}

// ---------- the city: long roads, side streets, blocks, street trees and lamps ----------
const rand = (() => { let a = 20260319; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
const pick = (list) => list[Math.floor(rand() * list.length)];
const withTexture = (canvas, repeatX = 1, repeatY = 1) => {
  const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy(); t.repeat.set(repeatX, repeatY); return t;
};
function paintArm(ctx, ppm, period) { // one repeat of a main road, across the full width including footpaths
  const W = 2 * EDGE_OF_ROAD * ppm, Hh = period * ppm, X = (x) => (x + EDGE_OF_ROAD) * ppm;
  ctx.fillStyle = 'rgba(212, 211, 208, .004)'; ctx.fillRect(0, 0, W, Hh); // see paintGround
  ctx.fillStyle = COLORS.asphalt; ctx.fillRect(X(-H), 0, 2 * H * ppm, Hh);
  ctx.fillStyle = COLORS.busRed; ctx.fillRect(X(2 * LANE), 0, LANE * ppm, Hh); ctx.fillRect(X(-3 * LANE), 0, LANE * ppm, Hh); // a bus lane each way
  ctx.fillStyle = COLORS.line;
  ctx.fillRect(X(-.08), 0, .16 * ppm, Hh); ctx.fillRect(X(6.4 - .08), 0, .16 * ppm, Hh);
  for (let y = 0; y < period; y += 6) for (const x of [-6.4, -3.2, 3.2]) ctx.fillRect(X(x - .07), y * ppm, .14 * ppm, 3 * ppm);
  ctx.save(); ctx.scale(ppm, ppm); ctx.translate(0, 0); busText(ctx, X(8) / ppm, period / 2); busText(ctx, X(-8) / ppm, period / 2, 0); ctx.restore(); // once in every tile, for each way
}
function paintStreet(ctx, ppm, period, width) {
  ctx.fillStyle = COLORS.asphalt; ctx.fillRect(0, 0, width * ppm, period * ppm);
  ctx.fillStyle = COLORS.line; ctx.fillRect((width / 2 - .07) * ppm, 0, .14 * ppm, 3 * ppm);
}
const ARM_TILE = 60; // metres, and the bus lane text appears once in each
const armCanvas = document.createElement('canvas'); armCanvas.width = 264; armCanvas.height = ARM_TILE * 10;
paintArm(armCanvas.getContext('2d'), 10, ARM_TILE);
const streetCanvas = document.createElement('canvas'); streetCanvas.width = 80; streetCanvas.height = 120;
paintStreet(streetCanvas.getContext('2d'), 10, 12, STREET_W);

// the four main roads, from the painted junction out to the horizon
for (let k = 0; k < 4; k += 1) {
  const length = FAR - LEG, tex = withTexture(armCanvas, 1, length / ARM_TILE);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(2 * EDGE_OF_ROAD, length), groundMaterial({ map: tex, roughness: .95, alphaTest: .97 })); wetMaterials.push(road.material);
  road.rotation.x = -Math.PI / 2; road.receiveShadow = true;
  const arm = new THREE.Group(); arm.add(road); road.position.set(0, 0, -(LEG + length / 2)); arm.rotation.y = -(k * Q); scene.add(arm);
}

// The bus lane at night. The light of the street is added on top of the road, and a warm light added to red paint makes it peach. So that the lane keeps its colour, the lane itself, its red and its
// lettering, is drawn again over the light, dimmed to the level of the lit street, and only at night: by day it is invisible. The copy is cut out of the textures the road is painted from.
// The colour of the daylight on a flat road: the sky colour times its strength plus the sun colour times its strength and the height of the sun. A road is lit by both in the same proportion (a hemisphere light
// and a directional light go through the same diffuse step), so this is the plain sum. It was a sum with the sky weighted down to 0.41, which was right at noon, where the sun is so strong that the sky hardly
// shows, and wrong at sunrise and sunset, where it is the other way round: the correction then overshot and turned the white markings and arrows blue for a part of the change.
const lightColour = (hemi, hemiStrength, sunColour, sunStrength) => [0, 1, 2].map((i) => hemi[i] * hemiStrength + sunColour[i] * sunStrength);
// At sunrise and sunset the sun is low and its light is red, and much of the road lies in the shadow of the buildings, where only the blue sky lights it. A correction for the sun's red would turn those
// shadowed parts, and the white markings in them, blue. So the correction counts the sun for only part of its strength: the sunlit road is left a little warm, which a low sun does, and the shadow is not blue.
const SUN_SHARE = .5;
const HEMI_NOON = new THREE.Color('#cfe4ff').toArray(), SUN_NOON = new THREE.Color('#ffe7bd').toArray();
const busDecals = [], LANE_LIGHT = .55, ROAD_LIT = 3, ROAD_DARK = .55, WASH_LEVEL = .44, LED_WHITE = [1, 1, 1], NOON_LIGHT = lightColour(HEMI_NOON, 0.877, SUN_NOON, 3.062 * .829 * SUN_SHARE) // LANE_LIGHT: how much the street lights add to the lane's own colour
{
  const armBus = document.createElement('canvas'); armBus.width = armCanvas.width; armBus.height = armCanvas.height;
  const a = armBus.getContext('2d'); a.drawImage(armCanvas, 0, 0); a.globalCompositeOperation = 'destination-in';
  a.beginPath(); a.rect((2 * LANE + EDGE_OF_ROAD) * 10, 0, LANE * 10, armBus.height); a.rect((-3 * LANE + EDGE_OF_ROAD) * 10, 0, LANE * 10, armBus.height); a.fill(); // the lanes, one each way, in the 10 pixels to the metre the arm is painted at. One path, so the two stay: a second fill on its own would keep only what the first left
  const groundBus = document.createElement('canvas'); groundBus.width = groundBus.height = groundCanvas.width;
  const g = groundBus.getContext('2d'), gs = groundBus.width / (2 * LEG);
  g.save(); g.translate(groundBus.width / 2, groundBus.height / 2); g.scale(gs, gs); g.beginPath();
  for (let k = 0; k < 4; k += 1) { g.save(); g.rotate(k * Q); g.rect(2 * LANE, -LEG, LANE, LEG + YS); busCornerPath(g); g.save(); g.scale(-1, 1); g.rect(2 * LANE, -LEG, LANE, LEG + YS); busCornerPath(g); g.restore(); g.restore(); } // the outbound lane is the same shapes turned over, so they wind the same way and add up
  g.restore(); g.clip(); g.drawImage(groundCanvas, 0, 0);
  const decalMaterial = (map) => { const m = groundMaterial({ map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0, roughness: .95, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -12 }); busDecals.push(m); wetMaterials.push(m); return m; }; // lit like the road, so the lane keeps its own colour at every hour
  const groundTex = new THREE.CanvasTexture(groundBus); groundTex.colorSpace = THREE.SRGBColorSpace; groundTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const middle = new THREE.Mesh(new THREE.PlaneGeometry(2 * LEG, 2 * LEG).rotateX(-Math.PI / 2).translate(0, .035, 0), decalMaterial(groundTex)); middle.renderOrder = 3; middle.receiveShadow = true; scene.add(middle);
  for (let k = 0; k < 4; k += 1) {
    const length = FAR - LEG, tex = withTexture(armBus, 1, length / ARM_TILE);
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(2 * EDGE_OF_ROAD, length), decalMaterial(tex));
    strip.rotation.x = -Math.PI / 2; strip.renderOrder = 3; strip.receiveShadow = true;
    const arm = new THREE.Group(); arm.add(strip); strip.position.set(0, .035, -(LEG + length / 2)); arm.rotation.y = -(k * Q); scene.add(arm);
  }
}

// side streets run parallel to the main roads, one every STEP metres, and join them at the footpath
const STEP = SIDE_STREET_SPACING, STREETS = DRAWN_STREETS, SIDE_FOOT = 2.5, HALF_STREET = STREET_W / 2 + SIDE_FOOT;
const streetMat = groundMaterial({ map: withTexture(streetCanvas, 1, (FAR - H) / 12), roughness: .95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 }); wetMaterials.push(streetMat); // drawn just over the main road's footpath, so it wins the depth test there
for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (let m = 1; m <= STREETS; m += 1) {
  const length = FAR - H; // they run right up to the edge of the main road, across its footpath
  for (const alongX of [false, true]) {
    const street = new THREE.Mesh(new THREE.PlaneGeometry(STREET_W, length), streetMat);
    street.rotation.x = -Math.PI / 2; street.rotation.z = alongX ? Math.PI / 2 : 0; // no building shadow on a side street: in the shade of its two rows of buildings it was lit by the blue sky alone, a different colour from the main road in the sun
    const centre = H + length / 2;
    street.position.set(alongX ? sx * centre : sx * m * STEP, alongX ? .02 : .01, alongX ? sz * m * STEP : sz * centre);
    scene.add(street);
  }
}

// The zebra crossing at the mouth of every side street: stripes along the way a vehicle drives, 0.7 m wide every 1.4 m like the zebras of the junction, on the street's own asphalt. The lanes people walk in
// are inside it (11.2 to 12.6 m out). Where it is, and the rule that vehicles give way on it, come from sim/tracks.js.
// The picture covers the street from the edge of the road (H) to the far side of the stripes, so that it can mark the stencil like the pavement does: the road's glow, which lies over the footpath, then
// skips it, and the mouth is lit as the rest of the street is, by its own steady night light only.
const MOUTH_W = 13.4 - H; // to a little past the stripes: the road's glow reaches 13.2 m out, and it must not show on the asphalt after them
const mouthCanvas = document.createElement('canvas'); mouthCanvas.width = Math.round(MOUTH_W * 40); mouthCanvas.height = STREET_W * 40; // 40 pixels to the metre, so the edges of the stripes are sharp
{
  const g = mouthCanvas.getContext('2d'); g.scale(40, 40); g.fillStyle = COLORS.asphalt; g.fillRect(0, 0, MOUTH_W, STREET_W); g.fillStyle = COLORS.line;
  for (let i = -3; i <= 2; i += 1) g.fillRect(MOUTH_ZEBRA_NEAR - H, STREET_W / 2 + (i + .5) * 1.4 - .35, MOUTH_ZEBRA_FAR - MOUTH_ZEBRA_NEAR, .7); // six, across all but 0.15 m of the street
}
// The night light of a street is grey. Its picture is painted a little blue (the asphalt is #43474d), and used as its own light that made the street bluer than the main road, which the eye saw as a
// different road. So the light comes from a grey copy of the picture.
const greyOf = (canvas, map) => { // by hand: Safari has no canvas filter, and a filter that does nothing left the street blue there
  const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
  const g = c.getContext('2d'), image = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height), d = image.data;
  for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = Math.round(.2126 * d[i] + .7152 * d[i + 1] + .0722 * d[i + 2]);
  g.putImageData(image, 0, 0);
  return withTexture(c, map.repeat.x, map.repeat.y);
};
streetMat.userData.grey = greyOf(streetCanvas, streetMat.map);
const mouthMat = groundMaterial({ map: withTexture(mouthCanvas, 1, 1), roughness: .95, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -12, stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp }); wetMaterials.push(mouthMat); mouthMat.userData.grey = greyOf(mouthCanvas, mouthMat.map);
for (const t of [mouthMat.map, mouthMat.userData.grey]) t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; // the stripes touch the near edge, and a repeating picture would show their end on the far edge
for (const z of mouthZebras()) {
  const stripes = new THREE.Mesh(new THREE.PlaneGeometry(MOUTH_W, STREET_W).rotateX(-Math.PI / 2), mouthMat);
  const [x, zz] = rot(z.k, z.side * (H + MOUTH_W / 2), -z.n * STEP); // the picture runs from the road outward, so on the other side of the road it is turned half way round
  stripes.rotation.y = -z.k * Q + (z.side < 0 ? Math.PI : 0); stripes.position.set(x, .02, zz); scene.add(stripes);
}

// The shade on a road. The sky light that falls on a road in a building's shadow is blue, and the road is given back the sun's colour only in the sun, so a shadow on the road turned blue or green instead of
// being the same grey, darker. Each road surface now has its sky light turned to the colour of the whole light on the road (the sky and the sun together), so the shade is the lit road made darker and keeps
// its colour. Only the sky's share is changed (`indirectTint`, set every frame in applyLight), and by night, when there is no sun, it is 1 and nothing changes.
const indirectTint = { value: new THREE.Vector3(1, 1, 1) };
const keepShadeColour = (m) => {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.indirectTint = indirectTint;
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', 'uniform vec3 indirectTint;\nvoid main() {').replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n\treflectedLight.indirectDiffuse *= indirectTint;');
  };
  m.customProgramCacheKey = () => 'keep-shade-colour';
};
for (const m of wetMaterials) if (!busDecals.includes(m)) keepShadeColour(m);

// buildings: every block is ringed with lots, merged into one mesh with its own window and tint
// Four facade styles. A tile is 4 bays across (6 m) and 8 floors up (28 m); a bay is 64 px, so one floor is 64 px high.
// The wall is drawn near white and tinted by the building's colour. The glow map is black except where a lit window is.
const hash2 = (x, y, k) => { let h = (x * 374761393 + y * 668265263 + k * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const GLASS = (g, x, y, w, h, tone) => { const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, tone ? '#9db7cc' : '#7f9db8'); gr.addColorStop(1, tone ? '#3d5a74' : '#2c465e'); g.fillStyle = gr; g.fillRect(x, y, w, h); g.fillStyle = 'rgba(255,255,255,.2)'; g.beginPath(); g.moveTo(x + w * .2, y + h); g.lineTo(x + w * .5, y); g.lineTo(x + w * .7, y); g.lineTo(x + w * .4, y + h); g.fill(); };
const FACADES = [
  { name: 'framed', draw(g, x, y, r, r2, lit, col, row) {
    if (!lit) {
      g.fillStyle = 'rgba(0,0,0,.07)'; g.fillRect(x, y + 44, 64, 20); g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(x, y + 62, 64, 2);
      g.fillStyle = '#f2ecdd'; g.fillRect(x + 7, y + 6, 50, 36); GLASS(g, x + 10, y + 9, 44, 30, r2 < .25);
      g.fillStyle = '#f2ecdd'; g.fillRect(x + 31, y + 9, 2, 30); g.fillRect(x + 10, y + 19, 44, 2);
      if (r < .14) { g.fillStyle = 'rgba(245,242,232,.92)'; g.fillRect(x + 10, y + 9, 44, 6 + (r2 * 14 | 0)); } else if (r < .24) { g.fillStyle = 'rgba(120,70,60,.55)'; g.fillRect(x + 10, y + 9, 12, 30); g.fillRect(x + 42, y + 9, 12, 30); }
      g.fillStyle = '#d6cfbf'; g.fillRect(x + 4, y + 42, 56, 4); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x + 4, y + 46, 56, 2); g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(x + 7, y + 3, 50, 3);
    } else if (r < .62) { g.fillStyle = r2 < .2 ? '#bfe0ff' : r2 < .45 ? '#ffe3a0' : '#ffd278'; g.fillRect(x + 10, y + 9, 44, 30); g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x + 31, y + 9, 2, 30); g.fillRect(x + 10, y + 19, 44, 2); }
  } },
  { name: 'curtain', draw(g, x, y, r, r2, lit) { // a glass wall: a band of glass on every floor with thin mullions, and a pale spandrel between floors
    if (!lit) { g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(x, y, 64, 14); g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x, y + 13, 64, 1); GLASS(g, x + 1, y + 16, 62, 46, r2 < .3); g.fillStyle = '#cfd6dc'; g.fillRect(x, y + 16, 2, 46); g.fillRect(x + 31, y + 16, 2, 46); g.fillRect(x, y + 62, 64, 2); if (r < .1) { g.fillStyle = 'rgba(240,240,235,.8)'; g.fillRect(x + 2, y + 17, 29, 14 + (r2 * 20 | 0)); } }
    else if (r < .58) { g.fillStyle = r2 < .3 ? '#cfe6ff' : '#ffe0a0'; g.fillRect(x + 2, y + 17, 60, 44); g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(x + 31, y + 17, 2, 44); }
  } },
  { name: 'brick', draw(g, x, y, r, r2, lit) { // brick walls with small windows under stone lintels
    if (!lit) {
      for (let by = 0; by < 64; by += 6) for (let bx = (by / 6 % 2) * 8; bx < 64; bx += 16) { const t = hash2(x + bx, y + by, 9); g.fillStyle = `rgba(${t < .5 ? '80,40,20' : '255,235,215'},${.05 + t * .12})`; g.fillRect(x + bx, y + by, 15, 5); }
      g.fillStyle = 'rgba(0,0,0,.18)'; for (let by = 5; by < 64; by += 6) g.fillRect(x, y + by, 64, 1);
      g.fillStyle = '#e8e0cf'; g.fillRect(x + 14, y + 8, 36, 5); g.fillRect(x + 12, y + 44, 40, 4); // lintel and sill
      g.fillStyle = '#d8d0c0'; g.fillRect(x + 16, y + 13, 32, 31); GLASS(g, x + 18, y + 15, 28, 27, r2 < .25);
      g.fillStyle = '#d8d0c0'; g.fillRect(x + 31, y + 15, 2, 27); g.fillRect(x + 18, y + 27, 28, 2);
      if (r < .15) { g.fillStyle = 'rgba(245,242,232,.9)'; g.fillRect(x + 18, y + 15, 28, 9); }
      g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x + 12, y + 48, 40, 2);
    } else if (r < .6) { g.fillStyle = r2 < .25 ? '#bfe0ff' : '#ffd278'; g.fillRect(x + 18, y + 15, 28, 27); g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x + 31, y + 15, 2, 27); }
  } },
  { name: 'deco', draw(g, x, y, r, r2, lit) { // stone piers between tall paired windows, with a decorative panel under each
    if (!lit) {
      g.fillStyle = 'rgba(0,0,0,.1)'; g.fillRect(x, y, 5, 64); g.fillRect(x + 59, y, 5, 64); g.fillStyle = 'rgba(255,255,255,.4)'; g.fillRect(x + 5, y, 2, 64); g.fillRect(x + 57, y, 2, 64);
      for (const wx of [11, 37]) { g.fillStyle = '#eee7d6'; g.fillRect(x + wx - 2, y + 5, 20, 42); GLASS(g, x + wx, y + 7, 16, 38, r2 < .25); g.fillStyle = '#eee7d6'; g.fillRect(x + wx + 7, y + 7, 2, 38); g.fillRect(x + wx, y + 22, 16, 2); }
      g.fillStyle = 'rgba(0,0,0,.16)'; g.fillRect(x + 8, y + 50, 48, 10); g.fillStyle = 'rgba(255,255,255,.3)'; for (let k = 0; k < 6; k += 1) g.fillRect(x + 12 + k * 8, y + 52, 3, 6);
      g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(x, y + 62, 64, 2);
      if (r < .12) { g.fillStyle = 'rgba(245,242,232,.9)'; g.fillRect(x + 11, y + 7, 16, 14); }
    } else { for (const wx of [11, 37]) if (hash2(x + wx, y, 5) < .6) { g.fillStyle = r2 < .3 ? '#cfe6ff' : '#ffd278'; g.fillRect(x + wx, y + 7, 16, 38); g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x + wx + 7, y + 7, 2, 38); } }
  } },
];
function windowTexture(lit, style = 0) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 512;
  const g = c.getContext('2d'); g.fillStyle = lit ? '#000' : '#fff7ea'; g.fillRect(0, 0, 256, 512);
  if (!lit) for (let i = 0; i < 2600; i += 1) { const v = hash2(i, 1, 2); g.fillStyle = v < .5 ? 'rgba(90,70,40,.07)' : 'rgba(255,255,255,.18)'; g.fillRect(hash2(i, 3, 4) * 256, hash2(i, 5, 6) * 512, 2, 1 + (v * 3 | 0)); }
  for (let row = 0; row < 8; row += 1) for (let col = 0; col < 4; col += 1) FACADES[style].draw(g, col * 64, row * 64, hash2(col, row, 7), hash2(col, row, 8), lit, col, row);
  if (!lit) { g.fillStyle = '#fff7ea'; g.fillRect(0, 500, 12, 12); } // a plain patch, which the parts of a building (awnings, plinths, cornices) point at
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}
const STYLE_TEXTURES = FACADES.map((f, i) => [windowTexture(false, i), windowTexture(true, i)]);
// Mostly what a city is made of: sandstone, brick, concrete, render and glass, with a few warmer ones.
const WALLS = ['#c9b79a', '#b8a48a', '#9c8f84', '#8c9094', '#b5654a', '#a1553d', '#d9d3c4', '#c9c2b0', '#7d8b99', '#6d7b8a', '#a39a8a', '#d6cbb6', '#c98f4a', '#87988c', '#b9a58b', '#8d7e70'];
const AWNINGS = ['#b5442f', '#2f6fb8', '#d9a21b', '#3d8a5a', '#f0e6d0', '#7a3b6b'];
const FLOOR = 3.5, TILE_W = 6, TILE_H = 28;
const beaconSpots = []; // [x, y, z, size, warm] of the lamps on the roofs, which light up at night
const lotSets = FACADES.map(() => [[], []]), lotBoxes = []; let curStyle = 0; // for each facade style, the geometry of the buildings near the junction and of the far ones (see DETAIL_RADIUS)
const lots = { push: (g) => lotSets[curStyle][lean ? 1 : 0].push(g) }; // lotBoxes: the ground footprint of every building and its height, [x0, x1, z0, z1, height]
const tint = new THREE.Color();
// A box in the building mesh that is only a colour: its texture coordinates point at a plain patch of the texture, so no windows are drawn on it.
// Far from the junction a building is drawn lean: its body, plinth, shopfront, cornice, parapet and roof, and none of the mullions, awnings, signs, roof units and other fittings, which are too small to see there.
// That was most of the scene's triangles and of the memory the page used while it was built (a page that used too much was reloaded by Safari). The same random numbers are drawn either way, so the layout is the same.
const DETAIL_RADIUS = 150;
let lean = false;
function part(geometry, colour, keep = false) {
  if (lean && !keep) return;
  const uv = geometry.attributes.uv, col = new Float32Array(uv.count * 3), c = new THREE.Color(colour);
  for (let i = 0; i < uv.count; i += 1) { uv.setXY(i, .02, .02); col.set([c.r, c.g, c.b], i * 3); }
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3)); lots.push(geometry);
}
const partBox = (w, h, d, x, y, z, colour, keep = false) => { if (lean && !keep) return; part(new THREE.BoxGeometry(w, h, d).translate(x, y, z), colour, true); };
// A windowed box from height y0 up by hh, tinted darker at the foot and lighter at the top so a building sits in the street and not on it.
function windowed(cx, cz, w, d, y0, hh, colour) {
  const g = new THREE.BoxGeometry(w, hh, d); g.translate(cx, y0 + hh / 2, cz);
  const uv = g.attributes.uv, pos = g.attributes.position, col = new Float32Array(uv.count * 3); tint.set(colour);
  for (let f = 0; f < 6; f += 1) for (let i = 0; i < 4; i += 1) {
    // A box's faces come in the order +x, -x, +y (roof), -y (base), +z, -z. Only the four sides get windows.
    const n = f * 4 + i, side = f !== 2 && f !== 3, along = f < 2 ? d : w;
    if (side) uv.setXY(n, uv.getX(n) * along / TILE_W, uv.getY(n) * hh / TILE_H); else uv.setXY(n, .02, .02);
    const k = side ? .7 + .35 * Math.min(1, (pos.getY(n) - y0) / hh) : 1;
    col.set([tint.r * k, tint.g * k, tint.b * k], n * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); lots.push(g);
}
function addLot(cx, cz, w, d, floors, colour) {
  lean = Math.hypot(cx, cz) > DETAIL_RADIUS;
  lotBoxes.push([cx - w / 2, cx + w / 2, cz - d / 2, cz + d / 2, floors * FLOOR + 4]); // the last number is how high it stands, with its roof fittings
  { const r = rand(); curStyle = floors >= 8 ? (r < .5 ? 1 : r < .75 ? 3 : 0) : r < .38 ? 0 : r < .62 ? 2 : r < .82 ? 3 : 1; } // tall buildings lean to glass and stone, low ones to brick
  const setback = floors >= 7 && rand() < .6, lower = setback ? floors - 2 : floors, h = lower * FLOOR;
  windowed(cx, cz, w, d, 0, h, colour);
  const light = new THREE.Color(colour).offsetHSL(0, -.02, .1), dark = new THREE.Color(colour).offsetHSL(0, -.03, -.18);
  let top = h + .4;
  if (setback) { windowed(cx, cz, w - 3, d - 3, h + .4, 2 * FLOOR, colour); partBox(w - 2.6, .35, d - 2.6, cx, h + .4 + 2 * FLOOR + .17, cz, light); top = h + .4 + 2 * FLOOR + .35; }
  // the street level: a plinth, the shopfront glass with mullions, a ledge over it, and the cap, belt courses and corner piers above
  partBox(w + .2, .6, d + .2, cx, .3, cz, dark, true);
  partBox(w + .12, 2.6, d + .12, cx, 1.9, cz, '#34495a', true); // the shopfront glass
  for (const [along, len, off, fx] of [['x', w, d / 2 + .08, 1], ['x', w, -d / 2 - .08, 1], ['z', d, w / 2 + .08, 0], ['z', d, -w / 2 - .08, 0]]) {
    for (let m = 1.2; m < len - .6; m += 2.4) { // a mullion, and a pale transom rail across the top of the glass
      const at = m - len / 2;
      if (fx) partBox(.14, 2.6, .12, cx + at, 1.9, cz + off, '#d9d2c2'); else partBox(.12, 2.6, .14, cx + off, 1.9, cz + at, '#d9d2c2');
    }
    if (fx) partBox(len, .1, .12, cx, 3.1, cz + off, '#d9d2c2'); else partBox(.12, .1, len, cx + off, 3.1, cz, '#d9d2c2');
    if (rand() < .55) { // a lit sign board over the door
      const sign = pick(['#f2f0e6', '#b5442f', '#2f6fb8', '#1f2a36', '#3d8a5a']), sl = Math.min(len * .55, 5);
      if (fx) partBox(sl, .5, .1, cx + (rand() - .5) * (len - sl), 3.28, cz + off + Math.sign(off) * .03, sign); else partBox(.1, .5, sl, cx + off + Math.sign(off) * .03, 3.28, cz + (rand() - .5) * (len - sl), sign);
    }
  }
  partBox(w + .3, .28, d + .3, cx, 3.55, cz, light); // the ledge above it
  for (let k = 1; 3 * k < lower; k += 1) partBox(w + .2, .22, d + .2, cx, 3 * k * FLOOR, cz, light); // belt courses every three floors
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) partBox(.5, h - 3.6, .5, cx + sx * (w / 2 + .05), 3.7 + (h - 3.6) / 2, cz + sz * (d / 2 + .05), light); // corner piers
  partBox(w + .4, .4, d + .4, cx, h + .2, cz, light, true); // the cornice
  for (const [ax, az, len, along] of [[0, 1, w, 'x'], [0, -1, w, 'x'], [1, 0, d, 'z'], [-1, 0, d, 'z']]) { // striped awnings over the shopfronts, on some sides
    if (rand() < .6) continue;
    const aw = len * (.4 + rand() * .4), col = pick(AWNINGS), at = (rand() - .5) * (len - aw);
    for (let i = 0, n = Math.max(2, Math.round(aw / .5)); i < n; i += 1) {
      const seg = aw / n, mid = -aw / 2 + (i + .5) * seg, c = i % 2 ? '#f2eee2' : col;
      if (along === 'x') partBox(seg, .14, .95, cx + at + mid, 3.1 - .05, cz + az * (d / 2 + .5), c); else partBox(.95, .14, seg, cx + ax * (w / 2 + .5), 3.05, cz + at + mid, c);
    }
  }
  // the roof: a parapet round the edge and what stands on it
  const rw = setback ? w - 3 : w, rd = setback ? d - 3 : d;
  if (top > h + .5 || true) for (const [bw, bd, bx, bz] of [[rw, .25, 0, rd / 2], [rw, .25, 0, -rd / 2], [.25, rd, rw / 2, 0], [.25, rd, -rw / 2, 0]]) partBox(bw, .55, bd, cx + bx, top + .27, cz + bz, light, true);
  // The roof deck, then what stands on it. Every roof gets a surface, a lift or stair housing and a few units; the rest depends on the kind of building.
  let heli = null; // a helipad is placed first, and nothing else may stand within its circle
  const rawAt = (m) => [cx + (rand() - .5) * (rw - m), cz + (rand() - .5) * (rd - m)];
  if (floors >= 8 && rw > 12 && rd > 12 && rand() < .5) heli = rawAt(9);
  // Solar panels on about 22.5% of the roofs (chosen from the position, so no random number is used and nothing else in the city moves): rows of tilted panels over one half of the roof, 1 m in from the parapet.
  // The roof units, the lift housing and the helipad keep out of that half.
  const solar = !lean && floors >= 3 && Math.min(rw, rd) >= 9 && hash2(Math.round(cx), Math.round(cz), 31) < .225;
  if (solar) heli = null;
  const half = hash2(Math.round(cx), Math.round(cz), 32) < .5 ? -1 : 1; // which half of the roof, along z
  const panelArea = solar ? { x0: cx - rw / 2 + 1, x1: cx + rw / 2 - 1, z0: half > 0 ? cz + .5 : cz - rd / 2 + 1, z1: half > 0 ? cz + rd / 2 - 1 : cz - .5 } : null;
  const inPanels = (q, margin) => panelArea && q[0] > panelArea.x0 - margin && q[0] < panelArea.x1 + margin && q[1] > panelArea.z0 - margin && q[1] < panelArea.z1 + margin;
  const at = (m) => { let q = rawAt(m); for (let t = 0; t < 24 && ((heli && Math.hypot(q[0] - heli[0], q[1] - heli[1]) < 5.2) || (floors >= 6 && q[1] > cz + rd / 2 - 3.6) || inPanels(q, 1.6)); t += 1) q = rawAt(m); return q; }; // the strip along the front edge is kept for a billboard
  const GREYS = ['#8e9399', '#a3a8ad', '#7b8187', '#b4b8bc'];
  const deck = pick(['#4a4d52', '#5d6166', '#6a5f55', '#575c52']);
  partBox(rw - .3, .12, rd - .3, cx, top + .06, cz, deck, true); // the roof surface, inside the parapet
  for (let i = 0; i < 3; i += 1) partBox(rw - .5, .02, .08, cx, top + .13, cz - rd / 2 + (i + 1) * rd / 4, '#3a3d41'); // seams in the membrane
  if (panelArea) { // the array: rows along x, each panel tilted toward +z, in a frame of two rails with struts, the rows far enough apart not to shade one another
    const W = 1.7, D = 1.1, GAP = .05, tilt = .3, pitch = 2.1, lowY = top + .12 + .22, rise2 = D * Math.sin(tilt);
    const cols = Math.min(14, Math.floor((panelArea.x1 - panelArea.x0) / (W + GAP))), rows = Math.min(6, Math.floor((panelArea.z1 - panelArea.z0) / pitch));
    if (cols >= 2 && rows >= 1) {
      const width = cols * (W + GAP) - GAP, x0p = (panelArea.x0 + panelArea.x1) / 2 - width / 2, z0p = (panelArea.z0 + panelArea.z1) / 2 - (rows * pitch - (pitch - D * Math.cos(tilt))) / 2;
      for (let r = 0; r < rows; r += 1) {
        const zHigh = z0p + r * pitch, zLow = zHigh + D * Math.cos(tilt); // the edge nearer -z is the high one
        for (let c = 0; c < cols; c += 1) {
          const shade = new THREE.Color('#1c2f4d').offsetHSL(0, 0, (hash2(c, r, Math.round(cx)) - .5) * .035); // a little different from one panel to the next
          part(new THREE.BoxGeometry(W, .05, D).rotateX(tilt).translate(x0p + c * (W + GAP) + W / 2, lowY + rise2 / 2 + .04, (zHigh + zLow) / 2), shade);
        }
        partBox(width, .06, .06, x0p + width / 2, lowY, zLow, '#8f959b'); partBox(width, .06, .06, x0p + width / 2, lowY + rise2, zHigh, '#8f959b'); // the rails the panels sit on
        for (const sx of [0, width]) { partBox(.06, rise2 + .2, .06, x0p + sx, top + .12 + (rise2 + .2) / 2 + .05, zHigh, '#8f959b'); partBox(.06, .2, .06, x0p + sx, top + .12 + .1, zLow, '#8f959b'); } // a strut at each end, tall at the high rail and short at the low one
      }
    }
  }
  let lampOver = null;
  if (floors >= 3) { const [x, z] = at(6); partBox(2.6 + rand() * 1.2, 2.4, 2.4, x, top + 1.3, z, pick(['#b9b4a8', '#a9a69c'])); partBox(.9, 1.7, .08, x, top + 1.0, z + 1.24, '#2c3a44'); lampOver = [x, z + 1.35]; } // the lift and stair housing, with a door
  const area = rw * rd, units = 1 + Math.floor(rand() * 4) + Math.min(14, Math.floor(area / 90)); // bigger roofs carry more
  for (let k = 0; k < units; k += 1) { // air-conditioning units: a box, a fan grille on top and a pipe run
    const [x, z] = at(5), uw = 1.4 + rand() * 1.6;
    partBox(uw, 1.1, 1.3, x, top + .7, z, pick(GREYS)); part(new THREE.CylinderGeometry(.5, .5, .08, 12).translate(x, top + 1.28, z), '#2f3236');
    partBox(.12, .12, 1.5, x + uw / 2 + .1, top + .3, z - .7, '#6b6f74');
  }
  for (let rep = 0, reps = 1 + Math.min(5, Math.floor(area / 350)); rep < reps; rep += 1) { const kind = rand();
  if (floors >= 6 && kind < .3) { // a water tank on a stand
    const [x, z] = at(5); part(new THREE.CylinderGeometry(1.1, 1.1, 2.2, 12).translate(x, top + 2.4, z), '#9a7b5a'); part(new THREE.ConeGeometry(1.2, .5, 12).translate(x, top + 3.75, z), '#6e5a44');
    for (const [dx, dz] of [[-.8, -.8], [.8, -.8], [-.8, .8], [.8, .8]]) partBox(.12, 1.3, .12, x + dx, top + .75, z + dz, '#4a4d52');
  } else if (floors >= 4 && kind < .75) { // skylights: glass pitched over a short kerb
    const [x, z] = at(6); partBox(3.2, .35, 1.8, x, top + .3, z, '#cfd3d6'); part(new THREE.BoxGeometry(2.9, .06, 1.5).translate(x, top + .52, z), '#8fb3c9');
  } else if (floors >= 4) { // a plant room with louvres, and a cooling fan
    const [x, z] = at(7); partBox(3.6, 1.8, 2.6, x, top + 1, z, '#9aa0a5'); for (let i = 0; i < 5; i += 1) partBox(3.0, .06, .06, x, top + .5 + i * .28, z + 1.33, '#3a3d41'); part(new THREE.CylinderGeometry(.8, .8, .2, 14).translate(x + 3, top + .5, z), '#2f3236');
  }
  }
  if (floors <= 3 && rand() < .5) { const [x, z] = at(4); partBox(.5, 1.5, .5, x, top + .8, z, '#8a5a44'); partBox(.7, .15, .7, x, top + 1.6, z, '#6b4636'); } // a brick chimney
  if (heli) { const [x, z] = heli; part(new THREE.CylinderGeometry(3.2, 3.2, .12, 18).translate(x, top + .2, z), '#3d6f4a'); part(new THREE.CylinderGeometry(2.6, 2.6, .02, 18).translate(x, top + .28, z), '#f0f0e8'); partBox(.8, .02, 3.6, x, top + .3, z, '#d9a21b'); } // the helipad
  if (floors >= 6 && rw > 11 && rand() < .35) { const x = cx + (rand() - .5) * (rw - 9), z = cz + rd / 2 - 1.6; partBox(.25, 2.4, .25, x - 3, top + 1.4, z, '#5c6168'); partBox(.25, 2.4, .25, x + 3, top + 1.4, z, '#5c6168'); partBox(7, 2.6, .18, x, top + 3.6, z, pick(['#d9a21b', '#2f6fb8', '#b5442f', '#f2f0e6'])); } // a billboard on two posts, on the edge strip
  if (rand() < .3) { const [x, z] = at(5); part(new THREE.CylinderGeometry(.9, .9, .12, 12).rotateX(1.1).translate(x, top + 1.2, z), '#d9d9d4'); partBox(.1, 1.2, .1, x, top + .6, z, '#4a4d52'); } // a satellite dish
  for (const [bw, bd, bx, bz] of [[rw - .6, .05, 0, rd / 2 - .5], [rw - .6, .05, 0, -rd / 2 + .5]]) if (floors >= 4) partBox(bw, .05, bd, cx + bx, top + 1.1, cz + bz, '#5c6168'); // a safety rail along two edges
  if (floors >= 9) { const ah = 6 + rand() * 4, [ax, az] = at(3); partBox(.18, ah, .18, ax, top + ah / 2, az, '#5c6168'); beaconSpots.push([ax, top + ah + .2, az, .5]); } // an antenna with a red light on its tip
  if (floors >= 3 && lampOver) beaconSpots.push([lampOver[0], top + 2.5, lampOver[1], .3, 1]); // a warm lamp over the rooftop door
}
// The detection cameras sit on the faces of two low buildings per approach, 20 m and 60 m from the stop line (CAMERA_RIG, tools/rigsearch.mjs). Each is a deliberate 4 floor building, 12 m,
// so a camera 10 m up has a face to be fixed to. The random lots leave room for them.
const CAMERA_STATIONS = [20, 60], HOST = { width: 12, depth: 12, floors: 4 };
// Whether a building is there for a camera differs from road to road, so the four approaches show the mixes that come up: both cameras on buildings, one on a building and one on a pole,
// both on poles. A pole is the fallback where there is no building (a new 15 m pole on the footpath, which costs about four times as much as a facade).
const MOUNT_PLAN = [['building', 'building'], ['pole', 'pole'], ['building', 'pole'], ['pole', 'building']];
const CAMERA_HOSTS = [];
// A building goes where a block of buildings is. Where its footprint would land in the park or across a side street, the camera goes on a pole instead.
const PARK_CORNER = [EDGE_OF_ROAD, STEP - HALF_STREET];
const crossesStreet = (a0, a1) => { for (let m = 1; m <= STREETS; m += 1) for (const sign of [-1, 1]) { const lo = Math.min(sign * (m * STEP - HALF_STREET), sign * (m * STEP + HALF_STREET)), hi = Math.max(sign * (m * STEP - HALF_STREET), sign * (m * STEP + HALF_STREET)); if (a1 > lo - 1 && a0 < hi + 1) return true; } return false; };
for (let k = 0; k < 4; k += 1) for (const [i, along] of CAMERA_STATIONS.entries()) {
  if (MOUNT_PLAN[k][i] !== 'building') continue;
  const [ax, az] = rot(k, EDGE_OF_ROAD, YS - along - HOST.width / 2), [bx, bz] = rot(k, EDGE_OF_ROAD + HOST.depth, YS - along + HOST.width / 2);
  const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), z0 = Math.min(az, bz), z1 = Math.max(az, bz);
  const inPark = x1 > PARK_CORNER[0] && x0 < PARK_CORNER[1] + 1 && z1 > PARK_CORNER[0] && z0 < PARK_CORNER[1] + 1;
  if (inPark || crossesStreet(x0, x1) || crossesStreet(z0, z1)) { MOUNT_PLAN[k][i] = 'pole'; continue; }
  CAMERA_HOSTS.push({ k, along, x0, x1, z0, z1 });
}
const overlapsHost = (cx, cz, w, d) => CAMERA_HOSTS.some((h) => Math.abs(cx - (h.x0 + h.x1) / 2) < w / 2 + (h.x1 - h.x0) / 2 + 1.5 && Math.abs(cz - (h.z0 + h.z1) / 2) < d / 2 + (h.z1 - h.z0) / 2 + 1.5);
const rise = (x, z) => Math.min(22, 1 + Math.max(0, Math.hypot(x, z) - 20) / 9); // lots rise away from the junction, so none hides it
// A block is a ring of buildings along its four edges, 18.5 to 20 m deep, with the inside divided into more buildings. The buildings stand almost against one another (0.8 m between them) with an alley of 3 m
// now and then, and a 3 m lane round the inside of the ring and between the inner buildings, so the block is closely built and no wide strip of ground shows between a building and the next. One inner space in a
// block, now and then, is a courtyard (a paved square with trees and benches) and not a building. Heights are as before: low near the junction, rising with the distance from it.
// Two car parks, each off the side street nearest the junction on the kerb side of one road, on the junction side of the street: an office's (on the street that the east road's traffic turns into, see
// carpark-layout.js) and a restaurant's. A car park has a building behind it. Its block leaves the space free: `hole` is the rectangle of the car park and its building, in the world.
const VENUE_AT = 58, EDGE_FY = STEP - HALF_STREET, VENUE_BUILD = 18, VENUE_HALF = 20; // the aisle 58 m along the street from the road, the block's edge, the building's depth, half the width of the band
const VENUES = [{ kind: 'office', k: 3, floors: 6, wall: '#7d8b99' }, { kind: 'restaurant', k: 1, floors: 2, wall: '#d9d3c4' }].map((v) => {
  const toWorld = (a, t) => rot(v.k, VENUE_AT + a, EDGE_FY - t), tFar = carparkFront() + VENUE_BUILD + 1;
  const corners = [[-VENUE_HALF, 0], [VENUE_HALF, 0], [-VENUE_HALF, tFar], [VENUE_HALF, tFar]].map(([a, t]) => toWorld(a, t));
  return { ...v, toWorld, hole: { x0: Math.min(...corners.map((c) => c[0])), x1: Math.max(...corners.map((c) => c[0])), z0: Math.min(...corners.map((c) => c[1])), z1: Math.max(...corners.map((c) => c[1])) } };
});
const BLOCK_RING = 20, BLOCK_ALLEY = 3, BLOCK_GAP = .8, INNER_LANE = 3;
const courtyards = []; // [x0, x1, z0, z1] of each, to be furnished once the trees and the benches can be made
function fillBlock(x0, x1, z0, z1, park = false) {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  if (park) return; // the park is built separately
  // The lots along one edge from a to b, facing out: widths of 10 to 20 m that add up to the edge, and between two of them a gap, now and then an alley.
  const lot = (ax, az, bx, bz, horizontal) => {
    const len = Math.abs(horizontal ? bx - ax : bz - az), sgn = horizontal ? Math.sign(bx - ax) : Math.sign(bz - az), n = Math.max(1, Math.round(len / (11 + rand() * 8)));
    const weights = Array.from({ length: n }, () => .7 + rand() * .6), total = weights.reduce((p, q) => p + q, 0), gaps = Array.from({ length: n + 1 }, (_, k) => (k > 0 && k < n && rand() < .2 ? BLOCK_ALLEY : BLOCK_GAP));
    let at = 0;
    for (let k = 0; k < n; k += 1) {
      const w = weights[k] / total * len, from = at + gaps[k] / 2, to = at + w - gaps[k + 1] / 2, mid = (from + to) / 2, width = to - from;
      at += w;
      const dep = BLOCK_RING - rand() * 1.5, shift = horizontal ? (az < cz ? 1 : -1) : (ax < cx ? 1 : -1);
      const x = horizontal ? ax + sgn * mid : ax, z = horizontal ? az : az + sgn * mid, px = horizontal ? x : x + shift * dep / 2, pz = horizontal ? z + shift * dep / 2 : z;
      const top = rise(px, pz), floors = Math.max(2, Math.round(2 + Math.pow(rand(), 1.7) * (top - 2)));
      if (!overlapsHost(px, pz, horizontal ? width : dep, horizontal ? dep : width)) addLot(px, pz, horizontal ? width : dep, horizontal ? dep : width, floors, pick(WALLS));
    }
  };
  lot(x0, z0, x1, z0, true); lot(x0, z1, x1, z1, true);
  const hole = VENUES.map((v) => v.hole).find((r) => r.x0 >= x0 - 1 && r.x1 <= x1 + 1 && r.z0 >= z0 - 1 && r.z1 <= z1 + 1) || null; // the car park and its building, when they are in this block
  const verticalEdge = (x) => {
    const from = z0 + BLOCK_RING, to = z1 - BLOCK_RING;
    if (hole && hole.x0 <= x + 1 && hole.x1 >= x - 1) { // the car park is on this edge: the lots go either side of it
      if (hole.z0 - BLOCK_ALLEY > from) lot(x, from, x, hole.z0 - BLOCK_ALLEY, false);
      if (hole.z1 + BLOCK_ALLEY < to) lot(x, hole.z1 + BLOCK_ALLEY, x, to, false);
    } else lot(x, from, x, to, false);
  };
  verticalEdge(x0); verticalEdge(x1);
  // The inside: split the space into parts of at most about 28 m, with an alley between, and put a building in each (or, once in a while, a courtyard in one).
  let yard = false;
  const fill = (a0, a1, b0, b1) => {
    const w = a1 - a0, d = b1 - b0;
    if (w > 30 || d > 30) { // split across the longer side, somewhere in the middle
      const at = .4 + rand() * .2;
      if (w >= d) { const m = a0 + w * at; fill(a0, m - BLOCK_ALLEY / 2, b0, b1); fill(m + BLOCK_ALLEY / 2, a1, b0, b1); } else { const m = b0 + d * at; fill(a0, a1, b0, m - BLOCK_ALLEY / 2); fill(a0, a1, m + BLOCK_ALLEY / 2, b1); }
      return;
    }
    if (w < 8 || d < 8) return;
    if (!yard && w >= 14 && d >= 14 && w <= 26 && d <= 26 && rand() < .3) { yard = true; courtyards.push([a0, a1, b0, b1]); return; }
    const px = (a0 + a1) / 2, pz = (b0 + b1) / 2, top = rise(px, pz);
    addLot(px, pz, w, d, Math.max(3, Math.round(top * .5 + rand() * 3)), pick(WALLS));
  };
  const ia0 = x0 + BLOCK_RING + INNER_LANE, ia1 = x1 - BLOCK_RING - INNER_LANE, ib0 = z0 + BLOCK_RING + INNER_LANE, ib1 = z1 - BLOCK_RING - INNER_LANE;
  if (!hole) fill(ia0, ia1, ib0, ib1);
  else { // the car park and its building take a band across the inside from the edge: fill what is left on either side and beyond it
    fill(ia0, ia1, ib0, Math.min(ib1, hole.z0 - BLOCK_ALLEY)); fill(ia0, ia1, Math.max(ib0, hole.z1 + BLOCK_ALLEY), ib1);
    const right = hole.x1 >= x1 - 1;
    fill(right ? ia0 : hole.x1 + BLOCK_ALLEY, right ? hole.x0 - BLOCK_ALLEY : ia1, Math.max(ib0, hole.z0), Math.min(ib1, hole.z1));
  }
}
const blockRects = []; // every block but the park: [x0, x1, z0, z1]
for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
  const edges = [EDGE_OF_ROAD]; for (let m = 1; m <= STREETS; m += 1) edges.push(m * STEP - HALF_STREET, m * STEP + HALF_STREET);
  for (let i = 0; i + 1 < edges.length; i += 2) for (let j = 0; j + 1 < edges.length; j += 2) {
    const [a0, a1] = [sx * edges[i], sx * edges[i + 1]].sort((p, q) => p - q), [b0, b1] = [sz * edges[j], sz * edges[j + 1]].sort((p, q) => p - q);
    const isPark = sx > 0 && sz > 0 && i === 0 && j === 0; // the corner nearest the default camera is the park
    if (!isPark) blockRects.push([a0, a1, b0, b1]);
    fillBlock(a0, a1, b0, b1, isPark);
  }
}
for (const h of CAMERA_HOSTS) addLot((h.x0 + h.x1) / 2, (h.z0 + h.z1) / 2, h.x1 - h.x0, h.z1 - h.z0, HOST.floors, pick(WALLS)); // the camera buildings
// The corners of the junction where no building stands (a camera building took the space a lot would have had) get a bike and scooter share hub, in the biggest free rectangle beside the junction, kept 1 m
// off the footpath and 0.8 m off the buildings. Everything in it is low, so it hides nothing from the angled view. The page keeps the hubs' night light in applyLight.
// The car parks and the buildings behind them.
const venues = [], venueSteel = new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: .5, metalness: .4 });
for (const v of VENUES) {
  const canvas = document.createElement('canvas'); paintLot(canvas);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const lotMat = groundMaterial({ map: texture, roughness: .95, alphaTest: .5, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -12 }); wetMaterials.push(lotMat); keepShadeColour(lotMat);
  lotMat.userData.grey = greyOf(canvas, texture); // the night light of the surface is grey, as the side streets' is
  const built = buildCarPark(v.kind, { lotMaterial: lotMat, kerbMat, metalMat: venueSteel, lampMat: lampFront });
  const [gx, gz] = rot(v.k, VENUE_AT, EDGE_FY); built.group.position.set(gx, 0, gz); built.group.rotation.y = -v.k * Q; scene.add(built.group);
  const corners = [[-15, built.front], [15, built.front], [-15, built.front + VENUE_BUILD], [15, built.front + VENUE_BUILD]].map(([a, t]) => v.toWorld(a, t));
  const bx0 = Math.min(...corners.map((c) => c[0])), bx1 = Math.max(...corners.map((c) => c[0])), bz0 = Math.min(...corners.map((c) => c[1])), bz1 = Math.max(...corners.map((c) => c[1]));
  addLot((bx0 + bx1) / 2, (bz0 + bz1) / 2, bx1 - bx0, bz1 - bz0, v.floors, v.wall);
  const lotCorners = [[-carparkHalfWidth() - .6, 0], [carparkHalfWidth() + .6, 0], [-carparkHalfWidth() - .6, carparkDepth() + .6], [carparkHalfWidth() + .6, carparkDepth() + .6]].map(([a, t]) => v.toWorld(a, t));
  lotBoxes.push([Math.min(...lotCorners.map((c) => c[0])), Math.max(...lotCorners.map((c) => c[0])), Math.min(...lotCorners.map((c) => c[1])), Math.max(...lotCorners.map((c) => c[1])), .3]); // the surface: the viewpoint stays above it, and the gaps are not filled
  venues.push({ ...v, lotMat, group: built.group });
}
const hubs = [];
for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
  if (sx > 0 && sz > 0) continue; // the park
  const near = lotBoxes.map((b) => [Math.min(b[0] * sx, b[1] * sx), Math.max(b[0] * sx, b[1] * sx), Math.min(b[2] * sz, b[3] * sz), Math.max(b[2] * sz, b[3] * sz)]).filter((b) => b[1] > EDGE_OF_ROAD && b[3] > EDGE_OF_ROAD && b[0] < 90 && b[2] < 90);
  let best = null;
  for (let X = EDGE_OF_ROAD + 6; X <= 60; X += 1) { let Z = 60; for (const b of near) if (b[0] < X && b[1] > EDGE_OF_ROAD) Z = Math.min(Z, b[2]); const area = (X - EDGE_OF_ROAD) * (Z - EDGE_OF_ROAD); if (!best || area > best.area) best = { X, Z, area }; }
  const u0 = EDGE_OF_ROAD + 1, width = best.X - .8 - u0, depth = best.Z - .8 - u0;
  if (width < 9 || depth < 9) continue;
  const hub = buildHub(Math.min(width, 22), Math.min(depth, 14));
  hub.group.scale.set(sx, 1, sz); hub.group.position.set(sx * u0, 0, sz * u0); scene.add(hub.group); hubs.push(hub);
  hub.pendingLife = { to: (u, v) => ({ x: sx * (u0 + u), z: sz * (u0 + v) }) }; // the people are made once the page has what they need (below)
  const hubW = Math.min(width, 22), hubD = Math.min(depth, 14);
  hub.footprint = [Math.min(sx * u0, sx * (u0 + hubW)), Math.max(sx * u0, sx * (u0 + hubW)), Math.min(sz * u0, sz * (u0 + hubD)), Math.max(sz * u0, sz * (u0 + hubD)), hub.height]; // x0, x1, z0, z1 and the height: what the Go to view of the hire frames
  lotBoxes.push(hub.footprint); // the viewpoint keeps clear of it, and what is left of the free space is filled below
}
// What is left. Where the hubs, the camera buildings, the alleys and the lanes leave an open space of 7 m by 7 m or more in a block (the larger ones first), it is filled: with a pocket park (a courtyard, the same as the ones inside the blocks)
// where it is within 70 m of the junction, because a building there would stand in front of the road in the angled view, and with a building where it is further out. The biggest space goes first.
{
  const CELL = 1.5;
  for (const [x0, x1, z0, z1] of blockRects) {
    const nx = Math.ceil((x1 - x0) / CELL), nz = Math.ceil((z1 - z0) / CELL), covered = new Uint8Array(nx * nz);
    const mark = (a0, a1, b0, b1) => { for (let i = Math.max(0, Math.floor((a0 - x0) / CELL)); i < Math.min(nx, Math.ceil((a1 - x0) / CELL)); i += 1) for (let j = Math.max(0, Math.floor((b0 - z0) / CELL)); j < Math.min(nz, Math.ceil((b1 - z0) / CELL)); j += 1) covered[i * nz + j] = 1; };
    for (const b of lotBoxes) if (b[1] > x0 && b[0] < x1 && b[3] > z0 && b[2] < z1) mark(b[0] - .3, b[1] + .3, b[2] - .3, b[3] + .3);
    for (const [a0, a1, b0, b1] of courtyards) if (a1 > x0 && a0 < x1 && b1 > z0 && b0 < z1) mark(a0, a1, b0, b1);
    for (const MIN_CELLS of [Math.ceil(9 / CELL), Math.ceil(7 / CELL)]) for (let pass = 0; pass < 12; pass += 1) { // spaces of 9 m by 9 m and more first, then the narrower ones down to 7 m (6.7 m of courtyard once the edges are trimmed, enough for a lawn each side of the paths), which would otherwise be bare paving
      // the biggest empty rectangle in the grid, by the histogram method, taking only those at least MIN_CELLS on both sides
      const height = new Int32Array(nz); let best = null;
      for (let i = 0; i < nx; i += 1) {
        for (let j = 0; j < nz; j += 1) height[j] = covered[i * nz + j] ? 0 : height[j] + 1;
        for (let j = 0; j < nz; j += 1) { // the widest run of columns, from j, at least as tall as the one at j (rows i - h + 1 to i)
          const h = height[j]; if (h < MIN_CELLS) continue;
          let lo = j, hi = j; while (lo > 0 && height[lo - 1] >= h) lo -= 1; while (hi < nz - 1 && height[hi + 1] >= h) hi += 1;
          const along = hi - lo + 1; if (along < MIN_CELLS) continue;
          if (!best || h * along > best.h * best.w) best = { i0: i - h + 1, j0: lo, h, w: along };
        }
      }
      if (!best) break;
      // The space is grown into any empty cells beside it (up to 30 m across), so that a strip too narrow to be filled on its own is taken in with its neighbour and not left as bare paving.
      let i0 = best.i0, i1 = best.i0 + best.h - 1, j0 = best.j0, j1 = best.j0 + best.w - 1;
      const rowFree = (i) => { for (let j = j0; j <= j1; j += 1) if (covered[i * nz + j]) return false; return true; }, colFree = (j) => { for (let i = i0; i <= i1; i += 1) if (covered[i * nz + j]) return false; return true; };
      for (let grown = true; grown;) {
        grown = false;
        if (i1 + 1 < nx && (i1 - i0 + 2) * CELL <= 30 && rowFree(i1 + 1)) { i1 += 1; grown = true; }
        if (i0 > 0 && (i1 - i0 + 2) * CELL <= 30 && rowFree(i0 - 1)) { i0 -= 1; grown = true; }
        if (j1 + 1 < nz && (j1 - j0 + 2) * CELL <= 30 && colFree(j1 + 1)) { j1 += 1; grown = true; }
        if (j0 > 0 && (j1 - j0 + 2) * CELL <= 30 && colFree(j0 - 1)) { j0 -= 1; grown = true; }
      }
      const rx0 = x0 + i0 * CELL + .4, rx1 = x0 + (i1 + 1) * CELL - .4, rz0 = z0 + j0 * CELL + .4, rz1 = z0 + (j1 + 1) * CELL - .4;
      mark(rx0 - .4, rx1 + .4, rz0 - .4, rz1 + .4);
      const px = (rx0 + rx1) / 2, pz = (rz0 + rz1) / 2, w = rx1 - rx0, d = rz1 - rz0, near = Math.hypot(Math.max(0, Math.abs(px) - w / 2), Math.max(0, Math.abs(pz) - d / 2)) < 70;
      // A pocket park where there is room for one (8 m across) and no other courtyard within 38 m, so every part of the city has one close by and none has two together. Anywhere else the space is built on, so a block is not a scatter of small yards: a building near the junction is low (2 or 3
      // floors) so that it does not stand in front of the road in the angled view, and one further out is as tall as its surroundings.
      const roomy = Math.min(w, d) >= 8 && w * d >= 90 && courtyards.every((c) => Math.hypot((c[0] + c[1]) / 2 - px, (c[2] + c[3]) / 2 - pz) > 38);
      if (near && roomy) courtyards.push([rx0, rx1, rz0, rz1]);
      else addLot(px, pz, w, d, near ? 2 + Math.floor(rand() * 2) : Math.max(3, Math.round(rise(px, pz) * .5 + rand() * 3)), pick(WALLS));
    }
  }
}
// Each style is two meshes with one material: the buildings within DETAIL_RADIUS of the junction, which cast shadows, and the far ones, which do not (the shadow map covers about 100 m round the junction, so
// a far building never casts into it, and drawing it into the map was most of the triangles of the shadow pass).
const buildings = lotSets.flatMap(([near, far], i) => {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, map: STYLE_TEXTURES[i][0], emissive: 0xffd98a, emissiveMap: STYLE_TEXTURES[i][1], emissiveIntensity: 0, roughness: .85 });
  return [[near, true], [far, false]].filter(([set]) => set.length).map(([set, casts]) => {
    const mesh = new THREE.Mesh(mergeGeometries(set), material);
    mesh.castShadow = casts; mesh.receiveShadow = true; scene.add(mesh); return mesh;
  });
});
const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a }), roofLampMat = new THREE.MeshBasicMaterial({ color: 0xffd98a });
const beacons = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), beaconMat, Math.max(1, beaconSpots.filter((b) => !b[4]).length));
const roofLamps = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), roofLampMat, Math.max(1, beaconSpots.filter((b) => b[4]).length));
{ const m = new THREE.Matrix4(); let r = 0, w = 0; for (const [x, y, z, size, warm] of beaconSpots) { m.makeScale(size, size, size).setPosition(x, y, z); (warm ? roofLamps : beacons).setMatrixAt(warm ? w++ : r++, m); } beacons.count = r; roofLamps.count = w; beacons.visible = roofLamps.visible = false; scene.add(beacons, roofLamps); }
// ---------- the park: one block, with paths, a fountain, a pond, a court, a playground and a kiosk ----------
const PARK = { x0: EDGE_OF_ROAD, x1: STEP - HALF_STREET, z0: EDGE_OF_ROAD, z1: STEP - HALF_STREET };
const PARK_SIZE = PARK.x1 - PARK.x0, PARK_C = [(PARK.x0 + PARK.x1) / 2, (PARK.z0 + PARK.z1) / 2];
const inPark = (u, v) => [PARK_C[0] + u, PARK_C[1] + v];
const RING = 36, RING_R = 10, PATH_W = 4.8; // wide enough for a lane for each pace in each direction, with a lane's width between them
const ZONES = { // park-local, metres: centre and half sizes
  plaza: { u: 0, v: 0, r: 11 }, pond: { u: -20, v: -19, rx: 11, rz: 8 }, court: { u: 19.5, v: 21.5, hx: 11, hz: 6 }, // clear of the ring path by at least 3.4 m all round
  play: { u: -22, v: 22, hx: 8, hz: 8 }, kiosk: { u: 22, v: -22, hx: 3.5, hz: 2.8 },
};
const busy = (u, v, pad = 2.5) => {
  const z = ZONES;
  if (Math.hypot(u, v) < z.plaza.r + 5) return true;
  if (((u - z.pond.u) / (z.pond.rx + pad)) ** 2 + ((v - z.pond.v) / (z.pond.rz + pad)) ** 2 < 1) return true;
  if (Math.abs(u - z.court.u) < z.court.hx + pad && Math.abs(v - z.court.v) < z.court.hz + pad) return true;
  if (Math.abs(u - z.play.u) < z.play.hx + pad && Math.abs(v - z.play.v) < z.play.hz + pad) return true;
  if (Math.abs(u - z.kiosk.u) < z.kiosk.hx + 7 && Math.abs(v - z.kiosk.v) < z.kiosk.hz + 7) return true;
  const onRing = Math.max(Math.abs(u), Math.abs(v)) > RING - PATH_W && Math.max(Math.abs(u), Math.abs(v)) < RING + PATH_W;
  return onRing || Math.abs(u) < PATH_W || Math.abs(v) < PATH_W;
};
function paintPark(ctx) {
  const k = ctx.canvas.width / PARK_SIZE;
  ctx.save(); ctx.translate(ctx.canvas.width / 2, ctx.canvas.height / 2); ctx.scale(k, k);
  const h = PARK_SIZE / 2;
  ctx.fillStyle = '#6aa656'; ctx.fillRect(-h, -h, PARK_SIZE, PARK_SIZE);
  ctx.fillStyle = 'rgba(255,255,255,.045)'; for (let x = -h; x < h; x += 8) ctx.fillRect(x, -h, 4, PARK_SIZE); // mown stripes
  const { pond, court, play } = ZONES;
  ctx.fillStyle = '#c9bb98'; ctx.beginPath(); ctx.ellipse(pond.u, pond.v, pond.rx + .9, pond.rz + .9, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2f6b73'; ctx.beginPath(); ctx.ellipse(pond.u, pond.v, pond.rx, pond.rz, 0, 0, Math.PI * 2); ctx.fill(); // the bed, seen through the water
  ctx.fillStyle = '#2f6e96'; ctx.fillRect(court.u - court.hx, court.v - court.hz, 2 * court.hx, 2 * court.hz);
  ctx.strokeStyle = '#f4f4ee'; ctx.lineWidth = .15;
  ctx.strokeRect(court.u - court.hx + 1, court.v - court.hz + 1, 2 * court.hx - 2, 2 * court.hz - 2);
  ctx.beginPath(); ctx.moveTo(court.u, court.v - court.hz + 1); ctx.lineTo(court.u, court.v + court.hz - 1); ctx.stroke();
  ctx.beginPath(); ctx.arc(court.u, court.v, 1.8, 0, Math.PI * 2); ctx.stroke();
  for (const s of [-1, 1]) ctx.strokeRect(court.u + s * (court.hx - 1) - (s > 0 ? 4 : 0), court.v - 2.4, 4, 4.8);
  ctx.fillStyle = '#e0c88a'; ctx.fillRect(play.u - play.hx, play.v - play.hz, 2 * play.hx, 2 * play.hz);
  ctx.strokeStyle = '#8a6a4a'; ctx.lineWidth = .3; ctx.strokeRect(play.u - play.hx, play.v - play.hz, 2 * play.hx, 2 * play.hz);
  ctx.restore();
}
// The paths and the plaza are on a layer of their own over the grass, so that at night they get the same correction as the road and the footpaths and stay the same grey-beige, which the grass must not get.
function paintParkPaths(ctx) {
  const k = ctx.canvas.width / PARK_SIZE;
  ctx.save(); ctx.translate(ctx.canvas.width / 2, ctx.canvas.height / 2); ctx.scale(k, k);
  const h = PARK_SIZE / 2;
  const pave = COLORS.walk; // the same grey as the footpaths
  ctx.strokeStyle = pave; ctx.lineWidth = PATH_W; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.roundRect(-RING, -RING, 2 * RING, 2 * RING, RING_R); ctx.stroke();
  ctx.fillStyle = pave; ctx.fillRect(-PATH_W / 2, -h, PATH_W, PARK_SIZE); ctx.fillRect(-h, -PATH_W / 2, PARK_SIZE, PATH_W);
  ctx.beginPath(); ctx.arc(0, 0, ZONES.plaza.r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#c4c0b6'; ctx.beginPath(); ctx.arc(0, 0, ZONES.plaza.r - 1.2, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 16; i += 1) { // flower beds around the plaza
    const a = (i / 16) * Math.PI * 2, c = ['#e85d75', '#f2b134', '#b46bd6', '#f6f1e3'][i % 4];
    ctx.fillStyle = '#4f8a42'; ctx.beginPath(); ctx.arc(Math.cos(a) * (ZONES.plaza.r + 2.2), Math.sin(a) * (ZONES.plaza.r + 2.2), 1.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(Math.cos(a) * (ZONES.plaza.r + 2.2), Math.sin(a) * (ZONES.plaza.r + 2.2), .8, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
const parkCanvas = document.createElement('canvas'); parkCanvas.width = parkCanvas.height = 2048;
paintPark(parkCanvas.getContext('2d'));
const pathCanvas = document.createElement('canvas'); pathCanvas.width = pathCanvas.height = 2048;
paintParkPaths(pathCanvas.getContext('2d'));
const parkGround = new THREE.Mesh(new THREE.PlaneGeometry(PARK_SIZE, PARK_SIZE), groundMaterial({ map: withTexture(parkCanvas), roughness: 1 }));
parkGround.rotation.x = -Math.PI / 2; parkGround.position.set(PARK_C[0], .005, PARK_C[1]); parkGround.receiveShadow = true; scene.add(parkGround);
const pathMat = paveMaterial({ map: withTexture(pathCanvas), roughness: .95, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
const parkPaths = new THREE.Mesh(new THREE.PlaneGeometry(PARK_SIZE, PARK_SIZE), pathMat);
parkPaths.rotation.x = -Math.PI / 2; parkPaths.position.set(PARK_C[0], .008, PARK_C[1]); parkPaths.receiveShadow = true; parkPaths.renderOrder = 1; scene.add(parkPaths);

const stone = new THREE.MeshStandardMaterial({ color: 0xcfc6b2, roughness: .9 });
const woodMat = new THREE.MeshStandardMaterial({ color: 0x9a6b3f, roughness: .8 });
const metalMat = new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: .5, metalness: .4 });
const box = (w, h, d, mat, x, y, z, parent = scene) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; parent.add(m); return m; };
const place = (g, u, v, y = 0) => { const [x, z] = inPark(u, v); g.position.set(x, y, z); scene.add(g); return g; };

// the fountain in the plaza and the pond, with their fish, ducks and lily pads, are in src/scene/water.js
const [fountainX, fountainZ] = inPark(0, 0), [pondX, pondZ] = inPark(ZONES.pond.u, ZONES.pond.v);
const fountainModel = buildFountain({ x: fountainX, z: fountainZ, radius: 4.5 }); scene.add(fountainModel.group);
const pondModel = buildPond({ x: pondX, z: pondZ, rx: ZONES.pond.rx, rz: ZONES.pond.rz }); scene.add(pondModel.group);
// The flower beds round the plaza, standing up from the painted rings: low leaves, stems and small flowers in the colour of each bed.
{
  const BEDS = 16, PER = 24, total = BEDS * PER;
  const heads = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.075, 0), new THREE.MeshStandardMaterial({ roughness: .7, flatShading: true }), total);
  const leaves = new THREE.InstancedMesh(new THREE.ConeGeometry(.09, .42, 5).translate(0, .21, 0), new THREE.MeshStandardMaterial({ color: '#4f8a42', roughness: .9, flatShading: true }), total);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
  for (let bed = 0; bed < BEDS; bed += 1) {
    const a = (bed / BEDS) * Math.PI * 2, [cx, cz] = inPark(Math.cos(a) * (ZONES.plaza.r + 2.2), Math.sin(a) * (ZONES.plaza.r + 2.2));
    const base = ['#e85d75', '#f2b134', '#b46bd6', '#f6f1e3'][bed % 4];
    for (let k = 0; k < PER; k += 1) {
      const i = bed * PER + k, r = Math.sqrt(rand()) * .95, t = rand() * Math.PI * 2, x = cx + Math.cos(t) * r, z = cz + Math.sin(t) * r, h = .22 + rand() * .3;
      e.set((rand() - .5) * .3, rand() * 6, (rand() - .5) * .3); q.setFromEuler(e);
      m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(1, h / .42, 1)); leaves.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(x, h + .04, z), q, new THREE.Vector3(1, .8, 1)); heads.setMatrixAt(i, m);
      heads.setColorAt(i, col.set(base).offsetHSL((rand() - .5) * .04, 0, (rand() - .5) * .1));
    }
  }
  leaves.castShadow = false; scene.add(heads, leaves);
}
// basketball court: two hoops
for (const s of [-1, 1]) {
  const hoop = new THREE.Group();
  box(.12, 3.2, .12, metalMat, 0, 1.6, 0, hoop); box(.1, .9, 1.4, new THREE.MeshStandardMaterial({ color: 0xf2f2ee }), s * -.2, 3.2, 0, hoop);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.23, .02, 6, 14), new THREE.MeshStandardMaterial({ color: 0xe0612b })); ring.rotation.x = Math.PI / 2; ring.position.set(s * -.55, 2.95, 0); hoop.add(ring);
  hoop.rotation.y = s > 0 ? 0 : Math.PI; place(hoop, ZONES.court.u + s * (ZONES.court.hx - .2), ZONES.court.v);
}
// playground: a swing set and a slide (playground.js), with children who use them (playground-life.js)
const playLife = createPlayLife({ rnd: rand });
const swingSet = buildSwingSet(), slideModel = buildSlide();
place(swingSet.group, ZONES.play.u + SWING_AT.u, ZONES.play.v + SWING_AT.v);
place(slideModel, ZONES.play.u + SLIDE_AT.u, ZONES.play.v + SLIDE_AT.v);
// kiosk with an awning, and umbrella tables
{
  const k = new THREE.Group();
  box(7, 3, 5.6, new THREE.MeshStandardMaterial({ color: 0xe9e2d2 }), 0, 1.5, 0, k);
  box(7.6, .2, 2.2, new THREE.MeshStandardMaterial({ color: 0xd44b3a }), 0, 3.1, 3.3, k).rotation.x = .25;
  box(5, 1.1, .1, new THREE.MeshStandardMaterial({ color: 0x2c3138 }), 0, 1.7, 2.82, k); box(5.4, .12, .8, woodMat, 0, 1.05, 3.1, k);
  place(k, ZONES.kiosk.u, ZONES.kiosk.v);
  [[-4, 7.5], [1, 8.5], [6, 7]].forEach(([u, v], i) => {
    const t = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, 2.2, 6), metalMat); pole.position.y = 1.1;
    const top = new THREE.Mesh(new THREE.ConeGeometry(1.5, .5, 10), new THREE.MeshStandardMaterial({ color: [0xd44b3a, 0x2f7fd6, 0xf0b429][i] })); top.position.y = 2.3; top.castShadow = true;
    const tbl = new THREE.Mesh(new THREE.CylinderGeometry(.6, .6, .06, 12), woodMat); tbl.position.y = .75;
    t.add(pole, top, tbl); for (const a of [0, 2.1, 4.2]) box(.4, .08, .4, woodMat, Math.cos(a) * 1.0, .45, Math.sin(a) * 1.0, t);
    place(t, ZONES.kiosk.u + u - 3, ZONES.kiosk.v + v - 2);
  });
}
// benches and bins, instanced. seats[] lists where a person can sit.
const seats = [];
{
  const benchParts = [];
  const part = (w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); benchParts.push(g); };
  part(.55, .08, 1.7, 0, .46, 0); part(.08, .55, 1.7, -.27, .78, 0); part(.5, .46, .08, 0, .23, .7); part(.5, .46, .08, 0, .23, -.7);
  const spots = [];
  for (const side of [0, 1, 2, 3]) for (const t of [-24, -8, 8, 24]) {
    const a = side * Math.PI / 2, out = RING + 3.4; // outside the ring, facing the path
    spots.push([Math.cos(a) * out - Math.sin(a) * t, Math.sin(a) * out + Math.cos(a) * t, a + Math.PI]);
  }
  for (let i = 0; i < 6; i += 1) { const a = i / 6 * Math.PI * 2 + .5, r = ZONES.plaza.r + 3.6; spots.push([Math.cos(a) * r, Math.sin(a) * r, a + Math.PI]); }
  const benchMesh = new THREE.InstancedMesh(mergeGeometries(benchParts), woodMat, spots.length);
  const q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1), p3 = new THREE.Vector3(), m4 = new THREE.Matrix4();
  spots.forEach(([u, v, facing], i) => {
    const [x, z] = inPark(u, v); e.set(0, -facing, 0); q.setFromEuler(e); m4.compose(p3.set(x, 0, z), q, one); benchMesh.setMatrixAt(i, m4);
    seats.push({ x, z, facing });
  });
  benchMesh.castShadow = true; scene.add(benchMesh);
  spots.filter((_, i) => i % 3 === 0).forEach(([u, v, facing]) => {
    const bin = new THREE.Mesh(new THREE.CylinderGeometry(.28, .24, .8, 10), new THREE.MeshStandardMaterial({ color: 0x2f6a4a, roughness: .7 }));
    place(bin, u + Math.sin(facing) * 1.3, v - Math.cos(facing) * 1.3, .4).castShadow = true;
  });
}
// picnic blankets on the lawn
const blankets = [[-38, 6, 0xd44b3a], [40, -8, 0x2f7fd6], [8, 42, 0xf0b429]].map(([u, v, c]) => {
  const b = new THREE.Mesh(new THREE.PlaneGeometry(3, 2.4), new THREE.MeshStandardMaterial({ color: c, roughness: 1 })); b.rotation.x = -Math.PI / 2;
  const [x, z] = inPark(u, v); b.position.set(x, .02, z); b.rotation.z = u * .1; b.receiveShadow = true; scene.add(b); return [u, v, c];
});

// trees and lamps for the whole city, instanced. Trees sway in the wind.
const treeSpots = [], lampSpots = [];
const ROW_END = DRAWN_STREETS * STEP + 40; // street trees and lamps along the main roads stop with the last block
const CAMERA_CLEAR = 12; // no street tree within this many metres along the road of a camera pole on its side, so a crown never hides the kerb lane from the lens
const mouthNear = (along) => { const r = ((along % STEP) + STEP) % STEP; return Math.min(r, STEP - r) < HALF_STREET + 3; }; // keep clear of side street mouths
for (let k = 0; k < 4; k += 1) for (const side of [-1, 1]) {
  for (let y = 18; y < ROW_END; y += 16) {
    if (mouthNear(y) || (side > 0 && CAMERA_STATIONS.some((c) => Math.abs(y - (c - YS)) < CAMERA_CLEAR))) continue;
    const [x, z] = rot(k, side * (H + .9), -(y + ((k + y) % 3)));
    treeSpots.push([x, z, 0.85 + (y % 5) * .06, ['oak', 'poplar', 'jacaranda', 'oak', 'gum', 'blossom', 'jacaranda', 'poplar'][Math.floor(y / 16 + k * 3 + (side > 0 ? 1 : 0)) % 8]]);
  }
  for (let y = 24; y < ROW_END; y += 32) {
    if (mouthNear(y)) continue;
    const [x, z] = rot(k, side * (EDGE_OF_ROAD - .15), -y); lampSpots.push([x, z, k, side]);
  }
}
for (let i = 0, tries = 0; i < 90 && tries < 2000; tries += 1) { // park trees stay off the paths, the pond, the court and the playground
  const u = (rand() - .5) * (PARK_SIZE - 6), v = (rand() - .5) * (PARK_SIZE - 6);
  // A crown is about 3 m across, so a trunk keeps that far from every path, the pond bank, the court and the sand, and 7 m from the next tree
  const edge = Math.max(Math.abs(u), Math.abs(v)) > PARK_SIZE / 2 - 5.5, nearPath = Math.abs(u) < PATH_W + 3.2 || Math.abs(v) < PATH_W + 3.2 || (Math.max(Math.abs(u), Math.abs(v)) > RING - PATH_W - 3.2 && Math.max(Math.abs(u), Math.abs(v)) < RING + PATH_W + 3.2);
  if (edge || nearPath || busy(u, v, 4.8) || Math.hypot(u, v) < ZONES.plaza.r + 8 || treeSpots.some((t) => Math.hypot(t[0] - PARK_C[0] - u, t[1] - PARK_C[1] - v) < 7 && t[3] !== 'poplar')) continue; const [x, z] = inPark(u, v);
  const roll = rand(), kind = roll < .3 ? 'oak' : roll < .46 ? 'gum' : roll < .58 ? 'pine' : roll < .7 ? 'jacaranda' : roll < .82 ? 'blossom' : roll < .9 ? 'palm' : 'poplar';
  treeSpots.push([x, z, (kind === 'blossom' ? .8 : .9) + rand() * .6, kind]); i += 1;
}
for (const a of [2.5, 3.5, 4.4]) { // weeping willows on the west bank of the pond, away from the jetty
  const [x, z] = inPark(ZONES.pond.u + Math.cos(a) * (ZONES.pond.rx + 3.4), ZONES.pond.v + Math.sin(a) * (ZONES.pond.rz + 3.4));
  treeSpots.push([x, z, 1.0 + rand() * .3, 'willow']);
}
// The park lamps stand on the outer edge of the ring path (its edge is RING + PATH_W / 2 out, and the pole is 1.6 m beyond that), not in the middle of it, and their arms reach in over the path.
const LAMP_OUT = RING + PATH_W / 2 + 1.6;
for (const [u, v] of [[-16, -LAMP_OUT], [16, -LAMP_OUT], [-16, LAMP_OUT], [16, LAMP_OUT], [-LAMP_OUT, -16], [-LAMP_OUT, 16], [LAMP_OUT, -16], [LAMP_OUT, 16]]) { const [x, z] = inPark(u, v); lampSpots.push([x, z, 0, 0]); }
// A few lamps along each side street: one at its mouth, where it leaves the main road, and two further along. A lamp stands on the footpath beside the street and its arm reaches in over the road. They have no
// glow pool of their own: the street asphalt has a steady night light (STREET_NIGHT), so the lamps are the source of it that a visitor can see, with their bloom.
const STREET_LAMP_AT = [10, 70, 130], STREET_LAMP_OFF = STREET_W / 2 + 1.2;
for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (let m = 1; m <= STREETS; m += 1) for (const alongX of [false, true]) STREET_LAMP_AT.forEach((d, i) => {
  const side = (i + m) % 2 ? 1 : -1, out = EDGE_OF_ROAD + d; // which side of the street this one stands on, and how far out from the junction
  if (alongX) lampSpots.push([sx * out, sz * m * STEP + side * STREET_LAMP_OFF, 0, 0, [0, -side]]);
  else lampSpots.push([sx * m * STEP + side * STREET_LAMP_OFF, sz * out, 0, 0, [-side, 0]]);
});
const matrix = new THREE.Matrix4(), quat = new THREE.Quaternion(), eulerRot = new THREE.Euler(), scl = new THREE.Vector3(), at = new THREE.Vector3();
// Trees near the junction are smaller, so that their crowns do not hide the road from the angled view: half the size at 20 m from the middle, growing to full size at 70 m. (Size scales the height and the crown together.)
for (const spot of treeSpots) { const d = Math.hypot(spot[0], spot[1]); if (d < 70) spot[2] *= .5 + .5 * Math.max(0, d - 20) / 50; }
// The courtyards inside the blocks (see fillBlock): each is a small pocket park, built from the same pieces whatever its size. A paved square with a path across it each way, four lawns between the paths with a tree
// in the middle of each and a scatter of flowers, a round fountain (or, in a small one, a planter) where the paths cross, four benches round it facing in, a lamp at the end of each path, and some tables with umbrellas
// in one corner. Everything is collected by material and merged, so all the courtyards are a handful of draw calls. Far ones (past DETAIL_RADIUS) have only the pavement, the lawns and the trees.
const yardParts = new Map(), lawnMats = [];
const lawnMat = new THREE.MeshStandardMaterial({ color: 0x6aa84f, roughness: .95 }), waterMat = new THREE.MeshStandardMaterial({ color: 0x4f9fc9, roughness: .15, metalness: .1 }), stoneMat = new THREE.MeshStandardMaterial({ color: 0xb9b3a6, roughness: .8 });
lawnMats.push(lawnMat);
const flowerMats = [0xe0475b, 0xf0b429, 0xf5f2ea, 0xb06ad4].map((color) => new THREE.MeshStandardMaterial({ color, roughness: .7 })), umbrellaMats = [0xd2513d, 0x3d6fb5, 0xe8b53a].map((color) => new THREE.MeshStandardMaterial({ color, roughness: .6 }));
const yardAdd = (mat, geometry, x, y, z) => { geometry.translate(x, y, z); if (!yardParts.has(mat)) yardParts.set(mat, []); yardParts.get(mat).push(geometry); };
const yardBox = (mat, w, h, d, x, y, z) => yardAdd(mat, new THREE.BoxGeometry(w, h, d), x, y, z);
const yardRound = (mat, rt, rb, h, x, y, z, seg = 16) => yardAdd(mat, new THREE.CylinderGeometry(rt, rb, h, seg), x, y, z);
function yardBench(x, z, alongX, side) { // a bench 1.7 m long, its back on the side `side` (+1 or -1, along the short axis)
  const [lx, lz] = alongX ? [1.7, .46] : [.46, 1.7], back = alongX ? [1.7, .5, .06] : [.06, .5, 1.7], off = alongX ? [0, side * .22] : [side * .22, 0];
  yardBox(woodMat, lx, .07, lz, x, .46, z); yardBox(woodMat, back[0], back[1], back[2], x + off[0], .74, z + off[1]);
  for (const s of [-1, 1]) yardBox(metalMat, alongX ? .07 : .42, .46, alongX ? .42 : .07, x + (alongX ? s * .7 : 0), .23, z + (alongX ? 0 : s * .7));
}
const yardPeople = []; // the courtyards that have furniture, for the people who use them (see courtyard-life.js)
for (const [a0, a1, b0, b1] of courtyards) {
  const x = (a0 + a1) / 2, z = (b0 + b1) / 2, w = a1 - a0, d = b1 - b0, near = Math.hypot(x, z) < DETAIL_RADIUS, seedKey = Math.round(x * 3 + z * 7);
  yardBox(kerbMat, w, .08, d, x, .04, z); // the pavement, the same as the footpath's
  const P = 3, lw = w / 2 - 1.2 - P / 2, ld = d / 2 - 1.2 - P / 2;
  const cafeX = hash2(Math.round(x), Math.round(z), 61) < .5 ? -1 : 1, cafeZ = hash2(Math.round(x), Math.round(z), 62) < .5 ? -1 : 1; // the quarter that is a cafe (near courtyards only): paved, with tables, and no lawn
  if (near) yardPeople.push({ x, z, w, d, cafeX, cafeZ });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const lx = x + sx * (P / 2 + lw / 2), lz = z + sz * (P / 2 + ld / 2);
    if (near && sx === cafeX && sz === cafeZ && hasCafe(w, d)) {
      cafeTables(x, z, w, d, cafeX, cafeZ).tables.forEach((t, k) => { // three tables with umbrellas, each with two stools, in a row across the quarter
        const umbrella = umbrellaMats[Math.abs(k + seedKey) % 3];
        yardRound(metalMat, .04, .04, 2.3, t.x, 1.15, t.z, 6); yardRound(woodMat, .55, .55, .06, t.x, .74, t.z, 14); yardAdd(umbrella, new THREE.ConeGeometry(1.25, .45, 12), t.x, 2.45, t.z);
        for (const s of [-1, 1]) yardRound(woodMat, .2, .2, .05, t.x, .45, t.z + s * .85, 8);
      });
      continue;
    }
    yardBox(lawnMat, lw, .06, ld, lx, .11, lz); // the lawn, standing a little above the paving
    treeSpots.push([lx, lz, .8 + hash2(Math.round(lx), Math.round(lz), 42) * .25, ['oak', 'blossom', 'jacaranda', 'gum'][Math.abs(Math.round(lx * 3 + lz * 7)) % 4]]);
    if (near) for (let k = 0; k < 14; k += 1) { // flowers on the lawn
      const fx = lx + (hash2(k, seedKey + sx, 51) - .5) * (lw - 1), fz = lz + (hash2(k, seedKey + sz, 52) - .5) * (ld - 1);
      yardAdd(flowerMats[Math.floor(hash2(k, seedKey, 53) * 4)], new THREE.IcosahedronGeometry(.1 + .05 * hash2(k, seedKey, 54), 0), fx, .2, fz);
    }
  }
  if (!near) continue;
  const big = Math.min(w, d) >= 18, r = big ? 2.2 : 1.4; // a fountain in a big courtyard, a planter in a small one
  yardRound(stoneMat, r, r, .5, x, .33, z, 28); yardRound(big ? waterMat : lawnMat, r - .25, r - .25, .08, x, .55, z, 28);
  if (big) { yardRound(stoneMat, .25, .35, 1.0, x, .85, z, 12); yardRound(waterMat, .9, .9, .05, x, 1.2, z, 16); } else for (let k = 0; k < 6; k += 1) yardAdd(flowerMats[k % 4], new THREE.IcosahedronGeometry(.18, 0), x + Math.cos(k * 1.05) * .7, .75, z + Math.sin(k * 1.05) * .7);
  for (const s of [-1, 1]) { yardBench(x, z + s * (r + 1.4), true, s); yardBench(x + s * (r + 1.4), z, false, s); } // four benches round it, facing in
  for (const [lx, lz] of [[x + w / 2 - .8, z + 1.9], [x - w / 2 + .8, z - 1.9], [x + 1.9, z + d / 2 - .8], [x - 1.9, z - d / 2 + .8]]) { // a lamp at the end of each path
    yardRound(metalMat, .06, .08, 4.2, lx, 2.1, lz, 8); yardBox(metalMat, .5, .1, .12, lx, 4.2, lz); yardAdd(lampFront, new THREE.SphereGeometry(.2, 10, 8), lx, 4.05, lz);
  }
}
for (const [mat, list] of yardParts) { const mesh = new THREE.Mesh(mergeGeometries(list, false), mat); mesh.castShadow = mat !== lawnMat && mat !== kerbMat && !flowerMats.includes(mat); mesh.receiveShadow = true; scene.add(mesh); }
const treeSet = buildTrees(treeSpots, rand); // eight kinds, from src/scene/trees.js
scene.add(treeSet.group);
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches ? .25 : 1; // a visitor who asked the system for less motion gets slower trees and clouds
const swayTrees = (time) => treeSet.update(time * calm);

// A street lamp is a pole, a short arm reaching over the road or the path, and a flat luminaire under the end of it.
const lampPoleMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(.09, .14, 8, 8), new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: .6, metalness: .3 }), lampSpots.length);
const armParts = [new THREE.CylinderGeometry(.06, .06, 2.3, 8).rotateZ(Math.PI / 2).translate(1.15, 7.95, 0), new THREE.BoxGeometry(1.0, .13, .38).translate(2.25, 7.85, 0), new THREE.CylinderGeometry(.11, .11, .3, 8).translate(0, 7.95, 0)];
const lampArmMesh = new THREE.InstancedMesh(mergeGeometries(armParts), new THREE.MeshStandardMaterial({ color: 0x3c4148, roughness: .55, metalness: .35 }), lampSpots.length);
const lampMat = new THREE.MeshStandardMaterial({ color: 0xf4f8ff, emissive: 0xe8f0ff, emissiveIntensity: 0, roughness: .4 });
const lampLensMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(.8, .03, .3).translate(2.25, 7.77, 0), lampMat, lampSpots.length);
// At night each lamp throws a warm pool on the ground and a soft bloom around the lens. Both are additive and flat, so a hundred of them cost almost nothing.
const falloff = roundFade(128, [[0, 1], [.35, .35], [1, 0]]); // bright in the middle, fading to nothing at the edge (see textures.js)
const glowMat = (opacity) => new THREE.MeshBasicMaterial({ color: 0xffd98a, map: falloff, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 });
const lampBloomMat = glowMat(0); lampBloomMat.color.set(0xf2f6ff); // white LED, like the light on the road
// Street lighting is an even wash along the whole road, as in life. Each lamp lights a strip 48 m long, with the same strength for 16 m in the middle and a straight fade to nothing at each end,
// and lamps stand 32 m apart, so at every point the two nearest add up to exactly one. Across the road the strength is full from the kerb to 9 m out and eases off toward the middle, where
// the lamps on the other side add theirs. The junction has no lamp of its own, so it gets a square of light of the same strength, and the lamps in the park keep a round pool.
const WASH = [1, 1, 1], POOL = .24; // the strength of the wash, which sets how bright the road is (the street lights are white LEDs)
// The road glow is not drawn on any pixel the pavement covers: the pavement marks its pixels in the stencil, and the glow skips them. This does not depend on how a graphics card resolves depth (the footpath is
// only 10 cm above the 6 cm glow, and a card with a shallow depth buffer cannot always tell them apart at a distance, so the glow flickered through the pavement as bands that changed as the view moved).
// The glow strips and the junction square are the original ones, so the road is lit exactly as it was.
const glowWith = (map) => { const m = glowMat(0); m.map = map; m.color.setRGB(WASH[0], WASH[1], WASH[2]); m.stencilWrite = true; m.stencilRef = 1; m.stencilFunc = THREE.NotEqualStencilFunc; m.stencilZPass = THREE.KeepStencilOp; return m; }; // the colour of the street light on the road; it is set so the road keeps its day hue
// The glow strip is the original, except that it has nothing past the outer edge of the footpath (x = -0.15 from the lamp line; the cut is at -0.1, 5 cm under the slab, so no strip of lit ground is left beside it): there it only lit the ground between the blocks, which is not road. The texture is fine
// (about 4 cm to the pixel) so that this cut is sharp. On the road and under the footpath it is exactly as it was.
const stripTexture = lightTexture(512, 256, (u, v) => {
  const x = -4 + 22 * u, along = Math.abs(v - .5) * 48;
  const across = x < -.1 ? 0 : x < 1.5 ? Math.max(0, (x + 4) / 5.5) : x < 9 ? 1 : Math.max(0, (18 - x) / 9);
  return POOL * across * (along <= 8 ? 1 : Math.max(0, (24 - along) / 16));
}, ADDITIVE_CURVE);
// The junction fill makes up what the four road strips lose as they fade out toward the middle: a strip is z/16 of full strength at distance z from the centre, so across the junction the arms
// add (|x| + |z|) / 16 and the fill adds the rest, one minus that, which makes a diamond. Together they give an even level all the way across.
const JUNCTION = 2 * (H + 5);
const squareTexture = lightTexture(96, 96, (u, v) => POOL * Math.max(0, 1 - (Math.abs(u - .5) + Math.abs(v - .5)) * JUNCTION / 16), ADDITIVE_CURVE);
const parkTexture = roundFade(128, [[0, POOL], [.35, POOL * .35], [1, 0]], ADDITIVE_CURVE);
const lampPoolMat = glowWith(stripTexture), junctionPoolMat = glowWith(squareTexture), parkPoolMat = glowWith(parkTexture);
const parkSpots = lampSpots.filter((l) => !l[3] && !l[4]);
// The wash is laid out on its own and not at the poles. Poles are left out where a side street joins the road, and a pool that went with its pole left a dark gap in the light there.
const streetSpots = [];
for (let k = 0; k < 4; k += 1) for (const side of [-1, 1]) for (let y = 24; y < 420; y += 32) { const [x, z] = rot(k, side * (EDGE_OF_ROAD - .15), -y); streetSpots.push([x, z, k, side]); }
const lampPoolMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(22, 48).rotateX(-Math.PI / 2).translate(7, .06, 0), lampPoolMat, streetSpots.length);
const parkPoolMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(22, 40).rotateX(-Math.PI / 2).translate(7, .06, 0), parkPoolMat, Math.max(1, parkSpots.length));
parkPoolMesh.count = parkSpots.length;
const junctionPool = new THREE.Mesh(new THREE.PlaneGeometry(JUNCTION, JUNCTION).rotateX(-Math.PI / 2).translate(0, .06, 0), junctionPoolMat); junctionPool.renderOrder = 2;
const lampPoolMats = [lampPoolMat, junctionPoolMat, parkPoolMat];
const lampBloomMesh = new THREE.InstancedMesh(mergeGeometries([new THREE.PlaneGeometry(3, 3), new THREE.PlaneGeometry(3, 3).rotateY(Math.PI / 2), new THREE.PlaneGeometry(3, 3).rotateY(Math.PI / 4), new THREE.PlaneGeometry(3, 3).rotateY(-Math.PI / 4)]).translate(2.25, 7.7, 0), lampBloomMat, lampSpots.length);
lampPoolMesh.renderOrder = parkPoolMesh.renderOrder = lampBloomMesh.renderOrder = 2;
let parkAt = 0;
lampSpots.forEach(([x, z, k, side, toward], i) => {
  const [dx, dz] = toward || (side ? rot(k, -side, 0) : [PARK_C[0] - x, PARK_C[1] - z]); // toward the road (or the side street the lamp stands beside), or toward the middle of the park
  eulerRot.set(0, -Math.atan2(dz, dx), 0); quat.setFromEuler(eulerRot);
  matrix.compose(at.set(x, 4, z), new THREE.Quaternion(), scl.set(1, 1, 1)); lampPoleMesh.setMatrixAt(i, matrix);
  matrix.compose(at.set(x, 0, z), quat, scl.set(1, 1, 1)); lampArmMesh.setMatrixAt(i, matrix); lampLensMesh.setMatrixAt(i, matrix); lampBloomMesh.setMatrixAt(i, matrix);
  matrix.compose(at.set(x, 0, z), quat, side ? scl.set(1, 1, 1) : scl.set(.45, 1, .45));
  if (!side && !toward) parkPoolMesh.setMatrixAt(parkAt++, matrix); // a park lamp has a smaller, round pool
});
streetSpots.forEach(([x, z, k, side], i) => { // the strips, turned toward the road, one every 32 m on each side
  const [dx, dz] = rot(k, -side, 0); eulerRot.set(0, -Math.atan2(dz, dx), 0); quat.setFromEuler(eulerRot);
  matrix.compose(at.set(x, 0, z), quat, scl.set(1, 1, 1)); lampPoolMesh.setMatrixAt(i, matrix);
});
lampPoleMesh.castShadow = lampArmMesh.castShadow = true; scene.add(lampPoleMesh, lampArmMesh, lampLensMesh, lampPoolMesh, parkPoolMesh, junctionPool, lampBloomMesh);
const lampLights = [{ material: lampMat }];

// ---------- signal heads, pedestrian signals and buttons ----------
// A head is a housing with a backplate and a visor over each lens. A lit lens is drawn flat and unshaded, so its colour stays
// true in any light, and an unlit one is a dark version of the same colour.
const housingMat = new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: .55, side: THREE.DoubleSide });
const poleMat = new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: .6, metalness: .3 });
const whiteMat = new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: .6 });
const LAMP = { red: '#ff2b2b', yellow: '#ffb300', green: '#18e36a', manRed: '#ff3a2e', manGreen: '#3dffc4' };
const lensTextures = new Map();
// A lens made of LED dots: a round field, or an arrow made of dots on a dark ground, as on the heads in the photo reference.
function dotTexture(kind, color) {
  const size = 256, c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  const mask = document.createElement('canvas'); mask.width = mask.height = size; const m = mask.getContext('2d');
  m.fillStyle = '#fff'; m.strokeStyle = '#fff'; m.lineCap = 'butt'; m.lineJoin = 'miter';
  if (kind === 'dotDisc') { m.beginPath(); m.arc(128, 128, 118, 0, Math.PI * 2); m.fill(); }
  else {
    m.save(); m.translate(128, 128);
    if (kind === 'dotUp') m.rotate(-Math.PI / 2); else if (kind === 'dotLeft') m.rotate(Math.PI);
    m.lineWidth = 34; m.beginPath(); m.moveTo(-90, 0); m.lineTo(80, 0); m.stroke(); // the shaft, then a chevron head
    m.lineWidth = 34; m.beginPath(); m.moveTo(0, -78); m.lineTo(88, 0); m.lineTo(0, 78); m.stroke();
    m.restore();
  }
  const data = m.getImageData(0, 0, size, size).data;
  g.fillStyle = '#060707'; g.beginPath(); g.arc(128, 128, 124, 0, Math.PI * 2); g.fill();
  g.fillStyle = color;
  const step = 8;
  for (let y = 6, row = 0; y < size; y += step * 0.866, row += 1) for (let x = 6 + (row % 2) * step / 2; x < size; x += step) {
    if (data[((Math.round(y) * size) + Math.round(x)) * 4] > 128) { g.beginPath(); g.arc(x, y, 3.1, 0, Math.PI * 2); g.fill(); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function lensTexture(kind, color) {
  const key = `${kind}${color}`; if (lensTextures.has(key)) return lensTextures.get(key);
  if (kind.startsWith('dot')) { const t = dotTexture(kind, color); lensTextures.set(key, t); return t; }
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#050505'; g.fillRect(0, 0, 128, 128); g.fillStyle = color; g.strokeStyle = color;
  if (kind === 'disc') { // an LED lens: a round field of small points
    g.fillStyle = '#080808'; g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill(); g.fillStyle = color;
    for (let y = 10, row = 0; y < 120; y += 8.5, row += 1) for (let x = 10 + (row % 2) * 4.25; x < 120; x += 8.5) if ((x - 64) ** 2 + (y - 64) ** 2 < 54 ** 2) { g.beginPath(); g.arc(x, y, 3.3, 0, Math.PI * 2); g.fill(); }
  } else if (kind === 'arrow' || kind === 'arrowL') { // a right or a left arrow on an LED lens
    g.fillStyle = '#080808'; g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill(); g.fillStyle = color;
    if (kind === 'arrowL') g.translate(128, 0), g.scale(-1, 1);
    g.fillRect(22, 56, 54, 16); g.beginPath(); g.moveTo(68, 30); g.lineTo(108, 64); g.lineTo(68, 98); g.closePath(); g.fill();
  } else { // a pedestrian lens: a dark lens with the figure lit, standing for stop and walking for go
    g.fillStyle = '#050707'; g.fillRect(0, 0, 128, 128); g.fillStyle = color; g.strokeStyle = color; g.lineWidth = 13; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.arc(64, 26, 12, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(64, 44); g.lineTo(64, 80); g.stroke();
    if (kind === 'stand') { g.beginPath(); g.moveTo(40, 62); g.lineTo(64, 48); g.lineTo(88, 62); g.stroke(); g.beginPath(); g.moveTo(64, 80); g.lineTo(52, 114); g.moveTo(64, 80); g.lineTo(76, 114); g.stroke(); }
    else { g.beginPath(); g.moveTo(40, 72); g.lineTo(54, 52); g.lineTo(64, 46); g.lineTo(90, 66); g.stroke(); g.beginPath(); g.moveTo(64, 80); g.lineTo(40, 114); g.moveTo(64, 80); g.lineTo(90, 112); g.stroke(); }
  }
  const t = new THREE.CanvasTexture(g.canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; lensTextures.set(key, t); return t;
}
function makeLamp(kind, color, radius, squareH) {
  const geo = squareH ? new THREE.PlaneGeometry(radius * 2, squareH) : new THREE.CircleGeometry(radius, 28);
  const lens = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: lensTexture(kind, color), toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })); // drawn in front of the housing face it sits on
  const halo = new THREE.Mesh(squareH ? new THREE.PlaneGeometry(radius * 3, squareH * 1.5) : new THREE.CircleGeometry(radius * 1.12, 28),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: .4, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
  halo.position.z = .006; halo.visible = false; lens.add(halo); lens.material.color.setScalar(.12);
  return { lens, halo };
}
function setLamp(l, on) {
  l.lens.material.color.setScalar(on ? 1 : .12); l.halo.visible = on; l.halo.material.opacity = .05 + .3 * night; // a faint bloom by day, a little more at night
}
// the visor over a lens: half a tube, open at the front, so the lens is shaded from the sun and easy to read
const visorGeo = new THREE.CylinderGeometry(.28, .28, .5, 18, 1, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2); // a deep tunnel visor
const rimMat = new THREE.MeshStandardMaterial({ color: 0x3a3e45, roughness: .35, metalness: .5 }), seamMat = new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: .9 });
function makeSignalHead(arrow, scale = arrow ? .8 : 1, left = false) {
  const g = new THREE.Group(), R = .21, pitch = .56;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(.9, 2.04, .03), whiteMat), plate = new THREE.Mesh(new THREE.BoxGeometry(.84, 1.98, .06), housingMat), body = new THREE.Mesh(new THREE.BoxGeometry(.62, 1.8, .34), housingMat);
  frame.position.z = -.2; plate.position.z = -.17; g.add(frame, plate, body);
  const kind = arrow ? (left ? 'arrowL' : 'arrow') : 'disc', lamps = [LAMP.red, LAMP.yellow, LAMP.green].map((color, i) => {
    const lamp = makeLamp(kind, color, R); lamp.lens.position.set(0, (1 - i) * pitch, .172); g.add(lamp.lens);
    const visor = new THREE.Mesh(visorGeo, housingMat); visor.position.set(0, (1 - i) * pitch, .38); g.add(visor);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R + .015, .018, 6, 28), rimMat); rim.position.set(0, (1 - i) * pitch, .176); g.add(rim); // the lens ring
    const seam = new THREE.Mesh(new THREE.BoxGeometry(.64, .018, .36), seamMat); seam.position.set(0, (1 - i) * pitch + pitch / 2, 0); g.add(seam); // the join between two housings
    return lamp;
  });
  // the clamps that hold the head to its bracket, top and bottom, and a hanging drain hole and cable gland underneath
  for (const y of [.78, -.78]) { const clamp = new THREE.Mesh(new THREE.BoxGeometry(.2, .16, .1), poleMat); clamp.position.set(0, y, -.26); g.add(clamp); const bolt = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, .12, 8).rotateX(Math.PI / 2), rimMat); bolt.position.set(0, y, -.3); g.add(bolt); }
  const gland = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, .12, 8), poleMat); gland.position.set(0, -.97, 0); g.add(gland);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(.58, .05, .3), housingMat); cap.position.set(0, .93, 0); g.add(cap); // a lid on the top
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.scale.setScalar(scale);
  return { group: g, lamps };
}
// A horizontal head for the lanes of one approach: red, yellow and green discs, a left and a right arrow, and a countdown. An arrow has a
// green lens and an amber lens in the same place, and shows the one that matches the signal, or neither when it is red. It looks the
// way the driver sees it, with the left arrow on the left.
function makeCountdown() {
  const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 64;
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const state = { last: null };
  const draw = (text) => {
    if (state.last === text) return;
    state.last = text;
    const g = canvas.getContext('2d'); g.fillStyle = '#0b0b0b'; g.fillRect(0, 0, 128, 64);
    g.fillStyle = text === '--' ? '#7a1d16' : '#ff3b2a'; g.font = 'bold 52px "Courier New", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, 36);
    texture.needsUpdate = true;
  };
  draw('--');
  return { texture, draw };
}
// The head in the photo reference: a column with a red lens over an amber one, and a wide row under it with a left arrow, an up arrow (the
// through green) and a right arrow. An arrow also has an amber lens in the same place, for its yellow. A countdown sits beside the column.
// The head's top is at +0.4, so hang() can hang it from a rod.
function makeTHead() {
  const g = new THREE.Group(), inner = new THREE.Group(); inner.position.y = -.8; g.add(inner);
  const RC = .2, RB = .23, px = .6, back = new THREE.MeshStandardMaterial({ color: 0x0d1411, roughness: .7 });
  const column = new THREE.Mesh(new THREE.BoxGeometry(.58, .98, .26), back); column.position.set(0, .75, 0);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(3 * px + .1, .62, .26), back); bar.position.set(0, 0, 0);
  inner.add(column, bar);
  const hood = (x, y, r) => { const v = new THREE.Mesh(new THREE.CylinderGeometry(r + .06, r + .06, .3, 20, 1, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2), housingMat); v.position.set(x, y, .22); inner.add(v); };
  const lens = (kind, color, r, x, y) => { const l = makeLamp(kind, color, r); l.lens.position.set(x, y, .15); inner.add(l.lens); hood(x, y, r); addRing(inner, x, y, .155, r); return l; };
  const red = lens('dotDisc', LAMP.red, RC, 0, 1.0), amber = lens('dotDisc', LAMP.yellow, RC, 0, .52);
  const upGreen = lens('dotUp', LAMP.green, RB, 0, 0);
  const leftGreen = lens('dotLeft', LAMP.green, RB, -px, 0), leftAmber = lens('dotLeft', LAMP.yellow, RB, -px, 0); leftAmber.lens.position.z = .152;
  const rightGreen = lens('dotRight', LAMP.green, RB, px, 0), rightAmber = lens('dotRight', LAMP.yellow, RB, px, 0); rightAmber.lens.position.z = .152;
  const timer = makeCountdown(), panel = new THREE.Mesh(new THREE.PlaneGeometry(.62, .31), new THREE.MeshBasicMaterial({ map: timer.texture, toneMapped: false }));
  panel.position.set(.9, .85, .14); inner.add(panel);
  const panelBack = new THREE.Mesh(new THREE.BoxGeometry(.7, .39, .2), back); panelBack.position.set(.9, .85, .03); inner.add(panelBack);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(.3, .09, .12), back); arm.position.set(.45, .85, .03); inner.add(arm); // joins the box to the column
  const hook = new THREE.Mesh(new THREE.BoxGeometry(.09, .3, .12), back); hook.position.set(.6, .74, .03); inner.add(hook); // and a second strut down to the bar
  addClamp(inner, 0, 1.22, -.16); addClamp(inner, 0, -.34, -.16); addGland(inner, 0, -.36, 0);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group: g, lamps: [red, amber, upGreen], left: { green: leftGreen, amber: leftAmber }, right: { green: rightGreen, amber: rightAmber }, timer };
}
// Small fittings shared by every head: a ring round a lens, a clamp with a bolt, and a hanging cable gland.
function addRing(group, x, y, z, r) { const rim = new THREE.Mesh(new THREE.TorusGeometry(r + .012, .016, 6, 28), rimMat); rim.position.set(x, y, z); group.add(rim); }
function addClamp(group, x, y, z) {
  const clamp = new THREE.Mesh(new THREE.BoxGeometry(.2, .14, .1), poleMat); clamp.position.set(x, y, z); group.add(clamp);
  const bolt = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, .12, 8).rotateX(Math.PI / 2), rimMat); bolt.position.set(x, y, z - .05); group.add(bolt);
}
function addGland(group, x, y, z) { const gland = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, .1, 8), poleMat); gland.position.set(x, y, z); group.add(gland); }
function makeHorizontalHead() {
  const g = new THREE.Group(), pitch = .5, R = .19, y = 0, z = .1, width = 5 * pitch + 1.15;
  const body = new THREE.Mesh(new THREE.BoxGeometry(width, .62, .26), housingMat), frame = new THREE.Mesh(new THREE.BoxGeometry(width + .1, .72, .03), whiteMat);
  frame.position.z = -.16; g.add(body, frame);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(width - .06, .04, .3), housingMat); lid.position.set(0, .33, 0); g.add(lid);
  const at = (i) => (i - 2) * pitch - .4;
  const place = (lamp, i) => {
    lamp.lens.position.set(at(i), y, z + .035); g.add(lamp.lens);
    const visor = new THREE.Mesh(visorGeo, housingMat); visor.scale.set(.75, .75, .6); visor.position.set(at(i), y, z + .22); g.add(visor);
    addRing(g, at(i), y, z + .04, R);
  };
  const t = [LAMP.red, LAMP.yellow, LAMP.green].map((color, i) => { const lamp = makeLamp('dotDisc', color, R); place(lamp, i + 1); return lamp; });
  const arrow = (left, i) => {
    const kind = left ? 'dotLeft' : 'dotRight', green = makeLamp(kind, LAMP.green, R), amber = makeLamp(kind, LAMP.yellow, R);
    place(green, i); amber.lens.position.set(at(i), y, z + .036); g.add(amber.lens); return { green, amber };
  };
  const left = arrow(true, 0), right = arrow(false, 4);
  const timer = makeCountdown(), panel = new THREE.Mesh(new THREE.PlaneGeometry(.78, .39), new THREE.MeshBasicMaterial({ map: timer.texture, toneMapped: false }));
  panel.position.set(width / 2 - .5, y, z + .035); g.add(panel);
  addRing(g, width / 2 - .5, y, z + .04, .0); g.children.pop(); // no ring round the panel
  for (const x of [-width / 2 + .3, 0, width / 2 - .3]) addClamp(g, x, .38, -.2);
  for (const x of [-width / 2 + .4, width / 2 - .4]) addGland(g, x, -.36, 0);
  const seam = new THREE.Mesh(new THREE.BoxGeometry(.018, .64, .3), seamMat); for (const i of [1, 2, 3, 4]) { const m = seam.clone(); m.position.set(at(i) - pitch / 2, y, 0); g.add(m); }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group: g, lamps: t, left, right, timer };
}
const pedHoodGeo = new THREE.CylinderGeometry(.33, .33, .16, 28, 1, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2); // a shallow visor over the top half of a lens
function makePedHead() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(.78, 1.5, .22), housingMat));
  const frame = new THREE.Mesh(new THREE.BoxGeometry(.86, 1.58, .03), whiteMat); frame.position.z = -.12; g.add(frame);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(.74, .04, .26), housingMat); lid.position.set(0, .77, 0); g.add(lid);
  const stop = makeLamp('stand', LAMP.manRed, .28), go = makeLamp('walk', LAMP.manGreen, .28);
  for (const [lamp, y] of [[stop, .39], [go, -.39]]) {
    lamp.lens.position.set(0, y, .14); g.add(lamp.lens);
    const hood = new THREE.Mesh(pedHoodGeo, housingMat); hood.position.set(0, y, .2); g.add(hood);
    addRing(g, 0, y, .145, .28);
  }
  addClamp(g, 0, .6, -.16); addClamp(g, 0, -.6, -.16); addGland(g, 0, -.79, 0);
  const seam = new THREE.Mesh(new THREE.BoxGeometry(.8, .016, .24), seamMat); g.add(seam);
  // the seconds left of the flashing red man, on a small display over the head, lit only while the man flashes
  const timer = makeCountdown(), readout = new THREE.Group();
  const face = new THREE.Mesh(new THREE.PlaneGeometry(.62, .31), new THREE.MeshBasicMaterial({ map: timer.texture, toneMapped: false })); face.position.set(0, 0, .12);
  const box = new THREE.Mesh(new THREE.BoxGeometry(.7, .39, .22), housingMat);
  readout.add(box, face); readout.position.set(0, 1.12, 0); readout.visible = false; g.add(readout);
  return { group: g, stop, go, timer, readout };
}
const heads = []; // vehicle heads: {approach, t: [red, yellow, green] lamps, r: the same for the right turn arrow}
const pedSignals = []; // {crossing, red, green}
const buttons = [];
function addPole(x, z, height) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.08, .12, height, 12), poleMat);
  pole.position.set(x, height / 2, z); pole.castShadow = true; scene.add(pole);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(.2, .24, .22, 12), rimMat); base.position.set(x, .11, z); base.castShadow = true; scene.add(base); // a base plate with a collar
  const cap = new THREE.Mesh(new THREE.SphereGeometry(.1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), poleMat); cap.position.set(x, height, z); scene.add(cap); // a rounded cap
  const band = new THREE.Mesh(new THREE.CylinderGeometry(.095, .095, .06, 12), rimMat); band.position.set(x, 2.2, z); scene.add(band); // a stiffening band, where a bracket would sit
  return pole;
}
const mastPoles = [0, 1, 2, 3].map((k) => rot(k, H + 2.3, YS)); // the mast pole at each corner
// A second pole at each corner, across the junction from the stop line, carries a vertical head for the first car at the line of the approach it
// faces. It is the mirror of the mast pole, on the other side of the road end, so each corner has two poles, and each takes one pedestrian head.
const farPoles = [0, 1, 2, 3].map((k) => rot(k, H + 2.3, -YS));
const poles = [...mastPoles, ...farPoles];
farPoles.forEach(([x, z], k) => {
  addPole(x, z, 6.2);
  const [dx, dz] = rot(k, 0, -1), [ox, oz] = rot(k, -.5, 0), yaw = Math.atan2(dx, dz); // faces the approaching traffic, and hangs a little toward the road
  const head = makeTHead(); head.group.scale.setScalar(.85);
  head.group.position.set(x + ox, 5.5, z + oz); head.group.rotation.y = yaw; scene.add(head.group);
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(.08, .08, .5), poleMat); bracket.position.set(x + ox / 2, 4.6, z + oz / 2); bracket.rotation.y = Math.atan2(ox, oz); scene.add(bracket);
  heads.push({ approach: k + 1, t: [head.lamps], arrows: { left: head.left, right: head.right }, timer: head.timer });
});
for (let k = 0; k < 4; k += 1) {
  const approach = k + 1;
  // A signal pole stands at the stop line on the kerb side. A mast arm reaches out over the lanes with heads hanging from it
  // above the through lane and the right turn lane, and one more head faces the traffic from the pole. All face the approach.
  const [x, z] = rot(k, H + 2.3, YS);
  addPole(x, z, 7.6);
  const mast = new THREE.Group(); mast.position.set(x, 0, z); mast.rotation.y = -k * Q; scene.add(mast); // the group's x runs across the road and z along it
  const ARM_Y = 7.3, REACH = H + 2.3 - LANE_X[2] + .6;
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(.06, .11, REACH, 10).rotateZ(Math.PI / 2), poleMat); arm.position.set(-REACH / 2, ARM_Y, 0); arm.castShadow = true; mast.add(arm);
  const brace = new THREE.Mesh(new THREE.BoxGeometry(.06, 1.85, .06), poleMat); brace.position.set(-.72, ARM_Y - .6, 0); brace.rotation.z = .86; mast.add(brace); // from the pole, 1.2 m under the arm, up to the arm 1.4 m out
  const hang = (head, localX, y) => { // hang a head from the arm, facing the oncoming traffic, which is toward negative z
    head.group.position.set(localX, y, 0); head.group.rotation.y = Math.PI; mast.add(head.group);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, ARM_Y - y - .4, 6), poleMat); rod.position.set(localX, (ARM_Y + y + .4) / 2, 0); mast.add(rod);
    return head;
  };
  const unitX = (LANE_X[1] + LANE_X[2]) / 2 - (H + 2.3) + .5; // over the boundary between the through lane and the turn lane
  const row = hang(makeHorizontalHead(), (LANE_X[1] + LANE_X[2]) / 2 - (H + 2.3) - .45, ARM_Y - 1.0);
  heads.push({ approach, t: [row.lamps], arrows: { left: row.left, right: row.right }, timer: row.timer });
  // A pedestrian signal and a push button at each end of the crossing over this leg, on the signal pole of the corner where that end is.
  // Two crossings end at every corner, so each pole carries two heads, back to back, one facing each crossing. The head faces across the road.
  for (const side of [-1, 1]) {
    const [tx, tz] = rot(k, side * 12.8, -14.5); // where this end of the crossing is
    const [px, pz] = poles.reduce((best, c) => (Math.hypot(c[0] - tx, c[1] - tz) < Math.hypot(best[0] - tx, best[1] - tz) ? c : best));
    const head = makePedHead(), [ax, az] = rot(k, -side, 0), yaw = Math.atan2(ax, az);
    head.group.position.set(px + ax * .5, 2.7, pz + az * .5); head.group.rotation.y = yaw; scene.add(head.group);
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(.08, .08, .4), poleMat); bracket.position.set(px + ax * .3, 2.7, pz + az * .3); bracket.rotation.y = yaw; scene.add(bracket);
    pedSignals.push({ crossing: approach, red: head.stop, green: head.go, timer: head.timer, readout: head.readout });
    const button = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, .06, 16).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe6e8ea, emissive: 0x6ea2ff, emissiveIntensity: 0 }));
    const plate = new THREE.Group(); plate.position.set(px - ax * .17, 1.25, pz - az * .17); plate.rotation.y = yaw + Math.PI; scene.add(plate); // on the side of the pole that faces the people waiting, away from the road
    const backing = new THREE.Mesh(new THREE.BoxGeometry(.22, .4, .04), new THREE.MeshStandardMaterial({ color: 0xf0c419, roughness: .5 })); plate.add(backing); // a yellow plate, as on the real ones
    const collar = new THREE.Mesh(new THREE.TorusGeometry(.075, .014, 6, 20), rimMat); collar.position.set(0, -.04, .025); plate.add(collar);
    button.position.set(0, -.04, .04); plate.add(button);
    const icon = new THREE.Mesh(new THREE.PlaneGeometry(.12, .12), new THREE.MeshBasicMaterial({ map: lensTexture('walk', '#101010'), toneMapped: false })); icon.position.set(0, .11, .022); plate.add(icon); // the walking figure above the button
    plate.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    buttons.push({ crossing: approach, mesh: button });
  }
}

// ---------- the detection cameras (see CAMERA_RIG in src/sim/world.js and web/tools/detectability.mjs) ----------
// Each approach has three, on 15 m poles on the footpath at about 30, 85 and 140 m from the stop line, looking across the road with a 130 degree lens. They are wired: one trunk
// cable runs from the far pole along the lamp poles to the signal mast, hung between them with a little sag, and down the mast to a cabinet at its foot.
const camBodyMat = new THREE.MeshStandardMaterial({ color: 0xdfe3e6, roughness: .45, metalness: .25 }), camDarkMat = new THREE.MeshStandardMaterial({ color: 0x1c1f23, roughness: .5, metalness: .4 });
const camGlassMat = new THREE.MeshStandardMaterial({ color: 0x0b1626, roughness: .08, metalness: .6 }), cableMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: .7 });
function makeCamera() { // an outdoor bullet camera with a wide lens, facing negative z, centred on the housing, the size of a real one so a pole can carry it
  const g = new THREE.Group(), L = .42, R = .075;
  const lensMat = new THREE.MeshStandardMaterial({ color: 0x0a1424, roughness: .05, metalness: .8, emissive: 0x0b2a55, emissiveIntensity: .25 });
  const housing = new THREE.Mesh(new THREE.CylinderGeometry(R, R, L, 18).rotateX(Math.PI / 2), camBodyMat); g.add(housing);
  const capBack = new THREE.Mesh(new THREE.CylinderGeometry(R * .92, R, .06, 18).rotateX(Math.PI / 2), camDarkMat); capBack.position.z = L / 2 + .03; g.add(capBack);
  const front = new THREE.Mesh(new THREE.CylinderGeometry(R + .012, R + .012, .06, 18).rotateX(Math.PI / 2), camDarkMat); front.position.z = -L / 2 + .02; g.add(front); // the front bezel
  const shield = new THREE.Mesh(new THREE.CylinderGeometry(R + .03, R + .03, L + .14, 18, 1, true, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), camBodyMat); // a half pipe over the top, longer than the housing, to keep sun and rain off the glass
  shield.material = camBodyMat.clone(); shield.material.side = THREE.DoubleSide; shield.position.set(0, .02, -.06); g.add(shield);
  const shieldEdge = new THREE.Mesh(new THREE.BoxGeometry((R + .03) * 2, .014, .02), camDarkMat); shieldEdge.position.set(0, R + .05, -L / 2 - .012); g.add(shieldEdge);
  const window_ = new THREE.Mesh(new THREE.CircleGeometry(R * .78, 20), lensMat); window_.position.z = -L / 2 - .012; window_.rotation.y = Math.PI; g.add(window_);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R * .8, .012, 6, 24), camDarkMat); ring.position.z = -L / 2 - .012; g.add(ring);
  const lensCore = new THREE.Mesh(new THREE.CylinderGeometry(R * .42, R * .42, .04, 16).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x050a12, roughness: .1, metalness: .9 })); lensCore.position.z = -L / 2 - .02; g.add(lensCore);
  const glint = new THREE.Mesh(new THREE.CircleGeometry(R * .14, 10), new THREE.MeshBasicMaterial({ color: 0x7fb4ff })); glint.position.set(-R * .22, R * .22, -L / 2 - .045); glint.rotation.y = Math.PI; g.add(glint);
  const irMat = new THREE.MeshBasicMaterial({ color: 0x7a1010 }); // a ring of infrared lamps round the lens, for night
  for (let i = 0; i < 10; i += 1) { const a = i / 10 * Math.PI * 2, d = new THREE.Mesh(new THREE.CylinderGeometry(.008, .008, .01, 6).rotateX(Math.PI / 2), irMat); d.position.set(Math.cos(a) * R * .68, Math.sin(a) * R * .68, -L / 2 - .016); g.add(d); }
  const led = new THREE.Mesh(new THREE.SphereGeometry(.016, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3b30 })); led.position.set(R * .85, -R * .1, -L / 2 + .02); g.add(led);
  const label = new THREE.Mesh(new THREE.PlaneGeometry(.12, .035), new THREE.MeshBasicMaterial({ color: 0x1a1d21 })); label.position.set(0, -R - .001, 0); label.rotation.x = Math.PI / 2; g.add(label);
  const gland = new THREE.Mesh(new THREE.CylinderGeometry(.015, .02, .07, 8), camDarkMat); gland.position.set(0, -.01, L / 2 + .08); gland.rotation.x = Math.PI / 2; g.add(gland); // where the cable goes in at the back
  const mount = new THREE.Mesh(new THREE.CylinderGeometry(.03, .035, .14, 10), camDarkMat); mount.position.set(0, -R - .06, .05); g.add(mount); // the swivel under it
  const ball = new THREE.Mesh(new THREE.SphereGeometry(.045, 10, 8), camDarkMat); ball.position.set(0, -R - .13, .05); g.add(ball);
  g.userData.length = L; g.userData.radius = R;
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
const cameraPoints = []; // every camera: its approach, how far up the road it is, and the object, for the page and for the view through it
const CAM_H = 10, POLE_HEIGHT = 15; // a camera is 10 m up the face of its building, or 15 m up a pole
const CABINET_CORNER = 3; // the corner at (-14, -12), the one farthest from the start view
for (let k = 0; k < 4; k += 1) {
  const spots = [];
  for (const [i, along] of CAMERA_STATIONS.entries()) {
    spots.push(along);
    if (MOUNT_PLAN[k][i] === 'pole') {
      const POLE_H = POLE_HEIGHT, POLE_X = H + 1.2, [px, pz] = rot(k, POLE_X, YS - along);
      const pole = new THREE.Group(); pole.position.set(px, 0, pz); pole.rotation.y = -k * Q; scene.add(pole);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.075, .17, POLE_H, 12), poleMat); shaft.position.y = POLE_H / 2; shaft.castShadow = true; pole.add(shaft);
      const flange = new THREE.Mesh(new THREE.CylinderGeometry(.27, .3, .25, 12), rimMat); flange.position.y = .125; pole.add(flange);
      const handhole = new THREE.Mesh(new THREE.BoxGeometry(.2, .45, .05), camDarkMat); handhole.position.set(-.16, 1.1, 0); handhole.rotation.y = Math.PI / 2; pole.add(handhole);
      const box = new THREE.Mesh(new THREE.BoxGeometry(.3, .4, .2), camBodyMat); box.position.set(.27, 6.9, 0); box.castShadow = true; pole.add(box);
      const conduit = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, POLE_H - 7.4, 6), camDarkMat); conduit.position.set(.19, 7.1 + (POLE_H - 7.4) / 2, 0); pole.add(conduit);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.1, .08, .08), poleMat); arm.position.set(-.55, POLE_H - .5, 0); arm.castShadow = true; pole.add(arm);
      const strut = new THREE.Mesh(new THREE.BoxGeometry(.05, .05, 1.0), poleMat); strut.position.set(-.35, POLE_H - 1.0, 0); strut.rotation.set(0, Math.PI / 2, .75); pole.add(strut);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, .35, 8), camDarkMat); post.position.set(-1.0, POLE_H - .5 + .17, 0); pole.add(post);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(.012, .012, 1.0, 5), camDarkMat); rod.position.set(0, POLE_H + .5, 0); pole.add(rod);
      const cam = makeCamera(), holder = new THREE.Group(); holder.rotation.order = 'YXZ'; holder.rotation.y = Math.PI / 2; holder.rotation.x = -Math.atan2(POLE_H - .15, POLE_X - LANE_X[1]);
      const ball = new THREE.Vector3(0, -(cam.userData.radius + .13), .05).applyEuler(holder.rotation);
      holder.position.set(-1.0, POLE_H - .5 + .35, 0).sub(ball); holder.add(cam); pole.add(holder);
      cameraPoints.push({ approach: k + 1, kind: 'pole', along, obj: cam });
      continue;
    }
    const [x, z] = rot(k, EDGE_OF_ROAD, YS - along);
    const face = new THREE.Group(); face.position.set(x, 0, z); face.rotation.y = -k * Q; scene.add(face); // local -x points at the road, and the building is behind it at +x
    const plate = new THREE.Mesh(new THREE.BoxGeometry(.06, .5, .5), camDarkMat); plate.position.set(-.03, CAM_H, 0); face.add(plate); // a backplate bolted to the wall
    const arm = new THREE.Mesh(new THREE.BoxGeometry(.9, .07, .07), poleMat); arm.position.set(-.45, CAM_H + .15, 0); arm.castShadow = true; face.add(arm);
    const strut = new THREE.Mesh(new THREE.BoxGeometry(.05, .05, .75), poleMat); strut.position.set(-.3, CAM_H - .05, 0); strut.rotation.set(0, Math.PI / 2, .7); face.add(strut);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, .22, 8), camDarkMat); post.position.set(-.85, CAM_H + .15 + .11, 0); face.add(post);
    const jb = new THREE.Mesh(new THREE.BoxGeometry(.2, .28, .12), camBodyMat); jb.position.set(-.1, CAM_H - .55, 0); jb.castShadow = true; face.add(jb); // where the cable joins, on the wall under the camera
    // the conduit runs along the wall toward the junction round the corner of the building, and down its side wall to the ground, clear of the shop awnings
    const CORNER = HOST.width / 2 + .04, tray = new THREE.Mesh(new THREE.BoxGeometry(.05, .05, CORNER), camDarkMat); tray.position.set(-.04, CAM_H - .55, CORNER / 2); face.add(tray);
    const run = new THREE.Mesh(new THREE.CylinderGeometry(.022, .022, CAM_H - .5, 6), camDarkMat); run.position.set(.1, (CAM_H - .5) / 2, CORNER); face.add(run);
    for (let h = 1.5; h < CAM_H - .6; h += 2.2) { const clip = new THREE.Mesh(new THREE.BoxGeometry(.04, .07, .09), camBodyMat); clip.position.set(.1, h, CORNER); face.add(clip); }
    const elbow = new THREE.Mesh(new THREE.BoxGeometry(.5, .06, .06), camDarkMat); elbow.position.set(-.15, .03, CORNER); face.add(elbow); // and into the ground, to the pull box in the footpath
    const cam = makeCamera(), holder = new THREE.Group(); holder.rotation.order = 'YXZ'; holder.rotation.y = Math.PI / 2; holder.rotation.x = -Math.atan2(CAM_H - .15, EDGE_OF_ROAD - .85 - LANE_X[1]);
    const ball = new THREE.Vector3(0, -(cam.userData.radius + .13), .05).applyEuler(holder.rotation);
    holder.position.set(-.85, CAM_H + .15 + .22, 0).sub(ball); holder.add(cam); face.add(holder);
    cameraPoints.push({ approach: k + 1, kind: 'building', along, obj: cam });
  }
  // The cable is buried. From each camera it runs in a conduit down the wall or the pole to a flush pull box in the footpath, and a duct under the footpath joins the boxes to the cabinet
  // at the foot of the signal mast. The lids along the footpath mark that route.
  const [mx, mz] = rot(k, H + 2.3, YS);
  const lidAt = (along, local = EDGE_OF_ROAD - 1.1) => { const [x, z] = rot(k, local, YS - along); const lid = new THREE.Mesh(new THREE.BoxGeometry(.5, .04, .34), camDarkMat); lid.position.set(x, .03, z); lid.rotation.y = -k * Q; lid.receiveShadow = true; scene.add(lid); };
  for (const along of [10, 40]) lidAt(along);
  for (const [i, along] of spots.entries()) lidAt(MOUNT_PLAN[k][i] === 'building' ? along - (HOST.width / 2 + .04) : along); // the pull box of a building camera is at its corner
  // One cabinet serves the whole junction: the controller, the power supply, the surge protection and the switch that the camera cables of all four roads end at. It stands at the foot of the mast
  // at the corner farthest from the start view, where it hides nothing, and the ducts under the footpaths run to it.
  if (k !== CABINET_CORNER) continue;
  const mastFoot = new THREE.Group(); mastFoot.position.set(mx, 0, mz); mastFoot.rotation.y = -k * Q; scene.add(mastFoot);
  const duct = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, .5, 6), camDarkMat); duct.position.set(.7, .1, .3); mastFoot.add(duct); // the duct comes up from the ground into the cabinet
  const cabinet = new THREE.Mesh(new THREE.BoxGeometry(.6, 1.3, .45), camBodyMat); cabinet.position.set(.7, .65, 0); cabinet.castShadow = true; mastFoot.add(cabinet);
  const door = new THREE.Mesh(new THREE.BoxGeometry(.48, 1.05, .01), camDarkMat); door.position.set(.7, .67, -.230); mastFoot.add(door);
  const vent = new THREE.Mesh(new THREE.BoxGeometry(.36, .08, .01), camDarkMat); vent.position.set(.7, 1.12, .230); mastFoot.add(vent);
}

// ---------- vehicles: the models are in src/scene/vehicles.js ----------
const SKIN = ['#f0c8a0', '#d9a577', '#b87c52', '#8d5a3b', '#6b4330'];
const CLOTHES = ['#d44b3a', '#2f7fd6', '#f0b429', '#4cb7a5', '#7e5bb5', '#f2efe6', '#3d4b5c', '#e07aa0', '#5a8f3c', '#c9a14a'];
const limbGeo = new THREE.BoxGeometry(.13, .78, .15).translate(0, -.39, 0), armGeo = new THREE.BoxGeometry(.1, .56, .12).translate(0, -.28, 0);
const torsoGeo = new THREE.BoxGeometry(.28, .6, .4), headGeo = new THREE.SphereGeometry(.12, 10, 8);
// companions: a dog on a lead, a pram, a child by the hand. They follow their walker and share its pace.
const FUR = ['#c9a06a', '#3a2c22', '#e8e0d0', '#8a6a45', '#2c2c2c'];
function buildDog(id) {
  const g = new THREE.Group(), fur = withNightGlow(new THREE.MeshStandardMaterial({ color: FUR[id % FUR.length], roughness: .95 })), dark = withNightGlow(new THREE.MeshStandardMaterial({ color: '#1d1a18' }));
  const part = (w, h, d, x, y, z, mat = fur) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); g.add(m); return m; };
  part(.62, .26, .24, 0, .44, 0); part(.2, .2, .18, .4, .56, 0); part(.1, .09, .12, .53, .52, 0, dark); part(.06, .12, .05, .36, .7, .07); part(.06, .12, .05, .36, .7, -.07);
  const tail = part(.22, .05, .05, -.38, .6, 0); tail.geometry.translate(-.08, 0, 0); tail.position.x = -.3; tail.rotation.z = .6;
  const legs = [[.22, .08], [.22, -.08], [-.22, .08], [-.22, -.08]].map(([x, z]) => { const l = new THREE.Mesh(new THREE.BoxGeometry(.07, .3, .07).translate(0, -.15, 0), fur); l.position.set(x, .32, z); g.add(l); return l; });
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { mesh: g, update(time, moving) { const w = Math.sin(time * 9 + id) * .7 * Math.min(moving, 1.5); legs.forEach((l, i) => { l.rotation.z = (i === 0 || i === 3 ? w : -w); }); tail.rotation.y = Math.sin(time * 11 + id) * .6; } };
}
// People, a pram and a cyclist come from src/scene/people.js. These keep the names and arguments the rest of this file uses.
const buildPedestrian = (id, scale = 1, companions = false, role = '') => {
  const child = scale < .8; // the callers ask for a small one by scale
  const g = buildPerson(id, { kind: child ? 'child' : role === 'elder' ? 'elder' : role === 'commuter' || role === 'jogger' ? 'adult' : undefined, scale: child ? 1 : scale });
  g.userData.extras = companions ? addCompanions(g, id) : [];
  return g;
};
const animateWalker = walkPose;
const buildPram = buildPramModel, buildCyclist = buildCyclistModel, animateCyclist = animateCyclistModel;
function addCompanions(g, id) {
  const kind = id % 10, extras = [], u = g.userData;
  const pose = (arm, r) => ({ update() { arm.rotation.set(r.x, 0, r.z); } }); // keeps an arm where it holds something, over the walking swing
  if (kind === 0 || kind === 3) { // a dog on a lead, beside and a little ahead, the lead running from the right hand to its collar
    const dog = buildDog(id); dog.mesh.position.set(.7, 0, -.75); g.add(dog.mesh);
    const hold = { x: .3, z: .45 }; u.armR.rotation.set(hold.x, 0, hold.z);
    const from = handOf(g, u.armR), to = new THREE.Vector3(1.0, .56, -.75), lead = new THREE.Mesh(new THREE.CylinderGeometry(.007, .007, from.distanceTo(to), 4), new THREE.MeshStandardMaterial({ color: '#a52b2b' }));
    lead.position.copy(from).add(to).multiplyScalar(.5); lead.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize()); g.add(lead);
    extras.push(dog, pose(u.armR, hold));
  }
  if (kind === 1) { // a pram pushed with both hands on the handle
    const pram = buildPram(id); pram.mesh.position.set(.83, 0, 0); g.add(pram.mesh);
    const holds = [[u.armL, .2], [u.armR, -.2]].map(([arm, z]) => [arm, reachWith(g, arm, new THREE.Vector3(.38, 1.05, z))]);
    extras.push({ update: (time, moving) => { pram.update(time, moving); for (const [arm, r] of holds) arm.rotation.set(r.x, 0, r.z); } });
  }
  if (kind === 2 || kind === 3) { // a child by the hand: the child stands where its raised hand meets the adult's left hand
    const kid = buildPedestrian(id + 777, .68); g.add(kid);
    u.armL.rotation.set(0, 0, 0); const grip = handOf(g, u.armL);
    let best = null;
    for (let cz = .35; cz <= .95; cz += .05) { kid.position.set(0, 0, cz); const r = reachWith(g, kid.userData.armR, grip, { xMin: -1.6, xMax: 1.6, zMin: -.3, zMax: .6 }); if (!best || r.d < best.d) best = { cz, r }; }
    kid.position.set(0, 0, best.cz);
    extras.push({ mesh: kid, update: (time, moving) => { animateWalker(kid, time, moving); kid.userData.armR.rotation.set(best.r.x, 0, best.r.z); } }, pose(u.armL, { x: 0, z: 0 }));
  }
  return extras;
}
// a bicycle with its rider, who pedals
// swing the limbs. moving is 0 for standing still, 1 for a walk and above for a jog.

// ---------- the simulation, running the real controller ----------
// Vehicles start 700 m out and drive 640 m past the junction, so they come and go out of sight. The vehicles, their axles and
// the pedestrians' places all come from the simulation (web/src/sim), where nothing moves into a space another thing holds.
// The page opens at the visitor's own local time of day and day of the week (day 0 is Monday), so the sky, the traffic, the people and the park match their clock.
const localNow = new Date(), localWeekSecond = ((localNow.getDay() + 6) % 7) * 86400 + localNow.getHours() * 3600 + localNow.getMinutes() * 60 + localNow.getSeconds();
// (less the warm-up below, so the page opens on the visitor's real time)
// `?seed=N` in the address fixes the traffic, so a run can be repeated (the training set is made in runs, each with a seed, see docs/detector.md). Anything but a whole number from 1 to 2147483646 is ignored.
// Ten minutes of traffic before the first frame. Four minutes fills the roads with vehicles (94 to 101% of what ten gives) but leaves the footpaths near the junction empty: pedestrians walk in from 560 m, so the first
// reach the junction after about seven minutes, and within 70 m of it there are none after four minutes and 23 to 36 after ten (measured at 08:00, 13:00 and 18:00).
const WARM_UP_SECONDS = 600;
const SEED_PARAM = new URLSearchParams(location.search).get('seed'), SEED = /^[0-9]{1,10}$/.test(SEED_PARAM || '') && Number(SEED_PARAM) >= 1 && Number(SEED_PARAM) <= 2147483646 ? Number(SEED_PARAM) : null;
const sim = new Simulation({ seed: SEED ?? 1 + Math.floor(Math.random() * 2147483646), mode: 'adaptive', // a new seed on every visit, so the traffic is not the same every time
   demand: { ...PRESETS.clock, clockStartS: localWeekSecond - WARM_UP_SECONDS }, ...CAMERA_RIG, config: { default_green: 40 }, approachLength: APPROACH, exitRun: 640, pedestrianWalk: 560, leftWaitsForWalk: true }); // a left turner holds at the line during the walk and moves up at the flashing red man, when the left arrow shows green
const DT = sim.dt;
for (let i = 0; i < WARM_UP_SECONDS * sim.stepsPerSecond; i += 1) sim.step(); // so the long roads are already busy when the page opens
const tracks = new Tracks(sim);
let speed = 1, acc = 0;
const peds = new Map();
let lastSky = null; // the last state of the sky (set every frame), declared here because the car parks and the courtyards read it when they are made
// How much of its usual crowd the weather lets out: nobody sits on a bench or rides a hired bike in the rain, so the park, the courtyards and the bike hire empty as it sets in.
const fairWeather = () => Math.max(0, 1 - 1.6 * (lastSky ? lastSky.rain : 0));
const TYRE_LIFT = .03; // the side streets and the car parks are 1 to 2 cm above the main road, so a vehicle stands 3 cm up, and its tyres rest on every one of them and none is under a surface
// The glow of the sirens comes from a fixed set of point lights, a blue and a red for each of the two emergency vehicles nearest the camera. They are in the scene from the start (dark when unused), because the number of
// lights is part of every lit material's shader: adding one when a siren appears made every material compile again, a hitch of up to a few hundred milliseconds.
const SIREN_LIGHTS = Array.from({ length: 2 }, () => ({ blue: new THREE.PointLight(0x3d8bff, 0, 18, 2), red: new THREE.PointLight(0xff3535, 0, 18, 2) }));
for (const pair of SIREN_LIGHTS) scene.add(pair.blue, pair.red);
function lightSirens(sirens, on) { // sirens: [{ mesh, siren }], the emergency vehicles on the road
  const camera3 = camera.position;
  sirens.sort((a, b) => a.mesh.position.distanceToSquared(camera3) - b.mesh.position.distanceToSquared(camera3));
  SIREN_LIGHTS.forEach((pair, i) => {
    const s = sirens[i]; if (!s || !s.mesh.visible) { pair.blue.intensity = pair.red.intensity = 0; return; }
    const c = Math.cos(s.mesh.rotation.y), n = Math.sin(s.mesh.rotation.y), at = (light, [lx, ly, lz]) => light.position.set(s.mesh.position.x + lx * c + lz * n, ly, s.mesh.position.z - lx * n + lz * c);
    at(pair.blue, s.siren.glowB); at(pair.red, s.siren.glowR);
    pair.blue.intensity = on ? 40 : 2; pair.red.intensity = on ? 2 : 40;
  });
}
// Beyond 540 m from the camera things shrink to nothing by 620 m. They start out at least 540 m away, so none appears at full size.
function fadeOut(mesh, x, z) { const f = Math.max(0, Math.min(1, (620 - Math.hypot(x - camera.position.x, z - camera.position.z)) / 80)); mesh.visible = f > .02; mesh.scale.setScalar(Math.max(f, .001)); }
// Meshes for vehicles that have appeared, and away with those that have left.
// A headlight beam stops at the back of whatever stands in front of it. The beam is a flat strip from the nose, so behind a queued vehicle it would run under that vehicle and light the road beyond it, which a
// vehicle in the way does not allow. Each beam is shortened to the nearest vehicle whose body is in its path (a vehicle crossing the path counts), and put back to full length when the way is clear.
const BEAM_SPARE = .25; // m: the beam ends this far short of the vehicle in front, which is where its light falls on the bumper
// What stands in a vehicle's headlights (a person, another vehicle) is lit by them, as any surface is: where it is inside the cone of a beam, as bright as the beam is there, on the side that faces the lamps,
// in its own colour. The shader does the lighting (night-glow.js). Which beams light which thing is worked out by headlight-aim.js, from where the lamps and the things really are, whatever the beam on the road
// has been cut short by: a vehicle waiting across the path of a turning one, one of the oncoming vehicles, a person on a crossing, a long bus, and a thing in the shadow of another is not lit. Each thing keeps
// up to two beams (`userData.beamIn.slots`), eased on and off so a light does not flash as vehicles pass.
const PEOPLE = () => [...peds.values(), ...parkPeople].filter((p) => p.mesh && p.mesh.visible && !(p.mesh.userData && p.mesh.userData.sitting));
const BEAM_LIT = .95; // the share of a surface's colour that a beam at full strength adds
const LIGHT_ON_TAU = .12, LIGHT_OFF_TAU = .3; // seconds: how fast a surface takes up the light of a beam and lets it go
function lightThings(list, people, lit, dt) {
  const targets = [...list.map((a) => ({ id: a.id, mesh: a.mesh, x: a.mesh.position.x, z: a.mesh.position.z, yaw: a.mesh.rotation.y, length: a.length, width: a.width })),
    ...people.map((p) => ({ id: p.mesh.uuid, mesh: p.mesh, x: p.mesh.position.x, z: p.mesh.position.z, yaw: p.mesh.rotation.y, length: .6, width: .6 }))];
  const attackers = [];
  if (lit) for (const a of list) {
    const u = a.mesh.userData; if (!u.beamMeshes || !u.beamMeshes.length) continue;
    const { start, reach, spread } = u.beamMeshes[0].userData.beam;
    attackers.push({ id: a.id, x: a.mesh.position.x, z: a.mesh.position.z, yaw: a.mesh.rotation.y, start, reach, spread, extra: Math.max(...u.beamMeshes.map((o) => Math.abs(o.userData.beam.z))) + .25 });
  }
  const picked = lit ? pickBeams(attackers, targets, targets) : new Map();
  for (const t of targets) {
    const mine = picked.get(t.id) || [], state = t.mesh.userData.beamIn || (mine.length ? (t.mesh.userData.beamIn = { slots: [] }) : null); if (!state) continue;
    for (const slot of state.slots) slot.want = 0;
    for (const beam of mine) {
      let slot = state.slots.find((q) => q.from === beam.from); if (!slot) { slot = { from: beam.from, s: 0, want: 0, y: .72 }; state.slots.push(slot); }
      Object.assign(slot, { x: beam.x, z: beam.z, ax: beam.ax, az: beam.az, reach: beam.reach, spread: beam.spread, extra: beam.extra, want: Math.min(.95, BEAM_LIT * lastSky.lights * 1.5) });
    }
    for (const slot of state.slots) slot.s = lit ? Math.max(0, slot.s + (slot.want - slot.s) * (1 - Math.exp(-dt / (slot.want > slot.s ? LIGHT_ON_TAU : LIGHT_OFF_TAU)))) : 0; // a light comes up in about a fifth of a second and fades in about a third, whatever the frame rate
    state.slots = state.slots.filter((slot) => slot.want > 0 || slot.s > .01);
  }
}
let lastBeamTime = null;
function shortenBeams(list) {
  const now = performance.now(), dt = lastBeamTime === null ? 1 / 60 : Math.min(.25, (now - lastBeamTime) / 1000); lastBeamTime = now; // seconds since the last frame, so the easing is the same at any frame rate
  const lit = lastSky && lastSky.lights >= .02; // the beams are off by day
  if (lit) {
    const bodies = list.map((a) => ({ id: a.id, x: a.mesh.position.x, z: a.mesh.position.z, yaw: a.mesh.rotation.y, length: a.length, width: a.width }));
    for (const a of list) {
      const u = a.mesh.userData; if (!u.beamMeshes) { u.beamMeshes = []; a.mesh.traverse((o) => { if (o.userData.beam) u.beamMeshes.push(o); }); }
      if (!u.beamMeshes.length) continue;
      const pa = a.mesh.position, ya = a.mesh.rotation.y, fx = Math.cos(-ya), fz = Math.sin(-ya), rx = Math.sin(ya), rz = Math.cos(ya); // the way it faces (the model's +x, turned by -rotation.y), and across it
      for (const o of u.beamMeshes) {
        const { start, reach, z: beamSide } = o.userData.beam;
        // The beam runs from the lamp to the first body in the way, found by the same test that decides which vehicle is lit (headlight-aim.js), and the length eases toward it, so a vehicle that sweeps across the beam in a
        // turn, or comes in and goes out of the way, shortens it and lets it grow back smoothly and does not snap it.
        const target = Math.max(.3, Math.min(reach, beamFree({ x: pa.x + fx * start + rx * beamSide, z: pa.z + fz * start + rz * beamSide, dx: fx, dz: fz, reach }, bodies, a.id) + .1)) / reach; // the beam is `reach` long from the nose
        const was = o.userData.fraction === undefined ? target : o.userData.fraction, f = Math.abs(was - target) < .002 ? target : easeBeam(was, target, dt);
        o.userData.fraction = f;
        if (Math.abs(o.scale.x - f) > .002) { o.scale.x = f; o.position.x = start * (1 - f); } // scaled about the start of the beam, which stays at the nose
      }
    }
  }
  lightThings(list, PEOPLE(), lit, dt);
}
function capture() {
  tracks.capture();
  for (const s of tracks.vehicles.values()) if (!s.mesh) { s.mesh = buildVehicle(s.cls, s.id, 'au', s.vehicle.kind); scene.add(s.mesh); }
  for (const s of tracks.removed) if (s.mesh) { scene.remove(s.mesh); releaseModel(s.mesh); }
  tracks.removed.length = 0;
  const here = new Set();
  for (const p of [...sim.pedestrians]) { // someone walking past a park gate may go in
    const gate = gateFor(p);
    if (gate && peds.has(p.id) && visitorCount() < 30 && ((Math.imul(p.id, 2654435761) >>> 0) % 1000) / 1000 < parkShare() * .45) { const m = peds.get(p.id); sim.releasePedestrian(p); peds.delete(p.id); enterPark(m.mesh, gate); }
  }
  for (const p of sim.pedestrians) {
    here.add(p.id);
    const pose = pedestrianPose(p);
    let m = peds.get(p.id);
    // a school child is built small, and walks with no pram or dog
    if (!m) { m = { mesh: buildPedestrian(p.id, p.student ? .72 : 1, !p.student && !p.role, p.role), prev: pose, curr: pose, speed: p.speed }; scene.add(m.mesh); peds.set(p.id, m); } else { m.prev = m.curr; m.curr = pose; }
  }
  for (const [id, m] of peds) if (!here.has(id)) { scene.remove(m.mesh); releaseModel(m.mesh); peds.delete(id); }
}

// Pedestrians, drawn between their last two simulation steps like the vehicles. Their legs move only while they are moving.
function updatePedestrians(time, alpha) {
  for (const m of peds.values()) {
    const x = m.prev.x + (m.curr.x - m.prev.x) * alpha, z = m.prev.z + (m.curr.z - m.prev.z) * alpha;
    // Feet on the footpath slab, which stands 0.16 m above the road: the height eases to it over about a tenth of a second, so a step up or down at the kerb is not a jump.
    const target = footpathHeight(x, z); if (m.y === undefined) m.y = target; m.y += (target - m.y) * Math.min(1, Math.max(0, time - (m.t ?? time)) * 14); m.t = time;
    m.mesh.position.set(x, m.y, z); m.mesh.rotation.y = -m.curr.h;
    animateWalker(m.mesh, time, Math.hypot(m.curr.x - m.prev.x, m.curr.z - m.prev.z) > .03 ? (m.speed > 2.2 ? 2 : 1) : 0); // a jogger runs
    fadeOut(m.mesh, x, z);
  }
}

// What the signals can say about the seconds ahead (countdown.js), worked out once for each second of the simulation and not for each frame.
let ahead = { time: -1, heads: [null, null, null, null], crossings: [null, null, null, null] };
function aheadNow() {
  const time = sim.controller.time;
  if (ahead.time !== time) ahead = { time, heads: forecast(sim.controller), crossings: [1, 2, 3, 4].map((n) => flashingSeconds(sim.controller, n)) };
  return ahead;
}

function updateSignals(time) {
  const snap = sim.snapshot, flash = Math.floor(time * 2) % 2 === 0, soon = aheadNow();
  for (const h of heads) {
    const a = h.approach;
    const apply = (lamps, state, flashOn) => {
      const f = state === 'flash';
      setLamp(lamps[0], state === 'red' || (f && flashOn));
      setLamp(lamps[1], state === 'yellow');
      setLamp(lamps[2], state === 'green');
    };
    for (const lamps of h.t) apply(lamps, snap.signals[`T${a}`], flash);
    if (!h.arrows) continue; // a vertical head shows only the three discs
    // An arrow has a green and an amber lens in the same place. Only the lit one is drawn, and when neither is lit the green one is, dark,
    // because the unlit amber lens would otherwise sit in front of the green one and hide it.
    const arrow = (lamp, state) => {
      setLamp(lamp.green, state === 'green'); setLamp(lamp.amber, state === 'yellow');
      lamp.amber.lens.visible = state === 'yellow'; lamp.green.lens.visible = state !== 'yellow';
    };
    arrow(h.arrows.left, (snap.shown_arrows || snap.arrows)[a - 1]); arrow(h.arrows.right, snap.signals[`R${a}`]);
    // The countdown shows the seconds left in the green or yellow that this approach is showing, and, while it is red, the seconds until its next light when that is known exactly.
    // It shows two dashes when it is not known (a green held open for an emergency vehicle, a fault) and when the next light is too far off to be sure (a lower bound is for the plan on the status card, not for a head).
    const f = soon.heads[a - 1];
    h.timer.draw(f && f.kind !== 'more' && f.seconds !== null ? String(Math.min(99, Math.max(0, Math.round(f.seconds)))).padStart(2, '0') : '--');
  }
  for (const p of pedSignals) {
    const state = snap.signals[`C${p.crossing}`];
    setLamp(p.red, state === 'stop' || (state === 'clear' && flash));
    setLamp(p.green, state === 'walk');
    const left = soon.crossings[p.crossing - 1]; // the flashing red man counts down to the red one
    p.readout.visible = left !== null;
    if (left !== null) p.timer.draw(String(Math.min(99, left)).padStart(2, '0'));
  }
  for (const b of buttons) b.mesh.material.emissiveIntensity = snap.pedestrian_requests.includes(b.crossing) ? 1.6 + .6 * Math.sin(time * 8) : 0;
}

// ---------- the people of the share hubs: they walk up the kerb side of the footpath, take a scooter or a bike and ride away, and some ride in and leave one (src/scene/hub.js) ----------
for (const hub of hubs) {
  hub.life = createHubLife(hub, {
    scene, to: hub.pendingLife.to, pedestrians: () => sim.pedestrians, demand: () => pedestrianFactor(sim.controller.clockStart + sim.snapshot.time) * fairWeather(), // the same day pattern as the pedestrians, and nobody rides in the rain
    builders: { walker: (id) => buildPedestrian(id), rider: (id) => buildCyclist(id, '#4fb83a'), scooterRider: (id) => buildScooterRider(buildPedestrian(id), hub.vertex), animateWalker, animateRider: animateCyclist, animateScooter: (mesh, time) => { // standing on the deck, with both hands on the bar: the arms are set after the walking pose, which would let them hang
      const body = mesh.userData.body; animateWalker(body, time, 0);
      const shoulder = .2 + 1.4 * body.userData.body.scale.y, reach = Math.atan2(.32, shoulder - 1.07); body.userData.armL.rotation.z = body.userData.armR.rotation.z = reach;
    } },
  });
  delete hub.pendingLife;
}

// ---------- the car parks: cars come in from the far end of the side street, park, and their people walk to the door; later they walk back and drive off (src/scene/carpark-life.js) ----------
let carparkTime = 0;
const parkedHeadMat = headMat.clone(); parkedHeadMat.emissiveIntensity = .3; // a headlamp that stays unlit at night
{
  const week0 = sim.controller.clockStart + sim.snapshot.time;
  for (const v of venues) {
    const tint = (m) => { m.userData.noCollide = true; return m; }; // moving things are not part of what the viewpoint keeps clear of
    const place = (m, a, t, heading) => { const [x, z] = v.toWorld(a, t); m.position.set(x, m.userData.tail ? TYRE_LIFT : 0, z); m.rotation.y = heading - v.k * Q; return [x, z]; };
    v.life = createCarPark({
      kind: v.kind, hour: (week0 % 86400) / 3600, weekend: Math.floor((week0 % 604800) / 86400) > 4,
      adapter: {
        makeCar: (id) => tint(buildVehicle('car', id, 'au')), makeWalker: (id) => tint(buildPedestrian(id)),
        addCar: (m) => scene.add(m), removeCar: (m) => { scene.remove(m); releaseModel(m); }, addWalker: (m) => scene.add(m), removeWalker: (m) => { scene.remove(m); releaseModel(m); },
        poseCar(m, p) {
          const [x, z] = place(m, p.a, p.t, p.heading); fadeOut(m, x, z); // far up the street it is out of sight in the haze
          const u = m.userData, blink = Math.floor(carparkTime * 3) % 2 === 0;
          const moving = Boolean(p.moving);
          if (u.lampsOn !== moving) { // headlights and their beams are shared materials, lit at night: a parked car gets a dark copy of the lamp and no beam
            if (!u.lampParts) { u.lampParts = []; m.traverse((o) => { if (o.material === headMat || o.material === beamMat || o.userData.head) u.lampParts.push(o); }); }
            for (const o of u.lampParts) { if (o.material === beamMat) o.visible = moving; else { o.userData.head = true; o.material = moving ? headMat : parkedHeadMat; } }
            u.lampsOn = moving;
          }
          u.tail.emissiveIntensity = p.braking ? 2.6 : p.moving ? .25 + .8 * (lastSky ? lastSky.lights : night) : .15; // (the sky is not made yet when the cars that are already parked are placed, and they are not moving)
          u.indL.emissiveIntensity = p.signal === 'left' && blink ? 3.4 : 0; u.indR.emissiveIntensity = p.signal === 'right' && blink ? 3.4 : 0;
        },
        poseWalker(m, p) { place(m, p.a, p.t, p.heading); m.scale.setScalar(Math.max(.001, p.fade)); animateWalker(m, carparkTime, p.moving ? 1 : 0); },
      },
    });
  }
}

// ---------- the courtyards: people come in at the end of a path, sit on a bench or at the cafe for a while, and go (src/scene/courtyard-life.js). Benches follow the park's day, the cafe the footpath's, and rain empties both ----------
const YARD_PAVING = .08; // the top of a courtyard's pavement
const courtyardLife = yardPeople.map((yard) => createCourtyardLife(yard, {
  adapter: {
    makeWalker: (id) => { const m = buildPedestrian(2000 + id + Math.round(yard.x * 7 + yard.z * 3)); m.userData.noCollide = true; return m; },
    addWalker: (m) => scene.add(m), removeWalker: (m) => { scene.remove(m); releaseModel(m); },
    poseWalker(m, p) {
      m.position.set(p.x, YARD_PAVING, p.z); m.rotation.y = -p.heading; m.scale.setScalar(Math.max(.001, p.fade));
      if (p.sitting) { if (!m.userData.sitting) poseSitting(m, .5 - YARD_PAVING); } else { if (m.userData.sitting) standUp(m); animateWalker(m, carparkTime, p.moving ? 1 : 0); }
    },
  },
  hour: () => (((sim.controller.clockStart + sim.snapshot.time) % 86400) / 3600),
  demand: (kind) => (kind === 'cafe' ? pedestrianFactor : parkFactor)(sim.controller.clockStart + sim.snapshot.time) * fairWeather(),
}));
function updateCourtyards(dt) { for (const life of courtyardLife) life.update(dt); }

// ---------- people in the park: strollers, joggers, sitters, kids, players and a queue at the kiosk ----------
const parkPeople = [];
const addPerson = (person) => { scene.add(person.mesh); parkPeople.push(person); return person; };
const ringPoints = [], ringLength = (() => { // the ring path, sampled so a walker can be placed by distance along it
  const a = RING, r = RING_R, pts = [], steps = 24;
  const corner = (cx, cz, from) => { for (let i = 0; i <= steps; i += 1) { const t = from + i / steps * Q; pts.push([cx + Math.cos(t) * r, cz + Math.sin(t) * r]); } };
  corner(a - r, a - r, 0); corner(-a + r, a - r, Q); corner(-a + r, -a + r, 2 * Q); corner(a - r, -a + r, 3 * Q); pts.push(pts[0]);
  let total = 0; for (let i = 0; i < pts.length; i += 1) { if (i) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); ringPoints.push({ u: pts[i][0], v: pts[i][1], at: total }); }
  return total;
})();
function ringAt(distance, lateral) { // position and heading on the ring, lateral metres to the left of the walking direction (walkers keep left)
  const d = ((distance % ringLength) + ringLength) % ringLength; let i = 1; while (ringPoints[i].at < d) i += 1;
  const a = ringPoints[i - 1], b = ringPoints[i], f = (d - a.at) / Math.max(b.at - a.at, 1e-6), dx = b.u - a.u, dz = b.v - a.v, len = Math.hypot(dx, dz);
  return { u: a.u + dx * f - dz / len * lateral, v: a.v + dz * f + dx / len * lateral, heading: Math.atan2(dz, dx) };
}
function setPerson(person, u, v, heading, y = 0) { const [x, z] = inPark(u, v); person.mesh.position.set(x, y, z); person.mesh.rotation.y = -heading; }
// People on the ring keep to a lane for their pace, on the left of the way they walk, so nobody has to pass through anyone: strollers and couples
// on the outside at one pace, joggers inside them, cyclists inside those. Everyone in a lane goes at the same pace and starts well apart.
const RING_LANES = { walk: [2.2, 1.15], jog: [1.55, 2.8], cycle: [.8, 4.4] }; // lateral metres, pace in m/s. The lanes are at least .75 m apart, which is room for a cyclist (.45 m) to pass a walker (.28 m), and two cyclists coming the other way are 1.6 m apart
const ringSlots = { walk: { 1: 0, [-1]: 0 }, jog: { 1: 0, [-1]: 0 }, cycle: { 1: 0, [-1]: 0 } };
const ringSlotCount = { walk: 9, jog: 2, cycle: 2 }; // per direction: six strollers and three couples, two joggers, two cyclists
function ringPlace(lane, dir) { // the next free place in a lane, evenly spaced round the ring
  const k = ringSlots[lane][dir]++;
  return (k + .5) / ringSlotCount[lane] * ringLength + (dir > 0 ? 0 : ringLength / 2 / ringSlotCount[lane]);
}
for (let i = 0; i < 16; i += 1) { // strollers and joggers on the ring
  const dir = i % 2 ? 1 : -1, jog = i % 5 === 0, lane = jog ? 'jog' : 'walk', mesh = buildPedestrian(300 + i, 1, !jog);
  addPerson({ mesh, kind: 'ring', dir, at: ringPlace(lane, dir), speed: RING_LANES[lane][1], jog, lateral: RING_LANES[lane][0] });
}
for (let i = 0; i < 6; i += 1) { // two people walking together
  const dir = i % 2 ? 1 : -1, at = ringPlace('walk', dir);
  for (const gap of [0, 1.1]) addPerson({ mesh: buildPedestrian(340 + i * 2 + (gap ? 1 : 0), 1, i === 2 && !gap), kind: 'ring', dir, at: at + gap * dir * -1, speed: RING_LANES.walk[1], jog: false, lateral: RING_LANES.walk[0] });
}
seats.forEach((seat, i) => { // sitters on about every third bench
  if (i % 3 !== 1) return;
  const mesh = buildPedestrian(400 + i); poseSitting(mesh, .45);
  mesh.position.set(seat.x, 0, seat.z); mesh.rotation.y = -seat.facing; scene.add(mesh); parkPeople.push({ mesh, kind: 'still', sitting: true });
});
for (const [u, v, i] of [[6, 2, 0], [-6, -3, 1], [4, -6, 2], [-3, 7, 3]]) { // standing and talking on the plaza
  const mesh = buildPedestrian(450 + i); setPerson({ mesh }, u, v, i * 1.6); scene.add(mesh); parkPeople.push({ mesh, kind: 'still', u, v });
}
for (let i = 0; i < 4; i += 1) { // a short queue at the kiosk window
  const mesh = buildPedestrian(470 + i); setPerson({ mesh }, ZONES.kiosk.u - 1.5 + i * 1.1, ZONES.kiosk.v + 4.8, -Q); scene.add(mesh); parkPeople.push({ mesh, kind: 'still', u: ZONES.kiosk.u - 1.5 + i * 1.1, v: ZONES.kiosk.v + 4.8 });
}
for (const [u, v, c] of blankets) for (let i = 0; i < 2; i += 1) { // picnics
  const mesh = buildPedestrian(480 + i + u); poseSitting(mesh, .03);
  setPerson({ mesh }, u - .6 + i * 1.2, v, i * 3 + 1); scene.add(mesh); parkPeople.push({ mesh, kind: 'still', sitting: true });
}
// What a person on the lawn must keep out of: the trunks, the lamps, the benches, the fountain, the kiosk and the pond with its rim.
const parkObstacles = [
  ...treeSpots.map(([x, z, size]) => [x, z, .3 * size + .35]),
  ...lampSpots.map(([x, z]) => [x, z, .45]),
  ...seats.map((seat) => [seat.x, seat.z, .95]),
  [...inPark(0, 0), 4.9],
  ...playObstacles().map(([u, v, r]) => [...inPark(ZONES.play.u + u, ZONES.play.v + v), r]), // the feet of the swing set, the posts and the chute of the slide
];
// How much room a person takes up, for walking round each other: a cyclist is wider than a walker.
const personRadius = (p) => (p.cycle ? .45 : .28);
// Who would a step of `self` to (u, v) take it into, if anyone? Only a step that brings it closer to a person it is too close to counts, so two who overlap (a pair who came in through the same gate) can walk apart.
function inTheWay(self, u, v) {
  for (const o of parkPeople) {
    if (o === self || !(o.shown > 0) || o.u === undefined || o.sitting) continue;
    const near = Math.hypot(o.u - u, o.v - v);
    if (near < personRadius(self) + personRadius(o) + .08 && near < Math.hypot(o.u - self.u, o.v - self.v) - 1e-4) return o;
  }
  return null;
}
function parkBlocked(u, v, r = .3, self = null) { // is the spot (park metres) inside something, or on someone?
  const [x, z] = inPark(u, v);
  for (const [ox, oz, or] of parkObstacles) if (Math.hypot(x - ox, z - oz) < or + r) return true;
  const { pond, kiosk } = ZONES;
  if (((u - pond.u) / (pond.rx + 1 + r)) ** 2 + ((v - pond.v) / (pond.rz + 1 + r)) ** 2 < 1) return true;
  if (Math.abs(u - kiosk.u) < kiosk.hx + .6 + r && Math.abs(v - kiosk.v) < kiosk.hz + .6 + r) return true;
  for (const o of parkPeople) {
    if (o === self || !(o.shown > 0) || o.u === undefined || o.sitting) continue;
    const near = Math.hypot(o.u - u, o.v - v);
    if (near < .5 + r && !(self && self.u !== undefined && near >= Math.hypot(o.u - self.u, o.v - self.v))) return true; // two who are already too close may walk apart: only a step closer is refused
  }
  return false;
}
const wanderIn = (zone) => { // a spot in the zone that is free
  for (let tries = 0; tries < 40; tries += 1) {
    const spot = { u: zone.u + (rand() * 2 - 1) * (zone.hx - 1), v: zone.v + (rand() * 2 - 1) * (zone.hz - 1) };
    if (!parkBlocked(spot.u, spot.v, .5)) return spot;
  }
  return { u: zone.u, v: zone.v };
};
for (const [zone, count, scale, speed] of [[ZONES.play, 5, .68, 1.3], [ZONES.court, 4, 1, 2.2]]) for (let i = 0; i < count; i += 1) { // kids on the sand, players on the court
  const home = wanderIn(zone), person = { mesh: buildPedestrian(500 + i + zone.u, scale), kind: 'wander', zone, u: home.u, v: home.v, target: wanderIn(zone), speed: speed * (.7 + rand() * .6), wait: 0, heading: 0 };
  addPerson(person);
}
for (let i = 0; i < 4; i += 1) { const dir = i % 2 ? 1 : -1; addPerson({ mesh: buildCyclist(600 + i), kind: 'ring', dir, at: ringPlace('cycle', dir), speed: RING_LANES.cycle[1], jog: false, cycle: true, lateral: RING_LANES.cycle[0] }); }
for (let i = 0; i < 3; i += 1) { // kids running about on the lawn
  const zone = { u: 0, v: 0, hx: PARK_SIZE / 2 - 8, hz: PARK_SIZE / 2 - 8 }, home = wanderIn(zone);
  addPerson({ mesh: buildPedestrian(640 + i, .7), kind: 'wander', zone, u: home.u, v: home.v, target: wanderIn(zone), speed: 2.6, wait: 0, heading: 0, run: true });
}
for (let i = 0; i < 3; i += 1) { // dogs off the lead, with an owner standing near, on the lawn inside the ring path and clear of the court
  const zone = { u: -6 + i * 14, v: 30.5, hx: 7, hz: 2.4 }, home = wanderIn(zone), dog = buildDog(660 + i);
  addPerson({ mesh: dog.mesh, dog, kind: 'wander', zone, u: home.u, v: home.v, target: wanderIn(zone), speed: 3.2, wait: 0, heading: 0, run: true });
}
// ---- people moving between the footpath and the park, by two gates: A on the footpath of crossing 3 (the one along the park's south edge) and B on crossing 2's ----
const LAWN = { u: 0, v: 0, hx: PARK_SIZE / 2 - 8, hz: PARK_SIZE / 2 - 8 }, HALF_PARK = PARK_SIZE / 2;
// Gates A and B open on the footpaths of the two crossings. C and D open on the side streets along the park's far edges, where the people come and go on foot from out of sight.
const gateInside = (gate) => (gate === 'A' ? { u: 0, v: -HALF_PARK + 1 } : gate === 'B' ? { u: -HALF_PARK + 1, v: 0 } : gate === 'C' ? { u: HALF_PARK - 1, v: 0 } : { u: 0, v: HALF_PARK - 1 }); // just inside the gate, in park metres
const SIDE_WALK = 1.4; // metres outside the park edge, on the side street's footpath
const parkShare = () => Math.min(1, parkFactor(sim.controller.clockStart + sim.snapshot.time) / .8 * fairWeather());
const visitorCount = () => parkPeople.reduce((n, o) => n + (o.visitor ? 1 : 0), 0);
function gateFor(p) { // the gate this pedestrian is level with, going the way that passes it, or null
  const pose = p.pose || pedestrianPose(p);
  if (p.crossing === 3 && ((p.dir === 1 && p.state === 'approaching') || (p.dir === -1 && p.state === 'leaving')) && Math.abs(pose.x - PARK_C[0]) < .6) return 'A';
  if (p.crossing === 2 && ((p.dir === -1 && p.state === 'approaching') || (p.dir === 1 && p.state === 'leaving')) && Math.abs(pose.z - PARK_C[1]) < .6) return 'B';
  return null;
}
function enterPark(mesh, gate) {
  const at = gateInside(gate), age = 0;
  scene.add(mesh);
  addPerson({ mesh, kind: 'wander', visitor: true, gate, zone: LAWN, u: at.u, v: at.v, target: wanderIn(LAWN), speed: 1.15 + rand() * .3, wait: 0, heading: gate === 'A' ? Math.PI / 2 : 0, age, stay: 30 + rand() * 110, rank: -1, shown: 1 });
}
let transitCount = 0;
const arrived = []; // people who reached the end of their route this frame
const toStreet = []; // visitors who reached a gate on their way out, handled after the park loop
function leavePark(p) { // a visitor at a gate becomes someone walking to the kerb of the crossing there, or out along a side street
  if (p.gate === 'C' || p.gate === 'D') {
    const out = gateInside(p.gate), along = rand() < .5 ? 1 : -1, east = p.gate === 'C';
    const route = east ? [{ u: HALF_PARK + SIDE_WALK, v: 0 }, { u: HALF_PARK + SIDE_WALK, v: along * 220 }] : [{ u: 0, v: HALF_PARK + SIDE_WALK }, { u: along * 220, v: HALF_PARK + SIDE_WALK }];
    const i = parkPeople.indexOf(p); if (i >= 0) parkPeople.splice(i, 1);
    parkPeople.push({ mesh: p.mesh, kind: 'transit', route, speed: p.speed, then: 'gone', u: out.u, v: out.v, heading: 0, rank: -1, shown: 1, role: null });
    return;
  }
  const crossing = p.gate === 'A' ? 3 : 2, dir = p.gate === 'A' ? 1 : -1;
  const kerb = pedestrianPose({ id: 0, crossing, dir, state: 'waiting', toKerb: 0, progress: 0, away: 0 });
  const ped = sim.adoptPedestrian(crossing, dir, Math.max(1, p.gate === 'A' ? PARK_C[0] - kerb.x : PARK_C[1] - kerb.z));
  const pose = pedestrianPose(ped); peds.set(ped.id, { mesh: p.mesh, prev: pose, curr: pose });
  const i = parkPeople.indexOf(p); if (i >= 0) parkPeople.splice(i, 1);
}
// Who is in the park depends on the hour as well as the crowd: children play after school and at weekends, the court is used in the afternoon and evening, runners,
// cyclists and dog walkers come at the cool ends of the day, and the kiosk serves in daylight. Anyone with no role (the strollers, the sitters) is there whenever the park is busy.
function parkRole(p) {
  if (p.visitor) return null;
  if (p.zone === ZONES.play || p.errand || p.act || (p.run && !p.dog && p.zone && p.zone.hx > 30)) return 'kids';
  if (p.zone === ZONES.court) return 'court';
  if (p.cycle || p.jog) return 'fit';
  if (p.dog) return 'dog';
  if (p.u !== undefined && Math.abs(p.u - ZONES.kiosk.u) < 6 && Math.abs(p.v - ZONES.kiosk.v) < 8) return 'kiosk';
  return null;
}
function parkWindow(role, h, weekend) {
  switch (role) {
    case 'kids': return weekend ? h >= 8 && h < 18 : h >= 15 && h < 18.5;
    case 'court': return weekend ? h >= 8 && h < 20 : h >= 16 && h < 21;
    case 'fit': return (h >= 5.5 && h < 9.5) || (h >= 16.5 && h < 19.5);
    case 'dog': return (h >= 6 && h < 9.5) || (h >= 16.5 && h < 20);
    case 'kiosk': return h >= 7 && h < 18;
    default: return true;
  }
}
// The park fills and empties with the clock. Each person has a fixed rank, and is there while the rank is under the share of the park's busiest time that the
// hour calls for. They shrink away and grow back over about a second, and a hidden one is neither updated nor in anyone's way.
// ---- children on the swings and the slide (playground-life.js decides; these put the child's model where it says) ----
const swingSeatWorld = new THREE.Vector3(), swingTilt = new THREE.Euler();
function startErrand(p) { // a child on the sand sets out for a swing or the slide
  const e = playLife.errand();
  if (!e) return;
  p.errand = e; p.target = { u: ZONES.play.u + e.target.u, v: ZONES.play.v + e.target.v }; p.wait = 0;
}
function cancelErrand(p) { if (p.errand) { playLife.release(p.errand); p.errand = null; } }
function beginPlay(p) { // at the foot of the piece: the turn begins, from exactly where the errand ends
  p.u = p.target.u; p.v = p.target.v;
  p.act = playLife.begin(p.errand); p.errand = null; p.kind = 'play'; p.playT = 0; p.headFrom = Math.atan2(Math.sin(p.heading || 0), Math.cos(p.heading || 0));
  p.mesh.rotation.order = 'YZX'; // a pitch (about the child's own side-to-side axis) is turned first, then the heading
}
function applyPlayPose(p, pose, time) {
  const [gx, gz] = inPark(ZONES.play.u + pose.u, ZONES.play.v + pose.v), e = Math.min(1, p.playT / .6), heading = p.headFrom * (1 - e * e * (3 - 2 * e)) + pose.heading * e * e * (3 - 2 * e);
  let x = gx, y = pose.y, z = gz, tilt = pose.pitch;
  if (pose.swing !== null && pose.swing !== undefined) { // between where the child stands and the seat, and on the seat as the swing hangs now
    const sw = swingSet.swings[pose.swing], angle = playLife.swingAngle(pose.swing);
    sw.pivot.rotation.z = angle; sw.pivot.updateMatrixWorld(true); swingSeatWorld.copy(sw.seat); sw.pivot.localToWorld(swingSeatWorld);
    const b = pose.blend; x = gx + (swingSeatWorld.x - gx) * b; z = gz + (swingSeatWorld.z - gz) * b; y = swingSeatWorld.y * b + .22 * Math.sin(Math.PI * b); tilt = angle * b;
  }
  p.mesh.position.set(x, y, z); p.mesh.rotation.set(0, -heading, tilt);
  const u = p.mesh.userData;
  if (pose.mode === 'sit') { if (!u.sitting) poseSitting(p.mesh, 0); if (pose.kick) { const knee = -(Math.PI / 2 - .55 * pose.kick); u.kneeL.rotation.z = u.kneeR.rotation.z = knee; } }
  else { if (u.sitting) standUp(p.mesh); animateWalker(p.mesh, time, pose.moving); }
  const at = pose.swing !== null && pose.swing !== undefined ? { u: ZONES.play.u + SWING_AT.u, v: ZONES.play.v + pose.v } : { u: ZONES.play.u + pose.u, v: ZONES.play.v + pose.v };
  p.u = at.u; p.v = at.v; p.heading = heading;
}
function endPlay(p) { // back on the sand, on their feet, where they stepped off
  playLife.release(p.act); p.act = null; p.kind = 'wander'; p.zone = ZONES.play;
  if (p.mesh.userData.sitting) standUp(p.mesh);
  p.mesh.position.y = 0; p.mesh.rotation.set(0, -(p.heading || 0), 0);
  p.target = wanderIn(ZONES.play); p.wait = 1 + rand() * 2; p.playAfter = playClock + 20 + rand() * 30;
}
function abortPlay(p) { // the park is closing for the children: whatever they were doing is let go
  const last = p.act; playLife.release(last); p.act = null; p.kind = 'wander'; p.zone = ZONES.play;
  if (p.mesh.userData.sitting) standUp(p.mesh);
  p.mesh.position.y = 0; p.mesh.rotation.set(0, -(p.heading || 0), 0); p.target = { u: p.u, v: p.v };
}
let playClock = 0;
function updatePark(time, dt) {
  playClock += dt; playLife.update(dt); for (const [i, sw] of swingSet.swings.entries()) sw.pivot.rotation.z = playLife.swingAngle(i); // a swing moves only while a child is on it
  const week = sim.controller.clockStart + sim.snapshot.time, hour = (week % 86400) / 3600, weekend = Math.floor((week % 604800) / 86400) > 4;
  const share = Math.min(1, parkFactor(week) / .8 * fairWeather());
  if (rand() < dt * share * .04 && visitorCount() < 30) { // someone walks up a side street footpath and in at gate C or D
    const east = rand() < .5, along = rand() < .5 ? 1 : -1, g = east ? 'C' : 'D', inside = gateInside(g), mesh = buildPedestrian(1000 + (transitCount += 1), 1, rand() < .3);
    const start = east ? { u: HALF_PARK + SIDE_WALK, v: along * 200 } : { u: along * 200, v: HALF_PARK + SIDE_WALK };
    scene.add(mesh); parkPeople.push({ mesh, kind: 'transit', visitor: true, gate: g, route: [east ? { u: HALF_PARK + SIDE_WALK, v: 0 } : { u: 0, v: HALF_PARK + SIDE_WALK }, inside], speed: 1.15 + rand() * .3, then: 'enter', u: start.u, v: start.v, heading: 0, rank: -1, shown: 1, role: null });
  }
  for (const [i, p] of parkPeople.entries()) {
    if (p.rank === undefined) { p.rank = ((Math.imul(i + 1, 2654435761) >>> 0) % 1000) / 1000; p.shown = 1; }
    if (p.role === undefined) p.role = parkRole(p);
    const want = p.rank < share && parkWindow(p.role, hour, weekend) ? 1 : 0;
    p.shown += Math.max(-1, Math.min(1, (want - p.shown) * 3)) * Math.min(1, dt * 1.2) ; p.shown = Math.max(0, Math.min(1, p.shown));
    if (want === 1 && p.shown > .995) p.shown = 1; if (want === 0 && p.shown < .005) p.shown = 0;
    if (want === 0 && p.shown < .3) { if (p.kind === 'play') abortPlay(p); else cancelErrand(p); }
    p.mesh.visible = p.shown > 0; p.mesh.scale.setScalar(Math.max(p.shown, .001));
    if (p.shown === 0) continue;
    if (p.kind === 'ring') {
      const step = p.speed * dt, nextAt = ringAt(p.at + p.dir * step, p.dir * (p.lateral + (p.swerve || 0))), blocker = inTheWay(p, nextAt.u, nextAt.v);
      p.waited = blocker ? (p.waited || 0) + dt : 0;
      if (!blocker) p.at += p.dir * step; // a walker gives way to anyone it would walk into, and the ones behind it give way in turn
      if (p.waited > 1.2) { // held up for a moment: step out round whatever is there, to the side it is not on, hold that while passing it, and come back after
        const c = ringAt(p.at, 0), own = p.dir * p.lateral, theirs = (blocker.u - c.u) * -Math.sin(c.heading) + (blocker.v - c.v) * Math.cos(c.heading);
        p.swerveTo = p.dir * (theirs > own ? own - .9 : own + .9) - p.lateral; p.passing = 1.8;
      } else if (p.passing > 0) p.passing -= dt;
      p.swerve = (p.swerve || 0) + ((p.passing > 0 ? p.swerveTo : 0) - (p.swerve || 0)) * Math.min(1, dt * 2);
      const at = ringAt(p.at, p.dir * (p.lateral + p.swerve)), heading = at.heading + (p.dir < 0 ? Math.PI : 0);
      p.u = at.u; p.v = at.v; setPerson(p, at.u, at.v, heading); if (p.cycle) animateCyclist(p.mesh, time, 2); else animateWalker(p.mesh, time, p.jog ? 2 : 1);
    } else if (p.kind === 'wander') {
      const idle = (moving) => (p.dog ? p.dog.update(time, moving) : animateWalker(p.mesh, time, moving));
      if (p.visitor) { // a visitor wanders for a while, then heads for a gate, and sooner if the park is closing
        p.age += dt;
        if (!p.leaving && (p.age > p.stay || share < .06)) { p.leaving = true; p.gate = ['A', 'B', 'C', 'D'][Math.floor(rand() * 4)]; const at = gateInside(p.gate); p.target = { u: at.u, v: at.v }; p.wait = 0; }
      }
      if (p.wait > 0) { p.wait -= dt; idle(0); continue; }
      const dx = p.target.u - p.u, dz = p.target.v - p.v, dist = Math.hypot(dx, dz);
      if (p.leaving && dist < 1.2) { toStreet.push(p); continue; }
      if (p.errand) { if (dist < Math.max(.08, p.speed * dt * 1.1)) { beginPlay(p); continue; } } // at the foot of the swing or the slide
      else if (dist < .4) {
        p.target = wanderIn(p.zone); p.wait = rand() * 3;
        if (p.zone === ZONES.play && !p.visitor && p.shown === 1 && playClock > (p.playAfter || 0) && rand() < .3) startErrand(p); // now and then, off to a swing or the slide
        continue;
      }
      // Steer round whatever is in the way: try straight on, then a little to either side, then further.
      const want = Math.atan2(dz, dx), step = p.speed * dt;
      let moved = false;
      for (const turn of [0, .5, -.5, 1, -1, 1.6, -1.6]) {
        const heading = want + turn, nu = p.u + Math.cos(heading) * step, nv = p.v + Math.sin(heading) * step;
        if (parkBlocked(nu, nv, .3, p)) continue;
        p.u = nu; p.v = nv; p.heading = heading; p.stuck = 0; moved = true;
        break;
      }
      if (!moved) { p.stuck = (p.stuck || 0) + dt; if (p.stuck > .8) { cancelErrand(p); p.target = wanderIn(p.zone); p.stuck = 0; } idle(0); continue; } // hemmed in: wait, then pick somewhere else
      setPerson(p, p.u, p.v, p.heading); idle(p.run ? 1.6 : 1);
    } else if (p.kind === 'transit') { // walks a list of waypoints, then goes into the park or away out of sight
      const to = p.route[0], dx = to.u - p.u, dz = to.v - p.v, dist = Math.hypot(dx, dz), step = p.speed * dt;
      if (dist <= step) { p.u = to.u; p.v = to.v; p.route.shift(); if (!p.route.length) arrived.push(p); } else {
        const ahead = inTheWay(p, p.u + dx / dist * step, p.v + dz / dist * step); // someone ahead on the footpath: wait a moment, then step out to the left round them
        p.waited = ahead ? (p.waited || 0) + dt : 0;
        if (!ahead) { p.u += dx / dist * step; p.v += dz / dist * step; } else if (p.waited > .8) { p.u -= dz / dist * step; p.v += dx / dist * step; }
        p.heading = Math.atan2(dz, dx);
      }
      setPerson(p, p.u, p.v, p.heading); animateWalker(p.mesh, time, 1);
    } else if (p.kind === 'play') { // on a swing or the slide
      p.playT += dt; applyPlayPose(p, playLife.step(p.act, dt), time);
      if (p.act.done) endPlay(p);
    } else if (p.kind === 'still') animateWalker(p.mesh, time, 0);
  }
  for (const p of arrived.splice(0)) {
    if (p.then === 'gone') { scene.remove(p.mesh); releaseModel(p.mesh); const i = parkPeople.indexOf(p); if (i >= 0) parkPeople.splice(i, 1); } // out of sight along the street
    else { p.kind = 'wander'; p.zone = LAWN; p.target = wanderIn(LAWN); p.wait = 0; p.age = 0; p.stay = 30 + rand() * 110; p.leaving = false; delete p.route; delete p.then; } // in through the gate, and into the park
  }
  while (toStreet.length) leavePark(toStreet.pop());
}

// ---------- day and night ----------
let night = 0, lastStageKey = '';
// The pavement and its colour in daylight (the paths have a picture, so they are white and the picture gives the colour), and the one colour it has at night. The colour is the footpath at the junction
// corners, measured in a screenshot at night: about rgb(98, 94, 88).
const SMOOTH = (lo, hi, v) => { const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo))); return t * t * (3 - 2 * t); };
const PEOPLE_NIGHT = .42, STREET_NIGHT = .9, PARK_NIGHT = .14, PAVING_SHADOW_LOSS = 1, NIGHT_TINT = new THREE.Color(), PAVING_NIGHT = new THREE.Color().setRGB(98 / 255, 94 / 255, 88 / 255, THREE.SRGBColorSpace);
const PAVING = [[kerbMat, KERB_BASE.clone()], [base.material, BASE_COLOUR.clone()], [pathMat, new THREE.Color(1, 1, 1)]];
for (const [m] of PAVING) keepShadeColour(m); // the shade on the pavement keeps its colour too
function applyLight() {
  const n = night, l = lastSky ? lastSky.lights : night; // `l` is how much of the lighting up is on: it also comes on at dusk and when rain or cloud makes the day dark
  renderer.toneMappingExposure = 1.05 - .1 * n;
  const clock = ((sim.controller.clockStart + sim.snapshot.time) % 86400) / 3600, up = clock < 12 ? clock + 24 : clock; // hours counted from noon, so the small hours are one run: 23 to 30
  const lit = up < 24 ? 1 : up < 25 ? 1 - .55 * (up - 24) : up < 29 ? .45 : up < 30.5 ? .45 + .55 * (up - 29) / 1.5 : 1; // most people are asleep between 1 and 5, so the windows are dimmer then, and come back as the day starts
  for (const b of buildings) b.material.emissiveIntensity = 1.6 * l * (clock < 12 || clock >= 23 ? lit : 1);
  beacons.visible = roofLamps.visible = l > .35; beaconMat.color.setRGB(Math.floor(performance.now() / 900) % 2 ? 1 : .25, .05, .05); // the red ones blink
  for (const lamp of lampLights) lamp.material.emissiveIntensity = 3 * l;
  // The street light on the road makes up for the daylight that is missing. `light` is the daylight reaching the road, from the sun and the sky together, and `need` is how much of it is gone,
  // so the road goes from its day brightness to its night brightness one step at a time and never dips between the sun and the lamps.
  const light = sun.intensity * (sun.position.y / sun.position.length()) + .41 * hemi.intensity, gone = Math.min(1, Math.max(0, (ROAD_LIT - light) / (ROAD_LIT - ROAD_DARK))), need = gone * gone * (3 - 2 * gone);
  // linear in the missing light, so the road brightness changes steadily and never dips on the way
  for (const m of lampPoolMats) m.opacity = WASH_LEVEL * gone;
  lampBloomMat.opacity = 1 * l;
  // The sky leans blue in the dusk and at night, and the road and the lane would follow it. Each is given back what the blue takes, so they keep their day colours while they dim.
  // What the light looks like on the road: the sky and the sun mixed by how much each gives. The road and the lane are given back what it differs from the light at noon, so a blue dusk or a red sunset does not turn them navy or orange.
  const sunPart = sun.intensity * (sun.position.y / sun.position.length()), skyPart = .41 * hemi.intensity;
  const colour = lightColour(hemi.color.toArray(), hemi.intensity, sun.color.toArray(), sunPart * SUN_SHARE);
  const giveBack = (target) => [target[0] * colour[1] / (target[1] * colour[0]), 1, target[2] * colour[1] / (target[1] * colour[2])];
  { // the shade of a road takes the colour of the whole light on it
    const H = hemi.color.toArray().map((v) => v * hemi.intensity), S = sun.color.toArray().map((v) => v * sun.intensity * Math.max(0, sun.position.y / sun.position.length()));
    const T = H.map((h, i) => (h + S[i]) / (H[0] + S[0] + H[1] + S[1] + H[2] + S[2]) / (h / (H[0] + H[1] + H[2]))); // the colour of the whole light over the colour of the sky's, both as shares
    indirectTint.value.set(T[0], T[1], T[2]);
  }
  const tint = giveBack(NOON_LIGHT); // the lane keeps the colour it has at noon
  const roadTint = giveBack(NOON_LIGHT.map((v, i) => v * (1 - gone) + gone * LED_WHITE[i])); // the road goes from the colour of the day to the white of the street lights
  // Dark red looks more saturated than the same red in full light, so the lane gets some green back as the light fades (measured against its day colour at six hours of the evening).
  const brightness = Math.min(1, Math.max(.2, (21.6 * light + 26 * need * 1.22) / 66)), green = 1 + 1.2 * (1 - brightness);
  for (const m of busDecals) { m.emissiveIntensity = LANE_LIGHT * need; m.color.setRGB(tint[0], green, tint[2]); m.emissive.setRGB(1, green, 1); }
  // Half way between the day and the lamps the sky is all that lights the road, and it is bluer than the mix above allows for (measured at the dusk and the dawn), so the road gets a little more of it back.
  const late = Math.min(1, Math.max(0, (gone - .8) / .2)), dusk = .23 * gone * (1 - late * late * (3 - 2 * late));
  for (const m of wetMaterials) if (!busDecals.includes(m)) m.color.setRGB(roadTint[0] * (1 + dusk), 1, roadTint[2] * (1 - 1.1 * dusk));
  // The pavement (the footpath slabs, the ground between the buildings and the park paths) is one colour at night, everywhere and from every side: the grey of the footpath at the junction corners, where
  // the street light falls on it. Its night level is a light that nothing shades, so the light from the lamps, the moon and the view turn it neither lighter nor darker from place to place, and only a twentieth
  // of the ordinary lighting stays on it (the moonlit footpath is bright, so more would leave a step where a building's shadow starts), so a shadow shows only faintly. The roads are not touched.
  // The side streets at night: a steady light of their own on the asphalt (the picture they are painted from, as a light that nothing shades), in step with the main road's night light (`gone`), at the level the
// main roads have under their lamps. Without it they had no light at all and were black.
for (const m of [streetMat, mouthMat, ...venues.map((v) => v.lotMat)]) { m.emissive.setScalar(1); m.emissiveMap = m.userData.grey; m.emissiveIntensity = STREET_NIGHT * gone; }
{ // the name over the door is lit at night while the place is open: the restaurant is dark from 11 pm to 6 am, and the office keeps a dim light on all night
  const hour = ((sim.controller.clockStart + sim.snapshot.time) % 86400) / 3600, open = hour >= 6 && hour < 23;
  for (const v of venues) v.group.userData.nameMaterial.emissiveIntensity = need * (v.kind === 'restaurant' ? (open ? .9 : 0) : (hour >= 6 && hour < 20 ? .9 : .35));
}
  // The park at night. Its lawn, court, playground and pond bed were lit by nothing but the sky, so they were nearly black beside the lit paths. They are given a steady light of their own (the picture they are painted
// from, at PARK_NIGHT of its daylight brightness, added as a light that nothing shades), so every part of the park can be seen in its own colour, and the shadows of trees and the pools of the lamps still show on it.
for (const h of hubs) { h.zone.emissive.set(0x3f8f58); h.zone.emissiveIntensity = .3 * need; h.lines.emissive.set(0xf2f2ee); h.lines.emissiveIntensity = .3 * need; } // the hub's paint holds some colour at night, like the paving
for (const l2 of lawnMats) { l2.emissive.copy(l2.color); l2.emissiveIntensity = .14 * need; } // the courtyard lawns, lit by a light of their own like the park's
parkGround.material.emissive.setScalar(1); parkGround.material.emissiveMap = parkGround.material.map; parkGround.material.emissiveIntensity = PARK_NIGHT * need;
  // How much of the pavement's night look it has follows how bright the sky is (`look`, from sky.js), the same as the buildings and the ground, so it goes from its day look to its night look in step with them: lit like everything
  // else while the sky is bright, and the one flat colour only once the sky is dark. Before, it followed the road's need for lamps, which is full already with the sun well up, so the pavement was grey in the late afternoon
  // beside buildings that were still in daylight. Full night comes a little before the sky is dark, so the pavement has none of the ordinary lighting left in it (a leftover share is shaded differently on a slab and on the ground, which showed as a strip).
  const pn = 1 - SMOOTH(.36, .75, lastSky ? lastSky.look : 0);
  const dim = 1 - PAVING_SHADOW_LOSS * pn;
  for (const [m, day] of PAVING) { m.color.copy(day).multiply(NIGHT_TINT.set(...roadTint)).multiplyScalar(dim); m.emissive.copy(PAVING_NIGHT).multiplyScalar(pn); }
  // under the street lights a vehicle is plainly visible, in its own colours, so its paint is lifted at night (a glossy one also loses some of the metal that would reflect the dark sky)
  GLOSS.color.setScalar(1 + 1.3 * l); MATTE.color.setScalar(1 + 1.3 * l); GLOSS.metalness = .35 - .25 * l;
  headMat.emissiveIntensity = .3 + 3.2 * l;
  lampFront.emissiveIntensity = .3 + 3.2 * l; lampRear.emissiveIntensity = .25 + 1.8 * l; // the lamps of the bikes and scooters
  nightGlow.value = PEOPLE_NIGHT * need; // a faint light on people, riders and dogs that nothing shades, so they read against the road at night
  beamMat.opacity = .6 * l; // the cones of light the headlights throw on the road
}

// ---------- interface ----------
// The page around the scene is in src/page/shell.js. It gets these hooks, and the scene calls its update a few times a second.
let lookLock = null; // null follows the clock, 1 is locked to night and 0 to day
let topView = false;
const oneOf = (list) => list[Math.floor(Math.random() * list.length)];
function clockText() {
  const t = Math.floor(sim.controller.clockStart + sim.snapshot.time) % 86400;
  return `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}`;
}
// ---- the view through a detection camera ----
const cameraList = [...cameraPoints].sort((p, q) => p.approach - q.approach || p.along - q.along); // each road's near camera first
const cameraMeta = cameraList.map((p, i) => { // what the camera panel says about each one: the pair on a road is a near and a far camera
  const near = i % 2 === 0, half = CAMERA_RIG.detectionZone / 2;
  return { approach: p.approach, road: roadName(p.approach), which: near ? 'near' : 'far', along: p.along, mount: p.kind, height: p.kind === 'building' ? CAM_H : POLE_HEIGHT, lens: CAMERA_HFOV / RAD, covers: near ? [0, half] : [half, CAMERA_RIG.detectionZone] };
});
const rigShares = CAMERA_RIG.detectionCurve.map((c) => c[1]);
const hitProxies = cameraList.map((p, index) => { // an invisible ball round each camera, so a click or a tap does not need a perfect aim at a 40 cm camera
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1.8, 8, 6), new THREE.MeshBasicMaterial({ visible: false })); ball.userData.index = index; p.obj.add(ball); return ball;
});
let pipPoint = null;
// The near plane is 1 m so the picture starts beyond the camera's own body. At .3 m the front edge of its sun shield, a half pipe over the lens, was in the picture as a dark arc.
const pipCamera = new THREE.PerspectiveCamera(60, 16 / 9, 1, 2400), pipSize = new THREE.Vector2(), pipBox = new THREE.Box2();
function aimCamera(point, aspect) { // the lens of a detection camera, at the shape of the picture it is drawn in
  point.obj.getWorldPosition(pipCamera.position); point.obj.getWorldQuaternion(pipCamera.quaternion);
  pipCamera.aspect = aspect; pipCamera.fov = 2 * Math.atan(Math.tan(CAMERA_HFOV / 2) / aspect) / RAD; pipCamera.updateProjectionMatrix();
  pipCamera.updateMatrixWorld(true); pipCamera.matrixWorldInverse.copy(pipCamera.matrixWorld).invert();
}
// The vehicles the camera counts: on its road inside the zone, in frame and at least 30 pixels wide on a 4K sensor, as in tools/detectability.mjs. Hiding by other vehicles is not drawn.
function countedBy(point) {
  const boxes = [], corner = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (const t of tracks.vehicles.values()) {
    const v = t.vehicle;
    if (!t.mesh || v.approach !== point.approach || !(v.d > 0 && v.d <= CAMERA_RIG.detectionZone)) continue;
    const c = CLASSES[t.cls], h = VEHICLE_HEIGHT[t.cls] ?? 2; pipBox.makeEmpty(); let ahead = true;
    for (const a of [-c.length / 2, c.length / 2]) for (const b of [-c.width / 2, c.width / 2]) for (const yy of [0, h]) {
      corner.set(a, yy, b).applyAxisAngle(up, t.mesh.rotation.y).add(t.mesh.position).project(pipCamera);
      if (corner.z > 1) ahead = false; else pipBox.expandByPoint(pipSize.set(corner.x, corner.y));
    }
    if (!ahead || pipBox.isEmpty()) continue;
    const cx = (pipBox.min.x + pipBox.max.x) / 2, cy = (pipBox.min.y + pipBox.max.y) / 2, width = (pipBox.max.x - pipBox.min.x) / 2;
    if (Math.abs(cx) > 1 || Math.abs(cy) > 1 || width * 3840 < 30) continue;
    boxes.push({ x0: (pipBox.min.x + 1) / 2, x1: (pipBox.max.x + 1) / 2, y0: (1 - pipBox.max.y) / 2, y1: (1 - pipBox.min.y) / 2, label: t.cls, lane: v.lane, kind: KIND_OF[t.cls] || 'cars', stopped: v.v < 1 });
  }
  return boxes;
}
const KIND_OF = { car: 'cars', van: 'cars', truck: 'trucks', semi: 'trucks', bus: 'buses', artbus: 'buses', bike: 'bikes', scooter: 'bikes', amb: 'emergency', fire: 'emergency', police: 'emergency' };
// What each camera counts right now, for the camera panel: the total, how many are stopped, the count in each lane (the kerb lane, the middle lane, the right-turn lane) and by kind of vehicle.
const cameraCounts = () => cameraList.map((p) => {
  aimCamera(p, 16 / 9);
  const seen = countedBy(p), lanes = [0, 0, 0], kinds = { cars: 0, trucks: 0, buses: 0, bikes: 0, emergency: 0 };
  for (const b of seen) { lanes[b.lane] += 1; kinds[b.kind] += 1; }
  return { total: seen.length, stopped: seen.filter((b) => b.stopped).length, lanes, kinds };
});
// The picture from the chosen camera is drawn into a corner of the main canvas, copied into the canvas in the Cameras panel, and then the main view is drawn over that corner, so it is never seen.
function drawCameraView() {
  const view = shell.cameraView;
  if (!view || !view.active || !pipPoint || !view.prepare()) return;
  const target = view.canvas, pixelRatio = renderer.getPixelRatio(), w = target.width / pixelRatio, h = target.height / pixelRatio;
  aimCamera(pipPoint, target.width / target.height);
  renderer.setScissorTest(true); renderer.setViewport(0, 0, w, h); renderer.setScissor(0, 0, w, h);
  skyDome.follow(pipCamera.position); renderer.render(scene, pipCamera);
  renderer.setScissorTest(false); renderer.setViewport(0, 0, innerWidth, innerHeight);
  const source = renderer.domElement; // the corner is at the bottom left of the drawing buffer
  view.ctx.drawImage(source, 0, source.height - target.height, target.width, target.height, 0, 0, target.width, target.height);
  view.draw(countedBy(pipPoint));
}
// A picture from detection camera `index` with its training labels (see src/detection/labels.js and docs/detector.md), for making the training set from the browser. The camera is responsible for a stretch of its
// road (rigSegments: halfway to the next camera, 80 m at the far end), so the picture is cropped to that stretch of the road plus a margin, and a label is given to every vehicle that is in the crop. Where two cameras
// overlap, a vehicle is in both crops, so each label says whether this camera OWNS the place the vehicle stands (the one that counts it). Drawn the way the camera panel draws it, at the size of the window; the crop is
// cut from that and scaled to at most `outWidth` pixels across. Nothing on the page calls it.
// Points on a vehicle's drawn model, in the world (flat x y z), every few vertices of its solid parts: so a label's box fits the shape that is drawn. The light cones and glows, which are not part of the vehicle, are left out.
function modelPoints(mesh, every = 7) {
  mesh.updateWorldMatrix(true, true); const out = [], p = new THREE.Vector3();
  mesh.traverse((o) => {
    if (!o.isMesh || o.userData.beam || (o.material && (o.material.transparent || o.material.blending === THREE.AdditiveBlending))) return;
    for (let q = o.parent; q; q = q.parent) if (q.userData && q.userData.material && q.userData.want !== undefined) return; // the headlight glow on a vehicle's rear
    const a = o.geometry.attributes.position; for (let i = 0; i < a.count; i += every) { p.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld); out.push(p.x, p.y, p.z); }
  });
  return out;
}
const RIG_MARGIN = 8, CROP_LATERAL = [-.5, H + .5], MASK_GREY = '#707070'; // metres of road kept beyond the owned stretch, across the lanes, and the grey outside them // metres of road kept beyond the owned stretch, and across the lanes
const rigSegmentsOf = (approach) => rigSegments(cameraList.filter((p) => p.approach === approach).map((p) => p.along).sort((p, q) => p - q), CAMERA_RIG.detectionZone, RIG_MARGIN);
// The picture one detection camera sees of the road it owns, as the detector is given it: the crop of that stretch (rigSegments), scaled to at most `outWidth` across, with everything outside the lanes of the road painted
// flat grey. Drawn the way the camera panel draws it, at the size of the window, into the corner of the drawing buffer, so it has to be called before the frame is drawn (the frame draws over it). Returns the picture
// as a canvas with what is needed to put a detection on the road, or null when the stretch is not in front of the lens.
function cameraPicture(index, { outWidth = 960, crop = true } = {}) {
  const point = cameraList[index]; if (!point) throw new Error(`no camera ${index}`);
  const source = renderer.domElement, ratio = renderer.getPixelRatio(), w = Math.floor(source.width / ratio), h = Math.floor(source.height / ratio);
  const k = point.approach - 1, toWorld = (d, lateral) => rot(k, lateral, YS - d); // a place on this road: how far from the stop line, how far across its lanes
  const ordered = cameraList.filter((p) => p.approach === point.approach).map((p) => p.along).sort((p, q) => p - q), segment = rigSegmentsOf(point.approach)[ordered.indexOf(point.along)];
  aimCamera(point, w / h);
  renderer.setScissorTest(true); renderer.setViewport(0, 0, w, h); renderer.setScissor(0, 0, w, h);
  skyDome.follow(pipCamera.position); renderer.render(scene, pipCamera);
  renderer.setScissorTest(false); renderer.setViewport(0, 0, innerWidth, innerHeight);
  const e = pipCamera.matrixWorld.elements, cam = cameraFrom({ pos: [e[12], e[13], e[14]], right: [e[0], e[1], e[2]], up: [e[4], e[5], e[6]], forward: [-e[8], -e[9], -e[10]], hfov: CAMERA_HFOV, aspect: w / h });
  const area = crop ? cropBox(cam, stripCorners(toWorld, segment.crop, CROP_LATERAL)) : { x0: 0, x1: 1, y0: 0, y1: 1 };
  if (!area) return null; // the stretch is not in front of the lens
  const sx = Math.round(area.x0 * w * ratio), sy = Math.round(area.y0 * h * ratio), sw = Math.max(1, Math.round((area.x1 - area.x0) * w * ratio)), sh = Math.max(1, Math.round((area.y1 - area.y0) * h * ratio));
  const scale = Math.min(1, outWidth / sw), canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(sw * scale)); canvas.height = Math.max(1, Math.round(sh * scale));
  canvas.getContext('2d', { willReadFrequently: true }).drawImage(source, sx, source.height - sy - sh, sw, sh, 0, 0, canvas.width, canvas.height); // the corner of the drawing buffer is at the bottom left
  // everything outside the lanes of this road is painted over with flat grey, so a vehicle in a parallel lane, on the other carriageway or on a cross street is not in the picture the detector sees
  const mask = crop ? laneMask(cam, stripCorners(toWorld, segment.crop, CROP_LATERAL, MASK_TOP)) : null;
  if (mask) {
    const g = canvas.getContext('2d'), cw = canvas.width, ch = canvas.height;
    g.beginPath(); g.rect(0, 0, cw, ch);
    mask.forEach(([u, v], i) => { const x = (u - area.x0) / (area.x1 - area.x0) * cw, y = (v - area.y0) / (area.y1 - area.y0) * ch; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.closePath(); g.fillStyle = MASK_GREY; g.fill('evenodd');
  }
  const here = (x, z) => { const [a, b] = rot((4 - k) % 4, x, z); return { lateral: a, d: YS - b }; }; // where a point in the world is on this road: across its lanes, and how far from the stop line
  return { canvas, area, segment, cam, mask, here, toWorld, approach: point.approach, w, h };
}

// A picture from detection camera `index` with its training labels (see src/detection/labels.js and docs/detector.md), for making the training set from the browser. The picture is `cameraPicture`: the crop of the
// camera's stretch of its road, lanes masked. Every vehicle in the crop that stands in the lanes is labelled; where two cameras overlap, a vehicle is in both crops, so each label says whether this camera OWNS the place
// the vehicle stands (the one that counts it). Nothing on the page calls it.
function exportFrame(index, { outWidth = 960, quality = .9, crop = true } = {}) {
  const pic = cameraPicture(index, { outWidth, crop }); if (!pic) return null;
  const { canvas, area, segment, cam, mask, here, w } = pic;
  const vehicles = [];
  for (const t of tracks.vehicles.values()) {
    if (!t.mesh || !t.mesh.visible) continue;
    const c = CLASSES[t.cls]; vehicles.push({ id: t.id, kind: t.cls, x: t.mesh.position.x, z: t.mesh.position.z, yaw: t.mesh.rotation.y, length: c.length, width: c.width, height: VEHICLE_HEIGHT[t.cls] ?? 2, approach: t.vehicle.approach, d: t.vehicle.d, lane: t.vehicle.lane, points: modelPoints(t.mesh), at: here(t.mesh.position.x, t.mesh.position.z) });
  }
  const truth = Object.fromEntries(COUNT_CLASSES.map((name) => [name, 0])); // the true count in this camera's stretch, by the controller's four classes, including a vehicle that nothing can see
  for (const v of vehicles) if (inLanes(v.at, segment.own, [0, H]) && owns(segment, v.at.d)) truth[COUNT_CLASSES[CLASS_OF[v.kind] ?? 0]] += 1;
  const labels = labelsFor(cam, vehicles, lotBoxes, { width: w, crop: crop ? area : null, mask, only: (v) => !crop || inLanes(v.at, segment.crop, [0, H]) }); // a vehicle in another lane is not labelled, though it can still hide one that is
  return {
    image: canvas.toDataURL('image/jpeg', quality), width: canvas.width, height: canvas.height, camera: index, approach: pic.approach, time: sim.time, crop: area, own: segment.own, truth, cam: { pos: cam.pos, right: cam.right, up: cam.up, forward: cam.forward, hfov: CAMERA_HFOV, aspect: w / h },
    labels: labels.map((l) => { const v = vehicles.find((o) => o.id === l.id); return { ...l, line: yoloLine(l), approach: v.approach, d: v.d, lane: v.lane, owned: inLanes(v.at, segment.own, [0, H]) && owns(segment, v.at.d) }; }),
  };
}
// The markers over the cameras: where each camera is on the screen, a little larger the nearer it is, and hidden when it is behind the viewpoint, off the screen or too far to matter.
const markerSpot = new THREE.Vector3();
function placeMarkers() {
  const w = innerWidth, h = innerHeight, behind = shell.cameraView && shell.cameraView.active ? shell.cameraView.rect : null; // a marker behind the panel would show through it
  cameraList.forEach((p, i) => {
    p.obj.getWorldPosition(markerSpot); markerSpot.y += 1.4;
    const distance = markerSpot.distanceTo(camera.position); markerSpot.project(camera);
    const x = (markerSpot.x + 1) / 2 * w, y = (1 - markerSpot.y) / 2 * h;
    const visible = markerSpot.z < 1 && x > -20 && x < w + 20 && y > 20 && y < h + 20 && distance > 6 && distance < 320 && !(behind && x > behind.left - 18 && x < behind.right + 18 && y > behind.top && y < behind.bottom + 40);
    shell.placeMarker(i, visible ? { x, y } : null, Math.max(22, Math.min(34, 1700 / distance)));
  });
}
// A tag on every emergency vehicle that has not reached the junction yet (up to four, nearest first): its kind and how far it is. A tag stands over its vehicle. When the vehicle is off the screen or behind the viewpoint,
// the tag is kept on the edge, on the side the vehicle is, with an arrow to it, so it can be found from any view. When a building is between the viewpoint and the vehicle, the tag stays where the vehicle is on the screen, on the face of the building that hides it, and has a dashed edge.
// Tags that would lie on one another are spread apart, and they keep clear of the open panel.
const EMERGENCY_NAMES = { amb: 'Ambulance', fire: 'Fire engine', police: 'Police car' }, alertSpot = new THREE.Vector3();
function coverOf(a, b) { // the height of the highest building between the points a and b, or 0 when there is none
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z; let top = 0;
  for (const box of lotBoxes) {
    let t0 = .02, t1 = .98;
    for (const [from, d, lo, hi] of [[a.x, dx, box[0], box[1]], [a.y, dy, 0, box[4]], [a.z, dz, box[2], box[3]]]) {
      if (Math.abs(d) < 1e-9) { if (from < lo || from > hi) { t0 = 1; break; } continue; }
      let n = (lo - from) / d, f = (hi - from) / d; if (n > f) [n, f] = [f, n];
      t0 = Math.max(t0, n); t1 = Math.min(t1, f); if (t0 > t1) break;
    }
    if (t0 <= t1) top = Math.max(top, box[4]);
  }
  return top;
}
function placeAlerts() {
  const incoming = [];
  for (const s of tracks.vehicles.values()) { const v = s.vehicle; if (s.mesh && v.emergency && !v.crossed && v.d > 0) incoming.push(s); }
  incoming.sort((p, q) => p.vehicle.d - q.vehicle.d); incoming.length = Math.min(incoming.length, 4);
  const w = innerWidth, h = innerHeight, left = 80, right = w - 80, top = 90, bottom = h - 120, cx = w / 2, cy = (top + bottom) / 2, panel = shell.panelRect;
  const items = incoming.map((s) => {
    s.mesh.getWorldPosition(alertSpot); alertSpot.y += 2.4;
    const hidden = coverOf(camera.position, alertSpot) > 0;
    alertSpot.project(camera);
    const behind = alertSpot.z > 1, sx = (alertSpot.x + 1) / 2 * w, sy = (1 - alertSpot.y) / 2 * h;
    const item = { x: sx, y: sy, away: false, angle: 0, hidden, text: `${EMERGENCY_NAMES[s.vehicle.cls] || 'Emergency vehicle'}, ${Math.round(s.vehicle.d)} m` };
    if (behind || sx < left || sx > right || sy < top || sy > bottom) { // off the screen: on the edge, on the side it is, with an arrow to it. A point behind the viewpoint is projected the wrong way round.
      let dx = sx - cx, dy = sy - cy; if (behind) { dx = -dx; dy = -dy; }
      if (Math.hypot(dx, dy) < 1) dy = -1;
      const t = Math.min(dx > 0 ? (right - cx) / dx : dx < 0 ? (left - cx) / dx : Infinity, dy > 0 ? (bottom - cy) / dy : dy < 0 ? (top - cy) / dy : Infinity);
      item.x = cx + dx * t; item.y = cy + dy * t; item.away = true; item.angle = Math.atan2(dy, dx);
    } else if (panel && item.x > panel.left - 80 && item.x < panel.right + 80 && item.y > panel.top - 50) { // over the open panel: beside it when there is room, and above it when there is not
      const sideLeft = panel.left - 80, sideRight = panel.right + 80;
      if (sideLeft >= left && (item.x < (panel.left + panel.right) / 2 || sideRight > right)) item.x = sideLeft;
      else if (sideRight <= right) item.x = sideRight;
      else item.y = Math.max(top, panel.top - 50);
    }
    return item;
  });
  const card = shell.statusRect; // a tag is never under the status card: it goes to the right of it, or below it when there is no room
  if (card && card.width > 0) for (const item of items) {
    if (item.x > card.left - 90 && item.x < card.right + 90 && item.y > card.top - 20 && item.y < card.bottom + 50) {
      if (card.right + 100 <= w - 80 && !item.away) item.x = card.right + 100;
      else item.y = card.bottom + 60;
    }
  }
  for (let i = 1; i < items.length; i += 1) { // tags that would lie on one another are moved down (or up, at the bottom of the screen) by a tag's height
    for (let pass = 0; pass < 4; pass += 1) {
      const clash = items.slice(0, i).find((o) => Math.abs(o.x - items[i].x) < 170 && Math.abs(o.y - items[i].y) < 32);
      if (!clash) break;
      items[i].y = clash.y + 34 > h - 100 ? clash.y - 34 : clash.y + 34;
    }
  }
  shell.placeAlerts(items);
}
// The viewpoint glides by turning round the point it looks at: the angles, the distance and the point itself ease together, on the clock and not on the frame rate, so a long move is one smooth arc.
// A drag or a pinch takes over at once.
let glide = null, wasAway = false;
const GLIDE_SECONDS = 1.6, HOME = new THREE.Vector3(58, 62, 68);
const LIFT_STEPS = 48;
function glidePoint(g, e, out) { // where the glide has the viewpoint when it is the share e of the way along, before any lift
  const aim = new THREE.Vector3().lerpVectors(g.fromAim, g.toAim, e);
  return out.setFromSphericalCoords(g.from.radius + (g.to.radius - g.from.radius) * e, g.from.phi + (g.to.phi - g.from.phi) * e, g.from.theta + g.turn * e).add(aim);
}
// A straight glide can run through a building, and half way through, the nearest way out changes sides and the viewpoint would jump. So the path is planned: wherever it would be inside a building or a tree it
// is lifted over it, by an amount that is smoothed along the path so the viewpoint rises and falls in one arc, and is zero at both ends.
function planLift(g) {
  const need = new Float32Array(LIFT_STEPS + 1), p = new THREE.Vector3();
  for (let i = 0; i <= LIFT_STEPS; i += 1) {
    glidePoint(g, i / LIFT_STEPS, p);
    let top = 0;
    for (const b of lotBoxes) if (p.x > b[0] - CAMERA_CLEARANCE && p.x < b[1] + CAMERA_CLEARANCE && p.z > b[2] - CAMERA_CLEARANCE && p.z < b[3] + CAMERA_CLEARANCE) top = Math.max(top, b[4]);
    for (const [x, z, size, kind] of treeSpots) { const h = treeSet.heightOf(kind) * size, r = h * (CROWN[kind] || .32) + CAMERA_CLEARANCE; if (Math.abs(p.x - x) < r && Math.abs(p.z - z) < r) top = Math.max(top, h); }
    need[i] = top ? Math.max(0, top + CAMERA_CLEARANCE + .5 - p.y) : 0;
  }
  const widen = (src, r, pick) => src.map((_, i) => { let v = pick === 'max' ? 0 : 0, n = 0; for (let j = Math.max(0, i - r); j <= Math.min(LIFT_STEPS, i + r); j += 1) { v = pick === 'max' ? Math.max(v, src[j]) : v + src[j]; n += 1; } return pick === 'max' ? v : v / n; });
  let lift = widen(widen(widen(Float32Array.from(need), 4, 'max'), 4, 'mean'), 3, 'mean'); // spread to either side, then rounded off
  lift = lift.map((v, i) => v * Math.min(1, i / 5, (LIFT_STEPS - i) / 5)); // none at either end
  return lift.some((v) => v > 0.01) ? lift : null;
}
function glideTo(aim, eye, seconds = GLIDE_SECONDS) { // eye is a position, or an offset from the aim given as a THREE.Spherical. A short glide (a double click) goes straight, with no lift over what is in the way
  const from = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
  const to = eye instanceof THREE.Spherical ? eye : new THREE.Spherical().setFromVector3(eye.clone().sub(aim));
  // Where the glide ends is moved out of anything it would be inside first, so it arrives where the viewpoint can stay and is not pushed out after it has stopped (which showed as a jerk at the end).
  const landing = new THREE.Vector3().setFromSpherical(to).add(aim); resolveClear(landing); to.setFromVector3(landing.sub(aim));
  const turn = to.theta - from.theta;
  glide = { start: performance.now(), seconds, fromAim: controls.target.clone(), toAim: aim.clone(), from, to, turn: turn - Math.round(turn / TAU) * TAU }; // the short way round
  glide.lift = seconds === GLIDE_SECONDS ? planLift(glide) : null;
}
function updateGlide() {
  if (!glide) return;
  const k = Math.min(1, (performance.now() - glide.start) / (glide.seconds * 1000)), e = k * k * k * (k * (6 * k - 15) + 10); // eases in and out with no jolt at either end
  controls.target.lerpVectors(glide.fromAim, glide.toAim, e);
  glidePoint(glide, e, camera.position);
  if (glide.lift) { const at = e * LIFT_STEPS, i = Math.min(LIFT_STEPS - 1, Math.floor(at)); camera.position.y += glide.lift[i] + (glide.lift[i + 1] - glide.lift[i]) * (at - i); }
  if (k >= 1) glide = null;
}
controls.addEventListener('start', () => { glide = null; });

// The viewpoint never goes into a building, a tree, a vehicle or a person, or under the ground: when it is inside one it is pushed out the shortest way (to the side, or up over a roof). The viewpoint keeps a little more than the near plane
// away, so nothing is cut open on the screen. A vehicle is a box that turns with it, a person is a post, a tree is a post as high and as wide as its crown.
let clearGrid = null; // every other solid thing in the scene, from its triangles (clearance.js), ready a moment after the scene starts
const CAMERA_CLEARANCE = 2.2, MIN_HEIGHT = 1.0; // more than the 2 m near plane, or a wall would be cut open on the screen
const CROWN = { poplar: .16, pine: .3, palm: .22 }; // how wide a tree is, as a share of its height (the others are .32)
const pushOut = (box, p) => { // box: { x0, x1, z0, z1, top }, already grown by the clearance. Moves the point p out of it, the shortest way.
  if (p.x <= box.x0 || p.x >= box.x1 || p.z <= box.z0 || p.z >= box.z1 || p.y >= box.top) return;
  const out = [[p.x - box.x0, -1, 0], [box.x1 - p.x, 1, 0], [p.z - box.z0, 0, -1], [box.z1 - p.z, 0, 1]].reduce((best, c) => (c[0] < best[0] ? c : best));
  const up = box.top - p.y;
  if (up < out[0]) p.y = box.top; else { p.x += out[1] * out[0]; p.z += out[2] * out[0]; }
};
const growBox = (x0, x1, z0, z1, top) => ({ x0: x0 - CAMERA_CLEARANCE, x1: x1 + CAMERA_CLEARANCE, z0: z0 - CAMERA_CLEARANCE, z1: z1 + CAMERA_CLEARANCE, top: top + CAMERA_CLEARANCE });
const post = (x, z, radius, top) => growBox(x - radius, x + radius, z - radius, z + radius, top);
function resolveClear(p) { // moves the point p (a viewpoint) out of anything it is inside
  const before = new THREE.Vector3();
  if (p.y > 130) return; // high above everything there is nothing to hit
  for (let pass = 0; pass < 4; pass += 1) { // a push out of one thing can land in the next, so it is repeated until the viewpoint stops moving
    before.copy(p); clearOnce(p);
    if (before.distanceToSquared(p) < 1e-8) break;
  }
  // still in a narrow gap between buildings, where one pushes it into the next and that one pushes it straight back (so it did not move): go up over the roofs that hold it
  const edge = CAMERA_CLEARANCE - .15; // a point that was just pushed to the edge of the margin is not in a gap
  for (const [x, z, size, kind] of treeSpots) { if (Math.abs(p.x - x) > 14 || Math.abs(p.z - z) > 14) continue; const h = treeSet.heightOf(kind) * size, r = h * (CROWN[kind] || .32) + edge; if (Math.abs(p.x - x) < r && Math.abs(p.z - z) < r && p.y < h + edge) p.y = Math.max(p.y, h + CAMERA_CLEARANCE); }
  for (const b of lotBoxes) if (p.x > b[0] - edge && p.x < b[1] + edge && p.z > b[2] - edge && p.z < b[3] + edge && p.y < b[4] + edge) p.y = Math.max(p.y, b[4] + CAMERA_CLEARANCE);
}
function clearOnce(p) {
  if (clearGrid) clearGrid.push(p);
  if (p.y < MIN_HEIGHT) p.y = MIN_HEIGHT;
  for (const b of lotBoxes) if (Math.abs(p.x - (b[0] + b[1]) / 2) < 60 && Math.abs(p.z - (b[2] + b[3]) / 2) < 60) pushOut(growBox(b[0], b[1], b[2], b[3], b[4]), p);
  for (const [x, z, size, kind] of treeSpots) { if (Math.abs(p.x - x) > 14 || Math.abs(p.z - z) > 14) continue; const h = treeSet.heightOf(kind) * size; pushOut(post(x, z, h * (CROWN[kind] || .32), h), p); }
  for (const t of tracks.vehicles.values()) { // a box that turns with the vehicle: the camera is put in its frame, pushed out there, and put back
    if (!t.mesh) continue;
    const m = t.mesh.position, dx = p.x - m.x, dz = p.z - m.z; if (Math.abs(dx) > 14 || Math.abs(dz) > 14) continue;
    const c = Math.cos(t.mesh.rotation.y), sn = Math.sin(t.mesh.rotation.y), lx = dx * c - dz * sn, lz = dx * sn + dz * c;
    const half = [t.length / 2, t.width / 2], local = new THREE.Vector3(lx, p.y, lz);
    pushOut(growBox(-half[0], half[0], -half[1], half[1], VEHICLE_HEIGHT[t.cls] || 2), local);
    p.y = local.y; p.x = m.x + local.x * c + local.z * sn; p.z = m.z - local.x * sn + local.z * c;
  }
  for (const m of peds.values()) { const q = m.mesh.position; if (Math.abs(p.x - q.x) < 8 && Math.abs(p.z - q.z) < 8) pushOut(post(q.x, q.z, .45, 1.9), p); }
  for (const person of parkPeople) { const q = person.mesh.position; if (Math.abs(p.x - q.x) < 8 && Math.abs(p.z - q.z) < 8) pushOut(post(q.x, q.z, .45, 1.9), p); }
}

// The push-out is eased, not applied at once, or a viewpoint that meets a wall jumps. The camera moves a share of the way to the cleared point each frame (the rate is by time, so it is the same at any frame rate).
// A glide sets the whole position again each frame, so its push-out is kept apart and added to it. In the few frames of the ease the viewpoint is a little inside the margin, which is more than the near plane, so nothing shows through.
const EASE_RATE = 20, MAX_PUSH_SPEED = 150, probe = new THREE.Vector3(), glideShift = new THREE.Vector3(), shiftTarget = new THREE.Vector3();
function keepClear(dt) {
  if (!Number.isFinite(camera.position.x + camera.position.y + camera.position.z)) { { const [aim, eye] = homeView(); camera.position.copy(eye); controls.target.copy(aim); } glide = null; glideShift.set(0, 0, 0); return; } // a bad number must never leave the screen black
  if (!glide && glideShift.lengthSq() > 0) { camera.position.add(glideShift); glideShift.set(0, 0, 0); } // the glide has just ended: the viewpoint keeps the push it had, and the ease carries on from there, so it does not jump
  const k = 1 - Math.exp(-dt * EASE_RATE);
  probe.copy(camera.position); resolveClear(probe);
  if (!Number.isFinite(probe.x + probe.y + probe.z)) probe.copy(camera.position);
  const room = MAX_PUSH_SPEED * dt; // and never faster than this, so that a jump in where the clear point is (past the middle of a thing) does not throw the viewpoint
  if (glide) {
    shiftTarget.copy(probe).sub(camera.position).sub(glideShift).multiplyScalar(k); if (shiftTarget.length() > room) shiftTarget.setLength(room); glideShift.add(shiftTarget); camera.position.add(glideShift);
  } else {
    glideShift.set(0, 0, 0);
    shiftTarget.copy(probe).sub(camera.position).multiplyScalar(k); if (shiftTarget.length() > room) shiftTarget.setLength(room); camera.position.add(shiftTarget);
  }
}

// The places the Go to panel goes to: where the viewpoint stands and what it looks at, in metres. A road is seen from 52 m out along it, as a driver coming in sees it.
const PLACE_VIEWS = (() => {
  const at = (x, y, z) => new THREE.Vector3(x, y, z);
  const carParkView = (v) => { const [ax, az] = v.toWorld(0, 30), [ex, ez] = v.toWorld(0, -13); return { aim: at(ax, 2.5, az), eye: at(ex, 24, ez) }; }; // from over the side street, on the line of the aisle and high enough to look down past the buildings on either side, so the whole car park, the door and the name over it are in view
  const road = (k) => { const [ex, ez] = rot(k, 0, -52), [ax, az] = rot(k, 0, -6); return { aim: at(ax, 2, az), eye: at(ex, 9, ez) }; };
  const [laneNear, laneFar] = [rot(0, LANE_X[0], YS - 4), rot(0, LANE_X[0] - 8.4, YS - 50)]; // the bus lane is the kerb lane: seen along its length, coming in on the north road, from over the next lane in because the street trees stand beside the kerb
  const [pathX, pathZ] = inPark(RING, 0);
  const park = (zone, back = 17, up = 12) => { const [x, z] = inPark(zone.u, zone.v), aim = at(x, 1, z); return { aim, eye: aim.clone().add(at(-back, up, -back)) }; }; // from the junction side, so nothing stands in front
  const [kerbX, kerbZ] = rot(1, 12, -14), [waitX, waitZ] = rot(1, 14, -24);
  const views = {
    junction: { aim: at(0, 0, 0), eye: HOME },
    north: road(0), east: road(1), south: road(2), west: road(3),
    crossing: { aim: at(kerbX, 1.4, kerbZ), eye: at(waitX, 2.8, waitZ) }, // behind the people waiting at the crossing of the east road, looking at the kerb, the crossing and the signal across it
    signal: { aim: at(1.4, 6.2, -14.5), eye: at(3, 7.5, -24), left: 1.4, back: 1.6 }, // a head on its mast arm, with the countdown. `left`: how far (m) the head's middle is to the left of the aim, and `back`: the most an upright screen steps back (the head is 4 m wide, so about 1.6 times the distance shows all of it). A wide screen needs neither
    bus: { aim: at(laneNear[0], .5, laneNear[1]), eye: at(laneFar[0], 11, laneFar[1]) },
    path: { aim: at(pathX, 1, pathZ), eye: at(pathX, 9, pathZ - 16) }, // along the ring path, where the joggers and cyclists come
    restaurant: carParkView(venues.find((v) => v.kind === 'restaurant')), office: carParkView(venues.find((v) => v.kind === 'office')),
    courtyard: (() => { const y = yardPeople.filter((q) => hasCafe(q.w, q.d)).sort((p, q) => Math.hypot(p.x, p.z) - Math.hypot(q.x, q.z))[0] || yardPeople[0], aim = at(y.x, .6, y.z); return { aim, eye: aim.clone().add(at(0, 22, 17)) }; })(), // the nearest courtyard with a cafe, from the south side and above
    hire: (() => { const h = hubs[0], p = h.group.position, aim = at(p.x + (h.width || 10) * Math.sign(p.x) * .5, .5, p.z + (h.depth || 8) * Math.sign(p.z) * .5); return { aim, eye: aim.clone().add(at(9 * Math.sign(p.x || 1), 15, -19 * Math.sign(p.z || 1))) }; })(), // from the junction side, over the road and high enough to see the whole hub, the bikes and the scooters
    // the kiosk faces +z (window, awning, counter, the queue and the tables), so its view stands on that side
    kiosk: (() => { const [x, z] = inPark(ZONES.kiosk.u, ZONES.kiosk.v + 1.5), aim = at(x, 1.4, z); return { aim, eye: aim.clone().add(at(12, 8, 12)) }; })(), fountain: park({ u: 0, v: 0 }, 24, 17), pond: park(ZONES.pond, 22, 15), playground: park(ZONES.play, 18, 12), court: park(ZONES.court, 20, 13),
  };
  // The places that are an area are fitted (fitView): the closest viewpoint on the line of sight they were designed with that shows all of the area, in the part of the screen the page's own cards leave free.
  // So the view is whole and centred on any screen, a phone upright or a wide window. `dir` is the way the view looks.
  const dirOf = (v) => v.aim.clone().sub(v.eye).normalize();
  const around = (x0, x1, z0, z1, heights) => heights.flatMap((y) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([x, z]) => at(x, y, z)));
  const ring = (x, z, rx, rz, heights) => heights.flatMap((y) => Array.from({ length: 16 }, (_, i) => at(x + Math.cos(i * Math.PI / 8) * rx, y, z + Math.sin(i * Math.PI / 8) * rz)));
  const zoneBox = (zone, pad, heights) => { const [x, z] = inPark(zone.u, zone.v); return around(x - zone.hx - pad, x + zone.hx + pad, z - zone.hz - pad, z + zone.hz + pad, heights); };
  const [pondX, pondZ] = inPark(ZONES.pond.u, ZONES.pond.v), [plazaX, plazaZ] = inPark(ZONES.plaza.u, ZONES.plaza.v), [kioskX, kioskZ] = inPark(ZONES.kiosk.u, ZONES.kiosk.v);
  views.pond.fit = { points: ring(pondX, pondZ, ZONES.pond.rx + 1.5, ZONES.pond.rz + 1.5, [0, 2]), dir: dirOf(views.pond) };
  views.court.fit = { points: zoneBox(ZONES.court, 1, [0, 3.5]), dir: dirOf(views.court) };
  views.playground.fit = { points: zoneBox(ZONES.play, 1, [0, 4.5]), dir: dirOf(views.playground) };
  views.fountain.fit = { points: ring(plazaX, plazaZ, ZONES.plaza.r, ZONES.plaza.r, [0, 5]), dir: dirOf(views.fountain) };
  views.kiosk.fit = { points: around(kioskX - 8.6, kioskX + 4.6, kioskZ - 3, kioskZ + 8.2, [0, 3.5]), dir: dirOf(views.kiosk) }; // the kiosk, the tables with their umbrellas and the queue at the window
  { const [x0, x1, z0, z1, height] = hubs[0].footprint; views.hire.fit = { points: around(x0 - 1, x1 + 1, z0 - 1, z1 + 1, [0, Math.min(height, 6)]), dir: dirOf(views.hire) }; }
  const CAR_PARK_PITCH = 72 * Math.PI / 180; // steep, because a lot is a narrow gap between buildings: from a low angle the viewpoint ends up inside the building across the side street
  for (const kind of ['restaurant', 'office']) { // the whole car park and the front of the building with its sign
    const v = venues.find((q) => q.kind === kind), w = carparkHalfWidth() + .6, t = carparkDepth() + .6;
    const along = dirOf(views[kind]); along.y = 0; along.normalize(); // the way the aisle runs
    views[kind].fit = { points: [[-w, 0, .3], [w, 0, .3], [-w, t, .3], [w, t, .3], [-w, t + 1, 7], [w, t + 1, 7]].map(([a, d, y]) => { const [x, z] = v.toWorld(a, d); return at(x, y, z); }), dir: along.multiplyScalar(Math.cos(CAR_PARK_PITCH)).setY(-Math.sin(CAR_PARK_PITCH)) };
  }
  return views;
})();
// The views above were made for a wide screen, and a screen of another shape crops them. A road or a head is a point of view and is stepped back (framedFor). An area is fitted (fitView).
// framedFor: the lens has a fixed height of view, so a tall narrow screen (a phone upright) sees much less of the width. On a screen narrower than REF_ASPECT the viewpoint stands back along the same line, by
// part of what it would take to show the same width (all of it would put the viewpoint too far out and too small to see anything). A wide screen is not changed.
const REF_ASPECT = 1.5, STEP_BACK = 0.45, MAX_BACK = 2.2;
function framedFor(place) {
  const aspect = camera.aspect; if (!(aspect < REF_ASPECT)) return [place.aim, place.eye];
  let { aim, eye } = place;
  if (place.left) { const forward = aim.clone().sub(eye).normalize(), left = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), forward).normalize().multiplyScalar(place.left); aim = aim.clone().add(left); eye = eye.clone().add(left); }
  const k = Math.min(place.back || MAX_BACK, 1 + (REF_ASPECT / aspect - 1) * STEP_BACK);
  return [aim, aim.clone().add(eye.clone().sub(aim).multiplyScalar(k))];
}
// What the page's own cards cover, in pixels: the status card at the top on a phone (on a wide screen it sits in a corner and takes no width), and the dock at the bottom with the Junction button above it.
function viewInsets() {
  const W = innerWidth, H = innerHeight, box = (selector) => { const e = document.querySelector(selector); return e && !e.hidden ? e.getBoundingClientRect() : null; };
  const card = box('.status'), dock = box('.dock');
  return { left: .04 * W, right: .04 * W, top: card && card.width > .6 * W ? card.bottom + 8 : .04 * H, bottom: dock ? H - dock.top + 56 : .04 * H };
}
// The closest viewpoint, looking along `dir` (from the eye to what it looks at), from which every one of `points` is inside the free part of the screen, with the middle of that part at the middle of the points.
const FIT_MARGIN = 0.08; // a share of the free part, kept clear all round
function fitView(points, dir) {
  const W = innerWidth, H = innerHeight, inset = viewInsets();
  const x0 = -1 + 2 * inset.left / W, x1 = 1 - 2 * inset.right / W, y0 = -1 + 2 * inset.bottom / H, y1 = 1 - 2 * inset.top / H;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hw = (x1 - x0) / 2 * (1 - FIT_MARGIN), hh = (y1 - y0) / 2 * (1 - FIT_MARGIN);
  const probe = new THREE.PerspectiveCamera(camera.fov, camera.aspect, 1, 4000), at = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
  const middle = points.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(points.length);
  const from = (t) => { // the view from `t` metres out, with the middle of the points moved to the middle of the free part
    const aim = middle.clone(); let fits = false;
    for (let i = 0; i < 6; i += 1) {
      probe.position.copy(aim).addScaledVector(dir, -t); probe.lookAt(aim); probe.updateMatrixWorld(true);
      let lx = Infinity, hx = -Infinity, ly = Infinity, hy = -Infinity, front = true;
      for (const p of points) { at.copy(p).applyMatrix4(probe.matrixWorldInverse); if (at.z > -1) front = false; at.copy(p).project(probe); lx = Math.min(lx, at.x); hx = Math.max(hx, at.x); ly = Math.min(ly, at.y); hy = Math.max(hy, at.y); }
      fits = front && (hx - lx) / 2 <= hw && (hy - ly) / 2 <= hh;
      const dx = (lx + hx) / 2 - cx, dy = (ly + hy) / 2 - cy; if (Math.abs(dx) + Math.abs(dy) < 1e-4) break;
      const halfH = t * Math.tan(probe.fov * Math.PI / 360), halfW = halfH * probe.aspect;
      right.setFromMatrixColumn(probe.matrixWorld, 0); up.setFromMatrixColumn(probe.matrixWorld, 1);
      aim.addScaledVector(right, dx * halfW).addScaledVector(up, dy * halfH);
    }
    return { aim, eye: aim.clone().addScaledVector(dir, -t), fits };
  };
  let near = 6, far = controls.maxDistance - 1; if (!from(far).fits) return [from(far).aim, from(far).eye]; // the viewpoint can be no further out than the controls allow, so on a very narrow screen the edges of a big area are cut rather than the view put out of reach
  for (let i = 0; i < 26; i += 1) { const mid = (near + far) / 2; if (from(mid).fits) far = mid; else near = mid; }
  const best = from(far); return [best.aim, best.eye];
}
// The start view, the one the Junction button returns to. A wide screen has HOME. A taller narrow one has the junction fitted the same way as an area (the crossing and the stop lines on every road).
let homeAt = null; // [aim, eye] for the current shape of the screen
function homeView() {
  if (!(camera.aspect < REF_ASPECT)) return [new THREE.Vector3(), HOME];
  if (!homeAt) homeAt = fitView(junctionPoints(), HOME.clone().negate().normalize());
  return homeAt;
}
const junctionPoints = () => { const r = Math.abs(YS) + 4; return [-r, r].flatMap((x) => [-r, r].flatMap((z) => [0, 8].map((y) => new THREE.Vector3(x, y, z)))); }; // the crossing and the stop lines (YS is negative)
// "Show": the viewpoint glides to a raised view of the camera from its front and one side, with the camera in the middle of the screen
function focusCamera(index) {
  const p = cameraList[index], at = new THREE.Vector3(), forward = new THREE.Vector3(0, 0, -1);
  p.obj.updateWorldMatrix(true, false); p.obj.getWorldPosition(at); forward.transformDirection(p.obj.matrixWorld); forward.y = 0; forward.normalize();
  const side = Math.sign(forward.x * (camera.position.z - at.z) - forward.z * (camera.position.x - at.x)) || 1; // the side the viewpoint is on, so the glide does not cross the road
  const aim = at.clone();
  const toward = forward.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), side * Math.PI / 4); // the way the viewpoint stands from the camera: ahead of it, a quarter turn off its line
  glideTo(aim, aim.clone().addScaledVector(toward, 8).setY(aim.y + 5.5));
}
// a click or a tap that is not a drag, on a camera
const picker = new THREE.Raycaster(), pointer = new THREE.Vector2();
let pressedAt = null;
const cameraUnder = (e) => { const r = renderer.domElement.getBoundingClientRect(); pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); picker.setFromCamera(pointer, camera); const hit = picker.intersectObjects(hitProxies, false)[0]; return hit ? hit.object.userData.index : -1; };
// A pinch on a trackpad arrives as a wheel event with the control key down and very small steps, which zoomed far too slowly. It is sent on again, nine times larger, so a pinch zooms as far as the hand moves.
let boosting = false;
renderer.domElement.addEventListener('wheel', (e) => {
  if (boosting || !e.ctrlKey) return;
  e.preventDefault(); e.stopImmediatePropagation(); boosting = true;
  renderer.domElement.dispatchEvent(new WheelEvent('wheel', { deltaY: e.deltaY * 9, deltaMode: 0, clientX: e.clientX, clientY: e.clientY, bubbles: true, cancelable: true }));
  boosting = false;
}, { capture: true, passive: false });
// ---- two fingers: pinch to zoom toward the fingers, twist to turn, swipe up or down to tilt, drag sideways to move (touch-gestures.js has the arithmetic) ----
const fingers = new Map(); let lastFingers = null, tapFrom = null, multiTouch = false;
const TILT_PER_PIXEL = (Math.PI / 2) / 420; // a swipe of 420 pixels tilts a quarter turn, from straight down to the horizon
const upAxis = new THREE.Vector3(0, 1, 0), groundPlane = new THREE.Plane(upAxis, 0), ray = new THREE.Raycaster(), tmp = new THREE.Vector3(), hit = new THREE.Vector3(), offset = new THREE.Vector3(), sph = new THREE.Spherical();
function moveView(d, mid) {
  const box = renderer.domElement.getBoundingClientRect(), eye = camera.position, aim = controls.target, here = eye.distanceTo(aim);
  if (d.pan) { // sideways: the ground follows the fingers, as one finger does
    const perPixel = 2 * here * Math.tan(camera.fov * Math.PI / 360) / box.height;
    tmp.setFromMatrixColumn(camera.matrixWorld, 0); tmp.y = 0; tmp.normalize().multiplyScalar(-d.pan * perPixel); eye.add(tmp); aim.add(tmp);
  }
  if (d.twist) { offset.copy(eye).sub(aim).applyAxisAngle(upAxis, TWIST_SIGN * d.twist); eye.copy(aim).add(offset); } // the view turns about what it looks at
  if (d.tilt) { offset.copy(eye).sub(aim); sph.setFromVector3(offset); sph.phi = Math.max(0.02, Math.min(controls.maxPolarAngle, sph.phi + d.tilt * TILT_PER_PIXEL)); offset.setFromSpherical(sph); eye.copy(aim).add(offset); }
  if (d.zoom !== 1) { // toward the point on the ground between the fingers, so it stays under them
    const wanted = Math.max(controls.minDistance, Math.min(controls.maxDistance, here * d.zoom)), k = wanted / here;
    ray.setFromCamera({ x: ((mid.x - box.left) / box.width) * 2 - 1, y: -((mid.y - box.top) / box.height) * 2 + 1 }, camera);
    groundPlane.constant = -aim.y;
    if (!ray.ray.intersectPlane(groundPlane, hit)) hit.copy(aim);
    eye.sub(hit).multiplyScalar(k).add(hit); aim.sub(hit).multiplyScalar(k).add(hit);
  }
  camera.updateMatrixWorld();
}
const TWIST_SIGN = 1; // which way the view turns when the fingers twist: set so the ground turns with them (checked in web/tools/gestures.mjs)
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  tapFrom = fingers.size === 1 ? [e.clientX, e.clientY] : null; if (fingers.size >= 2) multiTouch = true; // where a tap began, and whether a second finger came down during it
  if (fingers.size === 2) { const [a, b] = [...fingers.values()]; lastFingers = measure(a, b); pressedAt = null; glide = null; } // two fingers are never a tap
});
renderer.domElement.addEventListener('pointermove', (e) => { // only the places are kept here: a browser sends each finger's move as an event of its own, so the two are read together once a frame (applyFingers)
  if (e.pointerType === 'touch' && fingers.has(e.pointerId)) fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
});
function applyFingers() {
  if (fingers.size !== 2 || !lastFingers) return;
  const [a, b] = [...fingers.values()], now = measure(a, b);
  moveView(fingersStep(lastFingers, now), now); lastFingers = now;
}
const lift = (e) => { fingers.delete(e.pointerId); if (fingers.size < 2) lastFingers = null; };

// ---- a double click or a double tap zooms in toward the point (with Shift, out), and the keyboard moves the view: arrows move it, Shift with the arrows turns and tilts it, plus and minus zoom ----
function zoomAt(x, y, factor) {
  const box = renderer.domElement.getBoundingClientRect(), eye = camera.position, aim = controls.target;
  ray.setFromCamera({ x: ((x - box.left) / box.width) * 2 - 1, y: -((y - box.top) / box.height) * 2 + 1 }, camera);
  groundPlane.constant = -aim.y; if (!ray.ray.intersectPlane(groundPlane, hit)) hit.copy(aim);
  const here = eye.distanceTo(aim), k = Math.max(controls.minDistance, Math.min(controls.maxDistance, here * factor)) / here;
  glideTo(aim.clone().sub(hit).multiplyScalar(k).add(hit), eye.clone().sub(hit).multiplyScalar(k).add(hit), 0.35);
}
renderer.domElement.addEventListener('dblclick', (e) => { if (cameraUnder(e) < 0) zoomAt(e.clientX, e.clientY, e.shiftKey ? 2 : 0.5); });
let lastTap = null; // a double tap on a touch screen, which a browser does not report as a double click when the page handles the touches itself
renderer.domElement.addEventListener('pointerup', (e) => {
  if (e.pointerType !== 'touch') return;
  if (multiTouch) { lastTap = null; if (fingers.size === 0) multiTouch = false; return; } // two fingers were never a tap
  if (!tapFrom) return;
  const moved = Math.hypot(e.clientX - tapFrom[0], e.clientY - tapFrom[1]), now = performance.now();
  if (moved > 8) { lastTap = null; return; }
  if (lastTap && now - lastTap.at < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30 && cameraUnder(e) < 0) { zoomAt(e.clientX, e.clientY, 0.5); lastTap = null; } else lastTap = { at: now, x: e.clientX, y: e.clientY };
});
const heldKeys = new Map(); // key -> whether Shift was down
const NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_']);
const keyIsFree = () => { const a = document.activeElement; return !(a && a !== document.body && a.closest && a.closest('input, select, textarea, [role=radiogroup], [role=tablist], .panel')); }; // a control that uses the arrows keeps them
addEventListener('keydown', (e) => { if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || !NAV_KEYS.has(e.key) || !keyIsFree()) return; heldKeys.set(e.key, e.shiftKey); glide = null; e.preventDefault(); });
addEventListener('keyup', (e) => { heldKeys.delete(e.key); });
addEventListener('blur', () => { heldKeys.clear(); });
function applyKeys(dt) {
  if (!heldKeys.size) return;
  const eye = camera.position, aim = controls.target, here = eye.distanceTo(aim);
  for (const [key, shift] of heldKeys) {
    if (key === '+' || key === '=' || key === '-' || key === '_') { // zoom about the middle of the view
      const k = Math.exp((key === '+' || key === '=' ? -1 : 1) * 1.1 * dt), wanted = Math.max(controls.minDistance, Math.min(controls.maxDistance, here * k));
      eye.sub(aim).multiplyScalar(wanted / here).add(aim);
    } else if (shift && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      offset.copy(eye).sub(aim).applyAxisAngle(upAxis, (key === 'ArrowRight' ? 1 : -1) * TWIST_SIGN * (Math.PI / 3) * dt); eye.copy(aim).add(offset);
    } else if (shift) {
      offset.copy(eye).sub(aim); sph.setFromVector3(offset); sph.phi = Math.max(0.02, Math.min(controls.maxPolarAngle, sph.phi + (key === 'ArrowDown' ? 1 : -1) * (Math.PI / 4) * dt)); offset.setFromSpherical(sph); eye.copy(aim).add(offset);
    } else { // the ground under the view moves: along the way the view looks, or across it
      if (key === 'ArrowLeft' || key === 'ArrowRight') { tmp.setFromMatrixColumn(camera.matrixWorld, 0); } else { tmp.copy(aim).sub(eye); }
      tmp.y = 0; if (tmp.lengthSq() < 1e-9) continue; tmp.normalize().multiplyScalar((key === 'ArrowLeft' || key === 'ArrowDown' ? -1 : 1) * 0.35 * here * dt); eye.add(tmp); aim.add(tmp); // about a screen's width in a second and a half
    }
  }
  camera.updateMatrixWorld();
}
renderer.domElement.addEventListener('pointerup', lift); renderer.domElement.addEventListener('pointercancel', lift);
renderer.domElement.style.cursor = 'grab'; // the ground is picked up with the pointer
renderer.domElement.addEventListener('pointerdown', (e) => { pressedAt = [e.clientX, e.clientY]; if (e.pointerType === 'mouse') renderer.domElement.style.cursor = cameraUnder(e) >= 0 ? 'pointer' : 'grabbing'; });
renderer.domElement.addEventListener('pointerup', (e) => { if (pressedAt && Math.hypot(e.clientX - pressedAt[0], e.clientY - pressedAt[1]) < 6) { const i = cameraUnder(e); if (i >= 0) shell.openCamera(i); } pressedAt = null; });
renderer.domElement.addEventListener('pointermove', (e) => { if (e.buttons) return; renderer.domElement.style.cursor = cameraUnder(e) >= 0 ? 'pointer' : 'grab'; });

const sound = createSound();
// Camera detection, off until the visitor switches it on (Controls, Signals). When it is on the controller's counts come from the detector looking at the eight camera views (src/detection), not from the simulator's
// own vehicles. The simulator still counts its own vehicles each second, only to show next to the detector's, and never gives those to the controller.
const detector = new LiveDetector({
  capture: (i) => cameraPicture(i), now: () => sim.time, busLane: () => Boolean(sim.snapshot.bus_lane_active),
  createWorker: () => new Worker(new URL('../detection/worker.js', import.meta.url), { type: 'module' }), modelUrl: new URL('../../models/detector.onnx', import.meta.url).href,
});
// How close the detector is to the truth while it drives the controller: once a simulated second, for each road, whether its count is within one vehicle of the true one, and how often a road has no count.
const detectionStats = { samples: 0, within1: 0, unknown: 0 };
let sampledAt = -1;
const sumOf = (g) => Object.values(g).reduce((n, v) => n + v, 0), roadTotal = (c) => sumOf(c.general) + sumOf(c.right) + sumOf(c.bus);
function sampleDetection() {
  if (detector.state !== 'on' || !sim.truth) return;
  for (let a = 1; a <= 4; a += 1) {
    const c = detector.feed.countsFor(a, sim.time, Boolean(sim.snapshot.bus_lane_active));
    if (!c) { detectionStats.unknown += 1; continue; }
    detectionStats.samples += 1; if (Math.abs(roadTotal(c) - roadTotal(sim.truth[a - 1])) <= 1) detectionStats.within1 += 1;
  }
}
function detectionReport() { // what the Controls panel and the Counts page show
  const s = detector.status(); if (s.state !== 'on' || !sim.truth) return s;
  let seen = 0, real = 0;
  const roads = [1, 2, 3, 4].map((a) => {
    const c = detector.feed.countsFor(a, sim.time, Boolean(sim.snapshot.bus_lane_active)); if (!c) return null;
    const detected = roadTotal(c), actual = roadTotal(sim.truth[a - 1]); seen += detected; real += actual; return { detected, actual };
  });
  return { ...s, seen, real, roads, ...detectionStats };
}
const shell = createShell({
  features: { detection: true }, weatherNames: WEATHER_NAMES, cameras: cameraMeta, rig: { zone: CAMERA_RIG.detectionZone, low: Math.min(...rigShares), high: Math.max(...rigShares) },
  hooks: {
    setMode: (fixed) => sim.setMode(fixed ? 'fixed' : 'adaptive'),
    setSpeed: (n) => { speed = n; },
    // The detector works in real time, so the counts would be stale before they arrived at 4 or 12 times the speed: switching it on puts the speed back to normal (the panel locks the other two).
    setDetection: (on) => { detectionStats.samples = detectionStats.within1 = detectionStats.unknown = 0; sampledAt = -1; if (on) { speed = 1; sim.countSource = detector.source; detector.start(); } else { detector.stop(); sim.countSource = null; } return detector.status(); },
    detectionStatus: detectionReport,
    setSound: (on) => sound.set(on),
    setLook: (v) => { lookLock = v; },
    setWeather: (name) => skyDome.setWeather(name),
    weatherSource: () => ({ live: skyDome.liveWeather, city: VISITOR.city }),
    // An ambulance, a fire engine or a police car, from any road, going straight on, left or right.
    ambulance: (approach) => sim.dispatchEmergency(approach, oneOf(['through', 'through', 'left', 'right']), oneOf(['amb', 'amb', 'fire', 'police'])),
    press: (approach) => sim.pressButton(approach),
    goTo: (id) => { const p = PLACE_VIEWS[id]; if (!p) return; topView = false; shell.syncTop(false); const [aim, eye] = id === 'junction' ? homeView() : p.fit ? fitView(p.fit.points, p.fit.dir) : framedFor(p); glideTo(aim, eye); },
    goHome: () => { topView = false; shell.syncTop(false); const [aim, eye] = homeView(); glideTo(aim, eye); },
    setTop: (top) => { // looking straight down keeps the direction it is already turned to, so the view only tilts
      topView = top;
      if (!top) { const [aim, eye] = homeView(); glideTo(aim, eye); return; }
      const theta = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target)).theta;
      let aim = new THREE.Vector3(), radius = 92; // a wide screen looks down from 92 m; a narrow one from as far out as shows the whole crossing (fitView), so the junction is not cut at the sides
      if (camera.aspect < REF_ASPECT) { const [a, e] = fitView(junctionPoints(), new THREE.Vector3().setFromSpherical(new THREE.Spherical(1, .02, theta)).negate()); aim = a; radius = e.distanceTo(a); }
      glideTo(aim, new THREE.Spherical(radius, .02, theta));
    },
    openCamera: (index) => { pipPoint = cameraList[index]; }, closeCamera: () => { pipPoint = null; }, focusCamera,
    setQuality: (level) => { const low = level === 'low'; renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio || 1, PIXEL_CAP)); sun.castShadow = !low; renderer.shadowMap.needsUpdate = true; resize(); },
  },
});
function updateHud() {
  const week = sim.controller.clockStart + sim.snapshot.time;
  shell.update({ clockText: clockOf(week), dayText: dayName(week), night: lastSky ? lastSky.lights : night, snap: sim.snapshot, ahead: aheadNow(), summary: { ...sim.summary(), queueNow: sim.queuedNow() }, counts: cameraCounts() });
}
// what is near the camera, for the sound: vehicles with their speed, the emergency vehicles, the crossings that show walk
let soundTimer = 0;
function updateSound() {
  const traffic = [], sirens = [], ticks = [], e = camera.matrixWorld.elements;
  for (const t of tracks.vehicles.values()) { if (!t.mesh) continue; const p = t.mesh.position; traffic.push({ id: t.id, cls: t.cls, x: p.x, z: p.z, v: t.v }); if (t.cls === 'amb' || t.cls === 'fire' || t.cls === 'police') sirens.push({ x: p.x, z: p.z }); }
  for (let k = 0; k < 4; k += 1) if (sim.snapshot.signals[`C${k + 1}`] === 'walk') { const [x, z] = rot(k, 0, CROSSING_Y); ticks.push({ x, z }); }
  sound.update({ traffic, sirens, ticks, listener: { x: camera.position.x, z: camera.position.z, rx: e[0], rz: e[2] }, night, day: lastSky ? lastSky.day : 1 - night, rain: lastSky ? lastSky.rain : 0, wind: 0.08 + 0.2 * (lastSky ? lastSky.cover : 0) });
}

// ---------- main loop ----------
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); homeAt = null;
}
window.addEventListener('resize', resize); resize();
{ const [aim, eye] = homeView(); camera.position.copy(eye); controls.target.copy(aim); controls.update(); } // the page opens on the start view for the shape of this screen

const clock = new THREE.Clock();
let hudTimer = 0;
capture();

// The triangles of everything solid that stands still, put in a grid a few thousand at a time so the first frame does not wait for it. People, vehicles and the sky move, so they are left out here and kept clear of by their own boxes.
function startClearance() {
  const moving = new Set([skyDome.group, treeSet.group, ...buildings, ...parkPeople.map((person) => person.mesh)]); // the buildings are kept clear of by their footprints (lotBoxes: a point inside a closed building cannot be told which way out is), and the trees by their crowns (treeSpots), which sway
  const triangles = collectTriangles(scene, THREE, { reach: 160, skip: (o) => moving.has(o) || o.userData.noCollide, solid: (m) => !m.transparent && m.blending !== THREE.AdditiveBlending && m.side !== THREE.BackSide && !m.isMeshBasicMaterial });
  const grid = createTriangleGrid(triangles, CAMERA_CLEARANCE);
  const step = () => { if (grid.build(60000)) clearGrid = grid; else setTimeout(step, 0); };
  step();
}
startClearance();

let shadowTick = 0;
// Each car park, with the simulated vehicles in the near lane of its street: where they are along the aisle's line and how fast, so that a car does not cross or join in front of one.
function updateCarParks(time, dt) {
  carparkTime = time;
  const week = sim.controller.clockStart + sim.snapshot.time, hour = (week % 86400) / 3600, weekend = Math.floor((week % 604800) / 86400) > 4;
  for (const v of venues) {
    const street = [];
    for (const s of tracks.vehicles.values()) {
      const car = s.vehicle;
      if (car.approach !== v.k + 1 || car.exitVia !== 1 || car.movement !== 'through' || car.d >= 0 || !s.curr) continue; // the vehicles turned into this street
      const [fx] = rot((4 - v.k) % 4, s.curr.fx, s.curr.fz);
      street.push({ a: fx - VENUE_AT, v: car.v });
    }
    v.life.update(dt, { hour, weekend, street });
  }
}
function frame() {
  const dt = Math.min(clock.getDelta(), .1), time = clock.elapsedTime;
  acc += dt * speed;
  let steps = 0;
  while (acc >= DT && steps < 40) { sim.step(); capture(); acc -= DT; steps += 1; }
  if (steps >= 40) acc = 0;
  const alpha = Math.min(1, acc / DT);
  const sirens = [];
  for (const s of tracks.vehicles.values()) {
    const lerp = (a, b) => a + (b - a) * alpha;
    const fx = lerp(s.prev.fx, s.curr.fx), fz = lerp(s.prev.fz, s.curr.fz), rx = lerp(s.prev.rx, s.curr.rx), rz = lerp(s.prev.rz, s.curr.rz);
    const x = (fx + rx) / 2, z = (fz + rz) / 2, u = s.mesh.userData;
    s.mesh.position.set(x, TYRE_LIFT, z); s.mesh.rotation.y = -Math.atan2(fz - rz, fx - rx); fadeOut(s.mesh, x, z);
    u.tail.emissiveIntensity = s.braking ? 2.6 : .25 + .8 * (lastSky ? lastSky.lights : night);
    const side = indicatorOf(s.vehicle, sim.time), blink = Math.floor(time * 3) % 2 === 0; // about 1.5 flashes a second
    u.indL.emissiveIntensity = side === 'left' && blink ? 3.4 : 0; u.indR.emissiveIntensity = side === 'right' && blink ? 3.4 : 0;
    if (u.siren) {
      const on = Math.floor(time * 6) % 2 === 0;
      u.siren.blue.material.emissiveIntensity = on ? 3 : .2; u.siren.red.material.emissiveIntensity = on ? .2 : 3;
      sirens.push({ mesh: s.mesh, siren: u.siren });
    }
  }
  lightSirens(sirens, Math.floor(time * 6) % 2 === 0);
  shortenBeams([...tracks.vehicles.values()].filter((s) => s.mesh && s.mesh.visible));
  updatePedestrians(time, alpha); updateSignals(time); updatePark(time, dt * speed); for (const hub of hubs) hub.life.update(time, dt * speed); updateCarParks(time, dt * speed); updateCourtyards(dt * speed); fountainModel.update(time, dt); pondModel.update(time, dt);
  const week = sim.controller.clockStart + sim.snapshot.time, sky = skyDome.update({ hour: (week % 86400) / 3600, ms: Date.now(), time, dt, lock: lookLock, calm, centre: controls.target, pixelRatio: renderer.getPixelRatio() });
  night = sky.night; lastSky = sky; sim.rain = sky.rain; applyLight(); shell.light(sky.lights);
  for (const m of wetMaterials) m.roughness = .95 - .55 * sky.wet; // a wet road shines
  swayTrees(time);
  const stageKey = `${sim.snapshot.phase}${sim.snapshot.stage}`; // a change of light shows on the overlay in the same frame, not up to a quarter of a second later
  hudTimer += dt; if (hudTimer > .25 || stageKey !== lastStageKey) { hudTimer = 0; lastStageKey = stageKey; updateHud(); }
  soundTimer += dt; if (soundTimer > .1) { soundTimer = 0; updateSound(); }
  updateGlide();
  applyFingers(); applyKeys(dt);
  controls.update();
  keepClear(dt);
  const [homeAim, homeEye] = homeView(), away = camera.position.distanceTo(homeEye) > 1 || controls.target.distanceTo(homeAim) > 1; // anywhere but the start view, however it got there: a place, a camera, a drag or the top-down view
  if (away !== wasAway) { wasAway = away; shell.setAway(away); }
  if (detector.state === 'on' && Math.floor(sim.time) > sampledAt) { sampledAt = Math.floor(sim.time); sampleDetection(); }
  detector.frame(); // before the frame is drawn: it draws a camera's view into the corner of the buffer, and the frame draws over that
  if (pipPoint) drawCameraView();
  renderer.shadowMap.needsUpdate = (shadowTick += 1) % 2 === 1; // the shadow map is drawn on the first frame and then every second one
  skyDome.follow(camera.position); renderer.render(scene, camera);
  placeMarkers(); placeAlerts();
  requestAnimationFrame(frame);
}
await Promise.race([weatherReady, new Promise((resolve) => setTimeout(resolve, 2500))]); // the first frame waits for the weather (at most 2.5 s), so the sky and the lamps start as they will stay and do not change a second later
// The loading head stays red until the first frame is drawn. That frame is the slow one (the shaders are compiled for it, which can take seconds on some devices), so it is drawn now, behind the head, and only then
// does the head turn green, get painted, and go.
applyLight(); updateHud();
{ // Everything is drawn once with culling off, so every shader is compiled and every shape and texture is uploaded now. Otherwise each is done the first time it comes into view, which is a dropped frame.
  const culled = []; scene.traverse((o) => { if (o.frustumCulled) { culled.push(o); o.frustumCulled = false; } });
  renderer.shadowMap.needsUpdate = true; skyDome.follow(camera.position); renderer.render(scene, camera);
  for (const o of culled) o.frustumCulled = true;
}
frame();
const loading = document.getElementById('status');
if (loading) { loading.classList.add('go'); await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))); setTimeout(() => loading.remove(), 400); }
window.__scene3d = { step() { sim.step(); capture(); acc = DT * 0.999999; }, get speed() { return speed; }, set speed(n) { speed = n; }, exportFrame, shortenBeams, peds, detector, venues, courtyards, courtyardLife, playLife, hubs, get lights() { return lastSky && lastSky.lights; }, kerbMat, pathMat, get clearGrid() { return clearGrid; }, resolveClear, keepClear, wetMaterials, busDecals, sun, hemi, sim, scene, camera, controls, THREE, renderer, tracks, lotBoxes, treeSpots, lampSpots, cameraPoints, openCamera: (i) => shell.openCamera(i), sky: () => lastSky, sound, parkPeople, ZONES, inPark, PARK_C, setNight: (v) => { lookLock = v; }, skyDome };
