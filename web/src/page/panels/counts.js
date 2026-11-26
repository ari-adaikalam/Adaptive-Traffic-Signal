// The live detector section of the Comparison panel's Live page: what the detector counts on each road against what is there, now.
import { el, fmt } from '../dom.js';
import { ROAD_NAMES, capital } from '../names.js';
import { section } from '../widgets.js';

export function buildCounts({ hooks }) {
  const rows = ROAD_NAMES.map((name) => { const detected = el('b', { text: '-' }), actual = el('span', { text: '-' }); return { detected, actual, node: el('div', { class: 'count-row' }, el('span', { text: capital(name) }), detected, actual) }; });
  const note = el('p', { class: 'note', role: 'status', 'aria-live': 'polite', text: 'The detector is off' });
  const node = section('Detector and actual', el('div', { class: 'count-table' }, el('div', { class: 'count-row head' }, el('span'), el('span', { text: 'Detector' }), el('span', { text: 'Actual' })), ...rows.map((r) => r.node)), note);
  const paint = (s) => {
    const on = s.state === 'on' && s.roads;
    rows.forEach((r, i) => { const road = on && s.roads[i]; r.detected.textContent = road ? String(road.detected) : '-'; r.actual.textContent = road ? String(road.actual) : '-'; });
    note.title = '';
    if (s.state === 'loading') note.textContent = 'Loading the detector';
    else if (s.state === 'error') { note.textContent = 'The detector could not start'; note.title = s.message || ''; }
    else if (!on) note.textContent = 'The detector is off';
    else if (!s.samples) note.textContent = 'Waiting for the first pictures';
    else note.textContent = `Within one vehicle ${fmt((100 * s.within1) / s.samples, 0)}%, no count ${fmt((100 * s.unknown) / (s.samples + s.unknown), 0)}%`;
  };
  paint(hooks.detectionStatus());
  setInterval(() => { if (node.offsetParent !== null) paint(hooks.detectionStatus()); }, 1000); // only while this page is showing
  return { node };
}
