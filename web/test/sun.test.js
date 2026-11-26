// The sun against the scene's compass: east is +x (bearing 0), south is +z (pi/2), west is pi, north is -pi/2. See src/scene/sun.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sunAt, sideOf, lerpAngle } from '../src/scene/sun.js';

const PI = Math.PI;
// solar time at the place: longitude 0 and a clock on Greenwich time, so the clock hour is the solar hour (give or take the equation of time)
const at = (hour, day, lat) => sunAt(hour, day, lat, 0, 0);
function rise(day, lat) { for (let h = 0; h < 24; h += 0.005) if (at(h, day, lat).el < 0 && at(h + 0.005, day, lat).el >= 0) return at(h + 0.0025, day, lat); return null; }
function set(day, lat) { for (let h = 0; h < 24; h += 0.005) if (at(h, day, lat).el >= 0 && at(h + 0.005, day, lat).el < 0) return at(h + 0.0025, day, lat); return null; }
const MARCH = 80, JUNE = 172, DECEMBER = 355;

test('at the equinox the sun rises in the east and sets in the west', () => {
  for (const lat of [35, 51.5, -34, 7.9]) {
    assert.ok(Math.abs(rise(MARCH, lat).az) < 0.1, `rise at ${lat}: ${rise(MARCH, lat).az}`);
    assert.ok(Math.abs(set(MARCH, lat).az - PI) < 0.1, `set at ${lat}: ${set(MARCH, lat).az}`);
  }
});

test('in the northern summer the sun rises north of east and sets north of west, and in the winter south of both', () => {
  const [r, s, rw, sw] = [rise(JUNE, 40), set(JUNE, 40), rise(DECEMBER, 40), set(DECEMBER, 40)];
  assert.ok(r.az < -0.3 && r.az > -PI / 2, `June rise ${r.az}`);          // between east (0) and north (-pi/2)
  assert.ok(s.az > PI + 0.3 && s.az < 1.5 * PI, `June set ${s.az}`);       // between west (pi) and north (1.5 pi)
  assert.ok(rw.az > 0.3 && rw.az < PI / 2, `December rise ${rw.az}`);      // between east and south
  assert.ok(sw.az > PI / 2 && sw.az < PI - 0.3, `December set ${sw.az}`);  // between south and west
});

test('at noon the sun is south of overhead in the north and north of it in the south', () => {
  const north = at(12, MARCH, 35), south = at(12, MARCH, -33.9);
  assert.ok(Math.abs(north.az - PI / 2) < 0.15, `Northern noon ${north.az}`);  // south is +z, pi/2
  assert.ok(Math.abs(south.az + PI / 2) < 0.15, `Southern noon ${south.az}`);  // north is -z, -pi/2
  assert.ok(north.el > 0.9 && south.el > 0.9);
});

test('the sun is on the east side before noon and on the west side after it, and turns the right way for the hemisphere', () => {
  for (const lat of [35, -34, 20]) {
    const morning = at(8, MARCH, lat), evening = at(16, MARCH, lat);
    assert.ok(Math.cos(morning.az) > 0.3, `morning ${lat}: ${morning.az}`);   // +x is east
    assert.ok(Math.cos(evening.az) < -0.3, `evening ${lat}: ${evening.az}`);  // -x is west
    let last = at(6, MARCH, lat).az;
    for (let h = 6.5; h <= 18; h += 0.5) { const a = at(h, MARCH, lat).az; let d = a - last; if (d < -PI) d += 2 * PI; if (d > PI) d -= 2 * PI; assert.ok((lat < 0 ? -d : d) > 0, `the sun turned back at ${h} at ${lat}`); last = a; } // east, south, west in the north (the bearing grows); east, north, west in the south (it falls)
  }
});

test('the side of the sky the held lights use, and the short way round a bearing', () => {
  assert.equal(sideOf(35), 1); assert.equal(sideOf(-33.9), -1); assert.equal(sideOf(0), 1);
  assert.ok(Math.abs(lerpAngle(3, -3, 0.5) - (3 + (2 * PI - 6) / 2)) < 1e-9);     // 3 to -3 goes through pi, not through 0
  assert.equal(lerpAngle(1, 2, 0.5), 1.5);
});
