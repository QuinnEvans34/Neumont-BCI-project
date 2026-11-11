# Architecture and shared contracts

For code-traced diagrams, start at the [visual map index](../maps/README.md): [runtime ownership](../maps/system/runtime.md), [EEG processing](../maps/data/signal-pipeline.md), [backend call paths](../maps/code/backend.md) and [frontend components](../maps/code/frontend.md).

The implementation is summarized here and in the [guided-session walkthrough](../dashboard/games/cairn/howtoplaycairn.md). The [original build blueprint](../../archive/plans/blueprint/blueprint.md) is archived planning context; its proposals and estimates are not a current implementation checklist.

## Components

```text
headset → adapter → rolling buffer → quality gate → features → calibration/model
                                                                ↓
Python WebSocket service → browser input adapter → Phaser simulation
                                  ↓                       ↓
                             React status          React round results
```

The games share one Python stream for live, replay, simulated raw EEG and explicitly labeled score-only synthetic input. Python produces packets independently of the browser renderer. Acquisition, feature processing and experiment decoding are backend jobs; rendering, game updates and stimulus presentation are browser jobs. Cairn and Balance Beam use Phaser; Garden uses a React/SVG scene. See the [runtime map](../maps/system/runtime.md) for ownership and threads.

## Directory ownership

- `apps/web/src/App.tsx`, `SignalPanel.tsx`, `style.css`: UI team.
- `apps/web/src/Game.tsx`, `simulation.ts`: game team.
- `apps/web/src/Cairn*.tsx`, `cairn*.ts`, `apps/web/src/assets/cairn/`: Cairn game; `tools/cairn_assets/`: its photo-to-sprite pipeline ([guide](../dashboard/games/cairn/README.md)).
- `backend/openbci_convert.py`, `backend/score_trace.py`: recorded-session tooling for no-headset testing.
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
- `timestamp_ms`: producer Unix time in milliseconds. Browser freshness checks both its monotonic receipt age and the producer's wall-clock timestamp against a two-second bound; a producer timestamp over two seconds in the future is also rejected.
- `source`: `synthetic`, `live`, `replay` or `simulated_eeg`; no implicit fallback. Synthetic is score-only; simulated EEG emits raw samples through the normal feature pipeline.
- `score`: finite number in [0,1], already normalized/smoothed by backend.
- `quality`: `good` or `poor`. Additive telemetry includes channel reasons and timestamp-gap evidence.
- `calibrated`: true for an enabled raw-EEG session with an accepted baseline. Score-only synthetic input bypasses baseline collection and stays labeled synthetic.

Route: `ws://127.0.0.1:8000/ws/input`, initial target 4 packets/second. Health endpoint: `GET /health`. One acquisition producer is shared by all browser viewers. Frames additionally contain `session_id` and `telemetry`: sample counts, measured delivery rate, recording position, verification counts, plots, channel gates and baseline statistics.

Frontend rejects malformed input; stream data older than 2 seconds, poor quality, or uncalibrated input pauses physics/time/scoring. Recovery requires explicit Resume. A round cannot resume with a different session ID. A connection failure never changes source to synthetic. The UI displays connection, waiting, receiving, stalled, EOF and error states.

## EEG processing starting proposal

Read actual board sample rate/channel map → select usable EEG channels → preserve raw samples → apply justified filters → compute features on rolling 2–4-second windows → assess quality → normalize using participant baseline → smooth output → emit InputFrame.

Window length/filter choices are experiments, not headset-independent guarantees. Inspect clipping, missing samples, contact status where available, and movement/muscle contamination. Normalize from a stable baseline with robust statistics; handle flat or inadequate baselines by failing calibration. Do not feed an arbitrary alpha/beta ratio into a “calmness” label.

## Simulation decision

The game integrates a small deterministic rolling model at 120 Hz. Phaser renders at display rate. Leaving either end ends the round; a ballistic animation shows the fall. Five-second settling and smoothed assistance soften abrupt inputs. Rounds have no timer cap. This isolates physics for tests. The model uses dimensionless values and is not a scientific physical simulator. Add Matter only if free-flight/collision mechanics justify it.

## Session data proposal

Research / Dev Mode implements local CSV, SQLite or Both capture spanning acquisitions, calibrations and Cairn/Garden rounds. Experiments use a separate EEG/event/frame recording format. The [recording map](../maps/data/recording-and-review.md) shows writers, joins, recovery and exports; the [operating guide](../dashboard/devtools/operating.md) explains capture controls and the processing/schema update. Keep participant recordings local rather than in Git.

## Implemented control endpoints

- `GET /api/options`: local recording names and serial ports.
- `GET /api/recording?name=...`: full-recording envelope and source metadata, constrained to the recording directory.
- `GET /api/status`: same telemetry delivered with WebSocket frames.
- `POST /api/connect`: choose source and recording/port; creates a session and clears baseline.
- `POST /api/calibrate`: explicitly start 30 accepted 500-sample windows from the current stream position. Does not reconnect or rewind.
- `POST /api/disconnect`: release ownership and invalidate calibration.

Game start/navigation does not call an acquisition endpoint. Every incoming replay EEG row is compared against the corresponding original row; sample mismatch halts acquisition. Preview data cannot enter feature or calibration buffers. EOF is based on the known sample count and disables usable input.
