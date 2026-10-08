# Weekend live demo: calibration → EEG feature → beam

This is a deliberately narrower deliverable than the full blueprint. Target: show a real headset affecting the existing software game at the next meeting. No trained classifier, stress detector, new game engine, or redesigned app is required.

## Definition of success

Connect the real device, collect roughly 60 valid seconds of baseline, display a changing live EEG feature score, and use that score to change the existing game's assistance. Show source live and pause when data is missing or clearly unusable. Repeat the demonstration after restarting. A labeled recording/video is backup, not a replacement claim of live operation.

## Required information before the connection code

Exact headset model/firmware, demo OS, and whether vendor software already shows EEG. Check raw access and SDK requirements. Prefer BrainFlow if exact board/OS is supported; otherwise use the vendor route. Do not invent board ids or spend the weekend writing Bluetooth protocols. If access cannot be resolved in the first 2–4 focused hours, identify the precise blocker and test one documented alternative.

## Simplest signal pipeline

1. Acquire actual samples and board metadata. Use one reader, preserve timestamps, select actual EEG rows rather than marker/accelerometer rows.
2. Every 250 ms, process the most recent approximately 2 seconds of EEG. Copy raw window before filtering. Require enough new samples; a repeated snapshot is not new data.
3. Reject nonfinite/missing/flat/clipped data and use contact flags when available. Initial artifact handling is limited; label it as basic quality screening. Inspect blink/jaw/movement examples rather than treating them as brain-control success.
4. Detrend and apply a justified filter/noise treatment using the actual sampling rate. Estimate PSD with BrainFlow's Welch/band-power helpers. Do not blindly chain every filter in the example script.
5. Initial candidate: relative alpha power = power(8–12 Hz) / power(4–30 Hz), calculated per usable selected channel and combined robustly. This is a configurable demonstration feature, not an equation for stress. Ensure denominator is positive/valid. Final channel choice depends on electrode locations. If the device supplies only vendor metrics, label that source and revise the feature step.
6. During baseline, collect approximately 30 non-overlapping valid 2-second feature values across about a minute. Eyes open, seated, consistent posture; exclude flagged windows. A minute of wall time with poor data does not count as a minute of calibration.
7. For feature f, compute baseline median m and robust spread s = 1.4826 × median(abs(f - m)). Fail calibration if usable data or spread is inadequate; don't conceal a flat signal by dividing by an arbitrary tiny number.
8. During live play compute z = (f - m) / s; score = clip(0.5 + z/6, 0, 1). This mapping is our initial game design. Baseline is near neutral; higher relative-alpha values increase assistance, without claiming more calmness.
9. Smooth score lightly (e.g., EMA: 0.8 previous + 0.2 new at 4 Hz). Keep smoothing in one place. Expect seconds of feature-window/smoothing lag, not instantaneous thought response.
10. Emit the existing InputFrame v1 with source live, score, quality and calibrated flags. Use the current WebSocket route; existing game consumes score without knowing the headset.

Dependencies/examples: [BrainFlow supported boards](https://brainflow.readthedocs.io/en/stable/SupportedBoards.html), [acquisition example](https://github.com/brainflow-dev/brainflow/blob/master/python_package/examples/tests/brainflow_get_data.py), [band-power example](https://github.com/brainflow-dev/brainflow/blob/master/python_package/examples/tests/band_power.py), [API reference](https://brainflow.readthedocs.io/en/stable/UserAPI.html). NumPy supplies baseline statistics. No scikit-learn is needed for this weekend path.

Skip gamma for this first demo: high-frequency scalp EEG can contain substantial muscle activity, making a quick gamma-based feedback input difficult to interpret. [Primary experimental evidence](https://pubmed.ncbi.nlm.nih.gov/17574912/). Relative alpha is also not artifact-proof or validated as stress; it is simply an interpretable feature to test.

## Minimal code changes

- `backend/adapters/brainflow_source.py` (new, if compatible): acquisition/configuration and cleanup.
- `backend/features.py` (new): one window feature + basic quality checks.
- `backend/calibration.py` (new): baseline collection, robust normalization, score smoothing.
- `backend/main.py`: one shared acquisition/processing task replacing synthetic generation only when explicit live mode is selected. Retain synthetic mode for development, visibly labeled.
- `App.tsx`: show calibration progress/status and live source. For this weekend, calibration may start automatically at backend launch; recalibration can use a backend restart instead of building all planned REST controls.
- Disable arrow-key steering in the live demo so its effects are distinguishable from EEG.

Before calibration completes, send calibrated false; no valid feature means quality poor. Lost stream pauses the existing game; reconnect/restart requires renewed baseline. No silent switch from live to synthetic.

## Order and budget

| Step | Hours | Observable checkpoint |
| --- | --- | --- |
| Real device connection | 2–4 | Live samples, actual rate/channel map and clean restart |
| Feature/quality calculation | 2–3 | Inspect raw trace and a changing feature in terminal |
| One-minute baseline | 1–2 | Valid calibration completes; flat/bad data fails |
| Existing stream/game wiring | 1–2 | Browser shows live source; score changes assistance |
| Rehearsal and fixes | 2–3 | Two restarts, disconnect pause, 30-second video |

Total: 8–14 focused person-hours if a supported SDK works; allow another 2–4 hours for integration issues. Driver/access/subscription problems can exceed that budget. This is much smaller than building the full production session experience.

Friday: connection first. Saturday: feature and calibration, then game wiring. Sunday: restart/disconnect tests, truthful demo explanation and backup capture.

## Meeting demonstration

Launch backend and existing frontend; connect/fix contact; calibrate eyes-open; show feature score moving while beam assistance changes; stop/disconnect to demonstrate pause; reset and repeat if time permits. Explain: “This is real EEG normalized against my baseline. It changes game assistance. The next work is determining which features are repeatable and useful.”

Do not promise visitors can reliably control the signal yet. If eyes-closed testing produces an obvious change, describe it as a controlled signal sanity check, not evidence of stress reduction or eyes-open gameplay ability.
