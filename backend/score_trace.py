"""Turn a recording into the exact 4 Hz game input the browser would receive, without a server.

Replays a BrainFlow-RAW CSV through Service.ingest (same channel gates, relative-alpha
feature, explicit 60-second baseline and score smoothing as /ws/input), starting the
baseline a few seconds in as a facilitator would. Frames after calibration are written
as JSON for game tests and the dev preview (?cairn-preview):

    python -m backend.score_trace data/recordings/BrainFlow-RAW_OpenBCI_GUI-v6-meditation.csv \
        --out tests/fixtures/cairn/openbci-meditation.json
"""
import argparse
import json
from pathlib import Path
from unittest.mock import patch

from backend.main import Service, RATE
from backend.signal import DEFAULT_MAX_PTP_UV
from backend.recordings import inspect_recording

TICK_SECONDS = 0.25  # the worker's publish interval


class _Board:
    def release_session(self):
        pass


def trace(path, calibrate_at=5.0, gate_uv=DEFAULT_MAX_PTP_UV):
    data, info = inspect_recording(Path(path))
    s = Service()
    s.set_gate(gate_uv)
    s.source = 'replay'
    s.session_id = 'trace'
    s.file_data, s.recording = data, info
    s.board, s.enabled = _Board(), True
    clock = [1000.0]
    frames, calibration = [], None
    position, owed = 0, 0.0
    # A virtual clock keeps freshness checks exact however fast the loop runs.
    with patch('backend.main.time.monotonic', lambda: clock[0]):
        s.started_at = clock[0]
        while position < len(data):
            owed += RATE * TICK_SECONDS
            count = min(int(owed), len(data) - position)
            owed -= count
            clock[0] += TICK_SECONDS
            s.ingest(data[position:position + count].T)
            position += count
            if calibration is None and position >= calibrate_at * RATE:
                s.begin_calibration()
                calibration = dict(started_s=round(position / RATE, 2))
            s.sequence += 1
            frame = s.frame()
            if calibration and s.cal.center is not None:
                if 'completed_s' not in calibration:
                    calibration.update(completed_s=round(position / RATE, 2), center=s.cal.center,
                                       scale=s.cal.scale, accepted=len(s.cal.values), rejected=s.rejected)
                usable = frame['quality'] == 'good' and frame['calibrated']
                frames.append((round(frame['score'], 4), int(usable)))
            if s.cal_error:
                raise ValueError(f'Calibration failed: {s.cal_error}')
    if not frames:
        raise ValueError('The recording ended before a baseline was complete.')
    return dict(recording=info['name'], rate_hz=1 / TICK_SECONDS, calibration=calibration,
                score=[f[0] for f in frames], usable=[f[1] for f in frames])


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('recording', type=Path)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--calibrate-at', type=float, default=5.0, help='seconds of signal before Begin baseline')
    p.add_argument('--gate', type=float, default=DEFAULT_MAX_PTP_UV, help='peak-to-peak acceptance gate in µV (Calibrate slider)')
    args = p.parse_args()
    result = trace(args.recording, args.calibrate_at, args.gate)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, separators=(',', ':')) + '\n')
    scores = result['score']
    print(f"{args.out}: {len(scores)} frames ({len(scores) / result['rate_hz']:.0f} s after baseline), "
          f"usable {sum(result['usable']) / len(scores):.0%}, mean score {sum(scores) / len(scores):.3f}")
