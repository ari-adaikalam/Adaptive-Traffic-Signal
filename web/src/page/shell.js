// The page around the scene. Three things, and nothing else: a status overlay at the top left with the time, what the signals are doing and how the junction is doing, a dock at the bottom,
// and one panel that the dock fills with Comparison, Cameras or Controls. The panel stands centred above the dock, one size for every panel and tab, with no scrolling.
// The scene gives the shell a handful of hooks and calls `update` a few times a second and `light` every frame. Nothing here knows about Three.js or the simulator, apart from the live comparison.
import { el, icon, isOpen, reveal, capital } from './dom.js';
import { createStatus } from './status.js';
import { buildControls } from './panels/controls.js';
import { buildComparison } from './panels/comparison.js';
import { buildCameras } from './panels/cameras.js';
import { buildPlaces } from './panels/places.js';

// The surfaces and the ink follow the light of the scene, from day to night.
const DAY = { surface: [255, 255, 255], raised: [241, 243, 248], ink: [21, 25, 34], muted: [91, 100, 114], line: [21, 25, 34, 0.1], accent: [50, 87, 232], fixed: [138, 146, 160], win: [23, 128, 63] };
const NIGHT = { surface: [24, 28, 38], raised: [34, 39, 53], ink: [236, 238, 243], muted: [153, 161, 176], line: [255, 255, 255, 0.11], accent: [134, 162, 255], fixed: [111, 119, 136], win: [95, 208, 139] };
const blend = (a, b, t) => a.map((v, i) => Math.round((v + (b[i] - v) * t) * 100) / 100);
const rgb = (c) => (c.length === 4 ? `rgba(${c.join(',')})` : `rgb(${c.join(',')})`);

const TITLES = { comparison: 'Comparison', cameras: 'Cameras', places: 'Go to', controls: 'Controls' };

// features says which parts the page has: the flat 2D view has no light, weather, camera or view controls.
// cameras: [{ approach, road, which: 'near' | 'far', along, mount, height, lens }], each road's near camera first.
// rig: { zone, low, high }, the length of the detection zone in metres and the least and most share of vehicles the cameras together pick out in any 20 m of it.
export function createShell({ hooks, weatherNames = [], cameras = [], rig = null, features = {} }) {
  const has = { light: true, weather: true, view: true, camera: true, detection: false, ...features };
  const root = document.documentElement;
  let current = null, lastFocus = null;

  // ---- the status overlay, top left. Its timing chip opens the controls, where the timing is changed ----
  const status = createStatus({ onModeClick: () => { open('controls'); seen(); } });

  // ---- the panels ----
  const controls = buildControls({ hooks, weatherNames, features: has });
  // "Show in the scene" closes the panel, because the panel stands over the middle of the scene where the viewpoint ends up
  const camerasPanel = has.camera ? buildCameras({ cameras, rig, hooks: { ...hooks, focusCamera: (i) => { close(); hooks.focusCamera(i); } } }) : null;
  // a place closes the panel too, for the same reason
  const placesPanel = has.view ? buildPlaces({ hooks: { ...hooks, goTo: (id) => { close(); hooks.goTo(id); } } }) : null;
  let comparison = null; // built when first opened
  const make = {
    controls: () => controls,
    places: () => placesPanel,
    cameras: () => camerasPanel,
    comparison: () => comparison || (comparison = buildComparison({ hooks, detection: has.detection })),
  };

  const title = el('h2', { id: 'panel-title', text: '' });
  const closeButton = el('button', { type: 'button', class: 'icon-button', 'aria-label': 'Close panel' }, icon('close', 20));
  const body = el('div', { class: 'panel-body' });
  const panel = el('aside', { class: 'panel', hidden: true, tabIndex: -1, role: 'complementary', 'aria-labelledby': 'panel-title' }, el('header', {}, title, closeButton), body);

  // ---- the dock ----
  const items = [['comparison', 'compare', 'Comparison'], ...(has.camera ? [['cameras', 'camera', 'Cameras']] : []), ...(has.view ? [['places', 'places', 'Go to']] : []), ['controls', 'controls', 'Controls']];
  const dockButtons = {};
  const dock = el('nav', { class: 'dock', 'aria-label': 'Page' });
  for (const [name, glyph, label] of items) {
    const b = el('button', { type: 'button', class: 'dock-item', 'aria-pressed': 'false' }, icon(glyph), el('span', { text: label }));
    b.onclick = () => toggle(name); dockButtons[name] = b; dock.append(b);
  }
  const soundIcon = el('span', { class: 'glyph' }, icon('muted'));
  const soundButton = el('button', { type: 'button', class: 'dock-item', 'aria-pressed': 'false' }, soundIcon, el('span', { text: 'Sound' }));
  soundButton.onclick = async () => { const on = Boolean(await hooks.setSound(soundButton.getAttribute('aria-pressed') !== 'true')); soundButton.setAttribute('aria-pressed', String(on)); soundIcon.replaceChildren(icon(on ? 'sound' : 'muted')); seen(); };
  dock.append(soundButton);
  try { if (!localStorage.getItem('seen-dock')) dock.classList.add('cue'); } catch { dock.classList.add('cue'); } // a soft pulse the first time, so the visitor sees that it exists
  function seen() { dock.classList.remove('cue'); try { localStorage.setItem('seen-dock', '1'); } catch { /* private window: the cue shows again next time */ } }

  // ---- opening and closing ----
  function toggle(name) { if (current === name && isOpen(panel)) close(); else open(name); seen(); }
  function open(name) {
    if (current === 'comparison' && name !== 'comparison' && comparison) comparison.stop();
    if (current === 'cameras' && name !== 'cameras') hooks.closeCamera();
    const first = !isOpen(panel); if (first) lastFocus = document.activeElement;
    current = name; const content = make[name]();
    title.textContent = TITLES[name]; body.replaceChildren(content.node); body.scrollTop = 0; if (content.refresh) content.refresh();
    if (name === 'cameras') content.select(Math.max(0, content.index));
    for (const [key, b] of Object.entries(dockButtons)) b.setAttribute('aria-pressed', String(key === name));
    document.body.dataset.panel = name; document.body.classList.add('has-panel');
    reveal(panel, true, 240);
    if (first) panel.focus({ preventScroll: true });
  }
  function close() {
    if (!isOpen(panel)) return;
    if (current === 'comparison' && comparison) comparison.stop();
    if (current === 'cameras') hooks.closeCamera();
    reveal(panel, false, 240); current = null; delete document.body.dataset.panel; document.body.classList.remove('has-panel');
    for (const b of Object.values(dockButtons)) b.setAttribute('aria-pressed', 'false');
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  }
  closeButton.onclick = close;
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen(panel)) close(); });
  // A press anywhere outside the panel closes it, as on a map: the panel, the dock (its buttons open and close panels themselves), the status card, the way home and the camera tags are not outside.
  addEventListener('pointerdown', (e) => { if (isOpen(panel) && e.target instanceof Element && !e.target.closest('.panel, .dock, .status, .home, .markers')) close(); }, true);

  // ---- back to the start view in one click, shown only while the viewpoint is somewhere else. H does the same from the keyboard. ----
  const homeButton = el('button', { type: 'button', class: 'home', hidden: true, 'aria-label': 'Back to the junction', title: 'Back to the junction (H)' }, icon('home', 18), el('span', { text: 'Junction' }));
  homeButton.onclick = () => hooks.goHome();
  if (has.view) addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'h' && !e.metaKey && !e.ctrlKey && !e.altKey && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || '')) hooks.goHome(); });

  // ---- markers over the cameras in the scene, so it is clear that they can be opened. The scene places them every frame. ----
  const markerLayer = el('div', { class: 'markers' }), markers = [];
  if (has.camera) cameras.forEach((c, index) => {
    const m = el('button', { type: 'button', class: 'marker', 'aria-label': `Look through the ${c.road} road ${c.which} camera` }, icon('camera', 16), el('span', { class: 'tip', text: `${capital(c.road)} road, ${c.which} camera` }));
    m.onclick = () => { if (current !== 'cameras') open('cameras'); camerasPanel.select(index); seen(); };
    markerLayer.append(m); markers[index] = m;
  });
  setTimeout(() => markerLayer.classList.add('calm'), 9000); // the markers pulse for the first few seconds, then keep still

  // a tag for each emergency vehicle on its way in, so a press of Send an ambulance is answered at once and the visitor can see where each one is. The tags are made as they are needed.
  const alertTags = [];
  const alertTag = (i) => {
    if (!alertTags[i]) {
      const node = el('div', { class: 'alert', hidden: true }), arrow = el('span', { class: 'arrow', 'aria-hidden': 'true', text: '▲' }), label = el('span', { class: 'label' });
      node.append(arrow, label); markerLayer.append(node); alertTags[i] = { node, arrow, label };
    }
    return alertTags[i];
  };

  document.body.append(markerLayer, status.node, panel, dock, homeButton);

  // ---- the light of the scene sets the colours of the page. Any blend between a white surface and a dark one passes through a grey where the text cannot be read, so the page does not follow the
  // sky through the dusk, which can take many minutes. It decides, with a little hysteresis, whether it is day or night, and fades between the two in a fraction of a second. `light` is called every frame. ----
  let target = 0, theme = -1, lastAt = performance.now();
  const light = (dark) => { // `dark` is how much of the lighting up is on, from 0 to 1, the same level that turns on the lamps and the windows
    const now = performance.now(), dt = Math.min(1, (now - lastAt) / 1000); lastAt = now; // real time, so a slow screen takes the same 0.3 s to change as a fast one and does not sit half way between day and night
    target = dark > (target ? 0.46 : 0.5) ? 1 : 0;
    const next = theme < 0 ? target : theme + (target - theme) * (1 - Math.exp(-dt / 0.1));
    if (Math.abs(next - theme) < 0.002) return;
    theme = Math.abs(next - target) < 0.004 ? target : next;
    root.dataset.night = theme > 0.5 ? '1' : '0';
    for (const key of Object.keys(DAY)) root.style.setProperty(`--${key}`, rgb(blend(DAY[key], NIGHT[key], theme)));
  };
  light(0);

  return {
    light,
    // x and y in pixels, or null to hide the marker; size in pixels; the marker of the camera being viewed is marked
    placeMarker(index, spot, size = 28) {
      const m = markers[index]; if (!m) return;
      if (!spot) { m.style.display = 'none'; return; }
      m.style.display = ''; m.style.transform = `translate(${Math.round(spot.x)}px, ${Math.round(spot.y)}px) translate(-50%, -100%)`; m.style.width = m.style.height = `${size}px`;
      m.classList.toggle('active', current === 'cameras' && camerasPanel.index === index);
    },
    // the box of the open panel, or null, so the scene can keep its tags clear of it
    get panelRect() { return isOpen(panel) ? panel.getBoundingClientRect() : null; },
    // the box of the status card at the top left, so that the scene keeps its tags from going under it
    get statusRect() { return status.node.getBoundingClientRect(); },
    // One entry for each tag to show: { x, y } in pixels, the text, and how it stands: `away` (the vehicle is off the screen, so the tag is on the edge with an arrow turned `angle` radians, 0 being to the right)
    // and `hidden` (a building is in the way of the vehicle). Tags past the end of the list are hidden.
    placeAlerts(items) {
      items.forEach((item, i) => {
        const tag = alertTag(i);
        if (tag.node.hidden) tag.node.hidden = false;
        if (tag.label.textContent !== item.text) tag.label.textContent = item.text;
        tag.node.classList.toggle('away', Boolean(item.away)); tag.node.classList.toggle('occluded', Boolean(item.hidden));
        tag.arrow.style.transform = item.away ? `rotate(${(item.angle + Math.PI / 2).toFixed(3)}rad)` : '';
        tag.node.style.transform = `translate(${Math.round(item.x)}px, ${Math.round(item.y)}px) translate(-50%, ${item.away ? '-50%' : '-140%'})`;
      });
      for (let i = items.length; i < alertTags.length; i += 1) if (!alertTags[i].node.hidden) alertTags[i].node.hidden = true;
    },
    // the camera view, for the scene to draw into
    cameraView: camerasPanel ? {
      get active() { return current === 'cameras' && isOpen(panel); },
      get rect() { return panel.getBoundingClientRect(); },
      prepare: camerasPanel.view.prepare, canvas: camerasPanel.view.canvas, ctx: camerasPanel.view.ctx, draw: camerasPanel.view.draw,
    } : null,
    openCamera: (index) => { if (current !== 'cameras') open('cameras'); camerasPanel.select(index); },
    setAway: (away) => { homeButton.hidden = !away; },
    syncTop: (top) => controls.showTop(top),
    open, close,
    update({ clockText, dayText, night = 0, snap = null, summary = null, counts = null, ahead = null }) {
      if (snap && summary) status.update({ clockText, dayText, snap, summary, ahead });
      if (current === 'cameras' && isOpen(panel)) camerasPanel.update({ counts, snap });
      light(night);
    },
  };
}
