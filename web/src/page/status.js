// The status overlay, top left: the day and time, which timing is running, what the signals are doing in plain words, a small plan of the junction with a light on each road and a mark on each
// crossing, and, in the header, whether the bus lane is for buses only. It folds down to its headline, and starts folded on a narrow screen. It turns red in a fault and amber when an emergency vehicle has the green.
import { el, svg } from './dom.js';
import { describeSignals, describePedestrians, describeLeftArrows, roadName } from './names.js';
import { countdownText } from '../countdown.js';

const LIGHT = { green: '#34c759', yellow: '#ffcc00', red: '#ff453a' };
const WALK = { walk: '#34c759', clear: '#ffcc00' };
const turn = (k, x, y) => [[x, y], [-y, x], [-x, -y], [y, -x]][k]; // a point turned a quarter circle clockwise k times round the middle of a 100 by 100 plan

export function createStatus({ onModeClick }) {
  const day = el('b', { class: 'when' }), mode = el('button', { type: 'button', class: 'chip', title: 'Change the timing', 'aria-label': 'Timing, open the controls to change it' });
  mode.onclick = onModeClick;
  const fold = el('button', { type: 'button', class: 'fold' });
  const headline = el('p', { class: 'headline', role: 'status' });
  const detail = el('span'), people = el('span'), words = el('div', { class: 'words' }, detail, people);

  // the plan: the two roads, a light on the incoming half of each road just before its crossing (traffic keeps left), and a bar over each crossing
  const plan = svg('svg', { viewBox: '0 0 100 100', class: 'mini', role: 'img' });
  plan.append(svg('rect', { class: 'road', x: 36, y: 0, width: 28, height: 100 }), svg('rect', { class: 'road', x: 0, y: 36, width: 100, height: 28 }));
  const lamps = [], crossings = [], marks = [], markX = [], markY = [], counts = [];
  for (let k = 0; k < 4; k += 1) {
    const [lx, ly] = turn(k, 7, -35), [cx, cy] = turn(k, 0, -25); 
    crossings[k] = svg('rect', { class: 'crossing', x: 50 + cx - 14, y: 50 + cy - 1.6, width: 28, height: 3.2, rx: 1.5, transform: `rotate(${k * 90} ${50 + cx} ${50 + cy})` });
    lamps[k] = svg('circle', { class: 'lamp', cx: 50 + lx, cy: 50 + ly, r: 5.6, fill: LIGHT.red });
    // the turn arrow of this road, in its lane between the crossing and the junction: green or yellow when it is lit, and not drawn when it is red. It points the way the arrow turns, as a driver coming in on this road sees it.
    const [mx, my] = turn(k, 7, -18.5); markX[k] = 50 + mx; markY[k] = 50 + my;
    marks[k] = svg('path', { class: 'mark', d: 'M-4 0H4M1 -3.4L4 0L1 3.4', transform: `translate(${50 + mx} ${50 + my})`, fill: 'none', 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', visibility: 'hidden' });
    // the seconds for this road, beside its light and just off the road, where nothing else is drawn
    const [nx, ny] = turn(k, 25, -35); counts[k] = svg('text', { class: 'count', x: 50 + nx, y: 50 + ny + 4, 'text-anchor': 'middle' });
    plan.append(crossings[k], lamps[k], marks[k], counts[k]);
  }
  ['N', 'E', 'S', 'W'].forEach((letter, k) => { const [x, y] = turn(k, 0, -47); plan.append(svg('text', { class: 'letter', x: 50 + x, y: 50 + y + 3, 'text-anchor': 'middle' }, letter)); });

  const bus = el('span', { class: 'chip', 'aria-label': 'Bus lane' });
  const body = el('div', { class: 'status-body' }, el('div', { class: 'now' }, plan, words));
  const node = el('aside', { class: 'status', 'aria-label': 'Junction status' }, el('header', {}, day, mode, bus, fold), headline, body);

  const setFolded = (folded) => { body.hidden = folded; node.classList.toggle('folded', folded); fold.textContent = folded ? 'More' : 'Less'; fold.setAttribute('aria-expanded', String(!folded)); };
  fold.onclick = () => setFolded(!body.hidden);
  setFolded(matchMedia('(max-width: 899px)').matches);

  let lastLabel = '';
  return {
    node,
    update({ dayText, clockText, snap, summary, ahead }) {
      day.textContent = `${dayText} ${clockText}`;
      mode.textContent = snap.mode === 'fixed' ? 'Fixed' : 'Adaptive'; mode.setAttribute('aria-label', `Timing: ${mode.textContent.toLowerCase()}. Open the controls to change it`);
      const s = describeSignals(snap), p = describePedestrians(snap, ahead ? Math.max(0, ...ahead.crossings.filter((n) => n !== null)) : null);
      headline.textContent = s.title; detail.textContent = s.detail; people.textContent = describeLeftArrows(snap) || p || '';
      node.dataset.state = snap.stage === 'fault' ? 'fault' : snap.emergency_approach ? 'emergency' : 'normal';
      const stopped = snap.stage === 'fault' || snap.stage === 'flash';
      lamps.forEach((lamp, k) => {
        // the round light is the one for straight on, so it is red in a turn arrow phase, and the arrow is drawn on its own
        lamp.setAttribute('fill', stopped ? LIGHT.red : LIGHT[snap.signals[`T${k + 1}`]] || LIGHT.red);
        const right = stopped ? 'red' : snap.signals[`R${k + 1}`], left = stopped ? 'red' : (snap.shown_arrows || snap.arrows)[k];
        const arrow = right !== 'red' && LIGHT[right] ? right : left !== 'red' && LIGHT[left] ? left : null;
        marks[k].setAttribute('visibility', arrow ? 'visible' : 'hidden');
        if (arrow) { marks[k].setAttribute('stroke', LIGHT[arrow]); marks[k].setAttribute('transform', `translate(${markX[k]} ${markY[k]}) rotate(${k * 90 + (arrow === right ? 180 : 0)})`); }
      });
      counts.forEach((text, k) => { text.textContent = ahead ? countdownText(ahead.heads[k]) : ''; });
      crossings.forEach((c, k) => {
        const state = snap.signals[`C${k + 1}`], colour = WALK[state], asked = !colour && (snap.pedestrian_requests || []).includes(k + 1); // a button that was pressed shows in the accent colour until its walk starts
        c.setAttribute('fill', colour || 'currentColor'); c.style.fill = asked ? 'var(--accent)' : ''; c.setAttribute('opacity', colour || asked ? '1' : '.22');
      });
      const label = `Signals: ${[1, 2, 3, 4].map((n) => `${roadName(n)} ${stopped ? 'red' : snap.signals[`T${n}`]}`).join(', ')}`;
      if (label !== lastLabel) { plan.setAttribute('aria-label', label); lastLabel = label; }
      bus.textContent = snap.bus_lane_active ? 'Bus lane: buses' : 'Bus lane: open';
    },
  };
}
