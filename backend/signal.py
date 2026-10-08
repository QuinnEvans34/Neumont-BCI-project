"""Experimental relative-alpha feature; no stress or intent classifier."""
import numpy as np


def analyze(samples, rate):
    x = np.asarray(samples, dtype=float)
    channels = []
    if x.shape[1] < rate * 2:
        return None, [dict(channel=i+1, included=False, reason='Waiting for 2 seconds', std_uv=None) for i in range(x.shape[0])]
    x = x[:, -rate * 2:]
    included = []
    for i, row in enumerate(x):
        finite = np.isfinite(row).all()
        std = float(np.std(row)) if finite else None
        span = float(np.ptp(row)) if finite else None
        reason = 'Included' if finite else 'Non-finite samples'
        if finite and std <= .5: reason = 'Flat signal (≤0.5 µV SD)'
        elif finite and span >= 500: reason = 'Amplitude exceeded 500 µV peak-to-peak'
        good = reason == 'Included'
        channels.append(dict(channel=i+1, included=good, reason=reason, std_uv=std))
        if good: included.append(i)
    if not included:
        return None, channels
    x = x[included] - np.mean(x[included], axis=1, keepdims=True)
    power = np.abs(np.fft.rfft(x * np.hanning(x.shape[1]), axis=1)) ** 2
    freq = np.fft.rfftfreq(x.shape[1], 1 / rate)
    total = power[:, (freq >= 4) & (freq <= 30)].sum(axis=1)
    alpha = power[:, (freq >= 8) & (freq < 12)].sum(axis=1)
    return float(np.median(alpha / np.maximum(total, 1e-12))), channels


def feature(samples, rate):
    return analyze(samples, rate)[0]


class Calibration:
    def __init__(self):
        self.values = []
        self.center = None
        self.scale = None
        self.score = .5

    def collect(self, value):
        self.values.append(value)
        if len(self.values) >= 30:
            self.center = float(np.median(self.values))
            self.scale = float(1.4826 * np.median(np.abs(np.array(self.values) - self.center)))
            if self.scale < 1e-4:
                self.center = None
                raise ValueError('Baseline has too little variation. Check channels and recalibrate.')

    def map(self, value):
        target = float(np.clip(.5 + (value - self.center) / (6 * self.scale), 0, 1))
        self.score = .8 * self.score + .2 * target
        return self.score
