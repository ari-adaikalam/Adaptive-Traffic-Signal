// The Cameras panel. A small plan of the junction shows all eight cameras where they stand, with the stretch of road each one watches, and a number on each for how many vehicles it counts now.
// Choosing one shows the picture from it with a box round every vehicle it counts, and what it counts by lane and by kind. The scene draws the picture into `view.canvas`.
import { el, svg, capital } from '../dom.js';
import { button } from '../widgets.js';

const LANES = ['Left', 'Middle', 'Right']; // the kerb lane, the middle lane and the right-turn lane
const KINDS = [['cars', 'car', 'cars'], ['trucks', 'truck', 'trucks'], ['buses', 'bus', 'buses'], ['bikes', 'bike', 'bikes'], ['emergency', 'emergency vehicle', 'emergency vehicles']];
const SIGNAL = { green: '#34c759', yellow: '#ffcc00', red: '#ff453a' };
// the plan, in units of a 100 by 100 square: the stop line is 9 from the middle and the 80 m of detection zone reaches 36 units further, so 20 m is 18 from the middle and 60 m is 36
const STOP = 10, PER_METRE = 0.42, ROAD = 16;
const turn = (k, x, y) => [[x, y], [-y, x], [-x, -y], [y, -x]][k]; // a point turned a quarter circle clockwise k times round the middle

export function buildCameras({ cameras, rig, hooks }) {
  let index = -1;

  // ---- the plan ----
  const plan = el('div', { class: 'plan' });
  const drawing = svg('svg', { viewBox: '0 0 100 100', role: 'img', 'aria-label': 'Plan of the junction with the eight cameras and the stretch of road each one watches' });
  drawing.append(svg('rect', { class: 'ground', x: 0, y: 0, width: 100, height: 100, rx: 10 }), svg('rect', { class: 'road', x: 50 - ROAD / 2, y: 0, width: ROAD, height: 100 }), svg('rect', { class: 'road', x: 0, y: 50 - ROAD / 2, width: 100, height: ROAD }));
  const lamps = [], zones = [];
  for (let k = 0; k < 4; k += 1) {
    const g = svg('g', { transform: `rotate(${k * 90} 50 50)` });
    const half = 40 * PER_METRE; // the near camera watches the first 40 m of the zone and the far camera the next 40 m, drawn as two halves of the strip
    const zone = (from, to) => svg('rect', { class: 'zone', x: 50 - ROAD / 2, y: 50 - to, width: ROAD, height: to - from });
    const near = zone(STOP, STOP + half), far = zone(STOP + half, STOP + 2 * half);
    zones[k * 2] = near; zones[k * 2 + 1] = far;
    const lamp = svg('circle', { class: 'lamp', cx: 50 + ROAD / 4, cy: 50 - STOP + 1.5, r: 2, fill: SIGNAL.red });
    lamps[k] = lamp;
    g.append(far, near, svg('rect', { class: 'stop', x: 50 - ROAD / 2, y: 50 - STOP, width: ROAD / 2, height: 0.6 }), lamp);
    drawing.append(g);
  }
  ['N', 'E', 'S', 'W'].forEach((letter, k) => { const [x, y] = turn(k, 0, -45); drawing.append(svg('text', { class: 'letter', x: 50 + x, y: 50 + y + 1.5, 'text-anchor': 'middle' }, letter)); });
  plan.append(drawing);
  const dots = cameras.map((c, i) => {
    const r = STOP + c.along * PER_METRE, [dx, dy] = turn(c.approach - 1, -(ROAD / 2 + 4), -r);
    const dot = el('button', { type: 'button', class: 'dot', text: '-', 'aria-label': `${capital(c.road)} road, ${c.which} camera`, style: `left:${50 + dx}%;top:${50 + dy}%` });
    dot.onclick = () => select(i);
    plan.append(dot); return dot;
  });

  // ---- the picture and what it counts ----
  const canvas = el('canvas', { class: 'picture', role: 'img', 'aria-label': 'The view from the chosen camera, with a box round each vehicle it counts' });
  const ctx = canvas.getContext('2d');
  const title = el('b'), show = button('Show in the scene', { class: 'quiet' });
  show.onclick = () => hooks.focusCamera(index);
  const total = el('b', { text: '-' }), stopped = el('span'), kinds = el('p', { class: 'kinds', text: 'Nothing in view' });
  const lanes = LANES.map(() => el('b', { text: '-' }));
  const numbers = el('div', { class: 'numbers' },
    el('div', { class: 'total' }, total, el('span', { text: ' counted' }), stopped),
    el('div', { class: 'lanes' }, ...LANES.map((name, i) => el('div', {}, lanes[i], el('small', { text: name })))), kinds);

  const node = el('div', { class: 'stack cams' },
    el('div', { class: 'camhead' }, title, show),
    el('div', { class: 'picturebox' }, canvas),
    el('div', { class: 'camlow' }, el('div', { class: 'planbox' }, plan), numbers));

  function select(i) {
    const c = cameras[i]; if (!c) return;
    index = i; hooks.openCamera(i);
    title.textContent = `${capital(c.road)} road, ${c.which} camera`;
    dots.forEach((d, j) => d.setAttribute('aria-pressed', String(j === i)));
    zones.forEach((z, j) => z.classList.toggle('active', j === i));
  }
  // the canvas is sized to its box, in device pixels, so the picture stays sharp and the scene knows how big and what shape to draw
  const sizeCanvas = () => { const box = canvas.parentElement, w = box.clientWidth, h = box.clientHeight; if (!w || !h) return; const dpr = Math.min(devicePixelRatio || 1, 2), px = Math.min(720, Math.round(w * dpr)), py = Math.round(px * h / w); if (canvas.width !== px || canvas.height !== py) { canvas.width = px; canvas.height = py; } }; // the shape of the box, whatever it is: the scene draws the camera's view at that shape
  new ResizeObserver(sizeCanvas).observe(canvas.parentElement);

  return {
    node, select,
    get index() { return index; },
    // the picture, drawn by the scene into this canvas, and the boxes drawn over it here
    view: {
      canvas, ctx, prepare: () => { sizeCanvas(); return canvas.width > 0; },
      draw(boxes) {
        const { width: w, height: h } = canvas; ctx.lineWidth = Math.max(1.5, w / 420); ctx.font = `${Math.round(Math.max(10, w / 60))}px system-ui, sans-serif`; ctx.textBaseline = 'top';
        for (const b of boxes) {
          const x = b.x0 * w, y = b.y0 * h, bw = (b.x1 - b.x0) * w, bh = (b.y1 - b.y0) * h;
          ctx.strokeStyle = '#ffd23f'; ctx.strokeRect(x, y, bw, bh);
          const tw = ctx.measureText(b.label).width + 8, th = Math.round(w / 48); ctx.fillStyle = '#ffd23f'; ctx.fillRect(x, y - th, tw, th); ctx.fillStyle = '#1d2125'; ctx.fillText(b.label, x + 4, y - th + 1);
        }
      },
    },
    update({ counts, snap }) {
      if (counts) {
        counts.forEach((n, i) => { dots[i].textContent = String(n.total); });
        const n = counts[index];
        if (n) {
          total.textContent = String(n.total); stopped.textContent = n.total ? `, ${n.stopped} stopped` : '';
          n.lanes.forEach((v, k) => { lanes[k].textContent = String(v); });
          const parts = KINDS.filter(([k]) => n.kinds[k]).map(([k, one, many]) => `${n.kinds[k]} ${n.kinds[k] === 1 ? one : many}`);
          kinds.textContent = parts.length ? parts.join(', ') : 'Nothing in view'; kinds.title = kinds.textContent;
        }
      }
      if (snap) lamps.forEach((lamp, k) => lamp.setAttribute('fill', snap.stage === 'fault' || snap.stage === 'flash' ? SIGNAL.red : SIGNAL[snap.signals[`T${k + 1}`]] || SIGNAL.red));
    },
  };
}
