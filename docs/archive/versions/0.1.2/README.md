# Version 0.1.2

Version: 0.1.2

## Overview

This source and documentation patch moved the 26 existing SVG maps beside their editable guides. It matched `package.json` and both root version fields in `package-lock.json`.

- Placed `overview.svg` at the map root and topic diagrams in `build/build-visuals/`, `code/code-visuals/`, `data/data-visuals/`, `flows/flows-visuals/` and `system/system-visuals/`.
- Updated Markdown previews, full-size links and the offline HTML viewer to use the new locations.
- Updated the exporter to reproduce this layout and removed the obsolete ignore exception for the old SVG data folder.
- Moved the project roadmap to [marketing/timeline.md](../../../project/marketing/timeline.md) and updated its incoming and relative links.

## Release record

Released 2026-11-11 through [PR #3 - Relocate visual maps and project timeline](https://github.com/QuinnEvans34/Neumont-BCI-project/pull/3), superseding [0.1.1](../0.1.1/README.md). All 26 moved SVGs were byte-identical to their originals; the PDF atlas and Mermaid diagrams were unchanged. See the [release log](../../logs/releases.md#release-history) and [documentation change log](../../logs/changelog.md).
