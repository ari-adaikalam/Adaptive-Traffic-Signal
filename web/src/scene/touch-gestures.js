// The two-finger gestures of a map: a pinch zooms, a twist turns the view, two fingers dragging up or down tilt it, and two fingers dragging sideways move it. One finger moves the ground (OrbitControls does that).
// This file is only the arithmetic, with plain numbers and no Three.js, so Node can test it (web/test/touch_gestures.test.js). The page applies the result to the camera (scene/main.js).
//
// Two fingers are measured at each move: the middle between them, how far apart they are and the angle of the line from one to the other (screen pixels, y down). `step` says what changed between two measures.
export const measure = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, dist: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x) });

const TAU = Math.PI * 2;
const wrap = (a) => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI; // the short way round: 350 degrees to 10 degrees is 20, not -340

// What the fingers did between `prev` and `cur`:
//   zoom   the factor for the distance from the view to what it looks at (below 1 when the fingers spread: closer)
//   twist  the angle the fingers turned, in radians, clockwise on the screen positive
//   pan    pixels the middle moved sideways (it is taken when the fingers are not swiping up or down)
//   tilt   pixels the middle moved down (positive) or up, when both fingers swipe the same way up or down and do not twist or pinch much
export function step(prev, cur) {
  const dx = cur.x - prev.x, dy = cur.y - prev.y, spread = cur.dist - prev.dist;
  const zoom = prev.dist > 8 && cur.dist > 8 ? prev.dist / cur.dist : 1;
  const twist = prev.dist > 8 && cur.dist > 8 ? wrap(cur.angle - prev.angle) : 0;
  const turned = Math.abs(twist) * cur.dist / 2; // how far each finger travelled round the middle, in pixels
  const swipe = Math.abs(dy) > 1.5 * Math.abs(dx) && Math.abs(dy) > 2 * turned && Math.abs(spread) < 0.5 * Math.abs(dy);
  return { zoom, twist, pan: swipe ? 0 : dx, tilt: swipe ? dy : 0 };
}
