import csv
import io
import json
import os
import sqlite3
import tempfile
import time
import unittest
import uuid
import zipfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np

from backend.main import Service, CHANNELS, RATE, TIMESTAMP
from backend.research import schema
from backend.research.destinations import Destinations
from backend.research.recorder import ResearchRecorder, Conflict, Forbidden
from backend.research import recorder as recmod
from backend.research.store import Store, Reader
from backend.signal import analyze

ELECTRODES = ['Fp1', 'Fp2', 'C3', 'C4', 'P3', 'O1', 'Oz', 'O2']


def block(start, count, t0=1_700_000_000.0, nan_at=None, freq=10.0):
    data = np.zeros((24, count))
    n = np.arange(start, start + count)
    t = n / RATE
    rng = np.random.default_rng(start)
    for k, ch in enumerate(CHANNELS):
        data[ch] = (12 + 6 * np.sin(t * .25)) * np.sin(2 * np.pi * freq * t + k) + 10 * np.sin(2 * np.pi * 20 * t) \
            + rng.normal(0, 2, count)
    if nan_at is not None:
        data[CHANNELS[2], nan_at] = np.nan
    data[TIMESTAMP] = t0 + t
    data[0] = n % 256
    return data


class Rig:
    """A Service with a fake live board and a research recorder in a temp folder."""

    def __init__(self, tmp, fmt='csv'):
        self.tmp = Path(tmp)
        self.dest = Destinations(self.tmp / 'research', repo=self.tmp / 'repo')
        (self.tmp / 'repo').mkdir(parents=True, exist_ok=True)
        self.s = Service()
        self.s.research = ResearchRecorder(RATE, 8, self.dest)
        self.store = Store(self.dest, lambda: self.s.research.rec.id if self.s.research.rec else None)
        self.fmt = fmt
        self.n = 0
        self.wall = [1_700_000_000.0]

    def connect_live(self):
        s = self.s
        s.stop('Input source changed or reconnected')
        s.source = 'live'
        s.session_id = str(uuid.uuid4())
        s.reset_data()
        s.board = MagicMock()
        s.enabled = True
        s.started_at = 100
        s.board_name = 'CYTON_BOARD'
        s.research.on_acquisition_start(s.session_id, 'live', board='CYTON_BOARD')
        self.n = 0

    def start(self, participant='P007', **kw):
        rec = self.s.research.start(participant, kw.pop('fmt', self.fmt), 'default', kw.pop('condition', 'pilot'),
                                    ELECTRODES, 'earlobe', snapshot=self.s.research_snapshot(), **kw)
        return rec

    def feed(self, seconds, chunk=62, **kw):
        total = int(seconds * RATE)
        with patch('backend.main.time.monotonic', return_value=101):
            while total > 0:
                k = min(chunk, total)
                self.s.ingest(block(self.n, k, **kw))
                self.s.sequence += 1
                self.s.log_frame()
                self.n += k
                total -= k

    def finish(self, rec):
        self.s.research.stop(rec.id, rec.token)
        self.s.research.wait_finished(30)
        return self.store.folder(rec.id)


def read_csv(folder, table):
    with open(folder / f'{table}.csv', encoding='utf-8', newline='') as f:
        return list(csv.DictReader(f))


class StorageTests(unittest.TestCase):
    def test_every_sample_once_with_flags_and_breaks_not_filled(self):
        with tempfile.TemporaryDirectory() as tmp:
            rig = Rig(tmp)
            rig.connect_live()
            rec = rig.start()
            with patch('backend.main.time.monotonic', return_value=101):
                sizes = [37, 61, 250, 5, 120, 77]
                for k in sizes:
                    d = block(rig.n, k, nan_at=3 if k == 61 else None)
                    rig.s.ingest(d)
                    rig.n += k
                # Packet loss: skip 4 samples (counter and timestamp jump), never filled in.
                rig.n += 4
                rig.s.ingest(block(rig.n, 50))
                rig.n += 50
            folder = rig.finish(rec)
            rows = read_csv(folder, 'eeg')
            idx = [int(r['sample_index']) for r in rows]
            self.assertEqual(len(idx), sum(sizes) + 50)
            self.assertEqual(len(set(idx)), len(idx), 'no duplicates')
            self.assertEqual(idx[:sum(sizes)], list(range(sum(sizes))))
            # Recorded index is the acquired sequence; lost radio samples are not invented.
            bad = [r for r in rows if r['all_finite'] == '0']
            self.assertEqual(len(bad), 1)
            self.assertEqual(bad[0]['nonfinite_channels'], '3')
            self.assertEqual(bad[0]['ch3_uv'], '')
            batches = read_csv(folder, 'batches')
            self.assertEqual(len(batches), len(sizes) + 1)
            self.assertGreaterEqual(int(batches[-1]['discontinuity_count']), 1)
            meta = json.loads((folder / 'metadata.json').read_text())
            self.assertEqual(meta['state'], 'saved')

    def test_windows_frames_and_calibration_link_to_the_live_computation(self):
        with tempfile.TemporaryDirectory() as tmp:
            rig = Rig(tmp)
            rig.connect_live()
            rig.feed(3)
            rec = rig.start()
            with patch('backend.main.time.monotonic', return_value=101):
                rig.s.begin_calibration()
            rig.feed(61, chunk=125)
            self.assertIsNotNone(rig.s.cal.center)
            rig.feed(5)
            buf = rig.s.buffer.copy()
            folder = rig.finish(rec)
            cals = read_csv(folder, 'calibrations')
            self.assertEqual([c['result'] for c in cals], ['accepted'])
            self.assertAlmostEqual(float(cals[0]['center']), rig.s.cal.center, places=12)
            windows = read_csv(folder, 'signal_windows')
            base = [w for w in windows if w['purpose'] == 'baseline']
            self.assertEqual(len(base), int(cals[0]['accepted_windows']) + int(cals[0]['rejected_windows']))
            play = [w for w in windows if w['purpose'] == 'play']
            last = play[-1]
            value, details = analyze(buf, RATE)
            self.assertAlmostEqual(float(last['relative_alpha']), value, places=12)
            self.assertAlmostEqual(float(last['published_score']), rig.s.cal.score, places=12)
            self.assertEqual(last['calibration_id'], cals[0]['calibration_id'])
            metrics = [m for m in read_csv(folder, 'channel_metrics') if m['window_id'] == last['window_id']]
            ratios = [float(m['relative_alpha']) for m in metrics if m['included'] == '1']
            self.assertAlmostEqual(float(np.median(ratios)), value, places=12)
            frames = read_csv(folder, 'input_frames')
            linked = [f for f in frames if f['window_id'] == last['window_id']]
            self.assertTrue(linked)
            self.assertAlmostEqual(float(linked[-1]['score']), float(last['published_score']), places=12)
            acq = read_csv(folder, 'acquisitions')
            self.assertEqual(acq[0]['partial_start'], '1', 'recording began mid-stream')

    def test_formats_have_identical_logical_rows_and_identical_csv_zip(self):
        with tempfile.TemporaryDirectory() as tmp:
            zips = {}
            for fmt in ('csv', 'sqlite', 'both'):
                rig = Rig(Path(tmp) / fmt, fmt)
                rig.connect_live()
                rec = rig.start(condition='eyes open')
                rig.feed(2.5, nan_at=None)
                rig.s.research.items(rec.id, rec.token, [
                    dict(seq=1, kind='clock', t_browser_ms=1e12, offset_ms=1.5, rtt_ms=2.0, samples=10, spread_ms=0.4),
                    dict(seq=2, kind='event', event_id='e1', type='marker', t_browser_ms=1e12 + 5,
                         reason='=HYPERLINK("x") — ünïcode, "quoted"'),
                    dict(seq=3, kind='state', game='garden', round_id='r1', kind_='snapshot', t_browser_ms=1e12 + 9,
                         garden_growth=0.25, running=True)])
                folder = rig.finish(rec)
                meta = json.loads((folder / 'metadata.json').read_text())
                self.assertEqual(meta['state'], 'saved', meta)
                if fmt == 'both':
                    self.assertTrue(meta['parity']['matched'])
                path, _ = rig.store.export_zip(rec.id)
                with zipfile.ZipFile(path) as z:
                    files = {Path(n).name: z.read(n) for n in z.namelist()}
                zips[fmt] = files
            for t in schema.ORDER:
                a = zips['csv'][f'{t}.csv'].split(b'\n', 1)[1]
                # Same fixture content; ids differ per recording, so compare row counts and shape.
                self.assertEqual(zips['csv'][f'{t}.csv'].count(b'\n'), zips['sqlite'][f'{t}.csv'].count(b'\n'), t)
                self.assertEqual(zips['both'][f'{t}.csv'].count(b'\n'), zips['sqlite'][f'{t}.csv'].count(b'\n'), t)
            ev = zips['sqlite']['events.csv'].decode('utf-8')
            self.assertIn('"\'=HYPERLINK(""x"") — ünïcode, ""quoted"""', ev)
            man = json.loads(zips['both']['manifest.json'])
            self.assertTrue(man['complete'])
            self.assertIn('data_dictionary.md', zips['csv'])
            self.assertNotIn('local_folder', json.loads(zips['csv']['metadata.json']))
            self.assertNotIn(tmp.encode(), zips['csv']['metadata.json'])

    def test_sqlite_export_is_byte_identical_to_csv_for_the_same_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            rig = Rig(tmp, 'both')
            rig.connect_live()
            rec = rig.start()
            rig.feed(3)
            folder = rig.finish(rec)
            db = sqlite3.connect(folder / 'recording.sqlite')
            for t in schema.ORDER:
                from_db = [schema.header(t)] + [schema.row_line(t, r) for r in db.execute(f'SELECT * FROM "{t}" ORDER BY rowid')]
                self.assertEqual(('\n'.join(from_db) + '\n').encode(), (folder / f'{t}.csv').read_bytes(), t)


class LifecycleTests(unittest.TestCase):
    def test_busy_clock_sync_is_logged_but_not_used_and_window_includes_lagging_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            rig = Rig(tmp)
            rig.connect_live()
            rec = rig.start()
            r = rig.s.research
            clock = lambda seq, off, rtt: dict(seq=seq, kind='clock', t_browser_ms=1e12, offset_ms=off, rtt_ms=rtt,
                                                 samples=5, spread_ms=1)
            r.items(rec.id, rec.token, [clock(1, -2.0, 4.0), clock(2, -450.0, 900.0), clock(3, -3.0, 6.0)])
            self.assertEqual(rec.clock['offset_ms'], -3.0)
            r.items(rec.id, rec.token, [clock(4, 80.0, 5.0)])  # a clock jump (e.g. system time changed)
            self.assertEqual(rec.clock['offset_ms'], 80.0)
            rig.feed(4)
            # An event that used an old frame: the window around the event still returns that frame.
            seq_old = 2
            r.items(rec.id, rec.token, [dict(seq=5, kind='event', event_id='late', type='cairn_fell', game='cairn',
                                             round_id='R1', t_browser_ms=time.time() * 1000 + 3.0,
                                             input=dict(acquisition_id=rig.s.session_id, sequence=seq_old))])
            folder = rig.finish(rec)
            syncs = read_csv(folder, 'clock_sync')
            self.assertIn('not used', syncs[1]['method'])
            self.assertIn('used', syncs[2]['method'])
            self.assertEqual([e['type'] for e in read_csv(folder, 'events')].count('clock_jump'), 1)
            fell = [e for e in read_csv(folder, 'events') if e['type'] == 'cairn_fell'][0]
            t = float(fell['est_server_wall_s'])
            w = rig.store.window(rec.id, t - 0.5, t + 0.5)
            self.assertIn(seq_old, [f['sequence'] for f in w['frames']])
            # The windowed EEG read (batch row spans) matches a full scan.
            eeg = read_csv(folder, 'eeg')
            ts = sorted(float(e['source_timestamp_s']) for e in eeg)
            a, b = ts[len(ts) // 4], ts[len(ts) // 2]
            w2 = rig.store.window(rec.id, a, b)
            self.assertEqual(w2['eeg_samples_in_range'], sum(1 for x in ts if a <= x <= b))
            data, name = rig.store.table_csv(rec.id, 'events')
            self.assertTrue(data.startswith(b'recording_id,'))
            self.assertNotIn(tmp, name)

    def test_items_are_idempotent_gaps_logged_rounds_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            rig = Rig(tmp)
            rig.connect_live()
            rec = rig.start()
            r = rig.s.research
            item = dict(seq=1, kind='event', event_id='a', type='round_started', game='cairn', round_id='R1',
                        t_browser_ms=1e12, payload=dict(mode='calm'))
            self.assertEqual(r.items(rec.id, rec.token, [item])['ack'], 1)
            self.assertEqual(r.items(rec.id, rec.token, [item])['ack'], 1)  # retry: no duplicate
            r.items(rec.id, rec.token, [dict(seq=4, kind='event', event_id='b', type='cairn_fell', game='cairn',
                                             round_id='R1', t_browser_ms=1e12 + 10, payload=dict(cause='sway'))])
            r.items(rec.id, rec.token, [dict(seq=5, kind='event', event_id='b', type='cairn_fell', t_browser_ms=1)])
            r.items(rec.id, rec.token, [dict(seq=6, kind='event', event_id='c', type='round_started', game='garden',
                                             round_id='G1', t_browser_ms=1e12 + 20)])
            with self.assertRaises(Forbidden):
                r.items(rec.id, 'wrong', [])
            with self.assertRaises(Conflict):
                rig.start()
            folder = rig.finish(rec)
            events = read_csv(folder, 'events')
            types = [e['type'] for e in events]
            self.assertEqual(types.count('round_started'), 2)
            self.assertEqual(types.count('cairn_fell'), 1)
            self.assertEqual(types.count('sequence_gap'), 1)
            rounds = read_csv(folder, 'rounds')
            self.assertEqual(sorted(x['outcome'] for x in rounds), ['capture_ended', 'capture_ended'])
            meta = json.loads((folder / 'metadata.json').read_text())
            self.assertEqual(len(meta['losses']), 1, 'the sequence gap is a recorded loss')
            self.assertEqual(meta['state'], 'incomplete')

    def test_reconnect_keeps_recording_with_distinct_acquisitions(self):
        with tempfile.TemporaryDirectory() as tmp:
            rig = Rig(tmp)
            rig.connect_live()
            rec = rig.start()
            rig.feed(1)
            first = rig.s.session_id
            rig.connect_live()
            rig.feed(1)
            folder = rig.finish(rec)
            acq = read_csv(folder, 'acquisitions')
            self.assertEqual(len(acq), 2)
            self.assertEqual(acq[0]['acquisition_id'], first)
            self.assertIn('source changed', acq[0]['end_reason'])
            self.assertEqual(acq[1]['end_reason'], 'capture_ended')
            eeg = read_csv(folder, 'eeg')
            keys = {(e['acquisition_id'], e['sample_index']) for e in eeg}
            self.assertEqual(len(keys), len(eeg))
            self.assertEqual(len(eeg), 2 * RATE)

    def test_stop_with_undelivered_browser_items_is_incomplete(self):
        with tempfile.TemporaryDirectory() as tmp:
            rig = Rig(tmp)
            rec = rig.start()
            rig.s.research.stop(rec.id, rec.token, unsent_items=3)
            rig.s.research.wait_finished(30)
            meta = json.loads((rig.store.folder(rec.id) / 'metadata.json').read_text())
            self.assertEqual(meta['state'], 'incomplete')
            self.assertEqual(meta['losses'][-1]['count'], 3)

    def test_owner_loss_finalizes_incomplete(self):
        with tempfile.TemporaryDirectory() as tmp:
            rig = Rig(tmp)
            t = [100.0]
            rig.s.research.clock = lambda: t[0]
            rig.connect_live()
            rec = rig.start()
            t[0] += 6
            rig.s.research.check()
            rig.s.research.wait_finished(30)
            meta = json.loads((rig.store.folder(rec.id) / 'metadata.json').read_text())
            self.assertEqual(meta['state'], 'incomplete')
            self.assertIn('Owner tab lost', meta['end_reason'])
            with self.assertRaises(KeyError):
                rig.s.research.heartbeat(rec.id, rec.token)

    def test_queue_overflow_and_disk_failure_stop_visibly(self):
        with tempfile.TemporaryDirectory() as tmp:
            rig = Rig(tmp)
            rig.connect_live()
            rec = rig.start()
            gate = __import__('threading').Event()
            rec.writer.q.maxsize = 3
            real = rec.writer.sinks[0].append
            rec.writer.sinks[0].append = lambda t, rows: (gate.wait(5), real(t, rows))
            rig.feed(2)
            self.assertNotEqual(rec.state, 'recording')
            gate.set()
            rig.s.research.wait_finished(30)
            meta = json.loads((rig.store.folder(rec.id) / 'metadata.json').read_text())
            self.assertEqual(meta['state'], 'incomplete')
            self.assertIn('queue full', meta['end_reason'])
            rec2 = rig.start()

            def broken(t, rows):
                raise OSError('No space left on device')
            rec2.writer.sinks[0].append = broken
            rig.feed(0.5)
            time.sleep(0.5)
            rig.s.research.check()
            rig.s.research.wait_finished(30)
            meta = json.loads((rig.store.folder(rec2.id) / 'metadata.json').read_text())
            self.assertEqual(meta['state'], 'failed')
            self.assertIn('No space left', meta['end_reason'])

    def test_crash_recovery_never_reports_complete_and_exports_prefix(self):
        with tempfile.TemporaryDirectory() as tmp:
            rig = Rig(tmp)
            rig.connect_live()
            rec = rig.start()
            rig.feed(1)
            time.sleep(1.3)  # writer flushes within ~1 s
            rec.writer.q.put(('__flush__', None))
            time.sleep(0.3)
            folder = rig.store.folder(rec.id)
            with open(folder / 'eeg.csv', 'a') as f:
                f.write('truncated,partial')  # a torn last line
            # Simulate a backend crash: abandon the recorder without finalizing.
            rig.s.research.rec = None
            fixed = rig.store.recover()
            self.assertEqual(fixed, [rec.id])
            meta = json.loads((folder / 'metadata.json').read_text())
            self.assertEqual(meta['state'], 'recovered_incomplete')
            path, _ = rig.store.export_zip(rec.id)
            with zipfile.ZipFile(path) as z:
                man = json.loads(z.read([n for n in z.namelist() if n.endswith('manifest.json')][0]))
            self.assertFalse(man['complete'])
            self.assertTrue(man['files']['eeg.csv']['truncated_tail_dropped'])
            self.assertEqual(man['files']['eeg.csv']['rows'], RATE)
            # The open acquisition segment is rebuilt from its start event, marked as recovered.
            acq = read_csv(folder, 'acquisitions')
            self.assertEqual(len(acq), 1)
            self.assertEqual(acq[0]['source'], 'live')
            self.assertEqual(acq[0]['end_reason'], 'recovered_after_crash')

    def test_score_only_simulation_writes_frames_but_no_eeg(self):
        with tempfile.TemporaryDirectory() as tmp:
            rig = Rig(tmp)
            s = rig.s
            s.connect(MagicMock(source='synthetic', recording='', serial_port=''))
            rec = rig.start()
            for _ in range(5):
                s.tick()
            folder = rig.finish(rec)
            self.assertEqual(read_csv(folder, 'eeg'), [])
            frames = read_csv(folder, 'input_frames')
            self.assertEqual(len(frames), 5)
            self.assertTrue(all(f['source'] == 'synthetic' and f['window_id'] == '' for f in frames))
            self.assertEqual(read_csv(folder, 'acquisitions')[0]['source'], 'synthetic')

    def test_simulated_eeg_is_labelled_in_every_relevant_table(self):
        with tempfile.TemporaryDirectory() as tmp:
            rig = Rig(tmp)
            s = rig.s
            rec = rig.start()
            s.connect(MagicMock(source='simulated_eeg', recording='', serial_port=''))
            time.sleep(0.6)
            s.tick()
            folder = rig.finish(rec)
            acq = read_csv(folder, 'acquisitions')
            self.assertEqual(acq[0]['source'], 'simulated_eeg')
            self.assertIn('no headset', acq[0]['source_label'])
            self.assertGreater(len(read_csv(folder, 'eeg')), 100)
            self.assertTrue(all(f['source'] == 'simulated_eeg' for f in read_csv(folder, 'input_frames')))
            s.stop()


class DestinationTests(unittest.TestCase):
    def test_destination_rules_and_path_confinement(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            repo = tmp / 'repo'
            (repo / 'src').mkdir(parents=True)
            (repo / 'data').mkdir()
            d = Destinations(tmp / 'research', repo=repo)
            with self.assertRaises(ValueError):
                d.add('Rel', 'relative/path')
            with self.assertRaises(ValueError):
                d.add('Missing', str(tmp / 'nope'))
            with self.assertRaises(ValueError):
                d.add('Repo', str(repo / 'src'))  # inside checkout, not ignored
            ok = d.add('Ignored', str(repo / 'data'))
            ext = tmp / 'usb'
            ext.mkdir()
            ext2 = d.add('USB', str(ext))
            link = tmp / 'link'
            os.symlink(ext, link)
            with self.assertRaises(ValueError):  # symlink resolves to an already registered folder
                d.add('Link', str(link))
            self.assertTrue(d.probe(ext2['id'])['writable'])
            for bad in ['../x', '..', 'abc', '', '00000000-0000-0000-0000-000000000000/..']:
                with self.assertRaises(ValueError):
                    d.recording_folder(ext2['id'], bad)
            ext.rename(tmp / 'usb-removed')
            with self.assertRaises(FileNotFoundError):
                d.probe(ext2['id'])
            self.assertFalse([x for x in d.all() if x['id'] == ext2['id']][0]['available'])
            self.assertIn(ok['id'], [x['id'] for x in d.all()])

    def test_history_lists_recordings_across_destinations(self):
        with tempfile.TemporaryDirectory() as tmp:
            rig = Rig(tmp)
            ext = Path(tmp) / 'second'
            ext.mkdir()
            dest = rig.dest.add('Second', str(ext))
            rig.connect_live()
            a = rig.start('P001')
            rig.finish(a)
            b = rig.s.research.start('P002', 'sqlite', dest['id'], '', ELECTRODES, '', snapshot=rig.s.research_snapshot())
            rig.feed(0.5)
            rig.finish(b)
            hist = rig.store.history()
            self.assertEqual([h['participant_id'] for h in hist], ['P002', 'P001'])
            self.assertTrue(all(h['exportable'] for h in hist))
            self.assertTrue((ext / b.id / 'recording.sqlite').exists())


class ApiTests(unittest.TestCase):
    """Endpoint functions called directly (no HTTP client dependency)."""

    def test_mutual_exclusion_local_only_destinations_and_export_rules(self):
        import asyncio
        from fastapi import HTTPException
        import backend.main as m
        with tempfile.TemporaryDirectory() as tmp:
            dest = Destinations(Path(tmp) / 'research', repo=Path(tmp) / 'repo')
            old, old_store = m.service.research, m.research_store
            m.service.research = ResearchRecorder(RATE, 8, dest)
            m.research_store = Store(dest, lambda: m.service.research.rec.id if m.service.research.rec else None)
            try:
                rec = asyncio.run(m.research_start(m.ResearchStartRequest(participant_id='P1', storage_format='csv')))
                with self.assertRaises(HTTPException) as e:
                    asyncio.run(m.research_start(m.ResearchStartRequest(participant_id='P2')))
                self.assertEqual(e.exception.status_code, 409)
                # Experiments are blocked while research records.
                exp = m.StartRequest(kind='bilateral', electrodes=[''] * 8, clock=dict(offset_ms=0, rtt_ms=1),
                                     bilateral=dict(interval_ms=1000, fixation_pre_s=10, alternating_s=10,
                                                    fixation_post_s=10, instruction='fixate'))
                with self.assertRaises(HTTPException) as e:
                    asyncio.run(m.experiment_start(exp))
                self.assertEqual(e.exception.status_code, 409)
                remote = MagicMock(client=MagicMock(host='192.168.1.20'), headers={})
                with self.assertRaises(HTTPException) as e:
                    m.require_local(remote)
                self.assertEqual(e.exception.status_code, 403)
                evil = MagicMock(client=MagicMock(host='127.0.0.1'), headers={'origin': 'http://evil.example'})
                with self.assertRaises(HTTPException):
                    m.require_local(evil)
                m.require_local(MagicMock(client=MagicMock(host='127.0.0.1'), headers={'origin': 'http://127.0.0.1:5173'}))
                with self.assertRaises(HTTPException) as e:
                    m.research_export(rec['id'])
                self.assertEqual(e.exception.status_code, 409)
                with self.assertRaises(HTTPException) as e:
                    m.research_stop(rec['id'], m.ResearchStop(token='x'))
                self.assertEqual(e.exception.status_code, 403)
                m.research_stop(rec['id'], m.ResearchStop(token=rec['token']))
                m.service.research.wait_finished(30)
                resp = m.research_export(rec['id'])
                self.assertTrue(str(resp.path).endswith('.zip'))
                with self.assertRaises(HTTPException) as e:
                    m.research_export('../../etc')
                self.assertEqual(e.exception.status_code, 404)
            finally:
                m.service.research, m.research_store = old, old_store


if __name__ == '__main__':
    unittest.main()
