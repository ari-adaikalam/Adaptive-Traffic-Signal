// Which lane polygon contains a vehicle position. Port of traffic_controller/geofence.py.
// Coordinates are [longitude, latitude]. A point on a polygon edge counts as outside.

const EDGE_TOLERANCE = 1e-12;

function checkNumber(name, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} must be a finite number`);
  return value;
}

function checkPosition(lon, lat) {
  const x = checkNumber('longitude', lon);
  const y = checkNumber('latitude', lat);
  if (!(x >= -180 && x <= 180 && y >= -90 && y <= 90)) throw new Error('position out of range');
  return [x, y];
}

function cleanRing(ring) {
  const points = [];
  for (const pair of ring) {
    if (!Array.isArray(pair) || pair.length !== 2) throw new Error('each polygon point must be [lon, lat]');
    points.push(checkPosition(pair[0], pair[1]));
  }
  const last = points.length - 1;
  if (points.length > 1 && points[0][0] === points[last][0] && points[0][1] === points[last][1]) points.pop();
  if (new Set(points.map((p) => `${p[0]},${p[1]}`)).size < 3) throw new Error('a polygon needs at least 3 distinct points');
  return points;
}

function onSegment(px, py, x1, y1, x2, y2) {
  const cross = (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1);
  if (Math.abs(cross) > EDGE_TOLERANCE) return false;
  return Math.min(x1, x2) <= px && px <= Math.max(x1, x2) && Math.min(y1, y2) <= py && py <= Math.max(y1, y2);
}

// True when the point is strictly inside the ring (even-odd rule).
export function pointInPolygon(lon, lat, ring) {
  const [px, py] = checkPosition(lon, lat);
  const points = cleanRing(ring);
  let inside = false;
  const count = points.length;
  for (let i = 0; i < count; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % count];
    if (onSegment(px, py, x1, y1, x2, y2)) return false;
    if ((y1 > py) !== (y2 > py)) {
      const crossingX = x1 + ((py - y1) * (x2 - x1)) / (y2 - y1);
      if (px < crossingX) inside = !inside;
    }
  }
  return inside;
}

// Validate one intersection's {"1": ring, ..., "4": ring} object.
export function parseZones(raw) {
  const zones = {};
  for (const [key, ring] of Object.entries(raw)) {
    if (!['1', '2', '3', '4'].includes(key)) throw new Error(`lane key must be '1' to '4', got ${key}`);
    zones[Number(key)] = cleanRing(ring);
  }
  return zones;
}

// Lane whose polygon contains the point, or null. The lowest lane wins an overlap.
export function laneForPosition(lon, lat, zones) {
  for (const lane of Object.keys(zones).map(Number).sort((a, b) => a - b)) {
    if (pointInPolygon(lon, lat, zones[lane])) return lane;
  }
  return null;
}
