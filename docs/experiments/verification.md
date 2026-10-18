# Experiments: implementation and verification notes

Date: October 14, 2026. Implemented by Claude from [spec.md](spec.md) and [implementation-plan.md](implementation-plan.md).

Bottom line: both experiments run end to end against the real backend with **Simulated EEG**. They record every sample, event and frame, interrupt correctly and export inspectable data. The SSVEP decoder is a real CCA on full-rate samples. **Nothing has been verified with the Cyton headset, a photodiode, a recorded experiment replay or a public dataset.**

## What was built

### Backend (Python; no new dependencies)

| File | Purpose |
| --- | --- |
| `backend/simulated.py` | `SimulatedBoard`: Cyton-shaped 24-row, 250 Hz samples generated in real time: 1/f-like noise, a varying 10 Hz rhythm, optional SSVEP-like sinusoids at an operator-chosen "gaze" frequency on CH6–8, and optional eye-movement steps on CH1/2. New connect source `simulated_eeg`, labelled "Simulated EEG — no headset". |
| `backend/ssvep.py` | Pure-NumPy CCA (SVD bases, rank-deficiency safe), causal 6–40 Hz band-pass (RBJ biquads, 0.5 s warm-up trimmed), window validation (non-finite, flat, ≥500 µV p-p, packet discontinuity, fewer than 2 valid posterior channels), `TrialTracker` (0.75 s stability), `select_thresholds` (setup trials only), `summarize`. The decoder signatures have no target/label parameter, and a test enforces this. |
| `backend/bands.py` | Bilateral descriptive metrics per 2 s window: mean-removed RMS and θ/α/β power (µV², Hann periodogram). |
| `backend/experiment_recording.py` | One writer thread per experiment with a bounded queue; incremental `eeg.csv`, `events.jsonl`, `frames.jsonl`, `predictions.jsonl`, `metrics.jsonl`, final `metadata.json` and `summary.json`. Path confinement (UUID folder names only). Nothing is reported saved until it is written and closed. |
| `backend/experiments.py` | `ExperimentManager`: one active experiment, owner token, 500 ms heartbeat / 2 s expiry, strictly increasing event IDs, event types per kind, clock-sync history, analysis thread (bounded queue), software-only event→sample alignment, watchdog (heartbeat, stale EEG, writer/analysis errors, EOF), idempotent stop, export. |
| `backend/main.py` | `ingest` (the single board reader) hands each validated full-rate batch plus discontinuity indices to the manager without blocking. Connect, disconnect and recalibration interrupt an experiment. New endpoints under `/api/experiments/*` and `/api/simulation`. Status gains optional `experiment` and `simulation` fields. Frame protocol v1 and alpha semantics are unchanged. |

### Frontend (React/TypeScript; no new dependencies)

| File | Purpose |
| --- | --- |
| `experiments/timing.ts` | Preflight analysis (named gates), whole-frames-per-cycle schedules, sampled-sinusoid luminance, trial interval check, min-RTT clock offset. |
| `experiments/protocol.ts` | Seeded setup (5×3 + 10 neutral) and evaluation (10×3 + 10 neutral) blocks in runs of 10 with breaks; bilateral phase/side timeline. |
| `experiments/session.ts` | Owner session hook: clock sync, start, heartbeat, serialized event batches, frame batches, threshold freeze, idempotent stop, and stop on unmount. |
| `experiments/Shared.tsx` | Electrode map (operator-entered; per-browser memory), source banner, prerequisites, notice, raw trace, recording/export panel, Escape handling. |
| `experiments/BilateralExperiment.tsx` | Setup, instruction condition, interval/phase settings, soft alternating highlight, timeline with uncertainty note, latest-window and phase tables, eye-movement artifact warning. |
| `experiments/SsvepExperiment.tsx` | Display check, one canvas rAF loop for all three cards, cue/stim/rest trials driven by frame counts, frame logs, interruption on a late frame, threshold setup → freeze → evaluation, single facilitator trials, simulated-gaze control, correlation bars, candidate vs accepted selection, spectrum, timing health, summary. |
| `games/catalog.ts`, `GamePicker.tsx`, `App.tsx` | Four chooser cards with per-experience requirements; "Games & experiments"; experiments open setup only and bypass the alpha baseline; Connect → Choose shortcut; Simulated EEG source; garden sound and breathing guide muted while any experiment runs. |

### Decisions beyond the spec (please review)

- **120 Hz profile.** Many MacBook Pros run at 120 Hz. The 10/12/15 Hz targets are 12/10/8 whole frames at 120 Hz, so the preflight accepts a steady 60 **or** 120 Hz (median within 1%) and uses the matching schedule. Anything else, or variable refresh, is blocked with instructions.
- **Trial vs session interruption.** A late frame, hidden tab or stale EEG interrupts the *trial*. The block pauses, and the operator must explicitly start the *next* trial; nothing resumes midway. Source change, recalibration, another viewer reconnecting, heartbeat loss, recording failure, Escape, Stop or leaving the page end the *session*. Partial recordings are always finalized.
- **Threshold rule.** This is run on setup trials only. Among candidate (correlation, margin) pairs, keep those with **zero neutral false activations** and at most 1 wrong selection. Maximize correct selections, then prefer the more conservative pair. The result is **inconclusive** (decoder stays diagnostic-only) with fewer than 9 valid target or 5 valid neutral setup trials, or if fewer than half the target trials would be accepted. Before thresholds exist, accepted selection is always null.
- **Alignment.** Browser event times (`performance.timeOrigin + now`) → server wall clock via the lowest-RTT of 10 ping/pongs (re-synced every 30 s) → EEG sample by interpolating source timestamps. Uncertainty = RTT/2 + timestamp jitter + 1 sample. For replay (old timestamps), batch arrival times are used instead, with ±300 ms uncertainty. Every SSVEP window starts at least `onset + uncertainty + 0.5 s` (the 0.5 s is the filter warm-up), so pre-stimulus EEG cannot enter.
- **Bilateral metrics** go to `metrics.jsonl`; `predictions.jsonl` is SSVEP-only.

## Checks actually run (cloud Linux workspace, copy of the repo)

| Command | Result |
| --- | --- |
| `npm test` | 26 pass (18 existing + 8 new), 0 fail |
| `npm run build` | Success; existing Phaser chunk-size warning only |
| `.venv/bin/python -m unittest discover -s backend -p 'test_*.py'` (Python 3.13) | 54 tests OK (26 existing + 28 new) |
| `git diff --check` | Clean |

New automated coverage includes:

- **Decoder:** CCA detects injected 10/12/15 Hz across phases and noise seeds (24/24); invalid inputs never produce a candidate; one bad channel is excluded and reported; no target parameter; the filter is causal; the stability rule holds.
- **Thresholds and scoring:** thresholds come from setup only; evaluation outcomes are counted separately; inconclusive setups stay diagnostic-only.
- **Recording and events:** saved samples and events match ingestion exactly (contiguous indices, varied chunk sizes); duplicate, out-of-order and unknown events are rejected; events before the first sample are aligned once data arrives; events are kept even with no EEG.
- **Lifecycle:** heartbeat loss interrupts and cannot be resumed; stale EEG raises a flag; source change, recalibration and EOF interrupt; a stalled-disk queue overflow and a write error both fail visibly; path traversal is rejected; export is blocked while running.
- **Integration:** an end-to-end SSVEP pipeline (25 setup → freeze → 12 evaluation + 1 interrupted trial, with windows never before onset); Simulated EEG through the real single producer into a recording; only `main.py` calls `get_board_data()`, exactly once.
- **Frontend timing:** preflight passes at 60 and 120 Hz and fails at 59/75/90/144 Hz, for >1% late frames, a >3× spike or a short check; whole-frame schedules; the trial interval gate; the blocks; the bilateral side-change units.

### Browser checks (headless Chromium via Playwright, real backend, Simulated EEG)

| Scenario | Observed |
| --- | --- |
| Chooser | Four cards; experiment badges; games show "Needs usable input" without a baseline while experiments open |
| Opening an experiment | No experiment created, same session ID, no flicker (static previews) |
| Bilateral run (10/10/10 s, 700 ms) | Completed and saved: 7,491 contiguous samples (≈30 s × 250 Hz), 23 events (run start, 3 phase starts/ends, 15 side changes, completion), 56 metric windows; simulated eye-movement steps visibly raise alternating-phase RMS |
| Bilateral interruptions | Hidden tab → "Tab hidden"; Escape → "Escape pressed"; leaving the page → "Left the experiment page". All saved, none resumed |
| SSVEP display check | Passed, 60 Hz profile (59.88 Hz, median 16.70 ms, 0% late) |
| SSVEP setup (25 trials, follow-the-cue simulation) | All valid; diagnostic-only (0 accepted); thresholds froze at r ≥ 0.770, margin ≥ 0.218 with 9/15 setup targets and 0 neutral activations |
| SSVEP evaluation (first run of 10) | 2 correct, 0 incorrect, 6 abstained, 2 neutral abstained, 0 false activations (with the pre-tuning 4 µV simulated response; now raised to 6 µV) |
| Forced 80 ms main-thread stall | Trial interrupted: "Frame interval 66.6 ms exceeded 1.5× the 16.70 ms median"; counted as interrupted; next trial needed an explicit click |
| SSVEP session files | 63,358 contiguous samples; 197 events, IDs strictly increasing, all aligned (±4.9–5.3 ms for the simulated source); 8,472 frame rows (median 16.7 ms); 210 window + 35 final predictions; no window record contains the requested target; zip export 200; traversal 404/400 |
| Two viewers | Viewer B sees "A bilateral session is recording", Start disabled; API start → 409; B switching source ended A's session ("Input source changed or reconnected"), saved |
| Garden/Beam regression | The earlier garden flows still pass: pause/resume freeze, game switching, hidden tab, new plant, other-viewer reset, disconnect, settle-in, reduced motion, preferences |
| 390 px width | No horizontal overflow on chooser, bilateral and SSVEP pages |
| Console | No application errors |
| StrictMode | One heartbeat stream (~2 POST/s) per session, no duplicate loops |

## Not verified

### Local integration checks — October 18, 2026

Before publishing the experiment implementation from the Mac checkout, `npm test`
passed all 26 tests, the backend unittest suite passed all 54 tests, and
`npm run build` passed (the existing large Phaser bundle warning remains).
`git diff --check` was clean. This pass did not repeat browser or headset testing;
the hardware and display limitations below still apply.

- **Cyton headset.** No hardware was available. Live alignment uncertainty, real packet loss, electrode contact and any real SSVEP response are untested.
- **Optical timing.** No photodiode. All stimulus times are browser frame callbacks, labelled unverified throughout.
- **Your actual display.** Only headless Chromium at 60 Hz was measured. 120 Hz ProMotion, Safari and external projectors are untested. Variable refresh may fail the preflight; that is intended.
- **Replay mode with experiments.** No recordings were available in the test workspace. The arrival-time alignment path is untested in the browser.
- **Public dataset decoding** (e.g. Nakanishi, Kalunga) was not attempted. No real-EEG accuracy exists yet.
- **Recalibration interrupt from the browser.** Covered by a backend test only.
- **Very long sessions.** Memory and disk were exercised to about 4 minutes and 7 MB.
- **Simulated-EEG results are pipeline evidence only.** The response is generated from the chosen frequency.

## Operating instructions for next class

Start the services from the repository root (on the Mac, use the existing `.venv`):

    .venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
    npm run dev -- --strictPort

Open http://127.0.0.1:5173/. Recordings go to `data/experiments/<uuid>/` (ignored by Git). Set `BCI_EXPERIMENTS_DIR` to change this.

1. **Dry run without the headset.** Connect → **Simulated EEG** → Choose → each experiment. In SSVEP, map CH6–8 as O1/Oz/O2, run the display check, start, run one single trial, stop, and export. Confirm the zip opens.
2. **Headset.** Close the OpenBCI GUI session. Connect → Live headset → Connect & inspect. Check contact on Calibrate (the baseline is *not* needed for experiments). Record a participant pseudonym (e.g. P03, never names), the electrode map and the reference.
3. **Bilateral.** Choose the instruction condition, keep the default 20/30/20 s and 1000 ms, start, and let it complete. Repeat with the other condition and note the order. Export, check that `summary.json` sample count ≈ duration × 250, and read the eye-movement note before interpreting anything.
4. **SSVEP.**
   - Set the display to 60 Hz (System Settings → Displays) or confirm 120 Hz passes. Keep the browser full-screen, on mains power, with other apps closed. Make sure no spectators can see the flicker.
   - Run the display check, read the notice with the participant, and start.
   - Run **Threshold setup**, taking breaks when prompted, then **Freeze thresholds**. If it says inconclusive, check contact, artifacts and timing; do not keep lowering anything.
   - Run **Evaluation** without changing settings. Report correct, incorrect, abstained, invalid, interrupted and neutral false activations per participant, and keep them separate.
5. **Failure drills.** Press Stop, press Escape, unplug the dongle, then start a new run and confirm the partial recordings exist.
6. **Return to the games.** Choose → Garden and Beam. Calibrate first; confirm normal play and that garden sound is silent while an experiment is recording.
