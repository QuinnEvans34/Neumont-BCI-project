# Bilateral Visual Stimulation and SSVEP Cards

Status: prototype implemented October 14, 2026 and checked with Simulated EEG only; see [verification](verification.md). Prepared for the next club class.

Read this document with [implementation plan](implementation-plan.md) and [Claude prompt](claude-prompt.md). Background: [P300/SSVEP research](../p300-ssvep-research.md).

## Goal and boundaries

Add two experiment cards alongside Garden and Balance Beam. Bilateral means alternating left/right visual cues with EEG observation. SSVEP means stationary cards modulated at different frequencies, with real frequency decoding from raw EEG. Deliver usable local experiments, recordings and diagnostics, not mockups or a promise of physiological accuracy.

No P300 classifier, robot commands, EMDR treatment, health/relaxation scoring, deep-learning training or cloud services in v1. Preserve existing acquisition, games, source labels and alpha calibration. Bilateral activity is exploratory; EEG changes during eye movement cannot be assumed to demonstrate neural relaxation or interhemispheric effects.

## Shared chooser and readiness

Rename shared chooser copy to Games & experiments or Choose an experience. Add Bilateral Visual Stimulation and SSVEP Cards, with Experiment badges. Opening a card opens setup only. Start stimulation only after an explicit gesture and notice.

The current picker uses a single calibrated-score readiness flag. Replace it with per-experience capabilities:

| Experience | Prerequisite |
| --- | --- |
| Garden / Beam | Existing calibrated usable score, unchanged |
| Experiment setup / static preview | Accessible without hardware or alpha baseline |
| Live bilateral recording | Fresh raw live EEG, writable recording destination, explicit Start |
| Live SSVEP | Same plus electrode mapping, supported display timing and decoder setup |
| Simulation | Explicit simulated EEG/test mode, never live verification |
| Existing resting replay | Raw diagnostics only; cannot validate responses to new on-screen stimuli |

Expose a direct path from Connect to the chooser so experiments do not require completing the alpha baseline. Do not reconnect on navigation. SSVEP threshold setup is separate from alpha calibration.

Maintain one acquisition producer and one shared frontend connection. Only that producer drains BrainFlow get_board_data(). Pass full-rate validated sample batches to experiment analysis/recording. Do not use downsampled UI waveforms or alpha scores for decoding. Alpha-feature quality alone must not gate experiments; use raw freshness, packet continuity and experiment-specific channel checks.

Only one experiment can be active. Bind it to an acquisition session ID, experiment UUID and browser-owner token. Concurrent starts conflict visibly. Settings cannot change mid-trial. Another viewer changing source/recalibrating interrupts the experiment. Stop is idempotent.

## Shared lifecycle and participant controls

Static previews never flash. Present a concise photosensitivity notice before a session, an explicit Start, persistent Stop and Escape-to-stop. Provide a non-stimulating alternative; stop for discomfort. Do not expose unsuspecting spectators to active projected flicker. Small targets or reduced brightness do not guarantee safety [5]. No trauma recall or treatment instructions.

Navigation, document hidden, missing socket/heartbeat, stale EEG, source change, recording failure or timing failure neutralizes visuals and interrupts the trial. Clear current predictions immediately. Preserve partial recordings and reason. Restart requires an explicit new trial, never resume midway or catch up animation after a sleep.

Initial ownership heartbeat: 500 ms; server expires after two seconds. Frontend independently neutralizes stimulation on connection loss. Two-second EEG freshness matches the current service. Decoder windows crossing a packet gap/duplicate are invalid. Separate trial completion from interruption. Disable garden audio/breath effects while either experiment is active.

## Bilateral Visual Stimulation

### Activity

Two stationary circles/cards left and right alternately receive a soft accent highlight. Do not use full-screen flashes. Default time between side changes: 1,000 ms; configurable 500–2,000 ms. Label the unit explicitly: at 1,000 ms, left to right takes one second and left-right-left takes two seconds. These are demo parameters, not clinical settings.

Default protocol: 20 seconds central fixation, 30 seconds alternating cues, 20 seconds central fixation. Allow phase durations 10–60 seconds. Record one of two instructions:

- Follow the cues with your eyes, keeping your head comfortable/still.
- Maintain central fixation while the cues alternate peripherally.

Treat these as different experimental conditions. Alternate/counterbalance their order in repeated evaluations. EEG does not control the cue pace. Log every phase boundary and side transition.

### Feedback

Show source, sample count, packet age, electrode names, selected raw waveform, phase/time, cue side, event count and recording status. Show stimulus timeline with alignment uncertainty. Compute descriptive mean-removed RMS and spectral powers over two-second windows at a modest update rate: theta 4–<8, alpha 8–<12, beta 12–30 Hz. State units/filtering; phase summaries include valid/rejected window counts and show insufficient data where needed.

Show an eye-movement-artifact note prominently when following cues. Do not label results left/right brain activation, calmness or successful treatment. Do not add unvalidated automatic artifact removal and claim the confound is solved [4]. Save all raw channels, not only the displayed channel.

## SSVEP Cards

### Stimulus

Three stationary cards A/B/C change luminance; their position, labels and size stay fixed. No decorative movement during a trial. Keep score bars outside the stimulus surface.

Initial supported profile: stable approximately 60 Hz display, nominal 10/12/15 Hz sampled-sinusoidal luminance. These correspond to 6/5/4 frames per cycle. For each card: luminance = mean + amplitude × sin(2π × frameIndex / framesPerCycle). Bound luminance and contrast; log settings. A five-frame sinusoid is not a symmetric square wave. Frequencies are engineering choices, not safety recommendations.

Drive all cards from one requestAnimationFrame canvas loop. Precompute values; do not use React updates, CSS timers or setInterval as the flicker clock. Separate charts/analysis from drawing. Record callback timestamps, frame count and phase/luminance. Do not send one network request per frame; batch bounded logs.

Run at least five seconds of non-flickering timing preflight. Initial engineering gate: median refresh within 1% of 60 Hz; fewer than 1% intervals above 1.5 times median; none above 3 times median. During a trial, any interval above 1.5 times established median interrupts it. Make thresholds configurable named constants and log them. Unsupported/variable refresh blocks the v1 profile with clear instructions; never silently use a 60-frame schedule on a 120 Hz display.

Display nominal frequency, software schedule estimate and timing health separately. Callback timing does not verify emitted light. Label optical timing unverified unless a photodiode measurement was actually performed [2]. A PsychoPy stimulus client is a later fallback if browser timing is inadequate, not a required rewrite.

### Trial flow

Setup → display check → decoder threshold setup → cued evaluation trials → summary/export. Initial trial: one-second cue, four-second stimulation, two-second non-flickering result/rest. Stimulation duration configurable 3–6 seconds. Exclude the first 0.5 seconds after onset; require a full uncontaminated two-second analysis window before reporting valid scores. Update diagnostics about four times per second; finalize decision before stimulation ends, then show it during rest.

Evaluation proposal: ten trials per target plus ten neutral trials, randomized with a saved seed and split into short blocks with explicit breaks. Neutral trials keep all stimuli running while instructing central fixation; blank-screen rest is not a substitute. Also support individual facilitator-run trials.

The instructed target is evaluation metadata only. Never give it to the decoder. Mark cue as Requested target and result as Decoded from EEG.

### Decoder

Implement a separate pure Python CCA function accepting full-rate samples, actual sample rate, selected channels and candidate frequencies [1]. Use stable NumPy SVD/QR or a minimal justified scientific dependency; handle rank deficiency and nonfinite/constant input. No large ML framework.

1. Require operator-entered channel-to-electrode mapping and reference. Select available posterior O/PO electrodes; never assume Cyton channel numbers imply positions. Initial protocol requires at least two valid posterior channels.
2. Reject nonfinite, flat, gross-amplitude and packet-discontinuous windows. Existing amplitude/flatness thresholds may be starting gates, labeled provisional. Report channels used, exclusions and reasons per output.
3. Detrend/mean-remove and document filtering. Suggested initial passband 6–40 Hz with first two harmonics. Use sufficient padding and trim filter-edge transients, without future data or filtering across trial/gap boundaries. Do not automatically add an unnecessary mains notch outside this passband.
4. Build sine/cosine references at fundamental and second harmonic; compute maximum canonical correlation for each card. Use effective configured frequencies, never a frequency selected from the cue.
5. Return per-card correlations, best candidate, runner-up margin, sample interval, age, channel set and validity/reason. Invalid data always clears accepted selection.

Correlations are similarities, not probabilities. Show Candidate separately from Accepted selection. Before threshold setup, show diagnostic-only mode with accepted selection null. Initial setup proposal: five cued trials per target and ten neutral trials. Choose correlation and margin thresholds on this setup data to reduce neutral false activations, report setup results, then freeze thresholds before evaluation. No hidden tuning on evaluation labels. If setup is inconclusive, remain diagnostic-only rather than forcing selections. Require a named initial 0.75-second candidate stability interval; overlapping windows do not constitute independent statistical evidence.

### Output

Waveform, spectrum with frequency markers, three correlation bars, candidate, selection-or-abstain, channel set, packet age, display timing, recording state, trial progress and evaluation summary. Report correct selections, abstentions, invalid trials and neutral false activations separately. Never turn correlation 0.8 into 80% confidence. No physical robot connection in this phase.

## Backend contract, recording and timing

Suggested files: backend/experiments.py, backend/ssvep.py, backend/experiment_recording.py; frontend BilateralExperiment.tsx, SsvepExperiment.tsx and experiments/timing.ts/types.ts. Adapt names to code structure. Add experience capabilities to games/catalog.ts; avoid an elaborate plugin framework.

Keep input protocol v1/alpha semantics intact. Add optional experiment telemetry to the existing WebSocket envelope: experiment/session/trial IDs, kind/mode/state/phase, recording state, invalid reason, sample interval, display timing; SSVEP adds frequencies, correlations, candidate, accepted selection or null, margin, channels and thresholds-ready flag.

API responsibilities: start/configure, batched events and ownership heartbeat, status, idempotent stop, export completed/partial recording. Reject bad bounds, unknown channels, wrong owner/session and duplicate/out-of-order event IDs. Bound payloads, queues and memory. Slow disk/decoder must not block acquisition: use a bounded worker queue; stop visibly on overflow instead of silently dropping data. Reset analysis on trial/session boundaries.

Browser performance time, server monotonic time and EEG timestamps are distinct. Implement repeated ping/pong clock-offset estimates using low-RTT exchanges; log RTT, offset and drift checks. Keep original browser event time, server receipt time, estimated EEG sample alignment and uncertainty. Do not call HTTP arrival time exact stimulus onset. BrainFlow insert_marker can assist but is a software marker, not optical verification; retain a sidecar event log [3]. Explicitly label software-only alignment. Trial windows must not include pre-stimulus EEG because of an unaccounted clock offset.

Default local output root: data/experiments/<uuid>/, ignored by Git and optionally configurable. Use pseudonymous participant IDs, not names. Never upload EEG.

| File | Contents |
| --- | --- |
| metadata.json | Schema/app version, source and acquisition IDs, mode, participant pseudonym, electrodes/reference/rate, stimulus and timing settings, filters, thresholds, setup/evaluation split, start/end state |
| eeg.csv or lossless NumPy equivalent | Full-rate eight-channel EEG, original timestamps, packet counter, monotonic sample index and documented units |
| events.jsonl | Unique IDs, trial/phase/side/cue events, browser/server times, estimated sample alignment/uncertainty, synchronization and abort records |
| frames.jsonl or compact equivalent | Frame times and requested phase/luminance schedule, explicitly not optical measurements |
| predictions.jsonl | Scores, decision/abstain, sample window, validity and frozen thresholds; labels only for separate evaluation |
| summary.json | Counts, valid/rejected data, trial metrics, interruptions and recording completeness |

Write incrementally, finalize on stop, retain incomplete sessions with reasons. Export paths must resolve inside the allowed root. Disk errors stop the experiment and display failure; never claim saved until successful. Show saved location and an export action.

## Simulation, acceptance and test evidence

Existing simulation generates an alpha-game score, not task-specific raw EEG. Add deterministic test fixtures with multichannel sine/harmonic signals and noise for decoder tests. If exposed as a demo, label Simulated EEG — no headset everywhere. A fixture generated from a target is pipeline testing, not real accuracy evidence. Ordinary unannotated replay is not a response to new flashes. Replay of experiment exports is optional, using original timing/settings only.

Automated acceptance:

- Side-change units, phase transitions and Stop/visibility cleanup correct.
- 60 Hz schedules produce intended cycles; wrong refresh/dropped frames fail visibly.
- CCA detects known injected signals across phase/noise; constant/nonfinite/gapped input invalidates; no target-label parameter exists.
- Setup/evaluation separation and abstention/false-positive accounting verified.
- One acquisition reader; experiments bypass alpha baseline while games retain it.
- Owner timeout, competing viewer, reconnect, hidden tab and navigation interrupt without automatic resume.
- Saved samples/events match ingestion and ordering; write-error/queue-full tests fail visibly; path traversal rejected.

Manual acceptance:

- Four chooser cards; opening either experiment does not stimulate or reconnect.
- Both pages run with explicit simulated fixtures and export inspectable data.
- Clear signals, timing and source labels at desktop and narrow widths.
- Stop/Escape, disconnect and source changes work against the backend.
- Existing Garden/Beam switching, calibration, sound isolation and EOF behavior preserved.
- Actual headset and photodiode checks listed as unverified unless performed. A public dataset result is reported separately from live-screen decoding.

## References

[1] [CCA frequency recognition](https://pubmed.ncbi.nlm.nih.gov/17152442/).

[2] [PsychoPy timing/synchronization](https://devdocs.psychopy.org/general/timing/index.html) and [refresh constraints](https://devdocs.psychopy.org/alerts/3115.html).

[3] [BrainFlow API](https://brainflow.readthedocs.io/en/stable/UserAPI.html); verify calls against pinned 5.23.0.

[4] [Eye movement artifacts in EEG](https://www.frontiersin.org/journals/human-neuroscience/articles/10.3389/fnhum.2012.00278/full).

[5] [Epilepsy Foundation photosensitivity guidance](https://www.epilepsy.com/what-is-epilepsy/seizure-triggers/photosensitivity-and-seizures).

Numeric defaults are engineering proposals for supervised testing, not validated clinical parameters or guaranteed accuracy thresholds.
