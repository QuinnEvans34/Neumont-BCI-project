import inspect
import unittest
import numpy as np
from backend import ssvep
from backend.ssvep import (decode_window, cca_scores, max_canonical_correlation, bandpass, TrialTracker,
                           select_thresholds, summarize, is_posterior)
from backend.bands import window_metrics

RATE = 250
FREQS = [10.0, 12.0, 15.0]
NAMES = ['Fp1', 'Fp2', 'C3', 'C4', 'P7', 'O1', 'Oz', 'O2']
POST = [5, 6, 7]
PAD = int(ssvep.PAD_SECONDS * RATE)
N = PAD + int(ssvep.WINDOW_SECONDS * RATE)


def fixture(freq=None, seed=0, snr=1.0, phase=0.0, n=N, noise=5.0):
    """Deterministic multichannel test signal: noise plus optional SSVEP at freq and 2*freq.
    Pipeline testing only: it is generated from a known frequency."""
    rng = np.random.default_rng(seed)
    t = np.arange(n) / RATE
    x = rng.normal(0, noise, (8, n))
    if freq:
        for c, g in zip(POST, (0.8, 1.0, 0.9)):
            x[c] += snr * 4 * g * (np.sin(2 * np.pi * freq * t + phase + c) + 0.5 * np.sin(2 * np.pi * 2 * freq * t + phase))
    return x


class CCATests(unittest.TestCase):
    def test_detects_injected_frequency_across_phase_and_noise_seeds(self):
        hits = 0
        for k, f in enumerate(FREQS):
            for seed in range(8):
                r = decode_window(fixture(f, seed=seed, phase=seed * 0.7), RATE, POST, NAMES, FREQS, PAD)
                self.assertTrue(r['valid'])
                hits += r['best'] == k
                self.assertEqual(len(r['correlations']), 3)
                self.assertTrue(all(0 <= c <= 1 for c in r['correlations']))
        self.assertEqual(hits, 24)

    def test_noise_only_has_low_scores_and_small_margin(self):
        r = decode_window(fixture(None, seed=3), RATE, POST, NAMES, FREQS, PAD)
        target = decode_window(fixture(12.0, seed=3), RATE, POST, NAMES, FREQS, PAD)
        self.assertTrue(r['valid'])
        self.assertLess(max(r['correlations']), max(target['correlations']))
        self.assertGreater(target['margin'], r['margin'])

    def test_decoder_has_no_target_label_parameter(self):
        for fn in (decode_window, cca_scores, TrialTracker.add, ssvep.spectrum):
            params = set(inspect.signature(fn).parameters)
            self.assertFalse(params & {'target', 'label', 'requested', 'cue', 'instructed'}, fn.__name__)

    def test_invalid_inputs_never_produce_a_candidate(self):
        flat = fixture(10.0)
        flat[POST] = 3.0
        r = decode_window(flat, RATE, POST, NAMES, FREQS, PAD)
        self.assertFalse(r['valid'])
        self.assertIsNone(r['best'])
        self.assertEqual(len(r['excluded']), 3)
        bad = fixture(10.0)
        bad[5, 100] = np.nan
        bad[6, 300] = np.inf
        r = decode_window(bad, RATE, POST, NAMES, FREQS, PAD)
        self.assertFalse(r['valid'])
        self.assertIn('Non-finite', r['excluded'][0]['reason'])
        big = fixture(10.0)
        big[POST[:2], 400] += 900
        r = decode_window(big, RATE, POST, NAMES, FREQS, PAD)
        self.assertFalse(r['valid'])
        gapped = decode_window(fixture(10.0), RATE, POST, NAMES, FREQS, PAD, discontinuous=True)
        self.assertFalse(gapped['valid'])
        self.assertIn('Packet gap', gapped['reason'])
        one = decode_window(fixture(10.0), RATE, [6], NAMES, FREQS, PAD)
        self.assertFalse(one['valid'])

    def test_one_bad_channel_is_reported_and_excluded(self):
        x = fixture(15.0)
        x[5] = 0
        r = decode_window(x, RATE, POST, NAMES, FREQS, PAD)
        self.assertTrue(r['valid'])
        self.assertEqual(r['channels'], ['Oz', 'O2'])
        self.assertEqual(r['excluded'][0]['channel'], 'O1')
        self.assertEqual(r['best'], 2)

    def test_rank_deficient_and_constant_inputs_are_safe(self):
        y = np.random.default_rng(1).normal(size=(500, 4))
        self.assertEqual(max_canonical_correlation(np.zeros((500, 3)), y), 0.0)
        x = np.repeat(y[:, :1], 3, axis=1)  # three identical channels: rank 1
        self.assertAlmostEqual(max_canonical_correlation(x, y), 1.0, places=6)

    def test_filter_is_causal(self):
        x = fixture(10.0)
        y1 = bandpass(x[:, :400], RATE)
        x2 = x.copy()
        x2[:, 400:] += 1000  # change only the future
        y2 = bandpass(x2[:, :400], RATE)
        np.testing.assert_allclose(y1, y2)
        # Past output does not depend on samples that come later.
        full = bandpass(x2, RATE)
        a = bandpass(x2[:, :400] - x2[:, :400].mean(axis=1, keepdims=True), RATE)
        self.assertEqual(full.shape, x2.shape)
        self.assertEqual(a.shape, (8, 400))

    def test_posterior_names(self):
        self.assertTrue(all(is_posterior(n) for n in ['O1', 'Oz', 'o2', 'PO7', 'POz']))
        self.assertFalse(any(is_posterior(n) for n in ['P3', 'Fp1', 'Cz', '', 'T8']))


class TrialAndThresholdTests(unittest.TestCase):
    def run_trial(self, freq, seed, thresholds=None, seconds=4.0):
        tr = TrialTracker(RATE)
        onset = 0
        total = int(seconds * RATE)
        x = fixture(freq, seed=seed, n=total)
        step = int(ssvep.UPDATE_SECONDS * RATE)
        first_end = onset + int((ssvep.ONSET_EXCLUSION_SECONDS + ssvep.WINDOW_SECONDS) * RATE)
        for end in range(first_end, total + 1, step):
            seg = x[:, end - N:end]
            tr.add(decode_window(seg, RATE, POST, NAMES, FREQS, PAD), end)
        return tr.final(thresholds)

    def test_trial_is_stable_and_diagnostic_only_without_thresholds(self):
        f = self.run_trial(12.0, 1)
        self.assertTrue(f['valid'])
        self.assertTrue(f['stable'])
        self.assertEqual(f['best'], 1)
        self.assertIsNone(f['decision'])  # no thresholds → never an accepted selection

    def test_unstable_candidate_is_not_accepted(self):
        tr = TrialTracker(RATE)
        base = dict(valid=True, correlations=[0.9, 0.2, 0.1], margin=0.7, reason=None)
        tr.add(dict(base, best=0), 625)
        tr.add(dict(base, best=1, correlations=[0.2, 0.9, 0.1]), 687)
        tr.add(dict(base, best=1, correlations=[0.2, 0.9, 0.1]), 750)
        th = dict(ready=True, correlation=0.5, margin=0.1)
        self.assertFalse(tr.stable)
        self.assertIsNone(tr.final(th)['decision'])
        tr.add(dict(base, best=1, correlations=[0.2, 0.9, 0.1]), 875)
        self.assertTrue(tr.stable)
        self.assertEqual(tr.final(th)['decision'], 1)
        tr.add(dict(valid=False, reason='gap', best=None, correlations=None, margin=None), 937)
        self.assertFalse(tr.stable)

    def test_setup_thresholds_avoid_neutral_activation_then_freeze_for_evaluation(self):
        setup = []
        for seed in range(5):
            for k, f in enumerate(FREQS):
                setup.append(dict(label=k, **self.run_trial(f, 100 + seed * 3 + k)))
        for seed in range(10):
            setup.append(dict(label='neutral', **self.run_trial(None, 200 + seed)))
        th = select_thresholds(setup)
        self.assertTrue(th['ready'], th)
        self.assertEqual(th['setup_neutral_false_activations'], 0)
        self.assertGreaterEqual(th['setup_correct'], 8)
        # Evaluation on separate seeds with frozen thresholds.
        trials = []
        for seed in range(4):
            for k, f in enumerate(FREQS):
                trials.append(dict(label=k, **self.run_trial(f, 500 + seed * 3 + k, th)))
            trials.append(dict(label='neutral', **self.run_trial(None, 600 + seed, th)))
        trials.append(dict(label=0, interrupted=True, valid=False, decision=None))
        s = summarize(trials)
        self.assertEqual(s['trials'], 17)
        self.assertEqual(s['interrupted'], 1)
        self.assertEqual(s['neutral_trials'], 4)
        self.assertEqual(s['correct'] + s['incorrect'] + s['abstained'] + s['invalid'], 12)
        self.assertGreaterEqual(s['correct'], 9)

    def test_inconclusive_setup_stays_diagnostic_only(self):
        noise = [dict(label=k % 3 if k < 15 else 'neutral', **self.run_trial(None, 900 + k)) for k in range(25)]
        th = select_thresholds(noise)
        self.assertFalse(th['ready'])
        self.assertIsNotNone(th['reason'])
        few = select_thresholds(noise[:6])
        self.assertFalse(few['ready'])
        self.assertIn('Not enough', few['reason'])

    def test_summary_counts_each_outcome_separately(self):
        s = summarize([
            dict(label=0, valid=True, decision=0), dict(label=1, valid=True, decision=2),
            dict(label=2, valid=True, decision=None), dict(label='neutral', valid=True, decision=1),
            dict(label='neutral', valid=True, decision=None), dict(label=0, valid=False, decision=None),
        ])
        self.assertEqual((s['correct'], s['incorrect'], s['abstained'], s['neutral_false_activations'],
                          s['neutral_abstained'], s['invalid']), (1, 1, 1, 1, 1, 1))


class BandMetricTests(unittest.TestCase):
    def test_band_powers_and_rms_match_known_sines(self):
        t = np.arange(500) / RATE
        x = np.stack([10 * np.sin(2 * np.pi * 10 * t), 10 * np.sin(2 * np.pi * 6 * t), 10 * np.sin(2 * np.pi * 20 * t)])
        m = window_metrics(x, RATE)
        self.assertAlmostEqual(m[0]['rms'], 10 / np.sqrt(2), places=1)
        # A sine of amplitude A has power A²/2 = 50 µV², concentrated in its band.
        self.assertAlmostEqual(m[0]['alpha'], 50, delta=2)
        self.assertLess(m[0]['theta'] + m[0]['beta'], 2)
        self.assertGreater(m[1]['theta'], 45)
        self.assertGreater(m[2]['beta'], 45)

    def test_bad_channels_are_rejected(self):
        x = np.zeros((3, 500))
        x[1] = np.nan
        x[2] = np.linspace(0, 900, 500)
        m = window_metrics(x, RATE)
        self.assertEqual([r['valid'] for r in m], [False, False, False])
        self.assertEqual(m[0]['reason'], 'Flat signal')


if __name__ == '__main__':
    unittest.main()
