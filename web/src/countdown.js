// What the signals can tell a person about the seconds ahead, without changing how the controller decides anything.
//
// A copy of the controller runs forward a second at a time on the counts it has now, and the moments are read off the copy. The copy is thrown away. This is exact while the road's
// green is one or two phases away (the first two phases that follow are already fixed), and it can be wrong beyond that, because the later phases can still be skipped or
// lengthened by traffic that has not arrived. So a road whose green is further off gets a lower bound, "more than N", and not a guess.
//
// Nothing here is part of the controller's rules, and the Python specification and the firmware do not have it.

const HORIZON = 400; // seconds to look ahead: a few cycles of the longest plan
const EXACT_PHASES = 2; // the road's green is within the next two phases

function copyOf(controller) {
  const copy = Object.create(Object.getPrototypeOf(controller));
  for (const [key, value] of Object.entries(controller)) copy[key] = key === 'plan' || key === 'cfg' ? value : structuredClone(value); // the plan and the config are never changed
  return copy;
}

const isLit = (snap, a) => [snap.signals[`T${a}`], snap.signals[`R${a}`], (snap.shown_arrows || snap.arrows)[a - 1]].some((state) => state === 'green' || state === 'yellow');

// One entry for each road, 1 to 4:
//   null                        one of its signals is lit (its main light or its arrow): the main light and the arrow can differ, so there is no one number to give
//   { kind: 'exact', seconds }  it is red, and its next lit signal comes in exactly this many seconds
//   { kind: 'more', seconds }   it is red, and its next lit signal comes after more than this many seconds
//   null                        nothing to say (startup, a fault, nothing lit within the look ahead, or a road waiting while a green is held open for an emergency vehicle)
export function forecast(controller) {
  const now = controller.snapshot;
  const out = [null, null, null, null];
  if (now.stage === 'fault' || now.stage === 'flash') return out;
  const waiting = [];
  for (let a = 1; a <= 4; a += 1) {
    if (isLit(now, a)) out[a - 1] = null; // a road that has a light is told nothing: its main light and its arrow can show different things at once, so one number could not say which it meant
    else waiting.push(a);
  }
  if (waiting.length === 0) return out;
  // While a green is held open for an emergency vehicle, nothing can be said about the roads that are waiting: the hold ends when the vehicle has crossed, which the controller does not know yet, so any number
  // would be a guess, and it was a wrong one that fell for a while and then dropped to the true one when the hold ended.
  if (now.holding) return out;
  const copy = copyOf(controller), startOfPhase = []; // startOfPhase[k] is the second the k-th phase after this one began
  let phase = now.phase;
  for (let t = 1; t <= HORIZON && waiting.length > 0; t += 1) {
    const snap = copy.tick();
    if (snap.stage === 'fault' || snap.stage === 'flash') break;
    if (snap.phase && snap.phase !== phase) { startOfPhase.push(t); phase = snap.phase; }
    for (let i = waiting.length - 1; i >= 0; i -= 1) {
      const a = waiting[i];
      if (!isLit(snap, a)) continue;
      out[a - 1] = startOfPhase.length <= EXACT_PHASES ? { kind: 'exact', seconds: t } : { kind: 'more', seconds: startOfPhase[EXACT_PHASES - 1] };
      waiting.splice(i, 1);
    }
  }
  return out;
}

// Seconds until a crossing's flashing red man ends, or null when it is not flashing. Crossing n crosses road n.
export function flashingSeconds(controller, crossing) {
  const key = `C${crossing}`;
  if (controller.snapshot.signals[key] !== 'clear') return null;
  const copy = copyOf(controller);
  for (let t = 1; t <= HORIZON; t += 1) if (copy.tick().signals[key] !== 'clear') return t;
  return null;
}

// What a number on a head or a plan says: "14" when it is exact, "> 25" when it is a lower bound, and nothing when there is no number to give.
export function countdownText(entry) {
  if (!entry || entry.seconds === null) return '';
  return `${entry.kind === 'more' ? '>' : ''}${Math.min(99, Math.max(0, Math.round(entry.seconds)))}`;
}
