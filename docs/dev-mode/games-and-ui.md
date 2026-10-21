# Game instrumentation and operator UI

## Shared controls

Add a persistent Research / Dev Mode toggle near the app header. Enabling the panel does not start recording, change a source or trigger stimulation. Recording controls live above the game-page switch so changing pages cannot discard an active recording.

Setup: participant pseudonym, optional structured condition label, channel/electrode map and reference (unknown allowed), format CSV/SQLite/Both, registered destination and Add destination path control. Show source and whether raw EEG is available. Validate destination before starting. Settings persist for convenience except participant identity must be visibly confirmed for each recording; it must never be silently inherited for a new participant.

Persistent bar: participant, shortened recording ID, format/destination, duration, receiving rate, samples written, unsaved queue count, event acknowledgements and state. Controls: Start, Add marker, Stop & save, Review, Download ZIP. Separate badges for EEG receiving, signal usable, and recording healthy. State labels distinguish recording, waiting for EEG, saving, saved, incomplete and failed. Do not show 'saved' from a successful enqueue.

Participant/source/format/destination changes cannot silently mix records. Participant/format/destination require ending the recording; source reconnect may remain in it as a new acquisition segment. Clearly log gate and game-setting changes during capture.

## Shared live diagnostics

- Eight waveforms with labeled units, optional autoscale clearly indicated, and common time axis. UI uses decimated data; persistence stays full-rate.
- Per-channel inclusion, flat/nonfinite/high-amplitude flags, std/peak-to-peak and relative alpha. Show the actual gate threshold and which channels contribute to the median.
- Feature → baseline → mapped target → smoothed score → game response. Display the feature window range and latest frame age.
- Event timeline and operator marker shortcut that does not intercept typing or gameplay controls.
- Delivery/storage panel: packet continuity, stale samples, event backlog, writer failures and measured UI frame intervals.
- Optional timing diagnostics during flicker; off by default. Turning diagnostics on never enables flicker.

Color describes measured quality, not mental state. 'High amplitude; excluded' is appropriate; 'this electrode caused stress' is not. Game effects and recording health remain legible on narrow screens; collapse diagnostics without stopping capture. Rendering must not block game timing or raw data acquisition.

## Cairn instrumentation

Keep Ted's round/flicker history and preview usable; research logging is a separate durable history without their 100-round/1000-stimulus limits.

Capture `round_started`, `round_paused`, `round_resumed`, `round_ended`, `stone_released`, `stone_placed`, `level_changed`, `bug_started`, `bug_ended`, `gust_started`, `gust_ended`, `flicker_setting_changed`, `flicker_started`, `flicker_ended`, `cairn_fell`, `hand_phase_changed`, `steadiness_changed`, `gust_peak_reached`, `gust_easing`, `tumble_started` and `tumble_settled`. Bug events carry the flicker rate (`flicker_hz`) and, at the end, how long the lantern actually blinked. Use shared lifecycle events where possible. Every effect has an ID, start/end, direction/path and strength. End reasons distinguish natural completion from pause/fall/reset interruption. Record nonflashing bugs too. Simulation time and render time must not be conflated.

Instrument simulation transitions within the Phaser update path; do not poll React state to discover events. A render tick may contain several physics substeps and more than one transition. Capture all transitions once. Include seed and configuration at round start; capture externally forced debug effects and their parameters. Cosmetic particles need not have individual rows. Do not promise deterministic pixel replay when decorative randomness remains.

**Fall inspector:** select a round/fall; show 15 s before and 5 s after where available. Recording continues after a fall to acquire the post-event interval, but immediate Stop must not be delayed; label truncated coverage. Overlay EEG, accepted channel metrics, feature/score, sway and current threshold, stones and effect intervals. Link the fall to its actual trigger frame/window. Show 'sway exceeded threshold' or 'stone landed while sway exceeded drop threshold', plus contemporaneous context. Do not infer a causal channel or distraction from temporal overlap.

## Garden instrumentation

Use a round ID for each plant. Existing plant log is retained; record plants with no growth and aborted settle-in periods too. Full bloom is a milestone, not automatic recording termination. Read the actual runtime settle-in duration (currently 34 s), pace bounds and stages; do not duplicate stale comments as constants.

Capture `plant_started`, `settle_started`, `settle_phase_changed`, `settle_completed`, `settle_interrupted`, `plant_paused`, `plant_resumed`, `growth_started`, `growth_stopped`, `stage_changed`, `full_bloom`, `plant_ended`, `pace_changed`, `breathing_guide_changed`, `breath_phase_changed`, `audio_setting_changed`, `audio_effective_changed`, and `reduced_motion_changed`.

- Growth start/stop uses the actual nonzero drive/running transition, not visible leaf animation. Timestamp transitions at the model step. Avoid flooding with per-frame 'growing' events; repeated transitions remain identifiable and countable.
- Log stage crossings once, including multiple crossings in one update if ever possible. Full bloom distinguishes reaching growth 1 from crossing an earlier blooming stage.
- Log baseline-relation changes when the displayed relation changes, and retain the source feature/window. This is a computed relation, not a verified emotional state.
- Breathing phase changes are visual-guide events, never measured respiration. Requested versus effective audio distinguishes autoplay blocking, muted experiments and paused playback.
- Pace, sound/volume, guide, reduced motion and reset changes have old/new values and effective time. Do not assume decorative fireflies in Garden have Cairn's physical or flicker semantics.
- On leaving Garden, capture pause/plant lifecycle according to existing behavior; do not accidentally create a new plant merely by returning.

**Garden inspector:** select a plant or milestone, inspect the same synchronized charts around growth start/stop, stage change, full bloom, rejected signal or reset. Add growth/response/drive, stage, pace, breathing phase and effective sound tracks. Explain 'growth paused because input was unusable' versus 'no growth because score was at/below baseline' versus user pause/full growth. Provide a plant summary with active time, stage times, time above baseline, mean used score and configuration changes; full recording remains exportable.

## History and review

List recordings across destinations by participant, date, source, games, duration, status and format. Review reads persisted data, not only in-memory browser history. Paginate/time-window API reads; do not load an entire hour of EEG into the browser. Show missing destination or partial export explicitly. Provide individual CSV and full ZIP download after finalization, with the manifest and dictionary included. Shared exports exclude local absolute paths.

Use neutral wording: signal, relative alpha, quality, modeled focus/response, game thresholds. These screens describe software and recorded observations; they do not diagnose stress or relaxation.
