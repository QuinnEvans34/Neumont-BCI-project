# MVP specification

## Locked scope

One browser-based 2D ball-and-beam game. React + TypeScript owns the application UI; Phaser owns rendering/game updates. Python owns EEG acquisition and feature processing. One visitor at a time, one endless survival round, one target center zone.

## Primary mechanic: EEG-assisted balance

A conventional game controller returns the ball toward the center. A bounded disturbance challenges that controller. A calibrated input score from 0 to 1 reduces disturbance strength as it rises. The participant influences assistance, not precise left/right beam motion. The interface must disclose this automation.

The first EEG feature is chosen after headset testing. “Higher score” means higher selected/calibrated feature, not inherently more calmness. Direct brain steering remains an experiment after the core game works. Manual score controls and keyboard steering have been removed; labeled simulation remains available through the guided setup.

## Visitor flow

Connect and inspect signal → fit headset → collect baseline calibration → explain feedback → start round → pause if signal is unusable → show time in center zone → reset for next visitor.

Calibration collects 60 seconds of accepted, non-overlapping data after an explicit Begin baseline action. If the feature does not vary reliably, say so and offer labeled replay; never silently substitute synthetic data.

## Showcase acceptance criteria

- Starts locally with documented commands; simulation runs without a headset.
- Shows source (synthetic/live/replay) at all times.
- Continues beyond 60 seconds without an automatic win; a fall ends the round. Reports elapsed survival and center-zone time.
- Higher/lower input produces a visible, explainable difference under identical disturbances; quantify it in paired deterministic trials.
- Live adapter emits the shared protocol, supports calibration, and reports bad contact/artifacts/gaps.
- Poor, uncalibrated, disconnected, or >2-second stale stream input freezes game time and scoring. Recovery requires fresh usable data; mode changes reset the round in the completed MVP.
- A new connection or recalibration clears the previous baseline. Play again resets the round while retaining the current session baseline.
- At least five visitors outside the team can understand and complete the flow; record setup time and failure reasons.
- Ten consecutive rehearsed rounds work on the showcase machine, with disconnect/reconnect/reset checks.
- README, dependency attribution, member tasks, and showcase explanation are ready.

## Out of MVP

Physical hardware/servos, meditation-repo integration, mobile apps, accounts, cloud EEG storage, multiplayer, deep learning, medical claims, and generalized thought decoding.

## Prototype versus MVP

The prototype now includes guided setup, explicit statistical calibration, recorded EEG verification, direct Cyton acquisition code, signal telemetry, endless play and explicit pause recovery. Native replay and session continuity are verified; physical Cyton behavior and physiological control still need validation. The current amplitude/flatness gates are provisional, and recording new live sessions remains future work. See [current walkthrough](replay-and-connection.md).
