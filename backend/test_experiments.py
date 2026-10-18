import json
import re
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np

from backend import experiments as ex
from backend.experiments import ExperimentManager, Conflict, Forbidden
from backend.experiment_recording import experiment_dir
from backend.main import Service, CHANNELS, RATE, TIMESTAMP, StartRequest, validate_start
from backend.simulated import SimulatedBoard

NAMES = ['Fp1', 'Fp2', 'C3', 'C4', 'P7', 'O1', 'Oz', 'O2']
CLOCK = dict(offset_ms=0.0, rtt_ms=2.0, samples=10)


def bilateral_config(**kw):
    return dict(kind='bilateral', participant='P01', electrodes=NAMES, reference='earlobe', clock=CLOCK,
                bilateral=dict(interval_ms=1000, fixation_pre_s=10, alternating_s=10, fixation_post_s=10,
                               instruction='follow', condition_order='follow-first'), **kw)


def ssvep_config():
    return dict(kind='ssvep', participant='P01', electrodes=NAMES, reference='earlobe', clock=CLOCK,
                ssvep=dict(frequencies_hz=[10.0, 12.0, 15.0], frames_per_cycle=[6, 5, 4], channels=[5, 6, 7],
                           stimulation_s=4, cue_s=1, rest_s=2, luminance_mean=0.5, luminance_amplitude=0.4, seed=7,
                           display=dict(passed=True, profile_hz=60, measured_hz=60.0, median_interval_ms=16.67,
                                        long_interval_fraction=0.0, max_interval_ms=17.0, preflight_seconds=5,
                                        frames=300, criteria={})))


class Feed:
    """Deterministic full-rate source with timestamps on the current wall clock."""

    def __init__(self, t0=1_000_000.0, seed=0):
        self.t0 = t0
        self.n = 0
        self.rng = np.random.default_rng(seed)
        self.freq = None

    def block(self, count):
        idx = self.n + np.arange(count)
        t = idx / RATE
        eeg = self.rng.normal(0, 5, (8, count))
        eeg += 6 * np.sin(2 * np.pi * 10.3 * t)  # alpha-like background
        if self.freq:
            for c in (5, 6, 7):
                eeg[c] += 4 * (np.sin(2 * np.pi * self.freq * t + c) + 0.5 * np.sin(2 * np.pi * 2 * self.freq * t))
        ts = self.t0 + t
        self.n += count
        return idx[0], eeg, ts, idx % 256

    def push(self, manager, seconds, chunk=62):
        total = int(seconds * RATE)
        while total > 0:
            k = min(chunk, total)
            start, eeg, ts, counters = self.block(k)
            manager.on_samples(int(start), eeg, ts, counters, [], float(ts[-1]))
            total -= k

    def now_ms(self):
        return (self.t0 + self.n / RATE) * 1000


def wait(exp, timeout=20):
    assert exp.finished.wait(timeout), 'recording did not finalize'


def drain(exp, timeout=10):
    """Wait until both worker queues are empty (deterministic tests)."""
    end = time.time() + timeout
    while time.time() < end:
        if exp.analyzer.q.unfinished_tasks == 0 or exp.analyzer.q.empty():
            if exp.writer.queue.empty():
                time.sleep(0.05)
                if exp.analyzer.q.empty() and exp.writer.queue.empty():
                    return
        time.sleep(0.01)


class ManagerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / 'experiments'
        self.t = [100.0]
        self.m = ExperimentManager(RATE, 8, self.root, clock=lambda: self.t[0])

    def tearDown(self):
        self.tmp.cleanup()

    def start(self, cfg=None, source='simulated_eeg'):
        cfg = cfg or bilateral_config()
        return self.m.start(cfg['kind'], cfg, 'session-1', source, True)

    def test_prerequisites_and_single_active_experiment(self):
        with self.assertRaises(ValueError):
            self.m.start('bilateral', bilateral_config(), None, 'live', True)
        with self.assertRaises(ValueError):  # score-only simulation has no raw EEG
            self.m.start('bilateral', bilateral_config(), 's', 'synthetic', True)
        with self.assertRaises(ValueError):
            self.m.start('bilateral', bilateral_config(), 's', 'live', False)
        exp = self.start()
        with self.assertRaises(Conflict):
            self.start()
        with self.assertRaises(Forbidden):
            self.m.heartbeat(exp.id, 'wrong-token')
        with self.assertRaises(Forbidden):
            self.m.stop(exp.id, 'wrong-token')
        self.m.stop(exp.id, exp.token)
        wait(exp)

    def test_saved_samples_and_events_match_ingestion_exactly(self):
        exp = self.start()
        feed = Feed()
        feed.push(self.m, 3.0, chunk=37)
        events = [dict(id=1, type='run_start', t_browser_ms=feed.now_ms()),
                  dict(id=2, type='phase_start', phase='fixation_pre', t_browser_ms=feed.now_ms())]
        self.m.events(exp.id, exp.token, events)
        feed.push(self.m, 2.2, chunk=61)
        self.m.events(exp.id, exp.token, [dict(id=3, type='side', side='left', n=1, t_browser_ms=feed.now_ms()),
                                          dict(id=5, type='side', side='right', n=2, t_browser_ms=feed.now_ms())])
        with self.assertRaises(ValueError):  # duplicate id
            self.m.events(exp.id, exp.token, [dict(id=5, type='side', t_browser_ms=1.0)])
        with self.assertRaises(ValueError):  # out of order
            self.m.events(exp.id, exp.token, [dict(id=4, type='side', t_browser_ms=1.0)])
        with self.assertRaises(ValueError):  # unknown type
            self.m.events(exp.id, exp.token, [dict(id=9, type='robot_go', t_browser_ms=1.0)])
        self.m.frames(exp.id, exp.token, dict(trial_id='t1', profile_hz=60, frames=[[0, 1.0, .5, .5, .5]] * 10))
        status = self.m.stop(exp.id, exp.token, 'Run complete', completed=True)
        self.assertEqual(status['state'], 'completed')
        again = self.m.stop(exp.id, exp.token)  # idempotent
        self.assertEqual(again['state'], 'completed')
        wait(exp)
        folder = experiment_dir(self.root, exp.id)
        rows = (folder / 'eeg.csv').read_text().strip().split('\n')
        self.assertEqual(rows[0].split(',')[:3], ['sample_index', 'timestamp_s', 'packet_counter'])
        idx = [int(r.split(',')[0]) for r in rows[1:]]
        self.assertEqual(len(idx), feed.n)
        self.assertEqual(idx, list(range(feed.n)))
        self.assertEqual(len(rows[1].split(',')), 3 + 8)
        evs = [json.loads(l) for l in (folder / 'events.jsonl').read_text().splitlines()]
        self.assertEqual([e['id'] for e in evs], [1, 2, 3, 5])
        self.assertTrue(all('software-only' in e['alignment']['method'] for e in evs))
        # Phase start was sent when 750 samples had been delivered.
        self.assertAlmostEqual(evs[1]['alignment']['sample_index'], 750, delta=2)
        meta = json.loads((folder / 'metadata.json').read_text())
        summary = json.loads((folder / 'summary.json').read_text())
        self.assertEqual(meta['state'], 'completed')
        self.assertEqual(meta['participant'], 'P01')
        self.assertIn('Optical timing is unverified', meta['timing_note'])
        self.assertEqual(summary['recording']['samples'], feed.n)
        self.assertEqual(summary['recording']['events'], 4)
        self.assertEqual(summary['recording']['frames'], 10)
        self.assertEqual(summary['recording']['state'], 'saved')
        self.assertEqual(summary['analysis']['side_changes'], 2)
        self.assertEqual(self.m.describe(exp)['saved'], True)

    def test_heartbeat_loss_interrupts_without_resume_and_keeps_partial_recording(self):
        exp = self.start()
        feed = Feed()
        feed.push(self.m, 1.0)
        self.t[0] += 1.0
        self.m.heartbeat(exp.id, exp.token)
        self.t[0] += 2.5
        self.m.check(receiving=True)
        self.assertIsNone(self.m.active)
        self.assertEqual(exp.state, 'interrupted')
        self.assertIn('heartbeat', exp.reason)
        with self.assertRaises(KeyError):  # cannot resume by heartbeating
            self.m.heartbeat(exp.id, exp.token)
        feed.push(self.m, 1.0)  # later samples are not recorded into the ended experiment
        wait(exp)
        summary = json.loads((experiment_dir(self.root, exp.id) / 'summary.json').read_text())
        self.assertEqual(summary['recording']['samples'], RATE)
        self.assertEqual(summary['state'], 'interrupted')

    def test_stale_eeg_flag_and_session_interrupts(self):
        exp = self.start()
        Feed().push(self.m, 0.5)
        self.t[0] += 3
        self.m.heartbeat(exp.id, exp.token)
        self.m.check(receiving=False)
        self.assertTrue(exp.stale)
        self.assertEqual(exp.state, 'running')
        self.m.interrupt('Input source changed or reconnected')
        self.assertEqual(exp.state, 'interrupted')
        wait(exp)
        exp2 = self.start()
        self.m.check(receiving=True, at_end=True)
        self.assertEqual(exp2.reason, 'Recording reached its end')
        wait(exp2)

    def test_queue_overflow_and_write_errors_fail_visibly(self):
        exp = self.start()
        gate = __import__('threading').Event()
        real = exp.writer._handle
        exp.writer._handle = lambda k, p: (gate.wait(5), real(k, p))  # a stalled disk
        exp.writer.queue.maxsize = 2
        Feed().push(self.m, 2.0)  # ~8 batches against a stalled writer that holds at most 3
        self.assertEqual(exp.state, 'failed')
        self.assertIn('queue full', exp.reason)
        gate.set()
        wait(exp)
        self.assertEqual(exp.writer.state, 'saved')  # what was queued is still written and finalized
        exp2 = self.start()

        def broken(kind, payload):
            raise OSError('No space left on device')
        exp2.writer._handle = broken
        Feed().push(self.m, 0.3)
        drain(exp2)
        self.m.check(receiving=True)
        self.assertEqual(exp2.state, 'failed')
        self.assertIn('No space left', exp2.reason)
        wait(exp2)
        self.assertFalse(self.m.describe(exp2)['saved'])
        self.assertEqual(exp2.writer.state, 'failed')

    def test_paths_are_confined_to_the_recording_root(self):
        for bad in ['../etc', '..', '', 'abc', '../../x/y', '00000000-0000-0000-0000-00000000000/..']:
            with self.assertRaises(ValueError):
                experiment_dir(self.root, bad)
        with self.assertRaises((KeyError, ValueError)):
            self.m.folder('12345678-1234-1234-1234-123456789abc')
        exp = self.start()
        with self.assertRaises(Conflict):  # cannot export while running
            self.m.folder(exp.id)
        self.m.stop(exp.id, exp.token)
        wait(exp)
        self.assertTrue(self.m.folder(exp.id).is_dir())
        self.assertTrue(self.m.recent()[0]['complete'])


class SsvepPipelineTests(unittest.TestCase):
    """End-to-end through events → alignment → windows → thresholds → evaluation.
    Signals are generated from a known frequency: pipeline evidence, not accuracy evidence."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.m = ExperimentManager(RATE, 8, Path(self.tmp.name), clock=time.monotonic)
        cfg = ssvep_config()
        self.exp = self.m.start('ssvep', cfg, 'session-1', 'simulated_eeg', True)
        self.feed = Feed(seed=3)
        self.eid = 0

    def tearDown(self):
        self.tmp.cleanup()

    def send(self, type_, **kw):
        self.eid += 1
        self.m.events(self.exp.id, self.exp.token, [dict(id=self.eid, type=type_, t_browser_ms=self.feed.now_ms(), **kw)])

    def trial(self, tid, block, requested, gaze):
        self.send('trial_cue', trial_id=tid, block=block, requested=requested)
        self.feed.push(self.m, 1.0)
        self.feed.freq = gaze
        self.send('stim_onset', trial_id=tid, frame=0)
        self.feed.push(self.m, 4.0)
        self.send('stim_offset', trial_id=tid, frame=240)
        self.feed.freq = None
        self.feed.push(self.m, 1.0)
        drain(self.exp)

    def test_setup_then_frozen_evaluation_with_neutral_and_interruption(self):
        freqs = [10.0, 12.0, 15.0]
        self.feed.push(self.m, 2.0)
        k = 0
        for rep in range(5):
            for target in range(3):
                k += 1
                self.trial(f's{k}', 'setup', target, freqs[target])
        for rep in range(10):
            k += 1
            self.trial(f's{k}', 'setup', 'neutral', None)
        snap = self.m.telemetry()['analysis']
        self.assertFalse(snap['thresholds_ready'])
        self.assertIsNone(snap['last_decision']['decision'], 'diagnostic-only before thresholds')
        th = self.m.select_thresholds(self.exp.id, self.exp.token)
        self.assertTrue(th['ready'], th)
        self.assertEqual(th['setup_neutral_false_activations'], 0)
        with self.assertRaises(Conflict):
            self.m.select_thresholds(self.exp.id, self.exp.token)
        for rep in range(3):
            for target in range(3):
                k += 1
                self.trial(f'e{k}', 'evaluation', target, freqs[target])
            k += 1
            self.trial(f'e{k}', 'evaluation', 'neutral', None)
        # An interrupted trial never yields a decision.
        k += 1
        self.send('trial_cue', trial_id=f'e{k}', block='evaluation', requested=0)
        self.feed.freq = 10.0
        self.send('stim_onset', trial_id=f'e{k}', frame=0)
        self.feed.push(self.m, 1.5)
        self.send('trial_interrupted', trial_id=f'e{k}', reason='Frame interval exceeded 1.5× median')
        drain(self.exp)
        counts = self.m.telemetry()['analysis']['counts']['evaluation']
        self.assertEqual(counts['trials'], 13)
        self.assertEqual(counts['interrupted'], 1)
        self.assertEqual(counts['neutral_trials'], 3)
        self.assertGreaterEqual(counts['correct'], 8)
        self.assertEqual(counts['correct'] + counts['incorrect'] + counts['abstained'] + counts['invalid'], 9)
        self.m.stop(self.exp.id, self.exp.token, completed=True)
        wait(self.exp)
        folder = experiment_dir(Path(self.tmp.name), self.exp.id)
        preds = [json.loads(l) for l in (folder / 'predictions.jsonl').read_text().splitlines()]
        finals = [p for p in preds if p['type'] == 'trial_final']
        self.assertEqual(len(finals), 37)
        self.assertTrue(all(p['thresholds'] is None for p in finals[:25]))
        self.assertTrue(all(p['thresholds']['ready'] for p in finals[25:]))
        windows = [p for p in preds if p['type'] == 'window']
        self.assertTrue(windows)
        # No analysed window may start before its trial's onset + uncertainty.
        events = [json.loads(l) for l in (folder / 'events.jsonl').read_text().splitlines()]
        onsets = {e['trial_id']: e['alignment']['sample_index'] for e in events if e['type'] == 'stim_onset'}
        pad = int(0.5 * RATE)
        for w in windows:
            self.assertGreaterEqual(w['window'][0] - pad, onsets[w['trial_id']])
        # The decoder record never contains the requested target.
        self.assertTrue(all('requested' not in w for w in windows))
        summary = json.loads((folder / 'summary.json').read_text())
        self.assertEqual(summary['analysis']['counts']['setup']['trials'], 25)


class ServiceIntegrationTests(unittest.TestCase):
    def test_simulated_eeg_flows_through_the_single_producer_into_a_recording(self):
        with tempfile.TemporaryDirectory() as tmp:
            s = Service()
            s.experiments = ExperimentManager(RATE, 8, Path(tmp))
            req = MagicMock(source='simulated_eeg', recording='', serial_port='')
            s.connect(req)
            self.assertIsInstance(s.board, SimulatedBoard)
            time.sleep(0.6)
            s.tick()
            self.assertTrue(s.receiving())
            self.assertFalse(s.status()['calibrated'], 'games still require the alpha baseline')
            self.assertFalse(s.frame()['calibrated'])
            exp = s.experiments.start('bilateral', bilateral_config(), s.session_id, s.source, s.receiving())
            before = s.total
            for _ in range(4):
                time.sleep(0.26)
                s.tick()
            recorded = s.total - before
            s.connect(req)  # source change interrupts the experiment
            self.assertEqual(exp.state, 'interrupted')
            self.assertIn('source changed', exp.reason)
            wait(exp)
            summary = json.loads((Path(tmp) / exp.id / 'summary.json').read_text())
            self.assertEqual(summary['recording']['samples'], recorded)
            self.assertEqual(summary['recording']['sample_discontinuities_in_file'], 0)
            s.stop()

    def test_recalibration_interrupts_an_experiment(self):
        with tempfile.TemporaryDirectory() as tmp:
            s = Service()
            s.experiments = ExperimentManager(RATE, 8, Path(tmp))
            s.connect(MagicMock(source='simulated_eeg', recording='', serial_port=''))
            time.sleep(0.3)
            s.tick()
            exp = s.experiments.start('bilateral', bilateral_config(), s.session_id, s.source, True)
            s.begin_calibration()
            self.assertEqual(exp.reason, 'Baseline recalibration started')
            wait(exp)
            s.stop()

    def test_only_the_acquisition_loop_reads_the_board(self):
        root = Path(__file__).parent
        readers = [p.name for p in root.glob('*.py') if 'get_board_data()' in p.read_text() and not p.name.startswith('test_')]
        self.assertEqual(readers, ['main.py'])
        self.assertEqual(len(re.findall(r'get_board_data\(\)', (root / 'main.py').read_text())), 1)

    def test_start_validation_rejects_bad_ssvep_settings(self):
        ok = StartRequest(**ssvep_config())
        validate_start(ok)
        for patch_ in [dict(channels=[0, 1]),  # not posterior
                       dict(frequencies_hz=[10.0, 11.0, 15.0]),  # not whole frames at 60 Hz
                       dict(channels=[5, 5]),
                       dict(display=dict(ssvep_config()['ssvep']['display'], passed=False))]:
            cfg = ssvep_config()
            cfg['ssvep'].update(patch_)
            with self.assertRaises(ValueError, msg=str(patch_)):
                validate_start(StartRequest(**cfg))
        with self.assertRaises(Exception):
            StartRequest(**dict(ssvep_config(), participant='Jane Doe!'))
        with self.assertRaises(Exception):
            StartRequest(**bilateral_config(bilateral=None) | dict(bilateral=dict(
                interval_ms=100, fixation_pre_s=10, alternating_s=10, fixation_post_s=10, instruction='follow')))


if __name__ == '__main__':
    unittest.main()


class EarlyEventTests(unittest.TestCase):
    def test_events_before_the_first_sample_are_aligned_once_data_arrives(self):
        with tempfile.TemporaryDirectory() as tmp:
            m = ExperimentManager(RATE, 8, Path(tmp))
            exp = m.start('bilateral', bilateral_config(), 's', 'simulated_eeg', True)
            feed = Feed()
            m.events(exp.id, exp.token, [dict(id=1, type='run_start', t_browser_ms=feed.now_ms()),
                                         dict(id=2, type='phase_start', phase='fixation_pre', t_browser_ms=feed.now_ms())])
            drain(exp)
            feed.push(m, 1.0)
            m.stop(exp.id, exp.token, completed=True)
            wait(exp)
            evs = [json.loads(l) for l in (Path(tmp) / exp.id / 'events.jsonl').read_text().splitlines()]
            self.assertEqual([e['id'] for e in evs], [1, 2])
            self.assertTrue(all(e['alignment'] and abs(e['alignment']['sample_index']) <= 2 for e in evs))
            summary = json.loads((Path(tmp) / exp.id / 'summary.json').read_text())
            self.assertEqual(summary['analysis']['phases']['fixation_pre']['start_sample'], evs[1]['alignment']['sample_index'])

    def test_events_without_any_eeg_are_still_saved(self):
        with tempfile.TemporaryDirectory() as tmp:
            m = ExperimentManager(RATE, 8, Path(tmp))
            exp = m.start('bilateral', bilateral_config(), 's', 'simulated_eeg', True)
            m.events(exp.id, exp.token, [dict(id=1, type='run_start', t_browser_ms=1.0)])
            m.stop(exp.id, exp.token)
            wait(exp)
            evs = [json.loads(l) for l in (Path(tmp) / exp.id / 'events.jsonl').read_text().splitlines()]
            self.assertEqual(len(evs), 1)
            self.assertIsNone(evs[0]['alignment'])
