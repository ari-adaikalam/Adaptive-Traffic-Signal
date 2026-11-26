"""Random detection, right-turn, bus lane, pedestrian, emergency, fault and mode streams, checked
against the safety rules on every tick.

Seeds are fixed, so a failure reproduces exactly. Assertion messages name the seed.
"""

import dataclasses
import random

import pytest

from traffic_controller import Config, Controller, VehicleCounts, build_plan, conflict_free, encode
from traffic_controller.bus_lane import is_active
from traffic_controller.protocol import with_arrows
from traffic_controller.config import crossing_times

SEEDS = range(300)
TICKS = 700


def random_config(rng: random.Random, extended: bool = False) -> Config:
    min_green = rng.randint(1, 5)
    max_green = rng.randint(min_green, 40)
    yellow = rng.randint(1, 6)
    speed = rng.choice([100, 120, 150])
    walk_min = rng.randint(1, 8)
    widths = tuple(rng.randint(200, 2200) for _ in range(4))
    # The config refuses a crossing that cannot fit in max_green, so make room for it.
    turn_hold = rng.choice([0, 0, 2, 6])
    need = walk_min + max(crossing_times(w, speed, yellow)[1] for w in widths) + turn_hold
    max_green = max(max_green, need)
    return Config(
        max_arrow_green=rng.randint(min_green, 30),
        smoothing_frames=rng.randint(1, 4),
        default_green=rng.randint(min_green, max_green),
        yellow=yellow,
        all_red=rng.randint(0, 4),
        min_green=min_green,
        max_green=max_green,
        lanes_per_approach=rng.randint(1, 4),
        max_skips=rng.randint(0, 4),
        count_ttl=rng.randint(1, 20),
        walk_min=walk_min,
        turn_hold=turn_hold,
        walking_speed_cm_s=speed,
        crossing_widths_cm=widths,
        emergency_timeout=rng.randint(5, 80),
        max_emergencies=rng.randint(1, 6),
        # Half the runs have the lane active all week, the rest use the default windows.
        bus_lane_windows=((0, 6, 0, 1440),) if rng.random() < 0.5 else Config().bus_lane_windows,
        bus_extension=rng.randint(0, 8),
        bus_early_green=rng.random() < 0.8,
        **(_page_rules(rng) if extended else {}),
    )


def _page_rules(rng: random.Random) -> dict:
    return {
        "left_window": rng.choice([0, 0, 3, 6]),
        "hold_walk_timed": rng.random() < 0.5,
        "fault_signal": rng.choice(["flash", "red"]),
        "left_follow": rng.random() < 0.5,
        "left_follow_windows": rng.choice([(), Config().left_follow_windows]),
    }


def random_counts(rng: random.Random):
    roll = rng.random()
    if roll < 0.15:
        return None
    if roll < 0.55:
        return VehicleCounts()
    return VehicleCounts(bikes=rng.randint(0, 20), buses=rng.randint(0, 20),
                         cars=rng.randint(0, 40), trucks=rng.randint(0, 20))


def drive(seed: int, pedestrians: bool = True, emergencies: bool = True, buses: bool = True,
          faults: bool = True, extended: bool = False):
    """Return (config, plan names, snapshots, clock start) for one random run.

    buses=False switches the bus lane off, so its demand cannot affect rests and skips.
    faults=False leaves out power on, faults and mode changes.
    extended=True also draws the rules the page turns on (left window, left follow, red fault, timed
    hold) and gives each emergency a movement.
    """
    rng = random.Random(seed)
    cfg = random_config(rng, extended)
    if not buses:
        cfg = dataclasses.replace(cfg, bus_lane_windows=())
    plan = build_plan(arrows=rng.random() < 0.7)
    # Start within two minutes of a window edge half the time, so runs cross it.
    clock = rng.choice([7 * 3600 - 120, 9 * 3600 - 120, 16 * 3600 - 120, 18 * 3600 - 120]) \
        if rng.random() < 0.5 else rng.randrange(7 * 86400)
    controller = Controller(cfg, plan=plan, clock_start_s=clock, power_on=faults and rng.random() < 0.3)
    snaps = [controller.snapshot]
    for _ in range(TICKS):
        for approach in (1, 2, 3, 4):
            if rng.random() < 0.25:
                controller.report_counts(approach, random_counts(rng))
            if rng.random() < 0.25:
                controller.report_right_counts(approach, random_counts(rng))
            if rng.random() < 0.25:
                controller.report_left_counts(approach, random_counts(rng))
            if rng.random() < 0.25:
                controller.report_bus_counts(approach, random_counts(rng))
        if pedestrians and rng.random() < 0.05:
            controller.request_crossing(rng.randint(1, 4))
        if emergencies:
            if rng.random() < 0.03:
                try:
                    if extended:
                        controller.pause(rng.randint(1, 8), rng.randint(1, 4), rng.choice(["through", "left", "right"]))
                    else:
                        controller.pause(rng.randint(1, 8), rng.randint(1, 4))
                except ValueError:
                    pass  # capacity reached, which is the intended refusal
            if rng.random() < 0.04:
                controller.resume(rng.randint(1, 8))
        if faults:
            if rng.random() < 0.004:
                controller.fault(rng.choice(["manual", "link", "conflict"]))
            if rng.random() < 0.03:
                controller.clear_fault()
            if rng.random() < 0.01:
                controller.set_mode(rng.choice(["adaptive", "fixed"]))
        snaps.append(controller.tick())
    return cfg, [p.name for p in plan], snaps, clock


def active_movements(snap):
    """Everything that is lit or showing walk or flashing."""
    return [m for m, s in snap.signals.items() if s not in ("red", "stop", "flash")]


def check_rules(cfg: Config, names, snaps, clock: int = 0) -> None:
    previous = None
    stage_ticks = 0
    period_start_remaining = 0
    period_emerg = period_held = period_bus = period_ped = False  # period_ped: a crossing was served in this green
    last_cut = {name: False for name in names}
    same_phase_periods = 1
    not_green = {name: 0 for name in names}
    longest = max(cfg.max_green, cfg.max_arrow_green)
    # Loose liveness bound while no emergency is active: each other phase can hold the road
    # for one long period per skip round, and every handover costs an intergreen.
    wait_bound = (cfg.max_skips + 2) * len(names) * (longest + cfg.yellow + cfg.all_red) + 1
    ped_wait_bound = wait_bound + longest  # a press also waits for the green in progress
    max_c1 = max(crossing_times(w, cfg.walking_speed_cm_s, cfg.yellow)[1] for w in cfg.crossing_widths_cm)
    # From becoming the oldest request to the held green: the minimum green, the flashing
    # clearance, a yellow and an all-red, with slack for a request that lands mid-intergreen.
    latency_bound = cfg.min_green + max_c1 + cfg.turn_hold + 2 * (cfg.yellow + cfg.all_red) + 2
    waiting = {n: 0 for n in range(1, 5)}
    walk_run = {n: 0 for n in range(1, 5)}
    clear_run = {n: 0 for n in range(1, 5)}
    unserved = 0
    first_phase = names[0]

    for snap in snaps:
        emerg = snap.emergency_approach is not None
        outage = snap.stage in ("flash", "fault")
        assert snap.mode in ("adaptive", "fixed")
        if snap.stage == "fault":
            assert snap.fault in ("manual", "link", "conflict") and snap.remaining == 1 and snap.phase == ""
        else:
            assert snap.fault is None
        if outage:
            assert all(snap.signals[m] == "flash" for m in snap.signals if m[0] != "C"), "everything flashes"
            assert all(snap.signals[f"C{n}"] == "stop" for n in range(1, 5)), "crossings stopped while flashing"
            assert snap.phase == ""
        assert snap.bus_lane_active is is_active(cfg.bus_lane_windows, clock + snap.time), \
            "the bus lane flag follows the schedule"
        lit = [m for m, s in snap.signals.items() if s in ("green", "yellow")]
        assert conflict_free(active_movements(snap)), "active movements never conflict"
        # The left arrows: lit only with an arrow phase of the other pair, with every crossing red, and showing that phase's stage.
        lit_arrows = [f"L{n}" for n, state in enumerate(snap.arrows, 1) if state not in ("red", "flash")]
        assert conflict_free(active_movements(snap) + lit_arrows), "an arrow never conflicts with what else is lit"
        if lit_arrows:
            assert snap.phase.startswith("R") and snap.stage in ("green", "yellow"), "an arrow is lit only in an arrow phase"
            assert all(snap.arrows[int(arrow[1]) - 1] == snap.stage for arrow in lit_arrows), "an arrow shows the stage of its phase"
            assert all(snap.signals[f"C{n}"] == "stop" for n in range(1, 5)), "no crossing is open while an arrow is lit"
        assert (snap.arrows == ("flash",) * 4) == outage, "arrows flash with everything else"
        if not cfg.left_arrow:
            assert snap.arrows in (("red",) * 4, ("flash",) * 4), "no arrow when switched off"
        encode(with_arrows(snap.signals, snap.arrows))  # the serial line is valid too
        assert snap.remaining >= 1
        if snap.stage in ("all_red", "flash", "fault"):
            assert not lit
            assert all(snap.signals[f"C{n}"] == "stop" for n in range(1, 5)), "solid red man in all-red"
        else:
            assert {m for m in lit} == {m for m, s in snap.signals.items() if s == snap.stage}
            assert lit, "something is lit outside all-red"
        if snap.holding:
            assert snap.stage == "green" and snap.signals[f"T{snap.emergency_approach}"] == "green"

        # Liveness. Phases may wait while an emergency is active or the signals are down, so the
        # counters restart then.
        pause = emerg or outage
        for name in not_green:
            not_green[name] = 0 if pause or (snap.phase == name and snap.stage == "green") else not_green[name] + 1
            assert not_green[name] <= wait_bound, f"{name} waited too long"
        for n in range(1, 5):
            waiting[n] = waiting[n] + 1 if n in snap.pedestrian_requests and not pause else 0
            assert waiting[n] <= ped_wait_bound, f"crossing {n} waited too long"
        if previous is None or snap.emergency_approach != previous.emergency_approach or outage:
            unserved = 0
        unserved = unserved + 1 if emerg and not snap.holding and not outage else 0
        assert unserved <= latency_bound, "an emergency waited too long for its green"

        new_period = previous is None or snap.period != previous.period
        restart = previous is not None and snap.startups != previous.startups
        fault_begins = snap.stage == "fault" and previous is not None and previous.stage != "fault"
        if previous is None or restart or fault_begins:
            # A new beginning: the first snapshot, a startup sequence starting (possibly between two
            # snapshots) or a fault. Nothing before it constrains what comes next.
            if previous is None and snap.startups == 0:
                pass  # a run that did not power on starts straight in the first green
            elif snap.stage != "fault":
                first = ("flash" if cfg.startup_flash else "all_red" if cfg.all_red else "green")
                assert snap.stage == first, f"a startup begins with {first}"
                if first == "green":
                    assert snap.phase == first_phase or emerg, "the cycle restarts at its first phase"
            stage_ticks, period_start_remaining = 1, snap.remaining
            period_emerg, period_held, period_bus = emerg, snap.holding, snap.bus_priority
            period_ped = any(snap.signals[f"C{n}"] != "stop" for n in range(1, 5))
            same_phase_periods = 1
            last_cut = {name: False for name in names}
        else:
            same_stage = snap.stage == previous.stage and snap.phase == previous.phase and not new_period
            if same_stage:
                stage_ticks += 1
                if snap.stage == "green":
                    if snap.remaining > previous.remaining:
                        # Only a bus extension may add time to a running green.
                        assert snap.bus_priority and not previous.bus_priority, "only one bus extension"
                        assert snap.bus_lane_active, "bus priority only while the lane is active"
                        assert cfg.bus_extension > 0
                        assert not period_ped, "no extension in a green that serves a crossing"
                        assert not emerg and snap.remaining <= cfg.bus_extension
                    period_emerg = period_emerg or emerg
                    period_held = period_held or snap.holding
                    if snap.bus_priority and not period_bus:
                        assert snap.bus_lane_active, "bus priority only while the lane is active"
                    period_bus = period_bus or snap.bus_priority
                elif snap.stage != "fault":
                    assert snap.remaining == previous.remaining - 1, "flash, yellow and all-red count down one second at a time"
            else:
                if previous.stage == "flash":
                    assert stage_ticks == cfg.startup_flash, "startup flash ran its full time"
                    if cfg.all_red:
                        assert snap.stage == "all_red" and snap.phase == "", "startup all-red follows the flash"
                    else:
                        assert snap.stage == "green" and (snap.phase == first_phase or emerg)
                elif previous.stage == "green":
                    assert stage_ticks >= cfg.min_green, "green ran at least min_green"
                    limit = cfg.max_arrow_green if previous.phase.startswith("R") else cfg.max_green
                    # The emergency that ends a period can arrive in the very tick that cuts it, so
                    # the snapshot where the stage ends counts as emergency-affected too.
                    affected = period_emerg or emerg
                    if not (affected or period_bus or snap.bus_priority):
                        assert stage_ticks == period_start_remaining, "green ran its planned time"
                    if not affected and not period_held:
                        # A period shorter than planned with no emergency was cut early for a bus. The
                        # phase must then have a period that is not cut before it can be cut again.
                        was_cut = stage_ticks < period_start_remaining
                        assert not (was_cut and last_cut[previous.phase]), "a cut phase is not cut twice running"
                        last_cut[previous.phase] = was_cut
                    if not period_held:
                        assert stage_ticks <= limit
                    if new_period:
                        assert previous.phase.startswith("T"), "an arrow phase never rests"
                        same_phase_periods += 1
                        assert same_phase_periods <= cfg.max_skips + 1, "skip limit"
                        assert snap.phase == previous.phase and snap.stage == "green"
                        assert all(previous.signals[f"C{n}"] == "stop" for n in range(1, 5)), \
                            "a phase that served pedestrians never rests"
                    else:
                        assert snap.stage == "yellow" and snap.phase == previous.phase
                        same_phase_periods = 1
                elif previous.stage == "yellow":
                    assert stage_ticks == cfg.yellow, "yellow never shortened"
                    if cfg.all_red:
                        assert snap.stage == "all_red" and snap.phase == previous.phase
                    else:
                        assert snap.stage == "green" and (snap.phase != previous.phase or emerg)
                else:
                    assert stage_ticks == cfg.all_red, "all-red never shortened"
                    assert snap.stage == "green" and (snap.phase != previous.phase or emerg)
                stage_ticks, period_start_remaining = 1, snap.remaining
                if snap.stage == "green":
                    period_emerg, period_held, period_bus = emerg, snap.holding, snap.bus_priority
                    period_ped = any(snap.signals[f"C{n}"] != "stop" for n in range(1, 5))

        # Pedestrian signal sequence per crossing: stop, walk, clear, stop. A fault stops everything.
        for n in range(1, 5):
            if snap.stage == "fault" or restart:  # an interruption overrides every pedestrian rule
                walk_run[n] = clear_run[n] = 0
                continue
            now = snap.signals[f"C{n}"]
            before = previous.signals[f"C{n}"] if previous else "stop"
            total, _ = crossing_times(cfg.crossing_widths_cm[n - 1], cfg.walking_speed_cm_s, cfg.yellow)
            if before == "stop" and now != "stop":
                assert now == "walk", "a crossing starts with walk"
                assert new_period, "walk starts only when a green opens"
                assert not emerg, "no walk starts while an emergency is active"
            if before == "walk" and now != "walk":
                no_flashing = cfg.turn_hold > 0 and total - cfg.yellow <= 0  # a crossing so short that its flashing is all in the yellow
                assert now == ("stop" if no_flashing else "clear"), f"walk is followed by flashing (crossing {n}, total {total}, yellow {cfg.yellow}, hold {cfg.turn_hold}, stage {snap.stage}, remaining {snap.remaining}, walked {walk_run[n]})"
                if not (period_emerg or emerg):  # an emergency may cut a walk short
                    assert walk_run[n] >= cfg.walk_min, "walk lasts at least walk_min"
            if before == "clear" and now not in ("clear",):
                assert now == "stop", "flashing is followed by solid red"
                if cfg.turn_hold > 0:  # the flashing ends in green, which leaves turn_hold seconds of green with the man solid red
                    assert previous.stage == "green", "with a hold the flashing ends in green"
                    assert previous.remaining == cfg.turn_hold + 1, "and the hold is the last turn_hold seconds of green"
                    assert clear_run[n] >= total - cfg.yellow, "flashing clearance is never cut short, even for an emergency"
                else:
                    assert previous.stage == "yellow", "flashing runs to the end of the yellow"
                    assert clear_run[n] >= total, "flashing clearance is never cut short, even for an emergency"
            walk_run[n] = walk_run[n] + 1 if now == "walk" else 0
            clear_run[n] = clear_run[n] + 1 if now == "clear" else 0
        previous = snap


@pytest.mark.parametrize("seed", SEEDS)
def test_random_runs_never_break_a_rule(seed):
    cfg, names, snaps, clock = drive(seed)
    try:
        check_rules(cfg, names, snaps, clock)
    except AssertionError as exc:
        raise AssertionError(f"seed {seed}: {exc}") from exc


@pytest.mark.parametrize("seed", range(60))
def test_without_button_presses_every_crossing_stays_stopped(seed):
    cfg, names, snaps, _ = drive(seed, pedestrians=False)
    assert all(s.signals[f"C{n}"] == "stop" for s in snaps for n in range(1, 5))
    assert all(s.pedestrian_requests == () for s in snaps)


@pytest.mark.parametrize("seed", range(60))
def test_without_emergencies_nothing_is_ever_held(seed):
    cfg, names, snaps, _ = drive(seed, emergencies=False)
    assert all(s.emergency_approach is None and not s.holding for s in snaps)


@pytest.mark.parametrize("seed", range(60))
def test_once_emergencies_stop_every_phase_is_served_again(seed):
    cfg, names, _, clock = drive(seed)
    rng = random.Random(seed)
    controller = Controller(cfg, plan=build_plan(arrows="R13" in names), clock_start_s=clock)
    for vehicle in range(8):
        try:
            controller.pause(vehicle, rng.randint(1, 4))
        except ValueError:
            pass
    for _ in range(rng.randint(0, 50)):
        controller.tick()
    for vehicle in range(8):
        controller.resume(vehicle)
    longest = max(cfg.max_green, cfg.max_arrow_green)
    window = 8 * (cfg.max_skips + 2) * (longest + cfg.yellow + cfg.all_red)
    seen = {controller.tick().phase for _ in range(window)}
    assert seen >= {n for n in names if n.startswith("T")}


def test_the_random_runs_really_exercise_the_hard_cases():
    """Guard against a fuzz test that passes because it never reaches the hard cases."""
    rests = forced = 0
    for seed in SEEDS:  # without presses or emergencies, since both end a rest
        cfg, names, snaps, _ = drive(seed, pedestrians=False, emergencies=False, buses=False, faults=False)
        run = 1
        for a, b in zip(snaps, snaps[1:]):
            if a.stage == b.stage == "green" and a.phase == b.phase and b.period != a.period:
                rests += 1
                run += 1
            elif a.stage == "green" and b.stage == "yellow":
                forced += run > 1 and run == cfg.max_skips + 1
                run = 1
    assert rests > 100
    assert forced > 25

    walks = flashes = stretched = arrows_run = arrows_skipped = 0
    for seed in SEEDS:
        cfg, names, snaps, _ = drive(seed, emergencies=False, buses=False, faults=False)
        for a, b in zip(snaps, snaps[1:]):
            for n in range(1, 5):
                walks += a.signals[f"C{n}"] == "stop" and b.signals[f"C{n}"] == "walk"
                flashes += a.signals[f"C{n}"] == "walk" and b.signals[f"C{n}"] == "clear"
            if a.stage == "all_red" and b.stage == "green" and "R13" in names:
                arrows_run += b.phase.startswith("R")
                arrows_skipped += a.phase.startswith("T") and b.phase.startswith("T")
        stretched += sum(1 for s in snaps if s.stage == "green" and s.remaining > cfg.default_green)
    assert walks > 3000
    assert flashes > 3000
    assert stretched > 20000
    assert arrows_run > 1000
    assert arrows_skipped > 10  # 19 measured. An arrow phase is now skipped only when its right and left counts are all known and empty

    extensions = early_cuts = 0
    for seed in SEEDS:
        cfg, names, snaps, _ = drive(seed, faults=False)
        planned = ticks = 0
        emerg = extended = False
        for i, x in enumerate(snaps):
            before = snaps[i - 1] if i else None
            if x.stage == "green" and (before is None or before.period != x.period or before.stage != "green"):
                planned, ticks, emerg, extended = x.remaining, 0, False, False
            if x.stage == "green":
                ticks += 1
                emerg = emerg or x.emergency_approach is not None
                if before and before.period == x.period and before.stage == "green" and x.remaining > before.remaining:
                    extensions += 1
                    extended = True
            if (x.stage == "yellow" and before and before.stage == "green" and ticks < planned
                    and not extended and not emerg and x.emergency_approach is None):
                early_cuts += 1
    assert extensions > 100
    assert early_cuts > 250

    entered = begun = completed = fixed = 0
    for seed in SEEDS:
        cfg, names, snaps, _ = drive(seed)
        for a, b in zip(snaps, snaps[1:]):
            entered += a.stage != "fault" and b.stage == "fault"
            begun += b.startups != a.startups
            completed += a.stage == "all_red" and a.phase == "" and b.stage == "green"
            fixed += b.mode == "fixed"
    assert entered > 300
    assert begun > 300
    assert completed > 300
    assert fixed > 20000

    holds = preempts = cut_walks = released = 0
    for seed in SEEDS:
        cfg, names, snaps, _ = drive(seed, faults=False)
        for a, b in zip(snaps, snaps[1:]):
            holds += (not a.holding) and b.holding
            released += a.holding and not b.holding
            preempts += a.stage == "green" and b.stage == "yellow" and a.emergency_approach is not None \
                and not a.holding
            for n in range(1, 5):
                cut_walks += (a.signals[f"C{n}"] == "walk" and b.signals[f"C{n}"] == "clear"
                              and b.emergency_approach is not None)
    assert holds > 1000
    assert released > 800
    assert preempts > 500
    assert cut_walks > 50


# Mutation checks: a controller with a deliberate flaw must fail the same rules.

def _run_checked(controller_cls, cfg=None, requests=True, quiet=False, arrows=False, emergencies=False):
    """Run a controller for 400 s and check the rules. quiet keeps every lane known empty."""
    cfg = cfg or Config()
    plan = build_plan(arrows=arrows)
    controller = controller_cls(cfg, plan=plan)
    snaps = [controller.snapshot]
    for t in range(400):
        if requests and t % 7 == 0:
            for n in (1, 2, 3, 4):
                controller.request_crossing(n)
        if emergencies:
            if t % 13 == 0:
                controller.pause(f"v{t}", 1 + (t // 13) % 4)
            if t % 13 == 6:
                controller.resume(f"v{t - 6}")
        if quiet:
            for n in (1, 2, 3, 4):
                controller.report_counts(n, VehicleCounts())
                controller.report_right_counts(n, VehicleCounts())
                controller.report_left_counts(n, VehicleCounts())
        snaps.append(controller.tick())
    check_rules(cfg, [p.name for p in plan], snaps)


def test_the_checker_passes_the_real_controller_under_heavy_requests():
    _run_checked(Controller)
    _run_checked(Controller, emergencies=True)
    _run_checked(Controller, emergencies=True, arrows=True)


def test_the_checker_catches_a_controller_that_shortens_yellow():
    from traffic_controller import signals

    class Broken(Controller):
        def _end_green(self):
            super()._end_green()
            if self._stage == signals.YELLOW:
                self._remaining = max(1, self._cfg.yellow - 1)

    with pytest.raises(AssertionError):
        _run_checked(Broken, requests=False)


def test_the_checker_catches_walk_shown_against_conflicting_vehicles():
    class Broken(Controller):
        def _crossings_for(self, index):
            return (1, 2, 3, 4)  # serves crossings the whitelist forbids

    with pytest.raises(AssertionError):
        _run_checked(Broken)


def test_the_checker_catches_flashing_cut_short():
    from traffic_controller import signals

    class Broken(Controller):
        def _pedestrian_state(self, n):
            state = super()._pedestrian_state(n)
            # the flashing ends 2 s early, which is a clearance cut short
            if state == signals.CLEAR and self._stage == signals.GREEN and self._remaining <= self._cfg.turn_hold + 2:
                return signals.STOP
            return signals.STOP if self._stage == signals.YELLOW else state

    with pytest.raises(AssertionError):
        _run_checked(Broken)


def test_the_checker_catches_a_walk_shorter_than_the_minimum():
    class Broken(Controller):
        def _open_period(self, index, emergency=False):
            super()._open_period(index, emergency)
            if self._served:
                self._remaining = 1 + max(self._crossing(n)[1] for n in self._served)  # walk of 1 s

    with pytest.raises(AssertionError):
        _run_checked(Broken)


def test_the_checker_passes_the_real_controller_with_arrows_and_known_empty_lanes():
    _run_checked(Controller, arrows=True, requests=False, quiet=True)
    _run_checked(Controller, arrows=True)


def test_the_checker_catches_an_arrow_phase_that_rests():
    class Broken(Controller):
        def _choose_next(self, may_rest):
            return super()._choose_next(True)  # lets an arrow phase rest too

    with pytest.raises(AssertionError):
        _run_checked(Broken, arrows=True, requests=False, quiet=True)


def test_the_checker_catches_an_arrow_served_with_through_movements():
    from traffic_controller import Phase

    class Broken(Controller):
        def __init__(self, config=None, plan=None):
            super().__init__(config, plan)
            self._plan = (self._plan[0], Phase("R24", frozenset({"R2", "R4"})), *self._plan[2:])

        def _snapshot(self):
            snap = super()._snapshot()
            if snap.phase == "R24":
                snap.signals["T1"] = "green"  # a through movement lit together with an arrow
            return snap

    with pytest.raises(AssertionError):
        _run_checked(Broken, arrows=True, requests=False)


def _run_early_preempts(controller_cls):
    """Send an emergency for the other pair one second after every green opens."""
    cfg = Config()
    plan = build_plan(arrows=False)
    controller = controller_cls(cfg, plan=plan)
    snaps = [controller.snapshot]
    opened, resumes = None, {}
    for t in range(300):
        snap = snaps[-1]
        if snap.stage == "green" and snap.period != opened and not snap.holding:
            opened = snap.period
            vehicle = f"v{t}"
            controller.pause(vehicle, 2 if snap.phase == "T13" else 1)  # the other pair
            resumes[t + 30] = vehicle
        if t in resumes:
            controller.resume(resumes[t])
        snaps.append(controller.tick())
    check_rules(cfg, [p.name for p in plan], snaps)


def test_the_checker_passes_the_real_controller_under_early_preemptions():
    _run_early_preempts(Controller)


def test_the_checker_catches_preemption_that_ignores_the_minimum_green():
    class Broken(Controller):
        def _tick_green(self):
            self._elapsed += 10 ** 6  # the guard always passes
            super()._tick_green()

    with pytest.raises(AssertionError):
        _run_early_preempts(Broken)


def _run_preempts_during_walks(controller_cls):
    """Press every crossing just before each green opens, then send an emergency into a walk.

    It fires only into an ordinary green where a walk is showing, 4 s in, so the preempt tick
    is the first one the 5 s minimum green allows and it lands inside the 6 s walk.
    """
    cfg = Config()
    plan = build_plan(arrows=False)
    controller = controller_cls(cfg, plan=plan)
    snaps = [controller.snapshot]
    opened, opened_at, resumes = None, 0, {}
    for t in range(500):
        snap = snaps[-1]
        if snap.stage == "all_red" and snap.remaining == 1:
            for n in (1, 2, 3, 4):
                controller.request_crossing(n)  # served by the green that opens next
        if snap.stage == "green" and snap.period != opened:
            opened, opened_at = snap.period, t
        walking = any(snap.signals[f"C{n}"] == "walk" for n in range(1, 5))
        if (snap.stage == "green" and snap.period == opened and t == opened_at + 4 and walking
                and snap.emergency_approach is None):
            controller.pause(f"v{t}", 2 if snap.phase == "T13" else 1)  # the other pair
            resumes[t + 25] = f"v{t}"
        if t in resumes:
            controller.resume(resumes[t])
        snaps.append(controller.tick())
    check_rules(cfg, [p.name for p in plan], snaps)
    return snaps


def test_the_checker_passes_the_real_controller_when_emergencies_cut_walks():
    snaps = _run_preempts_during_walks(Controller)
    cut = [s for a, s in zip(snaps, snaps[1:])
           if s.emergency_approach is not None and "walk" in (a.signals[f"C{n}"] for n in range(1, 5))
           and "clear" in (s.signals[f"C{n}"] for n in range(1, 5))]
    assert cut, "the driver really does cut walks"


def test_the_checker_catches_preemption_that_cuts_the_flashing_clearance():
    class Broken(Controller):
        def _served_clearance_1_max(self):
            return 0  # ends the green at once, whatever the crossings still need

    with pytest.raises(AssertionError):
        _run_preempts_during_walks(Broken)


def test_the_checker_catches_an_emergency_green_that_skips_the_all_red():
    class Broken(Controller):
        def _end_yellow(self):
            if self._target_phase() is not None:
                self._start_green(self._next)
                return
            super()._end_yellow()

    with pytest.raises(AssertionError):
        _run_early_preempts(Broken)


def test_the_checker_catches_a_walk_started_for_an_emergency_green():
    class Broken(Controller):
        def _open_period(self, index, emergency=False):
            super()._open_period(index, False)  # serves pedestrians even for an emergency

    with pytest.raises(AssertionError):
        _run_preempts_during_walks(Broken)


def _run_bus(controller_cls, buses=(2, 4), presses=False, cfg=None, ticks=500):
    """A bus is always waiting at the listed approaches, with the bus lane active all week."""
    cfg = cfg or Config(bus_lane_windows=((0, 6, 0, 1440),), max_green=20)
    plan = build_plan(arrows=False)
    controller = controller_cls(cfg, plan=plan, clock_start_s=0)
    snaps = [controller.snapshot]
    for t in range(ticks):
        for approach in buses:
            controller.report_bus_counts(approach, VehicleCounts(buses=1))
        if presses and t % 7 == 0:
            for n in (1, 2, 3, 4):
                controller.request_crossing(n)
        snaps.append(controller.tick())
    check_rules(cfg, [p.name for p in plan], snaps, 0)
    return snaps


def test_the_checker_passes_the_real_controller_with_a_bus_always_waiting():
    for buses in ((2, 4), (1, 3), (1, 2, 3, 4)):
        snaps = _run_bus(Controller, buses)
        assert any(s.bus_priority for s in snaps)
    _run_bus(Controller, (2, 4), presses=True)
    _run_bus(Controller, (1, 2, 3, 4), presses=True)


def test_the_checker_catches_an_extension_that_can_repeat():
    class Broken(Controller):
        def _extension_due(self):
            return self._bus_waiting(self._index)  # no once-per-period limit, no max green

    with pytest.raises(AssertionError):
        _run_bus(Broken, (1, 2, 3, 4))


def test_the_checker_catches_an_extension_while_a_crossing_is_served():
    class Broken(Controller):
        def _extension_due(self):
            cfg = self._cfg
            return (cfg.bus_extension > 0 and not self._extended
                    and cfg.max_green - self._elapsed >= 1 and self._bus_waiting(self._index))

    with pytest.raises(AssertionError):
        # a served green is walk, flashing and the 6 s turn hold, 19 s, so max_green leaves room for an extension to show
        _run_bus(Broken, (1, 2, 3, 4), presses=True, cfg=Config(bus_lane_windows=((0, 6, 0, 1440),), max_green=30))


def test_the_checker_catches_early_green_that_shortens_a_walk_below_its_minimum():
    class Broken(Controller):
        def _early_green_due(self):
            cfg = self._cfg
            if not (cfg.bus_early_green and self._bus_active() and not self._cut[self._index]):
                return False
            if self._elapsed < cfg.min_green:  # the walk minimum is not respected
                return False
            if self._bus_waiting(self._index):
                return False
            upcoming, _ = self._select_next(self._may_rest())
            return upcoming != self._index and self._bus_waiting(upcoming)

    with pytest.raises(AssertionError):
        _run_bus(Broken, (2,), presses=True)


def test_the_checker_catches_a_phase_that_can_be_cut_twice_running():
    class Broken(Controller):
        def _mark_cut(self):
            self._cut[self._index] = False  # forgets that the phase was just cut

    with pytest.raises(AssertionError):
        _run_bus(Broken, (2,))


def test_the_checker_catches_bus_priority_while_the_lane_is_inactive():
    class Broken(Controller):
        def _bus_active(self):
            return True  # ignores the schedule

    cfg = Config(bus_lane_windows=())  # never active
    with pytest.raises(AssertionError):
        _run_bus(Broken, (2,), cfg=cfg)


def _run_faults(controller_cls, power_on=True):
    """Power on, then raise a fault every 50 s and clear it 10 s later."""
    cfg = Config()
    plan = build_plan(arrows=False)
    controller = controller_cls(cfg, plan=plan, power_on=power_on)
    snaps = [controller.snapshot]
    for t in range(400):
        if t % 50 == 20:
            controller.fault("link")
        if t % 50 == 30:
            controller.clear_fault()
        snaps.append(controller.tick())
    check_rules(cfg, [p.name for p in plan], snaps)
    return snaps


def test_the_checker_passes_the_real_controller_through_faults_and_restarts():
    snaps = _run_faults(Controller)
    assert {"flash", "fault", "all_red", "green"} <= {s.stage for s in snaps}
    _run_faults(Controller, power_on=False)


def test_the_checker_catches_a_fault_that_does_not_flash_everything():
    class Broken(Controller):
        def _snapshot(self):
            snap = super()._snapshot()
            if snap.stage == "fault":
                snap.signals["T1"] = "red"
            return snap

    with pytest.raises(AssertionError):
        _run_faults(Broken)


def test_the_checker_catches_a_startup_flash_that_is_cut_short():
    class Broken(Controller):
        def _begin_startup(self, flash=True):
            super()._begin_startup(flash)
            if self._stage == "flash":
                self._remaining -= 1

    with pytest.raises(AssertionError):
        _run_faults(Broken)


def test_the_checker_catches_a_recovery_that_skips_the_startup_sequence():
    class Broken(Controller):
        def _begin_startup(self, flash=True):
            super()._begin_startup(flash)
            self._startup = False
            self._start_green(0)

    with pytest.raises(AssertionError):
        _run_faults(Broken, power_on=False)


def test_the_checker_catches_a_startup_that_skips_the_all_red():
    class Broken(Controller):
        def _end_flash(self):
            self._start_green(0)

    with pytest.raises(AssertionError):
        _run_faults(Broken)


def test_the_checker_passes_the_real_controller_with_left_turners_waiting():
    for turn_hold in (0, 6):
        cfg = Config(left_arrow=True, turn_hold=turn_hold, max_green=30)
        plan = build_plan(arrows=True)
        controller = Controller(cfg, plan=plan)
        snaps = [controller.snapshot]
        for t in range(600):
            for n in (1, 2, 3, 4):
                controller.report_counts(n, VehicleCounts(cars=2))
                controller.report_right_counts(n, VehicleCounts(cars=1 if (t // 40 + n) % 3 else 0))
                controller.report_left_counts(n, VehicleCounts(cars=1 if (t // 25 + n) % 2 else 0))
            if t % 9 == 0:
                controller.request_crossing(1 + (t // 9) % 4)
            snaps.append(controller.tick())
        check_rules(cfg, [p.name for p in plan], snaps)


def test_the_checker_catches_an_arrow_lit_in_a_through_phase():
    class Broken(Controller):
        def _arrows(self):
            return ("green", "red", "green", "red") if self._stage == "green" else super()._arrows()

    with pytest.raises(AssertionError):
        _run_checked(Broken, arrows=True)


def test_the_checker_catches_an_arrow_lit_with_the_right_arrow_of_its_own_opposite():
    class Broken(Controller):
        def _arrows(self):
            if self._plan[self._index].kind == "R" and self._stage in ("green", "yellow"):
                return (self._stage,) * 4  # L3 would exit into the lane of R2, and L1 into that of R4
            return super()._arrows()

    with pytest.raises(AssertionError):
        _run_checked(Broken, arrows=True)


def test_the_checker_catches_an_arrow_that_does_not_flash_in_a_startup():
    class Broken(Controller):
        def _arrows(self):
            return ("red",) * 4

    with pytest.raises(AssertionError):
        controller = Broken(Config(), plan=build_plan(arrows=True), power_on=True)
        check_rules(Config(), [p.name for p in build_plan(arrows=True)], [controller.snapshot])
