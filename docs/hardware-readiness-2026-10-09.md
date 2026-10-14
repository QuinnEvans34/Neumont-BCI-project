# Hardware readiness review — October 9, 2026

Decision: ready for a supervised first Cyton test. No broad feature work is needed before that test. Actual radio/USB delivery, electrode quality, and intentional control remain unverified without the board.

## Confidence and evidence

| Part | Evidence | Remaining uncertainty |
| --- | --- | --- |
| Installed runtime | Python dependency check passes; native BrainFlow playback integration test passes | Physical USB driver / dongle access |
| Recording to game | Prior full playback matched all 84,172 samples across all eight EEG channels; baseline and game preserve the acquisition session | Playback does not test the Cyton serial driver or radio |
| Calibration | Exact 30 non-overlapping two-second windows; arbitrary SDK read boundaries tested; flat/artifact/gapped windows rejected | Electrode contact may leave too few usable windows; baseline can take longer than one minute |
| Failure handling | Tests cover missing port, failed start cleanup, no incoming samples, stale input, explicit simulation, EOF | Real unplug/reconnect and port release must be tested |
| Gameplay | Tests cover endless play, falls from both ends, stale input rejection | Relative alpha is a provisional input; deliberate control and stress sensitivity have not been demonstrated |

This review passed 26 Python tests and 3 frontend tests. The Python suite includes native playback, but live connection tests use mocks. A successful test suite is not proof of physical connectivity.

## Focused fix from this review

Previously, small live packet-counter gaps and duplicates were reported but could enter the feature/baseline when timestamp gaps were under 100 ms. Such two-second windows are now rejected. Clean windows allow recovery; normal modulo-256 counter wrap is accepted. Regression tests cover gaps across SDK reads, duplicates, recovery, and multiple gaps in one large read.

This deliberately favors pausing over producing a score from interrupted data. Frequent packet loss will slow calibration and pause gameplay; fix the radio/USB link rather than bypassing the checks. Counter-derived loss totals remain estimates because resets and long outages are ambiguous.

## First 20–25 minutes with hardware

1. Start both services using the README commands. Confirm the page loads and reports the backend available. Neither service was running when inspected during this review.
2. Spend up to five minutes getting the standard eight-channel, 250 Hz Cyton stream working in OpenBCI GUI. Confirm electrode/reference/bias placement against your known setup. Save a short recording as a fallback.
3. Close the GUI's acquisition session before connecting our app. Select Live headset, refresh ports, and choose the USB dongle's `/dev/cu…` port on this Mac. Do not select Bluetooth serial ports.
4. Watch sample count, packet age, measured rate and EEG traces for 10–15 seconds. Count should continually grow, age should generally stay well below two seconds, rate should settle near 250 Hz, and packet-gap totals should not grow persistently. “Live verified” means fresh sample delivery, not clinically useful EEG.
5. Inspect channel gates before clicking Begin baseline. If every channel fails, fix contact/placement using the GUI as the reference. Do not weaken gates merely to enable the game.
6. Collect 60 accepted seconds. Some rejected windows are possible; persistent rejection requires diagnosis. Verify a finite baseline center/spread and an enabled Start balancing button.
7. Start the game. Confirm the session ID stays the same and sample count continues upward. Watch feature and assistance change; do not promise that a user's stress or relaxation will reliably move them yet.
8. Interrupt the stream while playing. Allow the two-second freshness threshold plus normal update latency: the game should pause without inventing a fall. Recover and explicitly Resume. If reconnection is necessary, recalibrate in the new session.
9. Disconnect in our app and confirm the GUI can reopen the board. Record any error text, port name and observed packet/rate behavior.

## If something fails

| Symptom | First action |
| --- | --- |
| Backend unavailable | Start uvicorn on port 8000 and inspect its terminal output |
| Dongle missing from ports | Replug dongle, refresh, then check whether OpenBCI GUI sees it |
| Port busy / unable to open | Close the GUI board session and any other serial connection; retry |
| Board not ready / no samples | Check board power and radio pairing in the GUI; preserve the exact error text |
| Packets arrive, but baseline stalls | Inspect channel rejection reasons and packet-counter gaps; correct contact or radio stability |
| Baseline has no meaningful variation | Check that this is actual EEG and not a flat/test signal; retry a normal resting baseline |
| Game repeatedly pauses | Check recent packet age, gap counters and channel gates before changing game logic |
| Live path remains blocked after ten minutes | Capture diagnostics and demonstrate Recorded session with its visible label; simulation is a separately labeled fallback |

## Driver details checked against pinned BrainFlow 5.23.0

The app uses `CYTON_BOARD`, an explicitly selected serial port and the standard eight EEG channels. The pinned native driver opens the serial port, sends a reset, waits for its welcome response, applies default channel settings (`d`) and starts binary acquisition (`b`). Thus custom GUI channel settings should not be assumed to survive connection. Use the standard configuration for this first test.

The app's five-second no-sample timeout begins **after** SDK prepare/start succeeds. It is not a five-second limit for the entire connection handshake; the native driver has its own serial waits. On disconnect, BrainFlow stops the stream and releases the serial port.

Sources: [pinned serial driver](https://github.com/brainflow-dev/brainflow/blob/5.23.0/src/board_controller/openbci/openbci_serial_board.cpp), [Cyton connection documentation](https://brainflow.readthedocs.io/en/stable/SupportedBoards.html#openbci-cyton).

## Defer until after the first hardware test

Do not add a new classifier, change the feature bands, or redesign the UI hours before the test. First establish acquisition, baseline, continuous handoff, interruption handling and clean disconnect. Then use actual observations to decide whether filtering, electrode selection, quality gates or score mapping need adjustment.
