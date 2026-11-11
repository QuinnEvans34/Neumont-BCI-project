# Version 0.1.0

Version: 0.1.0

## Overview

The initial prototype and all subsequent work before the version-policy update shared package version `0.1.0`. This overview covers that accumulated implementation through commit `ef01877` (2026-11-11), rather than a separately tagged release. The package version first appeared in commit `0bb4e47` (2026-10-08).

- React dashboard and Phaser Balance Beam game, with a Python acquisition backend, BrainFlow Cyton replay/live adapters, alpha-based scoring, calibration and signal-quality checks.
- Glowing Garden and Cairn games sharing connection, session and baseline state, with recorded-input testing and game diagnostics.
- Bilateral Visual Stimulation, SSVEP Cards and SSVEP Circle experiments, including EEG/stimulus recording and export tools.
- Research / Dev Mode for shared Cairn/Garden recordings, pseudonymous participant setup, CSV/SQLite storage, ZIP exports and review tools.
- EEG visualizer, recording comparisons, filtered scoring and electrode signal checks.
- Project plans, hardware notes, research references, implementation contracts and dated verification records, subsequently reorganized under the current documentation structure.

## Evidence and limitations

- [Starter validation](../../sessions/2026-10-08/validation.md) and [hardware readiness review](../../sessions/2026-10-09/hardware-readiness.md).
- [Garden implementation and verification](../../sessions/2026-10-14/garden.md) and [experiment verification](../../sessions/2026-10-14/experiments/verification.md).
- [Research / Dev Mode verification](../../sessions/2026-10-21/dev-mode.md), using Simulated EEG.

These records describe their dated runs. They do not establish physical-headset operation, intentional EEG control or optical stimulus timing for the whole version. The source checkpoint identifies scope; it is not evidence of a deployment.

See the [version archive](../README.md) for later historical overviews and the [current workspace version](../../../workspace/version.md) for the active release scope.
