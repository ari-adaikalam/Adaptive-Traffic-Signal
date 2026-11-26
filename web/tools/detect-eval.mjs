// Scores a detector on one split of the training set, the way the page will use it: every picture is a crop of one camera's road with the lanes masked, the model is run, duplicates are removed, each box is put on
// the road, and a vehicle is counted only by the camera that owns the place it stands (src/detection/postprocess.js, the same code as the page). Prints one JSON object with the numbers.
//   NODE_PATH=~/venvs/js/node_modules node web/tools/detect-eval.mjs <model.onnx> <split> [conf] [limit]
// needs onnxruntime-node and jpeg-js (not in this repository: `npm install --prefix ~/venvs/js onnxruntime-node jpeg-js`) and datasets/detection/cameras.json (dump-cameras.mjs).
//
// What is measured, and why these:
//   per vehicle      precision, recall and F1 at IoU 0.5 for the vehicles this camera owns, overall and by class. Counting needs a vehicle to be found, not its edges to be exact, so 0.5.
//   counts           the number of vehicles counted in a camera's stretch against the true number (all vehicles there, including ones hidden behind others, which no camera can see) and against the number that
//                    can be seen: mean absolute error, bias (negative = too few, which shortens a green), and the share of pictures within 1 of the truth. The controller reads counts, so this is the result that matters.
//   by circumstance  the same, split by hour (day, dusk or dawn, night), by weather, by how many vehicles are there, by camera (near and far) and by class.
//   cost             milliseconds a picture takes to run, and the size of the model.
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { cameraFrom, rigSegments } from '../src/detection/labels.js';
import { countFor, decode, inputShape, iou, nms, prepareInput, toWholePicture } from '../src/detection/postprocess.js';
import { STOP_Y, rotate } from '../src/sim/tracks.js';

const require = createRequire(import.meta.url), ort = require('onnxruntime-node'), jpeg = require('jpeg-js');
const [modelPath, split = 'test', confArg = '0.25', limitArg = '0'] = process.argv.slice(2), conf = Number(confArg), limit = Number(limitArg), root = new URL('../../datasets/detection/', import.meta.url).pathname;
const cameras = JSON.parse(readFileSync(`${root}cameras.json`, 'utf8'));

const hourGroup = (h) => (h < 5.75 || h >= 19.25 ? 'night' : h < 7 || h >= 17.5 && h < 19.25 ? 'dusk or dawn' : 'day');
const stats = () => ({ n: 0, tp: 0, fp: 0, fn: 0, abs: 0, bias: 0, within1: 0, absVisible: 0, within1Visible: 0 });
const groups = {}, group = (key) => (groups[key] ||= stats());
const perClass = Object.fromEntries(['cars', 'trucks', 'buses', 'bikes'].map((n) => [n, { tp: 0, fp: 0, fn: 0, truth: 0, abs: 0, bias: 0, n: 0 }]));
const times = [];

const session = await ort.InferenceSession.create(modelPath, { graphOptimizationLevel: 'all' }), inputName = session.inputNames[0];
const files = readdirSync(`${root}${split}/images`).filter((f) => f.endsWith('.jpg')).sort(), pick = limit > 0 ? files.filter((_, i) => i % Math.ceil(files.length / limit) === 0) : files;

for (const file of pick) {
  const name = file.slice(0, -4), meta = JSON.parse(readFileSync(`${root}${split}/meta/${name}.json`, 'utf8')), image = jpeg.decode(readFileSync(`${root}${split}/images/${file}`), { useTArray: true });
  const labels = readFileSync(`${root}${split}/labels/${name}.txt`, 'utf8').split('\n').filter(Boolean).map((l, i) => { const [c, cx, cy, w, h] = l.split(' ').map(Number); return { cls: c, x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2, owned: meta.labels[i].owned }; });
  const shape = inputShape(image.width, image.height), input = new ort.Tensor('float32', prepareInput(image, shape), [1, 3, shape.height, shape.width]);
  const t0 = performance.now(), result = (await session.run({ [inputName]: input }))[session.outputNames[0]]; times.push(performance.now() - t0);
  const boxes = result.dims[2], detections = nms(decode(result.data, boxes, 4, conf)).map((d) => ({ ...d, whole: toWholePicture(d, shape, meta.crop, image.width, image.height), crop: { x0: d.x0 / shape.scale / image.width, x1: d.x1 / shape.scale / image.width, y0: d.y0 / shape.scale / image.height, y1: d.y1 / shape.scale / image.height } }));
  const cam = cameras[Number(name.match(/-c([0-7])-/)[1])], k = cam.approach - 1, segment = { own: cam.own, last: cam.own[1] >= 80 };
  const toRoad = (x, z) => { const [a, b] = rotate((4 - k) % 4, x, z); return { lateral: a, d: STOP_Y - b }; }, toWorld = (d, lateral) => rotate(k, lateral, STOP_Y - d);
  const counted = countFor({ detections, cam: cameraFrom(cam), segment, toRoad, toWorld }), owned = labels.filter((l) => l.owned);
  // per vehicle: each owned label is matched to the best unused counted detection of its class with IoU of 0.5 or more
  const used = new Set(); let tp = 0;
  for (const l of owned) {
    let best = -1, bestIou = 0.5;
    counted.vehicles.forEach((v, i) => { if (!used.has(i) && v.cls === l.cls) { const o = iou(v.crop, l); if (o >= bestIou) { bestIou = o; best = i; } } });
    if (best >= 0) { used.add(best); tp += 1; perClass[['cars', 'trucks', 'buses', 'bikes'][l.cls]].tp += 1; } else perClass[['cars', 'trucks', 'buses', 'bikes'][l.cls]].fn += 1;
  }
  counted.vehicles.forEach((v, i) => { if (!used.has(i)) perClass[['cars', 'trucks', 'buses', 'bikes'][v.cls]].fp += 1; });
  const truth = Object.values(meta.truth).reduce((a, b) => a + b, 0), found = counted.vehicles.length, err = found - truth, errVisible = found - owned.length;
  for (const [i, n] of Object.entries(meta.truth)) { perClass[i].truth += n; perClass[i].n += 1; perClass[i].abs += Math.abs(counted.counts[i] - n); perClass[i].bias += counted.counts[i] - n; }
  const keys = ['all', `hour: ${hourGroup(meta.hour)}`, `weather: ${meta.weather}`, `vehicles in view: ${truth === 0 ? '0' : truth <= 2 ? '1-2' : truth <= 5 ? '3-5' : '6 or more'}`, `camera: ${cam.own[0] === 0 ? 'near' : 'far'}`];
  for (const key of keys) { const g = group(key); g.n += 1; g.tp += tp; g.fp += found - tp; g.fn += owned.length - tp; g.abs += Math.abs(err); g.bias += err; g.within1 += Math.abs(err) <= 1; g.absVisible += Math.abs(errVisible); g.within1Visible += Math.abs(errVisible) <= 1; }
}

const round = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d, prf = (g) => { const p = g.tp / Math.max(1, g.tp + g.fp), r = g.tp / Math.max(1, g.tp + g.fn); return { precision: round(p), recall: round(r), f1: round(2 * p * r / Math.max(1e-9, p + r)) }; };
const report = { model: modelPath, split, pictures: pick.length, conf, sizeMB: round(statSync(modelPath).size / 1e6, 2), msPerPicture: { mean: round(times.reduce((a, b) => a + b, 0) / times.length, 1), p95: round([...times].sort((a, b) => a - b)[Math.floor(times.length * 0.95)], 1) }, groups: {}, classes: {} };
for (const [key, g] of Object.entries(groups)) report.groups[key] = { pictures: g.n, ...prf(g), countMAE: round(g.abs / g.n), countBias: round(g.bias / g.n), within1: round(g.within1 / g.n), visibleMAE: round(g.absVisible / g.n), visibleWithin1: round(g.within1Visible / g.n) };
for (const [key, c] of Object.entries(perClass)) report.classes[key] = { trueVehicles: c.truth, ...prf(c), countMAE: round(c.abs / Math.max(1, c.n)), countBias: round(c.bias / Math.max(1, c.n)) };
console.log(JSON.stringify(report, null, 1));
