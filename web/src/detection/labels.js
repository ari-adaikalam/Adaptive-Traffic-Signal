// Training labels for the detector, made from the simulation: where a vehicle is in a detection camera's picture, whether it can be seen, and the line that says so in the YOLO text format. This file has no
// Three.js and no page in it, so it runs under node and is tested there (web/test/labels.test.js). See docs/detector.md.
//
// A camera is { pos: [x, y, z], right, up, forward (unit vectors), hfov (radians), aspect (width / height) }. A vehicle is { x, z, yaw, length, width, height }, with `yaw` the page's mesh.rotation.y (the model's
// length lies along its local x, and the page turns it about y by `yaw`, so a point (a, y, b) of the model is at x + a cos(yaw) + b sin(yaw), z - a sin(yaw) + b cos(yaw)). A picture position is in 0..1 with y down.

export const CLASSES = ['cars', 'trucks', 'buses', 'bikes']; // the controller's count fields, in the order of the class numbers in the label files
export const CLASS_OF = { car: 0, van: 0, police: 0, amb: 0, truck: 1, semi: 1, fire: 1, bus: 2, artbus: 2, bike: 3, scooter: 3 };
export const NEAR = 1; // metres: a vehicle with any corner nearer than this to the lens is not labelled

export function cameraFrom({ pos, right, up, forward, hfov, aspect }) {
  return { pos, right, up, forward, tanH: Math.tan(hfov / 2), tanV: Math.tan(hfov / 2) / aspect };
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// A point in the world to a position in the picture, or null when it is behind the lens or nearer than NEAR.
export function project(cam, p) {
  const d = [p[0] - cam.pos[0], p[1] - cam.pos[1], p[2] - cam.pos[2]], depth = dot(d, cam.forward);
  if (depth < NEAR) return null;
  return { u: 0.5 + dot(d, cam.right) / depth / cam.tanH / 2, v: 0.5 - dot(d, cam.up) / depth / cam.tanV / 2, depth };
}

// The eight corners of a vehicle's box in the world.
export function corners(v) {
  const c = Math.cos(v.yaw), s = Math.sin(v.yaw), out = [];
  for (const a of [-v.length / 2, v.length / 2]) for (const b of [-v.width / 2, v.width / 2]) for (const y of [0, v.height]) out.push([v.x + a * c + b * s, y, v.z - a * s + b * c]);
  return out;
}

// The box round a vehicle in the picture: from its eight corners, cut to the frame. Null when any corner is behind the lens, or when less than `minInside` of the box is in the frame, or when it is
// smaller than `minPixels` across in a picture `width` pixels wide.
export function pictureBox(cam, v, { minInside = 0.5, minPixels = 8, width = 1280, mask = null, minUnmasked = 0.6 } = {}) {
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity, total = 0, kept = 0;
  // With a `mask` (the outline of the lanes in the picture, see laneMask), only the points that show through it count: the picture the detector sees has the rest painted grey, so the box covers what can be seen
  // and a vehicle that is mostly under the grey (under `minUnmasked` of its points showing) is not labelled.
  const take = (p) => {
    const q = project(cam, p); if (!q) return false;
    total += 1; if (mask && !insideHull([q.u, q.v], mask)) return true;
    kept += 1; u0 = Math.min(u0, q.u); u1 = Math.max(u1, q.u); v0 = Math.min(v0, q.v); v1 = Math.max(v1, q.v); return true;
  };
  if (v.points) { for (let i = 0; i < v.points.length; i += 3) if (!take([v.points[i], v.points[i + 1], v.points[i + 2]])) return null; } // the drawn shape: points on the model itself
  else for (const p of corners(v)) if (!take(p)) return null; // the box of its length, width and height
  if (!kept || kept / total < minUnmasked) return null;
  const full = (u1 - u0) * (v1 - v0), x0 = Math.max(0, u0), x1 = Math.min(1, u1), y0 = Math.max(0, v0), y1 = Math.min(1, v1);
  if (x1 <= x0 || y1 <= y0 || full <= 0) return null;
  if ((x1 - x0) * (y1 - y0) / full < minInside || (x1 - x0) * width < minPixels) return null;
  return { x0, x1, y0, y1 };
}

// Does the straight line between two points pass through an axis-aligned box [x0, x1, z0, z1, top] (a building, from the ground to `top`)?
function hitsBox(a, b, box) {
  let t0 = 0, t1 = 1;
  for (const [from, d, lo, hi] of [[a[0], b[0] - a[0], box[0], box[1]], [a[1], b[1] - a[1], 0, box[4]], [a[2], b[2] - a[2], box[2], box[3]]]) {
    if (Math.abs(d) < 1e-9) { if (from < lo || from > hi) return false; continue; }
    let p = (lo - from) / d, q = (hi - from) / d; if (p > q) [p, q] = [q, p];
    t0 = Math.max(t0, p); t1 = Math.min(t1, q); if (t0 >= t1) return false;
  }
  return true;
}
// The same for the body of another vehicle: the line is turned into that vehicle's own frame, where its body is an axis-aligned box.
function hitsVehicle(a, b, v) {
  const c = Math.cos(v.yaw), s = Math.sin(v.yaw), local = (p) => [(p[0] - v.x) * c - (p[2] - v.z) * s, p[1], (p[0] - v.x) * s + (p[2] - v.z) * c];
  return hitsBox(local(a), local(b), [-v.length / 2, v.length / 2, -v.width / 2, v.width / 2, v.height]);
}

// The share of a vehicle that the lens can see, from nine points on it (the middle of its box and eight points just inside its corners) and a line to each. A building or another vehicle on the way hides
// a point. `others` are the other vehicles; `buildings` are the boxes [x0, x1, z0, z1, top].
export function visibleShare(cam, v, others, buildings) {
  const pts = corners({ ...v, length: v.length * 0.8, width: v.width * 0.8, height: v.height * 0.9 }); pts.push([v.x, v.height / 2, v.z]);
  let seen = 0;
  for (const p of pts) {
    let hidden = false;
    for (const b of buildings) if (hitsBox(cam.pos, p, b)) { hidden = true; break; }
    if (!hidden) for (const o of others) if (o !== v && hitsVehicle(cam.pos, p, o)) { hidden = true; break; }
    if (!hidden) seen += 1;
  }
  return seen / pts.length;
}

// The labels for one picture: every vehicle that is in frame, big enough and seen enough, as { cls, box, share, id }.
export function labelsFor(cam, vehicles, buildings, options = {}) {
  const { minShare = 0.4, crop = null, only = null } = options, out = []; // `only(v)`: false for a vehicle that is not this camera's to label (it can still hide another)
  for (const v of vehicles) {
    if (only && !only(v)) continue;
    const whole = pictureBox(cam, v, options); if (!whole) continue;
    const box = crop ? intoCrop(whole, crop) : whole; if (!box) continue; // with a crop, the box is in the crop's own picture
    const share = visibleShare(cam, v, vehicles, buildings); if (share < minShare) continue;
    out.push({ id: v.id, kind: v.kind, cls: CLASS_OF[v.kind] ?? 0, box, share });
  }
  return out;
}

// One line of a YOLO label file: the class, then the middle and the size of the box, as shares of the picture.
export function yoloLine(label) {
  const { x0, x1, y0, y1 } = label.box, f = (n) => n.toFixed(6);
  return `${label.cls} ${f((x0 + x1) / 2)} ${f((y0 + y1) / 2)} ${f(x1 - x0)} ${f(y1 - y0)}`;
}

// ----- what each camera is responsible for: a crop, and the road it owns -----
// Each approach has cameras at known distances (`stations`, metres from the stop line) and a zone (metres) that must be covered. Two neighbouring cameras both see the stretch between them, so the road is
// split: a camera OWNS the stretch from halfway to the camera before it to halfway to the camera after it (the first from the stop line, the last to the end of the zone). A vehicle is counted by the camera that
// owns the place where it meets the road, and by no other. The picture is CROPPED to the owned stretch plus a margin (so a vehicle across the boundary is whole in the crop and the model learns to find it), and
// the same crop is used when the detector runs on the page.
export function rigSegments(stations, zone = 80, margin = 8) {
  return stations.map((at, i) => {
    const from = i === 0 ? 0 : (stations[i - 1] + at) / 2, to = i === stations.length - 1 ? zone : (at + stations[i + 1]) / 2;
    return { own: [from, to], crop: [Math.max(0, from - margin), Math.min(zone, to + margin)], last: i === stations.length - 1 };
  });
}
// Does this camera count a vehicle that meets the road at distance `d` from the stop line? Half open, so a vehicle exactly on a boundary belongs to the camera after it, and the last camera also owns the end of the zone.
export const owns = (segment, d) => d >= segment.own[0] && (d < segment.own[1] || (segment.last && d <= segment.own[1]));

// The corners, in the world, of the strip of road a camera is cropped to: the distances `span` from the stop line, `lateral` across the lanes, from the road up to `top` metres (a tall vehicle's roof). `toWorld(d, lateral)`
// is the page's way of turning a place on the road into [x, z].
export function stripCorners(toWorld, span, lateral = [-0.5, 10.1], top = 3.8) {
  const out = [];
  for (const d of span) for (const l of lateral) { const [x, z] = toWorld(d, l); for (const y of [0, top]) out.push([x, y, z]); }
  return out;
}
// The crop in the picture (shares of it, y down) round those corners, or null when the strip is not in front of the lens. Cut to the frame.
export function cropBox(cam, corners) {
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const p of corners) { const q = project(cam, p); if (!q) return null; u0 = Math.min(u0, q.u); u1 = Math.max(u1, q.u); v0 = Math.min(v0, q.v); v1 = Math.max(v1, q.v); }
  const box = { x0: Math.max(0, u0), x1: Math.min(1, u1), y0: Math.max(0, v0), y1: Math.min(1, v1) };
  return box.x1 - box.x0 > 0.02 && box.y1 - box.y0 > 0.02 ? box : null;
}
// A box given in the whole picture, in the crop's own picture (0 to 1 across the crop), cut to it. Null when under `minInside` of the box is inside the crop.
export function intoCrop(box, crop, minInside = 0.5) {
  const x0 = Math.max(box.x0, crop.x0), x1 = Math.min(box.x1, crop.x1), y0 = Math.max(box.y0, crop.y0), y1 = Math.min(box.y1, crop.y1);
  if (x1 <= x0 || y1 <= y0 || (x1 - x0) * (y1 - y0) / ((box.x1 - box.x0) * (box.y1 - box.y0)) < minInside) return null;
  const w = crop.x1 - crop.x0, h = crop.y1 - crop.y0;
  return { x0: (x0 - crop.x0) / w, x1: (x1 - crop.x0) / w, y0: (y0 - crop.y0) / h, y1: (y1 - crop.y0) / h };
}
// The other way, for a detection: a position in the whole picture to the point on the road (y = 0) that it looks at, or null when the ray does not come down to the road in front of the lens.
export function groundPoint(cam, u, v) {
  const a = (u - 0.5) * 2 * cam.tanH, b = (0.5 - v) * 2 * cam.tanV;
  const dir = [cam.forward[0] + a * cam.right[0] + b * cam.up[0], cam.forward[1] + a * cam.right[1] + b * cam.up[1], cam.forward[2] + a * cam.right[2] + b * cam.up[2]];
  if (dir[1] >= -1e-9) return null;
  const t = -cam.pos[1] / dir[1]; return [cam.pos[0] + t * dir[0], 0, cam.pos[2] + t * dir[2]];
}
// The place on the road where a detected vehicle stands: the middle of the bottom edge of its box, in the whole picture, put onto the road.
export function standingPoint(cam, box) { return groundPoint(cam, (box.x0 + box.x1) / 2, box.y1); }

// ----- only the lanes of this road -----
// The crop is a rectangle, and a camera that looks across the road also has the other carriageway, the footpath and the cross streets in it. They are not this camera's to count, so two things are done, in the capture
// and again when the detector runs: a vehicle is labelled only when it stands in this approach's own lanes and in the camera's stretch (`inLanes`), and everything in the picture outside the lanes is painted over with flat
// grey (`laneMask`), so the model never sees a vehicle in a parallel lane and is not asked to ignore one.

// The corners of the volume a vehicle in the lanes can occupy (see stripCorners, with a top of `MASK_TOP`), as the outline in the picture (shares of the whole picture, y down): the convex hull of where they project to. Null when the volume is not
// in front of the lens.
// The mask is built for vehicles up to 2.2 m high (cars, vans, bikes, scooters). A taller volume would let the other carriageway through, because from a camera up on a building a bus's roof is drawn over the same
// pixels as the near edge of the other carriageway; the cost is that the roof of a bus, truck or fire engine can be cut by the grey. The label filter and the standing point do not depend on pixels.
export const MASK_TOP = 2.2;
export function laneMask(cam, corners) {
  const pts = [];
  for (const p of corners) { const q = project(cam, p); if (!q) return null; pts.push([q.u, q.v]); }
  return hull(pts);
}
// The convex hull of some points, as a polygon in order (the monotone chain).
export function hull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]); if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of [...p].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
// Is a point inside a convex polygon given in order (either way round)?
export function insideHull(point, polygon) {
  let sign = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], c = (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]);
    if (c !== 0) { if (sign === 0) sign = Math.sign(c); else if (Math.sign(c) !== sign) return false; }
  }
  return true;
}
// Is a vehicle in this approach's lanes and this camera's stretch? `at` is where it stands, as { d: metres from the stop line, lateral: metres across the lanes }; the lanes run `lateral[0]` to `lateral[1]` and
// the stretch is `span` (the crop's, so a vehicle across the boundary is kept). The middle of the vehicle is what counts, so a vehicle changing lanes is kept while it is mostly in these ones.
export const inLanes = (at, span, lateral = [0, 9.6]) => at.lateral >= lateral[0] && at.lateral <= lateral[1] && at.d >= span[0] && at.d <= span[1];
