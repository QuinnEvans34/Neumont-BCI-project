# SSVEP Circle

Open **Choose → SSVEP Circle → Open setup**. This is a single-target observation
experiment, alongside the existing three-card CCA experiment. It does not require
an alpha baseline or classify what a participant is looking at.

1. Connect **Live Cyton**, a recording, or **Simulated EEG** on Connect.
   Score-only Simulation has no raw EEG and cannot start a trial.
2. Choose the circle color, a requested frequency from **1–30 Hz** in 0.5 Hz
   steps, and a trial length from **5–600 seconds** (default 30).
3. Enter a participant pseudonym, notes, and the actual electrode map/reference.
4. Read and acknowledge the flashing-stimulus notice. Run **Check display (5 s)**.
   It requires a steady 60 or 120 Hz callback rate, using the same timing gates
   as SSVEP Cards. The circle stays steady during this check.
5. Click **Start recorded trial**. Recording starts before stimulation.
   The circle turns completely off between colored on phases. Color/frequency
   controls remain available: each change starts a new timestamped segment on
   the next display frame, with its phase reset to on.
6. Stop with **Stop**, **Escape**, or let the configured duration finish.
   Hiding the tab, resizing the stimulus/display, losing fresh EEG, leaving the
   experience, a backend failure, or a frame interval greater than 1.5 times
   the preflight median interrupts stimulation. Nothing automatically resumes.
   Hiding/resizing requires a fresh display check.
7. Wait for **Saved**, then **Export recording (.zip)**. Each new trial creates
   a separate UUID folder under `data/experiments/` (or `BCI_EXPERIMENTS_DIR`).
   Past trials can also be inspected/exported through **05 Visualizer**.

The readings at the bottom show all eight channels, mapped electrode labels,
dominant frequencies, alpha powers, rejection reasons, and **total alpha**:

- Metrics use full-rate EEG, not the decimated waveform display: two-second
  mean-removed, Hann-windowed periodograms, updated every 0.5 seconds.
- Dominant frequency is the strongest spectral bin in **1–45 Hz**, with 0.5 Hz
  resolution. It is a descriptive peak, not evidence that the circle was detected.
- Alpha is integrated **8–<12 Hz** power in µV². Total alpha is the **sum of
  valid-channel alpha powers**. Flat, non-finite, excessive-amplitude, and
  packet-discontinuous windows are excluded. With no valid channels the total
  is missing, not zero. This is different from the calibrated game's median
  relative-alpha feature.
- Readings are available after the first complete recorded window. After
  stopping they are explicitly labeled as the last recorded window.

## Recording contents

| File | Contents |
| --- | --- |
| `metadata.json` | Participant, electrode map, reference, source mode, acquisition session, sample rate/units, initial color/frequency/duration, display-check measurements and criteria, clock synchronization history, stimulus/metric definitions, final state/reason |
| `eeg.csv` | Every raw EEG sample delivered during recording, with absolute sample index, source timestamp, packet counter, and eight channel values |
| `events.jsonl` | Notice acceptance, setup notes, trial start/end, each segment start/end, color/frequency/geometry, software event-to-sample alignment, stop/interruption reasons, and periodic clock updates |
| `frames.jsonl` | Per-segment batches of `[segment_frame, t_browser_ms, on]`, where `on` is 0 or 1; the batch's `trial_id` identifies the segment, and its `segment_start` event links it to the overall trial |
| `metrics.jsonl` | Absolute sample bounds, per-channel validity, dominant Hz, RMS and theta/alpha/beta power, valid-channel count and summed alpha power |
| `summary.json` | Trial state/reason, saved sample/event/frame counts, analysis status, final channel/alpha window and method |
| `predictions.jsonl` | Empty: this experience has no classifier |

Segment end events include actual callback-based observed cycle frequency,
worst frame interval and frame count. Frames are uploaded incrementally, and
pending frames/events are drained before a normal stop/navigation closes the
recording. A delivery failure interrupts the trial rather than reporting successful
completion. Abrupt browser/process termination can lose pending browser data;
the existing owner-heartbeat watchdog retains the backend's partial recording.

The square wave is sampled at display frames. Frequencies that do not divide
the refresh rate use differing numbers of frames per on/off interval; average
frequency and duty cycle are therefore limited by display sampling. The displayed
observed rate is calculated from rising-edge callback timestamps within the
current segment. **Optical timing remains unverified without a photodiode.**
Replay cannot contain responses to newly shown stimuli; Simulated EEG is only
for checking acquisition, metrics and recording. Neither validates a participant's
SSVEP response. This implementation has automated known-signal/recording checks;
physical-headset, optical-timing and in-browser visual verification remain manual.

## Verification (November 4, 2026)

- Production TypeScript/Vite build passed.
- 74 frontend tests passed, including every 0.5 Hz slider setting at 60/120 Hz,
  observed-rate calculation, and the six-experience chooser. The standard `tsx`
  runner encounters a Windows `os.userInfo()` error in this restricted environment;
  tests passed in-process with that user-name lookup stubbed (no repository or
  operating-system settings changed).
- Five new backend tests passed: setup validation, known spectral peaks/alpha
  power, recorded settings changes/raw samples/frames/events, all-invalid alpha,
  and packet-gap rejection. The existing 28 experiment/SSVEP backend tests also passed.
- Full backend suite: 100 of 103 tests passed. The three errors are in Research
  tests: Windows symlink privilege and temporary CSV/SQLite file-lock cleanup.
- React server rendering confirmed one canvas, eight channel rows, color/frequency
  controls and recording setup. The browser/native automation host was unavailable,
  so this is not visual or interactive browser verification.
