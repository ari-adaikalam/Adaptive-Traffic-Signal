"""Which lane polygon contains a vehicle position.

Coordinates are [longitude, latitude] pairs, as stored in the intersections table.
A point on a polygon edge counts as outside, matching shapely's contains().
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence

Ring = Sequence[Sequence[float]]
_EDGE_TOLERANCE = 1e-12


def _check_number(name: str, value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{name} must be a finite number, got {value!r}")
    return float(value)


def _check_position(lon: object, lat: object) -> tuple[float, float]:
    lon_f = _check_number("longitude", lon)
    lat_f = _check_number("latitude", lat)
    if not (-180 <= lon_f <= 180 and -90 <= lat_f <= 90):
        raise ValueError(f"position out of range: {lon_f}, {lat_f}")
    return lon_f, lat_f


def _clean_ring(ring: Ring) -> list[tuple[float, float]]:
    """Validate a ring and drop its closing point if it repeats the first."""
    points: list[tuple[float, float]] = []
    for pair in ring:
        if isinstance(pair, (str, bytes)) or len(pair) != 2:
            raise ValueError("each polygon point must be [lon, lat]")
        points.append(_check_position(pair[0], pair[1]))
    if len(points) > 1 and points[0] == points[-1]:
        points.pop()
    if len(set(points)) < 3:
        raise ValueError("a polygon needs at least 3 distinct points")
    return points


def _on_segment(px: float, py: float, x1: float, y1: float, x2: float, y2: float) -> bool:
    cross = (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)
    if abs(cross) > _EDGE_TOLERANCE:
        return False
    return min(x1, x2) <= px <= max(x1, x2) and min(y1, y2) <= py <= max(y1, y2)


def point_in_polygon(lon: float, lat: float, ring: Ring) -> bool:
    """True when the point is strictly inside the ring (even-odd rule)."""
    px, py = _check_position(lon, lat)
    points = _clean_ring(ring)
    inside = False
    count = len(points)
    for i in range(count):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % count]
        if _on_segment(px, py, x1, y1, x2, y2):
            return False
        if (y1 > py) != (y2 > py):
            crossing_x = x1 + (py - y1) * (x2 - x1) / (y2 - y1)
            if px < crossing_x:
                inside = not inside
    return inside


def parse_zones(raw: Mapping[str, Ring]) -> dict[int, list[tuple[float, float]]]:
    """Validate one intersection's {"1": ring, ..., "4": ring} object."""
    zones: dict[int, list[tuple[float, float]]] = {}
    for key, ring in raw.items():
        if key not in ("1", "2", "3", "4"):
            raise ValueError(f"lane key must be '1' to '4', got {key!r}")
        zones[int(key)] = _clean_ring(ring)
    return zones


def lane_for_position(lon: float, lat: float, zones: Mapping[int, Ring]) -> int | None:
    """Lane whose polygon contains the point, or None. Lowest lane wins an overlap."""
    for lane in sorted(zones):
        if point_in_polygon(lon, lat, zones[lane]):
            return lane
    return None
