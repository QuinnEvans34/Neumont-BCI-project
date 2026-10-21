## Local review on the Mac — October 21, 2026

Reviewed before publication. Verdict: suitable for a supervised meeting pilot,
not yet validated for headset research results.

- Frontend: 67 tests pass; production build passes with the existing bundle warning.
- Backend: 85 tests pass on the local Python 3.14 environment. A ResourceWarning
  comes from the test-owned SQLite connection in the CSV-parity test; the suite passes.
- Independent HTTP smoke test on an isolated backend and temporary storage:
  Simulated EEG → recording → marker → stop → CSV ZIP, in CSV, SQLite and Both.
  Exports contained 465, 483 and 510 acquired samples respectively and passed
  `tools/research/check_export.py` (counts, checksums and applicable schema/linkage checks).
  These short tests did not exercise a browser game or a full calibration.
- Fixed Mac symlink normalization for destination checkout confinement.
- Stop now reports unsent browser-item counts; those and existing sequence losses
  mark recordings incomplete instead of claiming a complete capture.
- Browser requests have timeouts; late acknowledgements cannot remove a newer
  recording's queued events.
- Games reject input frames whose server timestamp is over two seconds old even
  when a queued frame was only just processed. This addresses the stale-frame
  limitation described in the original report below. Assumes the local backend
  and browser share the machine clock; badly skewed clocks fail closed.
- Fresh browser verification was blocked by the browser tool's URL security policy.
  The earlier cloud-browser results below are Claude's report, not a repeated local test.
- No live headset or optical timing test was performed in this review.

For the meeting: use CSV/default local folder first, a participant pseudonym, and
an operator watching capture health. Start before calibration; play a short round
of each game, Stop & save, and inspect the first downloaded ZIP before collecting
longer sessions. Treat incomplete recordings as diagnostic data, not complete trials.

---

# Research / Dev Mode: verification

October 21, 2026. Everything below was run in a cloud Linux container:

- 2 vCPU Xeon 2.8 GHz, 8 GB RAM;
- Python 3.13 with the repository `.venv`, Node 22;
- Playwright 1.49.1 driving headless Chromium 141 with software rendering.

**No headset, replay of a real person, or photodiode was used.** Live Cyton behavior, real electrode data and optical flicker timing are **unverified**.

## Automated tests

| Command | Result |
| --- | --- |
| `python -m unittest discover -s backend -p "test*.py"` | **84 tests OK**. 15 new in `backend/test_research.py`; the 69 existing tests are unchanged and pass. |
| `npm test` | **66 tests pass, 0 fail**. 11 new in `tests/research.test.ts`; the existing game and experiment tests are unchanged. |
| `npm run build` (`tsc --noEmit` + Vite) | Passes. Only the existing >500 kB chunk-size warning remains. |

**Backend (`test_research.py`):**

- **Samples:**
  - Every sample is stored exactly once across varied chunk sizes.
  - NaN and Inf are kept, with flags.
  - Radio breaks are flagged, never filled.
- **Linkage:**
  - Windows, frames and calibration match the live computation.
  - The median of the stored per-channel relative alpha equals the feature.
- **Formats:**
  - CSV, SQLite and Both produce identical logical rows and an identical CSV ZIP.
  - The SQLite→CSV export is byte-identical.
  - Formula escaping and Unicode are handled.
  - No paths appear in exports.
- **Browser items:**
  - Items are idempotent, and retries are deduplicated.
  - Sequence gaps are logged.
  - Open rounds become `capture_ended`.
- **Lifecycle:**
  - A reconnect produces distinct acquisitions.
  - Owner loss (5 s) finalizes as incomplete.
  - Queue overflow → incomplete; disk error → failed.
- **Crash recovery:**
  - Recovered recordings are never marked complete.
  - A torn tail is dropped and flagged.
  - The open acquisition row is rebuilt.
- **Sources:**
  - Score-only simulation writes no EEG rows.
  - Simulated EEG is labelled in every table.
- **Destinations:**
  - Relative paths, missing folders, paths inside the repo, symlink duplicates and traversal are rejected.
  - A removed drive is reported.
  - History lists recordings across two destinations.
- **API:**
  - Mutual exclusion with experiments.
  - Add destination works only from localhost.
  - Export is refused while recording.
  - The stop token is checked.
  - A traversal request returns 404.
- **Clock:**
  - A busy-machine clock sync (RTT ≫ best) is logged but not used.
  - A `clock_jump` event is raised.
  - The review window includes the (older) frame an event actually used.
  - Per-table CSV download works.

**Frontend (`research.test.ts`):**

- **Cairn trace:**
  - Each stone, level change and effect start/end is logged exactly once.
  - A fall is logged with both thresholds and the trigger frame, and the round ends exactly once.
  - A reset or mode change ends the round and its effect with that reason.
  - Forced effects are flagged.
  - Pause and resume are idempotent (StrictMode).
  - A recording that starts mid-round gives `partial_start`.
  - Flicker stretches pair up and close when the round ends.
- **Garden trace:**
  - Settle-in, plant, stages and full bloom are each logged once.
  - Growth stops carry reasons (baseline, full growth, unusable input).
  - An aborted settle-in is its own round.
  - Breath, audio and settings are logged only on change, with old and new values.
- **Shared:**
  - The tick-blocker reasons are correct.
  - The logger keeps items until they are acknowledged and retries them in order.

## Browser flows (Simulated EEG)

Each run does the following:

1. Turns on Dev Mode and checks that nothing started (no recording, same session, no experiment).
2. Fills in setup: participant, confirmation, condition, 8 electrodes and a reference, format, destination, write probe.
3. Starts recording **before** connecting.
4. Connects Simulated EEG and calibrates (60 s).
5. Opens a second tab, which is read-only.
6. Opens and closes diagnostics.
7. Plays Cairn (pause/resume, flicker toggle).
8. Adds a marker by button, with a formula-like note, and one by Alt+M.
9. Plays Garden (settle-in then skip, breathing-guide toggle, sound toggle).
10. Clicks Stop & save, then Download ZIP.
11. Opens Review and the inspectors.
12. Checks the layout at 390 px width.

The Playwright scripts were throwaway test harnesses and are not in the repository. The downloaded ZIPs were parsed with `tools/research/check_export.py`, which is in the repository; run it on any export, including real headset sessions. It checks:

- the manifest's row counts and SHA-256 sums;
- that no local paths appear;
- per-acquisition sample continuity and the absence of duplicates;
- event → frame → window → EEG linkage;
- 8 channel rows per window;
- marker escaping.

| Run | Format / destination | What it covered | Result |
| --- | --- | --- | --- |
| Full | CSV / default | Dev Mode toggle, experiment refused while recording ("A research recording is running. Stop & save it…"), Cairn Go at `?cairn-time-scale=6` until it fell, mode change, Garden with a pace change and a hidden tab, then a **reconnect** mid-recording | Saved. 51,057 EEG rows in 2 acquisitions, both contiguous from 0 (50,036 + 1,021). 750 frames, 765 windows, 6,120 channel rows, 719 state rows, 81 events. Rounds: `fell_drop`, `session_change`, `capture_ended`. No console errors. |
| Short | SQLite / **second destination** registered through Add destination | Write probe on the new folder, SQLite-only recording | Saved. 36,327 rows, contiguous. The downloaded `.sqlite` passes `integrity_check`, and its row counts equal the ZIP. Per-table CSV download is identical to the ZIP copy. |
| Short | Both / default | Started while the source and baseline were already running | Saved. Parity `matched: true`. Acquisition `partial_start=1`, first sample 41,000. Calibration `preexisting=1`. |
| Short | CSV / default | First smoke run | Saved, contiguous, all checks OK. |

**Things that happened along the way:**

- **Owner loss, live.** A dev-server reload during one run killed the recording tab. The backend finalized it as `incomplete: Owner tab lost (no heartbeat for 5 s)` and kept the data.
- **Crash recovery, live.** `kill -9` on the backend mid-recording, then a restart. History showed `recovered_incomplete`, the ZIP exported with `complete: false`, and a loss entry was added.
- **Fall inspector.** It showed "A stone landed while sway exceeded the drop threshold", both thresholds, the active gust, the input frame and window, coverage labels, and sway against the thresholds with effect shading.
- **Garden inspector.** It showed the plant summary (active time, stage times, time above baseline, mean used score, pace, configuration changes) and growth/response/drive tracks.
- **Mobile.** `scrollWidth` was 390 at 390 px, both on the page and in Review.

## Long recording (backend soak)

A throwaway script ran a 30-minute recording through the HTTP API, with no browser. It used Simulated EEG in **Both** format, sent a heartbeat every second, and sampled status each minute.

- **Samples:** 450,042 EEG rows were written, matching every sample the backend received while recording (472 arrived before the start). Indices run 472–450,513: contiguous, no duplicates.
- **Writer and memory:** the backlog never exceeded 10 rows. Backend memory went from 121 MB to 123 MB over 30 minutes.
- **Finalization:** state `saved`. CSV↔SQLite parity was checked and matched, and no losses were logged. The finished `recording.sqlite` stands alone, with no `-wal`/`-shm` files beside it.
- **On disk:** 240 MB for Both (eeg.csv is 121 MB, recording.sqlite 117 MB).
- **Export:** the CSV ZIP is 41 MB and took 5.9 s.
- **Review:** a 20-second inspector window read took 0.8 s. Recording detail took less than 10 ms.

Disk use at 250 Hz is about 4 MB per minute in CSV, mostly `eeg.csv`, and about twice that in Both.

## Observations from this environment (not hardware results)

- **Headless Chromium draws Cairn at about 3 frames/s here** (software rendering on 2 vCPU).
  - Cairn's `dt` cap (0.1 s per frame) makes the model run slower than real time. The Cairn runs therefore used the development-only `?cairn-time-scale` switch; the scale is recorded in each `round_started`.
  - Under this load the browser processed WebSocket frames up to about 15 s late. Events correctly reference the frame the game had actually used, and the fall inspector reports that frame's age.
  - The existing freshness gate measures the time since a frame was *processed*, not since it was *emitted*, so it does not catch this. That is existing game behavior, which this work did not change. Worth checking on the class laptop: expect frames well under 1 s old there.
- **Clock syncs.** Under the same load, some syncs had round-trip times near 900 ms. They are now logged as "not used" while the best recent offset stays in force. Sample-alignment uncertainty in the final runs was 6–9 ms.
- **Firefly flicker (separate browser run).** Calm Cairn with 15 Hz flicker on, at `?cairn-time-scale=4`. Recording was started **after** the round began, so it carries `partial_start` and a `preexisting` calibration.
  - The export holds `gust_started` / `gust_ended (completed)`, `level_changed` (tier 0→1 at 5 stones), 7 × `stone_released` / `stone_placed`, `bug_started` with `flicker_started` (same effect ID), then `bug_ended` / `flicker_ended (bug_ended)`, and a `cairn_fell` ("Tilt exceeded the topple threshold", 6 stones, tilt −0.211 vs threshold 0.210 rad).
  - Rounds: `fell_sway`, then `capture_ended`. 1,025 input frames, every sequence present.
  - In that run the first clock sync was taken while the browser was saturated (RTT about 850 ms), so sample-alignment uncertainty was reported as about 430 ms. That is honest but wide. On a normal laptop expect single-digit milliseconds, as in the other runs.

## Not implemented or unverified

- **Hardware:** a live Cyton, real electrode contact, radio loss and USB burst timing were not tested. Replay alignment uses batch arrival time (±300 ms) and was not exercised in the browser. Replay seek and speed mapping segments are not implemented (replay restarts are new acquisitions).
- **Optical timing:** flicker times are frame-callback times. There is no photodiode, and `display_frames.csv` (optional) is not implemented.
- **Two-tab ownership and hidden tabs:** these were checked in the browser (a second tab is read-only). The Web-Worker heartbeat that keeps hidden tabs alive was not tested for more than 5 minutes hidden in a real browser.
- **History and review:**
  - History is not paginated.
  - The review window reads EEG only from the batch row spans near the window. It still parses the small tables (events, frames, windows, metrics, state) in full for each request.
  - The inspector uses ≤10-minute windows.
- **Ted's database** was not touched. SQLite is the only database adapter.
