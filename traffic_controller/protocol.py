"""Serial line between the host and the signal controller, version 3.

One line: ``V3 <16 characters> <2 hex digits>`` and a newline, for example
``V3 GRGRRRRRRRRRSWSW 5A``. The 16 characters are the signals T1 to T4, R1 to R4,
L1 to L4 and C1 to C4, in that order. L is the left turn arrow of an approach.

  vehicle and arrow signals   R red, Y yellow, G green, F flashing red
  pedestrian signals          S solid red man, W walk, C flashing red man

The two hex digits are the CRC-8 (polynomial 0x07, initial value 0) of the 16
characters, in upper case. Either all twelve vehicle and arrow signals flash, with every pedestrian signal solid red, or none do.

A damaged line raises FormatError and is meant to be ignored. A line that is intact
but asks for something unsafe raises ConflictError, which the receiving side treats
as a fault.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from .phases import ARROWS, conflict_free

PREFIX = "V3 "
SIGNALS = 16
MAX_LINE_BYTES = 24  # "V3 " + 16 + " " + 2 + "\r\n"
VEHICLE_WORDS = {"red": "R", "yellow": "Y", "green": "G", "flash": "F"}
PEDESTRIAN_WORDS = {"stop": "S", "walk": "W", "clear": "C"}

MOVEMENTS = tuple(f"{kind}{n}" for kind in "TRLC" for n in range(1, 5))
assert MOVEMENTS[8:12] == ARROWS


class FormatError(ValueError):
    """The line is damaged or not a version 2 line."""


class ConflictError(ValueError):
    """The line is intact but its signals are unsafe."""


def crc8(data: bytes) -> int:
    """CRC-8 with polynomial 0x07 and initial value 0. The check value of b"123456789" is 0xF4."""
    crc = 0
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = ((crc << 1) ^ 0x07) & 0xFF if crc & 0x80 else (crc << 1) & 0xFF
    return crc


def _codes(movement: str) -> dict[str, str]:
    return PEDESTRIAN_WORDS if movement[0] == "C" else VEHICLE_WORDS


def check_safe(signals: Mapping[str, str]) -> None:
    """Raise ConflictError unless the signals are consistent and conflict free.

    Every vehicle signal, including the arrows, is a vehicle signal: they all flash together, or none do."""
    vehicle = [signals[m] for m in MOVEMENTS if m[0] != "C"]
    if "flash" in vehicle:
        if any(state != "flash" for state in vehicle):
            raise ConflictError("flashing and steady signals are mixed")
        if any(signals[m] != "stop" for m in MOVEMENTS if m[0] == "C"):
            raise ConflictError("a pedestrian signal is active while the vehicle signals flash")
    lit = [m for m in MOVEMENTS if signals[m] in ("green", "yellow", "walk", "clear")]
    if not conflict_free(lit):
        raise ConflictError("lit signals conflict")


def encode(signals: Mapping[str, str]) -> bytes:
    """Build a line. Refuses anything that decode would not accept."""
    if set(signals) != set(MOVEMENTS):
        raise ValueError("need exactly the 16 signals T1 to T4, R1 to R4, L1 to L4, C1 to C4")
    payload = ""
    for movement in MOVEMENTS:
        words = _codes(movement)
        state = signals[movement]
        if not isinstance(state, str) or state not in words:
            raise ValueError(f"signal {movement} cannot be {state!r}")
        payload += words[state]
    check_safe(signals)
    return f"{PREFIX}{payload} {crc8(payload.encode('ascii')):02X}\n".encode("ascii")


def decode(line: bytes | str) -> dict[str, str]:
    """Parse one received line into the 16 signals. Strict about every character."""
    if len(line) > MAX_LINE_BYTES:
        raise FormatError("line too long")
    if isinstance(line, bytes):
        try:
            text = line.decode("ascii")
        except UnicodeDecodeError as exc:
            raise FormatError("line is not ascii") from exc
    else:
        text = line
    if text.endswith("\r\n"):
        text = text[:-2]
    elif text.endswith("\n"):
        text = text[:-1]
    if len(text) != len(PREFIX) + SIGNALS + 1 + 2 or not text.startswith(PREFIX) or text[3 + SIGNALS] != " ":
        raise FormatError("not a version 3 line")
    payload, crc_text = text[3:3 + SIGNALS], text[4 + SIGNALS:]
    if any(ch not in "0123456789ABCDEF" for ch in crc_text):
        raise FormatError("the checksum is not two upper case hex digits")
    signals: dict[str, str] = {}
    for movement, ch in zip(MOVEMENTS, payload):
        words = {code: word for word, code in _codes(movement).items()}
        if ch not in words:
            raise FormatError(f"{ch!r} is not a state of {movement}")
        signals[movement] = words[ch]
    if int(crc_text, 16) != crc8(payload.encode("ascii")):
        raise FormatError("checksum mismatch")
    check_safe(signals)
    return signals


def with_arrows(signals: Mapping[str, str], arrows: Sequence[str]) -> dict[str, str]:
    """The 16 signals of a line, from a controller snapshot's 12 signals and its four left arrows."""
    return {**signals, **{f"L{n}": state for n, state in enumerate(arrows, 1)}}
