// How high the ground is under a person's feet on the footpaths of the main roads. The footpath is a slab 0.16 m above the road (the kerb pieces and the corner pieces in main.js), and a person drawn at height 0 on it
// has their feet inside it. This says where the slab is, in the same terms as the shapes that make it: the strips beside the four roads, 3.6 m wide, the rounded corners at the junction, and the gaps where a side street
// crosses. No Three.js here, so it is tested in node (web/test/footpath.test.js).
import { CORNER_RADIUS, HALF_ROAD } from '../sim/tracks.js';
import { SIDE_STREET_COUNT, SIDE_STREET_SPACING } from '../sim/world.js';

export const SLAB_TOP = 0.16, FOOT_WIDTH = 3.6, STREET_WIDTH = 8;
const EDGE = HALF_ROAD + FOOT_WIDTH;

// Is the point (x, z) on a footpath slab?
export function onSlab(x, z) {
  const ax = Math.abs(x), az = Math.abs(z), r = CORNER_RADIUS, c = HALF_ROAD + r;
  if (ax < HALF_ROAD && az < HALF_ROAD) return false; // the middle of the junction
  if (ax >= HALF_ROAD && az >= HALF_ROAD && ax < c && az < c) return Math.hypot(ax - c, az - c) <= r && (ax < EDGE || az < EDGE); // a corner: inside the rounded piece
  const along = (d) => { for (let m = 1; m <= SIDE_STREET_COUNT; m += 1) if (Math.abs(d - m * SIDE_STREET_SPACING) < STREET_WIDTH / 2) return false; return true; }; // a side street cuts the footpath
  if (ax >= HALF_ROAD && ax < EDGE && az >= c) return along(az); // beside the roads that run north and south
  if (az >= HALF_ROAD && az < EDGE && ax >= c) return along(ax); // beside the roads that run east and west
  return false;
}
export const footpathHeight = (x, z) => (onSlab(x, z) ? SLAB_TOP : 0);
