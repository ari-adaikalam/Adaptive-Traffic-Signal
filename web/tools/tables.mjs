// The results tables: adaptive timing against fixed timing on the same seeded traffic, the full mix of vehicles, and the cameras of CAMERA_RIG.
// Fixed means the controller's default 10 s green, one plan for the whole day (the best single green over a typical day, found once), and a plan tuned to each demand
// (not something a real junction can do, shown as the hardest comparison). Usage: node tools/tables.mjs <preset> [seeds] [seconds]
import { compare, markdownTable, tuneRealistic } from '../src/sim/compare.js';
import { CAMERA_RIG } from '../src/sim/world.js';

const preset = process.argv[2], seedCount = Number(process.argv[3] || 10), seconds = Number(process.argv[4] || 3600);
const dayPlan = tuneRealistic();
const result = compare({ preset, seeds: Array.from({ length: seedCount }, (_, i) => i + 1), seconds, fullMix: true, rig: CAMERA_RIG, realisticGreen: dayPlan.green });
console.log(`### ${preset}\n`);
console.log(markdownTable(result));
console.log(`\nsame arrivals in every mode: ${result.sameArrivals}; one plan for the day: ${dayPlan.green} s\n`);
