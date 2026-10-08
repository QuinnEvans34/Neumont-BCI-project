# Functional MVP acceptance and verification

These are future completion checks, not a claim that the starter already passes them. See `docs/validation.md` for observed starter checks.

## Product and UI

- [ ] Welcome clearly explains automated centering and EEG-controlled assistance.
- [ ] Manual, synthetic, live and replay sources remain visibly distinct.
- [ ] Connection/setup/calibration/play/results flow works with fixtures and live source.
- [ ] Calibration progress counts valid data; flat or inadequate baseline fails visibly.
- [ ] New visitor reset clears baseline, cached score, timer and results.
- [ ] Mode changes reset the round; no comparison of mixed-source scores.
- [ ] Live mode disables practice keyboard steering.
- [ ] Keyboard focus/non-color status/narrow layout work; no mandatory remote font dependency.

## Game

- [ ] Round lasts 60 valid playing seconds; score is between 0 and 60 seconds.
- [ ] Poor/stale/disconnected/calibrating states freeze motion, time and score.
- [ ] Paused wall time is reported separately; recovery asks for explicit resume.
- [ ] Same disturbance schedule/initial state supports score-extreme comparisons.
- [ ] Input mapping visibly and measurably affects difficulty; fun is tested with visitors.
- [ ] Different render rates preserve equivalent simulation; ball stays finite/bounded.

## EEG and service

- [ ] Exact headset/OS/sample rate/channel map/units and access route documented.
- [ ] Single device owner shared by browser clients; clean stop/release.
- [ ] Raw samples retained before in-place filters; correct channel axes/frequency bounds.
- [ ] Quality rejects gaps/flat/clipped/contact failures and obvious challenge artifacts.
- [ ] Good/poor flags and calibration status match observable behavior.
- [ ] Duplicate/out-of-order/malformed frames ignored; stale threshold enforced.
- [ ] Acquisition doesn't freeze HTTP/UI; latest-data queues remain bounded.
- [ ] Reconnect clears stale buffers and participant state as specified.
- [ ] Protocol fixtures agree between Python and TypeScript.

## Evidence and ML

- [ ] At least three voluntary pilot participants provide repeated attempts; report usable-data fraction and within-person repeatability.
- [ ] Observed signal fluctuation is not reported as proven intentional control.
- [ ] Optional ML uses task/session labels and separate held-out evaluation; no overlapping-window leakage.
- [ ] ML report compares dummy/simple-feature/classifier performance and artifacts; negative findings are acceptable.
- [ ] If adopted, feature order/preprocessing/model version match training and inference.
- [ ] Slow model training is not hidden in visitor baseline calibration.

## Delivery

- [ ] Two members can launch from a fresh checkout with documented versions.
- [ ] Automated frontend and backend behavioral checks pass without headset hardware.
- [ ] Five new visitors complete a usability study; setup time, completion and confusion measured.
- [ ] Showcase laptop meets proposed render/delivery targets or recorded justified adjustments.
- [ ] Ten consecutive rehearsed rounds include reset, quality pause and reconnect checks.
- [ ] Labeled replay/video backup works; no synthetic mode masquerading as live.
- [ ] Operator runbook, poster, attribution and club license decision prepared.
- [ ] No raw participant data, secrets or unidentified model artifacts in Git.

## Suggested failure-injection scenarios

Stop backend mid-round; send poor quality; stop packets without closing socket; repeat sequence; send malformed/out-of-range score; fail calibration with flat data; reconnect twice; open second tab; switch input source; hide/reveal tab; reset during calibration; end replay; restart entire station offline with recorded backup.

Record result, OS/browser, steps, expected/actual behavior, related task and owner. Do not repeatedly broaden tests once required behavior is verified unless a change introduces a new concern.
