// Small helpers for building the page: elements, SVG, icons, and the way things fade in and out.

export const el = (tag, attrs = {}, ...kids) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'data') Object.assign(node.dataset, value);
    else if (key.startsWith('aria-') || key === 'role') node.setAttribute(key, value);
    else node[key] = value;
  }
  node.append(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));
  return node;
};

const NS = 'http://www.w3.org/2000/svg';
export const svg = (tag, attrs = {}, ...kids) => {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.append(...kids.flat().filter(Boolean));
  return node;
};

// Line icons, 24 by 24, drawn with the current text colour: each is a list of shapes.
const ICONS = {
  compare: [['path', { d: 'M5 20V11M12 20V4M19 20v-6' }]],
  camera: [['path', { d: 'M3 8.5h3l1.6-2.5h8.8L18 8.5h3V19H3z' }], ['circle', { cx: '12', cy: '13.5', r: '3.4' }]],
  sound: [['path', { d: 'M4 9.5v5h3.8L13 18.5v-13L7.8 9.5z' }], ['path', { d: 'M16.2 9a4.2 4.2 0 0 1 0 6M18.6 6.6a7.6 7.6 0 0 1 0 10.8' }]],
  muted: [['path', { d: 'M4 9.5v5h3.8L13 18.5v-13L7.8 9.5z' }], ['path', { d: 'M16.5 9.5l4.5 5M21 9.5l-4.5 5' }]],
  controls: [['path', { d: 'M4 7h9M17 7h3M4 17h3M11 17h9' }], ['circle', { cx: '15', cy: '7', r: '2.2' }], ['circle', { cx: '9', cy: '17', r: '2.2' }]],
  places: [['path', { d: 'M12 21s6-5.6 6-10.5a6 6 0 0 0-12 0C6 15.4 12 21 12 21z' }], ['circle', { cx: '12', cy: '10.5', r: '2.2' }]],
  home: [['path', { d: 'M4 11.5L12 4.5l8 7M6.5 10v9.5h11V10' }]],
  close: [['path', { d: 'M6 6l12 12M18 6L6 18' }]],
  target: [['circle', { cx: '12', cy: '12', r: '3' }], ['path', { d: 'M12 3v3M12 18v3M3 12h3M18 12h3' }]],
};
export const icon = (name, size = 22) => {
  const node = svg('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' });
  node.append(...ICONS[name].map(([tag, attrs]) => svg(tag, attrs))); // built from the shapes above, not parsed from a string
  return node;
};

// A thing that fades and slides in and out. `shown` is the state, and `hidden` is only set once the fade has finished, so it can be animated.
export const isOpen = (node) => node.classList.contains('shown');
export const reveal = (node, on, after = 200) => {
  clearTimeout(node.fadeTimer);
  if (on) { node.hidden = false; node.getBoundingClientRect(); node.classList.add('shown'); } // the read makes the browser draw the hidden state first, so the change is animated
  else { node.classList.remove('shown'); node.fadeTimer = setTimeout(() => { node.hidden = true; }, after); }
};

export const capital = (text) => text[0].toUpperCase() + text.slice(1);
export const fmt = (v, digits = 1) => v.toFixed(digits);
