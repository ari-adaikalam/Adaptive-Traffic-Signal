// The training labels (src/detection/labels.js): a vehicle lands where it should in a camera's picture, a hidden one is not labelled, and the label line is the YOLO format
import test from 'node:test';
import assert from 'node:assert/strict';
import { CLASS_OF, cameraFrom, corners, labelsFor, pictureBox, project, visibleShare, yoloLine } from '../src/detection/labels.js';

// A camera at the origin, 6 m up, looking along +x, with a 90 degree lens and a 16 by 9 picture.
const cam = cameraFrom({ pos: [0, 6, 0], right: [0, 0, 1], up: [0, 1, 0], forward: [1, 0, 0], hfov: Math.PI / 2, aspect: 16 / 9 });
const car = (x, z = 0, extra = {}) => ({ id: 1, kind: 'car', x, z, yaw: 0, length: 4.5, width: 1.9, height: 1.5, ...extra });

test('a point straight ahead is in the middle of the picture, and the edge of the lens is the edge of the picture', () => {
  const mid = project(cam, [20, 6, 0]);
  assert.ok(Math.abs(mid.u - 0.5) < 1e-12 && Math.abs(mid.v - 0.5) < 1e-12 && mid.depth === 20);
  const edge = project(cam, [20, 6, 20]); // 45 degrees to the side: with a 90 degree lens, the edge
  assert.ok(Math.abs(edge.u - 1) < 1e-12);
  assert.ok(project(cam, [-5, 6, 0]) === null, 'behind the lens');
  assert.ok(project(cam, [0.5, 6, 0]) === null, 'nearer than 1 m');
});

test('the box of a vehicle 30 m ahead has the width and height that the lens gives it', () => {
  const box = pictureBox(cam, car(30)), w = box.x1 - box.x0;
  // the near and far ends of a 4.5 m body are at 27.75 and 32.25 m: the widest the 1.9 m body looks is 1.9 / 27.75 of the half width of the view
  assert.ok(w > 0.03 && w < 0.045, `width ${w}`);
  assert.ok(Math.abs((box.x0 + box.x1) / 2 - 0.5) < 1e-9, 'centred');
  assert.ok(box.y0 > 0.5 && box.y1 > box.y0, 'under the horizon, because the lens is above the road');
});

test('a vehicle that has turned shows its side, so its box is wider than when it is end on', () => {
  const end = pictureBox(cam, car(30)), side = pictureBox(cam, car(30, 0, { yaw: Math.PI / 2 }));
  assert.ok(side.x1 - side.x0 > 1.5 * (end.x1 - end.x0));
});

test('a vehicle behind the lens, mostly out of the picture, or too small is not given a box', () => {
  assert.equal(pictureBox(cam, car(-20)), null, 'behind');
  assert.equal(pictureBox(cam, car(20, 23)), null, 'past the edge, mostly outside');
  assert.equal(pictureBox(cam, car(300)), null, 'a few pixels');
  assert.ok(pictureBox(cam, car(300), { minPixels: 1 }), 'but it is there when small ones are wanted');
});

test('a vehicle is cut to the frame, and a box is never outside it', () => {
  const box = pictureBox(cam, car(12, 8.6), { minInside: 0.2 });
  assert.ok(box && box.x1 <= 1 && box.x0 >= 0 && box.y0 >= 0 && box.y1 <= 1);
});

test('a building between the lens and a vehicle hides it, and one beside the line does not', () => {
  const v = car(40), wall = [20, 25, -5, 5, 30], beside = [20, 25, 8, 12, 30];
  assert.equal(visibleShare(cam, v, [v], []), 1);
  assert.equal(visibleShare(cam, v, [v], [wall]), 0);
  assert.equal(visibleShare(cam, v, [v], [beside]), 1);
  assert.equal(visibleShare(cam, v, [v], [[20, 25, -5, 5, 2]]), 1, 'a low wall: the line passes over it');
});

test('a vehicle in front hides the one behind it, and the one beside it does not', () => {
  const back = car(40, 0, { id: 2 }), front = car(25, 0, { id: 3, height: 3.2, length: 12 }), aside = car(25, 4, { id: 4 });
  assert.ok(visibleShare(cam, back, [back, front], []) < 0.4, 'a bus in the way');
  assert.equal(visibleShare(cam, back, [back, aside], []), 1);
});

test('labelsFor keeps what is seen and leaves out what is hidden or out of frame', () => {
  const vs = [car(30, 0, { id: 1 }), car(45, 0, { id: 2, kind: 'bus', length: 12, height: 3.2 }), car(-10, 0, { id: 3 }), car(35, 0, { id: 4 })];
  const labels = labelsFor(cam, vs, [[18, 22, -3, 3, 20]]); // a wall across the middle hides everything on the line
  assert.deepEqual(labels, []);
  const open = labelsFor(cam, vs, []);
  assert.ok(open.some((l) => l.id === 1), 'the first car is seen');
  assert.ok(open.find((l) => l.id === 2).cls === 2, 'the bus is class 2');
  assert.ok(!open.some((l) => l.id === 3), 'the one behind the lens');
});

test('the label line is the YOLO format: class, then the middle and size of the box as shares of the picture', () => {
  assert.equal(yoloLine({ cls: 1, box: { x0: 0.25, x1: 0.75, y0: 0.4, y1: 0.6 } }), '1 0.500000 0.500000 0.500000 0.200000');
  for (const kind of ['car', 'van', 'police', 'amb', 'truck', 'semi', 'fire', 'bus', 'artbus', 'bike', 'scooter']) assert.ok(kind in CLASS_OF, kind);
});

test('the corners of a turned vehicle are where the page puts its model', () => {
  const [a] = corners({ x: 10, z: 5, yaw: Math.PI / 2, length: 4, width: 2, height: 1.5 }); // (-2, 0, -1) turned a quarter circle about y
  assert.ok(Math.abs(a[0] - 9) < 1e-9 && Math.abs(a[2] - 7) < 1e-9, `${a}`); // x + a cos + b sin = 10 + 0 - 1; z - a sin + b cos = 5 + 2 + 0
});

// ----- crops and overlap -----
import { cropBox, groundPoint, intoCrop, labelsFor as labelsForCrop, owns, rigSegments, standingPoint, stripCorners } from '../src/detection/labels.js';

// A straight road with the stop line at x = 0 and distance d running along -x, the lanes at z = 0 to 10. Two cameras on the far side of it, 12 m back from the near kerb and 10 m up, looking across (+z) with
// a 130 degree lens, at 20 m and 60 m from the stop line, as the rig has them.
const toWorld = (d, lateral) => [-d, lateral];
const camAt = (d) => cameraFrom({ pos: [-d, 10, -12], right: [-1, 0, 0], up: [0, 1, 0], forward: [0, 0, 1], hfov: 130 * Math.PI / 180, aspect: 16 / 9 });
const rig = rigSegments([20, 60], 80, 8), cams = [camAt(20), camAt(60)];

test('the road is split halfway between the cameras, each crop is its stretch plus a margin, and the ends are the stop line and the end of the zone', () => {
  assert.deepEqual(rig.map((r) => r.own), [[0, 40], [40, 80]]);
  assert.deepEqual(rig.map((r) => r.crop), [[0, 48], [32, 80]]);
  assert.deepEqual(rigSegments([20, 50, 80], 100, 5).map((r) => r.own), [[0, 35], [35, 65], [65, 100]]);
});

test('every place on the road in the zone belongs to exactly one camera, a boundary to the one after it, and nothing outside the zone belongs to any', () => {
  for (let d = 0; d <= 80; d += 0.05) assert.equal(rig.filter((r) => owns(r, d)).length, 1, `d = ${d}`);
  assert.ok(owns(rig[1], 40) && !owns(rig[0], 40), 'the boundary');
  assert.ok(owns(rig[1], 80), 'the end of the zone');
  assert.ok(!rig.some((r) => owns(r, 80.01)) && !rig.some((r) => owns(r, -0.01)));
});

test('a camera is cropped to its own stretch of road: what is far along the road is outside it, and what is in the stretch is inside', () => {
  const crops = rig.map((r, i) => cropBox(cams[i], stripCorners(toWorld, r.crop)));
  assert.ok(crops.every(Boolean));
  const uOf = (i, d) => project(cams[i], [-d, 0, 5]).u;
  assert.ok(uOf(0, 25) > crops[0].x0 && uOf(0, 25) < crops[0].x1, 'inside the near camera\'s crop');
  assert.ok(uOf(0, 78) > crops[0].x1 || project(cams[0], [-78, 0, 5]) === null, 'the far end is outside the near camera\'s crop');
  assert.ok(uOf(1, 70) > crops[1].x0 && uOf(1, 70) < crops[1].x1);
  assert.ok(uOf(1, 5) < crops[1].x0, 'the stop line end is outside the far camera\'s crop');
  for (const c of crops) assert.ok(c.x0 >= 0 && c.x1 <= 1 && c.y0 >= 0 && c.y1 <= 1);
});

test('a box goes into the crop\'s own picture, is cut to it, and is left out when under half of it is inside', () => {
  const crop = { x0: 0.2, x1: 0.6, y0: 0.3, y1: 0.7 };
  const inside = intoCrop({ x0: 0.3, x1: 0.4, y0: 0.4, y1: 0.5 }, crop);
  for (const [k, want] of Object.entries({ x0: 0.25, x1: 0.5, y0: 0.25, y1: 0.5 })) assert.ok(Math.abs(inside[k] - want) < 1e-9, k);
  const cut = intoCrop({ x0: 0.5, x1: 0.7, y0: 0.4, y1: 0.5 }, crop); // half of it is inside
  assert.ok(cut && Math.abs(cut.x1 - 1) < 1e-12);
  assert.equal(intoCrop({ x0: 0.55, x1: 0.95, y0: 0.4, y1: 0.5 }, crop), null);
});

test('a point on the road seen in the picture is found again on the road', () => {
  for (const [x, z] of [[-10, 3], [-35, 8], [-70, 0], [-25, 10]]) {
    const q = project(cams[0], [x, 0, z]); if (!q) continue;
    const back = groundPoint(cams[0], q.u, q.v);
    assert.ok(Math.abs(back[0] - x) < 1e-6 && Math.abs(back[2] - z) < 1e-6, `${x}, ${z}`);
  }
  assert.equal(groundPoint(cams[0], 0.5, 0.2), null, 'above the horizon');
});

test('a detected vehicle is put on the road within a metre or so of where it stands', () => {
  for (const d of [8, 25, 38, 52, 70]) {
    const v = car(-d, 5), cam = cams[d < 40 ? 0 : 1], box = pictureBox(cam, v); if (!box) continue;
    const at = standingPoint(cam, box);
    assert.ok(Math.abs(at[0] - v.x) < 2.2, `d ${d}: ${at[0]} against ${v.x}`); // the bottom of the box is the near side of its body, so up to half its length off along the road at a slant
  }
});

test('with two cameras and a crop each, every vehicle on the road is counted by exactly one camera, including across the boundary', () => {
  const vehicles = [];
  for (let d = 3; d <= 77; d += 6) vehicles.push(car(-d, 5, { id: Math.round(d * 10) })); // one in the middle lane every 6 m, so none overlaps another or stands in front of another
  const counted = new Map();
  rig.forEach((r, i) => {
    const crop = cropBox(cams[i], stripCorners(toWorld, r.crop));
    for (const l of labelsForCrop(cams[i], vehicles, [], { crop, minPixels: 4 })) {
      // the detector's box is in the crop's picture: put it back in the whole picture, then onto the road
      const w = crop.x1 - crop.x0, h = crop.y1 - crop.y0, whole = { x0: crop.x0 + l.box.x0 * w, x1: crop.x0 + l.box.x1 * w, y0: crop.y0 + l.box.y0 * h, y1: crop.y0 + l.box.y1 * h };
      const at = standingPoint(cams[i], whole), d = -at[0];
      if (owns(r, d)) counted.set(l.id, (counted.get(l.id) || 0) + 1);
    }
  });
  for (const v of vehicles) assert.equal(counted.get(v.id) || 0, 1, `the vehicle at d = ${-v.x} was counted ${counted.get(v.id) || 0} times`);
});

test('a vehicle that both cameras see is counted once: by the one that owns the place it stands, whichever of them has the bigger picture of it', () => {
  const v = car(-37, 5, { id: 9 }), seenBy = rig.map((r, i) => !!labelsForCrop(cams[i], [v], [], { crop: cropBox(cams[i], stripCorners(toWorld, r.crop)), minPixels: 4 }).length);
  assert.deepEqual(seenBy, [true, true], 'both cameras have it in their crops, in the overlap');
  const counts = rig.map((r, i) => { const crop = cropBox(cams[i], stripCorners(toWorld, r.crop)), l = labelsForCrop(cams[i], [v], [], { crop, minPixels: 4 })[0], w = crop.x1 - crop.x0, h = crop.y1 - crop.y0; const at = standingPoint(cams[i], { x0: crop.x0 + l.box.x0 * w, x1: crop.x0 + l.box.x1 * w, y0: crop.y0 + l.box.y0 * h, y1: crop.y0 + l.box.y1 * h }); return owns(r, -at[0]); });
  assert.equal(counts.filter(Boolean).length, 1);
});

// ----- only the lanes of this road -----
import { hull, inLanes, insideHull, laneMask } from '../src/detection/labels.js';

test('the convex hull of some points is their outline, and a point is inside it or not', () => {
  const h = hull([[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5], [0.2, 0.7]]);
  assert.equal(h.length, 4);
  assert.ok(insideHull([0.5, 0.5], h) && insideHull([0.99, 0.01], h));
  assert.ok(!insideHull([1.2, 0.5], h) && !insideHull([0.5, -0.1], h));
});

test('the mask round the lanes has a vehicle in a lane inside it, and a vehicle on the other carriageway, the near footpath or the next street outside it', () => {
  // the lanes are z = 0 to 10, and the camera is at z = -12 looking across, as in the tests above; the other carriageway is z = 12 to 22
  const mask = laneMask(cams[0], stripCorners(toWorld, rig[0].crop, [-0.5, 10.1], 2.2)); // 2.2 m: the height of a car, van or bike
  const at = (d, z, y = 0.8) => { const q = project(cams[0], [-d, y, z]); return [q.u, q.v]; };
  for (const z of [0.5, 5, 9.5]) assert.ok(insideHull(at(20, z), mask), `a vehicle in the lanes, at z ${z}`);
  assert.ok(!insideHull(at(20, 16), mask), 'on the other carriageway');
  assert.ok(!insideHull(at(20, 20), mask), 'further on the other carriageway');
  assert.ok(!insideHull(at(20, -5, 0.8), mask), 'between the camera and the lanes (the near footpath)');
});

test('a vehicle is labelled only if it stands in this approach\'s lanes and in the stretch', () => {
  assert.ok(inLanes({ d: 20, lateral: 5 }, [0, 48]));
  assert.ok(!inLanes({ d: 20, lateral: 14 }, [0, 48]), 'the parallel lane');
  assert.ok(!inLanes({ d: 20, lateral: -3 }, [0, 48]), 'the footpath');
  assert.ok(!inLanes({ d: 60, lateral: 5 }, [0, 48]), 'beyond the stretch');
  assert.ok(inLanes({ d: 46, lateral: 5 }, [0, 48]), 'across the boundary, kept');
});

test('labelsFor with `only` leaves out a vehicle in the parallel lane, which can still hide one behind it', () => {
  const lane = car(-25, 5, { id: 1 }), other = car(-30, 16, { id: 2 }), crop = cropBox(cams[0], stripCorners(toWorld, rig[0].crop));
  const only = (v) => inLanes({ d: -v.x, lateral: v.z }, rig[0].crop);
  const ids = labelsForCrop(cams[0], [lane, other], [], { crop, minPixels: 4, only }).map((l) => l.id);
  assert.deepEqual(ids, [1]);
  const hidden = car(-40, 3, { id: 3 }), blocker = car(-34, 1, { id: 4, kind: 'bus', length: 12, height: 3.2 });
  assert.ok(!labelsForCrop(cams[0], [hidden, blocker], [], { crop, minPixels: 4, only: (v) => v.id === 3 }).length, 'a vehicle in a lane is still hidden by a bigger one in front of it, even when the bigger one is not labelled');
});

test('a box covers only what shows through the mask, and a vehicle that is mostly under the grey is not labelled', () => {
  const v = car(30), whole = pictureBox(cam, v), mid = (whole.x0 + whole.x1) / 2;
  // a mask that covers the left half of the vehicle: the box is the right half of it
  const half = [[mid, 0], [1, 0], [1, 1], [mid, 1]], cut = pictureBox(cam, v, { mask: half, minUnmasked: 0.3, minPixels: 1 });
  assert.ok(cut && cut.x0 >= mid - 1e-9 && Math.abs(cut.x1 - whole.x1) < 1e-9, 'the right half');
  assert.equal(pictureBox(cam, v, { mask: half, minUnmasked: 0.9, minPixels: 1 }), null, 'under 90% of it shows');
  assert.equal(pictureBox(cam, v, { mask: [[0, 0], [0.1, 0], [0.1, 1], [0, 1]] }), null, 'it is under the grey');
  assert.deepEqual(pictureBox(cam, v, { mask: [[0, 0], [1, 0], [1, 1], [0, 1]] }), whole, 'a mask that covers the whole picture changes nothing');
});
