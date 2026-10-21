# Data and timing contract — schema v1

All formats represent the same logical tables. UTF-8 CSV with header, consistent RFC-style quoting, decimal point, booleans 0/1, empty field for null, UTC ISO-8601 timestamps. Preserve sufficient floating-point precision for analysis; do not export rounded UI strings. SQLite uses matching types and relationships. Every CSV includes `recording_id` and `participant_id`; include acquisition/calibration/round IDs where applicable. Data dictionary specifies units, null meaning and enumerations. CSV downloads of free-text operator notes must neutralize spreadsheet formula injection without modifying numeric EEG values; document the escaping convention.

## Files / tables

| File | Grain and required values |
| --- | --- |
| `acquisitions.csv` | One row per stream segment: source, board, sample rate, start/end, source recording identifier, replay position mapping |
| `eeg.csv` | One row per received sample: acquisition ID, sample index (unique within acquisition), source timestamp seconds, receipt batch ID, packet counter, ch1–ch8 µV, finite/invalid flags |
| `batches.csv` | Batch ID, sample start/end-exclusive, server receipt wall/monotonic times, received count, continuity flags; do not pretend receipt times are device sample times |
| `signal_windows.csv` | Window ID, acquisition/calibration IDs, sample bounds [start,end), computation time, purpose (baseline/play), combined relative alpha, raw mapped target, smoothed published score, acceptance/rejection and algorithm version |
| `channel_metrics.csv` | Window ID + channel: electrode label, std/peak-to-peak µV, relative alpha, included flag and rejection reason; invalid/excluded spectral values nullable |
| `input_frames.csv` | Exact emitted input sequence, timestamp, source, window ID, score, quality, calibration ID; frame identity uses acquisition ID + sequence |
| `calibrations.csv` | Attempt ID, start/end, sample range, center/scale, accepted/rejected counts, result/error, gate at collection; preexisting flag |
| `game_state.csv` | State sequence at 20 Hz target during play, transition snapshots and start/stop snapshots: game/round ID, browser time, active game time, input frame identity/score and per-game fields below |
| `events.csv` | UUID, producer sequence/ID, type, game/round ID, browser occurrence time, server receipt time, mapped sample estimate and uncertainty, active time, trigger input identity, reason and typed JSON payload |
| `rounds.csv` | Round ID, game, mode, start/end, outcome, partial flags, duration/active time and game summary; zero-progress and abandoned rounds retained |
| `clock_sync.csv` | Browser/server clock sample pairs, RTT, chosen offset, method/version and uncertainty; periodic resync and clock-jump events |
| `display_frames.csv` | Optional high-volume flicker diagnostics: round/event ID, frame sequence/time, intended on/off state and interval; software timing only |
| `metadata.json` | Schema/build/config/source/channel map, initial settings, sink statuses, row counts, completeness and known losses |
| `data_dictionary.md` | Column meanings, units, enums, missing values and timing limitations |

EEG remains full-rate (Cyton typically 250 Hz); signal windows retain actual calculation frequency; game input remains its existing publish rate. A 20 Hz state snapshot is not a substitute for discrete transition events. No EEG rows for score-only synthetic input. Simulated raw EEG and replay must have unmistakable source labels in every relevant table and the UI.

For derived band powers beyond relative alpha, implement/document PSD normalization and units before adding them. Do not label the current unnormalized FFT sums as µV². Per-channel relative alpha must use the existing scoring calculation so diagnostics reproduce the actual aggregate.

## Game-state columns

Common: state sequence, game/round, wall/browser/active times, mode, running/paused/visible, source, input frame ID, used score, usability and reason.

Cairn: simulation seed, stones/tier, angle radians, angular velocity, sway, fall-angle limit, drop-sway limit, focus, unrest, hand phase/progress, current bug/gust ID, kind, strength, direction, path, effect progress, gust load, flicker requested/effective, fallen/cause. Snapshot the actual runtime thresholds, not only defaults.

Garden: growth [0,1], response [0,1], actual growth drive, active seconds, stage, time above baseline, relation-to-baseline, bloom pace, settle-in state/progress, breathing guide phase/enabled, audio requested/effective and volume, reduced motion. Appearance values (leaf opening/glow) may be stored if directly available; do not invent independent measurements from decorative animation.

## Event semantics and time alignment

Browser events use `performance.timeOrigin + performance.now()` plus monotonic time. Keep server wall and monotonic receipt times separately. Estimate browser/server offset from repeated ping/pongs and preserve samples; periodically resync. Estimate mapping to acquired sample indices with a documented method and uncertainty. Bursty host timestamps, USB buffering and clock jumps must remain visible. On ambiguous mapping use null/low confidence, never false precision.

Replay preserves historical source time and current playback/game time separately. Seek, restart and playback-speed changes create mapping segments/events. Do not align historical EEG epochs directly with today's game wall clock.

Every game state/event references the exact input frame used. That frame references its feature window. The UI can then distinguish (a) EEG contributing to the score, (b) newer EEG present at event time, and (c) the displayed game transition. Two-second windows and smoothing introduce history; nearest-time matching alone is insufficient.

Log at authoritative simulation transitions. Use unique event IDs and idempotent persistence; React StrictMode, retries or repeated renders must not double-count a fall or milestone. Record both model event and observed render onset for visual stimuli when available, with separate names. Browser frame timestamps do not prove physical light onset; no photodiode precision claims.

Fall: explicit cause `sway`/`drop`, angle/sway and corresponding thresholds, stone/level, active gust/bug IDs and trigger input frame. Manual reset, EOF, signal rejection, source change and recording interruption are distinct outcomes. Do not use `stress`, `distracted` or a channel number as proven fall causes.

## Completeness and export

Finalization drains queues, commits/flushed sinks, reconciles counts, records last sample/state/event sequences and then marks saved. Both mode checks parity by logical keys and values, not CSV bytes. Export only finalized or explicitly recovered snapshots; active capture uses an explicit stop-and-export action in v1. Export must not mutate source data or silently omit corrupt/truncated tails. Supply row counts, loss indicators and SHA-256 file checksums in a manifest. Tests must demonstrate CSV↔SQLite equivalence and linkage across reconnects.
