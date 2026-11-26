"""Record random controller runs so another implementation can replay them exactly.

Each run holds the config, the plan, the clock, every call made to the controller before each
tick, and a digest of the full snapshot after each tick. The JavaScript port replays the calls
and must produce the same digests. Run `python tests/replay_export.py` after changing the engine
to refresh tests/vectors/replay_runs.json. A test fails if the file is stale.
"""

import dataclasses
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent))

import test_controller_fuzz as fuzz  # noqa: E402
from traffic_controller import Config, Controller  # noqa: E402

SEEDS = range(30)
EXTENDED_SEEDS = range(100, 130)  # the same driver with the rules the page turns on
TICKS = 500
OUT = Path(__file__).parent / "vectors" / "replay_runs.json"
CODES = {"red": "R", "yellow": "Y", "green": "G", "flash": "F", "stop": "S", "walk": "W", "clear": "C"}
MOVEMENTS = [f"{k}{n}" for k in "TRC" for n in range(1, 5)]


def digest_text(s) -> str:
    return ";".join([
        str(s.time), s.phase, s.stage, str(s.remaining), "".join(CODES[s.signals[m]] for m in MOVEMENTS),
        ",".join(str(n) for n in s.pedestrian_requests), str(s.period),
        "-" if s.emergency_approach is None else str(s.emergency_approach), str(int(s.holding)),
        str(int(s.bus_lane_active)), str(int(s.bus_priority)), s.mode, s.fault or "-", str(s.startups),
        "".join(CODES[a] for a in s.arrows)])


def fnv1a(text: str) -> str:
    h = 0x811C9DC5
    for byte in text.encode("utf-8"):
        h = ((h ^ byte) * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}"


def digest(snapshot) -> str:
    return fnv1a(digest_text(snapshot))


def _counts(c):
    return None if c is None else [c.bikes, c.buses, c.cars, c.trucks]


class Recording(Controller):
    """A controller that logs every public call, in order, with the tick it comes before."""

    log: list = []
    meta: dict = {}

    def __init__(self, config=None, plan=None, clock_start_s=0, power_on=False):
        super().__init__(config, plan, clock_start_s, power_on)
        Recording.meta = {"config": config, "arrows": any(p.kind == "R" for p in plan),
                          "clock": clock_start_s, "power_on": power_on}
        Recording.log = []
        self._ticks = 0

    def _note(self, *call, error=False):
        Recording.log.append([self._ticks + 1, *call] + (["error"] if error else []))

    def tick(self):
        self._ticks += 1
        return super().tick()

    def _wrapped(self, name, args, record):
        try:
            result = getattr(super(), name)(*args)
        except ValueError:
            self._note(*record, error=True)
            raise
        self._note(*record)
        return result

    def report_counts(self, approach, counts):
        return self._wrapped("report_counts", (approach, counts), ("counts", approach, _counts(counts)))

    def report_right_counts(self, approach, counts):
        return self._wrapped("report_right_counts", (approach, counts), ("right", approach, _counts(counts)))

    def report_left_counts(self, approach, counts):
        return self._wrapped("report_left_counts", (approach, counts), ("left", approach, _counts(counts)))

    def report_bus_counts(self, approach, counts):
        return self._wrapped("report_bus_counts", (approach, counts), ("bus", approach, _counts(counts)))

    def request_crossing(self, crossing):
        return self._wrapped("request_crossing", (crossing,), ("crossing", crossing))

    def pause(self, vehicle_id, approach, movement="through"):
        return self._wrapped("pause", (vehicle_id, approach, movement), ("pause", vehicle_id, approach, movement))

    def resume(self, vehicle_id):
        return self._wrapped("resume", (vehicle_id,), ("resume", vehicle_id))

    def fault(self, reason):
        return self._wrapped("fault", (reason,), ("fault", reason))

    def clear_fault(self):
        return self._wrapped("clear_fault", (), ("clear",))

    def set_mode(self, mode):
        return self._wrapped("set_mode", (mode,), ("mode", mode))


def build() -> dict:
    defaults = dataclasses.asdict(Config())
    runs = []
    original = fuzz.Controller
    fuzz.Controller = Recording
    try:
        for seed, extended in [(s, False) for s in SEEDS] + [(s, True) for s in EXTENDED_SEEDS]:
            _, _, snaps, _ = fuzz.drive(seed, extended=extended)
            meta = Recording.meta
            overrides = {k: v for k, v in dataclasses.asdict(meta["config"]).items() if v != defaults[k]}
            runs.append({
                "seed": seed, "config": json.loads(json.dumps(overrides)), "arrows": meta["arrows"],
                "clock": meta["clock"], "power_on": meta["power_on"], "events": list(Recording.log),
                "digests": "".join(digest(s) for s in snaps),
            })
    finally:
        fuzz.Controller = original
    return {"ticks": fuzz.TICKS, "runs": runs}


if __name__ == "__main__":
    fuzz.TICKS = TICKS
    data = build()
    OUT.write_text(json.dumps(data, separators=(",", ":")))
    print(f"{len(data['runs'])} runs, {OUT.stat().st_size / 1e6:.2f} MB")
