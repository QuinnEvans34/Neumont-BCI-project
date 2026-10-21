# Implementation plan and acceptance checks

## Proposed decomposition

Names below are suggestions, not a demand to duplicate existing abstractions. First inspect the current repository and preserve any newer work from Ted.

| Phase | Work and likely locations | Done when | Effort estimate |
| --- | --- | --- | --- |
| 1 | Schema/types and storage sinks in `backend/research/`; shared frontend types | Fixtures export identically from CSV and SQLite; both-mode failures visible | 12–20 hours |
| 2 | Recording manager, destination registry, lifecycle/history/export APIs; hooks in `backend/main.py` and signal calculation | Raw batches, analysis windows, calibrations and exact input frames join correctly; one SDK reader | 12–20 hours |
| 3 | App-level owner hook, setup/status controls, event batching and clock alignment | Record before calibration; pause/switch/reconnect without losing recording identity; writer status honest | 10–16 hours |
| 4 | Cairn simulation/render transition hooks and state snapshots | Every stone/effect/fall captured exactly once, including nonflashing bugs and zero-stone attempts | 8–14 hours |
| 5 | Garden model/lifecycle/settings hooks and state snapshots | Growth, stages, settle-in, guide/audio and resets captured exactly once | 8–14 hours |
| 6 | Shared channel diagnostics, history, Cairn fall and Garden milestone inspectors | Persisted recordings can be inspected by event, with trigger window and timing uncertainty | 12–20 hours |
| 7 | Failure recovery, integration/performance verification and operator docs | Acceptance matrix below passes with explicit hardware limitations | 12–20 hours |

Total estimate: **74–124 engineering hours**, including tests and integration. This is larger than the earlier CSV/Cairn-only outline because it includes Garden, SQLite/Both, destinations and two inspectors. Estimates are not elapsed AI execution promises. Deliver in phases; don't hide unfinished functionality behind enabled buttons.

CSV milestone after phases 1–5 can omit the completed SQLite/Both UI until those sinks pass tests, but the full requested implementation includes all three options. Never expose a storage choice that silently writes another format. Keep contracts stable so Ted can add a different database adapter later without changing the CSV sharing format.

## Proposed API surface

- `GET /api/research/destinations`, local-only `POST /api/research/destinations` and a write-probe operation.
- `POST /api/research/recordings`: participant/config/destination/format → ID + owner token; idempotency key prevents duplicate starts.
- Owner-token endpoints for heartbeat, ordered event/state batches, marker and stop. Scoped IDs and validation for all requests.
- `GET /api/research/recordings` and detail/status; windowed samples/metrics/events for finalized inspection.
- Finalized export by recording ID and selected CSV ZIP/CSV/database format; never accept arbitrary filesystem paths.
- Reuse clock endpoint/pattern where appropriate. Preserve existing websocket protocol compatibility with optional linkage fields, or explicitly version/migrate all clients if necessary.

One global acquisition owner and one research recorder; multiple viewers read status. Abstract shared writer primitives only with regression coverage for bilateral/SSVEP. Research recording is not an `ExperimentManager` session: reconnect/calibration/game switch must not accidentally finalize it.

## Required automated tests

1. Varied chunk sizes persist every received sample exactly once, including rejected and nonfinite samples with flags. Packet loss is identified, never filled with invented EEG.
2. Known sample fixture produces recorded features/target/score matching live code; each game-consumed frame links back to its true window and calibration. Logging does not run the mapper a second time.
3. Cairn deterministic fixture: bug without flicker, bug with flicker, gust, stone placement, level change and both fall causes. Check order, exact-once counts, active state and thresholds at failure. Zero-stone/reset outcomes retained.
4. Garden fixture: settle-in completion/interruption, growth stop/start, stage crossings/full bloom, pace change, guide/audio effective state, signal loss, reset and game switch. No duplicated milestones or false new plants.
5. Pause/hidden/EOF/disconnect remain distinct from game failure. Recording survives acquisition reconnect with distinct sample-key namespaces. Existing calibration snapshot and midround start have partial markers.
6. Browser retries/StrictMode/two tabs: duplicate events idempotent, out-of-order delivery handled or explicitly rejected with recovery, owner loss finalizes incomplete, no duplicate recorder or stimulus loops.
7. CSV/SQLite/Both parity for values, nulls, ordering and IDs; transactional batches, bounded queues, invalid destination, symlink/path traversal, removed drive, disk failure, sink disagreement and failed finalization.
8. Crash recovery exports persisted prefix with loss/unknown-tail metadata. Read-only history cannot present an active/recovered record as complete. Export quoting, Unicode and note formula escaping verified.
9. Synthetic-score mode has zero raw EEG rows; simulated raw/replay/live sources are distinguished. Clock jump/bursty timestamps/replay-time mapping uncertainty visible; event references remain useful even when nearest-sample mapping is unknown.
10. Existing games and bilateral/SSVEP tests continue passing. Starting one recorder while the other owns capture returns a clear conflict without disrupting it.

## Browser / integration checks

Using synthetic fixtures only, record a participant across calibration, Cairn, Garden, reconnect and stop; inspect downloaded ZIPs with actual parsed row counts. Exercise all three formats and two destination roots. Verify history after backend/browser restart, mobile layout, collapsed diagnostics, no console errors and no stimulation on merely opening Dev Mode. Record UI/frame and queue measurements for a 30-minute raw simulation: counts near the generated source total, bounded memory/backlog, and exact generated-vs-written comparison after draining. State the machine/configuration and observed performance; do not invent thresholds from a brief smoke test.

Class headset checklist: correct source and channel map, raw rate, calibration saved, one marked movement/electrode adjustment, Cairn bug/gust/fall, Garden milestone, unplug/reconnect, stop/export, compare files and event times. Hardware and optical timing are explicitly unverified until actually tested.

## Documentation and commits

Add operating instructions with storage/download distinction and a data-analysis example joining a fall/milestone → input frame → signal window → channel metrics/raw samples. Add `verification.md` with commands, results, observed UI cases, limitations and incomplete requirements. Use coherent commits for storage, acquisition/identity, common UI, Cairn, Garden, inspection and verification where feasible. Do not commit participant recordings, database files or generated archives. No push required by this handoff.
