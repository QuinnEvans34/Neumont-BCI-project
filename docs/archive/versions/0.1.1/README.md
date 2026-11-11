# Version 0.1.1

Version: 0.1.1

## Overview

Documentation and version-policy release merged into `main` on 2026-11-11 through [PR #2](https://github.com/QuinnEvans34/Neumont-BCI-project/pull/2), merge commit `5e41845`.

- Added release rules, package version checks, a local push guard, CI checks and a dashboard version/build badge.
- Organized documentation into workspace guides, project references and historical archives, with code-traced visual maps and offline diagram exports.
- Applied release checks to documentation: the current declaration must match the package version, and each superseded version needs an archived overview.
- Repaired navigation after the dashboard and release-log moves, and included the data-flow map sources and SVGs in Git while keeping recordings ignored.

The 26 SVG diagrams were stored under `docs/workspace/maps/rendered/` in this version. Its offline HTML viewer and PDF atlas were stored at the map root. Later releases may relocate these artifacts; consult the [current map index](../../../workspace/maps/README.md).

## Validation

All three PR checks passed: `version-policy`, `frontend` and Linux `backend`. Local validation passed all 92 frontend/version-policy tests, the frontend build and local links across 65 Markdown documents. Windows backend limitations are recorded in the [release log](../../logs/releases.md#release-history).

See the [version archive](../README.md) and [current workspace version](../../../workspace/version.md).
