"""Hand-written scenarios from tests/vectors/controller_scenarios.json.

Time t is the snapshot after t ticks. Events at t run after snapshot t exists and
before the next tick. Only the fields named in an expectation are checked.
"""

import json
from pathlib import Path

import pytest

from traffic_controller import Config, Controller, VehicleCounts, build_plan

VECTORS = Path(__file__).parent / "vectors"
SCENARIOS = (json.loads((VECTORS / "controller_scenarios.json").read_text())
             + json.loads((VECTORS / "controller_pedestrian_scenarios.json").read_text())
             + json.loads((VECTORS / "controller_arrow_scenarios.json").read_text())
             + json.loads((VECTORS / "controller_emergency_scenarios.json").read_text())
             + json.loads((VECTORS / "controller_bus_scenarios.json").read_text())
             + json.loads((VECTORS / "controller_mode_scenarios.json").read_text()))


@pytest.mark.parametrize("scenario", SCENARIOS, ids=[s["name"] for s in SCENARIOS])
def test_scenario(scenario):
    config = dict(scenario["config"])
    plan = build_plan(arrows=config.pop("plan", "arrows") != "through_only")
    if "crossing_widths_cm" in config:
        config["crossing_widths_cm"] = tuple(config["crossing_widths_cm"])
    controller = Controller(Config(**config), plan=plan, clock_start_s=scenario.get("clock_start_s", 0),
                            power_on=scenario.get("power_on", False))
    events: dict[int, list] = {}
    for event in scenario["events"]:
        events.setdefault(event["t"], []).append(event)
    expected = {e["t"]: e for e in scenario["expect"]}
    last = max(expected)

    snapshot = controller.snapshot
    for t in range(last + 1):
        if t in expected:
            for key, value in expected[t].items():
                if key == "t":
                    continue
                actual = getattr(snapshot, key)
                if key == "signals":  # only the named signals are checked
                    actual = {name: actual[name] for name in value}
                if isinstance(actual, tuple):
                    actual = list(actual)
                assert actual == value, f"t={t} {key}: expected {value!r}, got {actual!r}"
        for event in events.get(t, []):
            if "request" in event:
                assert controller.request_crossing(event["request"]) is event.get("result", True)
                continue
            if "fault" in event:
                assert controller.fault(event["fault"]) is event["result"]
                continue
            if "clear_fault" in event:
                assert controller.clear_fault() is event["result"]
                continue
            if "mode" in event:
                controller.set_mode(event["mode"])
                continue
            if "pause" in event:
                assert controller.pause(event["pause"]["vehicle"], event["pause"]["approach"]) is event["result"]
                continue
            if "resume" in event:
                assert controller.resume(event["resume"]) is event["result"]
                continue
            counts = event["report"]["counts"]
            report = {"right": controller.report_right_counts, "bus": controller.report_bus_counts,
                      "left": controller.report_left_counts}.get(
                event["report"].get("lane"), controller.report_counts)
            report(event["report"]["approach"], None if counts is None else VehicleCounts(**counts))
        if t < last:
            snapshot = controller.tick()
