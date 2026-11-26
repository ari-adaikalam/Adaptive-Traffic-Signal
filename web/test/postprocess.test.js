// From the model's output to counts (src/detection/postprocess.js): boxes are decoded and de-duplicated, put back in the whole picture and on the road, and counted by the one camera that owns the place
import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraFrom, cropBox, pictureBox, rigSegments, stripCorners } from '../src/detection/labels.js';
import { INPUT_WIDTH, countFor, decode, inputShape, iou, laneOf, nms, toWholePicture } from '../src/detection/postprocess.js';

test('the input is 640 across, as tall as the crop in proportion rounded up to a multiple of 32, and the picture goes at the top', () => {
  const s = inputShape(960, 214);
  assert.equal(s.width, INPUT_WIDTH); assert.equal(s.height % 32, 0);
  assert.ok(Math.abs(s.scale - 640 / 960) < 1e-12 && s.height >= 214 * s.scale && s.height < 214 * s.scale + 32);
  assert.ok(Math.abs(s.pad - (s.height - 214 * s.scale)) < 1e-9);
});

test('the output is read as boxes with scores, and a box below the threshold is dropped', () => {
  const boxes = 3, out = new Float32Array(8 * boxes); // 4 box numbers and 4 class scores for each of three boxes, laid out one row at a time
  const put = (i, cx, cy, w, h, scores) => { out[i] = cx; out[boxes + i] = cy; out[2 * boxes + i] = w; out[3 * boxes + i] = h; scores.forEach((v, c) => { out[(4 + c) * boxes + i] = v; }); };
  put(0, 100, 50, 40, 20, [0.9, 0.1, 0, 0]); put(1, 300, 60, 80, 30, [0.1, 0.2, 0.7, 0]); put(2, 200, 50, 10, 10, [0.2, 0.1, 0.1, 0.1]);
  const d = decode(out, boxes);
  assert.equal(d.length, 2);
  assert.deepEqual([d[0].cls, d[0].x0, d[0].x1, d[0].y0, d[0].y1], [0, 80, 120, 40, 60]);
  assert.equal(d[1].cls, 2);
});

test('two boxes of the same class on the same vehicle become one, and a box of another class, or a vehicle beside it, stays', () => {
  const a = { cls: 0, score: 0.9, x0: 0, y0: 0, x1: 10, y1: 10 }, b = { cls: 0, score: 0.6, x0: 1, y0: 1, x1: 11, y1: 11 }, c = { cls: 2, score: 0.5, x0: 0, y0: 0, x1: 10, y1: 10 }, e = { cls: 0, score: 0.8, x0: 30, y0: 0, x1: 40, y1: 10 };
  assert.ok(iou(a, b) > 0.6 && iou(a, e) === 0);
  assert.deepEqual(nms([b, a, c, e]).map((x) => x.score).sort(), [0.5, 0.8, 0.9]);
});

// The straight road of the tests of labels.js: lanes at z = 0 to 10, the stop line at x = 0 and the distance running along -x, two cameras at 20 and 60 m, 12 m back and 10 m up, a 130 degree lens.
const camAt = (d) => cameraFrom({ pos: [-d, 10, -12], right: [-1, 0, 0], up: [0, 1, 0], forward: [0, 0, 1], hfov: 130 * Math.PI / 180, aspect: 16 / 9 });
const toWorld = (d, l) => [-d, l], toRoad = (x, z) => ({ d: -x, lateral: z });
const rig = rigSegments([20, 60], 80, 8), cams = [camAt(20), camAt(60)];
const car = (x, z, id = 1) => ({ id, kind: 'car', x, z, yaw: 0, length: 4.5, width: 1.9, height: 1.5 });

test('a box in the model\'s input goes back to the right place in the whole picture, and the vehicle is found on the road', () => {
  const crop = cropBox(cams[0], stripCorners(toWorld, rig[0].crop)), W = 1920, H = 1080; // the whole picture, in pixels
  const cropW = (crop.x1 - crop.x0) * W, cropH = (crop.y1 - crop.y0) * H, shape = inputShape(cropW, cropH);
  const v = car(-18, 5), whole = pictureBox(cams[0], v, { minPixels: 1 });
  // the box as the model would see it: in the crop, scaled, at the top of the padded input
  const inBox = { x0: (whole.x0 - crop.x0) * W * shape.scale, x1: (whole.x1 - crop.x0) * W * shape.scale, y0: (whole.y0 - crop.y0) * H * shape.scale, y1: (whole.y1 - crop.y0) * H * shape.scale };
  const back = toWholePicture(inBox, shape, crop, cropW, cropH);
  for (const k of ['x0', 'x1', 'y0', 'y1']) assert.ok(Math.abs(back[k] - whole[k]) < 1e-9, k);
});

test('a detection is counted by the camera that owns where the vehicle stands, in the lane it stands in, and not by the other camera', () => {
  const lanes = [[-30, 1.5, 2], [-30, 5, 1], [-30, 8.5, 0], [-55, 5, 1]]; // [x, z, the lane it should be counted in]
  for (const [x, z, lane] of lanes) {
    const v = car(x, z), counted = rig.map((segment, i) => {
      const whole = pictureBox(cams[i], v, { minPixels: 1 }); if (!whole) return null;
      return countFor({ detections: [{ cls: 0, whole }], cam: cams[i], segment, toRoad });
    });
    const got = counted.filter((c) => c && c.vehicles.length);
    assert.equal(got.length, 1, `at ${x}, ${z}: counted by ${got.length} cameras`);
    assert.equal(got[0].counts.cars, 1); assert.equal(got[0].lanes[laneOf(z)], 1); assert.equal(laneOf(z), lane);
  }
});

test('a vehicle in another carriageway, or on the footpath, is not counted by either camera', () => {
  for (const z of [15, 20, -5]) for (const i of [0, 1]) {
    const whole = pictureBox(cams[i], car(-30, z), { minPixels: 1 }); if (!whole) continue;
    assert.equal(countFor({ detections: [{ cls: 0, whole }], cam: cams[i], segment: rig[i], toRoad }).vehicles.length, 0, `z ${z}, camera ${i}`);
  }
});

import { PAD_VALUE, prepareInput } from '../src/detection/postprocess.js';

test('the picture is scaled to 640 across, padded below with grey, and given as planar floats', () => {
  const w = 640, h = 100, data = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i += 1) { data[i * 4] = 255; data[i * 4 + 1] = 0; data[i * 4 + 2] = 128; data[i * 4 + 3] = 255; } // all one colour
  const shape = inputShape(w, h), out = prepareInput({ width: w, height: h, data }, shape), plane = shape.width * shape.height, rows = Math.round(h * shape.scale);
  assert.equal(out.length, 3 * plane);
  assert.ok(Math.abs(out[0] - 1) < 1e-6 && Math.abs(out[plane]) < 1e-6 && Math.abs(out[2 * plane] - 128 / 255) < 1e-6, 'red, green and blue in their own planes');
  assert.ok(Math.abs(out[(rows - 1) * shape.width] - 1) < 1e-6, 'the last row of the picture');
  assert.ok(Math.abs(out[rows * shape.width] - PAD_VALUE / 255) < 1e-6, 'and grey below it');
});

import { SHAPES, place } from '../src/detection/postprocess.js';
import { standingPoint } from '../src/detection/labels.js';

test('where a vehicle stands is found within a fifth of a metre when its class is right, and the bias of the bottom edge is gone', () => {
  const shapeOf = (cls) => SHAPES[cls];
  let worstPlain = 0, worstPlaced = 0, n = 0;
  for (const cls of [0, 2]) for (const [i, cam] of cams.entries()) for (const lateral of [1.6, 4.8, 8]) for (let d = rig[i].own[0] - 6; d <= rig[i].own[1] + 6; d += 3) {
    const yaw = Math.atan2(0, 1), [x, z] = toWorld(d, lateral), box = pictureBox(cam, { x, z, yaw, ...shapeOf(cls) }, { minPixels: 1 }); if (!box) continue;
    const plain = toRoad(...[standingPoint(cam, box)].map((p) => [p[0], p[2]])[0]), placed = place({ cam, box, cls, toWorld, toRoad });
    worstPlain = Math.max(worstPlain, Math.abs(plain.d - d)); worstPlaced = Math.max(worstPlaced, Math.abs(placed.d - d), Math.abs(placed.lateral - lateral)); n += 1;
  }
  assert.ok(n > 40, `${n} places tried`);
  assert.ok(worstPlain > 0.5, `the bottom edge alone is off by ${worstPlain.toFixed(2)} m, so there is something to take out`);
  assert.ok(worstPlaced < 0.2, `placed within ${worstPlaced.toFixed(3)} m`);
});

test('a vehicle of another length than the typical one is still placed within half a metre', () => {
  for (const [i, cam] of cams.entries()) for (const length of [4.0, 5.4]) for (let d = rig[i].own[0] - 4; d <= rig[i].own[1] + 4; d += 5) {
    const [x, z] = toWorld(d, 5), box = pictureBox(cam, { x, z, yaw: 0, length, width: 1.8, height: 1.5 }, { minPixels: 1 }); if (!box) continue;
    const placed = place({ cam, box, cls: 0, toWorld, toRoad });
    assert.ok(Math.abs(placed.d - d) < 0.5, `camera ${i}, d ${d}, length ${length}: ${placed.d.toFixed(2)}`);
  }
});
