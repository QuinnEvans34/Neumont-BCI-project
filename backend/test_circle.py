"""Known-signal and recording integration checks for the single-circle experiment."""
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from backend.bands import window_metrics
from backend.experiments import ExperimentManager
from backend.main import StartRequest, validate_start
from backend.test_experiments import CLOCK, NAMES, RATE, Feed, ssvep_config


def config(**changes):
    settings = dict(frequency_hz=10, color='#9db4ff', duration_s=30,
                    display=ssvep_config()['ssvep']['display'])
    settings.update(changes)
    return dict(kind='ssvep_circle', participant='circle-test', electrodes=NAMES,
                reference='earlobe', clock=CLOCK, ssvep_circle=settings)


class CircleTests(unittest.TestCase):
    def test_setup_validation(self):
        validate_start(StartRequest(**config()))
        # No classifier or posterior-channel requirement for this observation tool.
        validate_start(StartRequest(**dict(config(), electrodes=[''] * 8)))
        for changes in (dict(frequency_hz=0), dict(frequency_hz=31), dict(color='red'),
                        dict(duration_s=0), dict(duration_s=601),
                        dict(display=dict(ssvep_config()['ssvep']['display'], passed=False))):
            with self.assertRaises(ValueError, msg=str(changes)):
                validate_start(StartRequest(**config(**changes)))
        with self.assertRaises(ValueError):
            validate_start(StartRequest(**dict(config(), ssvep_circle=None)))

    def test_dominant_frequency_and_alpha_are_separate(self):
        t = np.arange(500) / RATE
        m = window_metrics(np.array([10 * np.sin(2*np.pi*hz*t) for hz in (10, 15, 6, 1, 30)]), RATE)
        self.assertEqual([c['dominant_hz'] for c in m], [10, 15, 6, 1, 30])
        self.assertAlmostEqual(m[0]['alpha'], 50, delta=1)
        self.assertLess(m[1]['alpha'], 0.01)

    def run_recording(self, flat=False, gaps=False):
        with tempfile.TemporaryDirectory() as tmp:
            manager = ExperimentManager(RATE, 8, Path(tmp))
            exp = manager.start('ssvep_circle', config(), 'circle-source', 'simulated_eeg', True)
            try:
                feed = Feed()
                manager.events(exp.id, exp.token, [dict(id=1, type='trial_start', trial_id='trial-1', t_browser_ms=feed.now_ms()),
                    dict(id=2, type='segment_start', trial_id='trial-1', segment_id='seg-1',
                         frequency_hz=10, color='#9db4ff', t_browser_ms=feed.now_ms())])
                start, eeg, ts, counters = feed.block(1000)
                # One rejected channel must not contribute to total alpha.
                eeg[0] = 0
                if flat:
                    eeg[:] = 0
                manager.on_samples(int(start), eeg, ts, counters, [750] if gaps else [], float(ts[-1]))
                manager.frames(exp.id, exp.token, dict(trial_id='seg-1', profile_hz=60,
                    frames=[[i, 1000 + i * 1000 / 60, int(i % 6 < 3)] for i in range(60)]))
                manager.events(exp.id, exp.token, [dict(id=3, type='segment_end', trial_id='trial-1', segment_id='seg-1', t_browser_ms=feed.now_ms()),
                    dict(id=4, type='segment_start', trial_id='trial-1', segment_id='seg-2', frequency_hz=12.5, color='#ff0000', t_browser_ms=feed.now_ms()),
                    dict(id=5, type='trial_end', trial_id='trial-1', reason='Escape pressed', completed=False, t_browser_ms=feed.now_ms())])
            finally:
                manager.stop(exp.id, exp.token, 'Escape pressed')
                self.assertTrue(exp.finished.wait(10))
            folder = Path(tmp) / exp.id
            self.assertIsNone(exp.analyzer.error)
            meta = json.loads((folder / 'metadata.json').read_text(encoding='utf-8'))
            summary = json.loads((folder / 'summary.json').read_text(encoding='utf-8'))
            metrics = [json.loads(r) for r in (folder / 'metrics.jsonl').read_text(encoding='utf-8').splitlines()]
            events = [json.loads(r) for r in (folder / 'events.jsonl').read_text(encoding='utf-8').splitlines()]
            self.assertEqual(summary['recording']['samples'], 1000)
            self.assertEqual(summary['recording']['frames'], 60)
            self.assertEqual(summary['recording']['events'], 5)
            self.assertEqual(summary['state'], 'interrupted')
            self.assertEqual(meta['settings']['ssvep_circle']['frequency_hz'], 10)
            self.assertEqual(meta['stimulus']['frame_columns'], ['segment_frame', 't_browser_ms', 'on'])
            self.assertEqual(events[3]['frequency_hz'], 12.5)
            self.assertEqual(events[3]['color'], '#ff0000')
            self.assertTrue(all('alignment' in e for e in events))
            self.assertGreater(len(metrics), 0)
            latest = metrics[-1]
            self.assertEqual(latest, summary['analysis']['latest'])
            if flat or gaps:
                self.assertEqual(latest['valid_channels'], 0)
                self.assertIsNone(latest['total_alpha_uv2'])
                self.assertTrue(all(not c['valid'] for c in latest['channels']))
            else:
                self.assertEqual(latest['valid_channels'], 7)
                self.assertAlmostEqual(latest['total_alpha_uv2'], sum(c['alpha'] for c in latest['channels'] if c['valid']))
                self.assertEqual(latest['channels'][0]['reason'], 'Flat signal')
                self.assertIn('dominant_hz', latest['channels'][1])
            self.assertEqual(manager.folder(exp.id), folder)

    def test_records_raw_eeg_settings_changes_frames_and_channel_metrics(self):
        self.run_recording()

    def test_all_rejected_channels_have_missing_total_not_zero(self):
        self.run_recording(flat=True)

    def test_packet_gap_invalidates_metrics(self):
        self.run_recording(gaps=True)


if __name__ == '__main__':
    unittest.main()
