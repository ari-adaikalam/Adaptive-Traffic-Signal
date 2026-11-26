// Where the parts of the playground are and how big they are, in metres. This file has no Three.js in it, so the shapes (playground.js) and the children's moves (playground-life.js, tested in node) share one set
// of numbers: a child on a swing is where the seat is, and a child on the slide is on the chute, because both are worked out from the same figures.
//
// Positions are relative to the middle of the sand (ZONES.play): u east, v south, y up. Both pieces face +u: a child on a swing looks toward +u, and the chute of the slide runs toward +u.

export const SWING_AT = { u: -3.5, v: -2.5 }; // the middle of the swing set (its top bar runs along v)
export const SLIDE_AT = { u: 2.2, v: 2.5 }; // the middle of the slide's platform

export const SWING = {
  beamY: 2.5, // the top bar's middle
  beamThick: 0.12,
  beamLen: 4.4,
  legSplay: 1.2, // each end is an A: two legs, from the end of the bar down to the ground this far to either side
  seats: [-0.9, 0.9], // v of each swing from the middle of the set
  chainGap: 0.5, // between the two chains of a swing
  chain: 1.95, // from the bar to the middle of the seat
  seatD: 0.22, seatW: 0.54, seatThick: 0.05,
  amplitude: 0.5, // radians, at the most
  omega: 1.7, // radians a second: a swing of about 3.7 s a swing
};
// Where the top of the seat is, below the bar's pivot (the pivot is just under the bar), and where a child's hips go.
export const swingPivotY = () => SWING.beamY - SWING.beamThick / 2;
export const seatTop = () => -SWING.chain + SWING.seatThick / 2;

export const SLIDE = {
  deck: 1.5, // the platform's middle, above the ground
  deckHalf: 0.55, // the platform is 1.1 m square
  deckThick: 0.08,
  exitY: 0.32, // the chute's lower end above the ground
  run: 2.7, // how far the chute goes along u
  chuteW: 0.54,
  ladderRun: 0.45, // how far out the ladder's foot is from the platform's edge
};

// The chute: from the platform's edge at its top surface down to the exit.
export function chute() {
  const x0 = SLIDE.deckHalf, top = SLIDE.deck + SLIDE.deckThick / 2, drop = top - SLIDE.exitY;
  return { x0, top, drop, length: Math.hypot(SLIDE.run, drop), angle: Math.atan2(drop, SLIDE.run) };
}
// A point of the chute's top surface, s metres down it, in the slide's own frame (x along u, y up).
export function chuteAt(s) {
  const c = chute();
  return { x: c.x0 + s * Math.cos(c.angle), y: c.top - s * Math.sin(c.angle) };
}
export const ladderFootX = () => -SLIDE.deckHalf - SLIDE.ladderRun;

// Where a child stands to get on swing i (behind the seat, on the -u side, looking toward +u), as u and v from the middle of the sand.
export const swingStand = (i) => ({ u: SWING_AT.u - 1.0, v: SWING_AT.v + SWING.seats[i] });
// Where a child stands at the foot of the slide's ladder.
export const slideFoot = () => ({ u: SLIDE_AT.u + ladderFootX(), v: SLIDE_AT.v });
// The swing's angle from the hanging position, for its amplitude and phase.
export const swingAngle = (amp, phase) => amp * Math.sin(phase);

// Circles, as [u, v, radius] from the middle of the sand, that a child walking about must keep out of: the feet of the swing set, the posts of the slide, and its chute where it is above head height.
export function obstacles() {
  const out = [];
  for (const side of [-1, 1]) for (const end of [-1, 1]) out.push([SWING_AT.u + side * SWING.legSplay, SWING_AT.v + end * SWING.beamLen / 2, 0.22]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push([SLIDE_AT.u + sx * SLIDE.deckHalf, SLIDE_AT.v + sz * SLIDE.deckHalf, 0.22]);
  const c = chute();
  for (let s = 0; s < c.length - 0.6; s += 0.5) out.push([SLIDE_AT.u + chuteAt(s).x, SLIDE_AT.v, 0.4]);
  return out;
}
