// Seeded random numbers, so every simulation run is reproducible.

export function makeRng(seed) {
  let a = seed | 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    // Seconds until the next arrival at a rate in events per hour.
    gap: (perHour) => (perHour <= 0 ? Infinity : -Math.log(1 - next()) * (3600 / perHour)),
    pick: (weights) => {
      const total = Object.values(weights).reduce((a2, b) => a2 + b, 0);
      let roll = next() * total;
      for (const [key, weight] of Object.entries(weights)) {
        roll -= weight;
        if (roll < 0) return key;
      }
      return Object.keys(weights).pop();
    },
  };
}
