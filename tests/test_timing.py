import pytest

from traffic_controller import Config, VehicleCounts, counts_from_class_ids, green_time


def test_green_time_vectors(load_vectors):
    data = load_vectors("green_time.json")
    for case in data["valid"]:
        cfg = Config(**case.get("config", {}))
        assert green_time(VehicleCounts(**case["counts"]), cfg) == case["expect"], case["name"]


def test_invalid_counts_vectors(load_vectors):
    for case in load_vectors("green_time.json")["invalid"]:
        with pytest.raises(ValueError):
            VehicleCounts(**case["counts"])


def test_arrow_green_vectors(load_vectors):
    from traffic_controller.timing import arrow_green_time
    for case in load_vectors("green_time.json")["arrow"]:
        cfg = Config(**case.get("config", {}))
        assert arrow_green_time(VehicleCounts(**case["counts"]), cfg) == case["expect"], case["name"]


def test_median_vectors(load_vectors):
    from traffic_controller.timing import median_counts
    data = load_vectors("green_time.json")["median"]
    for case in data["valid"]:
        got = median_counts([VehicleCounts(**r) for r in case["reports"]])
        assert got == VehicleCounts(**case["expect"]), case["name"]
    for reports in data["invalid"]:
        with pytest.raises(ValueError):
            median_counts([VehicleCounts(**r) for r in reports])


def test_median_never_exceeds_the_largest_report_or_drops_below_the_smallest():
    from traffic_controller.timing import median_counts
    import random
    rng = random.Random(3)
    for _ in range(300):
        reports = [VehicleCounts(cars=rng.randint(0, 40), buses=rng.randint(0, 9)) for _ in range(rng.randint(1, 6))]
        m = median_counts(reports)
        assert min(r.cars for r in reports) <= m.cars <= max(r.cars for r in reports)
        assert min(r.buses for r in reports) <= m.buses <= max(r.buses for r in reports)


def test_lane_override_vectors(load_vectors):
    data = load_vectors("green_time.json")["lanes"]
    for case in data["valid"]:
        got = green_time(VehicleCounts(**case["counts"]), Config(), case["lanes"])
        assert got == case["expect"], case["name"]
    for bad in data["invalid"]:
        with pytest.raises(ValueError):
            green_time(VehicleCounts(cars=4), Config(), bad)


def test_bus_lane_green_vectors(load_vectors):
    from traffic_controller.timing import bus_lane_green_time
    for case in load_vectors("green_time.json")["bus_lane"]:
        cfg = Config(**case.get("config", {}))
        assert bus_lane_green_time(VehicleCounts(**case["counts"]), cfg) == case["expect"], case["name"]


def test_class_id_vectors(load_vectors):
    data = load_vectors("green_time.json")["class_ids"]
    for case in data["valid"]:
        assert counts_from_class_ids(case["ids"]) == VehicleCounts(**case["expect"])
    for ids in data["invalid"]:
        with pytest.raises(ValueError):
            counts_from_class_ids(ids)


def test_green_time_never_leaves_the_allowed_range():
    cfg = Config()
    for cars in range(0, 200, 7):
        for trucks in range(0, 100, 11):
            seconds = green_time(VehicleCounts(cars=min(cars, 1000), trucks=trucks), cfg)
            assert cfg.min_green <= seconds <= cfg.max_green


def test_green_time_never_decreases_when_a_vehicle_is_added():
    cfg = Config()
    base = VehicleCounts(bikes=1, buses=1, cars=2, trucks=1)
    for field in ("bikes", "buses", "cars", "trucks"):
        more = VehicleCounts(**{**base.__dict__, field: getattr(base, field) + 1})
        assert green_time(more, cfg) >= green_time(base, cfg)


def test_numpy_style_ints_are_accepted_as_class_ids():
    class FakeNumpyInt:
        def __index__(self):
            return 2
    assert counts_from_class_ids([FakeNumpyInt()]).cars == 1
