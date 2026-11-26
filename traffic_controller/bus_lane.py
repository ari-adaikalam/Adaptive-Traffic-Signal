"""The bus lane schedule: a pure function of the clock.

The lane is always there. A window makes it active, which means only buses (and
emergency vehicles) may use it. Times are whole seconds from Monday 00:00.
"""

from __future__ import annotations

from collections.abc import Sequence

WEEK_SECONDS = 7 * 24 * 3600
DAY_SECONDS = 24 * 3600

# (first day, last day, start minute, end minute). Days are 0 = Monday to 6 = Sunday,
# both ends included. Minutes run 0 to 1440 and the end is not included.
Window = tuple[int, int, int, int]


def check_window(window: object) -> Window:
    if not isinstance(window, tuple) or len(window) != 4:
        raise ValueError("a bus lane window is a tuple of 4 ints")
    for value in window:
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError("a bus lane window is a tuple of 4 ints")
    first, last, start, end = window
    if not (0 <= first <= last <= 6):
        raise ValueError("window days must satisfy 0 <= first <= last <= 6")
    if not (0 <= start < end <= 1440):
        raise ValueError("window minutes must satisfy 0 <= start < end <= 1440")
    return window


def is_active(windows: Sequence[Window], week_second: int) -> bool:
    """True when the clock, in seconds from Monday 00:00, falls inside any window."""
    if isinstance(week_second, bool) or not isinstance(week_second, int) or week_second < 0:
        raise ValueError("week_second must be a non-negative int")
    second = week_second % WEEK_SECONDS
    day = second // DAY_SECONDS
    minute = second % DAY_SECONDS // 60
    return any(first <= day <= last and start <= minute < end for first, last, start, end in windows)
