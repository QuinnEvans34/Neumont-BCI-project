"""Convert an OpenBCI GUI text recording ("%OpenBCI Raw EXG Data") to the BrainFlow-RAW CSV that replay reads.

The GUI's own sample files (Documents/OpenBCI_GUI/Sample_Data) are real Cyton sessions,
so converted copies give a no-headset test input for the full replay pipeline:

    python -m backend.openbci_convert ~/Documents/OpenBCI_GUI/Sample_Data/OpenBCI_GUI-v6-meditation.txt

writes data/recordings/BrainFlow-RAW_OpenBCI_GUI-v6-meditation.csv. Start the backend with
BCI_RECORDINGS_DIR=data/recordings to list it on Connect.
"""
import argparse
from pathlib import Path

import numpy as np
from brainflow.board_shim import BoardShim, BoardIds
from brainflow.data_filter import DataFilter

CYTON = BoardIds.CYTON_BOARD.value
ROWS = BoardShim.get_num_rows(CYTON)
EEG = BoardShim.get_eeg_channels(CYTON)
TIMESTAMP = BoardShim.get_timestamp_channel(CYTON)
MARKER = BoardShim.get_marker_channel(CYTON)
DEFAULT_OUT = Path(__file__).resolve().parents[1] / 'data' / 'recordings'


def read_gui_text(path):
    """Return Cyton rows x samples. GUI columns 0-21 already follow BrainFlow's Cyton row order."""
    header, rows = {}, []
    with open(path, encoding='utf-8') as f:
        for line in f:
            if line.startswith('%'):
                key, _, value = line[1:].partition('=')
                header[key.strip()] = value.strip()
                continue
            if line.startswith('Sample Index'):
                continue
            parts = [p.strip() for p in line.split(',')]
            if len(parts) < TIMESTAMP + 1:
                continue
            row = [float(p) for p in parts[:TIMESTAMP + 1]]
            try:
                row.append(float(parts[MARKER]))
            except (IndexError, ValueError):
                row.append(0.0)
            rows.append(row)
    if 'Cyton' not in header.get('Board', 'Cyton'):
        raise ValueError(f'Expected a Cyton recording, found board {header["Board"]!r}.')
    if header.get('Sample Rate') and not header['Sample Rate'].startswith(str(BoardShim.get_sampling_rate(CYTON))):
        raise ValueError(f'Expected 250 Hz, found {header["Sample Rate"]}.')
    data = np.array(rows, dtype=np.float64).T
    if data.shape[0] != ROWS or not data.shape[1]:
        raise ValueError('Recording did not contain Cyton samples.')
    # GUI v6 writes Unix milliseconds; BrainFlow uses seconds.
    if np.nanmedian(data[TIMESTAMP]) > 1e11:
        data[TIMESTAMP] /= 1000
    # The GUI pads the first packet with zeros before the board reports.
    first = int(np.argmax(np.any(data[EEG] != 0, axis=0)))
    data = data[:, first:]
    if not np.isfinite(data).all():
        raise ValueError('Recording contains non-finite values.')
    return np.ascontiguousarray(data)


def convert(source, out_dir=DEFAULT_OUT):
    source = Path(source)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / f'BrainFlow-RAW_{source.stem}.csv'
    data = read_gui_text(source)
    DataFilter.write_file(data, str(target), 'w')
    return target, data.shape[1]


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('source', nargs='+', type=Path)
    p.add_argument('--out', type=Path, default=DEFAULT_OUT)
    args = p.parse_args()
    for s in args.source:
        target, n = convert(s, args.out)
        print(f'{target}: {n} samples, {n / BoardShim.get_sampling_rate(CYTON):.1f} s')
