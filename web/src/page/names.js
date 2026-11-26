// Plain words for the page. The controller says "T13, green" and "road 2". A visitor should read "North and south roads, straight on and left turns", so every label on the page comes from here.
export const ROAD_NAMES = ['north', 'east', 'south', 'west']; // road 1 comes in from the north and the rest follow clockwise
export const roadName = (n) => ROAD_NAMES[n - 1];
export const capital = (text) => text[0].toUpperCase() + text.slice(1);
const roads = (list) => list.map(roadName).join(' and ');

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const dayName = (weekSecond) => DAYS[Math.floor((((weekSecond % 604800) + 604800) % 604800) / 86400)];
export const clockOf = (weekSecond) => { const t = Math.floor(((weekSecond % 86400) + 86400) % 86400); return `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}`; };

// What the signals are doing, as { title, detail }. The phase is T (through and left turns) or R (right-turn arrows) followed by the two roads it serves.
// Every state that has an end shows its seconds, except a green held open for an emergency vehicle, which has no end to show.
export function describeSignals(snap) {
  if (snap.stage === 'fault') return { title: 'Fault', detail: 'Every signal is red' };
  if (snap.stage === 'flash') return { title: 'Starting up', detail: 'Flashing red' };
  const served = String(snap.phase).slice(1).split('').map(Number), kind = String(snap.phase)[0];
  const what = kind === 'T' ? 'straight on and left turns' : 'right-turn arrows';
  const left = Math.max(0, Math.round(snap.remaining));
  const word = snap.stage === 'yellow' ? 'Yellow' : 'Green';
  if (snap.emergency_approach) {
    const title = `Emergency vehicle from the ${roadName(snap.emergency_approach)}`;
    if (snap.stage === 'all_red') return { title, detail: `Everything red, ${left} s left` };
    return { title, detail: snap.holding ? `Green, ${roads(served)}` : `${word}, ${roads(served)}, ${left} s left` }; // short, because the card cuts a line that is too long
  }
  if (snap.stage === 'all_red') {
    // The left arrow shown for a through phase that served pedestrians carries on through the all-red into the arrow phase (left_clear_arrow), so the card says so instead of "Everything red".
    const lefts = snap.shown_arrows && snap.arrows ? [1, 2, 3, 4].filter((n) => snap.shown_arrows[n - 1] !== snap.arrows[n - 1] && snap.shown_arrows[n - 1] !== 'red') : [];
    if (lefts.length) return { title: `${capital(roads(lefts))} ${lefts.length > 1 ? 'roads' : 'road'}: left arrows`, detail: capital(snap.shown_arrows[lefts[0] - 1]) }; // no seconds: the all-red is short and the arrow carries on past it into the arrow phase, so the seconds of the all-red would not be the seconds of the arrow
    return { title: 'Everything red', detail: `${left} s left` };
  }
  return { title: `${capital(roads(served))} ${served.length > 1 ? 'roads' : 'road'}: ${what}`, detail: `${word}, ${left} s left` };
}

// Who is crossing, in a few words or null, so it stays on one line. Crossing n crosses road n.
export function describePedestrians(snap, flashingLeft = null) {
  const walking = [1, 2, 3, 4].filter((n) => snap.signals[`C${n}`] === 'walk'), finishing = [1, 2, 3, 4].filter((n) => snap.signals[`C${n}`] === 'clear');
  if (walking.length) return `Walk: ${roads(walking)} ${walking.length > 1 ? 'roads' : 'road'}`;
  if (finishing.length) return `Finishing: ${roads(finishing)} ${finishing.length > 1 ? 'roads' : 'road'}${flashingLeft === null ? '' : `, ${flashingLeft} s left`}`;
  const asked = snap.pedestrian_requests || [];
  if (asked.length) return `Walk waiting: ${roads(asked)} ${asked.length > 1 ? 'roads' : 'road'}`; // pressed, and waiting for a green that it can run beside
  return null;
}

// In a right-turn arrow phase the left arrows of the other two roads are lit as well, and the headline names only the right turns, so this says the rest. Null when there are none.
export function describeLeftArrows(snap) {
  if (snap.stage === 'fault' || snap.stage === 'flash' || String(snap.phase)[0] !== 'R' || (snap.stage !== 'green' && snap.stage !== 'yellow')) return null;
  const shown = snap.shown_arrows || snap.arrows, lefts = [1, 2, 3, 4].filter((n) => shown[n - 1] === 'green' || shown[n - 1] === 'yellow');
  return lefts.length ? `${capital(roads(lefts))}: left arrows` : null;
}
