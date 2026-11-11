# Current workspace version

Version: 0.1.2

## Overview

This source and documentation patch moves the 26 existing SVG maps beside their editable guides. It matches `package.json` and both root version fields in `package-lock.json`.

- Places `overview.svg` at the map root and topic diagrams in `build/build-visuals/`, `code/code-visuals/`, `data/data-visuals/`, `flows/flows-visuals/` and `system/system-visuals/`.
- Updates Markdown previews, full-size links and the offline HTML viewer to use the new locations.
- Updates the exporter to reproduce this layout and removes the obsolete ignore exception for the old SVG data folder.
- Moves the project roadmap to [marketing/timeline.md](../project/marketing/timeline.md) and updates its incoming and relative links.

## Release record

Release date: 2026-11-11. Version `0.1.2` supersedes [0.1.1](../archive/versions/0.1.1/README.md). See the [release log](../archive/logs/releases.md#release-history) and [documentation change log](../archive/logs/changelog.md). All 26 moved SVGs are byte-identical to their originals; the PDF atlas and Mermaid diagrams are unchanged.

Release pull request: [#3 - Relocate visual maps and project timeline](https://github.com/QuinnEvans34/Neumont-BCI-project/pull/3), targeting `main`.

## Updating this document

Every release, including documentation-only changes, advances the shared version under the [release rules](../archive/logs/releases.md). Before replacing this overview, preserve the outgoing version's overview in `docs/archive/versions/<version>/README.md`. Keep existing archived versions and describe the final scope of the new version here. Each version document must contain one standalone `Version: MAJOR.MINOR.PATCH` line and a nonempty `## Overview` section.

Run `npm run version:check` for package/document consistency and `npm run version:check-main` for the required bump and archive relative to fetched main. The push guard and CI use the same checks against committed files.

Past versions: [version archive](../archive/versions/README.md). This overview describes release scope; dated documentation edits remain in the [documentation change log](../archive/logs/changelog.md).
