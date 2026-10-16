"""Recorded-session tooling: OpenBCI GUI text -> BrainFlow-RAW CSV -> 4 Hz game input."""
import tempfile
import unittest
from pathlib import Path

import numpy as np
from brainflow.data_filter import DataFilter

from backend.main import CHANNELS, RATE, TIMESTAMP
from backend.openbci_convert import convert
from backend.recordings import inspect_recording
from backend.score_trace import trace
from backend.test_sessions import block

HEADER = """%OpenBCI Raw EXG Data
%Number of channels = 8
%Sample Rate = 250 Hz
%Board = OpenBCI_GUI$BoardCytonSerial
Sample Index, EXG Channel 0, EXG Channel 1, EXG Channel 2, EXG Channel 3, EXG Channel 4, EXG Channel 5, EXG Channel 6, EXG Channel 7, Accel Channel 0, Accel Channel 1, Accel Channel 2, Not Used, Digital Channel 0 (D11), Digital Channel 1 (D12), Digital Channel 2 (D13), Digital Channel 3 (D17), Not Used, Digital Channel 4 (D18), Analog Channel 0, Analog Channel 1, Analog Channel 2, Timestamp, Marker Channel, Timestamp (Formatted)
"""


def gui_text(data, board='OpenBCI_GUI$BoardCytonSerial'):
    """Write Cyton rows the way OpenBCI GUI v6 does: millisecond timestamps, padded first packet."""
    lines = [HEADER.replace('OpenBCI_GUI$BoardCytonSerial', board)]
    zero = np.zeros(24)
    zero[TIMESTAMP] = data[TIMESTAMP, 0]
    for row in [zero, *data.T]:
        cells = [f'{int(row[0])}'] + [f'{v:.2f}' for v in row[1:9]] + [f'{v:.3f}' for v in row[9:12]]
        cells += ['0'] * 10 + [f'{int(round(row[TIMESTAMP] * 1000))}', '0', '12:00:00.000']
        lines.append(', '.join(cells) + '\n')
    return ''.join(lines)


class ConvertTests(unittest.TestCase):
    def test_gui_text_becomes_a_replayable_brainflow_recording(self):
        data = block(0, 1500)
        data[CHANNELS] += 40000  # GUI files carry the raw DC offset
        data[TIMESTAMP] += 1_557_936_000  # Unix seconds, written as milliseconds
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'OpenBCI_GUI-v6-test.txt'
            source.write_text(gui_text(data), encoding='utf-8')
            target, n = convert(source, root)
            self.assertEqual(target.name, 'BrainFlow-RAW_OpenBCI_GUI-v6-test.csv')
            self.assertEqual(n, 1500, 'the zero-padded first packet is dropped')
            loaded, info = inspect_recording(target)
            self.assertEqual(info['samples'], 1500)
            np.testing.assert_allclose(loaded[:, CHANNELS], data[CHANNELS].T, atol=0.006)
            np.testing.assert_allclose(loaded[:, TIMESTAMP], data[TIMESTAMP], atol=0.001)
            self.assertEqual(info['gaps'], [])

    def test_other_boards_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'ganglion.txt'
            source.write_text(gui_text(block(0, 10), board='OpenBCI_GUI$BoardGanglionBLE'), encoding='utf-8')
            with self.assertRaises(ValueError):
                convert(source, directory)


class TraceTests(unittest.TestCase):
    def test_trace_follows_the_live_baseline_and_publish_rate(self):
        seconds = 75
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'BrainFlow-RAW-trace.csv'
            DataFilter.write_file(block(0, seconds * RATE), str(path), 'w')
            result = trace(path, calibrate_at=2)
            self.assertEqual(result, trace(path, calibrate_at=2), 'replay is deterministic')
        cal = result['calibration']
        self.assertEqual(cal['accepted'], 30)
        self.assertEqual(cal['rejected'], 0)
        self.assertAlmostEqual(cal['completed_s'] - cal['started_s'], 60, delta=0.5)
        self.assertEqual(result['rate_hz'], 4)
        # Frames start once the baseline exists and run to the end of the file.
        self.assertAlmostEqual(len(result['score']) / 4, seconds - cal['completed_s'], delta=0.5)
        self.assertTrue(all(0 <= s <= 1 for s in result['score']))
        self.assertGreater(sum(result['usable']) / len(result['usable']), 0.9)

    def test_too_short_for_a_baseline(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'BrainFlow-RAW-short.csv'
            DataFilter.write_file(block(0, 30 * RATE), str(path), 'w')
            with self.assertRaises(ValueError):
                trace(path)


if __name__ == '__main__':
    unittest.main()
