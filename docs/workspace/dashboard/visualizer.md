# Visualizer

Open **05 Visualizer** in the main navigation, or `http://127.0.0.1:5173/#visualizer`.
It is available without a connected headset or Research / Dev Mode. If the Python
backend was already running when this feature was installed, restart it to load
the new `/api/visualizer` endpoints.

## Views

- **Live stream:** a five-minute rolling feature, mapped-target and usable-score
  graph; included channels; eight EEG traces; current calibration, delivery and
  recording health; recent research events. Signal charts can be frozen while
  acquisition continues. Live history is kept in memory while the app is open
  and resets on a new acquisition. Navigating away from Play pauses games under
  the app's existing navigation rules; EEG acquisition and research capture continue.
- **Recorded runs:** searchable raw BrainFlow files from both `BCI_RECORDINGS_DIR`
  (or the usual OpenBCI folder) and the project's `data/recordings`, research
  recordings from every registered destination, and saved experiments from
  `BCI_EXPERIMENTS_DIR`. Duplicate raw paths appear once. Active research capture
  must be stopped and saved before inspection; use Live while it is recording.
- **Compare runs:** choose two to four recordings, overlay a recorded metric by
  elapsed seconds or normalized run progress, compare full-run statistics and
  channel inclusion, and export numeric results to CSV. Two-run comparisons also
  show signed differences. Raw EEG uses the same selected offline gate across runs.
- **Game history:** the existing browser-only Cairn round, Garden plant and Cairn
  flicker logs. Filter by source and Cairn mode, chart run summaries, and compare
  up to four rounds or plants. These summaries contain no raw EEG and are
  independent of full research recordings. Existing retention limits still apply.

## Recording inspection

Full-run summaries include duration, sample and window counts, accepted-window
percentage, relative alpha, usable score, channel inclusion and rejection reasons.
The selected interval is 10, 30, 60 or 120 seconds and does not change the scope of
the full-run statistics.

Signal analysis provides full-run and interval feature/score plots, eight centered
EEG traces with per-channel scales, normalized power spectral density, distributions
and channel summaries. Spectra use the original full-rate samples, never the
decimated display traces. They average up to 60 non-overlapping 2-second Hann
periodograms over accepted channels, in µV²/Hz. Nonfinite, flat, excessive-amplitude
and discontinuous windows are excluded. The separate PSD gate does not alter any
stored feature, calibration or capture setting.

Games & events provides recorded Cairn stone, sway, runtime-limit and effect
tracks; Garden growth, response, drive, pace and baseline-time tracks; event
counts and interval inspection; rounds and plants. Experiment signal views show
original bilateral theta/alpha/beta metrics and SSVEP CCA correlations where
available. Trial decisions, abstentions, display frames, thresholds and experiment
summaries are available through the table explorer and metadata.

All recorded data exposes each persisted table in pages of 50 rows, including
calibration, acquisition, delivery, timing and exact input references. Raw Cyton
files expose all 24 BrainFlow fields plus sample position. Column tooltips explain
research fields and units. Finalized research tables can be downloaded as CSV;
full research/experiment ZIP downloads retain the existing export behavior.

## Interpretation and implementation

- Raw EEG files do not contain historical game scores, calibration or game events.
  Their relative-alpha features are recomputed in non-overlapping 2-second windows
  using the existing scoring calculation, with an explicitly selected offline gate.
- Research signal features preserve their original gates. Score averages and the
  above-baseline fraction count usable, calibrated input frames; they are not
  time-weighted exposure measures. Garden browser history uses its original
  time-weighted game statistics. Missing measurements remain blank.
- Sources and conditions remain visible. Simulation is generated test input;
  replay cannot establish a participant's response to current stimuli. Separate
  baselines, electrode maps, game modes and gate choices affect comparability.
- Replay research EEG uses approximate batch-receipt alignment. Experiment event
  overlays use their recorded sample estimates. Software timestamps do not prove
  optical onset, physiological cause, attention, stress or a health state.
- Full-run numerical statistics precede display reduction. Reduced tracks retain
  extrema and rejection gaps; waveform previews contain at most 1,600 rows per
  selected interval. The table explorer reads bounded pages. Reading analytics
  never starts capture, reconnects a source, stimulates, or modifies recordings.
- Backend implementation: `backend/visualizer.py`; UI: `apps/web/src/visualizer`.
  The API lists runs, returns summary plus bounded EEG analysis, and pages table
  rows. Raw paths stay inside approved recording roots; research/experiment access
  reuses the existing destination and recording-ID checks.

## Verification

`python -m unittest backend.test_visualizer -v` covers full-run statistics versus
selected intervals, PSD normalization, discontinuity rejection, CSV/SQLite/Both
equivalence, read-only access, active-recording protection, score gaps, game tracks,
events, experiment metrics, pagination, path confinement and display reduction.

Desktop and 390 px mobile browser checks cover live input, saved inspection,
comparison, filters, table pagination, exports and game history. The production
build and existing frontend tests are also checked. The existing full Python suite
has Windows-specific symlink-privilege and open-file cleanup failures in research
tests; those tests and recording behavior are unchanged by this feature.
