"""Regression checks for the November signal-processing changes."""
import csv
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
import numpy as np
from backend.signal import analyze, filtered_window, hum_rms, PROCESSING_VERSION
from backend.main import Service
from backend.research import schema
from backend.research.store import Reader


class ProcessingTests(unittest.TestCase):
    def setUp(self):
        self.t = np.arange(500)/250
        self.alpha = 20*np.sin(2*np.pi*10*self.t)

    def test_hum_removed_without_mutating_raw_or_rejecting_good_alpha(self):
        raw = (self.alpha + 100*np.sin(2*np.pi*60*self.t))[None, :]
        original = raw.copy()
        value, channels = analyze(raw, 250)
        np.testing.assert_array_equal(raw, original)
        self.assertGreater(value, .95)
        c = channels[0]
        self.assertTrue(c['included'])
        self.assertGreater(c['raw_ptp_uv'], 200)
        self.assertLess(c['ptp_uv'], 150)
        self.assertAlmostEqual(c['hum_rms_uv'], 100/np.sqrt(2), delta=1)
        self.assertLess(hum_rms(filtered_window(raw[0],250),250), c['hum_rms_uv']/100)

    def test_filter_rejects_out_of_band_and_preserves_alpha(self):
        for hz in (0.5, 80):
            x = 20*np.sin(2*np.pi*hz*self.t)
            y = filtered_window(x,250)
            self.assertLess(np.std(y), np.std(x)*.6)
        y = filtered_window(self.alpha,250)
        self.assertAlmostEqual(np.std(y), np.std(self.alpha), delta=2)

    def test_filtered_motion_rejected_and_bad_channel_does_not_poison_others(self):
        motion = 200*np.sin(2*np.pi*5*self.t)
        value, ch = analyze(np.array([self.alpha, motion, np.full(500,np.nan)]),250)
        self.assertGreater(value, .95)
        self.assertFalse(ch[1]['included'])
        self.assertFalse(ch[2]['included'])
        self.assertIsNone(ch[2]['hum_rms_uv'])

    def test_raw_rail_cannot_be_hidden_by_filter(self):
        value, ch = analyze((self.alpha+187500)[None,:],250)
        self.assertIsNone(value)
        self.assertIn('rail',ch[0]['reason'])

    def test_selection_controls_median_but_keeps_all_channel_metrics(self):
        raw = np.array([self.alpha, 20*np.sin(2*np.pi*20*self.t)])
        a, ch = analyze(raw,250,scoring_channels=[1])
        b, _ = analyze(raw,250,scoring_channels=[2])
        self.assertGreater(a,.95)
        self.assertLess(b,.05)
        self.assertEqual(len(ch),2)
        self.assertFalse(ch[1]['selected'])
        self.assertIsNotNone(ch[1]['hum_rms_uv'])
        self.assertIsNone(analyze(raw,250,scoring_channels=[])[0])

    def test_live_baseline_requires_selection_and_changes_clear_baseline(self):
        s = Service()
        s.enabled = True
        s.board = MagicMock()
        s.last_packet = 100
        with patch('backend.main.time.monotonic', return_value=101):
            with self.assertRaisesRegex(ValueError,'Select'):
                s.begin_calibration()
            s.set_scoring_channels([7,8])
            s.begin_calibration()
            with self.assertRaises(ValueError): s.set_scoring_channels([3])
            s.calibrating = False
            s.cal.center = .5
            s.cal.scale = .1
            s.active_calibration_id = 'baseline'
            s.set_scoring_channels([3,4,7,8])
            self.assertIsNone(s.cal.center)
            self.assertIsNone(s.active_calibration_id)
            s.cal.center = .5
            s.set_gate(200)
            self.assertIsNone(s.cal.center)
            self.assertEqual(s.status()['processing']['version'], PROCESSING_VERSION)
        for bad in ([], [0], [9], [True]):
            with self.assertRaises(ValueError): s.set_scoring_channels(bad)

    def test_old_channel_metrics_csv_still_readable(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)
            (p/'eeg.csv').write_text('unused\n')
            out = io.StringIO(); w = csv.writer(out)
            cols = schema.columns('channel_metrics')[:-3]
            w.writerow(cols)
            values = ['rec','participant','acq',1,1,'O1',10,40,.8,1,'Included']
            self.assertEqual(len(values),len(cols))
            w.writerow(values)
            (p/'channel_metrics.csv').write_text(out.getvalue())
            reader = Reader(p)
            row = list(reader.rows('channel_metrics'))[0]
            self.assertEqual(row['relative_alpha'],.8)
            self.assertIsNone(row['hum_rms_uv'])
            self.assertEqual(list(reader.row_spans('channel_metrics',[(0,1)]))[0],row)

    def test_channel_endpoint_validates_and_returns_selection(self):
        import asyncio
        from fastapi import HTTPException
        from pydantic import ValidationError
        from backend.main import ScoringChannelsRequest, scoring_channels
        service = Service()
        with patch('backend.main.service',service):
            result = asyncio.run(scoring_channels(ScoringChannelsRequest(channels=[8,7])))
            self.assertEqual(result['scoring_channels'],[7,8])
            with self.assertRaises(HTTPException):
                asyncio.run(scoring_channels(ScoringChannelsRequest(channels=[9])))
        for channels in ([], [True], [1.5], ['7']):
            with self.assertRaises(ValidationError): ScoringChannelsRequest(channels=channels)

    def test_old_sqlite_export_keeps_original_header_and_row_width(self):
        import sqlite3
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)
            cols = schema.columns('channel_metrics')[:-3]
            with sqlite3.connect(p/'recording.sqlite') as db:
                db.execute('CREATE TABLE channel_metrics (' + ','.join(c+' TEXT' for c in cols) + ')')
                db.execute('INSERT INTO channel_metrics VALUES (' + ','.join('?' for _ in cols) + ')',
                           ['rec','P','acq',1,1,'O1',10,40,.8,1,'Included'])
            db.close()
            data, truncated = Reader(p).csv_lines('channel_metrics')
            rows = list(csv.reader(io.StringIO(data.decode())))
            self.assertFalse(truncated)
            self.assertEqual(rows[0],cols)
            self.assertEqual(len(rows[1]),len(cols))
