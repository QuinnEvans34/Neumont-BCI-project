"""Analytics correctness, persistence parity and read-only access boundaries."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

from backend.main import RATE, CHANNELS, TIMESTAMP
from backend.experiments import ExperimentManager
from backend.test_research import Rig, block
from backend.visualizer import Visualizer, compact, spectrum
from backend.test_experiments import bilateral_config, Feed, wait


class VisualizerTests(unittest.TestCase):
    def viewer(self, rig, roots=None):
        return Visualizer(rig.store, roots or {'project': rig.tmp / 'raw'},
                          ExperimentManager(RATE, 8, root=rig.tmp / 'experiments'))

    def test_raw_full_run_metrics_are_independent_of_selected_preview(self):
        with tempfile.TemporaryDirectory() as tmp:
            rig = Rig(tmp)
            raw = rig.tmp / 'raw'
            raw.mkdir()
            data = block(0, RATE * 8, freq=10).T
            data[RATE * 4:RATE * 6, CHANNELS] = 0  # one flat 2 s window
            path = raw / 'BrainFlow-RAW-test.csv'
            np.savetxt(path, data)
            viewer = self.viewer(rig, {'project': raw, 'duplicate': raw})
            runs = viewer.runs()
            self.assertEqual(len(runs), 1)
            a = viewer.analysis('raw', runs[0]['id'], 0, 2, 500)
            b = viewer.analysis('raw', runs[0]['id'], 4, 6, 500)
            self.assertEqual(a['summary'], b['summary'])
            self.assertEqual(a['summary']['samples'], RATE * 8)
            self.assertEqual(a['summary']['accepted_pct'], 75)
            self.assertIsNone(a['summary']['mean_score'])
            self.assertGreater(a['spectrum']['channel_windows'], 0)
            self.assertEqual(b['spectrum']['channel_windows'], 0)
            page = viewer.table('raw', runs[0]['id'], 'eeg', 25, 10)
            self.assertEqual(len(page['rows']), 10)
            self.assertEqual(page['rows'][0]['sample_index'], 25)
            self.assertTrue(page['has_more'])

    def test_psd_normalization_and_discontinuity(self):
        t = np.arange(RATE * 2) / RATE
        wave = np.tile(10 * np.sin(2 * np.pi * 10 * t), (8, 1)).T
        result = spectrum(wave, RATE, 500)
        points = result['points']
        self.assertEqual(max(points, key=lambda p: p[1])[0], 10)
        # A sine with peak amplitude 10 µV has mean-square power 50 µV².
        self.assertAlmostEqual(sum(p[1] for p in points) * .5, 50, places=3)
        breaks = np.zeros(len(wave), dtype=bool)
        breaks[250] = True
        self.assertEqual(spectrum(wave, RATE, 500, breaks)['points'], [])

    def test_csv_sqlite_both_research_summary_matches_and_does_not_change_capture(self):
        summaries = []
        for fmt in ('csv', 'sqlite', 'both'):
            with self.subTest(fmt=fmt), tempfile.TemporaryDirectory() as tmp:
                rig = Rig(tmp, fmt)
                with patch('time.time', return_value=1_700_000_000.0):
                    rig.connect_live()
                    rec = rig.start()
                    rig.feed(4)
                    self.assertRaises(PermissionError, self.viewer(rig).analysis, 'research', rec.id, 0, 4, 500)
                with patch('time.time', return_value=1_700_000_004.0):
                    folder = rig.finish(rec)
                before = (folder / 'metadata.json').read_bytes()
                result = self.viewer(rig).analysis('research', rec.id, 0, 4, 500)
                self.assertEqual(result['summary']['samples'], RATE * 4)
                self.assertEqual(result['summary']['duration_s'], 4)
                self.assertTrue(result['series']['relative_alpha'])
                self.assertEqual(len(result['eeg']), RATE * 4)
                self.assertEqual(len(result['channels']), 8)
                self.assertNotIn('local_folder', result['metadata'])
                self.assertEqual(before, (folder / 'metadata.json').read_bytes())
                summaries.append(result['summary'])
        self.assertEqual(summaries[0], summaries[1])
        self.assertEqual(summaries[1], summaries[2])

    def test_validation_and_traversal_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            rig = Rig(tmp)
            viewer = self.viewer(rig)
            self.assertRaises(ValueError, viewer.raw_path, 'project:../../secret.csv')
            self.assertRaises(ValueError, viewer.raw_path, 'unknown:BrainFlow-RAW.csv')
            self.assertRaises(ValueError, viewer.analysis, 'raw', 'missing', -1, 10, 500)
            self.assertRaises(ValueError, viewer.analysis, 'raw', 'missing', 0, 121, 500)
            self.assertRaises(ValueError, viewer.analysis, 'raw', 'missing', float('nan'), 10, 500)
            self.assertRaises(ValueError, viewer.table, 'research', 'missing', 'sqlite_master', 0, 50)

    def test_research_score_gaps_game_tracks_and_event_counts(self):
        with tempfile.TemporaryDirectory() as tmp, patch('time.time', return_value=1_700_000_000.0):
            rig = Rig(tmp)
            rig.connect_live()
            rec = rig.start()
            aid = rig.s.session_id
            rig.s.research.on_frame(aid, 1, 'live', .8, 'good', True, None, None, wall=1_700_000_001)
            rig.s.research.on_frame(aid, 2, 'live', .9, 'poor', True, None, None, wall=1_700_000_002)
            rig.s.research.items(rec.id, rec.token, [
                dict(seq=1, kind='event', event_id='R1', type='round_started', game='cairn', round_id='R1', t_browser_ms=1_700_000_000_000),
                dict(seq=2, kind='state', game='cairn', round_id='R1', t_browser_ms=1_700_000_001_000, cairn_stones=3, cairn_sway_rad=.1),
                dict(seq=3, kind='state', game='cairn', round_id='R2', t_browser_ms=1_700_000_002_000, cairn_stones=0, cairn_sway_rad=.01),
                dict(seq=4, kind='event', event_id='M1', type='marker', reason='Test marker', t_browser_ms=1_700_000_002_500),
            ])
            folder = rig.finish(rec)
            result = self.viewer(rig).analysis('research', rec.id, 0, 4, 500)
            self.assertEqual(result['summary']['mean_score'], .8)
            self.assertEqual(result['summary']['score_above_pct'], 100)
            self.assertEqual(result['series']['score'], [[1, .8], [2, None]])
            self.assertIn([2, None], result['series']['cairn_stones'])
            self.assertEqual(result['event_counts']['marker'], 1)
            page = self.viewer(rig).table('research', rec.id, 'events', 1, 2)
            from backend.research.store import Reader
            self.assertEqual(page['rows'], list(Reader(folder).rows('events'))[1:3])

    def test_saved_experiment_band_metrics_and_original_tables_are_available(self):
        with tempfile.TemporaryDirectory() as tmp:
            rig = Rig(tmp)
            viewer = self.viewer(rig)
            manager = viewer.experiments
            exp = manager.start('bilateral', bilateral_config(), 'session', 'simulated_eeg', True)
            feed = Feed()
            feed.push(manager, 5)
            manager.stop(exp.id, exp.token)
            wait(exp)
            result = viewer.analysis('experiment', exp.id, 0, 4, 500)
            self.assertEqual(result['summary']['samples'], 5 * RATE)
            self.assertGreater(result['summary']['windows'], 0)
            self.assertTrue(result['series']['band_alpha'])
            self.assertGreater(result['spectrum']['channel_windows'], 0)
            self.assertNotIn('path', json.dumps(result['metadata']))
            self.assertGreater(len(viewer.table('experiment', exp.id, 'metrics', 0, 10)['rows']), 0)
            self.assertRaises(ValueError, viewer.table, 'experiment', exp.id, '../metadata', 0, 10)

    def test_extrema_and_rejected_gaps_survive_plot_reduction(self):
        points = [[i, .5] for i in range(10000)]
        points[11][1] = 1
        points[12][1] = 0
        points[13][1] = None
        reduced = compact(points)
        self.assertLess(len(reduced), 1800)
        self.assertIn([11, 1], reduced)
        self.assertIn([12, 0], reduced)
        self.assertIn([13, None], reduced)
        self.assertEqual(sorted(p[0] for p in reduced), [p[0] for p in reduced])


if __name__ == '__main__':
    unittest.main()
