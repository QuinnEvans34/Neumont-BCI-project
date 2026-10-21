"""Research recording schema v1: one logical model for CSV, SQLite and the CSV ZIP export.

Every table starts with recording_id and participant_id. Types:
  TEXT, INTEGER, REAL, BOOL (0/1), JSON (text). Free-text columns are marked
  `free` and are neutralized against spreadsheet formula injection when written
  to CSV (a leading = + - @ tab or CR gets a single-quote prefix). Numeric
  values are never altered.
"""
from __future__ import annotations

import json
import math

SCHEMA_VERSION = 1
ALGORITHM_VERSION = 'relative-alpha-v1 (8-<12 Hz / 4-30 Hz Hann FFT power, median of included channels; 2 s windows)'

C = tuple  # (name, type, unit, description, free_text?)

COMMON = [
    ('recording_id', 'TEXT', '', 'UUID of this recording (one visit)'),
    ('participant_id', 'TEXT', '', 'Operator-entered pseudonym; never a name'),
]

CHANNEL_COLS = [(f'ch{i}_uv', 'REAL', 'µV', f'Cyton EEG channel {i} as delivered by BrainFlow; empty if non-finite') for i in range(1, 9)]

TABLES: dict[str, list[tuple]] = {
    'acquisitions': COMMON + [
        ('acquisition_id', 'TEXT', '', 'Existing stream/session UUID; changes on every connect'),
        ('source', 'TEXT', '', 'live | replay | simulated_eeg | synthetic (score only, never EEG rows)'),
        ('source_label', 'TEXT', '', 'Human label shown in the app'),
        ('board', 'TEXT', '', 'BrainFlow board, e.g. CYTON_BOARD, PLAYBACK_FILE_BOARD, simulated'),
        ('sample_rate_hz', 'INTEGER', 'Hz', 'Nominal sample rate'),
        ('channel_count', 'INTEGER', '', 'EEG channels'),
        ('started_wall_s', 'REAL', 's (Unix)', 'Server wall time the segment began (or recording start if partial)'),
        ('ended_wall_s', 'REAL', 's (Unix)', 'Server wall time it ended; empty if still open at stop'),
        ('end_reason', 'TEXT', '', 'Why the segment ended (disconnect, source change, capture_ended …)'),
        ('partial_start', 'BOOL', '', '1 if the stream was already running when recording started'),
        ('first_sample_index', 'INTEGER', 'sample', 'First sample index recorded in this segment'),
        ('replay_file_name', 'TEXT', '', 'Replay file name (no folder path)', True),
        ('replay_file_sha256', 'TEXT', '', 'SHA-256 of the replay file, if available'),
    ],
    'eeg': COMMON + [
        ('acquisition_id', 'TEXT', '', 'Stream segment'),
        ('sample_index', 'INTEGER', 'sample', 'Index within the acquisition (unique per acquisition)'),
        ('source_timestamp_s', 'REAL', 's', 'Source timestamp: host Unix time for live/simulated, original file time for replay'),
        ('batch_id', 'INTEGER', '', 'Receipt batch this sample arrived in'),
        ('packet_counter', 'INTEGER', '', 'Cyton sample counter 0–255 (simulated counters for simulated_eeg)'),
    ] + CHANNEL_COLS + [
        ('all_finite', 'BOOL', '', '1 if all eight channel values are finite'),
        ('nonfinite_channels', 'TEXT', '', 'Semicolon list of channels with NaN/Inf, else empty'),
    ],
    'batches': COMMON + [
        ('acquisition_id', 'TEXT', '', 'Stream segment'),
        ('batch_id', 'INTEGER', '', 'Sequential receipt batch number within the recording'),
        ('sample_start', 'INTEGER', 'sample', 'First sample index in the batch'),
        ('sample_end', 'INTEGER', 'sample', 'End index (exclusive)'),
        ('sample_count', 'INTEGER', 'samples', 'Samples received'),
        ('receipt_wall_s', 'REAL', 's (Unix)', 'Server wall time the SDK read returned; NOT the device sample time'),
        ('receipt_mono_s', 'REAL', 's', 'Server monotonic time of the read'),
        ('discontinuity_count', 'INTEGER', '', 'Samples flagged discontinuous from their predecessor (counter or timestamp)'),
        ('discontinuity_samples', 'TEXT', '', 'Semicolon list of those sample indices'),
        ('after_outage', 'BOOL', '', '1 if more than 2 s passed since the previous batch'),
    ],
    'signal_windows': COMMON + [
        ('acquisition_id', 'TEXT', '', 'Stream segment'),
        ('window_id', 'INTEGER', '', 'Unique within the recording'),
        ('purpose', 'TEXT', '', 'play (rolling feature for the games) | baseline (calibration window)'),
        ('calibration_id', 'TEXT', '', 'Calibration in force (play) or being collected (baseline); empty if none'),
        ('sample_start', 'INTEGER', 'sample', 'Window start [start, end)'),
        ('sample_end', 'INTEGER', 'sample', 'Window end (exclusive)'),
        ('computed_wall_s', 'REAL', 's (Unix)', 'Server wall time of the computation'),
        ('computed_mono_s', 'REAL', 's', 'Server monotonic time of the computation'),
        ('gate_max_ptp_uv', 'REAL', 'µV', 'Peak-to-peak acceptance gate in force'),
        ('relative_alpha', 'REAL', 'ratio', 'Median relative alpha of included channels; empty if rejected'),
        ('accepted', 'BOOL', '', '1 if the window produced a usable feature'),
        ('rejection_reason', 'TEXT', '', 'Why not (channels or continuity); empty if accepted'),
        ('channels_included', 'INTEGER', '', 'Channels contributing to the median'),
        ('mapped_target', 'REAL', '0–1', 'Baseline-mapped target before smoothing (play windows with a baseline)'),
        ('published_score', 'REAL', '0–1', 'Smoothed score after this window (what the next input frame carries)'),
        ('algorithm_version', 'TEXT', '', 'Feature algorithm identifier'),
    ],
    'channel_metrics': COMMON + [
        ('acquisition_id', 'TEXT', '', 'Stream segment'),
        ('window_id', 'INTEGER', '', 'signal_windows.window_id'),
        ('channel', 'INTEGER', '', '1–8'),
        ('electrode', 'TEXT', '', 'Operator electrode label; empty if unknown'),
        ('std_uv', 'REAL', 'µV', 'Standard deviation over the window'),
        ('ptp_uv', 'REAL', 'µV', 'Peak-to-peak over the window'),
        ('relative_alpha', 'REAL', 'ratio', 'This channel\'s relative alpha (same calculation as the score); empty if excluded'),
        ('included', 'BOOL', '', '1 if this channel contributed to the median'),
        ('reason', 'TEXT', '', 'Included, or why excluded'),
    ],
    'input_frames': COMMON + [
        ('acquisition_id', 'TEXT', '', 'Stream segment; frame identity is (acquisition_id, sequence)'),
        ('sequence', 'INTEGER', '', 'Input frame sequence number (protocol v1)'),
        ('emitted_wall_s', 'REAL', 's (Unix)', 'Server wall time the frame state was produced'),
        ('emitted_mono_s', 'REAL', 's', 'Server monotonic time'),
        ('source', 'TEXT', '', 'Source of the frame'),
        ('score', 'REAL', '0–1', 'Exact score carried by the frame'),
        ('quality', 'TEXT', '', 'good | poor'),
        ('calibrated', 'BOOL', '', 'Frame calibrated flag'),
        ('calibration_id', 'TEXT', '', 'Calibration in force'),
        ('window_id', 'INTEGER', '', 'Latest play window behind this score; empty for score-only simulation'),
    ],
    'calibrations': COMMON + [
        ('acquisition_id', 'TEXT', '', 'Stream segment'),
        ('calibration_id', 'TEXT', '', 'New UUID per attempt'),
        ('started_wall_s', 'REAL', 's (Unix)', 'Start (empty if collected before recording)'),
        ('ended_wall_s', 'REAL', 's (Unix)', 'End'),
        ('start_sample', 'INTEGER', 'sample', 'First baseline sample'),
        ('end_sample', 'INTEGER', 'sample', 'End sample (exclusive)'),
        ('center', 'REAL', 'ratio', 'Baseline median relative alpha'),
        ('scale', 'REAL', 'ratio', 'Robust spread (1.4826 × MAD)'),
        ('accepted_windows', 'INTEGER', '', 'Accepted 2 s windows'),
        ('rejected_windows', 'INTEGER', '', 'Rejected 2 s windows'),
        ('result', 'TEXT', '', 'accepted | failed | interrupted | collecting | preexisting'),
        ('error', 'TEXT', '', 'Failure reason'),
        ('gate_max_ptp_uv', 'REAL', 'µV', 'Gate during collection'),
        ('preexisting', 'BOOL', '', '1 if collected before this recording started (snapshot only)'),
    ],
    'game_state': COMMON + [
        ('state_seq', 'INTEGER', '', 'Producer sequence (per browser owner)'),
        ('game', 'TEXT', '', 'cairn | garden'),
        ('round_id', 'TEXT', '', 'Cairn attempt or Garden plant UUID'),
        ('kind', 'TEXT', '', 'snapshot (≈20 Hz while running) | transition | start | stop'),
        ('t_browser_ms', 'REAL', 'ms (epoch)', 'performance.timeOrigin + performance.now()'),
        ('est_server_wall_s', 'REAL', 's (Unix)', 'Browser time mapped to server clock with the latest offset'),
        ('active_s', 'REAL', 's', 'Game active time (model time)'),
        ('mode', 'TEXT', '', 'Cairn calm|go; Garden empty'),
        ('running', 'BOOL', '', 'Model advancing (all gates pass)'),
        ('visible', 'BOOL', '', 'Page visible and game shown'),
        ('source', 'TEXT', '', 'Input source'),
        ('acquisition_id', 'TEXT', '', 'Input frame acquisition'),
        ('input_sequence', 'INTEGER', '', 'Input frame sequence used'),
        ('score', 'REAL', '0–1', 'Score the model used'),
        ('usable', 'BOOL', '', 'Input usable'),
        ('reason', 'TEXT', '', 'Why not running, if paused'),
        ('cairn_seed', 'INTEGER', '', 'Round seed'),
        ('cairn_stones', 'INTEGER', '', 'Stones placed'),
        ('cairn_tier', 'INTEGER', '', 'Level − 1 (every 5 stones)'),
        ('cairn_angle_rad', 'REAL', 'rad', 'Plank tilt'),
        ('cairn_velocity_rad_s', 'REAL', 'rad/s', 'Angular velocity'),
        ('cairn_sway_rad', 'REAL', 'rad', 'Sway envelope'),
        ('cairn_fall_angle_rad', 'REAL', 'rad', 'Runtime topple threshold (tier and gust)'),
        ('cairn_drop_sway_rad', 'REAL', 'rad', 'Runtime Go-mode drop threshold'),
        ('cairn_focus', 'REAL', '0–1', 'Smoothed modeled focus'),
        ('cairn_unrest', 'REAL', '0–1', 'Modeled unrest'),
        ('cairn_hand_phase', 'TEXT', '', 'wait | approach | release | exit'),
        ('cairn_hand_progress', 'REAL', '0–1', 'Hand descent'),
        ('cairn_event_id', 'TEXT', '', 'Active bug/gust id (round_id:index)'),
        ('cairn_event_kind', 'TEXT', '', 'bug | gust'),
        ('cairn_event_strength', 'REAL', '0–1', 'Event strength'),
        ('cairn_event_direction', 'INTEGER', '', '+1 rightward, −1 leftward'),
        ('cairn_event_path', 'TEXT', '', 'ground | air (bugs)'),
        ('cairn_event_progress', 'REAL', '0–1', 'Event time / duration'),
        ('cairn_gust_load', 'REAL', '0–1', 'Current gust load'),
        ('cairn_flicker_requested', 'BOOL', '', 'Operator enabled 15 Hz flicker'),
        ('cairn_flicker_effective', 'BOOL', '', 'Lantern actually blinking now'),
        ('cairn_fallen', 'BOOL', '', 'Cairn has fallen'),
        ('cairn_cause', 'TEXT', '', 'sway | drop'),
        ('garden_growth', 'REAL', '0–1', 'Lasting growth'),
        ('garden_response', 'REAL', '0–1', 'Display response'),
        ('garden_drive', 'REAL', '0–1', 'Growth drive at the score used'),
        ('garden_stage', 'TEXT', '', 'sprout | growing | blooming'),
        ('garden_above_s', 'REAL', 's', 'Active time with score above 0.5'),
        ('garden_relation', 'TEXT', '', 'below | near | above baseline (computed), empty if unknown'),
        ('garden_pace_s', 'REAL', 's', 'Full-signal seconds to bloom'),
        ('garden_settle_state', 'TEXT', '', 'none | settling'),
        ('garden_settle_progress_s', 'REAL', 's', 'Settle-in elapsed'),
        ('garden_guide_enabled', 'BOOL', '', 'Breathing guide on'),
        ('garden_breath_phase', 'TEXT', '', 'in | out (visual guide, not measured respiration)'),
        ('garden_audio_requested', 'BOOL', '', 'Sound switch on'),
        ('garden_audio_effective', 'BOOL', '', 'Audio context running and unmuted'),
        ('garden_volume', 'REAL', '0–1', 'Volume'),
        ('garden_reduced_motion', 'BOOL', '', 'prefers-reduced-motion'),
    ],
    'events': COMMON + [
        ('event_id', 'TEXT', '', 'UUID; idempotent key'),
        ('producer_seq', 'INTEGER', '', 'Producer sequence (browser owner or server)'),
        ('producer', 'TEXT', '', 'browser | server'),
        ('type', 'TEXT', '', 'Event type (see dictionary)'),
        ('game', 'TEXT', '', 'cairn | garden | empty'),
        ('round_id', 'TEXT', '', 'Round, if any'),
        ('t_browser_ms', 'REAL', 'ms (epoch)', 'Browser occurrence time (model step / frame callback); empty for server events'),
        ('server_wall_s', 'REAL', 's (Unix)', 'Server receipt (or occurrence for server events)'),
        ('server_mono_s', 'REAL', 's', 'Server monotonic receipt'),
        ('est_server_wall_s', 'REAL', 's (Unix)', 'Occurrence mapped to server clock'),
        ('acquisition_id', 'TEXT', '', 'Acquisition at the time'),
        ('sample_estimate', 'INTEGER', 'sample', 'Estimated EEG sample index at occurrence; empty if unknown'),
        ('sample_uncertainty_ms', 'REAL', 'ms', 'Alignment uncertainty; empty if unknown'),
        ('alignment_method', 'TEXT', '', 'How the sample was estimated'),
        ('active_s', 'REAL', 's', 'Game active time at the event'),
        ('input_acquisition_id', 'TEXT', '', 'Acquisition of the input frame used'),
        ('input_sequence', 'INTEGER', '', 'Input frame sequence used at the event'),
        ('reason', 'TEXT', '', 'Reason / note', True),
        ('payload_json', 'JSON', '', 'Typed event details'),
    ],
    'rounds': COMMON + [
        ('round_id', 'TEXT', '', 'UUID'),
        ('game', 'TEXT', '', 'cairn | garden'),
        ('mode', 'TEXT', '', 'Cairn mode; empty for Garden'),
        ('started_browser_ms', 'REAL', 'ms (epoch)', 'Round start'),
        ('ended_browser_ms', 'REAL', 'ms (epoch)', 'Round end; empty if capture ended first'),
        ('outcome', 'TEXT', '', 'Cairn: fell_sway | fell_drop | reset | mode_change | session_change | capture_ended; Garden: replaced | reset | capture_ended'),
        ('partial_start', 'BOOL', '', '1 if the round began before recording'),
        ('duration_s', 'REAL', 's', 'Browser wall duration'),
        ('active_s', 'REAL', 's', 'Model active time'),
        ('summary_json', 'JSON', '', 'Game summary (stones, growth, stage times …)'),
    ],
    'clock_sync': COMMON + [
        ('sync_seq', 'INTEGER', '', 'Sequence'),
        ('t_browser_ms', 'REAL', 'ms (epoch)', 'Browser time of the estimate'),
        ('offset_ms', 'REAL', 'ms', 'Server wall − browser time, from the lowest-RTT ping'),
        ('rtt_ms', 'REAL', 'ms', 'Round-trip time of that ping'),
        ('samples', 'INTEGER', '', 'Pings used'),
        ('spread_ms', 'REAL', 'ms', 'Spread of offsets across pings'),
        ('method', 'TEXT', '', 'Estimation method'),
    ],
}

# Table order for exports and dictionaries.
ORDER = ['acquisitions', 'calibrations', 'batches', 'eeg', 'signal_windows', 'channel_metrics',
         'input_frames', 'rounds', 'events', 'game_state', 'clock_sync']


def columns(table):
    return [c[0] for c in TABLES[table]]


def col_types(table):
    return [c[1] for c in TABLES[table]]


def free_flags(table):
    return [len(c) > 4 and bool(c[4]) for c in TABLES[table]]


FORMULA_START = ('=', '+', '-', '@', '\t', '\r')


def fmt(value, typ, free=False):
    """Canonical CSV text for one value. Identical for CSV writing and SQLite export."""
    if value is None:
        return ''
    if typ == 'BOOL':
        return '1' if value else '0'
    if typ == 'INTEGER':
        return str(int(value))
    if typ == 'REAL':
        v = float(value)
        if not math.isfinite(v):
            return ''
        return repr(v)
    if typ == 'JSON':
        s = value if isinstance(value, str) else json.dumps(value, separators=(',', ':'), allow_nan=False)
    else:
        s = str(value)
    if free and s.startswith(FORMULA_START):
        s = "'" + s
    if any(ch in s for ch in ',"\n\r'):
        s = '"' + s.replace('"', '""') + '"'
    return s


def row_line(table, row, types=None, frees=None):
    types = types or col_types(table)
    frees = frees or free_flags(table)
    return ','.join(fmt(v, t, f) for v, t, f in zip(row, types, frees))


def header(table):
    return ','.join(columns(table))


def sqlite_type(t):
    return {'TEXT': 'TEXT', 'JSON': 'TEXT', 'INTEGER': 'INTEGER', 'BOOL': 'INTEGER', 'REAL': 'REAL'}[t]


def ddl(table):
    cols = ', '.join(f'"{n}" {sqlite_type(t)}' for n, t, *_ in TABLES[table])
    return f'CREATE TABLE IF NOT EXISTS "{table}" ({cols})'


def data_dictionary():
    lines = [
        f'# Research recording data dictionary (schema v{SCHEMA_VERSION})', '',
        'All files are UTF-8 CSV with a header row. Empty field = null/unknown. Booleans are 0/1. '
        'Timestamps: `*_wall_s` are Unix seconds on the server (the computer running Python); '
        '`*_mono_s` are server monotonic seconds; `t_browser_ms` is the page\'s performance clock on the epoch scale. '
        'Numbers are written at full double precision. Free-text columns marked (free) are prefixed with a single quote '
        'if they begin with = + - @ (spreadsheet formula protection); numbers are never altered.', '',
        '## Timing limitations', '',
        '- Receipt times are when the SDK read returned, not when the headset sampled. Live Cyton host timestamps are '
        'bursty (USB buffering). Replay keeps the original file timestamps, so align replay data by sample index or '
        'batch receipt time, never by today\'s wall clock.',
        '- Browser event times are software times (model steps and animation-frame callbacks). Optical onset is not '
        'measured (no photodiode). Events are mapped to EEG samples with the stated method and uncertainty; empty '
        'means unknown.',
        '- Each game event references the input frame the game was using; that frame references the play window '
        '(2 s of EEG, recomputed every ~250 ms) whose smoothed score it carried. Smoothing (0.8/0.2) and the 2 s '
        'window mean a score reflects several seconds of history.', '',
        '## Joining', '',
        '`events.input_acquisition_id + input_sequence` → `input_frames (acquisition_id, sequence)` → `window_id` → '
        '`signal_windows.window_id` → `channel_metrics.window_id` and raw `eeg` rows with the same `acquisition_id` and '
        '`sample_index` in [sample_start, sample_end).', '',
    ]
    for t in ORDER:
        lines += [f'## {t}.csv', '', '| Column | Type | Unit | Meaning |', '| --- | --- | --- | --- |']
        for c in TABLES[t]:
            name, typ, unit, desc = c[:4]
            lines.append(f'| `{name}` | {typ}{" (free)" if len(c) > 4 and c[4] else ""} | {unit} | {desc} |')
        lines.append('')
    lines += EVENT_DOC
    return '\n'.join(lines) + '\n'


EVENT_DOC = [
    '## Event types', '',
    'Free-text cells (events.reason, acquisitions.replay_file_name) that start with = + - @ tab or CR are prefixed with an',
    "apostrophe in CSV (spreadsheet formula protection); JSON payload cells always start with {. Numeric columns are never altered.", '',
    '| Type | Producer | Meaning |', '| --- | --- | --- |',
    '| recording_started / recording_stopped | server | Capture lifecycle (reason = how it ended) |',
    '| stop_requested | browser | Operator pressed Stop & save (sent before the stop request) |',
    '| acquisition_started / acquisition_ended | server | Stream segment boundaries (connect, disconnect, source change, reconnect) |',
    '| calibration_started / calibration_ended | server | Baseline attempts (result accepted, failed or interrupted in payload) |',
    '| gate_changed | server | Peak-to-peak gate moved (old/new µV) |',
    '| sequence_gap | server | Browser items missing between two sequence numbers |',
    '| clock_jump | server | A used clock sync moved the browser/server offset by more than max(20 ms, its RTT); events before and after use different offsets |',
    '| marker | browser | Operator marker (note in reason; "shortcut" for Alt+M) |',
    '| owner_visibility | browser | Recording tab hidden/visible (games pause when hidden; capture continues) |',
    '| game_switched | browser | Selected game or page changed in the recording tab |',
    '| round_started / round_paused / round_resumed / round_ended / round_progress | browser | Round lifecycle. round_started payload has settings, seed and rules; partial_start = round was already under way when capture began. round_paused.reason: paused_by_user, tab_hidden, left_game, input_unusable, session_changed. round_ended.reason is the outcome: fell_sway, fell_drop, reset, mode_change, session_change, recalibration, new_plant, settle_aborted. Rounds still open at stop get outcome capture_ended in rounds.csv |',
    '| stone_released / stone_placed / level_changed | browser (Cairn model step) | Hand release at the top, stone count increase, level change every 5 stones (thresholds in payload) |',
    '| bug_started / bug_ended / gust_started / gust_ended | browser (Cairn model step) | Seeded effects with effect_id, strength, direction, path, duration, forced flag. ended reason: completed, cairn_fell, or the round outcome that interrupted it |',
    '| flicker_setting_changed / flicker_started / flicker_ended | browser | 15 Hz lantern flicker requested setting, and actual blinking stretches (frame-callback times; optical onset unverified). ended reason: bug_ended, paused, setting_off, reduced_motion, cairn_fell, round_reset, round_ended |',
    '| cairn_fell | browser (Cairn model step) | Fall: cause sway or drop, tilt/sway and both thresholds at that step, active effect, trigger input frame. Mechanics only, not a cause in the participant |',
    '| plant_started / plant_ended / plant_paused / plant_resumed | browser | Garden plant lifecycle (plant_ended payload has the plant summary) |',
    '| settle_started / settle_phase_changed / settle_completed / settle_interrupted | browser | Settle-in intro; interrupted reason skipped_by_user (plant follows) or why it was abandoned |',
    '| growth_started / growth_stopped | browser (Garden model gate) | Growth drive became non-zero / stopped. stopped reason: score_at_or_below_baseline, full_growth, input_unusable, paused_by_user, tab_hidden, left_game, session_changed, or a reset reason |',
    '| stage_changed / full_bloom | browser (Garden model step) | Stage crossing (sprout, growing, blooming) and growth reaching 1 (a milestone; capture continues) |',
    '| relation_changed | browser | Displayed relative-alpha vs baseline relation changed (computed relation, not an emotional state) |',
    '| pace_changed / breathing_guide_changed / breath_phase_changed / audio_setting_changed / audio_effective_changed / reduced_motion_changed / settle_in_setting_changed / target_minutes_changed | browser | Garden settings (old/new values) and effective states. breath_phase_changed is the visual guide, never measured respiration. audio_effective_changed.reason: playing, off, paused, muted_by_experiment, blocked_or_suspended_by_browser |',
    '',
]
