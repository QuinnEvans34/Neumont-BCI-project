# Contributing

`main` is production. Every update must incorporate the latest `origin/main`, increment the package version, and pass a pull request before merging. Run `npm run hooks:install` for an existing install; new installs set up the push guard automatically. Follow the [version and release rules](docs/archive/logs/releases.md) for commands, version choices and required GitHub protection.

Documentation-only updates follow the same rules. Keep [the current version and overview](docs/workspace/version.md) aligned with the package files, and preserve the outgoing overview in [the version archive](docs/archive/versions/README.md). The version checker, push guard and CI enforce these requirements.

Choose one task with a project lead using the [project roadmap](docs/project/marketing/timeline.md), confirm an owner/due date at the meeting, and post a short note about what you will demonstrate. The [original workstream briefs](docs/archive/plans/workstreams/README.md) are archived context; confirm a task is still open before reusing it. Ask a lead for pairing if setup or the first change is unclear. See the [documentation index](docs/README.md) for guides and filing conventions.

Use a small branch such as `codex/ui-calibration` or your club's agreed branch convention. Keep changes focused on one deliverable. Coordinate edits to shared protocol or simulation props before making incompatible changes.

Before review run `npm test` and `npm run build` for frontend/game changes. For Python stream changes also exercise health/WebSocket and failure handling. Include a screenshot/video for UI/game behavior, plots/results for EEG/ML changes, and update the relevant brief if decisions changed.

Do not commit `data/`, participant identities, tokens, `.env`, or model files derived from private recordings. Keep raw development recordings local. Do not add heavyweight services/dependencies without explaining how they satisfy an MVP need. Credit copied code/assets and preserve license notices.

A task is done when another member can run it from the README and verify its acceptance checklist. Bring a working small demo to each meeting rather than waiting for a whole subsystem to be finished.
