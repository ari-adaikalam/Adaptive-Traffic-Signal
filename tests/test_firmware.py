"""The firmware's safety monitor is C++. It is compiled here and held to the Python reference.

What this proves: the C++ parse and monitor logic gives the same answer as the Python one on
every vector, on thousands of damaged and random lines, and on long random streams. What it does
not prove: that the sketch compiles for a board, fits in its memory or drives real lamps. The
sketch is only syntax checked here.
"""

import itertools
import json
import random
import shutil
import subprocess
from pathlib import Path

import pytest

from traffic_controller import ConflictError, Controller, FormatError, build_plan, decode, encode
from traffic_controller.monitor import Monitor
from traffic_controller.protocol import MOVEMENTS, crc8, with_arrows

ROOT = Path(__file__).resolve().parent.parent
FIRMWARE = ROOT / "firmware"
COMPILER = shutil.which("g++") or shutil.which("clang++")
pytestmark = pytest.mark.skipif(COMPILER is None, reason="no C++ compiler on this machine")

CODES = {"red": "R", "yellow": "Y", "green": "G", "flash": "F", "stop": "S", "walk": "W", "clear": "C"}
STATE_NAMES = {0: "run", 1: "fault", 2: "recover"}
RESULT = {"ok": 0, "format": 1, "conflict": 2}


def hexed(data: bytes) -> str:
    return data.hex() if data else "-"


def code(signals) -> str:
    return "".join(CODES[signals[m]] for m in MOVEMENTS)


@pytest.fixture(scope="session")
def runner(tmp_path_factory):
    binary = tmp_path_factory.mktemp("firmware") / "monitor_runner"
    subprocess.run([COMPILER, "-std=c++11", "-O1", "-Wall", "-Wextra", "-Werror",
                    str(FIRMWARE / "test" / "monitor_runner.cpp"), "-o", str(binary)], check=True)

    def run(commands):
        done = subprocess.run([str(binary)], input="\n".join(commands) + "\n", text=True,
                              capture_output=True, check=True)
        return done.stdout.splitlines()
    return run


def python_parse(line: bytes):
    try:
        return "ok", code(decode(line))
    except FormatError:
        return "format", "-"
    except ConflictError:
        return "conflict", "-"


def check_parse_parity(runner, lines):
    out = runner([f"PARSE {hexed(line)}" for line in lines])
    assert len(out) == len(lines)
    for line, got in zip(lines, out):
        _, result, payload = got.split(" ")
        kind, expected = python_parse(line)
        assert (int(result), payload) == (RESULT[kind], expected), f"{line!r}: C++ said {got}, Python said {kind}"


def test_every_protocol_vector_is_read_the_same_way(runner, load_vectors):
    data = load_vectors("protocol_v3.json")
    lines = [c["line"].encode() for c in data["valid"] + data["conflict"]]
    lines += [t.encode("latin-1") for t in data["format"]] + [bytes(r) for r in data["format_bytes"]]
    check_parse_parity(runner, lines)
    out = runner([f"PARSE {hexed(c['line'].encode())}" for c in data["valid"]])
    assert all(o.split()[1] == "0" for o in out)
    out = runner([f"PARSE {hexed(c['line'].encode())}" for c in data["conflict"]])
    assert all(o.split()[1] == "2" for o in out)


def test_thousands_of_damaged_lines_are_read_the_same_way(runner, load_vectors):
    lines = [t.encode("latin-1") for t in load_vectors("protocol_v3.json")["fuzz_lines"]]
    check_parse_parity(runner, lines)
    kinds = {python_parse(line)[0] for line in lines}
    assert kinds == {"ok", "format", "conflict"}, "the damaged lines should reach every outcome"


def test_random_framed_states_are_classified_the_same_way(runner):
    rng = random.Random(21)
    vehicle, ped = "R" * 10 + "YGF", "S" * 5 + "WC"
    lines = []
    for _ in range(30000):
        payload = "".join(rng.choice(ped if i >= 12 else vehicle) for i in range(16))
        lines.append(f"V3 {payload} {crc8(payload.encode()):02X}\n".encode())
    check_parse_parity(runner, lines)
    kinds = [python_parse(line)[0] for line in lines]
    assert kinds.count("ok") > 100 and kinds.count("conflict") > 100


def test_every_pair_of_signals_is_allowed_or_refused_the_same_way(runner):
    """All 120 pairs, lit on their own, against the hand-written table and the Python code."""
    allowed = {frozenset(p) for p in [
        ("T1", "T3"), ("T2", "T4"), ("R1", "R3"), ("R2", "R4"),
        ("C1", "C2"), ("C1", "C3"), ("C1", "C4"), ("C2", "C3"), ("C2", "C4"), ("C3", "C4"),
        ("C1", "T2"), ("C1", "T4"), ("C2", "T3"), ("C2", "T1"), ("C3", "T4"), ("C3", "T2"),
        ("C4", "T1"), ("C4", "T3"),
        ("L1", "L2"), ("L1", "L3"), ("L1", "L4"), ("L2", "L3"), ("L2", "L4"), ("L3", "L4"),
        ("L1", "T1"), ("L1", "T3"), ("L2", "T2"), ("L2", "T4"), ("L3", "T3"), ("L3", "T1"), ("L4", "T4"), ("L4", "T2"),
        ("L1", "R1"), ("L1", "R2"), ("L1", "R4"), ("L2", "R1"), ("L2", "R2"), ("L2", "R3"),
        ("L3", "R2"), ("L3", "R3"), ("L3", "R4"), ("L4", "R1"), ("L4", "R3"), ("L4", "R4")]}
    lines, expect = [], []
    for a, b in itertools.combinations(range(16), 2):
        chars = ["R"] * 12 + ["S"] * 4
        for i in (a, b):
            chars[i] = "W" if i >= 12 else "G"
        payload = "".join(chars)
        lines.append(f"V3 {payload} {crc8(payload.encode()):02X}\n".encode())
        expect.append(frozenset((MOVEMENTS[a], MOVEMENTS[b])) in allowed)
    out = runner([f"PARSE {hexed(line)}" for line in lines])
    assert [o.split()[1] == "0" for o in out] == expect
    assert sum(expect) == 44


def _monitor_commands(settings, seconds):
    commands = [f"NEW {settings['watchdog_s']} {settings['recover_messages']} {settings['recover_all_red_s']}"]
    for lines in seconds:
        commands += [f"LINE {hexed(line if isinstance(line, bytes) else line.encode())}" for line in lines]
        commands.append("TICK")
    return commands


def _python_monitor(settings, seconds):
    monitor = Monitor(**settings)
    results, ticks = [], []
    for lines in seconds:
        for line in lines:
            results.append(RESULT[monitor.receive(line)])
        out = monitor.tick()
        ticks.append((out.state, code(out.signals)))
    return results, ticks


def _cpp_monitor(runner, settings, seconds):
    out = runner(_monitor_commands(settings, seconds))
    results = [int(o.split()[1]) for o in out if o.startswith("L")]
    ticks = [(STATE_NAMES[int(o.split()[1])], o.split()[2]) for o in out if o.startswith("T")]
    return results, ticks


def test_the_cpp_monitor_follows_every_hand_worked_scenario(runner, load_vectors):
    for scenario in load_vectors("monitor_scenarios.json"):
        _, ticks = _cpp_monitor(runner, scenario["settings"], scenario["seconds"])
        for want in scenario["expect"]:
            assert ticks[want["second"]] == (want["state"], want["display"]), \
                f"{scenario['name']}, second {want['second']}"


def test_the_cpp_monitor_matches_the_python_reference_on_every_scenario(runner, load_vectors):
    for scenario in load_vectors("monitor_scenarios.json"):
        py = _python_monitor(scenario["settings"], scenario["seconds"])
        cpp = _cpp_monitor(runner, scenario["settings"], scenario["seconds"])
        assert cpp == py, scenario["name"]


def _random_stream(seed, seconds=4000):
    """Lines from a real controller, with losses, damage, bursts of silence and unsafe lines."""
    rng = random.Random(seed)
    controller = Controller(plan=build_plan(), power_on=True)
    unsafe = f"V3 GGRRRRRRRRRRSSSS {crc8(b'GGRRRRRRRRRRSSSS'):02X}\n".encode()
    silent_until = -1
    stream = []
    for second in range(seconds):
        line = encode(with_arrows(*(lambda t: (t.signals, t.arrows))(controller.tick())))
        lines = []
        if second > silent_until:
            if rng.random() < 0.08:
                silent_until = second + rng.randint(1, 6)
            elif rng.random() < 0.10:
                pass  # this line is lost
            else:
                lines.append(line)
                if rng.random() < 0.10:
                    damaged = bytearray(line)
                    damaged[rng.randrange(len(damaged))] = rng.randrange(256)
                    lines.insert(rng.randrange(2), bytes(damaged))
                if rng.random() < 0.10:
                    lines.append(line)  # a repeat in the same second
                if rng.random() < 0.02:
                    lines.insert(rng.randrange(len(lines) + 1), unsafe)
        stream.append(lines)
    return stream


@pytest.mark.parametrize("settings", [
    {"watchdog_s": 3, "recover_messages": 3, "recover_all_red_s": 3},
    {"watchdog_s": 2, "recover_messages": 1, "recover_all_red_s": 0},
    {"watchdog_s": 5, "recover_messages": 2, "recover_all_red_s": 1},
])
def test_the_cpp_monitor_matches_the_python_reference_on_long_random_streams(runner, settings):
    for seed in (1, 2, 3):
        seconds = _random_stream(seed)
        py = _python_monitor(settings, seconds)
        cpp = _cpp_monitor(runner, settings, seconds)
        assert cpp == py, f"seed {seed}"
        states = {state for state, _ in py[1]}
        wanted = {"run", "fault"} | ({"recover"} if settings["recover_all_red_s"] else set())
        assert states == wanted, "the stream should visit every state the settings allow"


def _expected_lamps(payload: str, blink: bool) -> int:
    """The lamp map written out from its description, not from the C++ code."""
    bits = 0
    for i in range(12):
        offset = {"R": 0, "Y": 1, "G": 2}.get(payload[i])
        if offset is not None:
            bits |= 1 << (3 * i + offset)
        if payload[i] == "F" and blink:
            bits |= 1 << (3 * i)
    for j in range(4):
        base = 36 + 2 * j
        if payload[12 + j] == "S":
            bits |= 1 << base
        elif payload[12 + j] == "W":
            bits |= 1 << (base + 1)
        elif payload[12 + j] == "C" and blink:
            bits |= 1 << base
    return bits


def test_the_lamp_map_matches_its_description(runner):
    rng = random.Random(8)
    cases = ["RRRRRRRRRRRRSSSS", "GRGRRRRRRRRRSWSW", "YRYRRRRRRRRRSCSC", "FFFFFFFFFFFFSSSS", "RGRGRRRRRRRRWSWS", "RRRRRGRGGRGRSSSS", "RRRRRYRYYRYRSSSS"]
    cases += ["".join(rng.choice("RYGF" if i < 12 else "SWC") for i in range(16)) for _ in range(800)]
    commands = [f"LAMPS {c} {blink}" for c in cases for blink in (0, 1)]
    out = runner(commands)
    wanted = [_expected_lamps(c, bool(blink)) for c in cases for blink in (0, 1)]
    assert [int(o.split()[1], 16) for o in out] == wanted


def test_the_lamp_map_by_hand_for_one_line(runner):
    # T1 green is bit 2, T2 red is bit 3, T3 green is bit 8, T4 red is bit 9, R1..R4 red are bits 12, 15, 18, 21, L1..L4 red are bits
    # 24, 27, 30, 33, crossing 1 red man is bit 36, crossing 2 green man bit 39, crossing 3 red man bit 40, crossing 4 green man bit 43.
    reds = sum(1 << b for b in (3, 9, 12, 15, 18, 21, 24, 27, 30, 33))
    expected = (1 << 2) | (1 << 8) | reds | (1 << 36) | (1 << 39) | (1 << 40) | (1 << 43)
    assert int(runner(["LAMPS GRGRRRRRRRRRSWSW 1"])[0].split()[1], 16) == expected


def test_a_left_arrow_lights_its_own_three_lamps_and_nothing_else(runner):
    # L2 green is bit 3*9 + 2 = 29 and L4 yellow is bit 3*11 + 1 = 34. Everything else in the vehicle block is red.
    reds = {3 * i for i in range(12)} - {3 * 9, 3 * 11}
    expected = sum(1 << b for b in reds) | (1 << 29) | (1 << 34) | sum(1 << (36 + 2 * j) for j in range(4))
    line = "RRRRRRRRRGRYSSSS"
    assert int(runner([f"LAMPS {line} 0"])[0].split()[1], 16) == expected


def test_the_sketch_passes_a_syntax_check_against_a_minimal_arduino_api():
    sketch = FIRMWARE / "traffic_firmware" / "traffic_firmware.ino"
    shim = FIRMWARE / "test" / "arduino_shim"
    done = subprocess.run([COMPILER, "-std=c++11", "-fsyntax-only", "-Wall", "-Wextra", "-Werror", "-x", "c++",
                           "-I", str(shim), "-I", str(sketch.parent), "-include", "Arduino.h", str(sketch)],
                          capture_output=True, text=True)
    assert done.returncode == 0, done.stderr


def test_every_state_the_controller_reaches_with_the_page_rules_is_a_safe_line_both_parsers_accept(runner):
    import test_controller_fuzz as fuzz

    lines = set()
    for seed in range(100, 112):
        _, _, snapshots, _ = fuzz.drive(seed, extended=True)
        for snap in snapshots:
            lines.add(encode(with_arrows(snap.signals, snap.arrows)))
    assert len(lines) > 30
    for line in lines:
        decode(line)
    check_parse_parity(runner, sorted(lines))
