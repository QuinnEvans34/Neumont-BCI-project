# Version archive

Overviews of superseded source and documentation versions. The [current workspace version](../../workspace/version.md) declares the active version; [release rules](../logs/releases.md) explain how to advance it.

| Version | Overview |
| --- | --- |
| 0.1.1 | [Documentation organization, visual map exports and shared version enforcement](0.1.1/README.md). |
| 0.1.0 | [Prototype and accumulated game, experiment and research tooling](0.1.0/README.md). |

For each release, preserve the outgoing overview at `<version>/README.md`, using its exact stable `MAJOR.MINOR.PATCH` number as the directory name. Include a standalone `Version: <version>` line, a nonempty `## Overview` section, the implemented scope and any relevant evidence or limitations. Update this index when adding a version. Keep prior overviews in later releases. The version checker validates declarations, rejects current/future versions in the archive and requires the previous main version's overview before release.

The repository used `0.1.0` throughout its earlier history and has no release tags. The archive groups that history under the recorded package version rather than assigning versions to individual commits retroactively.
