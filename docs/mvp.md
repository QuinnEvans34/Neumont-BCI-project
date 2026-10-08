# MVP specification

## Locked scope

One browser-based 2D ball-and-beam game. React + TypeScript owns the application UI; Phaser owns rendering/game updates. Python owns EEG acquisition and feature processing. One visitor at a time, one 60-second playable round, one target center zone.

## Primary mechanic: EEG-assisted balance

A conventional game controller returns the ball toward the center. A bounded disturbance challenges that controller. A calibrated input score from 0 to 1 reduces disturbance strength as it rises. The participant influences assistance, not precise left/right beam motion. The interface must disclose this automation.

The first EEG feature is chosen after headset testing. “Higher score” means higher selected/calibrated feature, not inherently more calmness. Direct brain steering remains an experiment after the core game works. Keyboard steering is practice mode and must not be mixed into formal EEG evaluation scores.

## Visitor flow

Connect and inspect signal → fit headset → collect baseline calibration → explain feedback → start round → pause if signal is unusable → show time in center zone → reset for next visitor.

Target calibration: approximately 30–60 seconds, contingent on repeatability testing. If the feature does not vary reliably, say so and offer labeled replay; never silently substitute synthetic data.

## Showcase acceptance criteria

- Starts locally with documented commands; simulation runs without a headset.
- Shows source (manual/synthetic/live/replay) at all times.
- Completes a 60-second round and reports time inside the center zone, bounded by 0–60 seconds.
- Higher/lower input produces a visible, explainable difference under identical disturbances; quantify it in paired deterministic trials.
- Live adapter emits the shared protocol, supports calibration, and reports bad contact/artifacts/gaps.
- Poor, uncalibrated, disconnected, or >2-second stale stream input freezes game time and scoring. Recovery requires fresh usable data; mode changes reset the round in the completed MVP.
- Reset clears the previous visitor's baseline and score.
- At least five visitors outside the team can understand and complete the flow; record setup time and failure reasons.
- Ten consecutive rehearsed rounds work on the showcase machine, with disconnect/reconnect/reset checks.
- README, dependency attribution, member tasks, and showcase explanation are ready.

## Out of MVP

Physical hardware/servos, meditation-repo integration, mobile apps, accounts, cloud EEG storage, multiplayer, deep learning, medical claims, and generalized thought decoding.

## Prototype versus MVP

The current starter is a manual/synthetic demo. It has no real calibration, actual EEG quality checks, persisted recordings, or headset adapter. Stream reconnection and freshness checks are implemented. Poor-stream simulation and complete mode-reset behavior are upcoming tasks.
