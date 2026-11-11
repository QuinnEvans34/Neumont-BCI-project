# Current workspace version

Version: 0.1.1

## Overview

This is the version of the current source and its documentation, matching `package.json` and both root version fields in `package-lock.json`. The production source is the version merged into `main` through a passing pull request.

- Adds release rules, package version checks, a local push guard, CI checks and a dashboard version/build badge.
- Organizes documentation into workspace guides, project references and historical archives, with code-traced visual maps and offline diagram exports.
- Applies the release checks to documentation: this declaration must match the package version, and each superseded version needs an archived overview.
- Repairs navigation after the dashboard and release-log moves, and includes the data-flow map sources and SVGs in Git while keeping recordings ignored.

## Release record

Release date: 2026-11-11. Version `0.1.1` supersedes [0.1.0](../archive/versions/0.1.0/README.md). The documentation organization, visual exports and version-policy changes are recorded together in the [release log](../archive/logs/releases.md#release-history) and [documentation change log](../archive/logs/changelog.md).

Release pull request: [#2 — Release v0.1.1 documentation and version policy](https://github.com/QuinnEvans34/Neumont-BCI-project/pull/2), targeting `main` from `codex/version-rules`.

## Updating this document

Every release, including documentation-only changes, advances the shared version under the [release rules](../archive/logs/releases.md). Before replacing this overview, preserve the outgoing version's overview in `docs/archive/versions/<version>/README.md`. Keep existing archived versions and describe the final scope of the new version here. Each version document must contain one standalone `Version: MAJOR.MINOR.PATCH` line and a nonempty `## Overview` section.

Run `npm run version:check` for package/document consistency and `npm run version:check-main` for the required bump and archive relative to fetched main. The push guard and CI use the same checks against committed files.

Past versions: [version archive](../archive/versions/README.md). This overview describes release scope; dated documentation edits remain in the [documentation change log](../archive/logs/changelog.md).
