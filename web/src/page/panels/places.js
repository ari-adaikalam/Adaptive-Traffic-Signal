// The Go to panel: a button for each place, and the viewpoint glides there. The panel closes at once, because it stands over the middle of the scene where the viewpoint ends up.
import { el } from '../dom.js';
import { button } from '../widgets.js';

export const PLACES = [
  ['junction', 'Junction'], ['path', 'Park path'],
  ['north', 'North road'], ['east', 'East road'],
  ['south', 'South road'], ['west', 'West road'],
  ['crossing', 'Waiting to cross'], ['signal', 'Signal head'],
  ['bus', 'Bus lane'], ['kiosk', 'Kiosk'],
  ['fountain', 'Fountain'], ['pond', 'Pond'],
  ['playground', 'Playground'], ['court', 'Court'],
  ['courtyard', 'Courtyard'], ['hire', 'Bike hire'],
  ['restaurant', 'Restaurant'], ['office', 'Office'],
];
export function buildPlaces({ hooks }) {
  const node = el('div', { class: 'places' }, ...PLACES.map(([id, label]) => {
    const b = button(label, { class: 'place' });
    b.onclick = () => hooks.goTo(id);
    return b;
  }));
  return { node };
}
