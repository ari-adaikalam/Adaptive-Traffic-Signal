// Every button in the Go to panel must have a view in the scene, or the button does nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PLACES } from '../src/page/panels/places.js';

const scene = readFileSync(new URL('../src/scene/main.js', import.meta.url), 'utf8');
const block = scene.slice(scene.indexOf('const PLACE_VIEWS = (() => {'), scene.indexOf('})();', scene.indexOf('const PLACE_VIEWS = (() => {')));

test('the places have unique ids and labels', () => {
  assert.equal(new Set(PLACES.map(([id]) => id)).size, PLACES.length);
  assert.equal(new Set(PLACES.map(([, label]) => label)).size, PLACES.length);
});

test('every button has a view in the scene', () => {
  assert.ok(block.length > 100, 'the views were not found');
  const returned = block.slice(block.indexOf('return {'));
  for (const [id] of PLACES) assert.match(returned, new RegExp(`(^|[\\s,{])${id}:\\s`), `no view for ${id}`);
});
