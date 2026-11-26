import pytest

from traffic_controller import Config


def test_defaults():
    cfg = Config()
    assert (cfg.default_green, cfg.yellow, cfg.all_red, cfg.min_green, cfg.max_green) == (10, 4, 2, 5, 60)
    assert (cfg.bike_time, cfg.bus_time, cfg.car_time, cfg.truck_time) == (2, 6, 4, 6)
    assert (cfg.lanes_per_approach, cfg.max_skips, cfg.count_ttl) == (2, 2, 10)


@pytest.mark.parametrize("field", [
    "default_green", "yellow", "min_green", "max_green", "lanes_per_approach",
    "bike_time", "bus_time", "car_time", "truck_time", "count_ttl",
])
@pytest.mark.parametrize("bad", [0, -1, 1.5, True, "5", None])
def test_positive_fields_reject_bad_values(field, bad):
    with pytest.raises(ValueError):
        Config(**{field: bad})


@pytest.mark.parametrize("field", ["all_red", "max_skips"])
def test_zero_is_allowed_for_all_red_and_max_skips(field):
    Config(**{field: 0})
    for bad in (-1, 1.5, True, "1", None):
        with pytest.raises(ValueError):
            Config(**{field: bad})


def test_max_green_below_min_green_is_rejected():
    with pytest.raises(ValueError):
        Config(min_green=10, max_green=5, default_green=5)


@pytest.mark.parametrize("default", [1, 61])
def test_default_green_must_lie_between_min_and_max(default):
    with pytest.raises(ValueError):
        Config(default_green=default)


def test_config_is_immutable():
    with pytest.raises(AttributeError):
        Config().yellow = 3  # type: ignore[misc]


def test_pedestrian_defaults():
    cfg = Config()
    assert (cfg.walk_min, cfg.walking_speed_cm_s, cfg.crossing_widths_cm) == (6, 120, (1280,) * 4)


def test_crossing_time_vectors(load_vectors):
    from traffic_controller.config import crossing_times
    for case in load_vectors("crossing_times.json")["cases"]:
        got = crossing_times(case["width_cm"], case["speed_cm_s"], case["yellow"])
        assert got == (case["total"], case["clearance_1"]), case["name"]


@pytest.mark.parametrize("bad", [(1280,) * 3, (1280,) * 5, [1280] * 4, (1280, 1280, 1280, 0),
                                 (1280, 1280, 1280, 1.5), (1280, 1280, 1280, True), "1280"])
def test_bad_crossing_widths_are_rejected(bad):
    with pytest.raises(ValueError):
        Config(crossing_widths_cm=bad)


@pytest.mark.parametrize("field", ["walk_min", "walking_speed_cm_s"])
@pytest.mark.parametrize("bad", [0, -1, 1.5, True, None])
def test_bad_pedestrian_numbers_are_rejected(field, bad):
    with pytest.raises(ValueError):
        Config(**{field: bad})


def test_a_crossing_that_cannot_fit_in_max_green_is_rejected():
    # 6 s walk plus 7 s of clearance 1 needs 13 s, more than a 12 s maximum.
    with pytest.raises(ValueError):
        Config(max_green=12)
    Config(max_green=13)
    # With the 6 s turn hold the same crossing needs 19 s.
    with pytest.raises(ValueError):
        Config(max_green=18, turn_hold=6)
    Config(max_green=19, turn_hold=6)
    with pytest.raises(ValueError):
        Config(turn_hold=-1)


def test_the_turn_hold_is_off_and_the_left_arrow_is_on_by_default():
    cfg = Config()
    assert (cfg.turn_hold, cfg.left_arrow) == (0, True)
    for bad in (1, 0, None, "yes"):
        with pytest.raises(ValueError):
            Config(left_arrow=bad)


def test_arrow_and_smoothing_defaults():
    cfg = Config()
    assert (cfg.max_arrow_green, cfg.smoothing_frames) == (15, 3)


@pytest.mark.parametrize("field", ["max_arrow_green", "smoothing_frames"])
@pytest.mark.parametrize("bad", [0, -1, 1.5, True, None])
def test_arrow_and_smoothing_fields_reject_bad_values(field, bad):
    with pytest.raises(ValueError):
        Config(**{field: bad})


def test_arrow_maximum_below_minimum_green_is_rejected():
    with pytest.raises(ValueError):
        Config(max_arrow_green=4)
    Config(max_arrow_green=5)


def test_bus_lane_defaults():
    cfg = Config()
    assert cfg.bus_lane_windows == ((0, 4, 420, 540), (0, 4, 960, 1080))
    assert (cfg.bus_extension, cfg.bus_early_green) == (5, True)


@pytest.mark.parametrize("bad", [-1, 1.5, True, None, "5"])
def test_bus_extension_rejects_bad_values(bad):
    with pytest.raises(ValueError):
        Config(bus_extension=bad)


def test_bus_extension_may_be_zero_and_early_green_must_be_a_bool():
    Config(bus_extension=0)
    for bad in (1, 0, None, "yes"):
        with pytest.raises(ValueError):
            Config(bus_early_green=bad)  # type: ignore[arg-type]


def test_an_empty_window_list_is_allowed():
    assert Config(bus_lane_windows=()).bus_lane_windows == ()
