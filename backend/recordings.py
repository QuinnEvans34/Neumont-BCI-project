"""Local recording inspection. Preview data never enters calibration."""
from functools import lru_cache
from pathlib import Path
import numpy as np
from brainflow.board_shim import BoardShim, BoardIds

CYTON = BoardIds.CYTON_BOARD.value
EEG = BoardShim.get_eeg_channels(CYTON)
TIMESTAMP = BoardShim.get_timestamp_channel(CYTON)
RATE = BoardShim.get_sampling_rate(CYTON)


def resolve_recording(root, name):
    path = (root / name).resolve()
    if not path.is_relative_to(root) or not path.name.startswith('BrainFlow-RAW') or path.suffix != '.csv' or not path.is_file():
        raise ValueError('Select a BrainFlow recording from the list.')
    return path


@lru_cache(maxsize=2)
def load_recording(path, modified_ns):
    data = np.loadtxt(path, ndmin=2)
    if data.shape[1] != BoardShim.get_num_rows(CYTON) or not len(data) or not np.isfinite(data).all():
        raise ValueError('Recording must contain finite, 24-column Cyton BrainFlow samples.')
    return data


def inspect_recording(path):
    data = load_recording(str(path), path.stat().st_mtime_ns)
    ts = data[:, TIMESTAMP]
    gaps = np.flatnonzero(np.diff(ts) > .1) + 1
    # Envelope retains the minimum and maximum in each bin; no future samples
    # from this preview are passed to the online signal processor.
    bins = np.array_split(np.arange(len(data)), min(500, len(data)))
    waves = []
    for channel in EEG:
        x = data[:, channel]
        waves.append([[float(x[b].min()), float(x[b].max())] for b in bins])
    return data, dict(name=path.name, samples=len(data), channels=len(EEG), sample_rate_hz=RATE,
                      sample_seconds=len(data)/RATE, recorded_seconds=float(ts[-1]-ts[0]),
                      backwards_timestamps=int((np.diff(ts)<0).sum()),
                      gaps=[dict(sample=int(i), seconds=float(ts[i]-ts[i-1])) for i in gaps],
                      overview=waves)
