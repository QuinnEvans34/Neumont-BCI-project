# Research / Dev Mode: implementation handoff

Status: implemented October 21, 2026 (Cairn and Garden; CSV, SQLite and Both), verified with Simulated EEG and synthetic fixtures only. No headset or optical timing test yet. Operating steps: [operating.md](operating.md). Results, limitations and what is still open: [verification.md](verification.md). The specification below is unchanged.

Build shared recording and inspection for **Cairn and Glowing Garden**. Capture acquired EEG, the exact signal processing outputs consumed by each game, game state, events and operator annotations on linked timelines. Make portable CSV exports easy to share manually through Teams. Offer local CSV, local SQLite, or both as recording formats, with a configurable server-side destination. SQLite is the proposed first database adapter; Ted's planned database is not present in the inspected branch and must not be assumed implemented.

## Read in order

1. [Product and architecture specification](spec.md)
2. [Data and timing contract](data-contract.md)
3. [Game instrumentation and UI](games-and-ui.md)
4. [Implementation plan and acceptance checks](implementation-plan.md)
5. [Copy/paste Claude prompt](claude-prompt.md)

## First usable release

Enable Dev Mode → enter participant pseudonym → choose storage format and local destination → Start recording → connect/calibrate → play Cairn and/or Garden → Stop & save → review and Download ZIP.

One recording spans calibration, multiple rounds/plants, game switches and acquisition reconnects. Falls and full bloom do not stop recording. Record both games in the first release; Cairn has a fall inspector and Garden has a milestone/session inspector. SQLite and Both modes are required before the complete handoff is considered finished, but CSV is the first implementation milestone and the default.

## Existing foundations

- `backend/main.py`: single acquisition owner, input frames, calibration and channel-quality telemetry.
- `backend/experiment_recording.py`, `backend/experiments.py`: bounded writer, raw EEG CSV, ownership, events, clock sync and local export. Reuse/refactor tested primitives; do not copy the experiment manager wholesale because its lifecycle differs.
- `apps/web/src/experiments/session.ts`, `timing.ts`: event batches, ownership and timing patterns.
- `CairnPreview.tsx`, `cairnScores.ts`: score-trace test bench, local round history and flicker CSV; these are not research recordings.
- `CairnStage.tsx`, `cairnSimulation.ts`: authoritative game transitions and state.
- `Garden.tsx`, `gardenSimulation.ts`, `gardenPrefs.ts`: growth, settle-in, breathing/audio settings and local plant summaries.

Do not alter game physics, scoring formulas, baseline thresholds or existing experiment protocols as part of this work. Record them faithfully. No real EEG or local recordings belong in Git.
