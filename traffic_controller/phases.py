"""Movements, the conflict rule and the phase plan.

Approaches are numbered 1 to 4 clockwise, so approach i faces approach i+2.
Left-hand traffic: the left turn travels with the through movement, the right
turn crosses opposing traffic and gets its own arrow.

  T_i  through and left turn from approach i
  R_i  protected right turn arrow from approach i
  C_j  pedestrian crossing over leg j
  L_i  left turn arrow of approach i. It is lit only during the arrow phase of the other pair, when no
       pedestrian can be crossing. It is not part of a phase and not on the serial line (see signals.py).
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

NUM_APPROACHES = 4
KINDS = ("T", "R", "C")
ALL_MOVEMENTS = tuple(f"{kind}{n}" for kind in KINDS for n in range(1, NUM_APPROACHES + 1))
ARROWS = tuple(f"L{n}" for n in range(1, NUM_APPROACHES + 1))


def shift(n: int, steps: int) -> int:
    """Approach number n moved clockwise by steps, staying within 1 to 4."""
    return (n - 1 + steps) % NUM_APPROACHES + 1


def opposite(n: int) -> int:
    return shift(n, 2)


def parse(movement: str) -> tuple[str, int]:
    if movement not in ALL_MOVEMENTS and movement not in ARROWS:
        raise ValueError(f"unknown movement {movement!r}")
    return movement[0], int(movement[1])


def compatible(a: str, b: str) -> bool:
    """Whitelist: True only for pairs that may be active together.

    Everything not listed conflicts. A movement is compatible with itself.
    """
    if a == b:
        parse(a)
        return True
    kind_a, n_a = parse(a)
    kind_b, n_b = parse(b)
    if "L" in (kind_a, kind_b):
        # From the swept paths of a bus on each movement. A left turn clears opposing traffic in left-hand
        # driving, so it conflicts only where it shares a lane or the road with something.
        (_, i), (kind, j) = ((kind_a, n_a), (kind_b, n_b)) if kind_a == "L" else ((kind_b, n_b), (kind_a, n_a))
        if kind == "L":
            return True
        if kind == "T":
            return j in (i, opposite(i))  # its own approach, and the one opposite, whose left turn it carries
        if kind == "R":
            return j != opposite(i)  # a right turn from the opposite approach exits into the same lane
        return False  # pedestrians
    if kind_a == kind_b == "T" or kind_a == kind_b == "R":
        return n_b == opposite(n_a)  # opposing throughs, opposing right turns
    if kind_a == kind_b == "C":
        return True  # crossings never conflict with each other
    # A crossing with the through movements of the road beside its leg. Turning
    # vehicles must give way to the pedestrians, which a signal cannot enforce.
    crossing, through = (n_a, n_b) if kind_a == "C" else (n_b, n_a)
    if "T" in (kind_a, kind_b) and "C" in (kind_a, kind_b):
        return through in (shift(crossing, 1), shift(crossing, 3))
    return False


def conflict_free(movements: Iterable[str]) -> bool:
    items = list(movements)
    return all(compatible(a, b) for i, a in enumerate(items) for b in items[i + 1:])


@dataclass(frozen=True)
class Phase:
    name: str
    movements: frozenset[str]

    def __post_init__(self) -> None:
        for movement in self.movements:
            parse(movement)
        if not self.movements:
            raise ValueError("a phase needs at least one movement")
        if not conflict_free(self.movements):
            raise ValueError(f"phase {self.name} holds conflicting movements")
        if len({m[0] for m in self.movements}) != 1 or self.movements & {f"C{n}" for n in range(1, 5)}:
            raise ValueError("a phase holds only through movements or only right-turn arrows")

    @property
    def kind(self) -> str:
        """"T" for a through phase, "R" for a right-turn arrow phase."""
        return next(iter(self.movements))[0]

    def approaches(self) -> tuple[int, ...]:
        return tuple(sorted(parse(m)[1] for m in self.movements))


def build_plan(arrows: bool = True) -> tuple[Phase, ...]:
    """The fixed cycle. Opposing approaches run together.

    With arrows, each through phase is preceded by an arrow phase for the right
    turns of the same pair, in the order T13, R24, T24, R13, which is the cycle
    R13, T13, R24, T24 started at its first through phase. An arrow phase runs
    only when a right turn is waiting. Without arrows there are two phases.
    """
    t13 = Phase("T13", frozenset({"T1", "T3"}))
    t24 = Phase("T24", frozenset({"T2", "T4"}))
    if not arrows:
        return (t13, t24)
    return (t13, Phase("R24", frozenset({"R2", "R4"})), t24, Phase("R13", frozenset({"R1", "R3"})))
