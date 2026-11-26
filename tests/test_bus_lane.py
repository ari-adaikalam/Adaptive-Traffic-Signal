import pytest

from traffic_controller import Config
from traffic_controller.bus_lane import WEEK_SECONDS, check_window, is_active


def _windows(raw):
    return tuple(tuple(w) for w in raw)


def test_default_windows_follow_the_schedule(load_vectors):
    data = load_vectors("bus_lane.json")
    windows = _windows(data["default_windows"])
    assert windows == Config().bus_lane_windows
    for case in data["cases"]:
        assert is_active(windows, case["second"]) is case["expect"], case["name"]


def test_custom_windows(load_vectors):
    for case in load_vectors("bus_lane.json")["custom"]:
        assert is_active(_windows(case["windows"]), case["second"]) is case["expect"], case["name"]


def test_invalid_windows_are_rejected(load_vectors):
    for raw in load_vectors("bus_lane.json")["invalid_windows"]:
        with pytest.raises(ValueError):
            check_window(tuple(raw))
        with pytest.raises(ValueError):
            Config(bus_lane_windows=(tuple(raw),))


@pytest.mark.parametrize("window", [[0, 4, 420, 540], "0,4,420,540", None, 5])
def test_a_window_must_be_a_tuple_of_four(window):
    with pytest.raises(ValueError):
        check_window(window)


def test_windows_must_be_a_tuple():
    with pytest.raises(ValueError):
        Config(bus_lane_windows=[(0, 4, 420, 540)])  # type: ignore[arg-type]


def test_invalid_clock_values_are_rejected(load_vectors):
    for second in load_vectors("bus_lane.json")["invalid_seconds"]:
        with pytest.raises(ValueError):
            is_active(Config().bus_lane_windows, second)


def test_the_schedule_repeats_every_week():
    windows = Config().bus_lane_windows
    for second in range(0, WEEK_SECONDS, 997):
        assert is_active(windows, second) is is_active(windows, second + 3 * WEEK_SECONDS)


def test_the_bus_lane_is_active_for_exactly_four_hours_on_each_weekday_and_never_at_the_weekend():
    windows = Config().bus_lane_windows
    active = sum(is_active(windows, s) for s in range(0, WEEK_SECONDS, 60))
    assert active == 5 * 4 * 60
