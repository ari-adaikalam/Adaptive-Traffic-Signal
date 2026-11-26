// Serial line between the host and the signal controller, version 3. Port of protocol.py.
// One line: "V3 <16 characters> <2 hex digits>" and a newline. The characters are the signals
// T1 to T4, R1 to R4, L1 to L4 (the left arrows), C1 to C4. Vehicle and arrow: R Y G F (F is flashing red). Pedestrian:
// S solid red man, W walk, C flashing red man. The hex digits are CRC-8 (polynomial 0x07).

import { conflictFree } from './phases.js';

export const MOVEMENTS = ['T', 'R', 'L', 'C'].flatMap((kind) => [1, 2, 3, 4].map((n) => `${kind}${n}`));
const SIGNALS = MOVEMENTS.length; // 16
export const MAX_LINE_BYTES = 24;
const PREFIX = 'V3 ';
const VEHICLE_WORDS = { red: 'R', yellow: 'Y', green: 'G', flash: 'F' };
const PEDESTRIAN_WORDS = { stop: 'S', walk: 'W', clear: 'C' };

export class FormatError extends Error {}
export class ConflictError extends Error {}

export function crc8(data) {
  const bytes = typeof data === 'string' ? Array.from(data, (c) => c.charCodeAt(0)) : data;
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

const wordsFor = (movement) => (movement[0] === 'C' ? PEDESTRIAN_WORDS : VEHICLE_WORDS);

// Throws ConflictError unless the signals are consistent and conflict free.
export function checkSafe(signals) {
  const vehicle = MOVEMENTS.filter((m) => m[0] !== 'C').map((m) => signals[m]);
  if (vehicle.includes('flash')) {
    if (vehicle.some((s) => s !== 'flash')) throw new ConflictError('flashing and steady signals are mixed');
    if (MOVEMENTS.some((m) => m[0] === 'C' && signals[m] !== 'stop')) {
      throw new ConflictError('a pedestrian signal is active while the vehicle signals flash');
    }
  }
  const lit = MOVEMENTS.filter((m) => ['green', 'yellow', 'walk', 'clear'].includes(signals[m]));
  if (!conflictFree(lit)) throw new ConflictError('lit signals conflict');
}

export function encode(signals) {
  const keys = Object.keys(signals);
  if (keys.length !== MOVEMENTS.length || !MOVEMENTS.every((m) => m in signals)) {
    throw new Error('need exactly the 16 signals T1 to T4, R1 to R4, L1 to L4, C1 to C4');
  }
  let payload = '';
  for (const movement of MOVEMENTS) {
    const words = wordsFor(movement);
    const state = signals[movement];
    if (typeof state !== 'string' || !(state in words)) throw new Error(`signal ${movement} cannot be ${String(state)}`);
    payload += words[state];
  }
  checkSafe(signals);
  return `${PREFIX}${payload} ${crc8(payload).toString(16).toUpperCase().padStart(2, '0')}\n`;
}

// Parse one received line (a string or a Uint8Array) into the 16 signals. Strict about every character.
export function decode(line) {
  if (line.length > MAX_LINE_BYTES) throw new FormatError('line too long');
  let text;
  if (typeof line === 'string') {
    text = line;
  } else {
    if (line.some((b) => b > 127)) throw new FormatError('line is not ascii');
    text = String.fromCharCode(...line);
  }
  if (text.endsWith('\r\n')) text = text.slice(0, -2);
  else if (text.endsWith('\n')) text = text.slice(0, -1);
  if (text.length !== PREFIX.length + SIGNALS + 1 + 2 || !text.startsWith(PREFIX) || text[3 + SIGNALS] !== ' ') {
    throw new FormatError('not a version 3 line');
  }
  const payload = text.slice(3, 3 + SIGNALS);
  const crcText = text.slice(4 + SIGNALS);
  if (![...crcText].every((c) => '0123456789ABCDEF'.includes(c))) throw new FormatError('the checksum is not two upper case hex digits');
  const signals = {};
  MOVEMENTS.forEach((movement, i) => {
    const entry = Object.entries(wordsFor(movement)).find(([, code]) => code === payload[i]);
    if (!entry) throw new FormatError(`${payload[i]} is not a state of ${movement}`);
    signals[movement] = entry[0];
  });
  if (parseInt(crcText, 16) !== crc8(payload)) throw new FormatError('checksum mismatch');
  checkSafe(signals);
  return signals;
}

// The 16 signals of a line, from a controller snapshot's 12 signals and its four left arrows.
export function withArrows(signals, arrows) {
  const out = { ...signals };
  arrows.forEach((state, i) => { out[`L${i + 1}`] = state; });
  return out;
}
