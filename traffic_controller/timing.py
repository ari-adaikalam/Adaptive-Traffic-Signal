"""Green time from vehicle counts. One authoritative implementation."""

from __future__ import annotations

import operator
from collections.abc import Iterable
from dataclasses import dataclass

from .config import Config, check_int

# A frame cannot hold this many vehicles of one class. Larger numbers mean bad input.
MAX_COUNT_PER_CLASS = 1000

# Class ids of the trained model, in the order of its CLASS_MAP.
CLASS_BIKE, CLASS_BUS, CLASS_CAR, CLASS_TRUCK = 0, 1, 2, 3


@dataclass(frozen=True)
class VehicleCounts:
    bikes: int = 0
    buses: int = 0
    cars: int = 0
    trucks: int = 0

    def __post_init__(self) -> None:
        for name in ("bikes", "buses", "cars", "trucks"):
            value = check_int(name, getattr(self, name), 0)
            if value > MAX_COUNT_PER_CLASS:
                raise ValueError(f"{name} must be at most {MAX_COUNT_PER_CLASS}, got {value}")


def counts_from_class_ids(class_ids: Iterable[int]) -> VehicleCounts:
    """Count detections by class. Ids outside 0 to 3 are ignored, as on the hardware."""
    tally = [0, 0, 0, 0]
    for raw in class_ids:
        if isinstance(raw, bool):
            raise ValueError("class id must be an int, not a bool")
        try:
            class_id = operator.index(raw)  # accepts numpy ints, rejects floats and strings
        except TypeError as exc:
            raise ValueError(f"class id must be an int, got {raw!r}") from exc
        if 0 <= class_id <= 3:
            tally[class_id] += 1
    return VehicleCounts(bikes=tally[CLASS_BIKE], buses=tally[CLASS_BUS],
                         cars=tally[CLASS_CAR], trucks=tally[CLASS_TRUCK])


def _clearance_seconds(counts: VehicleCounts, config: Config) -> int:
    return (counts.cars * config.car_time + counts.buses * config.bus_time
            + counts.trucks * config.truck_time + counts.bikes * config.bike_time)


def green_time(counts: VehicleCounts, config: Config, lanes: int | None = None) -> int:
    """Seconds of green for the through and left lanes: ceil(clearance time / lanes), clamped.

    lanes defaults to lanes_per_approach. It is one fewer while the bus lane is active.
    Integer arithmetic only, so the result is exact and a JavaScript port
    cannot differ through floating point rounding.
    """
    divisor = config.lanes_per_approach if lanes is None else lanes
    if isinstance(divisor, bool) or not isinstance(divisor, int) or divisor < 1:
        raise ValueError("lanes must be an int of at least 1")
    seconds = -(-_clearance_seconds(counts, config) // divisor)  # ceiling division
    return max(config.min_green, min(config.max_green, seconds))


def bus_lane_green_time(counts: VehicleCounts, config: Config) -> int:
    """Seconds of green the bus lane needs: its whole clearance time, since it is one lane."""
    return max(config.min_green, min(config.max_green, _clearance_seconds(counts, config)))


def arrow_green_time(counts: VehicleCounts, config: Config) -> int:
    """Seconds of right-turn arrow: the whole clearance time of one lane, clamped.

    The right-turn lane is a single lane, so nothing is divided.
    """
    return max(config.min_green, min(config.max_arrow_green, _clearance_seconds(counts, config)))


def median_counts(reports: list[VehicleCounts]) -> VehicleCounts:
    """Per-class median of a few reports, taking the upper middle when the number is even.

    The upper middle errs towards assuming demand, which is the safe direction: it
    keeps a phase from being skipped on thin evidence.
    """
    if not reports:
        raise ValueError("need at least one report")
    def middle(values: list[int]) -> int:
        return sorted(values)[len(values) // 2]
    return VehicleCounts(bikes=middle([r.bikes for r in reports]), buses=middle([r.buses for r in reports]),
                         cars=middle([r.cars for r in reports]), trucks=middle([r.trucks for r in reports]))
