# Architecture and shared contracts

**Full planned component/lifecycle specification:** [Master blueprint](blueprint.md). This document retains the implemented narrow InputFrame v1 contract. Additive commands/status fields in the blueprint are proposed work, not already implemented.

## Components

```text
headset → adapter → rolling buffer → quality gate → features → calibration/model
                                                                ↓
Python WebSocket service → browser input adapter → Phaser simulation
                                  ↓                       ↓
                             React status          React round results
```

The game must work without Python in manual mode. Python must produce testable packets without Phaser. Acquisition and inference are backend jobs; render/physics/round timing are browser jobs. Keep physics state outside React render state and publish UI statistics at a lower rate.

## Directory ownership

- `apps/web/src/App.tsx`, `style.css`: UI team.
- `apps/web/src/Game.tsx`, `simulation.ts`: game team.
- `apps/web/src/input.ts`: shared contract; changes require frontend/data coordination.
- `backend/`: streaming and EEG team.
- Future `backend/adapters/`, `backend/features/`, `experiments/`: create when their tasks begin.
- `tests/`: shared behavior checks.
- `docs/`: everyone updates their own workstream as decisions change.

## InputFrame v1

```json
{
  "version": 1,
  "sequence": 42,
  "timestamp_ms": 1791500000000,
  "source": "synthetic",
  "score": 0.63,
  "quality": "good",
  "calibrated": true
}
```

- `sequence`: increasing nonnegative integer per connection; reject duplicates/out-of-order packets.
- `timestamp_ms`: producer Unix time, milliseconds, for logs/alignment. Browser freshness uses its own monotonic receipt clock, so wall-clock drift does not pause play incorrectly.
- `source`: `synthetic`, `live`, or `replay`; no implicit fallback.
- `score`: finite number in [0,1], already normalized/smoothed by backend.
- `quality`: `good` or `poor`. Future quality reasons need a versioned/additive agreement.
- `calibrated`: true only when the live participant has completed valid calibration. Synthetic fixtures may set true and stay labeled synthetic.

Route: `ws://127.0.0.1:8000/ws/input`, initial target 4 packets/second. Health endpoint: `GET /health`. The starter opens one synthetic producer per connection; a live implementation should share one acquisition session and broadcast frames.

Frontend rejects malformed input; stream data older than 2 seconds, poor quality, or uncalibrated input pauses physics/time/scoring. Recovery is visible. A connection failure never changes source to synthetic. Add explicit pause reason and connection lifecycle states in the UI workstream.

## EEG processing starting proposal

Read actual board sample rate/channel map → select usable EEG channels → preserve raw samples → apply justified filters → compute features on rolling 2–4-second windows → assess quality → normalize using participant baseline → smooth output → emit InputFrame.

Window length/filter choices are experiments, not headset-independent guarantees. Inspect clipping, missing samples, contact status where available, and movement/muscle contamination. Normalize from a stable baseline with robust statistics; handle flat or inadequate baselines by failing calibration. Do not feed an arbitrary alpha/beta ratio into a “calmness” label.

## Simulation decision

The initial game constrains the ball to the beam and integrates a small deterministic rolling model at 120 Hz. Phaser renders at display rate. This simplifies tuning and isolates physics for tests. The model uses dimensionless values and is not a scientific physical simulator. Add Matter only if free-flight/collision mechanics justify it.

## Session data proposal

For voluntary development sessions only, save raw EEG locally plus metadata: anonymous session id, headset/firmware, channels, sample rate, task labels/times, calibration, feature version, quality flags. Log game input and outcomes with timestamps. Keep recordings under ignored `data/`; use synthetic fixtures in Git. Define retention and participant consent before collection.
