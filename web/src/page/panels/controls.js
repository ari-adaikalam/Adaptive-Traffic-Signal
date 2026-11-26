// The Controls panel: what the visitor can change, in plain words, grouped by what it does.
import { el, capital } from '../dom.js';
import { ROAD_NAMES } from '../names.js';
import { segmented, field, section, button, tabs } from '../widgets.js';

const SAY = { clear: 'clear', partly: 'partly cloudy', overcast: 'overcast', rain: 'rain', fog: 'fog' };

// features says which controls this page has: the flat 2D view has no light, weather or view controls.
export function buildControls({ hooks, weatherNames = [], features }) {
  const signals = [], scene = [];
  let viewChoice = null;
  const timing = section('Signal timing', field('Timing', segmented('Signal timing', [['Adaptive', false], ['Fixed', true]], (fixed) => hooks.setMode(fixed), false), true));
  signals.push(timing);
  let speedGroup = null;
  if (features.light) scene.push(field('Light', segmented('Light', [['Live', null], ['Dawn', 'dawn'], ['Day', 0], ['Dusk', 'dusk'], ['Night', 1]], (v) => hooks.setLook(v), null), true));
  speedGroup = segmented('Speed', [['Normal', 1], ['4× faster', 4], ['12× faster', 12]], (n) => hooks.setSpeed(n), 1);
  scene.push(field('Speed', speedGroup, true));
  let refresh = () => {};
  if (features.weather) { // Automatic follows the weather near the visitor's city when it could be fetched. The hover text says which it is doing.
    const grid = segmentedGrid(weatherNames, hooks), automatic = grid.querySelector('button');
    refresh = () => { const w = hooks.weatherSource(); automatic.title = w.live ? `The weather now near ${w.city}: ${SAY[w.live] || w.live} (Open-Meteo)` : 'A pick for the day, not the real weather'; };
    scene.push(field('Weather', grid));
  }
  if (features.view) {
    viewChoice = segmented('View', [['Angled', false], ['Top down', true]], (top) => hooks.setTop(top), false);
    scene.push(field('View', viewChoice, true));
    scene.push(field('Quality', segmented('Quality', [['High', 'high'], ['Low', 'low']], (q) => hooks.setQuality(q), 'high'), true));
  }

  // Camera detection (the 3D scene only): the controller's counts from a detector looking at the eight camera views, or from the simulator. A line under it says what is happening.
  if (features.detection) {
    const head = el('span', { text: 'Counts from the simulator' }), detail = el('span', { text: 'Every vehicle, exactly' });
    const note = el('p', { class: 'note two', role: 'status', 'aria-live': 'polite' }, head, detail); // two lines, a status and what goes with it, and both always say something, so nothing moves as the state changes
    let timer = null;
    const set = (top, below, title = '') => { head.textContent = top; detail.textContent = below; note.title = title; };
    const say = (s) => {
      if (s.state === 'loading') return set('Loading the detector', '22 MB, once');
      if (s.state === 'error') return set('The detector could not start', "Using the simulator's counts", s.message || '');
      if (s.state !== 'on') return set('Counts from the simulator', 'Every vehicle, exactly');
      if (s.cameras === 'off') return set('Waiting for the first pictures', 'Default green until then');
      if (s.cameras === 'partial') return set('Some cameras have no picture', 'Those roads use the default green');
      return set('Detector / actual', s.roads ? ROAD_NAMES.map((n, i) => `${n[0].toUpperCase()} ${s.roads[i] ? `${s.roads[i].detected}/${s.roads[i].actual}` : '-'}`).join(', ') : 'Counting from the cameras');
    };
    const lockSpeed = (on) => speedGroup && speedGroup.querySelectorAll('button').forEach((b, i) => { b.disabled = on && i > 0; });
    const group = segmented('Vehicle counts', [['Simulator', false], ['Detector', true]], (on) => {
      clearInterval(timer);
      if (on) { speedGroup.select(1); lockSpeed(true); } else lockSpeed(false);
      say(hooks.setDetection(on));
      if (on) timer = setInterval(() => { const s = hooks.detectionStatus(); say(s); if (s.state === 'error') { group.select(false); lockSpeed(false); clearInterval(timer); } }, 1000);
    }, false);
    timing.append(field('Counts', el('div', { class: 'field-body' }, group, note), true)); // beside the timing, so the page still fits without scrolling
  }

  // one button for each road, so the visitor chooses where it happens: crossing n crosses road n, and the emergency vehicle (an ambulance, a fire engine or a police car, picked at random) comes in on road n.
  // A press shows at once: the button stays lit for a moment and a line under it says what was done.
  const roadButtons = (label, act, say, done, hint) => {
    const note = el('p', { class: 'note sent idle', role: 'status', 'aria-live': 'polite', text: hint }); // never empty: it says what to do until something is sent
    let timer = null;
    const row = el('div', { class: 'actions roads' }, ...ROAD_NAMES.map((road, i) => {
      const b = button(capital(road), { class: 'action', 'aria-label': say(road), 'aria-pressed': 'false' });
      b.onclick = () => {
        act(i + 1);
        row.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        note.textContent = done(road); note.classList.remove('idle'); clearTimeout(timer);
        timer = setTimeout(() => { note.textContent = hint; note.classList.add('idle'); row.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', 'false')); }, 4000);
      };
      return b;
    }));
    return field(label, el('div', { class: 'field-body' }, row, note));
  };
  signals.push(section('Make it happen',
    roadButtons('Send an emergency vehicle from', (n) => hooks.ambulance(n), (road) => `Send an emergency vehicle in from the ${road} road`, (road) => `Sent from the ${road} road`, 'Choose a road'),
    roadButtons('Press a crossing button on', (n) => hooks.press(n), (road) => `Press the crossing button on the ${road} road`, (road) => `Pressed on the ${road} road`, 'Choose a road')));

  return { node: tabs('Controls', [['Signals', el('div', { class: 'stack spread one-row' }, ...signals)], ['Scene', el('div', { class: 'stack spread' }, ...scene)]]), refresh, showTop: (top) => { if (viewChoice) viewChoice.select(top); } };
}

// the weather choices are too many for one row, so they wrap as a set of radio buttons
function segmentedGrid(weatherNames, hooks) {
  const items = [['Automatic', 'auto'], ...weatherNames.map((n) => [capital(n), n])];
  const group = segmented('Weather', items, (n) => hooks.setWeather(n), 'auto');
  group.classList.add('wrap');
  return group;
}
