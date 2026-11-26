import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_MOVEMENTS, buildPlan, compatible, conflictFree, makePhase, opposite, shift } from '../src/phases.js';

// The whitelist written out by hand, independent of the formula in phases.js.
const ALLOWED = new Set([
  ['T1', 'T3'], ['T2', 'T4'], ['R1', 'R3'], ['R2', 'R4'],
  ['C1', 'C2'], ['C1', 'C3'], ['C1', 'C4'], ['C2', 'C3'], ['C2', 'C4'], ['C3', 'C4'],
  ['C1', 'T2'], ['C1', 'T4'], ['C2', 'T3'], ['C2', 'T1'], ['C3', 'T4'], ['C3', 'T2'], ['C4', 'T1'], ['C4', 'T3'],
].map((p) => p.sort().join('|')));

test('the whitelist matches the hand-written table for every pair', () => {
  for (const a of ALL_MOVEMENTS) {
    for (const b of ALL_MOVEMENTS) {
      const expected = a === b || ALLOWED.has([a, b].sort().join('|'));
      assert.equal(compatible(a, b), expected, `${a} ${b}`);
    }
  }
  assert.equal(ALL_MOVEMENTS.length, 12);
  assert.equal(ALLOWED.size, 18);
});

test('compatibility is symmetric and unknown movements are rejected', () => {
  for (const a of ALL_MOVEMENTS) for (const b of ALL_MOVEMENTS) assert.equal(compatible(a, b), compatible(b, a));
  for (const bad of ['T0', 'T5', 'X1', '', 't1', 'T', 'TT1', null]) assert.throws(() => compatible('T1', bad));
});

test('conflictFree checks every pair', () => {
  assert.equal(conflictFree(['T1', 'T3', 'C2', 'C4']), true);
  assert.equal(conflictFree(['T1', 'T3', 'C1']), false);
  assert.equal(conflictFree(['T1', 'T3', 'T2']), false);
  assert.equal(conflictFree([]), true);
});

test('bad phases are rejected', () => {
  for (const movements of [['T1', 'T2'], ['T1', 'R1'], ['R1', 'R2'], ['T1', 'T3', 'C1'], [], ['T1', 'T3', 'C2'], ['T1', 'R3']]) {
    assert.throws(() => makePhase('bad', movements), undefined, movements.join());
  }
  assert.throws(() => makePhase('bad', ['T1', 'Z9']));
});

test('the plans', () => {
  const through = buildPlan(false);
  assert.deepEqual(through.map((p) => p.name), ['T13', 'T24']);
  assert.deepEqual(through.map((p) => p.approaches()), [[1, 3], [2, 4]]);
  const plan = buildPlan();
  assert.deepEqual(plan.map((p) => p.name), ['T13', 'R24', 'T24', 'R13']);
  assert.deepEqual(plan.map((p) => p.kind), ['T', 'R', 'T', 'R']);
});

test('opposite and shift wrap clockwise', () => {
  assert.deepEqual([1, 2, 3, 4].map(opposite), [3, 4, 1, 2]);
  assert.deepEqual([1, 2, 3, 4].map((n) => shift(n, 1)), [2, 3, 4, 1]);
  assert.deepEqual([1, 2, 3, 4].map((n) => shift(n, 3)), [4, 1, 2, 3]);
});
