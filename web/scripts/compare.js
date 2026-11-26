// Run the fixed against adaptive comparison and print a table.
//   node scripts/compare.js                 all presets, 10 seeds, one simulated hour each
//   node scripts/compare.js peak 20 1800    one preset, 20 seeds, 1800 simulated seconds
import { PRESETS } from '../src/sim/traffic.js';
import { compare, markdownTable } from '../src/sim/compare.js';

const [which = 'all', seedCount = '10', seconds = '3600'] = process.argv.slice(2);
const names = which === 'all' ? Object.keys(PRESETS) : [which];
const seeds = Array.from({ length: Number(seedCount) }, (_, i) => i + 1);
for (const name of names) {
  const result = compare({ preset: name, seeds, seconds: Number(seconds) });
  console.log(`\n### ${name}: ${seeds.length} seeds of ${seconds} s, same arrivals in both modes: ${result.sameArrivals}`);
  console.log(markdownTable(result));
}
