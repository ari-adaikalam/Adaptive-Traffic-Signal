import math

import pytest

from traffic_controller import lane_for_position, parse_zones, point_in_polygon


def test_point_vectors(load_vectors):
    for case in load_vectors("geofence.json")["points"]:
        assert point_in_polygon(case["lon"], case["lat"], case["ring"]) is case["expect"], case["name"]


def test_invalid_input_vectors(load_vectors):
    for case in load_vectors("geofence.json")["invalid_points"]:
        with pytest.raises(ValueError):
            point_in_polygon(case["lon"], case["lat"], case["ring"])


@pytest.mark.parametrize("bad", [math.nan, math.inf, -math.inf])
def test_non_finite_numbers_are_rejected(bad):
    ring = [[0, 0], [1, 0], [1, 1]]
    with pytest.raises(ValueError):
        point_in_polygon(bad, 0, ring)
    with pytest.raises(ValueError):
        point_in_polygon(0, 0, [[0, 0], [1, 0], [bad, 1]])


def test_lane_lookup_on_the_real_intersection(load_vectors):
    data = load_vectors("geofence.json")
    zones = parse_zones(data["intersection"])
    for case in data["lanes"]:
        assert lane_for_position(case["lon"], case["lat"], zones) == case["expect"], case["name"]


def test_lowest_lane_wins_an_overlap():
    big = [[0, 0], [10, 0], [10, 10], [0, 10]]
    small = [[2, 2], [4, 2], [4, 4], [2, 4]]
    assert lane_for_position(3, 3, {2: small, 1: big}) == 1
    assert lane_for_position(3, 3, {2: small}) == 2


def test_bad_zone_keys_are_rejected(load_vectors):
    ring = [[0, 0], [1, 0], [1, 1]]
    for key in load_vectors("geofence.json")["bad_zone_keys"]:
        with pytest.raises(ValueError):
            parse_zones({key: ring})


def test_empty_zone_set_matches_nothing():
    assert lane_for_position(0, 0, {}) is None
