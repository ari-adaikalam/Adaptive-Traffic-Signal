"""The left arrow: lit during the arrow phase of the other pair, when no pedestrian can be crossing."""

import pytest

from traffic_controller import Config, Controller, VehicleCounts, build_plan, compatible
from traffic_controller.phases import ARROWS
from traffic_controller.timing import arrow_green_time


def run(controller, seconds):
    snaps = []
    for _ in range(seconds):
        snaps.append(controller.tick())
    return snaps


def report_all(controller, *, left=None, right=None, through=VehicleCounts()):
    for n in (1, 2, 3, 4):
        controller.report_counts(n, through)
        controller.report_right_counts(n, right if right is not None else VehicleCounts())
        controller.report_left_counts(n, (left or {}).get(n, VehicleCounts()))


# The compatibility of a left arrow with every other movement, written out by hand from the swept paths of a bus.
EXPECTED = {
    "L1": {"T1": True, "T3": True, "T2": False, "T4": False, "R1": True, "R2": True, "R4": True, "R3": False,
           "L2": True, "L3": True, "L4": True, "C1": False, "C2": False, "C3": False, "C4": False},
    "L2": {"T2": True, "T4": True, "T1": False, "T3": False, "R2": True, "R1": True, "R3": True, "R4": False,
           "L1": True, "L3": True, "L4": True, "C1": False, "C2": False, "C3": False, "C4": False},
}


@pytest.mark.parametrize("arrow", EXPECTED)
def test_the_left_arrow_conflict_table(arrow):
    for other, expected in EXPECTED[arrow].items():
        assert compatible(arrow, other) is expected, f"{arrow} with {other}"
        assert compatible(other, arrow) is expected, f"{other} with {arrow}"


def test_the_other_two_arrows_mirror_the_first_two():
    for arrow, mirror in (("L3", "L1"), ("L4", "L2")):
        for other in ("T1", "T2", "T3", "T4", "R1", "R2", "R3", "R4", "C1"):
            swapped = {"1": "3", "2": "4", "3": "1", "4": "2"}[other[1]]
            assert compatible(arrow, other) is compatible(mirror, other[0] + swapped), (arrow, other)
    assert ARROWS == ("L1", "L2", "L3", "L4")


def test_an_arrow_is_never_lit_in_a_through_phase_and_follows_the_arrow_phase_of_the_other_pair():
    controller = Controller(Config(), plan=build_plan(arrows=True))
    seen = set()
    for _ in range(400):
        report_all(controller, left={n: VehicleCounts(cars=2) for n in (1, 2, 3, 4)}, right=VehicleCounts(cars=2),
                   through=VehicleCounts(cars=2))
        snap = controller.tick()
        if snap.phase.startswith("T") or snap.stage == "all_red":
            assert snap.arrows == ("red",) * 4
        elif snap.phase == "R24":
            assert snap.arrows == (snap.stage, "red", snap.stage, "red")
        elif snap.phase == "R13":
            assert snap.arrows == ("red", snap.stage, "red", snap.stage)
        seen.add((snap.phase, snap.stage))
    assert {("R24", "green"), ("R24", "yellow"), ("R13", "green"), ("R13", "yellow")} <= seen


def test_arrows_flash_in_a_fault_and_during_startup_and_stay_red_when_switched_off():
    controller = Controller(Config(), plan=build_plan(arrows=True), power_on=True)
    assert controller.snapshot.arrows == ("flash",) * 4
    controller.fault("manual")
    assert controller.tick().arrows == ("flash",) * 4
    off = Controller(Config(left_arrow=False), plan=build_plan(arrows=True))
    for _ in range(200):
        report_all(off, right=VehicleCounts(cars=2))
        assert off.tick().arrows == ("red",) * 4


R24, R13 = 1, 3  # indexes in the plan T13, R24, T24, R13


def demand_after_reports(left, ticks=3):
    controller = Controller(Config(), plan=build_plan(arrows=True))
    for _ in range(ticks):
        report_all(controller, left=left)
        controller.tick()
    return controller


def test_a_waiting_left_turner_creates_demand_for_the_arrow_phase_that_carries_it():
    # Left turners from approach 1 use R24, and those from approach 2 use R13. Every other lane is known to be empty.
    first = demand_after_reports({1: VehicleCounts(cars=1)})
    assert first._demand(R24) is True and first._demand(R13) is False
    second = demand_after_reports({2: VehicleCounts(bikes=1)})
    assert second._demand(R13) is True and second._demand(R24) is False
    assert demand_after_reports({})._demand(R24) is False


def test_an_unknown_left_count_makes_the_arrow_demand_unknown_not_empty():
    controller = demand_after_reports({})
    for n in (1, 2, 3, 4):
        controller.report_left_counts(n, None)
    assert controller._demand(R24) is None and controller._demand(R13) is None


def test_with_the_left_arrow_off_left_turners_make_no_demand():
    controller = Controller(Config(left_arrow=False), plan=build_plan(arrows=True))
    for _ in range(3):
        report_all(controller, left={1: VehicleCounts(cars=5)})
        controller.tick()
    assert controller._demand(R24) is False


def test_an_unknown_left_count_never_skips_the_arrow_phase_and_gives_the_default_green():
    controller = Controller(Config(), plan=build_plan(arrows=True))
    phases, greens = set(), []
    for _ in range(300):
        for n in (1, 2, 3, 4):
            controller.report_counts(n, VehicleCounts())
            controller.report_right_counts(n, VehicleCounts())
            controller.report_left_counts(n, None)  # the detector cannot tell left turners apart
        snap = controller.tick()
        phases.add(snap.phase)
        if snap.phase == "R24" and snap.stage == "green":
            greens.append(snap.remaining)
    assert "R24" in phases and "R13" in phases
    assert max(greens) == min(Config().default_green, Config().max_arrow_green)


def test_the_arrow_green_is_planned_from_the_right_and_left_turners_together():
    cfg = Config()
    controller = Controller(cfg, plan=build_plan(arrows=True))
    controller.set_mode("adaptive")
    for _ in range(40):  # run to the first R24 green
        report_all(controller, left={1: VehicleCounts(cars=3), 3: VehicleCounts(trucks=1)}, right=VehicleCounts(cars=1))
        snap = controller.tick()
        if snap.phase == "R24" and snap.stage == "green":
            break
    # Approach 2 clears its own right turner and the left turners of approach 1, 4 s a car by default, and approach 4 the
    # truck from approach 3.
    expected = max(arrow_green_time(VehicleCounts(cars=4), cfg), arrow_green_time(VehicleCounts(cars=1, trucks=1), cfg))
    assert snap.phase == "R24" and snap.remaining >= expected - 1


def test_fixed_mode_still_lights_the_arrows():
    controller = Controller(Config(), plan=build_plan(arrows=True))
    controller.set_mode("fixed")
    lit = {snap.arrows for snap in run(controller, 300)}
    assert ("green", "red", "green", "red") in lit and ("red", "green", "red", "green") in lit
