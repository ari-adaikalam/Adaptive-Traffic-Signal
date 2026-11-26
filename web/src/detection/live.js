// Camera detection on the page: it takes a picture from one detection camera at a time, hands it to the worker (worker.js), puts what comes back on the road, and gives the controller the counts through the feed
// (feed.js). It has no Three.js and does not start the worker itself, so it runs under node with a fake worker and a fake camera (web/test/detection_live.test.js).
//
// `capture(index)` is the page's: it returns { canvas, area, segment, cam, here } for that camera (cameraPicture in scene/main.js), or null. `now()` is the simulation's clock in seconds, which is the clock
// the controller's counts are in, so a result made 2 s ago is 2 s old to the controller however fast or slow the page is. The page calls `frame()` once per drawn frame, before it draws.
import { DetectionFeed } from './feed.js';
import { countFor, toWholePicture } from './postprocess.js';

export const LOST = 5; // seconds to wait for a picture before giving up on it
export const ROADS = [[0, 1], [2, 3], [4, 5], [6, 7]]; // the cameras of each road, in the order of the page's camera list
export const BOUNDARIES = [[40], [40], [40], [40]]; // the line between the two cameras' stretches of each road (docs/detector.md, How a picture becomes a count)

export class LiveDetector {
  constructor({ capture, now, busLane = () => false, createWorker, modelUrl, interval = 0.125, wall = () => performance.now() / 1000, roads = ROADS, boundaries = BOUNDARIES }) {
    Object.assign(this, { capture, now, busLane, createWorker, modelUrl, interval, wall });
    this.feed = new DetectionFeed(roads, { boundaries }); this.cameras = roads.flat().length;
    this.state = 'off'; this.message = ''; this.worker = null; this.busy = null; this.next = 0; this.lastAt = -Infinity; this.id = 0;
    this.stats = { pictures: 0, ms: 0, lastTrue: null };
  }

  // The controller asks for the count of a road: from the feed, or null (unknown). This is the simulation's `countSource`.
  source = (road, time) => (this.state === 'on' ? this.feed.countsFor(road, time, this.busLane()) : null);

  start() {
    if (this.state === 'loading' || this.state === 'on') return;
    this.state = 'loading'; this.message = '';
    try { this.worker = this.createWorker(); } catch (error) { return this.fail(error.message || String(error)); }
    this.worker.onmessage = ({ data }) => this.onMessage(data);
    this.worker.onerror = (event) => this.fail(event.message || 'the detector stopped');
    this.worker.postMessage({ type: 'load', modelUrl: this.modelUrl });
  }

  stop() {
    if (this.worker) { this.worker.terminate(); this.worker = null; }
    this.state = 'off'; this.busy = null; this.feed = new DetectionFeed(this.feed.roads, this.feed.options);
  }

  fail(message) { this.state = 'error'; this.message = message; this.busy = null; if (this.worker) { this.worker.terminate(); this.worker = null; } }

  onMessage(data) {
    if (data.type === 'ready') { this.state = 'on'; return; }
    if (data.type === 'error') { if (this.state === 'loading') this.fail(data.message); else if (this.busy && data.id === this.busy.id) this.busy = null; return; } // a bad picture is dropped, the detector goes on
    if (data.type !== 'result' || !this.busy || data.id !== this.busy.id) return;
    const { index, pic, time } = this.busy; this.busy = null;
    const w = pic.canvas.width, h = pic.canvas.height;
    const detections = data.detections.map((d) => ({ ...d, whole: toWholePicture(d, data.shape, pic.area, w, h) }));
    const counted = countFor({ detections, cam: pic.cam, segment: pic.segment, toRoad: pic.here, toWorld: pic.toWorld });
    this.feed.submit(index, time, { lanes: counted.byLane, vehicles: counted.vehicles.map((v) => ({ cls: v.cls, d: v.road.d, lateral: v.road.lateral })) });
    this.stats.pictures += 1; this.stats.ms += data.ms;
  }

  // Once per drawn frame, before the page draws: when the worker is free and it is time, one more camera is photographed and sent.
  frame() {
    if (this.state !== 'on') return;
    const at = this.wall();
    if (this.busy && at - this.busy.sentAt > LOST) this.busy = null; // a picture that never came back: stop waiting for it (its camera's result goes stale, which is safe)
    if (this.busy || at - this.lastAt < this.interval) return;
    this.lastAt = at;
    const index = this.next; this.next = (this.next + 1) % this.cameras;
    const pic = this.capture(index); if (!pic) return;
    const { canvas } = pic, image = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    this.id += 1; this.busy = { id: this.id, index, pic, time: this.now(), sentAt: at };
    this.worker.postMessage({ type: 'run', id: this.id, width: canvas.width, height: canvas.height, pixels: image.data.buffer }, [image.data.buffer]);
  }

  // What the page shows: { state: 'off' | 'loading' | 'on' | 'error', cameras: 'on' | 'partial' | 'off' (how many have a fresh result), message, ms (the mean time of a picture in the detector) }.
  status() {
    return { state: this.state, cameras: this.state === 'on' ? this.feed.status(this.now()) : 'off', message: this.message, ms: this.stats.pictures ? this.stats.ms / this.stats.pictures : 0 };
  }
}
