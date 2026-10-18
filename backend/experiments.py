"""Experiment sessions: ownership, events, full-rate fan-out, analysis and recording.

The acquisition producer (Service.tick → ingest) is the only reader of the
board. While an experiment is active, ingest hands every validated full-rate
batch to `ExperimentManager.on_samples`, which enqueues it (never blocking) to
two bounded workers: the recorder (disk) and the analyzer (CCA / band metrics).
A full queue stops the experiment visibly instead of dropping data.

Timing vocabulary (kept distinct everywhere):
  browser time   performance.timeOrigin + performance.now() in the page (ms)
  server time    time.time() / time.monotonic() in this process (s)
  EEG time       sample index (and the source's own timestamps)
Event → sample alignment is software-only: browser time + estimated clock
offset → server wall time → sample index via the source timestamps. It never
proves when light left the screen.
"""
from __future__ import annotations

import math
import os
import queue
import secrets
import threading
import time
import uuid
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from backend import bands, ssvep
from backend.experiment_recording import RecordingWriter, SCHEMA_VERSION, experiment_dir

ROOT = Path(os.environ.get('BCI_EXPERIMENTS_DIR',
                           str(Path(__file__).resolve().parent.parent / 'data' / 'experiments'))).resolve()
APP_VERSION = '0.3.0-experiments'
HEARTBEAT_INTERVAL_S = 0.5
HEARTBEAT_TIMEOUT_S = 2.0
STALE_S = 2.0
ANALYSIS_QUEUE_LIMIT = 2000
EVENT_BATCH_LIMIT = 200
FRAME_BATCH_LIMIT = 4000
BUFFER_SECONDS = 12
REPLAY_ARRIVAL_UNCERTAINTY_S = 0.3

EVENT_TYPES = {
    'common': {'clock', 'note', 'notice_accepted', 'visibility', 'sim_gaze', 'escape'},
    'bilateral': {'run_start', 'phase_start', 'phase_end', 'side', 'run_complete', 'run_interrupted'},
    'ssvep': {'block_start', 'block_end', 'break_start', 'break_end', 'trial_cue', 'stim_onset',
              'stim_offset', 'trial_rest', 'trial_interrupted', 'timing_check'},
}


class Conflict(Exception):
    pass


class Forbidden(Exception):
    pass


def now_iso():
    return datetime.now(timezone.utc).isoformat()


# =========================================================================== analysis
class Analyzer:
    """Runs in its own thread; owns a rolling full-rate buffer for one experiment."""

    def __init__(self, exp: 'Experiment'):
        self.exp = exp
        self.rate = exp.rate
        self.q: queue.Queue = queue.Queue(maxsize=ANALYSIS_QUEUE_LIMIT)
        self.lock = threading.Lock()
        n = exp.channel_count
        self.buf = np.empty((n, 0))
        self.ts = np.empty(0)
        self.buf_start = 0
        self.latest = -1  # absolute index of newest sample
        self.breaks: deque[int] = deque()  # sample i is discontinuous from i-1
        self.ts_current = False
        self.ts_jitter = 0.0
        self.last_arrival: tuple[int, float] | None = None
        self.published: dict = {}
        self.pending_events: list[dict] = []  # events that arrived before the first sample
        self.error: str | None = None
        self.windows = dict(valid=0, invalid=0)
        # SSVEP
        self.trial: dict | None = None
        self.labels: dict[str, object] = {}  # evaluation metadata only; never passed to the decoder
        self.results: list[dict] = []
        self.thresholds: dict | None = None
        self.next_spectrum = None
        # Bilateral
        self.phases: dict[str, dict] = {}
        self.phase_order: list[str] = []
        self.current_phase: str | None = None
        self.next_metric = None
        self.metric_k = 0
        self.sides = 0
        self.thread = threading.Thread(target=self._run, name=f'analysis-{exp.id[:8]}', daemon=True)
        self.thread.start()

    def _write(self, kind, payload):
        if not self.exp.writer.put(kind, payload) and self.exp.writer.state == 'recording':
            self.error = 'Recording queue full (analysis output); experiment stopped'

    def put(self, kind, payload) -> bool:
        try:
            self.q.put_nowait((kind, payload))
            return True
        except queue.Full:
            return False

    def finish(self, timeout=5.0):
        try:
            self.q.put(('stop', None), timeout=1.0)
        except queue.Full:
            pass
        self.thread.join(timeout)

    def _run(self):
        while True:
            kind, payload = self.q.get()
            if kind == 'stop':
                for ev in self.pending_events:  # never drop an event, even without EEG
                    self._write('events', dict(ev, alignment=None, alignment_note='No EEG samples arrived'))
                self.pending_events = []
                return
            try:
                if kind == 'samples':
                    self._samples(*payload)
                elif kind == 'event':
                    self._event(payload)
                elif kind == 'thresholds':
                    payload['result'] = self._select_thresholds()
                    payload['done'].set()
            except Exception as exc:  # analysis must never take down acquisition
                self.error = f'Analysis failed: {exc}'
                if kind == 'thresholds':
                    payload['result'] = None
                    payload['done'].set()

    # ---------------------------------------------------------------- samples
    def _samples(self, start, eeg, ts, breaks, wall_now):
        if self.latest >= 0 and start != self.latest + 1:
            self.breaks.append(start)
        if self.buf.shape[1] == 0:
            self.buf_start = start
        self.buf = np.concatenate((self.buf, eeg), axis=1)
        self.ts = np.r_[self.ts, ts]
        keep = self.rate * BUFFER_SECONDS
        if self.buf.shape[1] > keep:
            drop = self.buf.shape[1] - keep
            self.buf = self.buf[:, drop:]
            self.ts = self.ts[drop:]
            self.buf_start += drop
        self.breaks.extend(int(b) for b in breaks)
        while self.breaks and self.breaks[0] < self.buf_start:
            self.breaks.popleft()
        self.latest = start + eeg.shape[1] - 1
        self.last_arrival = (self.latest, wall_now)
        self.ts_current = abs(float(ts[-1]) - wall_now) < 2.0
        tail = self.ts[-self.rate * 2:]
        if len(tail) > 10:
            i = np.arange(len(tail))
            fit = np.polyfit(i, tail, 1)
            self.ts_jitter = float(np.max(np.abs(tail - np.polyval(fit, i))))
        if self.pending_events:
            pending, self.pending_events = self.pending_events, []
            for ev in pending:
                self._event(ev)
        if self.exp.kind == 'ssvep':
            self._advance_trial()
            self._spectrum()
        else:
            self._metrics()

    def segment(self, start, end):
        """Absolute [start, end) slice, or None if not buffered."""
        if start < self.buf_start or end - 1 > self.latest:
            return None
        return self.buf[:, start - self.buf_start:end - self.buf_start]

    def discontinuous(self, start, end):
        return any(start < b < end for b in self.breaks)

    # ---------------------------------------------------------------- alignment
    def align(self, browser_ms):
        """Software-only estimate of the EEG sample at a browser event time."""
        if self.latest < 0:
            return None
        clock = self.exp.clock
        wall = (browser_ms + clock['offset_ms']) / 1000.0
        rtt_s = clock['rtt_ms'] / 2000.0
        if self.ts_current and len(self.ts):
            if self.ts[0] <= wall <= self.ts[-1]:
                idx = self.buf_start + int(np.searchsorted(self.ts, wall))
            elif wall > self.ts[-1]:
                idx = self.latest + int(round((wall - self.ts[-1]) * self.rate))
            else:
                idx = self.buf_start - int(round((self.ts[0] - wall) * self.rate))
            u = rtt_s + self.ts_jitter + 1 / self.rate
            basis = 'source sample timestamps'
        else:
            last_idx, last_wall = self.last_arrival
            idx = last_idx + int(round((wall - last_wall) * self.rate))
            u = rtt_s + REPLAY_ARRIVAL_UNCERTAINTY_S
            basis = 'batch arrival time (source timestamps are not current, e.g. replay)'
        return dict(sample_index=int(idx), uncertainty_ms=round(u * 1000, 1), basis=basis,
                    method='software-only (browser clock → server clock → sample)')

    # ---------------------------------------------------------------- events
    def _event(self, ev):
        if self.latest < 0:
            # No EEG yet: align once the first batch arrives (extrapolated backwards if needed).
            self.pending_events.append(ev)
            return
        alignment = self.align(ev['t_browser_ms'])
        ev['alignment'] = alignment
        self._write('events', ev)
        t = ev['type']
        if self.exp.kind == 'ssvep':
            self._ssvep_event(t, ev, alignment)
        else:
            self._bilateral_event(t, ev, alignment)

    def _ssvep_event(self, t, ev, a):
        if t == 'trial_cue':
            self.labels[ev['trial_id']] = ev.get('requested')
            self.trial = dict(id=ev['trial_id'], block=ev.get('block', 'single'), state='cue', onset=None,
                              offset=None, u=0, tracker=ssvep.TrialTracker(self.rate), k=0, first_end=None)
            with self.lock:
                self.published['trial'] = dict(id=self.trial['id'], block=self.trial['block'], state='cue')
                self.published['latest'] = None
        elif t == 'stim_onset' and self.trial and self.trial['id'] == ev.get('trial_id') and a:
            tr = self.trial
            tr['onset'] = a['sample_index']
            tr['u'] = math.ceil(a['uncertainty_ms'] / 1000 * self.rate)
            win = int(ssvep.WINDOW_SECONDS * self.rate)
            pad = int(ssvep.PAD_SECONDS * self.rate)
            # Window segment (pad + window) starts no earlier than onset + uncertainty,
            # so even an unaccounted offset cannot pull pre-stimulus EEG into a window.
            tr['first_end'] = tr['onset'] + tr['u'] + pad + win
            tr['state'] = 'stimulating'
            with self.lock:
                self.published['trial'] = dict(id=tr['id'], block=tr['block'], state='stimulating',
                                               onset_sample=tr['onset'], alignment_uncertainty_ms=a['uncertainty_ms'])
            self._advance_trial()
        elif t == 'stim_offset' and self.trial and self.trial['id'] == ev.get('trial_id') and a:
            self.trial['offset'] = a['sample_index']
            self.trial['state'] = 'finalizing'
            self._advance_trial()
        elif t == 'trial_interrupted' and self.trial and self.trial['id'] == ev.get('trial_id'):
            tr = self.trial
            if tr['state'] != 'done':
                tr['state'] = 'interrupted'
                rec = dict(trial_id=tr['id'], block=tr['block'], interrupted=True, valid=False, decision=None,
                           reason=ev.get('reason'))
                self.results.append(rec)
                self._write('predictions', dict(type='trial_interrupted', **rec, server_wall_s=time.time()))
            with self.lock:
                self.published['trial'] = dict(id=tr['id'], block=tr['block'], state='interrupted',
                                               reason=ev.get('reason'))
                self.published['latest'] = None
            self.trial = None

    def _advance_trial(self):
        tr = self.trial
        if not tr or tr['onset'] is None or tr['state'] not in ('stimulating', 'finalizing'):
            return
        win = int(ssvep.WINDOW_SECONDS * self.rate)
        pad = int(ssvep.PAD_SECONDS * self.rate)
        step = ssvep.UPDATE_SECONDS * self.rate
        stop_end = tr['offset'] - tr['u'] if tr['offset'] is not None else None
        cfg = self.exp.config['ssvep']
        while True:
            end = tr['first_end'] + int(round(tr['k'] * step))
            if stop_end is not None and end > stop_end:
                self._finalize_trial()
                return
            if end - 1 > self.latest:
                return
            seg_start = end - win - pad
            seg = self.segment(seg_start, end)
            if seg is None:
                r = dict(valid=False, reason='Window not in buffer', correlations=None, best=None, margin=None,
                         channels=[], excluded=[])
            else:
                r = ssvep.decode_window(seg, self.rate, cfg['channels'], self.exp.config['electrodes'],
                                        cfg['frequencies_hz'], pad, self.discontinuous(seg_start, end))
            tr['tracker'].add(r, end)
            tr['k'] += 1
            self.windows['valid' if r['valid'] else 'invalid'] += 1
            stable = tr['tracker'].stable
            accepted = ssvep.accept(r, stable, self.thresholds)
            latest = dict(r, window=[end - win, end], trial_id=tr['id'], candidate=r['best'], stable=stable,
                          accepted=accepted, computed_wall_s=time.time())
            with self.lock:
                self.published['latest'] = latest
            self._write('predictions', dict(type='window', **{k: v for k, v in latest.items()
                                                                      if k not in ('computed_wall_s',)},
                                                    thresholds=self.thresholds, server_wall_s=time.time()))

    def _finalize_trial(self):
        tr = self.trial
        final = tr['tracker'].final(self.thresholds)
        if not final['valid'] and tr['tracker'].results == []:
            final['reason'] = 'Stimulation too short for a complete valid window after exclusions'
        rec = dict(trial_id=tr['id'], block=tr['block'], interrupted=False, **final)
        self.results.append(rec)
        tr['state'] = 'done'
        self._write('predictions', dict(type='trial_final', **rec,
                                                thresholds=dict(self.thresholds) if self.thresholds else None,
                                                server_wall_s=time.time()))
        with self.lock:
            self.published['trial'] = dict(id=tr['id'], block=tr['block'], state='done')
            self.published['last_decision'] = rec
        self.trial = None

    def _spectrum(self):
        if self.latest < 0:
            return
        if self.next_spectrum is None:
            self.next_spectrum = self.latest + 1
        if self.latest + 1 < self.next_spectrum:
            return
        self.next_spectrum = self.latest + 1 + self.rate // 2
        win = int(ssvep.WINDOW_SECONDS * self.rate)
        seg = self.segment(self.latest + 1 - win, self.latest + 1)
        chans = self.exp.config['ssvep']['channels']
        if seg is None:
            return
        f, a = ssvep.spectrum(seg[chans], self.rate)
        with self.lock:
            self.published['spectrum'] = dict(f=f, amplitude_uv=a, end=self.latest + 1,
                                              discontinuous=self.discontinuous(self.latest + 1 - win, self.latest + 1))

    # ---------------------------------------------------------------- thresholds
    def _select_thresholds(self):
        setup = []
        for r in self.results:
            if r['block'] != 'setup' or r.get('interrupted'):
                continue
            label = self.labels.get(r['trial_id'])
            if label is None:
                continue
            setup.append(dict(label=label, valid=r['valid'], best=r.get('best'), correlation=r.get('correlation'),
                              margin=r.get('margin'), stable=r.get('stable', False)))
        th = ssvep.select_thresholds(setup)
        self.thresholds = dict(th, frozen_at=now_iso()) if th['ready'] else None
        with self.lock:
            self.published['setup'] = th
        self._write('predictions', dict(type='thresholds', **th, server_wall_s=time.time()))
        return th

    # ---------------------------------------------------------------- bilateral
    def _bilateral_event(self, t, ev, a):
        if t == 'phase_start' and a:
            name = ev.get('phase')
            self.phases[name] = dict(start=a['sample_index'], end=None, u=math.ceil(a['uncertainty_ms'] / 1000 * self.rate),
                                     windows=0, boundary=0, discontinuous=0, channels=None)
            self.phase_order.append(name)
            self.current_phase = name
        elif t == 'phase_end' and a and ev.get('phase') in self.phases:
            self.phases[ev['phase']]['end'] = a['sample_index']
            if self.current_phase == ev['phase']:
                self.current_phase = None
        elif t == 'side':
            self.sides += 1
        with self.lock:
            self.published['phase'] = self.current_phase
            self.published['sides'] = self.sides
            self.published['phases'] = self._phase_summary()

    def _metrics(self):
        win = int(bands.WINDOW_SECONDS * self.rate)
        if self.next_metric is None:
            self.next_metric = self.latest + 1
        step = bands.UPDATE_SECONDS * self.rate
        while True:
            end = self.next_metric + int(round(self.metric_k * step))
            if end - 1 > self.latest:
                return
            self.metric_k += 1
            seg = self.segment(end - win, end)
            if seg is None:
                continue
            disc = self.discontinuous(end - win, end)
            m = bands.window_metrics(seg, self.rate)
            if disc:
                m = [dict(valid=False, reason='Packet gap or duplicate in window') for _ in m]
            names = self.exp.config['electrodes']
            for i, c in enumerate(m):
                c['name'] = names[i] if i < len(names) else f'CH{i+1}'
            phase = None
            for name in self.phase_order:
                p = self.phases[name]
                lo = p['start'] + p['u']
                hi = None if p['end'] is None else p['end'] - p['u']
                inside = end - win >= lo and (hi is None or end <= hi)
                overlaps = end > p['start'] - p['u'] and (p['end'] is None or end - win < p['end'] + p['u'])
                if inside:
                    phase = name
                    self._accumulate(p, m, disc)
                    break
                if overlaps:
                    p['boundary'] += 1
            self.windows['valid' if not disc else 'invalid'] += 1
            rec = dict(window=[end - win, end], phase=phase, discontinuous=disc, channels=m)
            self._write('metrics', rec)
            with self.lock:
                self.published['latest'] = rec
                self.published['phases'] = self._phase_summary()

    def _accumulate(self, p, m, disc):
        p['windows'] += 1
        if disc:
            p['discontinuous'] += 1
        if p['channels'] is None:
            p['channels'] = [dict(valid=0, rejected=0, rms=0.0, theta=0.0, alpha=0.0, beta=0.0) for _ in m]
        for acc, c in zip(p['channels'], m):
            if c['valid']:
                acc['valid'] += 1
                for k in ('rms', 'theta', 'alpha', 'beta'):
                    acc[k] += c[k]
            else:
                acc['rejected'] += 1

    def _phase_summary(self):
        out = {}
        names = self.exp.config['electrodes']
        for name in self.phase_order:
            p = self.phases[name]
            chans = []
            for i, acc in enumerate(p['channels'] or []):
                n = acc['valid']
                chans.append(dict(name=names[i] if i < len(names) else f'CH{i+1}', valid=n, rejected=acc['rejected'],
                                  **{k: (acc[k] / n if n else None) for k in ('rms', 'theta', 'alpha', 'beta')}))
            out[name] = dict(start_sample=p['start'], end_sample=p['end'], windows=p['windows'],
                             boundary_excluded=p['boundary'], discontinuous=p['discontinuous'], channels=chans)
        return out

    # ---------------------------------------------------------------- reporting
    def snapshot(self):
        with self.lock:
            snap = dict(self.published)
        snap['windows'] = dict(self.windows)
        snap['error'] = self.error
        if self.exp.kind == 'ssvep':
            snap['thresholds'] = self.thresholds
            snap['thresholds_ready'] = bool(self.thresholds and self.thresholds.get('ready'))
            snap['counts'] = self.counts()
        return snap

    def counts(self):
        out = {}
        for block in ('setup', 'evaluation', 'single'):
            trials = [dict(r, label=self.labels.get(r['trial_id'])) for r in self.results if r['block'] == block]
            out[block] = ssvep.summarize(trials)
        return out

    def summary(self):
        if self.exp.kind == 'ssvep':
            return dict(windows=self.windows, thresholds=self.thresholds, setup=self.published.get('setup'),
                        counts=self.counts(),
                        trials=[dict(r, requested=self.labels.get(r['trial_id'])) for r in self.results])
        return dict(windows=self.windows, side_changes=self.sides, phases=self._phase_summary(),
                    method=bands.METHOD)


# =========================================================================== sessions
class Experiment:
    def __init__(self, kind, config, session_id, source, rate, channel_count, root):
        self.id = str(uuid.uuid4())
        self.token = secrets.token_urlsafe(24)
        self.kind = kind
        self.config = config
        self.session_id = session_id
        self.source = source
        self.mode = {'live': 'live', 'replay': 'replay', 'simulated_eeg': 'simulated'}[source]
        self.rate = rate
        self.channel_count = channel_count
        self.started_at = now_iso()
        self.started_mono = time.monotonic()
        self.last_heartbeat = self.started_mono
        self.last_sample_mono = self.started_mono
        self.last_event_id = 0
        self.events_received = 0
        self.frames_received = 0
        self.samples_seen = 0
        self.state = 'running'
        self.reason = None
        self.ended_at = None
        self.stale = False
        self.clock = dict(offset_ms=float(config['clock']['offset_ms']), rtt_ms=float(config['clock']['rtt_ms']))
        self.clock_history = [dict(config['clock'], at=self.started_at)]
        self.writer = RecordingWriter(root, self.id, channel_count)
        self.analyzer = Analyzer(self)
        self.finished = threading.Event()
        self.writer.write_json('metadata.json', self.metadata())

    def metadata(self):
        return dict(schema_version=SCHEMA_VERSION, app_version=APP_VERSION, experiment_id=self.id, kind=self.kind,
                    mode=self.mode, mode_label={'live': 'Live Cyton EEG', 'replay': 'Recorded EEG replay — diagnostics only; '
                                                'cannot contain responses to these stimuli',
                                                'simulated': 'Simulated EEG — no headset; pipeline test only'}[self.mode],
                    acquisition_session_id=self.session_id, source=self.source, sample_rate_hz=self.rate,
                    channel_count=self.channel_count, units='µV (BrainFlow Cyton EEG rows)',
                    participant=self.config.get('participant') or None, electrodes=self.config['electrodes'],
                    reference=self.config.get('reference'), settings={k: v for k, v in self.config.items()
                                                                       if k not in ('electrodes', 'participant', 'reference')},
                    clock_sync=self.clock_history,
                    timing_note='Event times are software estimates (browser clock → server clock → EEG sample). '
                                'Optical timing is unverified: no photodiode measurement was performed.',
                    analysis_constants=ssvep.CONSTANTS if self.kind == 'ssvep' else dict(method=bands.METHOD),
                    heartbeat=dict(interval_s=HEARTBEAT_INTERVAL_S, timeout_s=HEARTBEAT_TIMEOUT_S),
                    started_at=self.started_at, ended_at=self.ended_at, state=self.state, end_reason=self.reason)


class ExperimentManager:
    def __init__(self, rate, channel_count, root: Path = ROOT, clock=time.monotonic):
        self.rate = rate
        self.channel_count = channel_count
        self.root = Path(root).resolve()
        self.clock = clock
        self.lock = threading.RLock()
        self.active: Experiment | None = None
        self.last: Experiment | None = None

    # ---------------------------------------------------------------- lifecycle
    def start(self, kind, config, session_id, source, receiving):
        with self.lock:
            if self.active:
                raise Conflict('Another experiment is already running. Stop it first.')
            if not session_id:
                raise ValueError('Connect an input source first.')
            if source not in ('live', 'replay', 'simulated_eeg'):
                raise ValueError('Experiments need raw EEG: connect Live Cyton, a recording, or Simulated EEG.')
            if not receiving:
                raise ValueError('No fresh raw EEG samples. Check the connection before starting.')
            self.root.mkdir(parents=True, exist_ok=True)
            exp = Experiment(kind, config, session_id, source, self.rate, self.channel_count, self.root)
            exp.last_heartbeat = exp.last_sample_mono = self.clock()
            self.active = exp
            return exp

    def _get(self, experiment_id, token, allow_finished=False):
        exp = self.active if self.active and self.active.id == experiment_id else None
        if exp is None and allow_finished and self.last and self.last.id == experiment_id:
            exp = self.last
        if exp is None:
            raise KeyError('Experiment is not active')
        if not secrets.compare_digest(exp.token, token or ''):
            raise Forbidden('This window does not own the experiment')
        return exp

    def heartbeat(self, experiment_id, token):
        with self.lock:
            exp = self._get(experiment_id, token)
            exp.last_heartbeat = self.clock()
            return dict(state=exp.state, stale=exp.stale)

    def events(self, experiment_id, token, events):
        with self.lock:
            exp = self._get(experiment_id, token)
            if len(events) > EVENT_BATCH_LIMIT:
                raise ValueError(f'At most {EVENT_BATCH_LIMIT} events per batch')
            allowed = EVENT_TYPES['common'] | EVENT_TYPES[exp.kind]
            last = exp.last_event_id
            for ev in events:
                if not isinstance(ev.get('id'), int) or ev['id'] <= last:
                    raise ValueError('Duplicate or out-of-order event id')
                if ev.get('type') not in allowed:
                    raise ValueError(f"Unknown event type {ev.get('type')!r}")
                if not isinstance(ev.get('t_browser_ms'), (int, float)) or not math.isfinite(ev['t_browser_ms']):
                    raise ValueError('Event needs a finite browser time')
                last = ev['id']
            wall, mono = time.time(), self.clock()
            for ev in events:
                ev = dict(ev, server_wall_s=wall, server_mono_s=mono)
                if ev['type'] == 'clock':
                    exp.clock = dict(offset_ms=float(ev['offset_ms']), rtt_ms=float(ev['rtt_ms']))
                    exp.clock_history.append(dict(exp.clock, at=now_iso()))
                if not exp.analyzer.put('event', ev):
                    self._end(exp, 'failed', 'Analysis queue full; experiment stopped to avoid losing events')
                    raise RuntimeError(exp.reason)
                exp.last_event_id = ev['id']
                exp.events_received += 1
            return dict(accepted=len(events), last_event_id=exp.last_event_id)

    def frames(self, experiment_id, token, batch):
        with self.lock:
            exp = self._get(experiment_id, token)
            rows = batch.get('frames') or []
            if len(rows) > FRAME_BATCH_LIMIT:
                raise ValueError(f'At most {FRAME_BATCH_LIMIT} frames per batch')
            record = dict(batch, count=len(rows), server_wall_s=time.time(),
                          note='Browser callback times and requested luminance; not optical measurements')
            if not exp.writer.put('frames', record):
                self._end(exp, 'failed', 'Recording queue full; experiment stopped')
                raise RuntimeError(exp.reason)
            exp.frames_received += len(rows)
            return dict(accepted=len(rows))

    def select_thresholds(self, experiment_id, token, timeout=5.0):
        with self.lock:
            exp = self._get(experiment_id, token)
            if exp.kind != 'ssvep':
                raise ValueError('Thresholds apply to SSVEP only')
            if exp.analyzer.thresholds:
                raise Conflict('Thresholds are already frozen for this session')
            job = dict(done=threading.Event(), result=None)
            if not exp.analyzer.put('thresholds', job):
                raise RuntimeError('Analysis queue full')
        job['done'].wait(timeout)
        return job['result']

    def stop(self, experiment_id, token, reason='Stopped by operator', completed=False):
        """Idempotent: stopping an already finished experiment returns its final status."""
        with self.lock:
            exp = self._get(experiment_id, token, allow_finished=True)
            if exp is self.active:
                self._end(exp, 'completed' if completed else 'interrupted', reason)
            return self.describe(exp)

    def interrupt(self, reason):
        """Session-level interruption (source change, disconnect, recalibration, EOF)."""
        with self.lock:
            if self.active:
                self._end(self.active, 'interrupted', reason)

    def _end(self, exp, state, reason):
        exp.state = state
        exp.reason = reason
        exp.ended_at = now_iso()
        self.active = None
        self.last = exp

        def finish():
            exp.analyzer.finish()
            summary = dict(experiment_id=exp.id, kind=exp.kind, mode=exp.mode, state=exp.state, end_reason=exp.reason,
                           started_at=exp.started_at, ended_at=exp.ended_at, events_received=exp.events_received,
                           frames_received=exp.frames_received, samples_seen=exp.samples_seen,
                           analysis=exp.analyzer.summary(), analysis_error=exp.analyzer.error)
            exp.writer.close(exp.metadata(), summary, wait=None).wait(30)
            exp.finished.set()
        threading.Thread(target=finish, name=f'finish-{exp.id[:8]}', daemon=True).start()

    # ---------------------------------------------------------------- acquisition hooks
    def on_samples(self, start, eeg, ts, counters, breaks, wall_now):
        """Called by the single acquisition producer for every validated batch. Never blocks."""
        exp = self.active
        if exp is None or not eeg.shape[1]:
            return
        exp.last_sample_mono = self.clock()
        exp.samples_seen += eeg.shape[1]
        ok_w = exp.writer.put('eeg', (start, np.array(ts, dtype=float), np.array(counters, dtype=float), eeg.copy()))
        ok_a = exp.analyzer.put('samples', (start, eeg.copy(), np.array(ts, dtype=float), list(breaks), wall_now))
        if not ok_w or not ok_a:
            with self.lock:
                if exp is self.active:
                    self._end(exp, 'failed', exp.writer.error or exp.analyzer.error or
                              (('Recording' if not ok_w else 'Analysis')
                               + ' queue full; experiment stopped rather than dropping samples'))

    def check(self, receiving: bool, at_end: bool = False):
        """Periodic watchdog from the acquisition loop."""
        with self.lock:
            exp = self.active
            if exp is None:
                return
            now = self.clock()
            if now - exp.last_heartbeat > HEARTBEAT_TIMEOUT_S:
                self._end(exp, 'interrupted', f'Owner heartbeat lost (none for {HEARTBEAT_TIMEOUT_S:.0f} s)')
            elif exp.writer.error:
                self._end(exp, 'failed', exp.writer.error)
            elif exp.analyzer.error:
                self._end(exp, 'failed', exp.analyzer.error)
            elif at_end:
                self._end(exp, 'interrupted', 'Recording reached its end')
            else:
                exp.stale = (not receiving) or now - exp.last_sample_mono > STALE_S

    # ---------------------------------------------------------------- telemetry and files
    def describe(self, exp: Experiment):
        rec = exp.writer.describe()
        return dict(id=exp.id, kind=exp.kind, mode=exp.mode, state=exp.state, reason=exp.reason,
                    session_id=exp.session_id, started_at=exp.started_at, ended_at=exp.ended_at, stale=exp.stale,
                    participant=exp.config.get('participant') or None, electrodes=exp.config['electrodes'],
                    events=exp.events_received, frames=exp.frames_received, samples=exp.samples_seen,
                    clock=exp.clock, recording=rec, saved=rec['state'] == 'saved',
                    heartbeat_age_ms=round((self.clock() - exp.last_heartbeat) * 1000) if exp.state == 'running' else None,
                    settings=exp.config.get(exp.kind), analysis=exp.analyzer.snapshot())

    def telemetry(self):
        with self.lock:
            exp = self.active or self.last
            return self.describe(exp) if exp else None

    def folder(self, experiment_id):
        path = experiment_dir(self.root, experiment_id)
        if not path.is_dir():
            raise KeyError('No such recording')
        with self.lock:
            if self.active and self.active.id == experiment_id:
                raise Conflict('Stop the experiment before exporting')
            if self.last and self.last.id == experiment_id and not self.last.finished.is_set():
                raise Conflict('Recording is still being finalized')
        return path

    def recent(self, limit=20):
        if not self.root.is_dir():
            return []
        out = []
        for p in sorted(self.root.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)[:limit]:
            try:
                experiment_dir(self.root, p.name)
            except ValueError:
                continue
            meta = p / 'metadata.json'
            out.append(dict(id=p.name, path=str(p), complete=(p / 'summary.json').exists(),
                            modified=datetime.fromtimestamp(p.stat().st_mtime, timezone.utc).isoformat(),
                            metadata=_safe_json(meta)))
        return out


def _safe_json(path):
    import json
    try:
        m = json.loads(path.read_text(encoding='utf-8'))
        return {k: m.get(k) for k in ('kind', 'mode', 'state', 'end_reason', 'started_at', 'participant')}
    except Exception:
        return None
