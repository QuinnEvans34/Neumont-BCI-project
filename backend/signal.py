"""Experimental relative alpha, not a stress or intent classifier.

Each 2 s window is processed independently with identical preprocessing in
baseline and play. Reflection padding limits filter edge transients; no state
can leak across gaps. This is a window estimate, not a causal filtered waveform.
"""
import numpy as np
from brainflow.data_filter import DataFilter, FilterTypes

FLAT_SD_UV = .5
DEFAULT_MAX_PTP_UV = 150.0
PROCESSING_VERSION = 'relative-alpha-v2-notch60-bandpass1-40'
PROCESSING = dict(version=PROCESSING_VERSION, window_s=2, notch_hz=[58, 62],
                  bandpass_hz=[1, 40], filter='BrainFlow Butterworth zero-phase',
                  order=2, reflection_padding_s=1, gate='filtered peak-to-peak',
                  hum='raw Hann PSD integrated 59–61 Hz, RMS µV',
                  alpha_hz=[8, 12], denominator_hz=[4, 30])


def filtered_window(row, rate):
    # BrainFlow filters mutate in place: never pass the acquisition array.
    centered = row - np.mean(row)
    padded = np.ascontiguousarray(np.pad(centered, rate, mode='reflect'))
    kind = FilterTypes.BUTTERWORTH_ZERO_PHASE.value
    DataFilter.perform_bandstop(padded, rate, 58., 62., 2, kind, 0.)
    DataFilter.perform_bandpass(padded, rate, 1., 40., 2, kind, 0.)
    return padded[rate:-rate]


def hum_rms(row, rate):
    w = np.hanning(len(row))
    psd = np.abs(np.fft.rfft((row-row.mean()) * w)) ** 2 / (rate * np.sum(w*w))
    psd[1:-1] *= 2
    f = np.fft.rfftfreq(len(row), 1/rate)
    return float(np.sqrt(psd[(f >= 59) & (f <= 61)].sum() * rate / len(row)))


def analyze(samples, rate, max_ptp_uv=DEFAULT_MAX_PTP_UV, scoring_channels=None):
    x = np.asarray(samples, dtype=float)
    if x.ndim != 2 or rate <= 124:
        raise ValueError('Expected channels × samples and sampling rate above 124 Hz')
    selected = set(range(1, len(x)+1) if scoring_channels is None else scoring_channels)
    if x.shape[1] < rate * 2:
        return None, [dict(channel=i+1, selected=i+1 in selected, included=False,
                           reason='Waiting for 2 seconds', std_uv=None, ptp_uv=None,
                           raw_ptp_uv=None, hum_rms_uv=None) for i in range(len(x))]
    x = x[:, -rate * 2:]
    channels, ratios = [], []
    for i, raw in enumerate(x):
        finite = bool(np.isfinite(raw).all())
        raw_span = float(np.ptp(raw)) if finite else None
        row = filtered_window(raw, rate) if finite else None
        std = float(np.std(row)) if finite else None
        span = float(np.ptp(row)) if finite else None
        reason = 'Included' if finite else 'Non-finite samples'
        # Cyton gain-24 input range is approximately ±187500 µV; retain a raw rail check.
        if finite and np.max(np.abs(raw)) >= 187000: reason = 'Raw signal near Cyton input rail'
        elif finite and std <= FLAT_SD_UV: reason = f'Flat signal (≤{FLAT_SD_UV:g} µV SD)'
        elif finite and span >= max_ptp_uv: reason = f'Amplitude exceeded {max_ptp_uv:g} µV peak-to-peak'
        if reason == 'Included' and i+1 not in selected: reason = 'Not selected for scoring'
        good = reason == 'Included'
        c = dict(channel=i+1, selected=i+1 in selected, included=good, reason=reason,
                 std_uv=std, ptp_uv=span, raw_ptp_uv=raw_span,
                 hum_rms_uv=hum_rms(raw, rate) if finite else None)
        if good:
            power = np.abs(np.fft.rfft((row-row.mean()) * np.hanning(len(row)))) ** 2
            freq = np.fft.rfftfreq(len(row), 1/rate)
            total = power[(freq >= 4) & (freq <= 30)].sum()
            alpha = power[(freq >= 8) & (freq < 12)].sum()
            c['rel_alpha'] = float(alpha / max(total, 1e-12))
            ratios.append(c['rel_alpha'])
        channels.append(c)
    return (float(np.median(ratios)) if ratios else None), channels


def feature(samples, rate, max_ptp_uv=DEFAULT_MAX_PTP_UV):
    return analyze(samples, rate, max_ptp_uv)[0]


class Calibration:
    def __init__(self):
        self.values = []
        self.center = None
        self.scale = None
        self.score = .5
        self.last_target = None

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
        self.last_target = target
        self.score = .8 * self.score + .2 * target
        return self.score
