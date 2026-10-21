"""Reading finalized recordings: history, windowed review, crash recovery and the CSV ZIP export.

Exports never mutate the recording. CSV is produced from the CSV files when
they exist, otherwise from SQLite with the same canonical formatter, so every
storage mode yields the same portable ZIP.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import sqlite3
import tempfile
import zipfile
from pathlib import Path

from backend.research import flags, schema
from backend.research.destinations import Destinations, now_iso

FINAL_STATES = {'saved', 'incomplete', 'failed', 'recovered_incomplete'}
PRIVATE_META_KEYS = {'local_folder'}


def read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None


def parse(value: str, typ: str):
    if value == '':
        return None
    if typ in ('INTEGER', 'BOOL'):
        return int(value)
    if typ == 'REAL':
        return float(value)
    return value


class Reader:
    """Typed row access to one recording, from SQLite if present, else CSV."""

    def __init__(self, folder: Path):
        self.folder = folder
        self.db_path = folder / 'recording.sqlite'
        self.has_csv = (folder / 'eeg.csv').exists()
        self.has_db = self.db_path.exists()
        if not (self.has_csv or self.has_db):
            raise FileNotFoundError('No recording data found')

    def rows(self, table, where=None):
        """Yield dict rows. `where` is an optional predicate on the dict."""
        cols = schema.columns(table)
        types = schema.col_types(table)
        if self.has_csv and (self.folder / f'{table}.csv').exists():
            with open(self.folder / f'{table}.csv', encoding='utf-8', newline='') as f:
                text = f.read()
            complete = text if text.endswith('\n') else text[: text.rfind('\n') + 1]
            r = csv.reader(io.StringIO(complete))
            next(r, None)
            for line in r:
                if len(line) != len(cols):
                    continue
                d = {c: parse(v, t) for c, v, t in zip(cols, line, types)}
                if where is None or where(d):
                    yield d
            return
        db = sqlite3.connect(f'file:{self.db_path}?mode=ro', uri=True)
        try:
            for row in db.execute(f'SELECT * FROM "{table}" ORDER BY rowid'):
                d = dict(zip(cols, row))
                if where is None or where(d):
                    yield d
        finally:
            db.close()

    def columns_of(self, table, names):
        """Yield typed tuples of just `names`, in stored order (cheaper than rows() for eeg)."""
        cols = schema.columns(table)
        types = schema.col_types(table)
        pos = [cols.index(n) for n in names]
        if self.has_csv and (self.folder / f'{table}.csv').exists():
            with open(self.folder / f'{table}.csv', encoding='utf-8', newline='') as f:
                f.readline()  # header
                complete = (line for line in f if line.endswith('\n'))  # drop a truncated tail
                for vals in csv.reader(complete):
                    if len(vals) == len(cols):
                        yield tuple(parse(vals[i], types[i]) for i in pos)
            return
        db = sqlite3.connect(f'file:{self.db_path}?mode=ro', uri=True)
        try:
            sel = ', '.join(f'"{n}"' for n in names)
            yield from db.execute(f'SELECT {sel} FROM "{table}" ORDER BY rowid')
        finally:
            db.close()

    def row_spans(self, table, spans):
        """Rows by position: [(start, end), ...] half-open, ascending (0 = first data row)."""
        if not spans:
            return
        cols = schema.columns(table)
        types = schema.col_types(table)
        if self.has_csv and (self.folder / f'{table}.csv').exists():
            with open(self.folder / f'{table}.csv', encoding='utf-8', newline='') as f:
                f.readline()  # header
                k, i = 0, 0
                for line in f:
                    while k < len(spans) and i >= spans[k][1]:
                        k += 1
                    if k == len(spans):
                        break
                    if i >= spans[k][0] and line.endswith('\n'):
                        vals = next(csv.reader([line]))
                        if len(vals) == len(cols):
                            yield {c: parse(v, t) for c, v, t in zip(cols, vals, types)}
                    i += 1
            return
        db = sqlite3.connect(f'file:{self.db_path}?mode=ro', uri=True)
        try:
            for a, b in spans:
                for r in db.execute(f'SELECT * FROM "{table}" ORDER BY rowid LIMIT ? OFFSET ?', (b - a, a)):
                    yield dict(zip(cols, r))
        finally:
            db.close()

    def csv_lines(self, table):
        """Canonical CSV body lines and whether a truncated tail was dropped."""
        if self.has_csv and (self.folder / f'{table}.csv').exists():
            data = (self.folder / f'{table}.csv').read_bytes()
            truncated = bool(data) and not data.endswith(b'\n')
            if truncated:
                data = data[: data.rfind(b'\n') + 1]
            return data, truncated
        types = schema.col_types(table)
        frees = schema.free_flags(table)
        out = [schema.header(table)]
        db = sqlite3.connect(f'file:{self.db_path}?mode=ro', uri=True)
        try:
            for row in db.execute(f'SELECT * FROM "{table}" ORDER BY rowid'):
                out.append(schema.row_line(table, row, types, frees))
        finally:
            db.close()
        return ('\n'.join(out) + '\n').encode('utf-8'), False

    def count(self, table):
        if self.has_csv and (self.folder / f'{table}.csv').exists():
            data, _ = self.csv_lines(table)
            return max(0, data.count(b'\n') - 1)
        db = sqlite3.connect(f'file:{self.db_path}?mode=ro', uri=True)
        try:
            return db.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
        finally:
            db.close()


class Store:
    def __init__(self, destinations: Destinations, active_id=lambda: None):
        self.dest = destinations
        self.active_id = active_id

    def folder(self, recording_id):
        return self.dest.locate(recording_id)

    def history(self):
        out = []
        for e in reversed(self.dest.index()):
            item = dict(recording_id=e['recording_id'], destination_id=e['destination_id'], created_at=e['created_at'])
            try:
                folder = self.dest.recording_folder(e['destination_id'], e['recording_id'])
            except (KeyError, FileNotFoundError, ValueError) as exc:
                item.update(state='destination_unavailable', problem=str(exc))
                out.append(item)
                continue
            meta = read_json(folder / 'metadata.json') if folder.is_dir() else None
            if not meta:
                item.update(state='missing', problem='Recording folder or metadata missing')
                out.append(item)
                continue
            active = self.active_id() == e['recording_id']
            item.update(participant_id=meta.get('participant_id'), condition=meta.get('condition'),
                        storage_format=meta.get('storage_format'), started_at=meta.get('started_at'),
                        ended_at=meta.get('ended_at'), state='recording' if active else meta.get('state'),
                        end_reason=meta.get('end_reason'), games=meta.get('games', []),
                        samples=(meta.get('rows_written') or {}).get('eeg'), losses=len(meta.get('losses') or []),
                        sources=meta.get('sources') or [], duration_s=meta.get('duration_s'), exportable=not active and meta.get('state') in FINAL_STATES)
            out.append(item)
        return out

    def recover(self):
        """Mark recordings left 'recording'/'finalizing' by a crash as recovered_incomplete (never complete)."""
        fixed = []
        for e in self.dest.index():
            if self.active_id() == e['recording_id']:
                continue
            try:
                folder = self.dest.recording_folder(e['destination_id'], e['recording_id'])
            except Exception:
                continue
            meta = read_json(folder / 'metadata.json')
            if not meta or meta.get('state') not in ('recording', 'finalizing'):
                continue
            try:
                reader = Reader(folder)
                rebuilt = self._recover_acquisitions(folder, reader, meta)
                rows = {t: reader.count(t) for t in schema.ORDER}
            except Exception as exc:
                rows = {'error': str(exc)}
            meta.update(state='recovered_incomplete', recovered_at=now_iso(), rows_persisted=rows,
                        end_reason=meta.get('end_reason') or 'Backend stopped while recording; tail may be lost')
            meta.setdefault('losses', []).append(dict(at=now_iso(), reason='Crash recovery: unknown tail loss after last flush'))
            (folder / 'metadata.json').write_text(json.dumps(meta, indent=2), encoding='utf-8')
            (folder / 'manifest.json').write_text(json.dumps(dict(
                recording_id=e['recording_id'], state='recovered_incomplete', complete=False, rows=rows,
                losses=meta['losses'], finalized_at=now_iso()), indent=2), encoding='utf-8')
            fixed.append(e['recording_id'])
        return fixed

    def _recover_acquisitions(self, folder, reader, meta):
        """Acquisition rows are written when a segment ends; after a crash, rebuild the missing ones
        from their acquisition_started events and the stored samples (end marked as recovered)."""
        from backend.research.recorder import SOURCE_LABEL
        from backend.research.sinks import normalize
        have = {a['acquisition_id'] for a in reader.rows('acquisitions')}
        started = [e for e in reader.rows('events', lambda d: d['type'] == 'acquisition_started')
                   if e['acquisition_id'] and e['acquisition_id'] not in have]
        if not started:
            return 0
        last_batch, first_sample = {}, {}
        for b in reader.rows('batches'):
            last_batch[b['acquisition_id']] = b['receipt_wall_s']
            first_sample.setdefault(b['acquisition_id'], b['sample_start'])
        out = []
        for e in started:
            try:
                p = json.loads(e['payload_json'] or '{}')
            except ValueError:
                p = {}
            src = p.get('source') or 'unknown'
            aid = e['acquisition_id']
            out.append((meta.get('recording_id'), meta.get('participant_id'), aid, src, SOURCE_LABEL.get(src, src),
                        p.get('board') or '', meta.get('sample_rate_hz'), meta.get('channel_count'), e['server_wall_s'],
                        last_batch.get(aid), 'recovered_after_crash', bool(p.get('partial_start')),
                        first_sample.get(aid), p.get('replay_file_name'), None))
        out = [normalize('acquisitions', r) for r in out]
        path = folder / 'acquisitions.csv'
        if path.exists():
            data = path.read_bytes()
            if data and not data.endswith(b'\n'):
                path.write_bytes(data[: data.rfind(b'\n') + 1])
            types, frees = schema.col_types('acquisitions'), schema.free_flags('acquisitions')
            with open(path, 'a', encoding='utf-8', newline='') as f:
                for r in out:
                    f.write(schema.row_line('acquisitions', r, types, frees) + '\n')
        db_path = folder / 'recording.sqlite'
        if db_path.exists():
            db = sqlite3.connect(db_path)
            try:
                cols = schema.columns('acquisitions')
                db.executemany(f'INSERT INTO "acquisitions" ({", ".join(chr(34) + c + chr(34) for c in cols)}) '
                               f'VALUES ({", ".join("?" * len(cols))})', out)
                db.commit()
                db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
                db.execute('PRAGMA journal_mode=DELETE')
            finally:
                db.close()
        return len(out)

    # ---------------------------------------------------------------- export
    def export_zip(self, recording_id) -> tuple[Path, str]:
        if self.active_id() == recording_id:
            raise PermissionError('Stop the recording before exporting.')
        folder = self.folder(recording_id)
        meta = read_json(folder / 'metadata.json') or {}
        if meta.get('state') not in FINAL_STATES:
            raise PermissionError('Recording is not finalized yet.')
        reader = Reader(folder)
        manifest = dict(recording_id=recording_id, participant_id=meta.get('participant_id'),
                        schema_version=schema.SCHEMA_VERSION, state=meta.get('state'),
                        complete=meta.get('state') == 'saved', end_reason=meta.get('end_reason'),
                        losses=meta.get('losses') or [], parity=meta.get('parity'), exported_at=now_iso(),
                        storage_format=meta.get('storage_format'), files={})
        tmpdir = Path(tempfile.mkdtemp(prefix='bci-research-'))
        name = f"research-{meta.get('participant_id', 'P')}-{(meta.get('started_at') or '')[:10]}-{recording_id[:8]}"
        path = tmpdir / f'{name}.zip'
        with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED) as z:
            for t in schema.ORDER:
                data, truncated = reader.csv_lines(t)
                z.writestr(f'{name}/{t}.csv', data)
                manifest['files'][f'{t}.csv'] = dict(rows=max(0, data.count(b'\n') - 1), bytes=len(data),
                                                     sha256=hashlib.sha256(data).hexdigest(),
                                                     truncated_tail_dropped=truncated)
            data = flags.csv_bytes(reader)
            z.writestr(f'{name}/{flags.TABLE}.csv', data)
            manifest['files'][f'{flags.TABLE}.csv'] = dict(rows=max(0, data.count(b'\n') - 1), bytes=len(data),
                                                           sha256=hashlib.sha256(data).hexdigest(),
                                                           derived_from=['events.csv', 'acquisitions.csv', 'eeg.csv'])
            shared = {k: v for k, v in meta.items() if k not in PRIVATE_META_KEYS}
            md = json.dumps(shared, indent=2).encode('utf-8')
            z.writestr(f'{name}/metadata.json', md)
            dd = schema.data_dictionary().encode('utf-8')
            z.writestr(f'{name}/data_dictionary.md', dd)
            for fn, b in (('metadata.json', md), ('data_dictionary.md', dd)):
                manifest['files'][fn] = dict(bytes=len(b), sha256=hashlib.sha256(b).hexdigest())
            z.writestr(f'{name}/manifest.json', json.dumps(manifest, indent=2))
        return path, f'{name}.zip'

    def table_csv(self, recording_id, table) -> tuple[bytes, str]:
        """One finalized table as portable CSV (same bytes as inside the ZIP)."""
        if table not in schema.EXPORT_ORDER:
            raise KeyError(f'Unknown table {table}')
        if self.active_id() == recording_id:
            raise PermissionError('Stop the recording before downloading.')
        folder = self.folder(recording_id)
        meta = read_json(folder / 'metadata.json') or {}
        if meta.get('state') not in FINAL_STATES:
            raise PermissionError('Recording is not finalized yet.')
        reader = Reader(folder)
        data = flags.csv_bytes(reader) if table == flags.TABLE else reader.csv_lines(table)[0]
        return data, f"research-{meta.get('participant_id', 'P')}-{recording_id[:8]}-{table}.csv"

    def database_path(self, recording_id) -> Path:
        if self.active_id() == recording_id:
            raise PermissionError('Stop the recording before downloading.')
        folder = self.folder(recording_id)
        p = folder / 'recording.sqlite'
        if not p.exists():
            raise FileNotFoundError('This recording has no SQLite database (CSV format).')
        return p

    # ---------------------------------------------------------------- review
    def detail(self, recording_id):
        folder = self.folder(recording_id)
        meta = read_json(folder / 'metadata.json') or {}
        shared = {k: v for k, v in meta.items() if k not in PRIVATE_META_KEYS}
        if self.active_id() == recording_id:
            return dict(metadata=shared, live=True)
        reader = Reader(folder)
        rounds = list(reader.rows('rounds'))
        events = [e for e in reader.rows('events') if e['type'] not in ('clock_sync',)]
        acqs = list(reader.rows('acquisitions'))
        cals = list(reader.rows('calibrations'))
        return dict(metadata=shared, manifest=read_json(folder / 'manifest.json'), rounds=rounds,
                    events=events[:5000], acquisitions=acqs, calibrations=cals)

    def window(self, recording_id, t0, t1, max_points=1500):
        """Everything between server wall times t0..t1 (seconds), with EEG decimated for display."""
        if self.active_id() == recording_id:
            raise PermissionError('Stop the recording to review it.')
        if not (math.isfinite(t0) and math.isfinite(t1)) or t1 <= t0 or t1 - t0 > 600:
            raise ValueError('Choose a window of at most 10 minutes')
        reader = Reader(self.folder(recording_id))
        inside = lambda k: (lambda d: d.get(k) is not None and t0 <= d[k] <= t1)
        events = list(reader.rows('events', lambda d: (d.get('est_server_wall_s') or d.get('server_wall_s') or 0) >= t0
                                  and (d.get('est_server_wall_s') or d.get('server_wall_s') or 0) <= t1))
        # Frames in range, plus the frames events in range actually used (input can lag the event).
        refs = {(e['input_acquisition_id'], e['input_sequence']) for e in events if e.get('input_sequence') is not None}
        frames = list(reader.rows('input_frames', lambda d: (d.get('emitted_wall_s') is not None and t0 <= d['emitted_wall_s'] <= t1)
                                  or (d['acquisition_id'], d['sequence']) in refs))
        windows = list(reader.rows('signal_windows', inside('computed_wall_s')))
        keys = {(w['acquisition_id'], w['window_id']) for w in windows}
        # Also include windows referenced by frames (their computation may be before t0).
        extra = {(f['acquisition_id'], f['window_id']) for f in frames if f['window_id'] is not None} - keys
        if extra:
            windows += list(reader.rows('signal_windows', lambda d: (d['acquisition_id'], d['window_id']) in extra))
            keys |= extra
        metrics = list(reader.rows('channel_metrics', lambda d: (d['acquisition_id'], d['window_id']) in keys))
        states = list(reader.rows('game_state', inside('est_server_wall_s')))
        acqs = {a['acquisition_id']: a for a in reader.rows('acquisitions')}
        # EEG wall time: live/simulated use source timestamps; replay uses batch receipt time (approximate).
        # eeg rows are written batch by batch, in batches.csv order, so a batch's rows are a contiguous
        # row span: read only the spans near the window instead of the whole table.
        all_batches, first, row = [], {}, 0
        for b in reader.rows('batches'):
            all_batches.append((row, b))
            first.setdefault(b['acquisition_id'], (row, b))
            row += b['sample_count'] or 0
        # Source clocks may not be wall time (e.g. a board's own clock): offset per acquisition
        # from its first sample, so the receipt-time preselection lands on the right batches.
        offset = {}
        heads = sorted(first.values(), key=lambda x: x[0])
        for (r0, b), e in zip(heads, reader.row_spans('eeg', [(r0, r0 + 1) for r0, _ in heads])):
            if e['acquisition_id'] != b['acquisition_id']:
                continue
            src = acqs.get(b['acquisition_id'], {}).get('source')
            offset[b['acquisition_id']] = 0.0 if src == 'replay' or e['source_timestamp_s'] is None else \
                e['source_timestamp_s'] - b['receipt_wall_s']
        batches, spans = {}, []
        for row, b in all_batches:
            n = b['sample_count'] or 0
            if t0 - 5 <= b['receipt_wall_s'] + offset.get(b['acquisition_id'], 0.0) <= t1 + 5:
                batches[(b['acquisition_id'], b['batch_id'])] = b
                if spans and spans[-1][1] == row:
                    spans[-1] = (spans[-1][0], row + n)
                else:
                    spans.append((row, row + n))
        eeg = []
        for r in reader.row_spans('eeg', spans):
            a = acqs.get(r['acquisition_id'], {})
            if a.get('source') == 'replay':
                b = batches.get((r['acquisition_id'], r['batch_id']))
                if not b:
                    continue
                t = b['receipt_wall_s'] - (b['sample_end'] - 1 - r['sample_index']) / (a.get('sample_rate_hz') or 250)
            else:
                t = r['source_timestamp_s']
            if t0 <= t <= t1:
                eeg.append((t, r))
        stride = max(1, len(eeg) // max_points)
        dec = [dict(t=t, acquisition_id=r['acquisition_id'], sample_index=r['sample_index'],
                    ch=[r[f'ch{i}_uv'] for i in range(1, 9)]) for t, r in eeg[::stride]]
        return dict(t0=t0, t1=t1, frames=frames, windows=windows, channel_metrics=metrics, game_state=states,
                    events=events, eeg=dec, eeg_stride=stride, eeg_samples_in_range=len(eeg),
                    eeg_time_basis='source timestamps (live/simulated); batch receipt time (replay, approximate)')
