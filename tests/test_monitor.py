import json
from pathlib import Path

import pytest

from traffic_controller import Controller, build_plan, decode, encode
from traffic_controller.monitor import FAULT, RECOVER, RUN, Monitor
from traffic_controller.protocol import MOVEMENTS, with_arrows

SCENARIOS = json.loads((Path(__file__).parent / "vectors" / "monitor_scenarios.json").read_text())
CODES = {"red": "R", "yellow": "Y", "green": "G", "flash": "F", "stop": "S", "walk": "W", "clear": "C"}


def code(signals):
    return "".join(CODES[signals[m]] for m in MOVEMENTS)


def play(settings, seconds):
    monitor = Monitor(**settings)
    return [(monitor.tick() if [monitor.receive(line) for line in lines] is not None else None) for lines in seconds]


@pytest.mark.parametrize("scenario", SCENARIOS, ids=[s["name"] for s in SCENARIOS])
def test_scenario(scenario):
    outputs = play(scenario["settings"], scenario["seconds"])
    for want in scenario["expect"]:
        got = outputs[want["second"]]
        assert (got.state, code(got.signals)) == (want["state"], want["display"]), f"second {want['second']}"


def test_receive_reports_what_it_did_with_each_line():
    monitor = Monitor()
    good = encode({m: ("stop" if m[0] == "C" else "red") for m in MOVEMENTS})
    assert monitor.receive(good) == "ok"
    assert monitor.receive(good[:-3]) == "format"
    conflict = good.replace(b"RRRRRRRRRRRRSSSS", b"GGRRRRRRRRRRSSSS")
    from traffic_controller.protocol import crc8
    conflict = b"V3 GGRRRRRRRRRRSSSS " + f"{crc8(b'GGRRRRRRRRRRSSSS'):02X}".encode() + b"\n"
    assert monitor.receive(conflict) == "conflict"


@pytest.mark.parametrize("name,value", [("watchdog_s", 0), ("watchdog_s", True), ("recover_messages", 0),
                                         ("recover_all_red_s", -1), ("recover_all_red_s", 1.5)])
def test_bad_settings_are_rejected(name, value):
    with pytest.raises(ValueError):
        Monitor(**{name: value})


def test_a_monitor_is_never_lit_in_conflict_whatever_the_line_stream():
    """Feed random damage into a real controller's lines and check what the lamps would show."""
    import random
    from traffic_controller.protocol import ConflictError, FormatError
    rng = random.Random(9)
    controller = Controller(plan=build_plan(), power_on=True)
    monitor = Monitor()
    for _ in range(600):
        line = bytearray(encode(with_arrows(*(lambda t: (t.signals, t.arrows))(controller.tick()))))
        roll = rng.random()
        if roll < 0.1:
            continue  # the line is lost
        if roll < 0.2:
            line[rng.randrange(len(line))] = rng.randrange(256)  # one byte damaged
        monitor.receive(bytes(line))
        out = monitor.tick()
        lit = [m for m in MOVEMENTS if out.signals[m] in ("green", "yellow", "walk", "clear")]
        from traffic_controller import conflict_free
        assert conflict_free(lit)
        assert out.state in (RUN, FAULT, RECOVER)
        if out.state != RUN:
            assert all(out.signals[m] in ("flash", "red", "stop") for m in MOVEMENTS)
        _ = (ConflictError, FormatError)


def test_the_lamps_never_go_from_a_fault_straight_to_a_steady_signal():
    """After flashing the monitor always shows all red before it follows the host."""
    import random
    rng = random.Random(3)
    controller = Controller(plan=build_plan(), power_on=True)
    monitor = Monitor()
    previous = None
    for _ in range(1500):
        line = encode(with_arrows(*(lambda t: (t.signals, t.arrows))(controller.tick())))
        if rng.random() < 0.15:
            continue
        monitor.receive(line)
        out = monitor.tick()
        if previous is not None and previous.state == FAULT and out.state != FAULT:
            assert out.state == RECOVER and all(out.signals[m] in ("red", "stop") for m in MOVEMENTS)
        previous = out
