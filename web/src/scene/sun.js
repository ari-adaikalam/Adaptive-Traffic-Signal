// Where the sun is in the sky, as a pure function of the clock, the day of the year and the place, so it can be tested without a browser or Three.js.
//
// The scene's compass (checked against the road names): east is +x, south is +z, so the road called north lies along -z. The bearing is returned the way the sky uses it: 0 at east, pi/2 at south, pi at
// west and -pi/2 at north, with `direction` in sky.js turning it into (cos az, sin el, sin az). The height is in radians above the horizon.
const RAD = Math.PI / 180, TAU = Math.PI * 2;

// The usual solar position formulas (NOAA). `hour` is the local clock hour, `lat` and `lon` are in degrees (east positive), `tzEast` is the hours the clock is east of Greenwich.
export function sunAt(hour, dayOfYear, lat, lon, tzEast) {
  const g = TAU / 365 * (dayOfYear - 1 + (hour - 12) / 24);
  const equation = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g)); // minutes
  const declination = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const solarMinutes = hour * 60 + equation + 4 * lon - 60 * tzEast, hourAngle = (solarMinutes / 4 - 180) * RAD, phi = lat * RAD; // the hour angle is 0 at solar noon and grows to the west
  const height = Math.asin(Math.sin(phi) * Math.sin(declination) + Math.cos(phi) * Math.cos(declination) * Math.cos(hourAngle));
  // the bearing from north, clockwise, the true one: the sun rises north of east in the summer and south of it in the winter, and at noon it is south of overhead in the north and north of it in the south
  const east = -Math.cos(declination) * Math.sin(hourAngle), north = Math.sin(declination) * Math.cos(phi) - Math.cos(declination) * Math.cos(hourAngle) * Math.sin(phi);
  const bearing = (Math.atan2(east, north) + TAU) % TAU;
  return { el: height, az: bearing - Math.PI / 2 };
}

// Which side of the zenith the sun crosses on, for a held light that has no clock: south (+1) in the northern hemisphere and north (-1) in the southern.
export const sideOf = (lat) => (lat < 0 ? -1 : 1);

// The way round the short way, for easing a bearing: 350 degrees to 10 degrees is 20, not -340.
export const lerpAngle = (a, b, t) => { const d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI; return a + d * t; };
