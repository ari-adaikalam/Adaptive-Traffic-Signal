// The children's play on the swings and the slide: when a swing moves, who is on what, and where a child is at every moment of a turn. This file has no Three.js in it, so it runs under node and is tested there
// (web/test/playground_life.test.js). The page walks a child to the foot of a piece (an "errand"), hands it the turn, and puts the child's model where each step says.
//
// Rules:
//   - A swing moves only while a child is on it. It builds up over a couple of seconds, and when the child is ready to get off it slows over several seconds, and the child waits on it until it has nearly
//     stopped. With nobody on it, it hangs still, exactly.
//   - A swing or the slide has one child at a time: it is reserved from the moment a child sets out for it until the child has got off.
//   - Nobody blinks out of sight: a child steps up onto the seat or the ladder from where they stand, and steps off to where they stand.
//
// A step gives a pose, in metres from the middle of the sand: { mode: 'stand' | 'walk' | 'sit', u, v, y, heading, pitch, swing, blend, kick, moving }.
//   swing (an index) with blend 0 to 1 means the child is between where they stand (blend 0) and the seat (blend 1), and the page works the seat out from the swing as it hangs now.
import { SLIDE, SLIDE_AT, SWING, chute, chuteAt, ladderFootX, slideFoot, swingAngle, swingStand } from './playground-layout.js';

const BOARD = 0.9, LEAVE = 0.9; // seconds to step onto a seat, and off it
const READY_TO_GET_OFF = 0.1; // the amplitude below which a child steps off
const RAMP_UP = 1.8, RAMP_DOWN = 1.5; // seconds: how fast a swing builds up, and slows (the time it takes to lose a share of its swing)
const CLIMB_SPEED = 0.6, DECK_SPEED = 0.85, SIT_PAUSE = 0.7, SLIDE_START = 0.2, SLIDE_ACCEL = 2.0, SLIDE_TOP_SPEED = 3.0, EXIT_TIME = 0.9, EXIT_RUN = 0.7;
const ease = (k) => k * k * (3 - 2 * k);

export function createPlayLife({ rnd = Math.random } = {}) {
  const swings = SWING.seats.map(() => ({ rider: null, reserved: false, amp: 0, phase: rnd() * Math.PI * 2 }));
  const slide = { reserved: false, rider: null };
  const c = chute(), top = SLIDE.deck + SLIDE.deckThick / 2, ladderTop = { x: -SLIDE.deckHalf, y: top };
  const climbLength = Math.hypot(ladderTop.x - ladderFootX(), ladderTop.y);

  return {
    swings, slide,
    swingAngle: (i) => swingAngle(swings[i].amp, swings[i].phase),
    // A swing's motion, for everyone to see: nothing moves unless a child is on it.
    update(dt) {
      for (const s of swings) {
        const target = s.rider && s.rider.phase === 'ride' ? SWING.amplitude : 0;
        s.amp += (target - s.amp) * (1 - Math.exp(-dt / (target > 0 ? RAMP_UP : RAMP_DOWN)));
        if (target === 0 && s.amp < 0.003) s.amp = 0; // at rest, exactly
        if (s.amp > 0) s.phase += SWING.omega * dt;
      }
    },
    // A child sets out for a swing or the slide: returns where to go, or null when everything is in use. The place is reserved until `release`.
    errand() {
      const free = swings.map((s, i) => (s.reserved ? -1 : i)).filter((i) => i >= 0), options = [];
      if (free.length) options.push('swing');
      if (!slide.reserved) options.push('slide');
      if (!options.length) return null;
      const type = options[Math.floor(rnd() * options.length)];
      if (type === 'swing') { const i = free[Math.floor(rnd() * free.length)]; swings[i].reserved = true; return { type, i, target: swingStand(i) }; }
      slide.reserved = true; return { type, target: slideFoot() };
    },
    release(act) { // the place is let go (the child got off, or gave up on the way)
      if (act.type === 'swing') { swings[act.i].reserved = false; if (swings[act.i].rider === act) swings[act.i].rider = null; } else { slide.reserved = false; if (slide.rider === act) slide.rider = null; }
    },
    // The child has reached the foot of the piece: the turn begins.
    begin(errand) {
      const act = { ...errand, phase: errand.type === 'swing' ? 'board' : 'climb', t: 0, done: false, ride: errand.type === 'swing' ? 14 + rnd() * 30 : 0, s: 0, speed: SLIDE_START };
      if (act.type === 'swing') swings[act.i].rider = act; else slide.rider = act;
      return act;
    },
    // A step of the turn: returns the child's pose, and sets act.done when the child is back on the sand.
    step(act, dt) {
      act.t += dt;
      return act.type === 'swing' ? stepSwing(act, dt) : stepSlide(act, dt);
    },
  };

  function stepSwing(act, dt) {
    const s = swings[act.i], stand = swingStand(act.i), base = { swing: act.i, u: stand.u, v: stand.v, y: 0, heading: 0, pitch: 0, moving: 0, kick: 0 };
    if (act.phase === 'board') {
      if (act.t >= BOARD) { act.phase = 'ride'; act.t = 0; return stepSwing(act, 0); }
      const k = ease(act.t / BOARD);
      return { ...base, blend: k, mode: k < 0.5 ? 'stand' : 'sit', moving: k < 0.5 ? 1 : 0 };
    }
    if (act.phase === 'ride') {
      if (act.t >= act.ride) { act.phase = 'wait'; act.t = 0; return stepSwing(act, 0); }
      return { ...base, blend: 1, mode: 'sit', kick: Math.cos(s.phase) * Math.min(1, s.amp / SWING.amplitude) };
    }
    if (act.phase === 'wait') { // the swing slows with the child on it, and the child gets off when it has nearly stopped
      if (s.amp < READY_TO_GET_OFF) { act.phase = 'off'; act.t = 0; return stepSwing(act, 0); }
      return { ...base, blend: 1, mode: 'sit', kick: 0 };
    }
    if (act.t >= LEAVE) { act.done = true; return { ...base, blend: 0, mode: 'stand' }; }
    const k = ease(act.t / LEAVE);
    return { ...base, blend: 1 - k, mode: k < 0.5 ? 'sit' : 'stand', moving: k < 0.5 ? 0 : 1 };
  }

  function stepSlide(act, dt) {
    const at = (x, y, extra) => ({ u: SLIDE_AT.u + x, v: SLIDE_AT.v, y, heading: 0, pitch: 0, moving: 0, mode: 'stand', swing: null, blend: 0, kick: 0, ...extra });
    if (act.phase === 'climb') { // up the ladder, which leans on the platform's near edge
      const f = Math.min(1, act.t * CLIMB_SPEED / climbLength);
      if (f >= 1) { act.phase = 'across'; act.t = 0; return stepSlide(act, 0); }
      return at(ladderFootX() + (ladderTop.x - ladderFootX()) * f, ladderTop.y * f, { mode: 'walk', moving: 1 });
    }
    if (act.phase === 'across') { // over the platform to the top of the chute
      const f = Math.min(1, act.t * DECK_SPEED / (c.x0 - ladderTop.x));
      if (f >= 1) { act.phase = 'sit'; act.t = 0; return stepSlide(act, 0); }
      return at(ladderTop.x + (c.x0 - ladderTop.x) * f, top, { mode: 'walk', moving: 1 });
    }
    if (act.phase === 'sit') { // sits down at the top of the chute
      if (act.t >= SIT_PAUSE) { act.phase = 'slide'; act.t = 0; act.s = 0; act.speed = SLIDE_START; return stepSlide(act, 0); }
      return at(c.x0, top, { mode: act.t < SIT_PAUSE * 0.4 ? 'stand' : 'sit' });
    }
    if (act.phase === 'slide') {
      act.speed = Math.min(SLIDE_TOP_SPEED, act.speed + SLIDE_ACCEL * dt); act.s += act.speed * dt;
      if (act.s >= c.length) { act.phase = 'exit'; act.t = 0; return stepSlide(act, 0); }
      const p = chuteAt(act.s);
      return at(p.x, p.y, { mode: 'sit', pitch: -c.angle });
    }
    const end = chuteAt(c.length), f = Math.min(1, act.t / EXIT_TIME); // off the end: stands up and walks on, down to the ground
    if (f >= 1) { act.done = true; return at(end.x + EXIT_RUN, 0, { mode: 'stand' }); }
    return at(end.x + EXIT_RUN * f, end.y * (1 - Math.min(1, f / 0.4)), { mode: f < 0.4 ? 'sit' : 'walk', moving: f < 0.4 ? 0 : 1, pitch: f < 0.4 ? -c.angle * (1 - f / 0.4) : 0 });
  }
}
