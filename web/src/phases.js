// Movements, the conflict rule and the phase plan. Port of traffic_controller/phases.py.
// Approaches are numbered 1 to 4 clockwise, so approach i faces approach i+2.
//   T_i  through and left turn from approach i
//   R_i  protected right turn arrow from approach i
//   C_j  pedestrian crossing over leg j
//   L_i  left turn arrow of approach i, lit only in the arrow phase of the other pair. Not part of a phase, not on the serial line.

export const NUM_APPROACHES = 4;
export const KINDS = ['T', 'R', 'C'];
export const ALL_MOVEMENTS = KINDS.flatMap((kind) => [1, 2, 3, 4].map((n) => `${kind}${n}`));
export const ARROWS = [1, 2, 3, 4].map((n) => `L${n}`);

export function shift(n, steps) {
  return ((n - 1 + steps) % NUM_APPROACHES + NUM_APPROACHES) % NUM_APPROACHES + 1;
}

export function opposite(n) {
  return shift(n, 2);
}

export function parseMovement(movement) {
  if (typeof movement !== 'string' || !(ALL_MOVEMENTS.includes(movement) || ARROWS.includes(movement))) throw new Error(`unknown movement ${String(movement)}`);
  return [movement[0], Number(movement[1])];
}

// A whitelist: true only for pairs that may be active together. Everything else conflicts.
export function compatible(a, b) {
  if (a === b) {
    parseMovement(a);
    return true;
  }
  const [kindA, nA] = parseMovement(a);
  const [kindB, nB] = parseMovement(b);
  if (kindA === 'L' || kindB === 'L') {
    // From the swept paths of a bus on each movement. A left turn clears opposing traffic in left-hand driving.
    const [i, kind, j] = kindA === 'L' ? [nA, kindB, nB] : [nB, kindA, nA];
    if (kind === 'L') return true;
    if (kind === 'T') return j === i || j === opposite(i);
    if (kind === 'R') return j !== opposite(i); // a right turn from the opposite approach exits into the same lane
    return false; // pedestrians
  }
  if ((kindA === 'T' && kindB === 'T') || (kindA === 'R' && kindB === 'R')) return nB === opposite(nA);
  if (kindA === 'C' && kindB === 'C') return true;
  const [crossing, through] = kindA === 'C' ? [nA, nB] : [nB, nA];
  if ((kindA === 'T' || kindB === 'T') && (kindA === 'C' || kindB === 'C')) {
    return through === shift(crossing, 1) || through === shift(crossing, 3);
  }
  return false;
}

export function conflictFree(movements) {
  const items = [...movements];
  return items.every((a, i) => items.slice(i + 1).every((b) => compatible(a, b)));
}

export function makePhase(name, movements) {
  const set = new Set(movements);
  for (const m of set) parseMovement(m);
  if (set.size === 0) throw new Error('a phase needs at least one movement');
  if (!conflictFree(set)) throw new Error(`phase ${name} holds conflicting movements`);
  const kinds = new Set([...set].map((m) => m[0]));
  if (kinds.size !== 1 || [...set].some((m) => m[0] === 'C')) {
    throw new Error('a phase holds only through movements or only right-turn arrows');
  }
  const approaches = [...set].map((m) => Number(m[1])).sort((a, b) => a - b);
  return Object.freeze({ name, movements: set, kind: [...kinds][0], approaches: () => approaches });
}

// The fixed cycle. Opposing approaches run together. With arrows each through phase is preceded
// by an arrow phase for the right turns of the same pair, in the order T13, R24, T24, R13.
export function buildPlan(arrows = true) {
  const t13 = makePhase('T13', ['T1', 'T3']);
  const t24 = makePhase('T24', ['T2', 'T4']);
  if (!arrows) return [t13, t24];
  return [t13, makePhase('R24', ['R2', 'R4']), t24, makePhase('R13', ['R1', 'R3'])];
}
