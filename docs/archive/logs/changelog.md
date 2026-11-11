# Documentation change log

## 2026-11-11

- Release `0.1.2` ([PR #3](https://github.com/QuinnEvans34/Neumont-BCI-project/pull/3)): moved the 26 existing SVGs beside their map guides and the project roadmap to `project/marketing/timeline.md`, updated incoming and relative links plus exporter destinations, removed the old ignore exception, and archived the `0.1.1` overview. SVG content and the PDF atlas are unchanged.

- Recorded the documentation and version-policy release `0.1.1` for `main` in [pull request #2](https://github.com/QuinnEvans34/Neumont-BCI-project/pull/2), with a shared version overview, a [release-history entry](releases.md#release-history) and validation results. Repaired links after the final dashboard/replay-guide moves and added Git ignore exceptions for the data-flow map sources and SVGs.

- Moved release rules and the documentation change log to `archive/logs/`, updating navigation, relative links and the hook installer's reference.

- Declared the current shared source/documentation version in `workspace/version.md`, archived the recorded `0.1.0` history under `archive/versions/`, and extended version checks to enforce current declarations, previous-version overviews and retention of existing archives.

- Exported all 26 diagrams as standalone SVGs, an offline HTML viewer and a bookmarked PDF atlas. Map guides now show SVG previews with the editable Mermaid source underneath; added reproducible export tools under `tools/docs/`.

- Added code-traced Mermaid maps under `workspace/maps/` for runtime ownership, signal processing, recording/review, frontend/backend functions, player/experiment flows, builds/releases and offline asset/data tools.
- Updated navigation and references for the `workspace/build/` and `archive/logs/` locations; aligned the architecture summary's input and recording notes with the implementation.

- Organized documentation into `workspace/`, `project/` and `archive/`, with a main index and guides for each area.
- Grouped app guides and contracts under `workspace/dashboard/`; placed project goals, hardware notes and BCI research under `project/`.
- Collected historical blueprint/task bundles, implementation prompts and dated verification records in the archive.
- Updated documentation links and repository path references, including task CSV/JSON exports.
- Recovered the existing data-team brief from a Git-ignored documentation directory by moving it alongside the other archived workstream briefs.
