// What the Results sheet shows. Mean vehicle delay in seconds over 10 seeds of one simulated hour, the same arrivals in both modes, adaptive behind the camera rig with the 40 s cap,
// against the one fixed plan for the day (every green 40 s). [mean, standard deviation]. Copied from docs/simulation.md, which has the full tables and how they were made:
// `node tools/tables.mjs <preset> 10 3600` for the presets and `node tools/zone.mjs rig 10 3600` for the clock rows. `better` is the number of seeds out of 10 where adaptive was better.
export const SEEDS = 10;
export const GROUPS = [{"id": "steady", "label": "Steady traffic"}, {"id": "varying", "label": "Traffic that changes"}, {"id": "clock", "label": "A weekday, by the clock"}];
export const RESULTS = [{"id": "light", "label": "Light traffic", "fixed": [36.6, 1.1], "adaptive": [23.3, 0.9], "pedFixed": 46.4, "pedAdaptive": 30.8, "better": 10, "group": "steady"}, {"id": "moderate", "label": "Moderate traffic", "fixed": [45.2, 1.0], "adaptive": [33.8, 1.0], "pedFixed": 43.2, "pedAdaptive": 33.6, "better": 10, "group": "steady"}, {"id": "uneven", "label": "Uneven: two roads much busier", "fixed": [55.4, 3.8], "adaptive": [38.8, 1.6], "pedFixed": 43.0, "pedAdaptive": 33.9, "better": 10, "group": "steady"}, {"id": "day", "label": "A whole day squeezed into an hour", "fixed": [49.6, 2.7], "adaptive": [35.7, 2.0], "pedFixed": 43.0, "pedAdaptive": 33.8, "better": 10, "group": "varying"}, {"id": "bus_hours", "label": "Bus hours, with more buses", "fixed": [42.5, 0.8], "adaptive": [34.1, 1.0], "pedFixed": 63.1, "pedAdaptive": 35.1, "better": 10, "group": "varying"}, {"id": "morning", "label": "Morning rush, 7:30", "fixed": [61.0, 4.3], "adaptive": [58.9, 2.8], "better": 6, "group": "clock"}, {"id": "midday", "label": "Midday, 12:00", "fixed": [53.2, 2.7], "adaptive": [43.4, 2.9], "better": 10, "group": "clock"}, {"id": "evening", "label": "Evening rush, 17:00", "fixed": [58.6, 3.1], "adaptive": [58.2, 5.3], "better": 5, "group": "clock"}];
// How long emergency vehicles wait to cross, from the moment they are on the road to the stop line, less the time to drive in. The same calls to both plans (one every 4 minutes for an hour, about 150 in 10 runs of
// each), on the same traffic. The fixed plan has no priority: an emergency vehicle slows at a red or yellow and goes through as soon as the way is clear. The adaptive plan gives priority from 120 m out.
// `node tools/emergency.mjs <preset> 10 3600`. [mean, median, worst] in seconds; `delay` is the mean delay of all vehicles in the same runs. Copied from docs/simulation.md.
export const EMERGENCY = [
  { id: 'light', label: 'Light traffic', fixed: [19.6, 8.8, 90.6], adaptive: [5.5, 3.3, 22.1], delay: [37.6, 23.9] },
  { id: 'moderate', label: 'Moderate traffic', fixed: [31.4, 24.8, 141.3], adaptive: [7.9, 6.1, 26.8], delay: [47.1, 35.6] },
  { id: 'peak', label: 'Heavy traffic', fixed: [56.4, 47.0, 382.0], adaptive: [16.4, 11.5, 111.3], delay: [113.5, 83.7] },
];

// How well the camera detector does, for the Results page. Scores on pictures from simulation runs the model never trained on, in this scene's own render only: the test runs, and night with rain, a condition held out of
// all training. Copied from docs/results.md (`node web/tools/detect-eval.mjs`). Per vehicle at IoU 0.5; the count is a stretch of road against the true number of vehicles there.
export const DETECTOR = {
  columns: ['Unseen runs', 'Night rain'],
  rows: [
    { label: 'Vehicles found', values: ['99.6%', '99.5%'], said: 'Recall: the share of the vehicles a camera can see that the detector finds' },
    { label: 'Found that are real', values: ['98.4%', '98.8%'], said: 'Precision: the share of what the detector marks as a vehicle that is one' },
    { label: 'Within one vehicle', values: ['99.1%', '100%'], said: 'The share of pictures where the count of a stretch is at most one off the true number' },
    { label: 'Count error', values: ['0.10', '0.01'], said: 'The mean absolute error of the count of a stretch' },
  ],
};
