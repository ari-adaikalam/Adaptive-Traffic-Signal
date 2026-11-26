// A courtyard's furniture and the places people sit, in metres, in world coordinates (a courtyard is a rectangle with its sides along x and z). This file has no Three.js in it, so the builder in main.js, the
// people (courtyard-life.js) and the tests all use the same numbers: a person sits where the bench and the stool are because both come from here.
//
// The plan, as main.js builds it: two paths 3 m wide cross in the middle, and a fountain (a planter in a small courtyard) stands where they cross. Four benches stand round it, one on each path, facing it. The
// four quarters between the paths are lawns, except one, the cafe, which is paved and has three tables with a stool each side. A path ends at the edge of the courtyard in four places, and that is where people
// come in and go out.
export const PATH_W = 3, EDGE = 1.2; // the paths' width, and the lawns' margin from the edge
const LANE = 1.18; // how far from a path's middle a person walks, past the end of a bench (0.85 m from the middle) and clear of it

// The size of a lawn quarter, and of the fountain.
export function yardParts(w, d) {
  const big = Math.min(w, d) >= 18;
  return { big, r: big ? 2.2 : 1.4, lw: w / 2 - EDGE - PATH_W / 2, ld: d / 2 - EDGE - PATH_W / 2 };
}

// A cafe needs a quarter big enough for three tables with room to walk round them.
export const hasCafe = (w, d) => { const { lw, ld } = yardParts(w, d); return lw >= 4 && ld >= 3.6; };

// The tables of the cafe: three in a row across its quarter. `cafeX` and `cafeZ` (each -1 or 1) say which quarter it is.
export function cafeTables(x, z, w, d, cafeX, cafeZ) {
  const { lw, ld } = yardParts(w, d), lx = x + cafeX * (PATH_W / 2 + lw / 2), lz = z + cafeZ * (PATH_W / 2 + ld / 2), spacing = Math.min(2.6, lw / 3);
  return { spacing, tables: [0, 1, 2].map((k) => ({ x: lx + (k - 1) * spacing, z: lz })), row: lz };
}

// The four benches, as the builder draws them: [x, z, alongX, side]. A bench is 1.7 m long and its back is on the side away from the fountain.
export function benches(x, z, r) {
  const out = [];
  for (const s of [-1, 1]) { out.push({ x, z: z + s * (r + 1.4), alongX: true, side: s }); out.push({ x: x + s * (r + 1.4), z, alongX: false, side: s }); }
  return out;
}

// The seats. Each has where the person sits, the way they face (an angle: atan2(dz, dx)), the entrance their walk starts at, and the walk from there as a list of [x, z] points ending at the seat. An entrance is
// named by the end of the path it is at: 'n' is at the smaller z, 's' the larger, 'w' the smaller x, 'e' the larger.
export function seatsOf({ x, z, w, d, cafeX, cafeZ }) {
  const { r } = yardParts(w, d), seats = [], cafe = hasCafe(w, d);
  const ends = { n: [x, z - d / 2], s: [x, z + d / 2], w: [x - w / 2, z], e: [x + w / 2, z] };
  const cafeEnd = cafeZ > 0 ? 's' : 'n'; // the cafe is reached from the end of the path on its side
  for (const b of benches(x, z, r)) {
    if (b.alongX) { // on the path along z: reached from its end, past the end of the bench, round to the side that faces the fountain
      const end = b.side > 0 ? 's' : 'n', lane = end === cafeEnd && cafe ? cafeX * LANE : LANE, [ex, ez] = ends[end];
      for (const q of [-1, 1]) seats.push({ kind: 'bench', entrance: end, x: x + q * 0.4, z: b.z - b.side * 0.02, facing: Math.atan2(-b.side, 0), route: [[ex + lane, ez], [x + lane, b.z - b.side * 0.75], [x + q * 0.4, b.z - b.side * 0.6], [x + q * 0.4, b.z - b.side * 0.02]] });
    } else {
      const end = b.side > 0 ? 'e' : 'w', [ex, ez] = ends[end];
      for (const q of [-1, 1]) seats.push({ kind: 'bench', entrance: end, x: b.x - b.side * 0.02, z: z + q * 0.4, facing: Math.atan2(0, -b.side), route: [[ex, ez + LANE], [b.x - b.side * 0.75, z + LANE], [b.x - b.side * 0.6, z + q * 0.4], [b.x - b.side * 0.02, z + q * 0.4]] });
    }
  }
  if (cafe) {
    const { spacing, tables, row } = cafeTables(x, z, w, d, cafeX, cafeZ), lane = cafeX * LANE, [ex, ez] = ends[cafeEnd], approach = row + cafeZ * 1.8; // the row a person walks along, outside the outer stools
    tables.forEach((t) => {
      const outer = row + cafeZ * 0.85, inner = row - cafeZ * 0.85;
      seats.push({ kind: 'cafe', entrance: cafeEnd, x: t.x, z: outer, facing: Math.atan2(-cafeZ, 0), route: [[ex + lane, ez], [x + lane, approach], [t.x, approach], [t.x, outer]] });
      if (spacing >= 2.2) { const gap = t.x - cafeX * spacing / 2; seats.push({ kind: 'cafe', entrance: cafeEnd, x: t.x, z: inner, facing: Math.atan2(cafeZ, 0), route: [[ex + lane, ez], [x + lane, approach], [gap, approach], [gap, inner], [t.x, inner]] }); }
    });
  }
  return seats.map((s, id) => ({ ...s, id }));
}
