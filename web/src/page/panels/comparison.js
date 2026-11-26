// The Comparison panel, two pages. Live: a run of both plans on the same traffic, and (in the 3D scene) what the detector counts against the true counts. Results: tables of what was measured before, with the columns named.
import { el, fmt } from '../dom.js';
import { section, button, tabs } from '../widgets.js';
import { EMERGENCY, RESULTS, GROUPS, SEEDS, DETECTOR } from '../results-data.js';
import { createLive } from '../live.js';
import { buildCounts } from './counts.js';

const DEMANDS = [['moderate', 'Moderate traffic'], ['light', 'Light traffic'], ['uneven', 'Uneven traffic'], ['peak', 'Heavy traffic']];
const SHORT = { uneven: 'Uneven traffic' };
const SHOWN = ['light', 'moderate', 'uneven', 'midday', 'evening']; // the rows the page shows (all eight are in docs/simulation.md)
const MINUTES = 60; // the live run is one simulated hour

export function buildComparison({ hooks = null, detection = false } = {}) {
  let live = null;
  const stop = () => { if (live) { live.stop(); live = null; } };

  // ---- the live run ----
  const select = el('select', { name: 'traffic', 'aria-label': 'Traffic to run' }, ...DEMANDS.map(([value, text]) => el('option', { value, text })));
  const run = button('Run', { class: 'primary' });
  const tile = (name, kind) => { const value = el('b', { text: '-' }), bar = el('i'), emergency = el('span', { class: 'sub', text: 'Emergency -' }); return { value, bar, emergency, node: el('div', { class: `tile ${kind}` }, el('span', { text: name }), value, el('div', { class: 'track' }, bar), emergency) }; };
  const fixed = tile('Fixed', 'fixed'), adaptive = tile('Adaptive', 'adaptive');
  const progress = el('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Simulated time', 'aria-valuemin': 0, 'aria-valuemax': MINUTES, 'aria-valuenow': 0 }, el('i'));
  const verdict = el('p', { class: 'verdict', text: 'Press Run' }); // always one line of words, so nothing moves when the result arrives
  verdict.setAttribute('aria-live', 'polite');
  const paint = (s) => {
    const minutes = Math.min(MINUTES, s.time / 60);
    progress.firstChild.style.width = `${(minutes / MINUTES) * 100}%`; progress.setAttribute('aria-valuenow', String(Math.round(minutes)));
    const worst = Math.max(s.fixed || 0, s.adaptive || 0, 1);
    for (const [t, v] of [[fixed, s.fixed], [adaptive, s.adaptive]]) { t.value.textContent = v === null ? '-' : `${fmt(v)} s`; t.bar.style.width = `${v === null ? 0 : Math.max(3, (v / worst) * 100)}%`; }
    // how long the emergency vehicles that have crossed waited, on average: the fixed plan has no priority for them, the adaptive plan does
    for (const [t, v] of [[fixed, s.emergency.fixed], [adaptive, s.emergency.adaptive]]) t.emergency.textContent = v === null ? 'Emergency -' : `Emergency ${fmt(v)} s`;
    if (!(s.fixed && s.adaptive && s.time > 300)) { verdict.textContent = 'Running'; return; } // the bar shows the progress
    const phrase = (a, b) => { const change = (a - b) / b; return Math.abs(change) < 0.05 ? 'similar' : change < 0 ? `${Math.round(-change * 100)}% lower` : `${Math.round(change * 100)}% higher`; };
    const e = s.emergency, ready = e.fixed && e.adaptive && e.fixedCrossed >= 3 && e.adaptiveCrossed >= 3; // a few emergency vehicles have crossed under both plans
    if (ready) verdict.textContent = `Adaptive: delay ${phrase(s.adaptive, s.fixed)}, emergency ${phrase(e.adaptive, e.fixed)}`;
    else verdict.textContent = `Adaptive: delay ${phrase(s.adaptive, s.fixed)}`;
  };
  run.onclick = () => { stop(); verdict.textContent = 'Running'; live = createLive({ demand: select.value, onUpdate: paint }); live.start(); };
  const watch = section('Fixed and adaptive plans',
    el('div', { class: 'row' }, select, run), el('div', { class: 'tiles' }, fixed.node, adaptive.node), progress, verdict);
  const livePage = el('div', { class: 'stack live' }, watch, ...(detection ? [buildCounts({ hooks }).node] : [])); // both live things on one page

  // ---- the results: tables, with the columns named and the direction said ----
  const cells = (list) => list.map((c) => (typeof c === 'string' ? el('span', { text: c }) : c));
  const rrow = (list, kind = '') => el('div', { class: `rrow ${kind}` }, ...cells(list));
  const against = (adaptive, fixed) => { const c = (adaptive - fixed) / fixed, tie = Math.abs(c) < 0.05; return el('span', { class: `badge ${tie ? 'tie' : c < 0 ? 'win' : 'worse'}`, text: tie ? 'Similar' : `${Math.round(Math.abs(c) * 100)}% ${c < 0 ? 'lower' : 'higher'}` }); };
  const delayRow = (r) => { const said = `Fixed ${fmt(r.fixed[0])} s (spread ${fmt(r.fixed[1])}), adaptive ${fmt(r.adaptive[0])} s (spread ${fmt(r.adaptive[1])}), adaptive better in ${r.better} of ${SEEDS} runs`; const row = rrow([SHORT[r.id] || r.label, fmt(r.fixed[0]), fmt(r.adaptive[0]), against(r.adaptive[0], r.fixed[0])]); row.title = said; return row; };
  const delays = section('Delay per vehicle, seconds',
    el('div', { class: 'rtable' }, rrow(['', 'Fixed', 'Adaptive', 'Adaptive is'], 'head'), ...GROUPS.flatMap((g) => RESULTS.filter((r) => r.group === g.id && SHOWN.includes(r.id))).map(delayRow)));
  const emergencyRow = (r) => { const row = rrow([r.label, fmt(r.fixed[0]), fmt(r.adaptive[0]), against(r.adaptive[0], r.fixed[0])]); row.title = `Fixed: median ${fmt(r.fixed[1])} s, worst ${fmt(r.fixed[2])} s. Adaptive: median ${fmt(r.adaptive[1])} s, worst ${fmt(r.adaptive[2])} s`; return row; };
  const emergency = section('Emergency wait to cross, seconds', el('div', { class: 'rtable' }, rrow(['', 'Fixed', 'Adaptive', 'Adaptive is'], 'head again'), ...EMERGENCY.map(emergencyRow)));
  const accuracyRow = (r) => { const row = rrow([r.label, ...r.values], 'two'); row.title = r.said; return row; };
  const accuracy = section('Detector accuracy', el('div', { class: 'rtable' }, rrow(['', ...DETECTOR.columns], 'head two'), ...DETECTOR.rows.map(accuracyRow)));
  const resultsPage = el('div', { class: 'stack results' }, delays, emergency, ...(detection ? [accuracy] : []));

  const pages = [['Live', livePage], ['Results', resultsPage]];
  const node = tabs('Comparison', pages);
  return { node, stop };
}
