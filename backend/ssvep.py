"""SSVEP frequency recognition with canonical correlation analysis (CCA).

Pure NumPy. The decoder sees only raw full-rate samples, the actual sample
rate, the operator-selected channels and the configured candidate frequencies.
There is deliberately no parameter for the instructed/requested target: labels
are evaluation metadata handled by `select_thresholds` and `summarize`, never
by the decoder. Correlations are similarities in [0, 1], not probabilities.

Reference: Lin et al. 2006, "Frequency recognition based on canonical
correlation analysis for SSVEP-based BCIs" (PubMed 17152442).
"""
from __future__ import annotations

import math
import numpy as np

# ---- Named, logged engineering constants (provisional; not validated) ----
WINDOW_SECONDS = 2.0          # analysis window length
ONSET_EXCLUSION_SECONDS = 0.5 # ignore the first 0.5 s after stimulation onset
PAD_SECONDS = 0.5             # causal filter warm-up, trimmed (lies inside the exclusion)
UPDATE_SECONDS = 0.25         # diagnostics about four times per second
STABILITY_SECONDS = 0.75      # candidate must persist this long to be accepted
HARMONICS = 2                 # fundamental + second harmonic
PASSBAND_HZ = (6.0, 40.0)     # two cascaded causal 2nd-order Butterworth HP + LP sections
MIN_CHANNELS = 2              # at least two valid posterior channels
FLAT_STD_UV = 0.5             # provisional gate shared with the alpha feature
MAX_PTP_UV = 500.0            # provisional gross-amplitude gate
POSTERIOR_PREFIXES = ('O', 'PO')
# Threshold setup (applied to setup trials only, then frozen)
MIN_SETUP_TARGET_TRIALS = 9
MIN_SETUP_NEUTRAL_TRIALS = 5
MIN_SETUP_CORRECT_FRACTION = 0.5
MAX_SETUP_WRONG = 1

CONSTANTS = dict(
    window_seconds=WINDOW_SECONDS, onset_exclusion_seconds=ONSET_EXCLUSION_SECONDS,
    pad_seconds=PAD_SECONDS, update_seconds=UPDATE_SECONDS, stability_seconds=STABILITY_SECONDS,
    harmonics=HARMONICS, passband_hz=list(PASSBAND_HZ), min_channels=MIN_CHANNELS,
    flat_std_uv=FLAT_STD_UV, max_ptp_uv=MAX_PTP_UV,
    min_setup_target_trials=MIN_SETUP_TARGET_TRIALS, min_setup_neutral_trials=MIN_SETUP_NEUTRAL_TRIALS,
    min_setup_correct_fraction=MIN_SETUP_CORRECT_FRACTION, max_setup_wrong=MAX_SETUP_WRONG,
    filter='causal RBJ biquads: 2x high-pass 6 Hz + 2x low-pass 40 Hz (Q=0.7071), 0.5 s warm-up trimmed; '
           'mean removed per channel; no notch (mains is outside the passband)',
)


def is_posterior(name: str) -> bool:
    n = (name or '').strip().upper()
    return any(n.startswith(p) for p in POSTERIOR_PREFIXES)


# ---------------------------------------------------------------- filtering
def _biquad(kind: str, f0: float, rate: float, q: float = 1 / math.sqrt(2)):
    w0 = 2 * math.pi * f0 / rate
    alpha = math.sin(w0) / (2 * q)
    c = math.cos(w0)
    if kind == 'low':
        b = [(1 - c) / 2, 1 - c, (1 - c) / 2]
    else:
        b = [(1 + c) / 2, -(1 + c), (1 + c) / 2]
    a = [1 + alpha, -2 * c, 1 - alpha]
    return np.array(b) / a[0], np.array(a) / a[0]


def _lfilter(b, a, x):
    """Direct-form II transposed, vectorized across channels. x: (channels, samples)."""
    y = np.empty_like(x)
    z1 = np.zeros(x.shape[0])
    z2 = np.zeros(x.shape[0])
    for n in range(x.shape[1]):
        xn = x[:, n]
        yn = b[0] * xn + z1
        z1 = b[1] * xn - a[1] * yn + z2
        z2 = b[2] * xn - a[2] * yn
        y[:, n] = yn
    return y


def bandpass(x: np.ndarray, rate: float, band=PASSBAND_HZ) -> np.ndarray:
    """Causal band-pass (uses only past samples). Caller trims the warm-up."""
    y = np.asarray(x, dtype=float) - np.mean(x, axis=1, keepdims=True)
    for kind, f in (('high', band[0]), ('high', band[0]), ('low', band[1]), ('low', band[1])):
        b, a = _biquad(kind, f, rate)
        y = _lfilter(b, a, y)
    return y


# ---------------------------------------------------------------- CCA
def _orthonormal_basis(m: np.ndarray, tol: float = 1e-10) -> np.ndarray:
    """Orthonormal basis for the column space of centered m; drops rank-deficient directions."""
    u, s, _ = np.linalg.svd(m, full_matrices=False)
    if not len(s) or s[0] <= 0:
        return u[:, :0]
    keep = s > tol * s[0] * max(m.shape)
    return u[:, keep]


def max_canonical_correlation(x: np.ndarray, y: np.ndarray) -> float:
    """Largest canonical correlation between samples-by-features matrices x and y."""
    x = x - x.mean(axis=0)
    y = y - y.mean(axis=0)
    qx = _orthonormal_basis(x)
    qy = _orthonormal_basis(y)
    if qx.shape[1] == 0 or qy.shape[1] == 0:
        return 0.0
    s = np.linalg.svd(qx.T @ qy, compute_uv=False)
    return float(np.clip(s[0], 0.0, 1.0)) if len(s) else 0.0


def references(freq: float, rate: float, n: int, harmonics: int = HARMONICS, start: int = 0) -> np.ndarray:
    t = (start + np.arange(n)) / rate
    cols = []
    for h in range(1, harmonics + 1):
        cols += [np.sin(2 * np.pi * h * freq * t), np.cos(2 * np.pi * h * freq * t)]
    return np.stack(cols, axis=1)


def cca_scores(x: np.ndarray, rate: float, freqs, harmonics: int = HARMONICS) -> list[float]:
    """x: (channels, samples), already preprocessed. One max canonical correlation per frequency."""
    data = np.asarray(x, dtype=float).T
    return [max_canonical_correlation(data, references(f, rate, data.shape[0], harmonics)) for f in freqs]


# ---------------------------------------------------------------- window decoding
def decode_window(segment: np.ndarray, rate: float, channel_indices, channel_names, freqs,
                  pad_samples: int, discontinuous: bool = False) -> dict:
    """Decode one window.

    segment: (all_channels, pad + window) raw µV, oldest first. The first
    `pad_samples` are filter warm-up only. Returns per-frequency correlations,
    best candidate, runner-up margin, channels used/excluded and validity.
    """
    names = [channel_names[i] if i < len(channel_names) else f'CH{i+1}' for i in channel_indices]
    out = dict(valid=False, reason=None, correlations=None, best=None, runner_up=None, margin=None,
               channels=[], excluded=[])
    if discontinuous:
        out['reason'] = 'Packet gap or duplicate inside the analysis window'
        return out
    seg = np.asarray(segment, dtype=float)
    if seg.ndim != 2 or seg.shape[1] <= pad_samples:
        out['reason'] = 'Not enough samples'
        return out
    window = seg[:, pad_samples:]
    used = []
    for idx, name in zip(channel_indices, names):
        row = seg[idx]
        w = window[idx]
        if not np.isfinite(row).all():
            out['excluded'].append(dict(channel=name, reason='Non-finite samples'))
        elif np.std(w - w.mean()) <= FLAT_STD_UV:
            out['excluded'].append(dict(channel=name, reason=f'Flat signal (≤{FLAT_STD_UV} µV SD)'))
        elif np.ptp(w) >= MAX_PTP_UV:
            out['excluded'].append(dict(channel=name, reason=f'Amplitude ≥{MAX_PTP_UV:.0f} µV peak-to-peak'))
        else:
            used.append(idx)
            out['channels'].append(name)
    if len(used) < MIN_CHANNELS:
        out['reason'] = f'Fewer than {MIN_CHANNELS} valid posterior channels'
        return out
    filtered = bandpass(seg[used], rate)[:, pad_samples:]
    scores = cca_scores(filtered, rate, freqs)
    order = np.argsort(scores)[::-1]
    out.update(valid=True, correlations=[round(s, 6) for s in scores], best=int(order[0]),
               runner_up=int(order[1]) if len(order) > 1 else None,
               margin=float(scores[order[0]] - scores[order[1]]) if len(order) > 1 else float(scores[order[0]]))
    return out


# ---------------------------------------------------------------- spectrum (display only)
def spectrum(window: np.ndarray, rate: float, fmax: float = 40.0):
    """Mean Hann-windowed amplitude spectrum (µV) across channels, for display only."""
    x = np.asarray(window, dtype=float)
    x = x - x.mean(axis=1, keepdims=True)
    w = np.hanning(x.shape[1])
    amp = np.abs(np.fft.rfft(x * w, axis=1)) * 2 / w.sum()
    f = np.fft.rfftfreq(x.shape[1], 1 / rate)
    keep = (f >= 2) & (f <= fmax)
    return [round(float(v), 4) for v in f[keep]], [round(float(v), 4) for v in amp[:, keep].mean(axis=0)]


# ---------------------------------------------------------------- per-trial tracking
class TrialTracker:
    """Accumulates window results for one stimulation interval.

    A candidate is *stable* when the same best frequency has been the
    candidate in every valid window whose end times span at least
    STABILITY_SECONDS. Overlapping windows are not independent evidence.
    """

    def __init__(self, rate: float, stability_seconds: float = STABILITY_SECONDS):
        self.rate = rate
        self.stability = stability_seconds * rate
        self.results: list[dict] = []
        self.run_start: int | None = None
        self.run_best: int | None = None
        self.last_valid: dict | None = None

    def add(self, result: dict, end_index: int):
        self.results.append(dict(result, end=end_index))
        if not result['valid']:
            self.run_start = None
            self.run_best = None
            return
        if result['best'] != self.run_best:
            self.run_best = result['best']
            self.run_start = end_index
        self.last_valid = dict(result, end=end_index)

    @property
    def stable(self) -> bool:
        return (self.last_valid is not None and self.run_start is not None
                and self.last_valid['end'] - self.run_start >= self.stability)

    def final(self, thresholds: dict | None) -> dict:
        """Decision from the last valid window. Accepted selection only with ready thresholds."""
        v = self.last_valid
        if v is None:
            reasons = [r['reason'] for r in self.results if r.get('reason')]
            return dict(valid=False, decision=None, reason=reasons[-1] if reasons else 'No complete valid window',
                        windows=len(self.results), valid_windows=0)
        decision = accept(v, self.stable, thresholds)
        return dict(valid=True, decision=decision, best=v['best'], correlation=v['correlations'][v['best']],
                    margin=v['margin'], stable=self.stable, correlations=v['correlations'],
                    windows=len(self.results), valid_windows=sum(1 for r in self.results if r['valid']))


def accept(result: dict, stable: bool, thresholds: dict | None):
    if not thresholds or not thresholds.get('ready') or not result.get('valid') or not stable:
        return None
    best = result['best']
    if result['correlations'][best] >= thresholds['correlation'] and result['margin'] >= thresholds['margin']:
        return best
    return None


# ---------------------------------------------------------------- threshold setup and evaluation
def select_thresholds(setup: list[dict]) -> dict:
    """Choose correlation/margin thresholds from labelled *setup* trials only.

    Each item: label (int target index or 'neutral'), valid, best, correlation, margin, stable.
    Rule: among candidate pairs taken from observed values, keep those with zero
    neutral false activations and at most MAX_SETUP_WRONG wrong selections;
    maximise correct selections, then prefer the more conservative pair.
    Inconclusive setups leave the decoder diagnostic-only.
    """
    valid = [t for t in setup if t.get('valid')]
    targets = [t for t in valid if t['label'] != 'neutral']
    neutral = [t for t in valid if t['label'] == 'neutral']
    report = dict(setup_trials=len(setup), valid_target=len(targets), valid_neutral=len(neutral),
                  invalid=len(setup) - len(valid))
    if len(targets) < MIN_SETUP_TARGET_TRIALS or len(neutral) < MIN_SETUP_NEUTRAL_TRIALS:
        return dict(ready=False, correlation=None, margin=None,
                    reason='Not enough valid setup trials', **report)
    corr_values = sorted({0.0} | {round(t['correlation'] + 1e-6, 6) for t in valid})
    margin_values = sorted({0.0} | {round(t['margin'] + 1e-6, 6) for t in valid})
    best = None
    for c in corr_values:
        for m in margin_values:
            th = dict(ready=True, correlation=c, margin=m)
            fa = sum(1 for t in neutral if _decide(t, th) is not None)
            if fa:
                continue
            correct = sum(1 for t in targets if _decide(t, th) == t['label'])
            wrong = sum(1 for t in targets if _decide(t, th) not in (None, t['label']))
            if wrong > MAX_SETUP_WRONG:
                continue
            key = (correct - 2 * wrong, c, m)
            if best is None or key > best[0]:
                best = (key, c, m, correct, wrong)
    if best is None:
        return dict(ready=False, correlation=None, margin=None,
                    reason='No thresholds avoid neutral false activations', **report)
    _, c, m, correct, wrong = best
    report.update(setup_correct=correct, setup_wrong=wrong, setup_neutral_false_activations=0)
    if correct < MIN_SETUP_CORRECT_FRACTION * len(targets):
        return dict(ready=False, correlation=c, margin=m,
                    reason=f'Inconclusive: only {correct}/{len(targets)} setup targets would be accepted', **report)
    return dict(ready=True, correlation=c, margin=m, reason=None, **report)


def _decide(trial: dict, thresholds: dict):
    return accept(dict(valid=trial['valid'], best=trial['best'], margin=trial['margin'],
                       correlations={trial['best']: trial['correlation']}), trial.get('stable', False), thresholds)


def summarize(trials: list[dict]) -> dict:
    """Evaluation accounting. Each item: label (int or 'neutral'), valid, decision (int or None), interrupted."""
    s = dict(trials=len(trials), completed=0, interrupted=0, invalid=0, correct=0, incorrect=0,
             abstained=0, neutral_trials=0, neutral_false_activations=0, neutral_abstained=0,
             unlabelled=0, unlabelled_selections=0)
    for t in trials:
        if t.get('interrupted'):
            s['interrupted'] += 1
            continue
        s['completed'] += 1
        if not t.get('valid'):
            s['invalid'] += 1
            continue
        if t.get('label') is None:  # free/unlabelled facilitator trial: no correctness claim
            s['unlabelled'] += 1
            s['unlabelled_selections'] += t.get('decision') is not None
            continue
        if t['label'] == 'neutral':
            s['neutral_trials'] += 1
            if t['decision'] is None:
                s['neutral_abstained'] += 1
            else:
                s['neutral_false_activations'] += 1
        elif t['decision'] is None:
            s['abstained'] += 1
        elif t['decision'] == t['label']:
            s['correct'] += 1
        else:
            s['incorrect'] += 1
    return s
