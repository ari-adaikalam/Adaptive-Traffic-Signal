// Runs the detector off the page's main thread, so a slow picture never makes the scene drop a frame. A module worker, started by live.js only when the visitor switches camera detection on.
// It loads onnxruntime-web from a pinned version on jsDelivr and the model from this site, and it answers three messages:
//   { type: 'load', modelUrl }                       -> { type: 'ready' } or { type: 'error', message }
//   { type: 'run', id, width, height, pixels }       -> { type: 'result', id, shape, detections, ms }   pixels: the RGBA bytes of a crop (an ArrayBuffer, handed over)
// A detection is { cls, score, x0, y0, x1, y1 } in the model's input pixels; live.js puts it on the road. Nothing is sent anywhere: the pictures stay in the browser.
import * as ort from 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.wasm.min.mjs';
import { decode, inputShape, nms, prepareInput } from './postprocess.js';

const RUNTIME = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/', CONFIDENCE = 0.25; // the confidence the model was scored at (docs/detector.md)
let session = null;

self.onmessage = async ({ data }) => {
  if (data.type === 'load') {
    try {
      ort.env.wasm.wasmPaths = RUNTIME; ort.env.wasm.numThreads = 1; // one thread: more needs cross-origin isolation, which the page does not ask for
      session = await ort.InferenceSession.create(data.modelUrl, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      const shape = inputShape(960, 192); // a first run on a grey picture, so the first real one is not slow
      await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', new Float32Array(3 * shape.width * shape.height).fill(0.45), [1, 3, shape.height, shape.width]) });
      self.postMessage({ type: 'ready' });
    } catch (error) { self.postMessage({ type: 'error', message: String(error && error.message || error) }); }
    return;
  }
  if (data.type === 'run' && session) {
    try {
      const { id, width, height, pixels } = data, shape = inputShape(width, height), started = performance.now();
      const input = new ort.Tensor('float32', prepareInput({ width, height, data: new Uint8ClampedArray(pixels) }, shape), [1, 3, shape.height, shape.width]);
      const output = (await session.run({ [session.inputNames[0]]: input }))[session.outputNames[0]];
      self.postMessage({ type: 'result', id, shape, detections: nms(decode(output.data, output.dims[2], 4, CONFIDENCE)), ms: performance.now() - started });
    } catch (error) { self.postMessage({ type: 'error', message: String(error && error.message || error), id: data.id }); }
  }
};
