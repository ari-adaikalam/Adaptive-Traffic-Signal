import test from 'node:test';
import assert from 'node:assert/strict';
import { ConflictError, FormatError, MOVEMENTS, crc8, decode, encode, withArrows } from '../src/protocol.js';
import { Controller } from '../src/signals.js';
import { buildPlan } from '../src/phases.js';
import { makeCounts } from '../src/timing.js';
import { vector } from './vectors.js';

const data = vector('protocol_v3.json');
const bytes = (text) => Uint8Array.from(text, (c) => c.charCodeAt(0));

test('the CRC matches the standard check value', () => {
  assert.equal(crc8('123456789'), 0xf4);
  assert.equal(crc8(''), 0);
});

test('valid lines decode, and encode back to the same line', () => {
  for (const c of data.valid) {
    assert.deepEqual(decode(c.line), c.signals, c.line);
    assert.deepEqual(decode(bytes(c.line)), c.signals, c.line);
    assert.equal(encode(c.signals), `V3 ${c.payload} ${c.line.split(' ')[2].replace(/\s/g, '')}\n`);
  }
});

test('conflicting lines are intact but unsafe', () => {
  for (const c of data.conflict) assert.throws(() => decode(c.line), ConflictError, c.payload);
});

test('damaged lines are format errors', () => {
  for (const text of data.format) {
    assert.throws(() => decode(text), FormatError, JSON.stringify(text));
    assert.throws(() => decode(bytes(text)), FormatError, JSON.stringify(text));
  }
  for (const raw of data.format_bytes) assert.throws(() => decode(Uint8Array.from(raw)), FormatError);
});

test('encode refuses what decode would refuse', () => {
  for (const c of data.encode_refuses) assert.throws(() => encode(c.signals), undefined, c.name);
});

test('thousands of damaged lines get the same verdict as the Python', () => {
  assert.equal(data.fuzz_lines.length, data.fuzz_expect.length);
  data.fuzz_lines.forEach((text, i) => {
    let verdict = 'ok';
    try { decode(bytes(text)); } catch (e) { verdict = e instanceof ConflictError ? 'conflict' : e instanceof FormatError ? 'format' : 'other'; }
    assert.equal(verdict, data.fuzz_expect[i], JSON.stringify(text));
  });
});

// A small seeded generator, so the random states are the same every run.
function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALLOWED = new Set([['T1', 'T3'], ['T2', 'T4'], ['R1', 'R3'], ['R2', 'R4'],
  ['C1', 'C2'], ['C1', 'C3'], ['C1', 'C4'], ['C2', 'C3'], ['C2', 'C4'], ['C3', 'C4'],
  ['C1', 'T2'], ['C1', 'T4'], ['C2', 'T3'], ['C2', 'T1'], ['C3', 'T4'], ['C3', 'T2'], ['C4', 'T1'], ['C4', 'T3'],
  // the left arrows: with each other, with the throughs of their own approach and the one opposite, and with every right turn but the opposite one
  ['L1', 'L2'], ['L1', 'L3'], ['L1', 'L4'], ['L2', 'L3'], ['L2', 'L4'], ['L3', 'L4'],
  ['L1', 'T1'], ['L1', 'T3'], ['L2', 'T2'], ['L2', 'T4'], ['L3', 'T3'], ['L3', 'T1'], ['L4', 'T4'], ['L4', 'T2'],
  ['L1', 'R1'], ['L1', 'R2'], ['L1', 'R4'], ['L2', 'R1'], ['L2', 'R2'], ['L2', 'R3'],
  ['L3', 'R2'], ['L3', 'R3'], ['L3', 'R4'], ['L4', 'R1'], ['L4', 'R3'], ['L4', 'R4']]
  .map((p) => p.sort().join('|')));

test('random states are accepted exactly when the hand-written table allows them', () => {
  const rand = rng(5);
  const vehicle = [...Array(10).fill('red'), 'yellow', 'green', 'flash'];
  const ped = [...Array(5).fill('stop'), 'walk', 'clear'];
  let accepted = 0;
  let refused = 0;
  for (let n = 0; n < 30000; n += 1) {
    const signals = {};
    for (const m of MOVEMENTS) {
      const pool = m[0] === 'C' ? ped : vehicle;
      signals[m] = pool[Math.floor(rand() * pool.length)];
    }
    const flashes = MOVEMENTS.filter((m) => m[0] !== 'C').map((m) => signals[m]);
    const lit = MOVEMENTS.filter((m) => ['green', 'yellow', 'walk', 'clear'].includes(signals[m]));
    const consistent = !flashes.includes('flash')
      || (flashes.every((s) => s === 'flash') && MOVEMENTS.filter((m) => m[0] === 'C').every((m) => signals[m] === 'stop'));
    let pairsOk = true;
    for (let i = 0; i < lit.length; i += 1) {
      for (let j = i + 1; j < lit.length; j += 1) pairsOk = pairsOk && ALLOWED.has([lit[i], lit[j]].sort().join('|'));
    }
    const allowed = consistent && pairsOk;
    try {
      assert.deepEqual(decode(encode(signals)), signals);
      accepted += 1;
      assert.ok(allowed);
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
      refused += 1;
      assert.ok(!allowed);
    }
  }
  assert.ok(accepted > 100 && refused > 100);
});

test('every tick of the controller, arrows included, makes a valid line that decodes back to the same signals', () => {
  const controller = new Controller({ plan: buildPlan(true), powerOn: true });
  const busy = makeCounts({ cars: 2 });
  let withArrowsLit = 0;
  for (let t = 0; t < 600; t += 1) {
    for (const a of [1, 2, 3, 4]) { controller.reportCounts(a, busy); controller.reportRightCounts(a, busy); controller.reportLeftCounts(a, busy); }
    if (t % 11 === 0) controller.requestCrossing(1 + (t % 4));
    const snap = controller.tick();
    const signals = withArrows(snap.signals, snap.arrows);
    assert.deepEqual(decode(encode(signals)), signals, `tick ${t}`);
    if (snap.arrows.some((state) => state === 'green')) withArrowsLit += 1;
  }
  assert.ok(withArrowsLit > 20, 'the run lit the left arrows');
});
