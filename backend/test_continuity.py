import unittest
import numpy as np
from backend.continuity import CounterTracker, timestamp_problem


class CounterTrackerTests(unittest.TestCase):
    def test_corrupted_counter_bytes_from_a_real_recording_are_not_loss(self):
        # OpenBCI GUI recording 2026-10-16: 55, 67, 65 are bit-flipped 48, 51, 52.
        seq = list(range(40, 48)) + [55, 49, 50, 67, 65] + list(range(53, 70))
        c = CounterTracker()
        c.feed(1000, seq)
        self.assertEqual((c.lost, c.corrupt, c.breaks), (0, 3, 0))
        self.assertIsNone(c.problem(1000, 1000 + len(seq)))

    def test_shift_is_confirmed_by_consecutive_samples_across_reads(self):
        c = CounterTracker()
        c.feed(0, np.arange(100) % 256)
        c.feed(100, [107, 108])
        self.assertEqual((c.lost, c.corrupt), (0, 2))
        c.feed(102, [109, 110])
        self.assertEqual((c.lost, c.corrupt, c.breaks), (7, 0, 0))
        self.assertEqual(c.problem(0, 104), '7 Cyton samples missing')
        # The loss sits between samples 99 and 100: a window starting at 100 is continuous.
        self.assertIsNone(c.problem(100, 104))

    def test_repeated_samples_are_a_break(self):
        c = CounterTracker()
        c.feed(0, [10, 11, 12, 12, 13, 14, 15])
        self.assertEqual((c.lost, c.corrupt, c.breaks), (0, 0, 1))
        self.assertIn('repeated', c.problem(0, 7))


class TimestampTests(unittest.TestCase):
    def test_span_not_pauses_decides_gaps(self):
        n = np.arange(500)
        self.assertIsNone(timestamp_problem(n / 250, 250))
        self.assertIsNone(timestamp_problem(np.ceil(n / 250 / .4) * .4, 250))
        self.assertIn('Timestamp gap', timestamp_problem(n / 250 + (n >= 250) * 1.0, 250))
        self.assertIn('backwards', timestamp_problem(n / 250 - (n >= 250) * .01, 250))


if __name__ == '__main__': unittest.main()
