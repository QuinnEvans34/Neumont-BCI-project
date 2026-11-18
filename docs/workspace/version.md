# Current workspace version

Version: 0.2.0

## Overview

This compatible feature adds two Cairn wind controls beside the firefly toggle. It matches `package.json` and both root version fields in `package-lock.json`.

- **Wind off completely** removes ambient wind force, gust pushes, wind visuals and gust reductions to both tumble thresholds.
- **Wind does not lower tumble thresholds** keeps wind forces and visuals while preserving the level's normal sway-fall and Go-mode landing limits.
- Both settings default off, persist per browser and apply immediately. Wind-off takes priority when both are on.
- Research recording schema 3 captures initial settings, timestamped old/new changes (including paused changes), current settings in game-state rows, and effective thresholds. CSV, SQLite, Both and ZIP exports retain them.
- Existing schema-1/2 recordings remain readable/exportable; absent wind settings stay unknown and exports retain their original columns.
- The development preview exposes both controls for checking forced gusts.

## Release record

Prepared 2026-11-18 on `codex/cairn-wind-controls`, based on fetched `origin/main`. Version `0.2.0` supersedes [0.1.2](../archive/versions/0.1.2/README.md) with a minor increment under the [release rules](../archive/logs/releases.md). This branch still requires a passing pull request before merging into `main`.

See the [Cairn guide](dashboard/games/cairn/README.md#wind-controls), [recording guide](dashboard/devtools/games-and-ui.md#cairn-instrumentation) and [validation record](../archive/sessions/2026-11-18/cairn-wind-controls.md).

## Updating this document

Every release, including documentation-only changes, advances the shared version under the [release rules](../archive/logs/releases.md). Preserve the outgoing overview in `docs/archive/versions/<version>/README.md`, retain existing archives, and update the [version archive](../archive/versions/README.md). Each overview needs exactly one standalone version declaration and a nonempty Overview section.

Run `npm run version:check` and `npm run version:check-main` before review. The push guard and CI check committed files.
