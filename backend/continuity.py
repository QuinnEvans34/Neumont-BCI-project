"""Sample continuity: tell real data loss from corrupted counters and bursty host timestamps."""
from collections import deque
import numpy as np

# The Cyton packet has no checksum, so radio errors can flip bits in the sample
# counter. A lone out-of-sequence value between in-sequence neighbours is such a
# corrupted byte, not lost data. A new sequence is a real shift only once this
# many consecutive samples agree on it.
CONFIRM_SAMPLES = 3
# Per 2-second window: tolerated real loss (16 ms, a sixth of an alpha cycle) and
# corrupted counters (5%; corrupted EEG large enough to matter fails the amplitude gate).
MAX_LOST_SAMPLES = 4
MAX_CORRUPT_SAMPLES = 25
# Host timestamps are taken when the PC reads a USB burst, so samples bunch up with
# pauses (up to ~0.45 s observed with the default 16 ms FTDI latency on Windows)
# while nothing is missing. Only a window that spans clearly more time than its
# samples represent contains a gap.
SPAN_TOLERANCE_S = .75


def timestamp_problem(ts, rate):
    """Why a window's timestamps show a discontinuity, or None."""
    if np.any(np.diff(ts) < 0):
        return 'Timestamps ran backwards'
    span = float(ts[-1] - ts[0])
    if span > (len(ts) - 1) / rate + SPAN_TOLERANCE_S:
        return f'Timestamp gap: {len(ts) / rate:g} s of samples spans {span:.2f} s'
    return None


class CounterTracker:
    """Follows the Cyton sample counter (0-255, +1 per sample) by absolute sample index.

    Events are (sample index, kind, amount): 'lost' (amount samples skipped just
    before index), 'break' (counter repeated, ran backwards or restarted just
    before index) or 'corrupt' (that sample's counter is out of sequence).
    """

    def __init__(self):
        self.offset = None  # (counter - sample index) mod 256 of the trusted sequence
        self.run = None  # [offset, first index, length] of an unconfirmed new sequence
        self.events = deque()
        self.lost = self.corrupt = self.breaks = 0

    def feed(self, start, counters):
        offsets = (np.asarray(counters, dtype=int) - (start + np.arange(len(counters)))) % 256
        if self.offset is None:
            self.offset = int(offsets[0])
        if self.run is None and np.all(offsets == self.offset):
            return
        for i, o in enumerate(offsets.tolist()):
            n = start + i
            if o == self.offset:
                self.run = None
                continue
            if self.run and self.run[0] == o and self.run[1] + self.run[2] == n:
                self.run[2] += 1
            else:
                self.run = [o, n, 1]
            self.events.append((n, 'corrupt', 1))
            self.corrupt += 1
            if self.run[2] >= CONFIRM_SAMPLES:
                # The sequence really moved: its samples were never corrupt.
                for _ in range(self.run[2]): self.events.pop()
                self.corrupt -= self.run[2]
                shift = (o - self.offset) % 256
                if shift < 128:
                    self.events.append((self.run[1], 'lost', shift))
                    self.lost += shift
                else:
                    self.events.append((self.run[1], 'break', 0))
                    self.breaks += 1
                self.offset, self.run = o, None

    def problem(self, start, end):
        """Why counters make samples [start, end) unusable, or None."""
        lost = corrupt = 0
        for n, kind, amount in self.events:
            if kind == 'corrupt':
                corrupt += start <= n < end
            elif start < n < end:
                if kind == 'break': return 'Cyton sample counter repeated or restarted'
                lost += amount
        if lost > MAX_LOST_SAMPLES: return f'{lost} Cyton samples missing'
        if corrupt > MAX_CORRUPT_SAMPLES: return f'{corrupt} corrupted Cyton packets'
        return None

    def prune(self, keep_from):
        while self.events and self.events[0][0] < keep_from:
            self.events.popleft()
