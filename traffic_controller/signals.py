"""The signal state machine.

One tick() is one second, so every run is deterministic and testable.

Guarantees, checked by the tests on every tick:
  * Only movements that are compatible (see phases.py) are ever lit together.
  * Every green ends in a full yellow, then a full all-red clearance. Neither
    is ever shortened.
  * A green lasts between min_green and max_green seconds.
  * A phase found empty is skipped at most max_skips times in a row, so a
    missed detection cannot shut a road.
  * Missing, stale or failed detection never skips a phase and never shortens
    a green. It falls back to default timing.
  * A right-turn arrow phase runs only when a right turn is waiting, or when its
    skip limit forces it, and it never rests: it always hands over to a through phase.
  * An emergency request is served by the through phase that holds its approach.
    The running phase gets at least min_green, its pedestrian flashing clearance
    still completes (a walk may be cut short), and it ends through a full yellow
    and all-red. The emergency green is held until the request is resumed or
    times out, then released. No walk starts while an emergency is active.
  * Bus priority works only while the bus lane is active. Early green ends the
    running green once its minimum, and any walk minimum, has passed, when the next
    phase to open has a bus waiting. It never reorders the cycle, and a phase that
    was cut early is not cut again until it has had a period that was not. A green
    with a bus still waiting at its end is extended once per period, never past
    max_green and never while a crossing is being served.
  * Faults and startup. After power on (power_on=True) or a cleared fault the vehicle
    signals flash red for startup_flash seconds, stay all red for all_red seconds, and
    the cycle then starts at its first phase. In a fault they flash red until the fault
    is cleared. Nothing is served during either. Emergency requests and button presses
    are kept and served once the cycle runs.
  * A pedestrian walk starts only when a compatible green opens, lasts at least
    walk_min seconds, and its flashing clearance is never cut short: it runs to
    the end of the yellow, then a solid red man shows during the all-red. A phase
    that served pedestrians always hands over, it never rests.

Detection is pushed in per approach with report_counts() for the through and
left lanes and report_right_counts() for the right-turn lane, whenever the
caller has a count. Counts are smoothed with the median of the latest few
reports, and a count older than count_ttl seconds is ignored.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field

from .bus_lane import WEEK_SECONDS, is_active
from .config import Config, crossing_times
from .phases import ALL_MOVEMENTS, NUM_APPROACHES, Phase, build_plan, compatible, opposite, shift
from .timing import VehicleCounts, arrow_green_time, bus_lane_green_time, green_time, median_counts

GREEN = "green"
YELLOW = "yellow"
ALL_RED = "all_red"
RED = "red"
MAX_VEHICLE_ID_LENGTH = 64
FLASH = "flash"  # a stage, and the state of a vehicle or arrow signal flashing red
FAULT = "fault"
FAULT_REASONS = ("manual", "link", "conflict")
EMERGENCY_MOVEMENTS = ("through", "left", "right")
MODES = ("adaptive", "fixed")
STOP = "stop"  # pedestrian signals: solid red man, walk, flashing red man
WALK = "walk"
CLEAR = "clear"


@dataclass(frozen=True)
class Snapshot:
    time: int
    phase: str
    stage: str  # "green", "yellow", "all_red", "flash" (startup) or "fault"
    remaining: int  # seconds left in this stage, at least 1
    signals: dict[str, str] = field(default_factory=dict)
    heads: tuple[str, str, str, str] = (RED, RED, RED, RED)  # T1 to T4, for the serial line
    pedestrian_requests: tuple[int, ...] = ()  # crossings with a button press still waiting
    period: int = 0  # number of green periods opened so far, so a new period is visible
    emergency_approach: int | None = None  # approach of the oldest emergency request
    holding: bool = False  # the green is held open for that emergency
    bus_lane_active: bool = False  # the bus lane schedule is in a window
    bus_priority: bool = False  # this green period was cut early or extended for a bus
    mode: str = "adaptive"  # "adaptive", or "fixed" which ignores all counts
    fault: str | None = None  # why the signals are flashing in a fault, else None
    startups: int = 0  # startup sequences begun so far, so a restart is visible between two snapshots
    arrows: tuple[str, str, str, str] = (RED, RED, RED, RED)  # left arrows L1 to L4, which the serial line does not carry yet


def _approach_index(approach: object) -> int:
    if (isinstance(approach, bool) or not isinstance(approach, int)
            or not 1 <= approach <= NUM_APPROACHES):
        raise ValueError(f"approach must be an int from 1 to {NUM_APPROACHES}, got {approach!r}")
    return approach - 1


def _vehicle_key(vehicle_id: object) -> str:
    if isinstance(vehicle_id, bool) or not isinstance(vehicle_id, (int, str)):
        raise ValueError("vehicle id must be an int or a string")
    key = str(vehicle_id)
    if not key or len(key) > MAX_VEHICLE_ID_LENGTH:
        raise ValueError(f"vehicle id must be 1 to {MAX_VEHICLE_ID_LENGTH} characters")
    return key


class Controller:
    def __init__(self, config: Config | None = None, plan: Sequence[Phase] | None = None,
                 clock_start_s: int = 0, power_on: bool = False) -> None:
        """clock_start_s is the time of day at tick 0, in seconds from Monday 00:00.

        power_on starts with the startup sequence instead of straight into the first green.
        """
        if (isinstance(clock_start_s, bool) or not isinstance(clock_start_s, int)
                or not 0 <= clock_start_s < WEEK_SECONDS):
            raise ValueError("clock_start_s must be an int from 0 to 604799")
        self._clock_start = clock_start_s
        self._cfg = config or Config()
        self._plan = tuple(plan) if plan is not None else build_plan()
        if len(self._plan) < 2:
            raise ValueError("a plan needs at least two phases")
        if self._plan[0].kind != "T":
            raise ValueError("a plan starts with a through phase")
        if sum(phase.kind == "T" for phase in self._plan) < 2:
            raise ValueError("a plan needs at least two through phases")
        self._time = 0
        self._index = 0  # phase currently shown
        self._next = 0  # phase that opens after the current yellow and all-red
        self._stage = GREEN
        # Latest reports per approach as (counts, time), newest last, for each lane group.
        self._history: dict[str, list[list[tuple[VehicleCounts, int]]]] = {
            "T": [[] for _ in range(NUM_APPROACHES)], "R": [[] for _ in range(NUM_APPROACHES)],
            "B": [[] for _ in range(NUM_APPROACHES)], "L": [[] for _ in range(NUM_APPROACHES)]}
        self._skips = [0] * len(self._plan)
        self._latched = [False] * NUM_APPROACHES  # pedestrian requests waiting
        self._served: tuple[int, ...] = ()  # crossings served by the current green period
        self._elapsed = 0  # ticks spent in the current green period
        self._held = False  # the countdown is frozen for an emergency
        self._period = 0
        # vehicle key -> [approach index, age in ticks]; insertion order is arrival order
        self._emergencies: dict[str, list] = {}
        # vehicle key -> ticks since its request expired. A vehicle cannot re-request during
        # this cooldown, so a stuck client cannot hold a phase by resending.
        self._cooling: dict[str, int] = {}
        self._cut = [False] * len(self._plan)  # the phase's last period was cut early for a bus
        self._period_cut = False  # the running period was shortened for a bus
        self._period_emergency = False  # an emergency request was present during the running period
        self._period_bus = False  # the running period was cut early or extended for a bus
        self._extended = False  # the running period has had its one extension
        self._follow_time = 0  # seconds of this through green that the left arrow has been lit
        self._faulting = False  # a fault with fault_signal "red" is running down: yellow, then all-red
        self._ped_hold = [0] * NUM_APPROACHES  # seconds each pedestrian signal still flashes after such a fault
        self._following = False  # left_follow is on for this period, decided when it opens
        self._left_open = False
        self._held_period = False  # this green has been held for an emergency at some point
        self._timed_origin = 0  # where the timed pedestrian schedule of a held green counts from
        self._carries = False  # decided when the through yellow starts: the left arrow carries on
        self._owed = [False] * len(self._plan)  # an arrow phase is owed the left window
        self._mode = "adaptive"
        self._fault: str | None = None
        self._recover = False  # a fault was cleared and the startup sequence begins on the next tick
        self._startup = False  # in the startup flash or the all-red that follows it
        self._startups = 0
        self._remaining = self._planned_green(0)
        if power_on:
            self._begin_startup()

    # Public API

    @property
    def snapshot(self) -> Snapshot:
        return self._snapshot()

    def tick(self) -> Snapshot:
        """Advance one second and return the new state."""
        self._time += 1
        self._age_emergencies()
        self._ped_hold = [max(0, s - 1) for s in self._ped_hold]
        if self._faulting and self._stage == GREEN:
            self._begin_yellow(next_phase=None)
            return self._snapshot()
        if self._stage == FAULT:
            if self._recover:
                self._recover = False
                self._fault = None
                # after an all-red fault there is nothing to flash: go through the all-red and start
                self._begin_startup(flash=self._cfg.fault_signal != "red")
            return self._snapshot()
        if self._stage == GREEN:
            self._elapsed += 1
            self._tick_green()
            self._note_follow()
        else:
            self._remaining -= 1
            if self._remaining <= 0:
                if self._stage == FLASH:
                    self._end_flash()
                elif self._stage == YELLOW:
                    self._end_yellow()
                elif self._faulting:
                    self._enter_fault()
                else:
                    self._start_green(self._next)
        return self._snapshot()

    def fault(self, reason: str) -> bool:
        """Put every vehicle signal into flashing red, whatever was showing.

        reason is "manual", "link" (the host lost the signal controller) or "conflict" (a monitor
        saw conflicting signals). Returns False if a fault is already in effect.
        """
        if reason not in FAULT_REASONS:
            raise ValueError(f"reason must be one of {FAULT_REASONS}, got {reason!r}")
        if self._stage == FAULT or self._faulting:
            return False
        self._recover = False
        if self._cfg.fault_signal == "red" and self._stage != FLASH:
            # Yellow, then all-red. A vehicle with a green gets its normal yellow, and a pedestrian already
            # crossing keeps the flashing red man for as long as the rest of the crossing takes. Nobody new
            # is started. The yellow starts on the next tick, as at the end of any green.
            self._hold_pedestrians()
            self._fault = reason
            self._faulting = True
            self._held = False
            self._startup = False
            return True
        self._fault = reason
        self._enter_fault()
        return True

    def _hold_pedestrians(self) -> None:
        """How long each pedestrian signal on walk or flashing must keep flashing so people already on the road can finish."""
        for n in self._served:
            state = self._pedestrian_state(n)
            total, _ = self._crossing(n)
            need = 0
            if state == WALK:
                need = total
            elif state == CLEAR:
                if self._stage == GREEN:
                    need = min(total, self._remaining + self._cfg.yellow)
                elif self._stage == YELLOW:
                    need = self._remaining
            self._ped_hold[n - 1] = max(self._ped_hold[n - 1], need)

    def _enter_fault(self) -> None:
        self._faulting = False
        self._stage = FAULT
        self._remaining = 1
        self._startup = False
        self._held = False
        if self._cfg.fault_signal != "red":
            self._served = ()

    def clear_fault(self) -> bool:
        """End a fault. The startup sequence begins on the next tick. False if there is no fault."""
        if self._stage != FAULT or self._recover:
            return False
        self._recover = True
        return True

    def set_mode(self, mode: str) -> None:
        """"fixed" ignores every count and runs default timing, which is also what happens when
        detection fails. Pedestrians and emergencies are served in both modes."""
        if mode not in MODES:
            raise ValueError(f"mode must be one of {MODES}, got {mode!r}")
        self._mode = mode

    def report_counts(self, approach: int, counts: VehicleCounts | None) -> None:
        """Record the latest count for the through and left lanes of an approach.

        counts=None means detection failed. That erases the stored reports, so the
        approach is treated as unknown until new counts arrive.
        """
        self._record("T", approach, counts)

    def report_right_counts(self, approach: int, counts: VehicleCounts | None) -> None:
        """Record the latest count for the right-turn lane of an approach."""
        self._record("R", approach, counts)

    def report_left_counts(self, approach: int, counts: VehicleCounts | None) -> None:
        """Record the latest count of vehicles waiting to turn left from an approach.

        Needs a detector that can tell a left turner from a vehicle going straight on. With left_arrow on, an approach
        with no fresh left count is unknown, so its arrow phase is never skipped and gets the default green.
        """
        self._record("L", approach, counts)

    def report_bus_counts(self, approach: int, counts: VehicleCounts | None) -> None:
        """Record the latest count for the bus lane of an approach.

        Used only while the bus lane is active. Outside the windows the lane is an
        ordinary kerb lane and its vehicles are part of the through and left count.
        """
        self._record("B", approach, counts)

    def _record(self, group: str, approach: int, counts: VehicleCounts | None) -> None:
        index = _approach_index(approach)
        if counts is not None and not isinstance(counts, VehicleCounts):
            raise ValueError("counts must be a VehicleCounts or None")
        if counts is None:
            self._history[group][index] = []
            return
        reports = self._history[group][index]
        reports.append((counts, self._time))
        del reports[:-self._cfg.smoothing_frames]

    def request_crossing(self, crossing: int) -> bool:
        """A pedestrian pressed the button for a crossing (1 to 4).

        The request waits until a compatible green opens. Returns False if one is
        already waiting. Pressing again changes nothing.
        """
        index = _approach_index(crossing)
        if self._latched[index]:
            return False
        self._latched[index] = True
        return True

    def pause(self, vehicle_id: int | str, approach: int, movement: str = "through") -> bool:
        """Register an emergency vehicle approaching on an approach (1 to 4).

        movement is what the vehicle will do: "through" and "left" are served by the through phase of the
        approach, "right" by the right-turn arrow phase, because a right turn crosses the opposing through traffic.

        Returns True for a new request. A repeat for a known vehicle only updates
        its approach, keeping its place in the queue and its age, and returns False.
        A vehicle whose request just expired is ignored (False) until its cooldown
        of emergency_timeout seconds ends or it sends resume.
        """
        key = _vehicle_key(vehicle_id)
        index = _approach_index(approach)
        if movement not in EMERGENCY_MOVEMENTS:
            raise ValueError(f"movement must be one of {EMERGENCY_MOVEMENTS}, got {movement!r}")
        kind = "R" if movement == "right" else "T"
        if key in self._emergencies:
            self._emergencies[key][0] = index
            self._emergencies[key][2] = kind
            return False
        if key in self._cooling:
            return False
        if len(self._emergencies) >= self._cfg.max_emergencies:
            raise ValueError("too many active emergency requests")
        self._emergencies[key] = [index, 0, kind]
        return True

    def resume(self, vehicle_id: int | str) -> bool:
        """Clear a vehicle's request, whatever its place in the queue.

        Returns False when the vehicle is unknown (already cleared or expired).
        Resume also ends a cooldown, so a vehicle that signs off cleanly can ask again.
        """
        key = _vehicle_key(vehicle_id)
        self._cooling.pop(key, None)
        return self._emergencies.pop(key, None) is not None

    # Demand

    def _fresh(self, group: str, approach: int) -> VehicleCounts | None:
        """Smoothed count from the reports that are still fresh, or None if there are none."""
        if self._mode == "fixed":
            return None
        reports = [c for c, t in self._history[group][approach - 1] if self._time - t <= self._cfg.count_ttl]
        return median_counts(reports) if reports else None

    def _planned_green(self, index: int) -> int:
        """Green for a phase: the largest need among its approaches.

        An approach with no fresh count counts as the default, so missing data
        never shortens a green. An arrow's default is capped at max_arrow_green.
        """
        phase = self._plan[index]
        arrow = phase.kind == "R"
        default = min(self._cfg.default_green, self._cfg.max_arrow_green) if arrow else self._cfg.default_green
        active = not arrow and self._bus_active()
        # While the bus lane is active the general traffic has one lane fewer.
        lanes = max(1, self._cfg.lanes_per_approach - 1) if active else self._cfg.lanes_per_approach
        needs = []
        for approach in phase.approaches():
            counts = self._arrow_counts(approach) if arrow else self._fresh(phase.kind, approach)
            if counts is None:
                need = default
            else:
                need = arrow_green_time(counts, self._cfg) if arrow else green_time(counts, self._cfg, lanes)
            if active:
                bus = self._fresh("B", approach)
                need = max(need, default if bus is None else bus_lane_green_time(bus, self._cfg))
            needs.append(need)
        green = max(needs, default=default)
        return max(green, self._cfg.left_window) if arrow and self._owed[index] else green

    def _arrow_counts(self, approach: int) -> VehicleCounts | None:
        """What an arrow phase has to clear on one approach: its right turners and, with the left arrow, the left
        turners of the approach before it, who use this phase. None if either is unknown."""
        right = self._fresh("R", approach)
        if not self._cfg.left_arrow or self._cfg.left_window > 0 or right is None:
            return right
        left = self._fresh("L", shift(approach, -1))
        if left is None:
            return None
        return VehicleCounts(bikes=right.bikes + left.bikes, buses=right.buses + left.buses,
                             cars=right.cars + left.cars, trucks=right.trucks + left.trucks)

    def _bus_active(self) -> bool:
        return is_active(self._cfg.bus_lane_windows, self._clock_start + self._time)

    def _bus_waiting(self, index: int) -> bool:
        """A bus is known to wait in the bus lane of an approach this phase serves."""
        if not self._bus_active() or self._plan[index].kind != "T":
            return False
        return any((bus := self._fresh("B", a)) is not None and bus.buses > 0
                   for a in self._plan[index].approaches())

    def _crossings_for(self, index: int) -> tuple[int, ...]:
        """Crossings that may show walk during this phase, by the conflict whitelist."""
        movements = self._plan[index].movements
        return tuple(n for n in range(1, NUM_APPROACHES + 1)
                     if all(compatible(f"C{n}", m) for m in movements))

    def _demand(self, index: int) -> bool | None:
        """True if a pedestrian or any vehicle is known to wait, None if an approach is unknown, else False."""
        if any(self._latched[n - 1] for n in self._crossings_for(index)):
            return True
        if self._owed[index]:
            return True
        unknown = False
        phase = self._plan[index]
        groups = (phase.kind, "B") if phase.kind == "T" and self._bus_active() else (phase.kind,)
        for approach in phase.approaches():
            for group in groups:
                counts = self._arrow_counts(approach) if group == "R" else self._fresh(group, approach)
                if counts is None:
                    unknown = True
                elif counts.bikes + counts.buses + counts.cars + counts.trucks > 0:
                    return True
        return None if unknown else False

    # Emergencies

    def _target(self) -> int | None:
        """Approach index of the oldest emergency request."""
        for approach, _age, _kind in self._emergencies.values():
            return approach
        return None

    def _target_phase(self) -> int | None:
        """Index of the phase that serves the oldest request: the arrow phase for a right turn, else the through phase."""
        target = self._target()
        if target is None:
            return None
        kind = next(iter(self._emergencies.values()))[2]
        own = next((i for i, phase in enumerate(self._plan) if f"{kind}{target + 1}" in phase.movements), None)
        if own is not None:
            return own
        # a plan with no arrow phase serves a right turn in the through phase
        return next(i for i, phase in enumerate(self._plan) if f"T{target + 1}" in phase.movements)

    def _age_emergencies(self) -> None:
        for key in list(self._cooling):
            self._cooling[key] += 1
            if self._cooling[key] >= self._cfg.emergency_timeout:
                del self._cooling[key]
        for key in list(self._emergencies):
            self._emergencies[key][1] += 1
            if self._emergencies[key][1] >= self._cfg.emergency_timeout:
                del self._emergencies[key]
                self._cooling[key] = 0

    def _served_clearance_1_max(self) -> int:
        """Green seconds still needed so every served crossing shows its full flashing."""
        return max((self._crossing(n)[1] + self._cfg.turn_hold for n in self._served), default=0)

    def _tick_green(self) -> None:
        target = self._target_phase()
        if target is not None:
            self._period_emergency = True
        if target == self._index:
            self._held = True  # freeze the countdown while the vehicle is served
            # The timed schedule starts a walk time before now, so a man on walk when the hold begins goes to
            # flashing, never straight to solid red.
            if not self._held_period:
                self._timed_origin = max(0, self._elapsed - self._cfg.walk_min)
            self._held_period = True
            return
        if target is not None and self._elapsed >= self._cfg.min_green:
            # Preempt. Cap the green so it ends once every served crossing has had its
            # full flashing clearance. This may cut a walk short, never the flashing.
            self._remaining = min(self._remaining, self._served_clearance_1_max() + 1) - 1
            if self._remaining <= 0:
                self._begin_yellow(next_phase=None)
            return
        if self._held:
            # The hold ended. With no crossing in progress give traffic a short, fixed
            # green. With one in progress its schedule simply carries on.
            self._held = False
            if not self._served:
                self._remaining = min(self._remaining, self._cfg.min_green)
            return
        if self._early_green_due():
            # End the green early, once every served crossing has had its full flashing
            # clearance. The walk is never shorter than walk_min, see _early_green_due.
            natural = self._remaining - 1
            self._remaining = min(self._remaining, self._served_clearance_1_max() + 1) - 1
            if self._remaining < natural:
                self._period_cut = self._period_bus = True
        else:
            self._remaining -= 1
        if self._remaining <= 0:
            self._end_green()

    def _may_rest(self) -> bool:
        # Pedestrians that were served need their clearance to finish through a yellow,
        # and an arrow phase has nothing to rest for, so neither may rest.
        return not self._served and self._plan[self._index].kind == "T"

    def _mark_cut(self) -> None:
        """Record whether this period was cut early for a bus. A period not cut clears the mark.

        A period that had an emergency present says nothing about bus priority, so it leaves the mark alone.
        """
        if not self._period_emergency:
            self._cut[self._index] = self._period_cut

    def _early_green_due(self) -> bool:
        cfg = self._cfg
        if not (cfg.bus_early_green and self._bus_active() and not self._cut[self._index]):
            return False
        if self._elapsed < cfg.min_green or (self._served and self._elapsed < cfg.walk_min):
            return False
        if self._bus_waiting(self._index):
            return False  # the running phase has a bus of its own
        upcoming, _ = self._select_next(self._may_rest())
        return upcoming != self._index and self._bus_waiting(upcoming)

    def _extension_due(self) -> bool:
        cfg = self._cfg
        return (cfg.bus_extension > 0 and not self._extended and not self._served
                and cfg.max_green - self._elapsed >= 1 and self._bus_waiting(self._index))

    # Stage changes

    def _begin_startup(self, flash: bool = True) -> None:
        """Flash red, then all red, then the cycle starts at its first phase."""
        self._startups += 1
        self._served = ()
        self._held = False
        self._elapsed = 0
        self._period_cut = self._period_bus = self._extended = self._period_emergency = False
        self._skips = [0] * len(self._plan)
        self._cut = [False] * len(self._plan)
        self._owed = [False] * len(self._plan)
        self._left_open = self._carries = self._following = False
        self._follow_time = 0
        self._index = 0
        self._next = 0
        self._startup = True
        if flash and self._cfg.startup_flash > 0:
            self._stage = FLASH
            self._remaining = self._cfg.startup_flash
        else:
            self._end_flash()

    def _end_flash(self) -> None:
        if self._cfg.all_red > 0:
            self._stage = ALL_RED
            self._remaining = self._cfg.all_red
        else:
            self._start_green(0)

    def _end_green(self) -> None:
        if self._extension_due():
            # A bus is still waiting for this green: run it a little longer, once.
            self._remaining = min(self._cfg.bus_extension, self._cfg.max_green - self._elapsed)
            self._extended = self._period_bus = True
            return
        chosen = self._choose_next(self._may_rest())
        if chosen == self._index:
            # Nobody else is waiting, so rest in green with a fresh green period.
            self._mark_cut()
            self._open_period(self._index)
            return
        self._begin_yellow(next_phase=chosen)

    def _begin_yellow(self, next_phase: int | None) -> None:
        """next_phase None means an emergency cut the green, so the next phase is picked when it opens."""
        self._mark_cut()
        # The left arrow carries on into the arrow phase after this one, unless an emergency has to be served
        # first. An emergency is never made to wait for it.
        self._carries = (self._following and self._left_open and self._plan[self._index].kind == "T"
                         and next_phase is not None and self._plan[next_phase].kind == "R"
                         and self._target_phase() is None)
        self._next = next_phase
        self._stage = YELLOW
        self._remaining = self._cfg.yellow
        self._held = False

    def _select_next(self, may_rest: bool) -> tuple[int, list[int]]:
        """The next phase in cycle order that has demand, and the empty phases skipped to reach it.

        An empty phase is skipped within the limit. If every other phase is empty the
        current phase rests, when it may. When it may not, the next through phase opens
        instead. This changes nothing, so it can be used to look ahead.
        """
        count = len(self._plan)
        skipped = []
        for step in range(1, count):
            candidate = (self._index + step) % count
            if self._demand(candidate) is False and self._skips[candidate] < self._cfg.max_skips:
                skipped.append(candidate)
                continue
            return candidate, skipped
        if may_rest:
            return self._index, skipped
        # The constructor guarantees another through phase exists.
        return next(c for c in ((self._index + step) % count for step in range(1, count))
                    if self._plan[c].kind == "T"), skipped

    def _choose_next(self, may_rest: bool) -> int:
        chosen, skipped = self._select_next(may_rest)
        for candidate in skipped:
            self._skips[candidate] += 1
        if chosen != self._index:
            self._skips[chosen] = 0
        return chosen

    def _end_yellow(self) -> None:
        if self._faulting and self._cfg.all_red <= 0:
            self._enter_fault()
            return
        if self._cfg.all_red > 0:
            self._stage = ALL_RED
            self._remaining = self._cfg.all_red
        else:
            self._start_green(self._next)

    def _start_green(self, index: int | None) -> None:
        target = self._target_phase()
        if target is not None:
            index = target  # an emergency overrides the planned order
        elif index is None:
            index = self._choose_next(may_rest=False)  # the emergency ended during the yellow
        self._index = index
        self._stage = GREEN
        self._startup = False
        self._open_period(index, emergency=target is not None)

    def _open_period(self, index: int, emergency: bool = False) -> None:
        """Begin a green period: serve waiting pedestrians and plan its length.

        The green is the larger of what the vehicles need and what the served
        crossings need (walk, then clearance 1). The config guarantees that fits max_green.
        No walk starts for an emergency green.
        """
        self._period += 1
        self._elapsed = 0
        self._held = False
        self._period_cut = self._period_bus = self._extended = False
        self._period_emergency = emergency
        served = () if emergency else tuple(n for n in self._crossings_for(index) if self._latched[n - 1])
        for n in served:
            self._latched[n - 1] = False
        self._served = served
        need = 0
        for n in served:
            _, clearance_1 = self._crossing(n)
            need = max(need, self._cfg.walk_min + clearance_1 + self._cfg.turn_hold)
        self._remaining = max(self._planned_green(index), need)
        self._owed[index] = False
        self._left_open = False
        self._held_period = False
        self._timed_origin = 0
        self._carries = False
        self._follow_time = 0
        self._following = self._follow_scheduled()
        self._update_owed(index)

    def _update_owed(self, index: int) -> None:
        """The arrow phase after a through phase is owed the left window when that through phase served pedestrians,
        unless the left arrow already ran that long inside the through green."""
        after = (index + 1) % len(self._plan)
        if self._cfg.left_window > 0 and self._plan[index].kind == "T" and self._plan[after].kind == "R":
            self._owed[after] = bool(self._served) and not (self._following and self._follow_time >= self._cfg.left_window)

    def _follow_scheduled(self) -> bool:
        """With left_follow, the left arrow of a through phase is lit once every crossing it served has its man solid red."""
        cfg = self._cfg
        if not (cfg.left_follow and cfg.left_arrow):
            return False
        return not cfg.left_follow_windows or is_active(cfg.left_follow_windows, self._clock_start + self._time)

    def _follow_lit(self) -> bool:
        return (self._following and self._stage == GREEN and self._plan[self._index].kind == "T"
                and bool(self._served) and all(self._pedestrian_state(n) == STOP for n in self._served))

    def _note_follow(self) -> None:
        if self._stage != GREEN or not self._follow_lit():
            return
        self._left_open = True
        self._follow_time += 1
        self._update_owed(self._index)

    def _crossing(self, n: int) -> tuple[int, int]:
        return crossing_times(self._cfg.crossing_widths_cm[n - 1], self._cfg.walking_speed_cm_s,
                              self._cfg.yellow)

    def _pedestrian_state(self, n: int) -> str:
        if self._fault is not None and self._cfg.fault_signal == "red":
            return CLEAR if self._ped_hold[n - 1] > 0 else STOP
        if n not in self._served:
            return STOP
        hold = self._cfg.turn_hold
        total, clearance_1 = self._crossing(n)
        # With left_follow, and in a green that is held for an emergency, the pedestrian time runs from the start
        # of the green and ends with the crossing time. A held green has no countdown to go by.
        timed = self._following or (self._held_period and self._cfg.hold_walk_timed)
        age = self._elapsed if self._following else self._elapsed - self._timed_origin
        done = timed and age >= self._cfg.walk_min + total  # the last starter has crossed
        if self._stage == YELLOW:
            return STOP if hold > 0 or done else CLEAR  # with a hold, clearance 2 has already run
        if self._stage == ALL_RED:
            return STOP
        if self._remaining <= hold or done:
            return STOP  # the last seconds of green are for turning vehicles, with the man solid red
        walking = self._remaining - hold > clearance_1 and not (timed and age >= self._cfg.walk_min)
        return WALK if walking else CLEAR

    def _arrows(self) -> tuple[str, str, str, str]:
        """The left arrows. Each is lit with an arrow phase of the other pair of approaches, when the crossings are all red."""
        if self._stage == FLASH or (self._stage == FAULT and self._cfg.fault_signal == "flash"):
            return (FLASH,) * NUM_APPROACHES  # type: ignore[return-value]
        if self._stage == FAULT:
            return (RED,) * NUM_APPROACHES  # type: ignore[return-value]
        phase = self._plan[self._index]
        if self._following and phase.kind == "T" and self._left_open:
            # The arrow carries on into the arrow phase after this one. Otherwise it ends the way every green
            # ends, with a yellow, so a left turner that cannot stop before the line is warned.
            state = RED
            if self._stage == GREEN:
                state = GREEN if self._follow_lit() else RED
            elif self._stage == YELLOW:
                state = GREEN if self._carries and self._target_phase() is None else YELLOW
            elif self._stage == ALL_RED:
                state = (GREEN if self._target_phase() is None else YELLOW) if self._carries else RED
            ours = phase.approaches()
            if state != RED:
                return tuple(state if n in ours else RED  # type: ignore[return-value]
                             for n in range(1, NUM_APPROACHES + 1))
        if not self._cfg.left_arrow or phase.kind != "R" or self._stage not in (GREEN, YELLOW):
            return (RED,) * NUM_APPROACHES  # type: ignore[return-value]
        served = {int(m[1]) for m in phase.movements}
        return tuple(self._stage if opposite(n) not in served else RED  # type: ignore[return-value]
                     for n in range(1, NUM_APPROACHES + 1))

    def _snapshot(self) -> Snapshot:
        phase = self._plan[self._index]
        target = self._target()
        lit = self._stage if self._stage in (GREEN, YELLOW) else RED
        flashing = self._stage == FLASH or (self._stage == FAULT and self._cfg.fault_signal == "flash")
        signals = {m: (FLASH if flashing else lit if m in phase.movements else RED)
                   for m in ALL_MOVEMENTS if m[0] != "C"}
        for n in range(1, NUM_APPROACHES + 1):
            signals[f"C{n}"] = self._pedestrian_state(n)
        signals = {m: signals[m] for m in ALL_MOVEMENTS}
        heads = tuple(signals[f"T{n}"] for n in range(1, NUM_APPROACHES + 1))
        return Snapshot(time=self._time, phase="" if self._startup or self._stage == FAULT else phase.name,
                        stage=self._stage,
                        remaining=self._remaining, signals=signals, heads=heads,  # type: ignore[arg-type]
                        pedestrian_requests=tuple(n for n in range(1, NUM_APPROACHES + 1)
                                                  if self._latched[n - 1]),
                        period=self._period,
                        emergency_approach=None if target is None else target + 1,
                        holding=self._stage == GREEN and self._target_phase() == self._index,
                        bus_lane_active=self._bus_active(), bus_priority=self._period_bus,
                        mode=self._mode, fault=self._fault, startups=self._startups, arrows=self._arrows())
