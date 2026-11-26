"""Reference model of the signal controller's own safety monitor.

This is the specification for the firmware, which implements the same rules in C++ and is
tested against this model. It sits between the serial line and the lamps and does not trust
the host:

  * Damaged lines (wrong format or checksum) are ignored and count as silence.
  * An intact line with unsafe signals trips a fault at once.
  * Silence for watchdog_s seconds trips a fault.
  * In a fault every vehicle signal flashes red and every pedestrian signal is solid red.
  * A fault ends only after recover_messages consecutive seconds that each carried a good
    line and no conflicting one. The lamps then stay all red for recover_all_red_s seconds, whatever the host
    asks for, and only then follow the host again. So the host can resume at any point
    of its cycle and conflicting traffic still gets a full all-red first.
  * At power up the monitor is in a fault, so it starts by flashing.

Time is explicit: call receive() for each line that arrived during a second, then tick()
once to get what the lamps show for that second.
"""

from __future__ import annotations

from dataclasses import dataclass

from .protocol import ConflictError, FormatError, MOVEMENTS, decode

RUN = "run"
FAULT = "fault"
RECOVER = "recover"


@dataclass(frozen=True)
class Output:
    second: int
    state: str  # "run", "fault" or "recover"
    reason: str | None  # why the last fault began: "startup", "watchdog" or "conflict"
    signals: dict[str, str]


def _uniform(vehicle: str) -> dict[str, str]:
    return {m: ("stop" if m[0] == "C" else vehicle) for m in MOVEMENTS}


class Monitor:
    def __init__(self, watchdog_s: int = 3, recover_messages: int = 3, recover_all_red_s: int = 3) -> None:
        for name, value, minimum in (("watchdog_s", watchdog_s, 1), ("recover_messages", recover_messages, 1),
                                     ("recover_all_red_s", recover_all_red_s, 0)):
            if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
                raise ValueError(f"{name} must be an int of at least {minimum}")
        self._watchdog = watchdog_s
        self._recover_messages = recover_messages
        self._recover_all_red = recover_all_red_s
        self._second = 0
        self._state = FAULT
        self._reason: str | None = "startup"
        self._latest = _uniform("red")
        self._last_good: int | None = None
        self._run = 0  # consecutive seconds that carried a good line
        self._counted = -10  # the last second counted in _run
        self._tainted = -10  # the last second that carried a conflicting line
        self._recover_left = 0

    def receive(self, line: bytes | str) -> str:
        """Handle one received line. Returns "ok", "format" or "conflict"."""
        try:
            signals = decode(line)
        except FormatError:
            return "format"
        except ConflictError:
            self._trip("conflict")
            return "conflict"
        self._latest = signals
        self._last_good = self._second
        if self._tainted == self._second:
            return "ok"  # a second that carried a conflict never counts towards recovery
        if self._counted != self._second:
            self._run = self._run + 1 if self._counted == self._second - 1 else 1
            self._counted = self._second
        return "ok"

    def _trip(self, reason: str) -> None:
        if reason == "conflict":
            self._tainted = self._second
        self._state = FAULT
        self._reason = reason
        self._run = 0
        self._counted = -10

    def tick(self) -> Output:
        """Close the current second and return what the lamps show for it."""
        if self._counted != self._second:
            self._run = 0  # a second without a good line breaks the count
        silent = self._last_good is None or self._second - self._last_good >= self._watchdog
        if self._state in (RUN, RECOVER) and silent:
            self._trip("watchdog")
        if self._state == FAULT and self._run >= self._recover_messages:
            if self._recover_all_red == 0:
                self._state = RUN
            else:
                self._state = RECOVER
                self._recover_left = self._recover_all_red
        shown = self._state
        if shown == RUN:
            signals = dict(self._latest)
        elif shown == RECOVER:
            signals = _uniform("red")
            self._recover_left -= 1
            if self._recover_left == 0:
                self._state = RUN
        else:
            signals = _uniform("flash")
        output = Output(self._second, shown, self._reason if shown != RUN else None, signals)
        self._second += 1
        return output
