"""Small experimental relative-alpha feature; no stress or intent classifier."""
import numpy as np


def feature(samples, rate):
    x = np.asarray(samples, dtype=float)
    if x.shape[1] < rate * 2 or not np.isfinite(x).all():
        return None
    x = x[:, -rate * 2:]
    # Conservative prototype gates in microvolts, not validated contact detection.
    spread = np.std(x, axis=1)
    valid = (spread > 0.5) & (np.ptp(x, axis=1) < 500)
    if not valid.any():
        return None
    x = x[valid] - np.mean(x[valid], axis=1, keepdims=True)
    power = np.abs(np.fft.rfft(x * np.hanning(x.shape[1]), axis=1)) ** 2
    freq = np.fft.rfftfreq(x.shape[1], 1 / rate)
    total = power[:, (freq >= 4) & (freq <= 30)].sum(axis=1)
    alpha = power[:, (freq >= 8) & (freq < 12)].sum(axis=1)
    return float(np.median(alpha / np.maximum(total, 1e-12)))


class Calibration:
    def __init__(self):
        self.values = []
        self.center = None
        self.scale = None
        self.score = 0.5

    def collect(self, value):
        self.values.append(value)
        if len(self.values) >= 30:
            self.center = float(np.median(self.values))
            self.scale = float(1.4826 * np.median(np.abs(np.array(self.values) - self.center)))
            if self.scale < 1e-4:
                self.center = None
                raise ValueError('Baseline has too little variation. Check channels and recalibrate.')

    def map(self, value):
        target = float(np.clip(0.5 + (value - self.center) / (6 * self.scale), 0, 1))
        self.score = 0.8 * self.score + 0.2 * target
        return self.score
