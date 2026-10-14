# Guided session and hardware test

## Start and inspect

Start Vite and the Python backend using README commands. Open http://127.0.0.1:5173.

1. **Connect:** choose Live headset, Recorded session, or Simulation. The source card alone does not change the running input; press its explicitly named start/connect button.
2. For recordings, inspect the full-file envelope, sample count, channel count, sample duration and original timestamp span before starting. The locally available file ending `13-51-59_2.csv` is the initial selection when present; it has 84,172 samples and no original timestamp gaps over 100 ms in the October 8 inspection. Other files remain selectable.
3. **Calibrate:** playback/live acquisition starts immediately, but baseline collection waits for **Begin baseline**. Choose a displayed channel (CH7 initially); the display choice does not change the analysis channels. Inspect which channels pass the provisional gates.
4. Click **Begin baseline** and watch accepted time grow to 60 seconds. Progress uses 30 distinct 500-sample windows after the click. Rejected windows extend the wait. A window crossing a source timestamp gap over 100 ms or a backwards timestamp is rejected.
5. Click **Start balancing** when the baseline is ready and input is usable. The acquisition session, playback position and baseline remain unchanged. Switching screens never reopens the board.
6. Play until the ball falls. There is no 60-second win. The round eases in over five seconds and assistance is smoothed over roughly 0.8 seconds. Time survived counts upward; time in center is accumulated separately.
7. Missing, rejected or stale input pauses play. **Resume** is explicit after recovery. EOF displays **Recording finished**, pauses the game, and is not a loss. Restarting playback creates a new session and needs a new EEG baseline.

Simulation generates an assistance signal, has no EEG waveforms, bypasses calibration and never verifies live hardware. Start simulation → Start balancing exercises the same game flow without claiming physiological input.

## What the plots mean

- **Full recording:** per-channel minimum/maximum envelope over up to 500 bins. For visibility, the chart clips the extreme 1% tails of envelope values; the stored EEG and analysis remain unmodified. Mint marks the current sample position and latest two-second analysis region; blue marks the baseline interval; amber marks original timestamp gaps.
- **Recording time:** progress is consumed sample index / total samples, converted at 250 Hz. The original timestamp span and current original timestamp offset appear separately. A sample clock is not a wall-clock stopwatch; recordings with gaps can have different durations.
- **Recent EEG:** last ten seconds of received samples. Display removes the selected channel's mean, shows every fifth sample and uses a ±250 µV range. It labels clipping; analysis uses all samples.
- **Feature:** relative-alpha history, with gaps for invalid windows and baseline median ± robust spread once calibrated. The recent history is bounded to 240 feature updates.
- **Channel gates:** finite samples, standard deviation above 0.5 µV, and peak-to-peak range below 500 µV. A valid feature needs at least one included channel. These provisional gates can miss artifacts and do not measure impedance. Changing the display channel does not select electrodes for analysis.
- **Assistance:** median relative alpha across passing channels, normalized against baseline median and MAD. Larger relative alpha means more assistance by convention; this is not a validated stress detector. The game shows applied assistance, including its settling period and smoothing.

## Evidence of correct playback

BrainFlow's native Playback File Board owns pacing and sample delivery. The service independently reads the local file for preview and verification. It compares every arriving sample's eight EEG values with the corresponding source row, at absolute tolerance 0.00001 µV. The preview never feeds future samples into calibration.

Open **Connection & playback evidence** to inspect session ID, matched/mismatched sample counts, original recording time and timestamp gaps. A mismatch halts acquisition. BrainFlow's regenerated playback timestamp is intentionally excluded from numerical comparison; source timestamps remain available for alignment and gap detection. EOF is established by consuming the known full sample count, not by guessing from elapsed time.

Tests cover arbitrary packet boundaries, exact calibration sample intervals and direct feature equality, no implicit baseline, rejected windows, timestamp gaps, preserved session position, mismatch detection and exact EOF. A native SDK integration test creates a short temporary file, plays the whole file, checks every EEG sample and the final feature, and confirms EOF makes input unusable. Raw participant recordings remain outside Git.

## 15–25-minute live check

1. Establish a known-working stream in OpenBCI GUI. Note actual serial port, board configuration and channel-to-electrode wiring. Save a short fallback recording.
2. Close its board session so our backend can own the port. Keep the GUI available as a reference.
3. Select **Live headset**, refresh ports, choose the USB dongle (Mac `/dev/cu…`), and **Connect & inspect**. The service starts waiting; only fresh samples verify delivery. No samples after five seconds of acquisition causes a visible error and cleanup.
4. Confirm the sample count increases, recent EEG changes, packet age stays low and measured delivery rate settles near expected 250 Hz. The rate uses samples received over the last five wall-clock seconds, so short-term variations are normal. It is not a hardware clock measurement.
5. Check channel gates and physical electrode placement. A passing amplitude gate alone does not prove useful EEG. OpenBCI GUI remains the electrode/contact reference.
6. Begin baseline, verify progress and channel reasons, then start the game. Open evidence before and after: the same session ID and increasing sample index must persist.
7. Test a stream interruption while playing. The game must pause within the two-second freshness limit without manufacturing a loss. Recover samples and explicitly Resume; a new connection creates a new session and requires calibration.
8. Disconnect in our app, then verify OpenBCI GUI can reconnect. Note actual failure messages and working settings locally.

Additional no-hardware checks: no port must not connect; a non-Cyton/open-but-silent session must not be reported as streaming; simulated/replayed data must never claim live hardware. Automated versions use SDK mocks; the physical board must still be tested.

Live feature and baseline windows containing a detected Cyton packet-counter gap or duplicate are rejected; clean windows recover automatically. Cyton sample-counter continuity is shown as an estimate: modulo-256 wrap is normal, gaps suggest missing samples, but resets and long interruptions can make loss estimates ambiguous. Timestamp gaps and per-channel gates are separate evidence.

## Implementation notes

A single backend producer owns the board. All viewers share its acquisition and controls; this remains a local club demo, not a multi-user service. One WebSocket carries the score and the accompanying telemetry. Browser freshness is based on receipt time; raw EEG freshness comes from sample arrival. Changing input invalidates the previous baseline. An already running round cannot resume against a different session ID.

The full-file preview endpoint accepts only BrainFlow recording paths within `BCI_RECORDINGS_DIR`. A two-entry cache avoids parsing large files on every telemetry update. The service keeps ten seconds of waveforms, recent features, and its active source file for verification. Recording new live sessions and LSL acquisition are future work.

## References

- [BrainFlow playback and Cyton API](https://brainflow.readthedocs.io/en/stable/SupportedBoards.html)
- [OpenBCI GUI documentation](https://docs.openbci.com/Software/OpenBCISoftware/GUIDocs/)
