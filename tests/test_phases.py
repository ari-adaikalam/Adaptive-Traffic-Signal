import itertools

import pytest

from traffic_controller import Phase, build_plan, compatible, conflict_free
from traffic_controller.phases import ALL_MOVEMENTS, opposite, shift

# The whitelist written out by hand, independent of the formula in phases.py.
# Any pair not listed here must conflict.
ALLOWED = {frozenset(p) for p in [
    ("T1", "T3"), ("T2", "T4"),
    ("R1", "R3"), ("R2", "R4"),
    ("C1", "C2"), ("C1", "C3"), ("C1", "C4"), ("C2", "C3"), ("C2", "C4"), ("C3", "C4"),
    ("C1", "T2"), ("C1", "T4"),
    ("C2", "T3"), ("C2", "T1"),
    ("C3", "T4"), ("C3", "T2"),
    ("C4", "T1"), ("C4", "T3"),
]}


def test_whitelist_matches_the_hand_written_table_for_every_pair():
    for a, b in itertools.product(ALL_MOVEMENTS, repeat=2):
        expected = a == b or frozenset((a, b)) in ALLOWED
        assert compatible(a, b) is expected, (a, b)


def test_there_are_twelve_movements_and_eighteen_allowed_pairs():
    assert len(ALL_MOVEMENTS) == 12
    assert len(ALLOWED) == 18


def test_compatibility_is_symmetric():
    for a, b in itertools.product(ALL_MOVEMENTS, repeat=2):
        assert compatible(a, b) is compatible(b, a)


def test_unknown_movements_are_rejected():
    for bad in ("T0", "T5", "X1", "", "t1", "T", "TT1", None):
        with pytest.raises((ValueError, TypeError)):
            compatible("T1", bad)  # type: ignore[arg-type]


def test_conflict_free_checks_every_pair_not_just_neighbours():
    assert conflict_free(["T1", "T3", "C2", "C4"])
    assert not conflict_free(["T1", "T3", "C1"])  # the crossing over leg 1 conflicts with T1
    assert not conflict_free(["T1", "T3", "T2"])
    assert conflict_free([])


@pytest.mark.parametrize("movements", [{"T1", "T2"}, {"T1", "R1"}, {"R1", "R2"}, {"T1", "T3", "C1"}, set()])
def test_a_phase_with_conflicting_or_no_movements_is_rejected(movements):
    with pytest.raises(ValueError):
        Phase("bad", frozenset(movements))


def test_a_phase_with_an_unknown_movement_is_rejected():
    with pytest.raises(ValueError):
        Phase("bad", frozenset({"T1", "Z9"}))


def test_the_through_only_plan_serves_every_approach_exactly_once():
    plan = build_plan(arrows=False)
    assert [p.name for p in plan] == ["T13", "T24"]
    assert sorted(a for p in plan for a in p.approaches()) == [1, 2, 3, 4]
    assert [p.approaches() for p in plan] == [(1, 3), (2, 4)]
    assert {p.kind for p in plan} == {"T"}


def test_the_default_plan_has_an_arrow_phase_before_each_through_phase_in_cycle_order():
    plan = build_plan()
    assert [p.name for p in plan] == ["T13", "R24", "T24", "R13"]
    assert [p.kind for p in plan] == ["T", "R", "T", "R"]
    # Circular order: R13, T13, R24, T24. Each arrow phase comes just before its through phase.
    names = [p.name for p in plan]
    for arrow, through in (("R13", "T13"), ("R24", "T24")):
        assert (names.index(arrow) + 1) % 4 == names.index(through)
    for kind in "TR":
        assert sorted(a for p in plan if p.kind == kind for a in p.approaches()) == [1, 2, 3, 4]


@pytest.mark.parametrize("movements", [{"T1", "T3", "C2"}, {"T1", "R3"}, {"C2", "C4"}, {"R1", "R3", "C1"}])
def test_a_phase_holds_only_through_or_only_arrow_movements(movements):
    with pytest.raises(ValueError):
        Phase("bad", frozenset(movements))


def test_opposite_and_shift_wrap_around_clockwise():
    assert [opposite(n) for n in (1, 2, 3, 4)] == [3, 4, 1, 2]
    assert [shift(n, 1) for n in (1, 2, 3, 4)] == [2, 3, 4, 1]
    assert [shift(n, 3) for n in (1, 2, 3, 4)] == [4, 1, 2, 3]


# The left arrows are not movements of a phase. This is the hand-written table for them and for every other movement.
from traffic_controller.phases import ARROWS  # noqa: E402

LEFT_ALLOWED = {frozenset(p) for p in [
    # The left arrows, from the swept paths of a bus on each movement. A left turn is compatible with another left turn, with the through
    # movements of its own approach and the one opposite, and with every right turn except the one from the opposite approach.
    ("L1", "L2"), ("L1", "L3"), ("L1", "L4"), ("L2", "L3"), ("L2", "L4"), ("L3", "L4"),
    ("L1", "T1"), ("L1", "T3"), ("L2", "T2"), ("L2", "T4"), ("L3", "T3"), ("L3", "T1"), ("L4", "T4"), ("L4", "T2"),
    ("L1", "R1"), ("L1", "R2"), ("L1", "R4"), ("L2", "R1"), ("L2", "R2"), ("L2", "R3"),
    ("L3", "R2"), ("L3", "R3"), ("L3", "R4"), ("L4", "R1"), ("L4", "R3"), ("L4", "R4"),
]}


def test_the_left_arrows_match_the_hand_written_table_for_every_pair():
    everything = list(ALL_MOVEMENTS) + list(ARROWS)
    for a, b in itertools.product(everything, repeat=2):
        if a[0] != "L" and b[0] != "L":
            continue
        expected = a == b or frozenset((a, b)) in LEFT_ALLOWED
        assert compatible(a, b) is expected, (a, b)
        assert compatible(b, a) is expected, (b, a)
    assert len(LEFT_ALLOWED) == 26
    assert len(ALLOWED) + len(LEFT_ALLOWED) == 44
