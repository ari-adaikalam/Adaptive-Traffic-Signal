import itertools
import random

import pytest

from traffic_controller import ConflictError, FormatError, decode, encode
from traffic_controller.protocol import MOVEMENTS, crc8

# The pairs that may be active together, written out by hand (see test_phases).
ALLOWED = {frozenset(p) for p in [
    ("T1", "T3"), ("T2", "T4"), ("R1", "R3"), ("R2", "R4"),
    ("C1", "C2"), ("C1", "C3"), ("C1", "C4"), ("C2", "C3"), ("C2", "C4"), ("C3", "C4"),
    ("C1", "T2"), ("C1", "T4"), ("C2", "T3"), ("C2", "T1"), ("C3", "T4"), ("C3", "T2"),
    ("C4", "T1"), ("C4", "T3"),
    # The left arrows, from the swept paths of a bus on each movement. A left turn is compatible with another left turn, with the through
    # movements of its own approach and the one opposite, and with every right turn except the one from the opposite approach.
    ("L1", "L2"), ("L1", "L3"), ("L1", "L4"), ("L2", "L3"), ("L2", "L4"), ("L3", "L4"),
    ("L1", "T1"), ("L1", "T3"), ("L2", "T2"), ("L2", "T4"), ("L3", "T3"), ("L3", "T1"), ("L4", "T4"), ("L4", "T2"),
    ("L1", "R1"), ("L1", "R2"), ("L1", "R4"), ("L2", "R1"), ("L2", "R2"), ("L2", "R3"),
    ("L3", "R2"), ("L3", "R3"), ("L3", "R4"), ("L4", "R1"), ("L4", "R3"), ("L4", "R4"),
]}


def test_crc8_matches_the_standard_check_value():
    assert crc8(b"123456789") == 0xF4
    assert crc8(b"") == 0


def test_valid_lines_decode_and_encode_back(load_vectors):
    for case in load_vectors("protocol_v3.json")["valid"]:
        assert decode(case["line"]) == case["signals"], case["line"]
        assert decode(case["line"].encode()) == case["signals"], case["line"]
        assert encode(case["signals"]) == f"V3 {case['payload']} {case['line'].split()[2]}\n".encode()


def test_conflicting_lines_are_intact_but_unsafe(load_vectors):
    for case in load_vectors("protocol_v3.json")["conflict"]:
        with pytest.raises(ConflictError):
            decode(case["line"])


def test_damaged_lines_are_format_errors_not_conflicts(load_vectors):
    data = load_vectors("protocol_v3.json")
    for text in data["format"]:
        with pytest.raises(FormatError):
            decode(text)
        with pytest.raises(FormatError):
            decode(text.encode("latin-1"))
    for raw in data["format_bytes"]:
        with pytest.raises(FormatError):
            decode(bytes(raw))


def test_encode_refuses_what_decode_would_refuse(load_vectors):
    for case in load_vectors("protocol_v3.json")["encode_refuses"]:
        with pytest.raises((ValueError, ConflictError)):
            encode(case["signals"])


def test_the_two_error_kinds_are_distinct_but_both_are_value_errors():
    assert issubclass(FormatError, ValueError) and issubclass(ConflictError, ValueError)
    assert not issubclass(FormatError, ConflictError) and not issubclass(ConflictError, FormatError)


def test_a_single_flipped_character_is_always_noticed(load_vectors):
    """CRC-8 detects every single-character change in the 12 character payload."""
    for case in load_vectors("protocol_v3.json")["valid"]:
        text = case["line"].rstrip("\r\n")
        for i in range(3, 15):
            for ch in "RYGFSWC":
                if ch == text[i]:
                    continue
                changed = text[:i] + ch + text[i + 1:]
                try:
                    decode(changed)
                except (FormatError, ConflictError):
                    continue
                raise AssertionError(f"undetected change at {i} of {text!r}")


def _lit(signals):
    return [m for m in MOVEMENTS if signals[m] in ("green", "yellow", "walk", "clear")]


def test_random_states_are_accepted_exactly_when_the_hand_written_table_allows_them():
    rng = random.Random(5)
    # Mostly red and stop, so a fair share of the states are safe.
    vehicle = ("red",) * 10 + ("yellow", "green", "flash")
    ped = ("stop",) * 5 + ("walk", "clear")
    accepted = refused = 0
    for _ in range(30000):
        signals = {m: rng.choice(ped if m[0] == "C" else vehicle) for m in MOVEMENTS}
        flashing = [signals[m] for m in MOVEMENTS if m[0] != "C"]
        lit = _lit(signals)
        consistent = ("flash" not in flashing or (all(s == "flash" for s in flashing)
                      and all(signals[m] == "stop" for m in MOVEMENTS if m[0] == "C")))
        allowed = consistent and all(frozenset((a, b)) in ALLOWED for a, b in itertools.combinations(lit, 2))
        try:
            decoded = decode(encode(signals))
            assert decoded == signals
            accepted += 1
            assert allowed
        except ConflictError:
            refused += 1
            assert not allowed
    assert accepted > 100 and refused > 100


def test_the_all_red_and_all_flash_lines_are_exact():
    red = {m: ("stop" if m[0] == "C" else "red") for m in MOVEMENTS}
    flash = {m: ("stop" if m[0] == "C" else "flash") for m in MOVEMENTS}
    assert encode(red) == b"V3 RRRRRRRRRRRRSSSS " + f"{crc8(b'RRRRRRRRRRRRSSSS'):02X}".encode() + b"\n"
    assert encode(flash) == b"V3 FFFFFFFFFFFFSSSS " + f"{crc8(b'FFFFFFFFFFFFSSSS'):02X}".encode() + b"\n"


def test_every_line_fits_the_length_limit():
    signals = {m: "red" for m in MOVEMENTS}
    signals.update({"T1": "yellow", "T3": "yellow", "C2": "clear", "C4": "clear", "C1": "stop", "C3": "stop"})
    assert len(encode(signals)) <= 24
