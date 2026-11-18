# Cairn wind controls validation

Prepared 2026-11-18 for `codex/cairn-wind-controls`, version `0.2.0`, based on fetched `origin/main` (`0.1.2`). Pull request review is pending.

## Scope

Added independent wind-off and threshold-only checkboxes beside Cairn's firefly toggle. Both default off and persist per browser. Wind-off takes priority. Threshold-only retains gust pushes and visuals but disables gust reductions to both tumble limits. Settings apply immediately without restarting the round. Seeded event timing continues while wind is disabled.

Research schema 3 adds two trailing game-state columns, initial settings in `round_started` (including partial starts), and timestamped `wind_setting_changed` events with old/new values and transition snapshots, including while paused. Recorded thresholds use the same effective load as the model/UI. Legacy CSV and SQLite game states remain readable and exports retain their original columns.

## Automated verification

- `npm test`: 98 passed, including all four combinations, defaults/storage migration, ambient/gust force suppression, gust visuals' envelope remaining active in threshold-only mode, both fall/landing limits, paused changes, partial recording starts and effective recorded thresholds.
- `npm run build`: passed (existing large-bundle advisory).
- New backend recording tests exercise CSV, SQLite, Both, ZIP settings/events and legacy game-state access.
- `npm run version:check` and `npm run version:check-main`: passed for `0.2.0` relative to fetched `origin/main`; outgoing `0.1.2` overview and prior archives retained.
- Full backend suite: 114 tests, four errors matching the previously documented Windows limitations: symlink privilege, crash-recovery CSV file lock, SQLite parity-test cleanup lock, and the old channel-metrics CSV reader test. No new wind test errors in this run. See the earlier [release notes](../../logs/releases.md#release-history).

The frontend test loader required execution outside the restricted sandbox because Node's Windows user-info lookup failed inside it. The browser preview host was unavailable, so an in-browser visual check/screenshot could not be completed. No hardware or participant EEG was used.

## Manual acceptance

1. Restart the backend and frontend, connect a simulation, open Cairn, and verify both wind boxes are initially unchecked in a fresh browser profile.
2. Start a research recording. Play with normal wind, then enable threshold-only during a gust: streaks/leaves and pushes remain while both threshold markers return to the level's normal limits.
3. Enable wind-off: wind particles clear immediately and wind adds no force or threshold reduction. Toggle the second box while wind-off remains on; wind stays off. Turn both off to restore normal behavior.
4. Pause and change either setting, then resume. Export CSV/SQLite/ZIP and inspect `wind_setting_changed`, `round_started`, `cairn_wind_off`, `cairn_wind_threshold_off`, and effective thresholds. Start a second recording mid-round to verify its partial-start settings.
5. For repeatable forced gusts without a backend, use `/?cairn-preview&input=slider&score=0.8`, the two wind controls and the Gust button.
