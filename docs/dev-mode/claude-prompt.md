# Claude implementation prompt

Copy the text below into Claude with access to this repository.

---

Implement Research / Dev Mode for BOTH Cairn and Glowing Garden in the Neumont BCI project. Read `docs/dev-mode/README.md`, `spec.md`, `data-contract.md`, `games-and-ui.md`, and `implementation-plan.md` before editing. These documents define the work; this is an implementation request, not another planning exercise.

First inspect the current branch, local changes and repository instructions. Preserve Ted's Cairn implementation and all current games/experiments. Ted may add database work later; inspect what actually exists rather than assuming it is available. The specified initial database option is local SQLite; keep a storage adapter boundary for future alternatives.

Build a shared operator mode with participant pseudonyms, recording/acquisition/calibration/round IDs, recording before calibration and across game changes, full-rate acquired EEG, exact signal windows/input frames, and timestamped game events and state. Cairn must record stones, levels, all bugs (including nonflashing), gusts, flicker and falls. Garden must record settle-in, growth, stage/full-bloom milestones, pauses/resets, pace, breathing guide and effective audio/settings. Zero-progress/abandoned rounds and partial recordings matter.

Support CSV (default), SQLite, and Both with a selectable, validated local backend storage destination. Every mode exports the SAME portable CSV ZIP with metadata, dictionary and completeness manifest, suitable for manual Teams sharing. Keep files local; do not upload or send anything. Make the backend save directory versus browser download directory distinction clear. Use secure scoped destinations and recording IDs; never expose arbitrary-path file downloads. Keep participant data out of Git and shared exports free of local absolute paths.

Use the existing single board acquisition reader. Reuse/refactor tested recording and clock primitives; do not add another SDK reader, record UI-decimated waveforms as raw EEG, change game/scoring formulas, or run scoring twice just for logging. Game-quality rejection must not discard raw recording data. Existing experiment lifecycle differs from research recording; preserve experiment behavior and enforce the documented mutual exclusion in v1.

Build live diagnostics and persistent recording health controls. Add a Cairn fall inspector and Garden milestone/session inspector over persisted timelines. Associate events with the exact input frame and feature window used, and preserve clock uncertainty. Show known physics causes and observed signal context without claiming a channel, stress or a distraction scientifically caused a fall. Breathing guidance is not measured respiration. Do not enable flicker merely by entering Dev Mode.

Implement in the phases from the plan with meaningful regression tests and coherent commits. CSV-first is a development milestone, not permission to omit SQLite/Both or Garden from the completed delivery. Do not expose nonfunctional controls or silently substitute storage formats. Handle disk/queue/transport failures and interrupted-session recovery visibly. Preserve responsiveness and existing gameplay when capture fails.

Run the frontend tests, production build and backend unittest suite. Perform browser tests with synthetic fixtures and inspect actual exports for all formats and both games; never claim headset/photodiode validation without access and evidence. Add `docs/dev-mode/verification.md` stating actual results, untested areas, deviations and any remaining work. Include startup steps, a short operator walkthrough and example data joins. Do not commit generated recordings, secrets or archives, and do not push unless the user separately requests it.

At completion, summarize implemented behavior, tests, known limitations and exact steps for the club to record a participant, play both games and share a CSV ZIP.
