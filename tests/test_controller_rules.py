import pytest

from traffic_controller import Config, Controller, Phase, VehicleCounts, build_plan, encode
from traffic_controller.protocol import with_arrows


def run(controller, seconds):
    return [controller.tick() for _ in range(seconds)]


def test_initial_state_has_the_first_pair_green_for_the_default_time():
    snap = Controller().snapshot
    assert (snap.time, snap.phase, snap.stage, snap.remaining) == (0, "T13", "green", 10)
    assert snap.heads == ("green", "red", "green", "red")
    assert snap.signals["T1"] == snap.signals["T3"] == "green"
    assert snap.signals["T2"] == snap.signals["T4"] == "red"
    assert all(snap.signals[f"R{n}"] == "red" for n in range(1, 5))
    assert all(snap.signals[f"C{n}"] == "stop" for n in range(1, 5))


@pytest.mark.parametrize("arrows,period", [(False, 32), (True, 64)])
def test_without_data_the_cycle_repeats_forever(arrows, period):
    """Each phase is 10 s green, 4 s yellow and 2 s all-red, and none is skipped without data."""
    controller = Controller(plan=build_plan(arrows=arrows))
    first = run(controller, period)
    for _ in range(20):
        again = run(controller, period)
        assert [(s.phase, s.stage, s.remaining) for s in again] == [(s.phase, s.stage, s.remaining) for s in first]


def test_every_tick_produces_a_line_the_arduino_will_accept():
    controller = Controller()
    for snap in [controller.snapshot] + run(controller, 400):
        encode(with_arrows(snap.signals, snap.arrows))


def test_identical_runs_are_identical():
    def trace():
        c = Controller()
        c.report_counts(2, VehicleCounts(cars=5))
        return [c.tick() for _ in range(200)]
    assert trace() == trace()


@pytest.mark.parametrize("approach", [0, 5, -1, "1", 2.0, True, None])
def test_bad_approaches_are_rejected(approach):
    with pytest.raises(ValueError):
        Controller().report_counts(approach, VehicleCounts())


def test_report_counts_rejects_the_wrong_type():
    with pytest.raises(ValueError):
        Controller().report_counts(2, {"cars": 3})  # type: ignore[arg-type]


def test_a_rejected_report_changes_nothing():
    reference = run(Controller(), 60)
    controller = Controller()
    with pytest.raises(ValueError):
        controller.report_counts(9, VehicleCounts(cars=50))
    assert run(controller, 60) == reference


def test_a_plan_needs_at_least_two_phases():
    with pytest.raises(ValueError):
        Controller(plan=[Phase("only", frozenset({"T1", "T3"}))])


def test_a_dead_camera_falls_back_to_default_timing():
    controller = Controller()
    controller.report_counts(2, VehicleCounts(trucks=100))
    controller.report_counts(4, VehicleCounts(trucks=100))
    run(controller, 10)  # the counts are now older than count_ttl by the time the phase opens
    snaps = run(controller, 30)
    first_t24 = next(s for s in snaps if s.phase == "T24" and s.stage == "green")
    assert first_t24.remaining == 10


def test_counts_pushed_every_second_keep_a_busy_road_served_within_max_green():
    controller = Controller()
    greens = []
    for _ in range(400):
        controller.report_counts(1, VehicleCounts(trucks=100))
        controller.report_counts(3, VehicleCounts(trucks=100))
        snap = controller.tick()
        if snap.stage == "green":
            greens.append(snap)
    assert max(s.remaining for s in greens) <= Config().max_green


def test_resting_phase_still_hands_over_once_traffic_arrives_opposite():
    controller = Controller(plan=build_plan(arrows=False))
    for approach in (2, 4):
        controller.report_counts(approach, VehicleCounts())
    run(controller, 10)  # T24 found empty, T13 rests
    for approach in (2, 4):
        controller.report_counts(approach, VehicleCounts(cars=4))
    snaps = run(controller, 20)
    assert any(s.phase == "T24" and s.stage == "green" for s in snaps)


# Pedestrians

@pytest.mark.parametrize("crossing", [0, 5, -1, "1", 2.0, True, None])
def test_bad_crossings_are_rejected(crossing):
    with pytest.raises(ValueError):
        Controller().request_crossing(crossing)


def test_a_repeat_press_is_reported_and_changes_nothing():
    controller = Controller()
    assert controller.request_crossing(2) is True
    assert controller.request_crossing(2) is False
    assert controller.snapshot.pedestrian_requests == (2,)


def test_serving_pedestrians_ends_a_rest_so_the_clearance_can_finish():
    """With the opposite phase empty, T13 rests in green. A crossing it served must hand over."""
    def periods(press):
        controller = Controller(plan=build_plan(arrows=False))
        out = []
        previous = controller.snapshot
        for t in range(400):
            for approach in (2, 4):
                controller.report_counts(approach, VehicleCounts())  # the other phase stays empty
            if press and t % 3 == 0:
                controller.request_crossing(2)
            snap = controller.tick()
            out.append((previous, snap))
            previous = snap
        return out

    def rest_count(pairs):
        return sum(1 for a, b in pairs if a.stage == b.stage == "green" and a.phase == b.phase
                   and b.remaining != a.remaining - 1)

    assert rest_count(periods(press=False)) > 0, "an empty opposite phase lets T13 rest"
    for before, after in periods(press=True):
        if before.stage == "green" and before.remaining == 1 and before.signals["C2"] == "clear":
            assert after.stage == "yellow", "a period that served a crossing ends in a yellow"


def test_a_walk_never_starts_in_the_middle_of_a_green():
    controller = Controller()
    seen_walk_start = []
    previous = controller.snapshot
    for t in range(300):
        if t % 5 == 0:
            controller.request_crossing(1 + t % 4)
        snap = controller.tick()
        for n in range(1, 5):
            if previous.signals[f"C{n}"] == "stop" and snap.signals[f"C{n}"] == "walk":
                seen_walk_start.append(snap)
                assert snap.stage == "green"
                assert snap.remaining >= Config().walk_min + crossing_cl1(n)
        previous = snap
    assert seen_walk_start


def crossing_cl1(n):
    from traffic_controller.config import crossing_times
    cfg = Config()
    return crossing_times(cfg.crossing_widths_cm[n - 1], cfg.walking_speed_cm_s, cfg.yellow)[1]


def test_pedestrians_are_never_served_by_the_phase_that_conflicts_with_their_crossing():
    controller = Controller()
    controller.request_crossing(1)  # crossing 1 runs with phase T24 only
    for snap in [controller.snapshot] + run(controller, 80):
        if snap.phase == "T13":
            assert snap.signals["C1"] == "stop"


# Right-turn arrows

@pytest.mark.parametrize("approach", [0, 5, -1, "1", 2.0, True, None])
def test_bad_right_lane_approaches_are_rejected(approach):
    with pytest.raises(ValueError):
        Controller().report_right_counts(approach, VehicleCounts())


def test_report_right_counts_rejects_the_wrong_type():
    with pytest.raises(ValueError):
        Controller().report_right_counts(2, {"cars": 3})  # type: ignore[arg-type]


def test_a_plan_needs_two_through_phases():
    plan = build_plan()
    with pytest.raises(ValueError):
        Controller(plan=[plan[0], plan[1]])  # one through phase and an arrow phase


def test_a_plan_must_start_with_a_through_phase():
    plan = build_plan()
    with pytest.raises(ValueError):
        Controller(plan=[plan[1], plan[0]])


def test_through_and_right_reports_are_kept_apart():
    controller = Controller()
    controller.report_counts(2, VehicleCounts())  # the through lanes of approach 2 are empty
    controller.report_right_counts(2, VehicleCounts(cars=3))
    controller.report_right_counts(4, VehicleCounts(cars=3))
    snaps = run(controller, 20)
    assert any(s.phase == "R24" and s.stage == "green" for s in snaps), "a right queue gets its arrow"


def test_a_failed_right_lane_detector_falls_back_to_serving_the_arrow():
    controller = Controller()
    for approach in (2, 4):
        controller.report_right_counts(approach, VehicleCounts())
        controller.report_right_counts(approach, None)  # detector failed: unknown, never skipped
    assert any(s.phase == "R24" and s.stage == "green" for s in run(controller, 20))


def test_an_arrow_never_overlaps_a_through_movement_or_a_crossing():
    controller = Controller()
    controller.request_crossing(2)
    for snap in [controller.snapshot] + run(controller, 300):
        if snap.phase.startswith("R"):
            assert all(snap.signals[f"T{n}"] == "red" for n in range(1, 5))
            assert all(snap.signals[f"C{n}"] == "stop" for n in range(1, 5))


# Emergency requests

@pytest.mark.parametrize("approach", [0, 5, -1, "1", 2.0, True, None])
def test_bad_emergency_approaches_are_rejected(approach):
    with pytest.raises(ValueError):
        Controller().pause("a", approach)


@pytest.mark.parametrize("vehicle", [None, True, 1.5, "", "x" * 65, ["a"]])
def test_bad_vehicle_ids_are_rejected(vehicle):
    controller = Controller()
    with pytest.raises(ValueError):
        controller.pause(vehicle, 1)
    with pytest.raises(ValueError):
        controller.resume(vehicle)


def test_integer_and_string_ids_are_the_same_vehicle():
    controller = Controller()
    assert controller.pause(825, 2) is True
    assert controller.pause("825", 2) is False
    assert controller.resume("825") is True
    assert controller.resume(825) is False


def test_capacity_limit_stops_a_flood_of_requests():
    controller = Controller(Config(max_emergencies=3))
    for i in range(3):
        assert controller.pause(f"v{i}", 2) is True
    with pytest.raises(ValueError):
        controller.pause("v3", 2)
    assert controller.resume("v0") is True
    assert controller.pause("v3", 2) is True


def test_a_rejected_emergency_call_changes_nothing():
    reference = run(Controller(), 120)
    controller = Controller()
    with pytest.raises(ValueError):
        controller.pause("a", 9)
    with pytest.raises(ValueError):
        controller.pause("x" * 100, 1)
    assert run(controller, 120) == reference


def test_a_stuck_client_cannot_hold_a_phase_by_repeating_pause():
    controller = Controller(plan=build_plan(arrows=False))
    controller.pause("a", 2)
    held = []
    for _ in range(300):
        controller.pause("a", 2)  # a client that never stops resending
        held.append(controller.tick().holding)
    # Served for at most the timeout, then locked out for a cooldown of the same length,
    # so the road is held for at most about half the time.
    assert any(held[:80])
    assert not any(held[61:119]), "no hold during the cooldown"
    assert sum(held) < 0.6 * len(held)


def test_cooldown_ends_by_itself_and_by_resume():
    controller = Controller()
    controller.pause("a", 3)
    run(controller, 60)  # the request expires at tick 60
    assert controller.pause("a", 3) is False  # cooling down
    controller.resume("a")  # signing off clears the cooldown
    assert controller.pause("a", 3) is True
    run(controller, 60)
    assert controller.pause("a", 3) is False
    run(controller, 60)  # cooldown over
    assert controller.pause("a", 3) is True


def test_every_approach_is_served_by_the_through_phase_that_holds_it():
    for approach, phase in ((1, "T13"), (2, "T24"), (3, "T13"), (4, "T24")):
        for arrows in (False, True):
            controller = Controller(plan=build_plan(arrows=arrows))
            controller.pause("a", approach)
            snaps = run(controller, 100)
            held = [s for s in snaps if s.holding]
            assert held and all(s.phase == phase for s in held), (approach, arrows)


def test_an_emergency_never_reaches_green_with_a_pedestrian_still_walking_against_it():
    controller = Controller(plan=build_plan(arrows=False))
    for t in range(200):
        if t % 5 == 0:
            controller.request_crossing(1 + t % 4)
        if t == 40:
            controller.pause("a", 2)
        snap = controller.tick()
        if snap.holding:
            assert all(snap.signals[f"C{n}"] == "stop" for n in (1, 3)), "crossings 1 and 3 conflict with T24"


# Bus lane

@pytest.mark.parametrize("approach", [0, 5, -1, "1", 2.0, True, None])
def test_bad_bus_lane_approaches_are_rejected(approach):
    with pytest.raises(ValueError):
        Controller().report_bus_counts(approach, VehicleCounts())


def test_report_bus_counts_rejects_the_wrong_type():
    with pytest.raises(ValueError):
        Controller().report_bus_counts(2, {"buses": 1})  # type: ignore[arg-type]


@pytest.mark.parametrize("clock", [-1, 604800, 1.5, True, None, "0"])
def test_a_bad_clock_start_is_rejected(clock):
    with pytest.raises(ValueError):
        Controller(clock_start_s=clock)


def test_the_bus_lane_flag_follows_the_clock():
    seven = 7 * 3600
    controller = Controller(clock_start_s=seven - 3)
    flags = [controller.snapshot.bus_lane_active] + [controller.tick().bus_lane_active for _ in range(6)]
    assert flags == [False, False, False, True, True, True, True]  # 06:59:57 to 07:00:03


def test_bus_counts_are_ignored_while_the_lane_is_inactive():
    quiet = [(s.phase, s.stage, s.remaining) for s in run(Controller(plan=build_plan(arrows=False)), 80)]
    controller = Controller(plan=build_plan(arrows=False))
    for approach in (1, 2, 3, 4):
        controller.report_bus_counts(approach, VehicleCounts(buses=9))
    assert [(s.phase, s.stage, s.remaining) for s in run(controller, 80)] == quiet


def test_an_active_bus_lane_with_no_bus_detector_never_triggers_priority():
    controller = Controller(clock_start_s=8 * 3600)
    snaps = run(controller, 400)
    assert all(s.bus_lane_active for s in snaps)
    assert not any(s.bus_priority for s in snaps)


def test_a_bus_cannot_hold_the_green_open_beyond_one_extension_per_period():
    controller = Controller(Config(max_green=40), plan=build_plan(arrows=False), clock_start_s=8 * 3600)
    for _ in range(400):
        for approach in (1, 2, 3, 4):
            controller.report_bus_counts(approach, VehicleCounts(buses=1))  # a bus is always waiting
        controller.tick()
    snaps = [controller.snapshot]
    for _ in range(200):
        for approach in (1, 2, 3, 4):
            controller.report_bus_counts(approach, VehicleCounts(buses=1))
        snaps.append(controller.tick())
    lengths = {}
    for s in snaps:
        if s.stage == "green":
            lengths[s.period] = lengths.get(s.period, 0) + 1
    assert max(lengths.values()) <= 10 + 5 + 1  # the default green and one extension of 5 s, with a bus of its own
    assert any(s.bus_priority for s in snaps)


# Modes, faults and startup

@pytest.mark.parametrize("reason", ["", "x", None, 1, "Manual", ["link"]])
def test_bad_fault_reasons_are_rejected(reason):
    with pytest.raises(ValueError):
        Controller().fault(reason)


@pytest.mark.parametrize("mode", ["", "Fixed", None, 1, True])
def test_bad_modes_are_rejected(mode):
    with pytest.raises(ValueError):
        Controller().set_mode(mode)


def test_fault_and_clear_report_whether_they_did_anything():
    controller = Controller()
    assert controller.clear_fault() is False  # nothing to clear
    assert controller.fault("manual") is True
    assert controller.fault("link") is False  # already in a fault, the first reason stays
    assert controller.tick().fault == "manual"
    assert controller.clear_fault() is True
    assert controller.clear_fault() is False  # already clearing
    assert controller.tick().stage == "flash"


def test_a_fault_changes_nothing_but_the_clock_until_it_is_cleared():
    controller = Controller()
    run(controller, 5)
    controller.fault("conflict")
    snaps = run(controller, 40)
    assert {(s.stage, s.phase, s.remaining, s.fault) for s in snaps} == {("fault", "", 1, "conflict")}
    assert [s.time for s in snaps] == list(range(6, 46))


@pytest.mark.parametrize("seconds", [3, 12, 22, 30])
def test_after_any_fault_the_cycle_restarts_at_its_first_phase(seconds):
    controller = Controller(plan=build_plan(arrows=False))
    run(controller, seconds)  # could be T13 or T24, green, yellow or all-red
    controller.fault("link")
    controller.tick()
    controller.clear_fault()
    snaps = run(controller, 40)
    first_green = next(s for s in snaps if s.stage == "green")
    assert first_green.phase == "T13"
    assert [s.stage for s in snaps[:7]] == ["flash"] * 5 + ["all_red"] * 2


def test_a_fault_raised_and_cleared_between_two_ticks_still_restarts_the_cycle():
    controller = Controller()
    run(controller, 4)
    controller.fault("manual")
    controller.clear_fault()
    snap = controller.tick()
    assert (snap.stage, snap.remaining) == ("flash", 5)
    assert snap.startups == 1


@pytest.mark.parametrize("flash,all_red,stages", [
    (0, 2, ["all_red", "all_red", "green"]),
    (0, 0, ["green"]),
    (2, 0, ["flash", "flash", "green"]),
])
def test_startup_with_zero_length_stages(flash, all_red, stages):
    controller = Controller(Config(startup_flash=flash, all_red=all_red), plan=build_plan(arrows=False), power_on=True)
    seen = [controller.snapshot.stage] + [s.stage for s in run(controller, len(stages))]
    assert seen[:len(stages)] == stages


@pytest.mark.parametrize("bad", [-1, 1.5, True, None, "5"])
def test_startup_flash_rejects_bad_values(bad):
    with pytest.raises(ValueError):
        Config(startup_flash=bad)


def test_power_on_is_off_by_default_and_the_first_snapshot_says_so():
    assert Controller().snapshot.stage == "green"
    first = Controller(power_on=True).snapshot
    assert (first.stage, first.remaining, first.phase, first.startups) == ("flash", 5, "", 1)


def test_fixed_mode_is_reported_and_switching_back_restores_adaptive_behaviour():
    controller = Controller(plan=build_plan(arrows=False))
    controller.set_mode("fixed")
    assert controller.tick().mode == "fixed"
    controller.set_mode("adaptive")
    assert controller.tick().mode == "adaptive"


def test_emergency_requests_are_kept_through_a_fault_and_served_after_the_restart():
    controller = Controller(plan=build_plan(arrows=False))
    controller.pause("a", 2)
    run(controller, 3)
    controller.fault("manual")
    run(controller, 10)
    controller.clear_fault()
    snaps = run(controller, 20)
    held = [s for s in snaps if s.holding]
    assert held and held[0].phase == "T24"
