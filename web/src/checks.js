// Small validation helpers shared by the modules. Every failure throws a plain Error.

export function isInt(value) {
  return typeof value === 'number' && Number.isInteger(value);
}

export function checkInt(name, value, minimum) {
  if (!isInt(value)) throw new Error(`${name} must be an int, got ${String(value)}`);
  if (value < minimum) throw new Error(`${name} must be at least ${minimum}, got ${value}`);
  return value;
}

export function ceilDiv(a, b) {
  return Math.floor((a + b - 1) / b);
}
