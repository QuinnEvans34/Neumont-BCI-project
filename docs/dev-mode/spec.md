# Product and architecture specification

## Outcomes and scope

An operator can identify a participant, record before calibration, observe both games, diagnose failures and export understandable data without a database tool. Participants use the normal game UI with optional diagnostics collapsed. The mode is a user-facing operator option, not restricted to Vite development builds. Ted's development-only Cairn preview remains separate and must never silently masquerade as headset data.

Required: Cairn, Garden, all existing source labels, full-rate EEG when a raw source exists, exact game input logs, event timelines, local storage selection, recording history and download. Non-goals: cloud accounts, a remote database server, Teams integration, clinical conclusions, a new classifier, automatic parameter tuning, and pixel-perfect gameplay replays.

## Storage choices

| Choice | Canonical files while recording | Export |
| --- | --- | --- |
| CSV (default) | Incremental CSV tables plus JSON metadata/journal | CSV ZIP and individual finalized CSV files |
| SQLite | One local `recording.sqlite` with equivalent tables and transactional batches | Same CSV ZIP; optional finalized database download |
| Both | CSV tables and SQLite | Same CSV ZIP; database optional |

Use Python's built-in SQLite driver, owned by a dedicated writer thread; do not share connections across acquisition threads. Implement a small sink contract (open, append batches, flush, finalize, recover, export). Choose storage once per recording; no live format/destination migration. Both requires both sinks to succeed: a failure stops capture visibly, preserving each partial output and marking the recording incomplete. Do not claim cross-format atomicity or silently degrade to one format. Compare persisted row counts and last sequences during finalization.

Default root: ignored `data/research/`. Environment override: `BCI_RESEARCH_DIR`. Setup offers configured destinations (name, resolved local path, availability), a local-operator Add destination control, and an explicit backend write probe before start. Backend configuration owns allowlisted roots; the local operator may register an absolute path using a localhost-only, origin-validated configuration API. Reject remote Host/Origin requests; do not open arbitrary path registration over a network-bound backend. Exports reference registered destination IDs and recording UUIDs, never caller-supplied arbitrary file paths. Resolve paths and prevent symlink escapes, traversal, overwriting existing recordings or downloading files outside that recording.

This is a **folder on the computer running Python**. Browser JavaScript cannot choose an arbitrary backend folder through its download dialog. Display that distinction. Provide path entry with validation if a native directory picker is unavailable. Browser downloads use the browser's normal destination. Explain this beside the controls.

Each recording gets a new UUID subfolder. Metadata persists the destination ID; maintain a local nonparticipant index so history can discover recordings across registered roots. Report removed/unavailable destinations without deleting their history. Warn when the selected root is inside the Git checkout but outside ignored storage; require an ignored location before recording there. Store exports locally and let users attach them to Teams manually. No automatic upload.

## Lifecycle and identity

States: idle → preparing → recording → finalizing → saved; failures → incomplete/failed with recovery details. Start succeeds only after selected sinks are writable. Permit recording without EEG connected so calibration and connection attempts can be captured; clearly show 'Recording events — no EEG arriving'. Signal-only Simulation creates no fabricated EEG rows.

- Participant ID: operator-entered pseudonym, e.g. P007; no names required. Validate length/characters. Immutable during recording.
- Recording ID: UUID for the visit. Acquisition session ID: existing stream UUID, changes on reconnect. Calibration ID: new UUID for every calibration attempt. Round ID: UUID for each Cairn attempt or Garden plant, including zero-progress attempts.
- Game switches pause the old game and retain recording; reset/recalibration/source changes follow existing game behavior but log explicit round endings and new identities.
- EEG loss continues recording with gap/connection events; game freshness gates still pause play. Recovery never silently resumes a game.
- Recording stop finalizes the capture; an unfinished game round is marked 'capture_ended', not a fall or completed plant. Recording stop itself need not stop ordinary gameplay.
- Start during an existing game is allowed: log an initial state and `partial_start=true`; never invent earlier samples or a round onset. A preexisting calibration gets a snapshot marked 'collected before recording'.
- A single owner tab starts/stops recording; other tabs are read-only and display ownership. Owner heartbeat loss/navigation away from the app finalizes incomplete after a documented timeout (proposed 5 s). Internal game navigation does not unmount the recorder. Hidden-tab recording continues if the owner heartbeat remains healthy; gameplay pauses and this is logged. Do not depend on unload requests for data durability.

## Acquisition and persistence

Retain one SDK reader. Fan out acquired batches before game amplitude/quality rejection; persist all EEG values received from the SDK, including invalid values with explicit flags. Raw means acquired SDK samples, not radio packets; lost radio data cannot be reconstructed. Avoid re-reading the board, sampling the downsampled UI trace or deriving logs from React render frequency.

Record exact feature windows and input frames without changing update cadence or score smoothing. Threaded bounded queues keep file I/O off acquisition/render loops. Queue overflow, disk error or event transport failure makes loss visible, records the last acknowledged sequence where possible and stops the recording incomplete; ordinary game behavior continues under its normal gates. No unbounded buffers or silent dropped data.

Batch event delivery with sequence numbers, acknowledgements and bounded retries. Duplicate delivery is idempotent; sequence holes are explicit. Save regular checkpoints (target ≤1 s normal flush interval). Expose queued/written/flushed counts separately; flush is not a guarantee against power loss. On startup recover partial files/databases, label interrupted capture, export readable persisted data and report unknown tail loss. Never mark crash-recovered data complete.

Existing bilateral/SSVEP recorders must continue working. For v1, block starting those experiments during a research recording, and block research recording while an experiment owns the recorder. Explain how to finish the active recording. Avoid simultaneous competing recording owners until a tested shared-session design exists.

## Metadata and reproducibility

Save schema version, code commit/build ID (or unknown), dirty-build status if available, source type, board/sample-rate/channel configuration, electrode labels/reference, game settings, calibration snapshots, gate changes, algorithm version and random seeds. Include playback file identifier/hash without exposing the original absolute path in shared exports. Unknown values must be null/unknown, not guessed.

Internal metadata may include local paths; shareable exports omit absolute paths, usernames and machine identifiers. Pseudonymous EEG remains participant data: show who/what is included before download. No authentication system or automatic cloud synchronization is required.
