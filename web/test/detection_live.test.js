// Camera detection on the page (src/detection/live.js), with a fake worker and a fake camera: counts reach the controller's source, and every way it can go wrong ends as "unknown", never as a wrong count
import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveDetector } from '../src/detection/live.js';
import { cameraFrom, cropBox, pictureBox, rigSegments, stripCorners } from '../src/detection/labels.js';
import { inputShape } from '../src/detection/postprocess.js';

// The straight road of the other detection tests, with two cameras
const toWorld = (d, l) => [-d, l], toRoad = (x, z) => ({ d: -x, lateral: z }), camAt = (d) => cameraFrom({ pos: [-d, 10, -12], right: [-1, 0, 0], up: [0, 1, 0], forward: [0, 0, 1], hfov: 130 * Math.PI / 180, aspect: 16 / 9 });
const rig = rigSegments([20, 60], 80, 8), cams = [camAt(20), camAt(60)], here = toRoad;
const car = (x, z) => ({ id: 1, kind: 'car', x, z, yaw: 0, length: 4.5, width: 1.9, height: 1.5 });
const W = 960, H = 192;

// A camera that photographs the road with the given cars on it, and a worker that "detects" exactly those cars, in the model's input pixels
function rigWith(cars) {
  const crops = rig.map((r, i) => cropBox(cams[i], stripCorners(toWorld, r.crop)));
  const capture = (index) => { const i = index % 2; return { canvas: { width: W, height: H, getContext: () => ({ getImageData: () => ({ data: { buffer: new ArrayBuffer(8) } }) }) }, area: crops[i], segment: rig[i], cam: cams[i], here, toWorld, camera: i }; };
  const shape = inputShape(W, H);
  const createWorker = () => {
    const worker = { terminated: false, sent: [], terminate() { this.terminated = true; },
      postMessage(m) {
        this.sent.push(m);
        if (m.type === 'load') queueMicrotask(() => worker.onmessage({ data: worker.failLoad ? { type: 'error', message: 'no model' } : { type: 'ready' } }));
        if (m.type === 'run' && !worker.silent) queueMicrotask(() => {
          const i = (m.id - 1) % 2, c = crops[i], detections = [];
          for (const v of cars) { const box = pictureBox(cams[i], v, { minPixels: 1 }); if (!box) continue; const toIn = (u, a, b, size) => ((u - a) / (b - a)) * size * shape.scale; detections.push({ cls: 0, score: 0.9, x0: toIn(box.x0, c.x0, c.x1, W), x1: toIn(box.x1, c.x0, c.x1, W), y0: toIn(box.y0, c.y0, c.y1, H), y1: toIn(box.y1, c.y0, c.y1, H) }); }
          worker.onmessage({ data: { type: 'result', id: m.id, shape, detections, ms: 5 } });
        });
      } };
    return worker;
  };
  return { capture, createWorker };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
async function started(cars, extra = {}) {
  let clock = 0, sim = 10; const { capture, createWorker } = rigWith(cars), made = [];
  const live = new LiveDetector({ capture, now: () => sim, createWorker: () => { const w = createWorker(); made.push(w); return w; }, modelUrl: 'model.onnx', wall: () => clock, roads: [[0, 1]], ...extra });
  live.start(); await flush();
  return { live, made, tick: async (n = 1) => { for (let i = 0; i < n; i += 1) { clock += 0.2; live.frame(); await flush(); } }, setSim: (t) => { sim = t; }, worker: () => made.at(-1) };
}

test('the model loads, then the cameras are photographed one after the other, and the counts reach the controller for the road', async () => {
  const t = await started([car(-18, 5), car(-55, 8.5)]);
  assert.equal(t.live.status().state, 'on');
  assert.equal(t.live.source(1, 10), null, 'nothing yet');
  await t.tick(2); // camera 0, then camera 1
  const c = t.live.source(1, 10);
  assert.ok(c, 'both cameras of the road have reported');
  assert.equal(c.general.cars, 2, 'the two cars, each counted by the camera that owns its place: not once each by both');
  assert.equal(c.right.cars, 0);
  assert.equal(t.live.status().cameras, 'on');
});

test('the same car seen by both cameras is counted once', async () => {
  const t = await started([car(-40, 5)]); // in the overlap
  await t.tick(2);
  assert.equal(t.live.source(1, 10).general.cars, 1);
});

test('a model that does not load leaves detection in error, and the controller gets nothing', async () => {
  let made; const live = new LiveDetector({ capture: () => null, now: () => 0, createWorker: () => { made = rigWith([]).createWorker(); made.failLoad = true; return made; }, modelUrl: 'x', roads: [[0, 1]] });
  live.start(); await flush();
  assert.equal(live.status().state, 'error'); assert.equal(live.status().message, 'no model'); assert.ok(made.terminated);
  assert.equal(live.source(1, 0), null);
  const none = new LiveDetector({ capture: () => null, now: () => 0, createWorker: () => { throw new Error('no workers here'); }, modelUrl: 'x', roads: [[0, 1]] });
  none.start(); assert.equal(none.status().state, 'error');
});

test('a worker that stops answering costs only its counts: they go stale, then unknown, and detection tries again', async () => {
  const t = await started([car(-18, 5)]);
  await t.tick(2); assert.ok(t.live.source(1, 10));
  t.worker().silent = true; await t.tick(1); // a picture is sent and never comes back
  assert.ok(t.live.busy);
  t.setSim(20); assert.equal(t.live.source(1, 20), null, 'ten seconds on, the old counts are not used');
  await t.tick(30); // 6 s of the page's clock: the lost picture is given up
  assert.equal(t.live.busy ? t.live.busy.id > 3 : true, true, 'it asked again');
  t.worker().silent = false; t.setSim(30); await t.tick(35); // the picture still waiting is given up after 5 s, and then new ones are answered
  assert.ok(t.live.source(1, 30), 'and when the worker answers again the counts come back');
});

test('switching it off stops the worker and the counts', async () => {
  const t = await started([car(-18, 5)]);
  await t.tick(2); assert.ok(t.live.source(1, 10));
  t.live.stop();
  assert.ok(t.worker().terminated); assert.equal(t.live.status().state, 'off'); assert.equal(t.live.source(1, 10), null);
  t.live.frame(); assert.equal(t.worker().sent.filter((m) => m.type === 'run').length, 2, 'and no more pictures are sent');
});

test('a camera that cannot be photographed (the stretch is not in front of the lens) leaves its road unknown, not smaller', async () => {
  let clock = 0; const { createWorker } = rigWith([car(-18, 5)]), live = new LiveDetector({ capture: () => null, now: () => 10, createWorker, modelUrl: 'x', wall: () => clock, roads: [[0, 1]] });
  live.start(); await flush(); for (let i = 0; i < 6; i += 1) { clock += 0.2; live.frame(); await flush(); }
  assert.equal(live.source(1, 10), null); assert.equal(live.status().cameras, 'off');
});

test('a vehicle driven across the line between the two cameras is counted exactly once at every place, by the whole path from picture to count', async () => {
  for (let d = 30; d <= 50; d += 0.25) {
    const t = await started([car(-d, 5)]); await t.tick(2);
    assert.equal(t.live.source(1, 10).general.cars, 1, `at ${d} m`);
  }
});

test('a queue of vehicles 6 m apart across the line is counted whole, whatever its position', async () => {
  for (let shift = 0; shift < 6; shift += 0.5) {
    const cars = [0, 1, 2, 3, 4, 5].map((k) => car(-(22 + shift + 6 * k), 4 + (k % 2)));
    const t = await started(cars); await t.tick(2);
    assert.equal(t.live.source(1, 10).general.cars, 6, `queue shifted by ${shift} m`);
  }
});
