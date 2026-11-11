# Research / Dev Mode: operating guide

Implemented October 21, 2026, for **Cairn** and **Glowing Garden**. Verified only with Simulated EEG and synthetic fixtures (see [verification.md](verification.md)); not yet run with a headset.

## Start the app

Two terminals, from the repository root:

```sh
# 1. Backend (Python 3.10+)
source .venv/bin/activate              # after the one-time setup in the main README
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000

# 2. Frontend (Node 20.19+)
npm run dev
```

Open http://127.0.0.1:5173 on the computer running the backend.

Recordings go to `data/research/` (ignored by Git). To use another default folder, start the backend with `BCI_RESEARCH_DIR=/absolute/path`.

## Record a session

1. Turn on the **Research / Dev Mode** switch in the header. This only shows the recording bar. It does not start recording, change the source or start any flicker.
2. Click **Start…** in the recording bar and fill in the setup:
   - **Participant ID** is generated automatically when setup opens, so you can start without typing. **New participant** generates another anonymous ID; **Use previous** reuses the last recorded participant for repeat runs. You can also edit the ID. There is no extra confirmation checkbox. Storage, condition and electrode settings are remembered; unknown electrode positions may stay blank.
   - **Condition** (optional): a short label.
   - **Electrode map and reference**: leave a box blank if unknown.
   - **Storage format**: **CSV** (default), **SQLite** or **Both**.
   - **Save on this computer to**: a registered destination. The backend checks that it can write there (**Check folder**). **Add destination** registers an existing absolute folder. It works only from the app on the backend computer, and folders inside the repository (other than the ignored `data/`) are refused.
3. Click **Start recording**. You can start before connecting or calibrating, so the connection and baseline are captured too.
4. Continue as usual: Connect → Calibrate → Choose → Play Cairn and/or Garden. Switching games, pausing, recalibrating and reconnecting all stay inside the same recording. A reconnect becomes a new acquisition segment.
5. **Add marker** (with an optional note), or press **Alt+M** (⌥M on a Mac) while no text field is focused, to mark a moment such as an electrode adjustment.
6. Click **Stop & save**. The bar shows **Saving…** while the writer drains, then **Saved**. "Saved" appears only after the files are finalized, never when data is merely queued.

### What the bar shows

- **Participant, short recording ID, format and destination.**
- **Duration, measured sample rate, and samples written** (and how many are already on disk).
- **Unsaved items** waiting in the backend writer and in the browser queue, and how many browser items the backend has acknowledged.
- **Three separate badges:** EEG receiving, signal usable by the games, and recording healthy.
- **State:** Recording · waiting for EEG · Saving… · Saved · Incomplete · Failed.

If the recording tab closes or stops sending its heartbeat for 5 seconds, the backend finalizes the recording as **incomplete** and keeps everything already written. Other tabs show the recording read-only.

Research recording and the Bilateral/SSVEP experiments cannot run at the same time. Each one refuses to start while the other is recording, and explains why.

## Download and share

**The backend folder and the browser download are different places:**

- **The backend folder** is the destination you chose, on the computer running Python. It holds the working recording, one UUID folder per recording.
- **Download ZIP** (in the bar after Stop & save, or in **Review**) is a separate copy saved by the browser, usually to Downloads. Attach that ZIP to Teams by hand. Nothing is uploaded automatically.

Every format exports the same CSV ZIP. It contains:

- 11 CSV tables;
- `metadata.json`, with schema, build, channel map, settings, counts, losses and completeness;
- `data_dictionary.md`, with columns, units, enums, event types and timing limits;
- `manifest.json`, with row counts, SHA-256 checksums and whether a torn last line was dropped.

Shared exports contain no local folder paths. They do contain pseudonymous participant EEG, so share them only where participant data is allowed.

**Review** lists every recording across all destinations. For each one it shows participant, start time, duration, source, games, format, destination and status, and it flags destinations that are missing or unavailable. Opening a recording offers:

- the full ZIP;
- each table as its own CSV;
- for SQLite or Both recordings, the `.sqlite` database;
- a round list;
- inspectors.

## Inspectors

- **Cairn fall inspector** covers 15 s before the fall to 5 s after, with partial coverage labeled.
  - **Explanation:** the fall cause in plain mechanics ("Tilt exceeded the topple threshold" / "A stone landed while sway exceeded the drop threshold") with both thresholds, the active firefly or gust, and the exact input frame and signal window behind it.
  - **Tracks:** score and mapped target, relative alpha, accepted channels, sway against both thresholds with firefly, gust and flicker shading, stones, modeled focus and unrest, and 8 EEG channels.
- **Garden inspector** covers a plant summary or any milestone: growth start/stop, stage change, full bloom, pause, settle-in or marker.
  - **Explanation:** why growth stopped (score at or below baseline, input unusable, user pause, full growth).
  - **Tracks:** growth, response and drive, stage, breathing-guide phase and effective sound, plus the shared signal tracks and EEG.

The wording is deliberately neutral. These screens show game mechanics and recorded signals, and a match in time is not a cause. The breathing guide is a visual cue, not measured breathing.

## Analysis example: from a fall to the raw samples

```python
import pandas as pd, json
d = 'research-P012-2026-10-21-1a2b3c4d'          # unzipped folder
ev  = pd.read_csv(f'{d}/events.csv')
fr  = pd.read_csv(f'{d}/input_frames.csv')
win = pd.read_csv(f'{d}/signal_windows.csv')
met = pd.read_csv(f'{d}/channel_metrics.csv')
eeg = pd.read_csv(f'{d}/eeg.csv')

fall = ev[ev.type == 'cairn_fell'].iloc[0]
print(json.loads(fall.payload_json)['explanation'])

# 1. The input frame the game was using at the fall
frame = fr[(fr.acquisition_id == fall.input_acquisition_id) & (fr.sequence == fall.input_sequence)].iloc[0]
# 2. The 2-second window that produced that frame's score
w = win[(win.acquisition_id == frame.acquisition_id) & (win.window_id == frame.window_id)].iloc[0]
# 3. Per-channel metrics for that window (which channels were in the median, and why not)
print(met[(met.acquisition_id == w.acquisition_id) & (met.window_id == w.window_id)][['channel', 'electrode', 'ptp_uv', 'relative_alpha', 'included', 'reason']])
# 4. The raw samples behind it: sample_start (inclusive) to sample_end (exclusive)
raw = eeg[(eeg.acquisition_id == w.acquisition_id) & eeg.sample_index.between(w.sample_start, w.sample_end - 1)]
# 5. Samples recorded around the event itself (estimated sample index ± uncertainty)
near = eeg[(eeg.acquisition_id == fall.acquisition_id) & (abs(eeg.sample_index - fall.sample_estimate) < 250)]
```

Garden milestones work the same way: `events.type == 'full_bloom'` or `'stage_changed'`, then frame → window → metrics → samples. `game_state.csv` holds the ~20 Hz state of the round (`round_id`) on the same `est_server_wall_s` time base.

To sanity-check a ZIP (row counts, checksums, sample continuity, linkage): `python tools/research/check_export.py research-….zip`.

## Timing, in brief

- **Browser event times** are `performance.timeOrigin + performance.now()` at the model step or frame callback. They are mapped to server time with a ping/pong clock offset, re-measured every 30 s. A sync measured while the machine was busy (round-trip more than 3× the best seen) is logged in `clock_sync.csv` but not used.
- **`sample_estimate` and `sample_uncertainty_ms`** come from the source timestamps of the last 10 s of EEG (live and simulated sources). Replay uses batch arrival time with ±300 ms.
- **Flicker times** are frame-callback times. Optical onset is unverified (no photodiode).
- **The game's input is the frame it last processed** (`input_sequence`). Under heavy load, the browser can process frames late. The fall inspector reports how old that frame was.

## Development-only switch

In `npm run dev` builds, `?cairn-time-scale=N` (1–20) runs the Cairn model faster for automated checks. The scale is written into every `round_started` payload, and production builds ignore it. Do not use it with participants.


## November 11 experiment setup (signal update)

The four signal/setup changes from the professor's slide are implemented. The wind,
latency, difficulty and new distraction proposals are not part of this update.

1. Restart the backend after updating; refresh the browser.
2. Check the actual CH1–CH8 wiring against electrode locations. The 10–20 diagram
   labels positions, not Cyton channels. Do not assume CH7/8 = O1/O2 without checking.
3. If using OpenBCI GUI for impedance, finish and disable impedance testing, then
   close its acquisition session before connecting this app.
4. Start a research recording before calibration; reuse the participant ID for the
   same person, and fill the electrode map and condition where known.
5. Connect and open Calibrate. Check raw per-channel 60 Hz hum and compare sensors.
   A high value is a reason to check contact/reference/bias, not a measured impedance
   or a universal pass/fail threshold.
6. Select the confirmed back/side channels and click **Apply scoring channels**.
   Forehead channels can still be recorded while excluded from the game score.
   Live baseline collection is blocked until a selection is applied. Selection lasts
   for this backend process; confirm it again after restart or rewiring.
7. Leave **Filtered noise limit** at 150 µV initially. This means peak-to-peak over
   each two-second filtered window, not RMS or absolute voltage. Compare quiet,
   blink, jaw movement and head movement segments using recording markers.
8. Collect a fresh baseline, then play. Changing channel selection or the limit
   invalidates the baseline and stops calibrated input until recalibration.
9. Stop & save, download ZIP, and inspect channel_metrics.csv: selected, included,
   reason, filtered std_uv/ptp_uv, raw_ptp_uv, and raw hum_rms_uv. eeg.csv remains raw.

Processing v2 uses BrainFlow order-2 zero-phase Butterworth bandstop 58–62 Hz
followed by bandpass 1–40 Hz on each mean-centered two-second window, with one-second
reflection padding at both ends. Baseline and play use exactly the same function.
There is no filter state shared across gaps. These are window estimates, not a
continuous filtered trace; boundary transients can still reject strongly noisy
windows. A 60 Hz sine with 100 µV peak plus 20 µV alpha is covered by regression
checks; this is not a guarantee for every headset trace. Raw nonfinite/near-rail
signals and filtered flatlines remain excluded. The raw near-rail check assumes
Cyton's standard gain-24 input range.

Hum is RMS from raw Hann-window PSD integrated over 59–61 Hz. The displayed raw
waveform is not the waveform used for the filtered amplitude gate. The UI does not
claim contact is good simply because the notch suppresses interference.

New recordings use schema 2 and include processing settings in metadata.json.
Older schema-1 recordings remain readable/exportable; their std_uv and ptp_uv
measure RAW data and must not be compared as if they were filtered metrics.
The relative-alpha feature is an experimental input, not a validated stress score.
Hardware verification of this processing update is still needed at the meeting.


### Electrode check panel

Calibrate now opens with eight channel cards before the baseline controls. The
cards distinguish missing/stale samples, sample gaps, invalid/flat/saturated
signals, large filtered fluctuations, and raw mains interference. Channels that
are not selected for scoring still receive the same screening. Replay and
simulated EEG are explicitly labeled and do not verify physical headset contact.

“Within signal limits” means the current two-second window passes these advisory
checks; it is not proof of electrode contact or a completed impedance measurement.
Raw hum at or above 10 µV RMS triggers a provisional display advisory by default.
The threshold can be changed under “What the checks mean & how to troubleshoot”
(5/10/20/50 µV RMS). It changes only this panel, not scoring, gating, or recordings.
Sit still, adjust one electrode gently, and watch readings settle before baseline.
