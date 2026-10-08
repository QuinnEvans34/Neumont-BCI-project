# Contributing

Pick one task from `docs/workstreams/README.md`, confirm an owner/due date at the meeting, and post a short note about what you will demonstrate. Ask a lead for pairing if setup or the first change is unclear.

Use a small branch such as `codex/ui-calibration` or your club's agreed branch convention. Keep changes focused on one deliverable. Coordinate edits to shared protocol or simulation props before making incompatible changes.

Before review run `npm test` and `npm run build` for frontend/game changes. For Python stream changes also exercise health/WebSocket and failure handling. Include a screenshot/video for UI/game behavior, plots/results for EEG/ML changes, and update the relevant brief if decisions changed.

Do not commit `data/`, participant identities, tokens, `.env`, or model files derived from private recordings. Keep raw development recordings local. Do not add heavyweight services/dependencies without explaining how they satisfy an MVP need. Credit copied code/assets and preserve license notices.

A task is done when another member can run it from the README and verify its acceptance checklist. Bring a working small demo to each meeting rather than waiting for a whole subsystem to be finished.
