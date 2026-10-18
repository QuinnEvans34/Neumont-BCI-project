"""Incremental local experiment recording.

One background thread owns every file handle. Producers enqueue without
blocking; a full queue is reported to the caller, which stops the experiment
visibly rather than silently dropping data. Nothing is reported as saved until
the files were actually flushed and closed.
"""
from __future__ import annotations

import json
import queue
import re
import threading
import time
from pathlib import Path
import numpy as np

UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
QUEUE_LIMIT = 4000
SCHEMA_VERSION = 1


def experiment_dir(root: Path, experiment_id: str) -> Path:
    """Resolve an experiment folder strictly inside root (rejects traversal and non-UUID names)."""
    if not isinstance(experiment_id, str) or not UUID_RE.match(experiment_id):
        raise ValueError('Unknown experiment id')
    root = Path(root).resolve()
    path = (root / experiment_id).resolve()
    if not path.is_relative_to(root) or path == root:
        raise ValueError('Experiment path escapes the recording root')
    return path


def _json_default(o):
    if isinstance(o, (np.integer,)): return int(o)
    if isinstance(o, (np.floating,)): return float(o)
    if isinstance(o, np.ndarray): return o.tolist()
    raise TypeError(type(o))


def dumps(obj) -> str:
    return json.dumps(obj, default=_json_default, allow_nan=False, separators=(',', ':'))


class RecordingWriter:
    def __init__(self, root: Path, experiment_id: str, channel_count: int, queue_limit: int = QUEUE_LIMIT):
        self.dir = experiment_dir(root, experiment_id)
        self.dir.mkdir(parents=True, exist_ok=False)
        self.channel_count = channel_count
        self.queue: queue.Queue = queue.Queue(maxsize=queue_limit)
        self.counts = dict(samples=0, events=0, frames=0, predictions=0, metrics=0)
        self.bytes = 0
        self.error: str | None = None
        self.state = 'recording'  # recording → saving → saved | failed
        self.first_sample: int | None = None
        self.last_sample: int | None = None
        self.sample_gaps = 0
        self._files = {}
        self._open()
        self.thread = threading.Thread(target=self._run, name=f'recorder-{experiment_id[:8]}', daemon=True)
        self.thread.start()

    def _open(self):
        for name in ('eeg.csv', 'events.jsonl', 'frames.jsonl', 'predictions.jsonl', 'metrics.jsonl'):
            self._files[name] = open(self.dir / name, 'w', encoding='utf-8', newline='\n')
        header = 'sample_index,timestamp_s,packet_counter,' + ','.join(f'ch{i+1}_uv' for i in range(self.channel_count))
        self._write('eeg.csv', header + '\n')

    def write_json(self, name: str, obj):
        tmp = self.dir / (name + '.tmp')
        tmp.write_text(json.dumps(obj, default=_json_default, allow_nan=False, indent=2), encoding='utf-8')
        tmp.replace(self.dir / name)

    # ---- producer side (never blocks) ----
    def put(self, kind: str, payload) -> bool:
        if self.state != 'recording':
            return False
        try:
            self.queue.put_nowait((kind, payload))
            return True
        except queue.Full:
            return False

    # ---- writer thread ----
    def _write(self, name, text):
        self._files[name].write(text)
        self.bytes += len(text)

    def _handle(self, kind, payload):
        if kind == 'eeg':
            start, ts, counters, eeg = payload
            n = eeg.shape[1]
            if self.last_sample is not None and start != self.last_sample + 1:
                self.sample_gaps += 1
            if self.first_sample is None:
                self.first_sample = start
            idx = np.arange(start, start + n)
            table = np.column_stack([idx, ts, counters, eeg.T])
            lines = '\n'.join(
                f'{int(r[0])},{r[1]:.6f},{int(r[2])},' + ','.join(f'{v:.6f}' for v in r[3:]) for r in table)
            self._write('eeg.csv', lines + '\n')
            self.counts['samples'] += n
            self.last_sample = start + n - 1
        elif kind in ('events', 'frames', 'predictions', 'metrics'):
            self._write(f'{kind}.jsonl', dumps(payload) + '\n')
            self.counts[kind] += payload.get('count', 1) if kind == 'frames' else 1
        elif kind == 'flush':
            for f in self._files.values():
                f.flush()

    def _run(self):
        while True:
            kind, payload = self.queue.get()
            if kind == 'close':
                self._finish(*payload)
                return
            if self.error:
                continue
            try:
                self._handle(kind, payload)
            except Exception as exc:  # disk full, permissions, encoding
                self.error = f'Recording write failed: {exc}'
                self.state = 'failed'

    def _finish(self, metadata, summary, done):
        try:
            for f in self._files.values():
                f.flush()
                f.close()
            if self.error:
                raise OSError(self.error)
            # Describe the files as they will be once these last two writes succeed.
            final = dict(self.describe(), state='saved')
            self.write_json('metadata.json', dict(metadata, recording=final))
            self.write_json('summary.json', dict(summary, recording=final))
            self.state = 'saved'
        except Exception as exc:
            self.error = self.error or f'Recording finalization failed: {exc}'
            self.state = 'failed'
            try:
                self.write_json('summary.json', dict(summary, recording=self.describe(), error=self.error))
            except Exception:
                pass
        finally:
            done.set()

    def close(self, metadata: dict, summary: dict, wait: float | None = None) -> threading.Event:
        """Drain the queue, finalize files. Returns an Event set when done (state saved/failed)."""
        done = threading.Event()
        if self.state == 'recording':
            self.state = 'saving'
        # The close marker must not be lost even if the queue is full.
        while True:
            try:
                self.queue.put(('close', (metadata, summary, done)), timeout=0.5)
                break
            except queue.Full:
                if not self.thread.is_alive():
                    done.set()
                    break
        if wait:
            done.wait(wait)
        return done

    def describe(self):
        return dict(state=self.state, path=str(self.dir), error=self.error, bytes=self.bytes,
                    first_sample=self.first_sample, last_sample=self.last_sample,
                    sample_discontinuities_in_file=self.sample_gaps, **self.counts)
