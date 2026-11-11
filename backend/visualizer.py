"""Read-only analytics for raw EEG, research recordings and experiment recordings.

Full-run statistics are computed before display reduction. EEG previews are bounded
to two minutes; neither opening this API nor changing an analysis gate affects capture.
"""
from __future__ import annotations

import csv
import itertools
import json
import math
from collections import Counter
from datetime import datetime
from functools import lru_cache
from pathlib import Path

import numpy as np
from fastapi import APIRouter, HTTPException, Query

from backend.continuity import timestamp_problem
from backend.recordings import EEG, RATE, TIMESTAMP, load_recording, resolve_recording
from backend.research import schema
from backend.research.store import Reader, read_json
from backend.signal import analyze


def number(v):
    return float(v) if isinstance(v, (int, float)) and math.isfinite(v) else None


def mean(values):
    values = [v for v in values if number(v) is not None]
    return sum(values) / len(values) if values else None


def epoch(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp() if value else 0.0


def public(value):
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {k: public(v) for k, v in value.items() if k not in ('local_folder', 'path', 'token')}
    if isinstance(value, list):
        return [public(v) for v in value]
    return value


def compact(points, limit=1000):
    """Retain extrema and a rejection gap in each display bin, in time order."""
    if len(points) <= limit:
        return points
    out = []
    size = math.ceil(len(points) / max(1, limit // 3))
    for start in range(0, len(points), size):
        chunk = points[start:start + size]
        valid = [i for i, p in enumerate(chunk) if p[1] is not None]
        keep = {0, len(chunk) - 1}
        if valid:
            keep |= {min(valid, key=lambda i: chunk[i][1]), max(valid, key=lambda i: chunk[i][1])}
        gap = next((i for i, p in enumerate(chunk) if p[1] is None), None)
        if gap is not None:
            keep.add(gap)
        out.extend(chunk[i] for i in sorted(keep))
    return out


def distribution(values):
    bins = [0] * 10
    for value in values:
        if number(value) is not None:
            bins[min(9, max(0, int(value * 10)))] += 1
    return bins


def channel_summary(rows, labels):
    out = []
    for c in range(1, 9):
        group = [r for r in rows if r.get('channel') == c]
        spans = [r['ptp_uv'] for r in group if number(r.get('ptp_uv')) is not None]
        out.append(dict(channel=c, label=f'Ch{c}' + (f' · {labels[c-1]}' if c <= len(labels) and labels[c-1] else ''),
                        windows=len(group), included_pct=100 * sum(bool(r.get('included')) for r in group) / len(group) if group else None,
                        std_uv=mean([r.get('std_uv') for r in group]), ptp_uv=max(spans) if spans else None,
                        relative_alpha=mean([r.get('relative_alpha') for r in group]),
                        reasons=dict(Counter(r.get('reason') or 'Unknown' for r in group if not r.get('included')))))
    return out


def typed_rows(reader, table):
    """Stream typed CSV/SQLite rows without loading an entire CSV text buffer."""
    names = schema.columns(table)
    return (dict(zip(names, row)) for row in reader.columns_of(table, names))


def spectrum(wave, rate, gate, breaks=None):
    """Mean normalized Hann periodogram of accepted channel/windows; never decimated EEG."""
    n = int(rate * 2)
    powers = []
    taper = np.hanning(n)
    # Bound analysis cost on long selections, and disclose the sampling below.
    starts = np.arange(0, max(0, len(wave) - n + 1), n)
    starts = starts[::max(1, math.ceil(len(starts) / 60))]
    for start in starts:
        if breaks is not None and np.any(breaks[start + 1:start + n]):
            continue
        block = wave[start:start + n].T
        _, metrics = analyze(block, rate, gate)
        for row, metric in zip(block, metrics):
            if not metric['included']:
                continue
            p = np.abs(np.fft.rfft((row - row.mean()) * taper)) ** 2 / (rate * np.sum(taper ** 2))
            p[1:-1] *= 2
            powers.append(p)
    freq = np.fft.rfftfreq(n, 1 / rate)
    psd = np.mean(powers, axis=0) if powers else np.zeros(len(freq))
    band = (freq >= 1) & (freq <= 40)
    return dict(points=[[float(f), float(p)] for f, p in zip(freq[band], psd[band])] if powers else [],
                channel_windows=len(powers), method='Mean-removed 2 s Hann periodograms; one-sided PSD in µV²/Hz. '
                'Up to 60 non-overlapping windows, accepted channels only; analysis gate shown above. Not the scoring feature.')


@lru_cache(maxsize=6)
def raw_summary(path, modified, gate):
    data = load_recording(path, modified)
    n = RATE * 2
    metrics, windows = [], []
    for start in range(0, len(data) - n + 1, n):
        block = data[start:start + n]
        value, detail = analyze(block[:, EEG].T, RATE, gate)
        problem = timestamp_problem(block[:, TIMESTAMP], RATE)
        if problem:
            value = None
        windows.append(dict(t=(start + n) / RATE, relative_alpha=value, accepted=value is not None))
        for d in detail:
            metrics.append(dict(channel=d['channel'], std_uv=d['std_uv'], ptp_uv=d['ptp_uv'],
                                included=d['included'] and not problem, reason=problem or d['reason'],
                                relative_alpha=d.get('rel_alpha') if not problem else None))
    accepted = sum(w['accepted'] for w in windows)
    values = [w['relative_alpha'] for w in windows if w['accepted']]
    return dict(summary=dict(duration_s=len(data) / RATE, samples=len(data), windows=len(windows),
                             accepted_pct=100 * accepted / len(windows) if windows else None,
                             mean_alpha=mean(values), mean_score=None, score_above_pct=None, rounds=0,
                             events=0, losses=0, timestamp_gaps=int(np.sum(np.diff(data[:, TIMESTAMP]) > .1)),
                             backwards_timestamps=int(np.sum(np.diff(data[:, TIMESTAMP]) < 0))),
                channels=channel_summary(metrics, []),
                series=dict(relative_alpha=compact([[w['t'], w['relative_alpha']] for w in windows]),
                            accepted=compact([[w['t'], int(w['accepted'])] for w in windows])),
                distribution=distribution(values), distribution_metric='Relative alpha',
                events=[], event_counts={}, rounds=[], calibrations=[],
                tables=[dict(name='eeg', count=len(data))],
                notes=['Raw recording: no saved calibration, game score or game events. Features are recomputed offline '
                       'in non-overlapping 2 s windows using the analysis gate; this does not reproduce a historical game score.',
                       'Elapsed time uses sample index / 250 Hz. Original host timestamps may arrive in bursts.'])


GAME_FIELDS = ['cairn_stones', 'cairn_sway_rad', 'cairn_fall_angle_rad', 'cairn_drop_sway_rad',
               'cairn_focus', 'cairn_unrest', 'cairn_gust_load', 'cairn_flicker_effective',
               'garden_growth', 'garden_response', 'garden_drive', 'garden_above_s', 'garden_pace_s']


@lru_cache(maxsize=8)
def research_summary(folder, modified):
    reader = Reader(Path(folder))
    meta = read_json(Path(folder) / 'metadata.json') or {}
    start = epoch(meta.get('started_at'))
    windows = list(typed_rows(reader, 'signal_windows'))
    frames = list(typed_rows(reader, 'input_frames'))
    channels = list(typed_rows(reader, 'channel_metrics'))
    rounds = list(typed_rows(reader, 'rounds'))
    events = list(typed_rows(reader, 'events'))
    scores = [r['score'] for r in frames if r.get('quality') == 'good' and r.get('calibrated') and number(r.get('score')) is not None]
    series = {}
    for field in ('relative_alpha', 'mapped_target', 'published_score', 'accepted', 'channels_included'):
        key = {'published_score': 'score', 'mapped_target': 'target'}.get(field, field)
        series[key] = compact([[r['computed_wall_s'] - start, number(r.get(field))] for r in windows])
    # Input frames include score-only simulations; rejected/uncalibrated frames remain gaps.
    series['score'] = compact([[r['emitted_wall_s'] - start, number(r.get('score')) if r.get('quality') == 'good' and r.get('calibrated') else None] for r in frames])
    tracks, previous, state_count = {field: [] for field in GAME_FIELDS}, {}, 0
    for r in typed_rows(reader, 'game_state'):
        state_count += 1
        if number(r.get('est_server_wall_s')) is None:
            continue
        for field in GAME_FIELDS:
            if r.get(field) is None:
                continue
            if field in previous and r.get('round_id') != previous[field]:
                tracks[field].append([r['est_server_wall_s'] - start, None])
            tracks[field].append([r['est_server_wall_s'] - start, number(r[field])])
            previous[field] = r.get('round_id')
    series.update({field: compact(points) for field, points in tracks.items() if points})
    counts = meta.get('rows_flushed') or meta.get('rows_written') or {}
    known = dict(signal_windows=len(windows), input_frames=len(frames), channel_metrics=len(channels),
                 rounds=len(rounds), events=len(events), game_state=state_count)
    return dict(summary=dict(duration_s=meta.get('duration_s') or 0, samples=counts.get('eeg', 0), windows=len(windows),
                             accepted_pct=100 * sum(bool(w['accepted']) for w in windows) / len(windows) if windows else None,
                             mean_alpha=mean([w['relative_alpha'] for w in windows]), mean_score=mean(scores),
                             score_above_pct=100 * sum(s > .5 for s in scores) / len(scores) if scores else None,
                             rounds=len(rounds), events=len(events), losses=len(meta.get('losses') or [])),
                channels=channel_summary(channels, meta.get('electrodes') or []), series=series,
                distribution=distribution(scores), distribution_metric='Usable frame score',
                events=[dict(t=(e.get('est_server_wall_s') or e.get('server_wall_s') or start) - start,
                             type=e['type'], game=e.get('game'), reason=e.get('reason')) for e in events[-500:]],
                event_counts=dict(Counter(e['type'] for e in events)), rounds=rounds[-500:],
                calibrations=list(typed_rows(reader, 'calibrations')),
                tables=[dict(name=t, count=known.get(t, counts.get(t, 0))) for t in schema.ORDER],
                notes=['Statistics cover the full recording; traces retain extrema and gaps for display. '
                       'Score statistics count usable calibrated input frames, not time-weighted exposure.',
                       'Elapsed time is relative to recording start. Replay EEG uses approximate batch receipt alignment. '
                       'Event overlap does not establish a cause.'], metadata=public(meta))


class Visualizer:
    def __init__(self, store, roots, experiments):
        self.store = store
        self.roots = {k: Path(p).resolve() for k, p in roots.items()}
        self.experiments = experiments

    def raw_path(self, ident):
        root, sep, name = ident.partition(':')
        if not sep or root not in self.roots:
            raise ValueError('Unknown recording root')
        return resolve_recording(self.roots[root], name)

    def runs(self):
        out, seen = [], set()
        for root_id, root in self.roots.items():
            for p in sorted(root.glob('**/BrainFlow-RAW*.csv')):
                resolved = p.resolve()
                if resolved in seen or not resolved.is_relative_to(root):
                    continue
                seen.add(resolved)
                out.append(dict(id=f'{root_id}:{p.relative_to(root).as_posix()}', kind='raw', label=p.stem.replace('BrainFlow-RAW_', ''),
                                sources=['replay'], games=[], state='saved', participant_id=None, duration_s=None, samples=None))
        for item in self.store.history():
            out.append(dict(item, id=item['recording_id'], kind='research',
                            label=f"{item.get('participant_id') or 'Unknown'} · {(item.get('started_at') or item['created_at'])[:19]}",
                            problem=item.get('problem'),
                            export_url=f"/api/research/recordings/{item['recording_id']}/export.zip" if item.get('exportable') else None))
        # Enumerate the entire history, rather than ExperimentManager.recent's UI default of 20.
        for item in self.experiments.recent(limit=1000000):
            meta = item.get('metadata') or {}
            out.append(dict(id=item['id'], kind='experiment', label=f"{meta.get('participant') or 'Experiment'} · {meta.get('kind', 'unknown')}",
                            sources=[meta.get('source', 'unknown')], games=[meta.get('kind', 'unknown')], state=meta.get('state', 'unknown'),
                            participant_id=meta.get('participant'), started_at=meta.get('started_at'), duration_s=None,
                            export_url=f"/api/experiments/{item['id']}/export" if item.get('complete') else None))
        return out

    def research_folder(self, ident):
        if self.store.active_id() == ident:
            raise PermissionError('This recording is active. Use Live, then Stop & save to inspect persisted data.')
        return self.store.folder(ident)

    def analysis(self, kind, ident, start, end, gate):
        if not (math.isfinite(start) and math.isfinite(end)) or start < 0 or end <= start or end - start > 120:
            raise ValueError('Select a positive interval of at most 120 seconds')
        run = next((r for r in self.runs() if r['kind'] == kind and r['id'] == ident), None)
        if run is None:
            raise KeyError('Recording is no longer available')
        if kind == 'raw':
            path = self.raw_path(ident)
            modified = path.stat().st_mtime_ns
            overview = raw_summary(str(path), modified, gate)
            data = load_recording(str(path), modified)
            a, b = int(start * RATE), min(len(data), math.ceil(end * RATE))
            wave = data[a:b, EEG]
            times = np.arange(a, b) / RATE
            breaks = np.r_[False, np.diff(data[a:b, TIMESTAMP]) < 0] if b > a else np.array([], dtype=bool)
            for i in range(0, max(0, len(wave) - 2 * RATE + 1), 2 * RATE):
                if timestamp_problem(data[a+i:a+i+2*RATE, TIMESTAMP], RATE):
                    breaks[i:i+2*RATE] = True
            detail = dict(events=[], eeg_time_basis='Sample index / 250 Hz; original timestamps retained in data table.')
        elif kind == 'research':
            folder = self.research_folder(ident)
            overview = research_summary(str(folder), (folder / 'metadata.json').stat().st_mtime_ns)
            origin = epoch(overview['metadata'].get('started_at'))
            detail = self.store.window(ident, origin + start, origin + end, max_points=1000000)
            times = np.array([r['t'] - origin for r in detail['eeg']])
            wave = np.array([r['ch'] for r in detail['eeg']], dtype=float).reshape(-1, 8)
            # A sample gap or acquisition change breaks a spectral window.
            recorded_breaks = set()
            reader = Reader(folder)
            for aid, samples, sample_start, outage in reader.columns_of('batches',
                    ['acquisition_id', 'discontinuity_samples', 'sample_start', 'after_outage']):
                recorded_breaks.update((aid, int(index)) for index in (samples or '').split(';') if index)
                if outage:
                    recorded_breaks.add((aid, sample_start))
            breaks = np.array([i == 0 or (r['acquisition_id'], r['sample_index']) in recorded_breaks
                               or r['acquisition_id'] != detail['eeg'][i-1]['acquisition_id']
                               or r['sample_index'] != detail['eeg'][i-1]['sample_index'] + 1
                               for i, r in enumerate(detail['eeg'])])
            detail = dict(events=[dict(t=(e.get('est_server_wall_s') or e['server_wall_s']) - origin,
                                      type=e['type'], game=e.get('game'), reason=e.get('reason')) for e in detail['events']][:500],
                          eeg_time_basis=detail['eeg_time_basis'])
        else:
            return self.experiment_analysis(ident, start, end, gate, run)
        stride = max(1, math.ceil(len(wave) / 1600))
        return dict(overview, run=dict(run, duration_s=overview['summary']['duration_s']), start=start, end=end,
                    eeg=[dict(t=float(t), ch=[number(float(v)) for v in row]) for t, row in zip(times[::stride], wave[::stride])],
                    eeg_stride=stride, eeg_samples_in_range=len(wave), spectrum=spectrum(wave, RATE, gate, breaks),
                    selection=detail)

    def table(self, kind, ident, table, offset, limit):
        skip = offset
        if kind == 'research':
            if table not in schema.ORDER:
                raise ValueError('Unknown recording table')
            reader = Reader(self.research_folder(ident))
            if table == 'eeg':
                rows = reader.row_spans(table, [(offset, offset + limit + 1)])
                skip = 0
            else:
                rows = typed_rows(reader, table)
            columns = [dict(name=c[0], unit=c[2], description=c[3]) for c in schema.TABLES[table]]
        elif kind == 'raw':
            if table != 'eeg':
                raise ValueError('Raw recordings only contain EEG')
            path = self.raw_path(ident)
            data = load_recording(str(path), path.stat().st_mtime_ns)
            board_names = ['packet_counter'] + [f'ch{i}_uv' for i in range(1, 9)] + ['accel_x', 'accel_y', 'accel_z'] \
                + [f'board_aux_{i}' for i in range(12, 19)] + ['analog_1', 'analog_2', 'analog_3', 'source_timestamp_s', 'marker']
            names = ['sample_index'] + board_names
            columns = [dict(name=n, unit='µV' if n.startswith('ch') else 's' if n.endswith('_s') else '',
                            description='Sample position' if i == 0 else f'Original Cyton BrainFlow row {i-1}') for i, n in enumerate(names)]
            rows = (dict(zip(names, [i] + [float(v) for v in r])) for i, r in enumerate(data))
        else:
            folder = self.experiments.folder(ident)
            if table not in ('eeg', 'events', 'frames', 'predictions', 'metrics'):
                raise ValueError('Unknown experiment table')
            rows = self.experiment_rows(folder, table)
            columns = []
        page = list(itertools.islice(rows, skip, skip + limit + 1))
        if not columns and page:
            columns = [dict(name=k, unit='', description='') for k in page[0]]
        return dict(columns=columns, rows=public(page[:limit]), offset=offset, has_more=len(page) > limit)

    @staticmethod
    def experiment_rows(folder, table):
        path = folder / (f'{table}.csv' if table == 'eeg' else f'{table}.jsonl')
        if not path.exists():
            return
        with path.open(encoding='utf-8', newline='') as f:
            if table == 'eeg':
                for r in csv.DictReader(f):
                    yield {k: float(v) if v else None for k, v in r.items()}
            else:
                for line in f:
                    if line.strip():
                        yield json.loads(line)

    def experiment_analysis(self, ident, start, end, gate, run):
        folder = self.experiments.folder(ident)
        meta = read_json(folder / 'metadata.json') or {}
        summary = read_json(folder / 'summary.json') or {}
        rate = meta.get('sample_rate_hz') or RATE
        first, total, eeg = None, 0, []
        for r in self.experiment_rows(folder, 'eeg'):
            first = r['sample_index'] if first is None else first
            t = (r['sample_index'] - first) / rate
            total += 1
            if start <= t < end:
                eeg.append(dict(t=t, index=r['sample_index'], ch=[r[f'ch{i}_uv'] for i in range(1, 9)]))
        wave = np.array([r['ch'] for r in eeg], dtype=float).reshape(-1, 8)
        breaks = np.array([i == 0 or r['index'] != eeg[i-1]['index'] + 1 for i, r in enumerate(eeg)])
        stride = max(1, math.ceil(len(eeg) / 1600))
        counts = meta.get('recording') or summary.get('recording') or {}
        origin = first if first is not None else 0
        series, metrics, accepted = {}, [], []
        for r in self.experiment_rows(folder, 'metrics'):
            bounds = r.get('window')
            if not bounds:
                continue
            t = (bounds[1] - origin) / rate
            valid = [c for c in r.get('channels', []) if c.get('valid') and not r.get('discontinuous')]
            accepted.append(bool(valid))
            for field in ('theta', 'alpha', 'beta', 'rms'):
                series.setdefault(f'band_{field}', []).append([t, mean([c.get(field) for c in valid])])
            for i, c in enumerate(r.get('channels', [])):
                metrics.append(dict(channel=i+1, included=c.get('valid') and not r.get('discontinuous'),
                                    std_uv=c.get('rms'), ptp_uv=None, relative_alpha=None,
                                    reason='Discontinuous window' if r.get('discontinuous') else c.get('reason')))
        frequencies = (meta.get('settings', {}).get('ssvep') or {}).get('frequencies_hz') or [10, 12, 15]
        for r in self.experiment_rows(folder, 'predictions'):
            bounds = r.get('window')
            if r.get('type') != 'window' or not bounds:
                continue
            t = (bounds[1] - origin) / rate
            for i, hz in enumerate(frequencies):
                correlations = r.get('correlations') or []
                series.setdefault(f'cca_{hz:g}_hz', []).append([t, number(correlations[i]) if r.get('valid') and i < len(correlations) else None])
        events, event_counts = [], Counter()
        for r in self.experiment_rows(folder, 'events'):
            event_counts[r.get('type', 'unknown')] += 1
            index = (r.get('alignment') or {}).get('sample_index')
            if number(index) is not None and first is not None:
                events.append(dict(t=(index - first) / rate, type=r.get('type', 'unknown'), game=meta.get('kind'),
                                   reason='Software sample estimate · optical timing unverified'))
        return dict(run=dict(run, duration_s=total / rate), start=start, end=end,
                    summary=dict(duration_s=total / rate, samples=total, windows=len(accepted) if accepted else None,
                                 accepted_pct=100 * sum(accepted) / len(accepted) if accepted else None,
                                 mean_alpha=None, mean_score=None, score_above_pct=None, rounds=None,
                                 events=counts.get('events', 0), losses=counts.get('sample_discontinuities_in_file', 0)),
                    channels=channel_summary(metrics, meta.get('electrodes') or []),
                    series={field: compact(points) for field, points in series.items()}, distribution=[0]*10,
                    distribution_metric='Unavailable', events=events[-500:], event_counts=dict(event_counts), rounds=[], calibrations=[],
                    tables=[dict(name=t, count=total if t == 'eeg' else counts.get(t)) for t in ('eeg', 'events', 'frames', 'predictions', 'metrics')],
                    metadata=public(dict(meta, experiment_summary=summary)),
                    notes=['Experiment predictions, band metrics, trials and display frames are available in the data explorer. '
                           'EEG elapsed time starts at the first recorded sample. Event overlays use recorded software sample estimates, '
                           'not measured optical onset. Bilateral acceptance means at least one valid channel in a continuous window.'],
                    eeg=[dict(t=r['t'], ch=[number(v) for v in r['ch']]) for r in eeg[::stride]], eeg_stride=stride, eeg_samples_in_range=len(eeg),
                    spectrum=spectrum(wave, rate, gate, breaks), selection=dict(events=[e for e in events if start <= e['t'] <= end][:500],
                        eeg_time_basis='Acquisition sample index relative to the first recorded sample.'))


def visualizer_router(store, roots, experiments):
    router = APIRouter(prefix='/api/visualizer', tags=['visualizer'])
    viewer = Visualizer(store, roots, experiments)

    def failure(exc):
        code = 409 if isinstance(exc, PermissionError) else 404 if isinstance(exc, (KeyError, FileNotFoundError)) else 400 if isinstance(exc, ValueError) else 500
        return HTTPException(code, str(exc))

    @router.get('/runs')
    def runs():
        return dict(runs=viewer.runs())

    @router.get('/analysis')
    def analysis(kind: str = Query(pattern='^(raw|research|experiment)$'), id: str = '',
                 start: float = 0, end: float = 30, gate: float = Query(default=500, ge=100, le=5000)):
        try:
            return viewer.analysis(kind, id, start, end, gate)
        except Exception as exc:
            raise failure(exc) from exc

    @router.get('/table')
    def table(kind: str = Query(pattern='^(raw|research|experiment)$'), id: str = '', table: str = 'eeg',
              offset: int = Query(default=0, ge=0), limit: int = Query(default=50, ge=1, le=200)):
        try:
            return viewer.table(kind, id, table, offset, limit)
        except Exception as exc:
            raise failure(exc) from exc

    return router
