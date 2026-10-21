"""Descriptive per-channel window metrics for the bilateral experiment.

No interpretation: these are summaries of the recorded signal (mean-removed
RMS and spectral band powers), not relaxation, activation or treatment scores.
"""
import numpy as np

BANDS = {'theta': (4.0, 8.0), 'alpha': (8.0, 12.0), 'beta': (12.0, 30.0)}  # [low, high); beta includes 30
WINDOW_SECONDS = 2.0
UPDATE_SECONDS = 0.5
FLAT_STD_UV = 0.5
MAX_PTP_UV = 500.0
METHOD = ('2 s windows every 0.5 s; per channel: mean removed, no filter; RMS in µV; '
          'band power in µV² from a Hann-windowed one-sided periodogram (PSD × Δf summed); '
          'theta 4–<8, alpha 8–<12, beta 12–30 Hz. Flat (≤0.5 µV SD), ≥500 µV p-p, '
          'non-finite or packet-discontinuous windows are rejected.')


def window_metrics(window, rate):
    """window: (channels, samples) µV. Returns one dict per channel."""
    x = np.asarray(window, dtype=float)
    out = []
    n = x.shape[1]
    w = np.hanning(n)
    f = np.fft.rfftfreq(n, 1 / rate)
    df = f[1] - f[0]
    for row in x:
        if not np.isfinite(row).all():
            out.append(dict(valid=False, reason='Non-finite samples'))
            continue
        r = row - row.mean()
        std = float(np.std(r))
        if std <= FLAT_STD_UV:
            out.append(dict(valid=False, reason='Flat signal'))
            continue
        if np.ptp(row) >= MAX_PTP_UV:
            out.append(dict(valid=False, reason='Amplitude ≥500 µV p-p'))
            continue
        psd = np.abs(np.fft.rfft(r * w)) ** 2 / (rate * np.sum(w ** 2))
        psd[1:-1] *= 2
        m = dict(valid=True, reason=None, rms=std)
        for name, (lo, hi) in BANDS.items():
            band = (f >= lo) & ((f <= hi) if name == 'beta' else (f < hi))
            m[name] = float(psd[band].sum() * df)
        out.append(m)
    return out
