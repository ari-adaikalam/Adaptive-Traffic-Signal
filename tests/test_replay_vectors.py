"""The replay vectors that the JavaScript port is checked against must match the Python engine."""

import json

import replay_export
import test_controller_fuzz as fuzz


def test_the_stored_replay_vectors_are_current(monkeypatch):
    monkeypatch.setattr(fuzz, "TICKS", replay_export.TICKS)
    fresh = json.loads(json.dumps(replay_export.build()))
    stored = json.loads(replay_export.OUT.read_text())
    assert fresh["ticks"] == stored["ticks"]
    for new, old in zip(fresh["runs"], stored["runs"]):
        assert new == old, f"seed {new['seed']} changed: run `python tests/replay_export.py` and re-run the JavaScript tests"
    assert len(fresh["runs"]) == len(stored["runs"])


def test_the_digest_is_a_stable_fnv1a():
    assert replay_export.fnv1a("") == "811c9dc5"
    assert replay_export.fnv1a("a") == "e40c292c"
    assert replay_export.fnv1a("foobar") == "bf9cf968"
