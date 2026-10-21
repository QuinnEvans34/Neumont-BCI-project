"""Inspect an exported research ZIP: row counts and checksums vs manifest, no local paths, EEG continuity,
event -> frame -> window -> EEG linkage, 8 channel rows per window, marker escaping.

Usage: python tools/research/check_export.py research-P012-....zip
"""
import csv, io, json, sys, zipfile, collections, hashlib

path = sys.argv[1]
z = zipfile.ZipFile(path)
names = z.namelist()
root = names[0].split('/')[0]
tables = {}
for n in names:
    if n.endswith('.csv'):
        text = z.read(n).decode('utf-8')
        tables[n.split('/')[-1][:-4]] = list(csv.DictReader(io.StringIO(text)))
print('files:', sorted(n.split('/')[-1] for n in names))
manifest = json.loads(z.read(f'{root}/manifest.json'))
meta = json.loads(z.read(f'{root}/metadata.json'))
print('state', manifest['state'], 'complete', manifest['complete'], 'losses', manifest['losses'], 'parity', manifest.get('parity'))
for t, rows in tables.items():
    print(f'  {t:16s} {len(rows):8d} rows  manifest={manifest["files"][t + ".csv"]["rows"]}')
    assert len(rows) == manifest['files'][t + '.csv']['rows']
    data = z.read(f'{root}/{t}.csv')
    assert hashlib.sha256(data).hexdigest() == manifest['files'][t + '.csv']['sha256']

# No absolute local paths anywhere in the export.
blob = b''.join(z.read(n) for n in names)
for needle in [b'/tmp/', b'/Users/', b'/home/', b'C:\\\\', b'scratchpad', b'local_folder']:
    assert needle not in blob, f'found {needle!r} in export'
print('no local paths: ok')

# EEG: each sample exactly once per acquisition, contiguous except logged discontinuities.
eeg = tables['eeg']
by_acq = collections.defaultdict(list)
for r in eeg:
    by_acq[r['acquisition_id']].append(int(r['sample_index']))
for a, idx in by_acq.items():
    assert len(idx) == len(set(idx)), 'duplicate samples'
    gaps = sum(1 for x, y in zip(idx, idx[1:]) if y != x + 1)
    print(f'  acquisition {a[:8]}: {len(idx)} samples, {idx[0]}..{idx[-1]}, non-contiguous steps {gaps}')
acqs = tables['acquisitions']
print('acquisitions:', [(a['acquisition_id'][:8], a['source'], a['end_reason'], a['partial_start']) for a in acqs])

# Linkage: event -> input frame -> window -> eeg sample range.
frames = {(f['acquisition_id'], f['sequence']): f for f in tables['input_frames']}
windows = {(w['acquisition_id'], w['window_id']): w for w in tables['signal_windows']}
eeg_set = {(r['acquisition_id'], int(r['sample_index'])) for r in eeg}
linked = unlinked = 0
for e in tables['events']:
    if e['input_sequence']:
        f = frames.get((e['input_acquisition_id'], e['input_sequence']))
        if f is None:
            unlinked += 1
            continue
        linked += 1
        if f['window_id']:
            w = windows[(f['acquisition_id'], f['window_id'])]
            assert (w['acquisition_id'], int(w['sample_start'])) in eeg_set and (w['acquisition_id'], int(w['sample_end']) - 1) in eeg_set
print(f'events linked to frames: {linked}, not found: {unlinked}')
fw = sum(1 for f in tables['input_frames'] if f['window_id'])
print(f'frames with window: {fw}/{len(tables["input_frames"])}')
metrics = collections.Counter((m['acquisition_id'], m['window_id']) for m in tables['channel_metrics'])
assert all(metrics[k] == 8 for k in windows), 'each window has 8 channel rows'
print('every window has 8 channel_metrics rows: ok')

types = collections.Counter(e['type'] for e in tables['events'])
print('event types:', dict(sorted(types.items())))
print('rounds:', [(r['game'], r['mode'], r['outcome'], r['partial_start']) for r in tables['rounds']])
kinds = collections.Counter((s['game'], s['kind']) for s in tables['game_state'])
print('game_state kinds:', dict(kinds))
markers = [e['reason'] for e in tables['events'] if e['type'] == 'marker']
print('marker reasons:', markers)
for m in markers:
    assert not m[:1] in '=+-@', 'formula not escaped'
unc = [float(e['sample_uncertainty_ms']) for e in tables['events'] if e['sample_uncertainty_ms']]
if unc:
    unc.sort()
    print(f'sample uncertainty ms: median {unc[len(unc)//2]:.1f}, max {unc[-1]:.1f}, n={len(unc)}')
print('alignment methods:', collections.Counter(e['alignment_method'] for e in tables['events']))
print('calibrations:', [(c['calibration_id'][:8], c['result'], c['accepted_windows'], c['preexisting']) for c in tables['calibrations']])
print('clock_sync rows:', len(tables['clock_sync']))
print('metadata keys:', sorted(meta))
print('electrodes:', meta.get('electrodes'), 'reference', meta.get('reference'))
print('OK')
