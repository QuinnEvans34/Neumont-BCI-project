"""Research / Dev Mode recorder.

One recording spans connects, calibrations, games and reconnects. The single
acquisition producer (Service.tick → ingest) calls the `on_*` hooks with every
acquired batch *before* any game gating, every feature window it computes,
every input frame it emits and every calibration transition. Browser-side game
events and state snapshots arrive as ordered, acknowledged batches from one
owner tab. Everything goes through one bounded queue to one writer thread that
owns the CSV files and/or the SQLite connection. Overflow or a write error
stops the recording visibly (incomplete) instead of dropping data.
"""
from __future__ import annotations

import json
import math
import queue
import secrets
import subprocess
import threading
import time
import uuid
from collections import deque
from pathlib import Path

import numpy as np

from backend.research import schema
from backend.research.destinations import Destinations, now_iso, REPO_ROOT
from backend.research.sinks import make_sinks, normalize, table_digest_sqlite

HEARTBEAT_TIMEOUT_S = 5.0
QUEUE_LIMIT = 20000
FLUSH_INTERVAL_S = 1.0
ITEM_BATCH_LIMIT = 500
TAIL_SECONDS = 10
REPLAY_ARRIVAL_UNCERTAINTY_S = 0.3
PARTICIPANT_RE = __import__('re').compile(r'^[A-Za-z0-9][A-Za-z0-9_.]{0,31}$')
CONDITION_RE = __import__('re').compile(r'^[\w .:/()+\-]{0,60}$')
SOURCE_LABEL = {'live': 'Live Cyton EEG', 'replay': 'Recorded EEG replay', 'simulated_eeg': 'Simulated EEG — no headset',
                'synthetic': 'Score-only simulation — no EEG'}
GAME_COLS = {c for c in schema.columns('game_state')} - {'recording_id', 'participant_id', 'est_server_wall_s'}


class Conflict(Exception):
    pass


class Forbidden(Exception):
    pass


def build_info():
    info = dict(commit=None, dirty=None)
    try:
        info['commit'] = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=REPO_ROOT, capture_output=True, text=True,
                                        timeout=2).stdout.strip() or None
        dirty = subprocess.run(['git', 'status', '--porcelain'], cwd=REPO_ROOT, capture_output=True, text=True, timeout=2)
        info['dirty'] = bool(dirty.stdout.strip()) if dirty.returncode == 0 else None
    except Exception:
        pass
    return info


class Writer:
    """Single thread owning every sink. Items: (table, [rows]) | ('__flush__', None) | ('__close__', Event)."""

    def __init__(self, fmt: str, folder: Path):
        self.fmt = fmt
        self.folder = folder
        self.q: queue.Queue = queue.Queue(maxsize=QUEUE_LIMIT)
        self.error: str | None = None
        self.sinks = []
        self.queued = {t: 0 for t in schema.ORDER}
        self.written = {t: 0 for t in schema.ORDER}
        self.flushed = {t: 0 for t in schema.ORDER}
        self.last_flush = time.monotonic()
        self.opened = threading.Event()
        self.closed = threading.Event()
        self.parity: dict | None = None
        self.thread = threading.Thread(target=self._run, name='research-writer', daemon=True)
        self.thread.start()
        self.opened.wait(10)
        if self.error:
            raise OSError(self.error)

    def put(self, table, rows) -> bool:
        if self.error or self.closed.is_set():
            return False
        if rows is not None and not rows and table in schema.TABLES:
            return True
        try:
            self.q.put_nowait((table, rows))
            if table in self.queued:
                self.queued[table] += len(rows)
            return True
        except queue.Full:
            return False

    def backlog(self):
        return sum(self.queued.values()) - sum(self.written.values())

    def _run(self):
        try:
            self.sinks = make_sinks(self.fmt, self.folder)
        except Exception as exc:
            self.error = f'Cannot create {self.fmt} storage: {exc}'
            self.opened.set()
            return
        self.opened.set()
        while True:
            try:
                table, rows = self.q.get(timeout=0.2)
            except queue.Empty:
                table, rows = '__tick__', None
            if table == '__close__':
                self._close(rows)
                return
            if self.error:
                continue
            try:
                if table in schema.TABLES:
                    norm = [normalize(table, r) for r in rows]
                    for s in self.sinks:
                        s.append(table, norm)
                    self.written[table] += len(norm)
                if table == '__flush__' or time.monotonic() - self.last_flush >= FLUSH_INTERVAL_S:
                    for s in self.sinks:
                        s.flush()
                    self.flushed = dict(self.written)
                    self.last_flush = time.monotonic()
            except Exception as exc:
                which = getattr(locals().get('s'), 'name', 'storage')
                self.error = f'{which} write failed: {exc}'

    def _close(self, done: threading.Event):
        try:
            for s in self.sinks:
                if not self.error:
                    s.flush()
            self.flushed = dict(self.written)
            if self.fmt == 'both' and not self.error:
                csv, db = self.sinks
                mism = {}
                for t in schema.ORDER:
                    a = csv.digest(t)
                    b = db.digest(t)
                    if a != b:
                        mism[t] = dict(csv_rows=a[0], sqlite_rows=b[0])
                self.parity = dict(checked=True, matched=not mism, mismatches=mism)
                if mism:
                    self.error = 'CSV and SQLite disagree after finalization: ' + ', '.join(mism)
            for s in self.sinks:
                try:
                    s.close()
                except Exception as exc:
                    self.error = self.error or f'{s.name} close failed: {exc}'
        finally:
            self.closed.set()
            done.set()

    def close(self, timeout=60):
        done = threading.Event()
        while True:
            try:
                self.q.put(('__close__', done), timeout=0.5)
                break
            except queue.Full:
                if not self.thread.is_alive():
                    return False
        return done.wait(timeout)


class Recording:
    def __init__(self, cfg: dict, folder: Path, dest_id: str, channel_count: int, rate: int):
        self.id = cfg['recording_id']
        self.token = secrets.token_urlsafe(24)
        self.participant = cfg['participant_id']
        self.cfg = cfg
        self.folder = folder
        self.dest_id = dest_id
        self.fmt = cfg['storage_format']
        self.rate = rate
        self.channel_count = channel_count
        self.state = 'recording'
        self.reason = None
        self.started_wall = time.time()
        self.started_mono = time.monotonic()
        self.ended_wall = None
        self.last_heartbeat = self.started_mono
        self.browser_seq = 0
        self.server_seq = 0
        self.seen_events: set[str] = set()
        self.losses: list[dict] = []
        self.acquisitions: dict[str, dict] = {}
        self.current_acq: str | None = None
        self.tails: dict[str, dict] = {}
        self.calibrations: dict[str, dict] = {}
        self.rounds: dict[str, dict] = {}
        self.window_seq = 0
        self.batch_seq = 0
        self.clock = dict(offset_ms=0.0, rtt_ms=None)
        self.counts = dict(samples=0, batches=0, windows=0, frames=0, events=0, states=0, markers=0)
        self.last_sample_wall = None
        self.games = set()
        self.writer = Writer(self.fmt, folder)

    def common(self):
        return (self.id, self.participant)


class ResearchRecorder:
    def __init__(self, rate: int, channel_count: int, destinations: Destinations | None = None, clock=time.monotonic):
        self.rate = rate
        self.channel_count = channel_count
        self.dest = destinations or Destinations()
        self.clock = clock
        self.lock = threading.RLock()
        self.rec: Recording | None = None
        self.last: Recording | None = None
        self.finishing: list[threading.Thread] = []

    @property
    def active(self):
        return self.rec is not None and self.rec.state == 'recording'

    # ================================================================ lifecycle
    def start(self, participant_id, storage_format, destination_id, condition='', electrodes=None, reference='',
              notes='', snapshot: dict | None = None, idempotency_key: str | None = None):
        with self.lock:
            if self.rec and self.rec.state == 'recording':
                if idempotency_key and self.rec.cfg.get('idempotency_key') == idempotency_key:
                    raise Conflict('This recording was already started (duplicate request).')
                raise Conflict('A research recording is already running. Stop it first.')
            if not PARTICIPANT_RE.match(participant_id or ''):
                raise ValueError('Participant ID: 1–32 letters, numbers, _ or . (a pseudonym such as P007, not a name).')
            if not CONDITION_RE.match(condition or ''):
                raise ValueError('Condition label has unsupported characters.')
            if storage_format not in ('csv', 'sqlite', 'both'):
                raise ValueError('Storage format must be csv, sqlite or both.')
            electrodes = [str(e)[:12] for e in (electrodes or [''] * self.channel_count)][: self.channel_count]
            electrodes += [''] * (self.channel_count - len(electrodes))
            self.dest.probe(destination_id)
            rid = str(uuid.uuid4())
            folder = self.dest.recording_folder(destination_id, rid)
            folder.mkdir(parents=False, exist_ok=False)
            cfg = dict(recording_id=rid, participant_id=participant_id, condition=condition, electrodes=electrodes,
                       reference=reference[:24], notes=notes[:200], storage_format=storage_format,
                       destination_id=destination_id, idempotency_key=idempotency_key)
            rec = Recording(cfg, folder, destination_id, self.channel_count, self.rate)
            rec.last_heartbeat = self.clock()
            self.rec = rec
            self.dest.add_to_index(rid, destination_id)
            self._write_metadata(rec)
            self.server_event('recording_started', dict(storage_format=storage_format, destination_id=destination_id,
                                                        condition=condition, electrodes=electrodes, reference=reference))
            snap = snapshot or {}
            if snap.get('acquisition_id'):
                self.on_acquisition_start(partial=True, **{k: snap[k] for k in (
                    'acquisition_id', 'source', 'board', 'first_sample_index', 'replay_file_name', 'replay_file_sha256')
                    if k in snap})
            if snap.get('calibration'):
                c = snap['calibration']
                self._calibration_row(dict(c, preexisting=True, result=c.get('result', 'preexisting')))
            return rec

    def _get(self, recording_id, token):
        rec = self.rec
        if not rec or rec.id != recording_id or rec.state != 'recording':
            raise KeyError('Recording is not active')
        if not secrets.compare_digest(rec.token, token or ''):
            raise Forbidden('This tab does not own the recording (read-only).')
        return rec

    def heartbeat(self, recording_id, token, visible=True):
        with self.lock:
            rec = self._get(recording_id, token)
            rec.last_heartbeat = self.clock()
            return self.status_of(rec)

    def stop(self, recording_id, token, reason='Stopped by operator', unsent_items=0):
        with self.lock:
            rec = self.rec if self.rec and self.rec.id == recording_id else (self.last if self.last and self.last.id == recording_id else None)
            if rec is None:
                raise KeyError('Unknown recording')
            if not secrets.compare_digest(rec.token, token or ''):
                raise Forbidden('This tab does not own the recording.')
            if rec.state == 'recording':
                if unsent_items:
                    rec.losses.append(dict(at=now_iso(), reason='Browser items not delivered at stop', count=unsent_items))
                self._finalize(rec, 'incomplete' if unsent_items else 'saved', reason)
            return self.status_of(rec)

    def check(self):
        """Watchdog, called from the acquisition loop."""
        with self.lock:
            rec = self.rec
            if not rec or rec.state != 'recording':
                return
            if self.clock() - rec.last_heartbeat > HEARTBEAT_TIMEOUT_S:
                self._finalize(rec, 'incomplete', f'Owner tab lost (no heartbeat for {HEARTBEAT_TIMEOUT_S:.0f} s)')
            elif rec.writer.error:
                self._finalize(rec, 'failed', rec.writer.error)

    def _fail(self, rec, reason):
        rec.losses.append(dict(at=now_iso(), reason=reason))
        self._finalize(rec, 'incomplete', reason)

    def _put(self, rec, table, rows):
        if not rows:
            return True
        if rec.writer.put(table, rows):
            return True
        if rec.state == 'recording':
            if rec.writer.error:
                rec.losses.append(dict(at=now_iso(), reason=rec.writer.error))
                self._finalize(rec, 'failed', rec.writer.error)
            else:
                self._fail(rec, 'Storage queue full; recording stopped rather than dropping data')
        return False

    def _finalize(self, rec: Recording, outcome: str, reason: str):
        rec.state = 'finalizing'
        rec.reason = reason
        rec.ended_wall = time.time()
        self.rec = None
        self.last = rec
        # Closing rows: open segments, calibrations and rounds are explicitly marked.
        rows = []
        for a in rec.acquisitions.values():
            if a['ended_wall_s'] is None:
                a['ended_wall_s'] = rec.ended_wall
                a['end_reason'] = 'capture_ended'
                rows.append(self._acq_row(rec, a))
        cal_rows = []
        for c in rec.calibrations.values():
            if c['result'] == 'collecting':
                c['result'] = 'collecting_at_stop'
                cal_rows.append(self._cal_values(rec, c))
        round_rows = []
        for r in list(rec.rounds.values()):
            if r.get('ended_browser_ms') is None:
                round_rows.append(self._round_row(rec, r, 'capture_ended', None, r.get('active_s'), r.get('summary')))
        stop_event = self._event_row(rec, dict(event_id=str(uuid.uuid4()), producer='server', type='recording_stopped',
                                               reason=reason, payload=dict(outcome=outcome)))
        rec.writer.put('acquisitions', rows)
        rec.writer.put('calibrations', cal_rows)
        rec.writer.put('rounds', round_rows)
        rec.writer.put('events', [stop_event])

        def finish():
            ok = rec.writer.close()
            state = outcome
            if not ok:
                state = 'incomplete'
                rec.losses.append(dict(at=now_iso(), reason='Writer did not finish in time'))
            if rec.writer.error:
                state = 'failed' if outcome == 'saved' or outcome == 'failed' else outcome
                if state == 'saved':
                    state = 'failed'
                rec.losses.append(dict(at=now_iso(), reason=rec.writer.error))
            if state == "saved" and rec.losses:
                state = "incomplete"
            rec.state = state
            try:
                self._write_metadata(rec)
                self._write_manifest(rec)
            except Exception as exc:
                rec.state = 'failed'
                rec.losses.append(dict(at=now_iso(), reason=f'Metadata write failed: {exc}'))
        t = threading.Thread(target=finish, name='research-finalize', daemon=True)
        self.finishing.append(t)
        t.start()

    def wait_finished(self, timeout=30):
        for t in list(self.finishing):
            t.join(timeout)

    # ================================================================ metadata
    def _write_metadata(self, rec: Recording):
        meta = dict(
            schema_version=schema.SCHEMA_VERSION, app='Neumont BCI research mode', build=build_info(),
            recording_id=rec.id, participant_id=rec.participant, condition=rec.cfg['condition'] or None,
            notes=rec.cfg['notes'] or None, storage_format=rec.fmt, destination_id=rec.dest_id,
            state=rec.state, end_reason=rec.reason, started_at=_iso(rec.started_wall),
            ended_at=_iso(rec.ended_wall) if rec.ended_wall else None,
            duration_s=round((rec.ended_wall or time.time()) - rec.started_wall, 1),
            sample_rate_hz=self.rate, channel_count=self.channel_count, electrodes=rec.cfg['electrodes'],
            reference=rec.cfg['reference'] or None, algorithm_version=schema.ALGORITHM_VERSION,
            games=sorted(rec.games), sources=sorted({a['source'] for a in rec.acquisitions.values()}),
            counts=rec.counts,
            rows_written=dict(rec.writer.written), rows_flushed=dict(rec.writer.flushed),
            parity=rec.writer.parity, losses=rec.losses,
            browser_sequence_last=rec.browser_seq, clock=rec.clock,
            timing_note='Browser times are software times (model steps, frame callbacks). Optical onset unverified. '
                        'Receipt times are not device sample times.',
            local_folder=str(rec.folder),
        )
        tmp = rec.folder / 'metadata.json.tmp'
        tmp.write_text(json.dumps(meta, indent=2, default=str), encoding='utf-8')
        tmp.replace(rec.folder / 'metadata.json')

    def _write_manifest(self, rec: Recording):
        m = dict(recording_id=rec.id, state=rec.state, complete=rec.state == 'saved', end_reason=rec.reason,
                 rows=dict(rec.writer.written), parity=rec.writer.parity, losses=rec.losses,
                 last_browser_sequence=rec.browser_seq, storage_format=rec.fmt, finalized_at=now_iso())
        (rec.folder / 'manifest.json').write_text(json.dumps(m, indent=2), encoding='utf-8')

    # ================================================================ acquisition hooks
    def on_acquisition_start(self, acquisition_id, source, board='', first_sample_index=0, replay_file_name=None,
                             replay_file_sha256=None, partial=False):
        with self.lock:
            rec = self.rec
            if not rec or rec.state != 'recording':
                return
            a = dict(acquisition_id=acquisition_id, source=source, source_label=SOURCE_LABEL.get(source, source),
                     board=board, sample_rate_hz=self.rate, channel_count=self.channel_count,
                     started_wall_s=time.time(), ended_wall_s=None, end_reason=None, partial_start=partial,
                     first_sample_index=first_sample_index, replay_file_name=replay_file_name,
                     replay_file_sha256=replay_file_sha256)
            rec.acquisitions[acquisition_id] = a
            rec.current_acq = acquisition_id
            self.server_event('acquisition_started', dict(source=source, board=board, partial_start=partial,
                                                          replay_file_name=replay_file_name),
                              acquisition_id=acquisition_id)

    def on_acquisition_end(self, acquisition_id, reason):
        with self.lock:
            rec = self.rec
            if not rec or rec.state != 'recording' or acquisition_id not in rec.acquisitions:
                return
            a = rec.acquisitions[acquisition_id]
            if a['ended_wall_s'] is None:
                a['ended_wall_s'] = time.time()
                a['end_reason'] = reason
                self._put(rec, 'acquisitions', [self._acq_row(rec, a)])
                self.server_event('acquisition_ended', dict(reason=reason), acquisition_id=acquisition_id)
            if rec.current_acq == acquisition_id:
                rec.current_acq = None

    def _acq_row(self, rec, a):
        return rec.common() + tuple(a[c] for c in schema.columns('acquisitions')[2:])

    def on_batch(self, acquisition_id, start, eeg, ts, counters, breaks, outage, wall, mono):
        rec = self.rec
        if not rec or rec.state != 'recording' or acquisition_id not in rec.acquisitions:
            return
        n = eeg.shape[1]
        if not n:
            return
        rec.batch_seq += 1
        bid = rec.batch_seq
        finite = np.isfinite(eeg)
        rows = []
        common = rec.common()
        for k in range(n):
            col = eeg[:, k]
            fin = finite[:, k]
            all_f = bool(fin.all())
            rows.append(common + (acquisition_id, start + k, float(ts[k]), bid, int(counters[k]) if np.isfinite(counters[k]) else None)
                        + tuple(float(v) if f else None for v, f in zip(col, fin))
                        + (all_f, '' if all_f else ';'.join(str(i + 1) for i in np.flatnonzero(~fin))))
        brow = common + (acquisition_id, bid, start, start + n, n, wall, mono, len(breaks),
                         ';'.join(str(b) for b in breaks), bool(outage))
        with self.lock:
            if not self._put(rec, 'eeg', rows) or not self._put(rec, 'batches', [brow]):
                return
            rec.counts['samples'] += n
            rec.counts['batches'] += 1
            rec.last_sample_wall = wall
            tail = rec.tails.setdefault(acquisition_id, dict(idx=np.empty(0, int), ts=np.empty(0), current=False,
                                                             jitter=0.0, last=None))
            keep = self.rate * TAIL_SECONDS
            tail['idx'] = np.r_[tail['idx'], np.arange(start, start + n)][-keep:]
            tail['ts'] = np.r_[tail['ts'], np.asarray(ts, float)][-keep:]
            tail['current'] = abs(float(ts[-1]) - wall) < 2.0
            tail['last'] = (start + n - 1, wall)
            t2 = tail['ts'][-self.rate * 2:]
            if len(t2) > 10:
                i = np.arange(len(t2))
                fit = np.polyfit(i, t2, 1)
                tail['jitter'] = float(np.max(np.abs(t2 - np.polyval(fit, i))))

    def next_window_id(self):
        rec = self.rec
        if not rec or rec.state != 'recording':
            return None
        rec.window_seq += 1
        return rec.window_seq

    def on_window(self, acquisition_id, purpose, calibration_id, start, end, gate, value, details, problem,
                  target=None, score=None, wall=None, mono=None):
        rec = self.rec
        if not rec or rec.state != 'recording' or acquisition_id not in rec.acquisitions:
            return None
        wid = self.next_window_id()
        included = sum(1 for d in details if d.get('included'))
        reason = problem or ('; '.join(f"CH{d['channel']}: {d['reason']}" for d in details if not d.get('included'))
                             if value is None else None)
        common = rec.common()
        row = common + (acquisition_id, wid, purpose, calibration_id, start, end, wall or time.time(),
                        mono or time.monotonic(), gate, value, value is not None, reason or None, included,
                        target, score, schema.ALGORITHM_VERSION)
        names = rec.cfg['electrodes']
        crow = [common + (acquisition_id, wid, d['channel'], names[d['channel'] - 1] if d['channel'] - 1 < len(names) else '',
                          d.get('std_uv'), d.get('ptp_uv'), d.get('rel_alpha'), bool(d.get('included')), d.get('reason'))
                for d in details]
        with self.lock:
            if self._put(rec, 'signal_windows', [row]) and self._put(rec, 'channel_metrics', crow):
                rec.counts['windows'] += 1
        return wid

    def on_frame(self, acquisition_id, sequence, source, score, quality, calibrated, calibration_id, window_id,
                 wall=None, mono=None):
        rec = self.rec
        if not rec or rec.state != 'recording' or acquisition_id is None:
            return
        row = rec.common() + (acquisition_id, sequence, wall or time.time(), mono or time.monotonic(), source,
                              score, quality, calibrated, calibration_id, window_id)
        with self.lock:
            if self._put(rec, 'input_frames', [row]):
                rec.counts['frames'] += 1

    def on_calibration(self, cal: dict):
        """Insert/update an attempt; rows are written when the attempt ends (or at stop)."""
        with self.lock:
            rec = self.rec
            if not rec or rec.state != 'recording':
                return
            cid = cal['calibration_id']
            prev = rec.calibrations.get(cid, {})
            merged = dict(prev, **cal)
            rec.calibrations[cid] = merged
            if cal.get('result') == 'collecting' and not prev:
                self.server_event('calibration_started', dict(calibration_id=cid, gate_max_ptp_uv=cal.get('gate_max_ptp_uv')),
                                  acquisition_id=cal.get('acquisition_id'))
            elif merged['result'] != 'collecting':
                self._calibration_row(merged)
                self.server_event('calibration_ended', dict(calibration_id=cid, result=merged['result'],
                                                            center=merged.get('center'), scale=merged.get('scale'),
                                                            error=merged.get('error')),
                                  acquisition_id=cal.get('acquisition_id'))

    def _cal_values(self, rec, c):
        return rec.common() + tuple(c.get(k) for k in schema.columns('calibrations')[2:])

    def _calibration_row(self, c):
        rec = self.rec
        if not rec:
            return
        c.setdefault('preexisting', False)
        rec.calibrations[c['calibration_id']] = c
        self._put(rec, 'calibrations', [self._cal_values(rec, c)])

    # ================================================================ events
    def server_event(self, type_, payload=None, reason=None, acquisition_id=None):
        rec = self.rec
        if not rec or rec.state != 'recording':
            return
        with self.lock:
            rec.server_seq += 1
            row = self._event_row(rec, dict(event_id=str(uuid.uuid4()), producer='server', producer_seq=rec.server_seq,
                                             type=type_, reason=reason, payload=payload or {},
                                             acquisition_id=acquisition_id or rec.current_acq))
            if self._put(rec, 'events', [row]):
                rec.counts['events'] += 1

    def _align(self, rec, t_browser_ms):
        if t_browser_ms is None:
            return None, None, None, None
        wall = (t_browser_ms + rec.clock['offset_ms']) / 1000.0
        acq = rec.current_acq
        tail = rec.tails.get(acq) if acq else None
        if not tail or tail['last'] is None:
            return wall, None, None, 'unknown (no EEG yet in this acquisition)'
        rtt = (rec.clock['rtt_ms'] or 0) / 2000.0
        if tail['current'] and len(tail['ts']):
            ts, idx = tail['ts'], tail['idx']
            if ts[0] <= wall <= ts[-1]:
                i = int(idx[min(len(idx) - 1, int(np.searchsorted(ts, wall)))])
            elif wall > ts[-1]:
                i = int(idx[-1] + round((wall - ts[-1]) * self.rate))
            else:
                i = int(idx[0] - round((ts[0] - wall) * self.rate))
            u = rtt + tail['jitter'] + 1 / self.rate
            return wall, i, round(u * 1000, 1), 'software: browser→server clock offset→source timestamps'
        last_idx, last_wall = tail['last']
        i = int(last_idx + round((wall - last_wall) * self.rate))
        u = rtt + REPLAY_ARRIVAL_UNCERTAINTY_S
        return wall, i, round(u * 1000, 1), 'software: batch arrival time (source timestamps not current, e.g. replay)'

    def _event_row(self, rec, ev):
        wall_now, mono_now = time.time(), time.monotonic()
        est, sample, unc, method = self._align(rec, ev.get('t_browser_ms'))
        if ev.get('producer') == 'server':
            est = wall_now
        inp = ev.get('input') or {}
        return rec.common() + (
            ev['event_id'], ev.get('producer_seq'), ev.get('producer', 'browser'), ev['type'], ev.get('game'),
            ev.get('round_id'), ev.get('t_browser_ms'), wall_now, mono_now, est,
            ev.get('acquisition_id') or rec.current_acq, sample, unc, method, ev.get('active_s'),
            inp.get('acquisition_id'), inp.get('sequence'), ev.get('reason'), ev.get('payload') or {})

    def _round_row(self, rec, r, outcome, ended_ms, active_s, summary):
        r['ended_browser_ms'] = ended_ms
        dur = (ended_ms - r['started_browser_ms']) / 1000 if ended_ms and r.get('started_browser_ms') else None
        return rec.common() + (r['round_id'], r['game'], r.get('mode'), r.get('started_browser_ms'), ended_ms, outcome,
                               bool(r.get('partial_start')), dur, active_s, summary or {})

    def items(self, recording_id, token, batch: list[dict]):
        """Ordered browser items: events, state snapshots and clock estimates. Idempotent by sequence."""
        with self.lock:
            rec = self._get(recording_id, token)
            if len(batch) > ITEM_BATCH_LIMIT:
                raise ValueError(f'At most {ITEM_BATCH_LIMIT} items per batch')
            rec.last_heartbeat = self.clock()
            events, states, clocks, rounds = [], [], [], []
            for it in sorted(batch, key=lambda x: x.get('seq', 0)):
                seq = it.get('seq')
                if not isinstance(seq, int) or seq <= 0:
                    raise ValueError('Each item needs a positive integer seq')
                if seq <= rec.browser_seq:
                    continue  # duplicate delivery (retry): already persisted
                if seq > rec.browser_seq + 1:
                    rec.server_seq += 1
                    gap = dict(event_id=str(uuid.uuid4()), producer='server', producer_seq=rec.server_seq,
                               type='sequence_gap', reason=f'Browser items {rec.browser_seq + 1}–{seq - 1} never arrived',
                               payload=dict(first_missing=rec.browser_seq + 1, last_missing=seq - 1))
                    events.append(self._event_row(rec, gap))
                    rec.losses.append(dict(at=now_iso(), reason=gap['reason']))
                rec.browser_seq = seq
                kind = it.get('kind')
                if kind == 'clock':
                    # A sync measured while the browser or backend was busy (RTT far above the best seen)
                    # is logged but not used: the previous offset stays in force.
                    rtt = float(it['rtt_ms'])
                    method = it.get('method', 'min-RTT ping/pong')
                    best = rec.clock.get('best_rtt_ms')
                    if best is None or rtt <= max(3 * best, 50.0):
                        old = rec.clock.get('offset_ms') if best is not None else None
                        if old is not None and abs(float(it['offset_ms']) - old) > max(20.0, rtt):
                            rec.server_seq += 1
                            events.append(self._event_row(rec, dict(
                                event_id=str(uuid.uuid4()), producer='server', producer_seq=rec.server_seq,
                                type='clock_jump', reason='Browser/server clock offset moved more than the sync uncertainty',
                                payload=dict(old_offset_ms=old, new_offset_ms=float(it['offset_ms']), rtt_ms=rtt))))
                        rec.clock = dict(offset_ms=float(it['offset_ms']), rtt_ms=rtt,
                                         best_rtt_ms=rtt if best is None else min(best, rtt))
                        method += '; used'
                    else:
                        method += f'; not used (RTT {rtt:.0f} ms > 3x best {best:.0f} ms)'
                    clocks.append(rec.common() + (seq, it.get('t_browser_ms'), it['offset_ms'], it['rtt_ms'],
                                                  it.get('samples'), it.get('spread_ms'), method))
                elif kind == 'state':
                    s = {k: v for k, v in it.items() if k in GAME_COLS}
                    s['state_seq'] = seq
                    s['kind'] = it.get('state_kind') or 'snapshot'  # item 'kind' is the envelope type
                    est = (it['t_browser_ms'] + rec.clock['offset_ms']) / 1000 if it.get('t_browser_ms') else None
                    states.append(rec.common() + tuple(est if c == 'est_server_wall_s' else s.get(c)
                                                       for c in schema.columns('game_state')[2:]))
                    if it.get('game'):
                        rec.games.add(it['game'])
                elif kind == 'event':
                    eid = it.get('event_id')
                    if not isinstance(eid, str) or not eid or eid in rec.seen_events:
                        continue
                    rec.seen_events.add(eid)
                    ev = dict(it, producer='browser', producer_seq=seq)
                    events.append(self._event_row(rec, ev))
                    if it.get('type') == 'marker':
                        rec.counts['markers'] += 1
                    if it.get('game'):
                        rec.games.add(it['game'])
                    t = it.get('type')
                    p = it.get('payload') or {}
                    if t == 'round_started' and it.get('round_id'):
                        rec.rounds[it['round_id']] = dict(round_id=it['round_id'], game=it.get('game'), mode=p.get('mode'),
                                                          started_browser_ms=it.get('t_browser_ms'),
                                                          partial_start=bool(p.get('partial_start')))
                    elif t == 'round_ended' and it.get('round_id') in rec.rounds:
                        r = rec.rounds.pop(it['round_id'])
                        rounds.append(self._round_row(rec, r, it.get('reason') or 'ended', it.get('t_browser_ms'),
                                                      it.get('active_s'), p.get('summary') or p))
                    elif t in ('round_progress',) and it.get('round_id') in rec.rounds:
                        rec.rounds[it['round_id']].update(active_s=it.get('active_s'), summary=p)
                else:
                    raise ValueError(f'Unknown item kind {kind!r}')
            ok = (self._put(rec, 'clock_sync', clocks) and self._put(rec, 'events', events)
                  and self._put(rec, 'game_state', states) and self._put(rec, 'rounds', rounds))
            rec.counts['events'] += len(events)
            rec.counts['states'] += len(states)
            if not ok:
                raise RuntimeError(rec.reason or 'Recording stopped')
            return dict(ack=rec.browser_seq, state=rec.state)

    # ================================================================ status
    def status_of(self, rec: Recording | None):
        if rec is None:
            return None
        w = rec.writer
        return dict(id=rec.id, participant_id=rec.participant, condition=rec.cfg['condition'] or None,
                    storage_format=rec.fmt, destination_id=rec.dest_id, state=rec.state, reason=rec.reason,
                    started_at=_iso(rec.started_wall), duration_s=round((rec.ended_wall or time.time()) - rec.started_wall, 1),
                    counts=dict(rec.counts), rows_written=sum(w.written.values()), backlog=w.backlog(),
                    rows_flushed=sum(w.flushed.values()), samples_written=w.written['eeg'],
                    samples_flushed=w.flushed['eeg'], browser_ack=rec.browser_seq,
                    receiving_eeg=bool(rec.last_sample_wall and time.time() - rec.last_sample_wall < 2),
                    acquisition_id=rec.current_acq, writer_error=w.error, losses=len(rec.losses),
                    heartbeat_age_s=round(self.clock() - rec.last_heartbeat, 1) if rec.state == 'recording' else None,
                    saved=rec.state == 'saved', games=sorted(rec.games), electrodes=rec.cfg['electrodes'])

    def telemetry(self):
        with self.lock:
            return self.status_of(self.rec or self.last)


def _iso(t):
    from datetime import datetime, timezone
    return datetime.fromtimestamp(t, timezone.utc).isoformat() if t else None
