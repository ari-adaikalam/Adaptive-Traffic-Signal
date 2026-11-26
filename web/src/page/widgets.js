// The few controls the page is made of: a segmented choice, a button, a group with a heading and tabs.
import { el } from './dom.js';

// One of several choices, side by side. `pick` runs with the value of the one chosen. The group is a radio group, so a keyboard moves through it with the arrow keys.
export function segmented(label, items, pick, initial) {
  const group = el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label });
  const buttons = items.map(([text, value]) => {
    const b = el('button', { type: 'button', role: 'radio', text, 'aria-checked': String(value === initial), tabIndex: value === initial ? 0 : -1 });
    b.onclick = () => choose(b, value);
    return b;
  });
  function choose(chosen, value) {
    pick(value);
    buttons.forEach((b) => { const on = b === chosen; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
  }
  group.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]; if (!step) return;
    const at = buttons.findIndex((b) => b.getAttribute('aria-checked') === 'true'), next = (at + step + buttons.length) % buttons.length;
    e.preventDefault(); choose(buttons[next], items[next][1]); buttons[next].focus();
  });
  group.append(...buttons);
  // lets the page set the choice from outside, without calling `pick`
  group.select = (value) => { const i = items.findIndex(([, v]) => v === value); if (i >= 0) buttons.forEach((b, j) => { b.setAttribute('aria-checked', String(i === j)); b.tabIndex = i === j ? 0 : -1; }); };
  return group;
}

// `inline` puts a short choice beside its name, so several of them fit in little height
export const field = (label, control, inline = false) => el('div', { class: inline ? 'field inline' : 'field' }, el('span', { class: 'field-label', text: label }), control);
export const section = (title, ...content) => el('section', { class: 'block' }, title ? el('h3', { text: title }) : null, ...content);
export const button = (text, attrs = {}) => el('button', { type: 'button', text, ...attrs });

// Pages in one panel, one showing at a time, so that a panel never has to scroll. Every page must fit the panel on its own.
export function tabs(label, pages) {
  const list = el('div', { class: 'tabs', role: 'tablist', 'aria-label': label });
  const views = pages.map(([, node]) => el('div', { class: 'page', role: 'tabpanel' }, node));
  const buttons = pages.map(([text], i) => { const b = el('button', { type: 'button', role: 'tab', text }); b.onclick = () => show(i); return b; });
  function show(at) { buttons.forEach((b, i) => { b.setAttribute('aria-selected', String(i === at)); b.tabIndex = i === at ? 0 : -1; views[i].hidden = i !== at; }); }
  list.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (!step) return;
    const next = (buttons.findIndex((b) => b.tabIndex === 0) + step + buttons.length) % buttons.length;
    e.preventDefault(); show(next); buttons[next].focus();
  });
  list.append(...buttons); show(0);
  return el('div', { class: 'tabbed' }, list, ...views);
}
