// From what the model returns to the counts the controller reads. This file has no Three.js, no page and no model runtime in it, so the page and the evaluation in Node (web/tools/detect-eval.mjs) use the same code, and
// it is tested under node (web/test/postprocess.test.js). See docs/detector.md.
//
// The path of one camera's picture: it is cropped to the road the camera owns and its lanes are masked (labels.js), scaled to INPUT_WIDTH across and padded down to a multiple of 32 (`inputShape`), and given to the
// model. The model returns a list of boxes with a score for each class (`decode`), duplicates are removed (`nms`), each box is put back in the whole picture (`toWholePicture`), and the middle of its bottom edge is put on
// the road (`standingPoint`), which gives its distance from the stop line and its lane. A camera counts a vehicle only if it stands in the lanes and in the stretch the camera owns (`countFor`).
import { CLASSES, inLanes, owns, pictureBox, standingPoint } from './labels.js';

export const INPUT_WIDTH = 640; // the model sees every crop at this width, whatever its size, so a vehicle has the same size in pixels in training and when it runs
export const PAD_VALUE = 114; // the grey the picture is padded with, as in training

// The size the model's input is made, for a crop of this size: INPUT_WIDTH across, the height in proportion and then up to a multiple of 32 (the network halves the picture five times). The picture goes at the top.
export function inputShape(cropWidth, cropHeight) {
  const scale = INPUT_WIDTH / cropWidth, height = Math.ceil(cropHeight * scale / 32) * 32;
  return { scale, width: INPUT_WIDTH, height, pad: height - cropHeight * scale };
}

// The picture as the model takes it: `image` is { width, height, data } with the pixels as RGBA bytes. It is scaled to INPUT_WIDTH across (bilinear), padded at the bottom with grey, and returned as planar floats from 0 to 1
// (all the reds, then all the greens, then all the blues), which is the model's input of shape [1, 3, shape.height, shape.width].
export function prepareInput(image, shape) {
  const { width: sw, height: sh, data } = image, W = shape.width, H = shape.height, out = new Float32Array(3 * W * H).fill(PAD_VALUE / 255), rows = Math.round(sh * shape.scale);
  for (let y = 0; y < rows; y += 1) {
    const fy = Math.min(sh - 1, (y + 0.5) / shape.scale - 0.5), y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < W; x += 1) {
      const fx = Math.min(sw - 1, (x + 0.5) / shape.scale - 0.5), x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      for (let c = 0; c < 3; c += 1) {
        const p = (yy, xx) => data[(yy * sw + xx) * 4 + c];
        out[c * W * H + y * W + x] = ((p(y0, x0) * (1 - tx) + p(y0, x1) * tx) * (1 - ty) + (p(y1, x0) * (1 - tx) + p(y1, x1) * tx) * ty) / 255;
      }
    }
  }
  return out;
}

// The model's output is [4 + classes, boxes] (the middle and size of each box in input pixels, then a score for each class), stored one row after another. Returns the boxes whose best score is at least `conf`,
// as { cls, score, x0, y0, x1, y1 } in input pixels.
export function decode(output, boxes, classes = CLASSES.length, conf = 0.25) {
  const out = [];
  for (let i = 0; i < boxes; i += 1) {
    let best = -1, score = 0;
    for (let c = 0; c < classes; c += 1) { const v = output[(4 + c) * boxes + i]; if (v > score) { score = v; best = c; } }
    if (best < 0 || score < conf) continue;
    const cx = output[i], cy = output[boxes + i], w = output[2 * boxes + i], h = output[3 * boxes + i];
    out.push({ cls: best, score, x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 });
  }
  return out;
}

const area = (b) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
export function iou(a, b) {
  const inter = area({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });
  return inter / (area(a) + area(b) - inter || 1);
}
// Of boxes that overlap by more than `threshold` and are of the same class, only the one with the best score is kept. (A car and the bus it is beside are not the same class, so a bus box that covers a car stays.)
export function nms(boxes, threshold = 0.5) {
  const kept = [];
  for (const b of [...boxes].sort((p, q) => q.score - p.score)) if (!kept.some((k) => k.cls === b.cls && iou(k, b) > threshold)) kept.push(b);
  return kept;
}

// A box in the model's input pixels to a box in the whole picture (shares of it, y down): take off the padding, undo the scale, and put it where the crop is in the whole picture.
export function toWholePicture(box, shape, crop, cropWidth, cropHeight) {
  const u = (x) => crop.x0 + Math.min(1, Math.max(0, x / shape.scale / cropWidth)) * (crop.x1 - crop.x0), v = (y) => crop.y0 + Math.min(1, Math.max(0, y / shape.scale / cropHeight)) * (crop.y1 - crop.y0);
  return { x0: u(box.x0), x1: u(box.x1), y0: v(box.y0), y1: v(box.y1) };
}

// The lane of a place across the road (metres from the edge of the right-turn lane): the controller counts the right-turn lane (2), the middle lane (1) and the kerb lane, which is the bus lane when it is open (0).
export const LANE_WIDTH = 3.2;
export const laneOf = (lateral) => (lateral > 2 * LANE_WIDTH ? 0 : lateral > LANE_WIDTH ? 1 : 2);

// A typical vehicle of each class (metres), for working out where a detected one stands. The model finds a class, not a make: a van and a car are both "cars" to the controller, and the error in placing a vehicle
// because its length is a little different from the typical one is under 0.3 m.
export const SHAPES = [{ length: 4.6, width: 1.9, height: 1.5 }, { length: 8.5, width: 2.4, height: 3.2 }, { length: 12, width: 2.5, height: 3.1 }, { length: 1.9, width: 0.8, height: 1.5 }];

// Where a detected vehicle stands on the road. The middle of the bottom edge of its box is put on the road, but that point is on the near side of its body and not at its middle, so it is off toward the camera
// by a little that grows with the distance along the road from the camera (about 0.5 m at 20 m, 2.5 m at the far end), and in the opposite way for two cameras either side of a vehicle. That error is geometry, so it is
// taken out: a vehicle of the class is put on the road where the estimate says, its box is worked out the same way, and the place is moved by the difference, a few times over. Returns { d, lateral } or null.
export function place({ cam, box, cls, toWorld, toRoad }) {
  const first = standingPoint(cam, box); if (!first) return null;
  const raw = toRoad(first[0], first[2]), shape = SHAPES[cls] || SHAPES[0];
  const [x0, z0] = toWorld(0, raw.lateral), [x1, z1] = toWorld(1, raw.lateral), yaw = Math.atan2(-(z1 - z0), x1 - x0); // the vehicle lies along the road
  let at = { ...raw };
  for (let i = 0; i < 6; i += 1) {
    const [x, z] = toWorld(at.d, at.lateral), sim = pictureBox(cam, { x, z, yaw, ...shape }, { minInside: 0, minPixels: 0, minUnmasked: 0 }); if (!sim) break;
    const pointed = standingPoint(cam, sim); if (!pointed) break;
    const seen = toRoad(pointed[0], pointed[2]);
    at = { d: at.d + raw.d - seen.d, lateral: at.lateral + raw.lateral - seen.lateral };
  }
  return at;
}

// What one camera counts from its detections: the vehicles that stand in the lanes of the road and in the stretch this camera owns, by class and by lane. `cam` is the camera, `segment` the stretch it owns (labels.js
// rigSegments), `toRoad(x, z)` puts a place in the world on the road ({ d: metres from the stop line, lateral: metres across the lanes }) and `toWorld(d, lateral)` does the opposite. Returns { counts: {cars, ...},
// lanes: [n, n, n] (kerb, middle, right-turn), byLane: the same by class, vehicles: the ones counted, each with its place on the road }.
export function countFor({ detections, cam, segment, toRoad, toWorld = null, lateral = [0, 3 * LANE_WIDTH] }) {
  const counts = Object.fromEntries(CLASSES.map((n) => [n, 0])), lanes = [0, 0, 0], byLane = [0, 1, 2].map(() => Object.fromEntries(CLASSES.map((n) => [n, 0]))), vehicles = [];
  for (const d of detections) {
    const road = toWorld ? place({ cam, box: d.whole, cls: d.cls, toWorld, toRoad }) : (() => { const at = standingPoint(cam, d.whole); return at && toRoad(at[0], at[2]); })();
    if (!road) continue;
    if (!inLanes(road, segment.own, lateral) || !owns(segment, road.d)) continue; // another lane, or the other camera's road
    counts[CLASSES[d.cls]] += 1; lanes[laneOf(road.lateral)] += 1; byLane[laneOf(road.lateral)][CLASSES[d.cls]] += 1; vehicles.push({ ...d, road });
  }
  return { counts, lanes, byLane, vehicles };
}
