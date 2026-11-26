"""All tunable numbers in one place, validated once."""

from __future__ import annotations

from dataclasses import dataclass

from .bus_lane import Window, check_window


def check_int(name: str, value: object, minimum: int) -> int:
    """Return value if it is a real int (not a bool) of at least minimum."""
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{name} must be an int, got {value!r}")
    if value < minimum:
        raise ValueError(f"{name} must be at least {minimum}, got {value}")
    return value


def crossing_times(width_cm: int, speed_cm_s: int, yellow: int) -> tuple[int, int]:
    """Pedestrian clearance for one crossing, in whole seconds: (total, clearance 1).

    Total is the crossing width over the walking speed, rounded up. Clearance 2
    is the vehicle yellow, so clearance 1, the flashing that runs in green, is
    what is left. Integer arithmetic only, so a JavaScript port cannot differ.
    """
    total = -(-width_cm // speed_cm_s)
    return total, max(0, total - yellow)


@dataclass(frozen=True)
class Config:
    """Timing rules. All times are whole seconds. One controller tick is one second.

    Defaults suit a 60 km/h arterial. Where each value comes from, and what was
    and was not verified, is in docs/timing-sources.md.
    """

    default_green: int = 10
    yellow: int = 4
    all_red: int = 2
    min_green: int = 5
    max_green: int = 60
    # General lanes per approach that share the green time.
    lanes_per_approach: int = 2
    # Seconds one vehicle needs to clear the intersection.
    bike_time: int = 2
    bus_time: int = 6
    car_time: int = 4
    truck_time: int = 6
    # Pedestrians. Widths are kerb to kerb through the centre of each crossing, in
    # centimetres, for legs 1 to 4. Speed is in centimetres per second.
    walk_min: int = 6
    walking_speed_cm_s: int = 120
    crossing_widths_cm: tuple[int, int, int, int] = (1280, 1280, 1280, 1280)
    # A right-turn arrow never runs longer than this, whatever the queue.
    max_arrow_green: int = 15
    # Counts are smoothed with the median of the latest few reports per approach.
    smoothing_frames: int = 3
    # An emergency request that never gets a resume is dropped after this long, and
    # the vehicle may not ask again for the same time.
    emergency_timeout: int = 60
    # Upper bound on simultaneous emergency requests.
    max_emergencies: int = 16
    # The bus lane is active inside these windows (see bus_lane.py): Monday to Friday,
    # 07:00 to 09:00 and 16:00 to 18:00. An empty tuple means it is never active.
    bus_lane_windows: tuple[Window, ...] = ((0, 4, 420, 540), (0, 4, 960, 1080))
    # While active, a green with a bus still waiting at its end may run this much longer, once
    # per period and never past max_green. Zero turns extension off.
    bus_extension: int = 5
    # While active, the running green may end early when the next phase has a bus waiting.
    bus_early_green: bool = True
    # After power on or a fault the signals flash red this long, then stay all red, then the
    # cycle starts at its first phase.
    startup_flash: int = 5
    # A phase found empty may be skipped, but never more than this many times in a row.
    max_skips: int = 2
    # Vehicle counts older than this are ignored, so a dead camera cannot steer the signals.
    count_ttl: int = 10
    # Left turners also go on a left arrow during the arrow phase of the other pair, which carries no
    # pedestrians, and a waiting left turner asks for that phase. Needs a count of left turners.
    left_arrow: bool = True
    # A phase that serves pedestrians keeps this many seconds of green after their flashing red man
    # ends, with the man solid red, for turning vehicles held up by the walkers. In the simulator,
    # 6 s cut peak delay by about a quarter and made pedestrians wait about 7 s longer. Off by default,
    # because the left arrow (below) gives left turners time without lengthening the cycle.
    turn_hold: int = 0
    # Seconds of arrow phase owed to left turners after a through phase that served pedestrians. No
    # left count is used. 0 is off.
    left_window: int = 0
    # In a green held for an emergency, the pedestrian walk and flashing run from the start of the green
    # and end in a solid red man, instead of following the frozen countdown.
    hold_walk_timed: bool = False
    # What a fault shows: "flash" (all-way stop) or "red" (every vehicle signal red, every pedestrian
    # signal solid red, after a yellow).
    fault_signal: str = "flash"
    # When left_follow is on it applies only inside these windows (same form as the bus lane). An empty
    # tuple means always.
    left_follow_windows: tuple[Window, ...] = ((0, 4, 420, 540), (0, 4, 960, 1080))
    # The pedestrian signal ends when the crossing time ends, not with the green, and the left arrow
    # then stays green until the next arrow phase ends.
    left_follow: bool = False

    def __post_init__(self) -> None:
        check_int("default_green", self.default_green, 1)
        check_int("yellow", self.yellow, 1)
        check_int("all_red", self.all_red, 0)
        check_int("min_green", self.min_green, 1)
        check_int("max_green", self.max_green, 1)
        check_int("lanes_per_approach", self.lanes_per_approach, 1)
        check_int("bike_time", self.bike_time, 1)
        check_int("bus_time", self.bus_time, 1)
        check_int("car_time", self.car_time, 1)
        check_int("truck_time", self.truck_time, 1)
        check_int("max_skips", self.max_skips, 0)
        check_int("count_ttl", self.count_ttl, 1)
        if not isinstance(self.bus_lane_windows, tuple):
            raise ValueError("bus_lane_windows must be a tuple of windows")
        for window in self.bus_lane_windows:
            check_window(window)
        check_int("bus_extension", self.bus_extension, 0)
        if not isinstance(self.bus_early_green, bool):
            raise ValueError("bus_early_green must be a bool")
        if not isinstance(self.left_arrow, bool):
            raise ValueError("left_arrow must be a bool")
        check_int("startup_flash", self.startup_flash, 0)
        check_int("emergency_timeout", self.emergency_timeout, 1)
        check_int("max_emergencies", self.max_emergencies, 1)
        check_int("max_arrow_green", self.max_arrow_green, 1)
        check_int("smoothing_frames", self.smoothing_frames, 1)
        check_int("walk_min", self.walk_min, 1)
        check_int("walking_speed_cm_s", self.walking_speed_cm_s, 1)
        check_int("turn_hold", self.turn_hold, 0)
        check_int("left_window", self.left_window, 0)
        if not isinstance(self.hold_walk_timed, bool):
            raise ValueError("hold_walk_timed must be a bool")
        if self.fault_signal not in ("flash", "red"):
            raise ValueError("fault_signal must be 'flash' or 'red'")
        if not isinstance(self.left_follow_windows, tuple):
            raise ValueError("left_follow_windows must be a tuple of windows")
        for window in self.left_follow_windows:
            check_window(window)
        if not isinstance(self.left_follow, bool):
            raise ValueError("left_follow must be a bool")
        if not isinstance(self.crossing_widths_cm, tuple) or len(self.crossing_widths_cm) != 4:
            raise ValueError("crossing_widths_cm must be a tuple of 4 widths")
        for width in self.crossing_widths_cm:
            check_int("crossing width", width, 1)
        if self.max_green < self.min_green:
            raise ValueError("max_green must be at least min_green")
        if self.max_arrow_green < self.min_green:
            raise ValueError("max_arrow_green must be at least min_green")
        if not self.min_green <= self.default_green <= self.max_green:
            raise ValueError("default_green must lie between min_green and max_green")
        for width in self.crossing_widths_cm:
            _, clearance_1 = crossing_times(width, self.walking_speed_cm_s, self.yellow)
            if self.walk_min + clearance_1 + self.turn_hold > self.max_green:
                raise ValueError("a crossing needs more green than max_green allows")
