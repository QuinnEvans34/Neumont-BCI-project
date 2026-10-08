# Recorded EEG weekend and live connection check

## What exists now

The local OpenBCI GUI recording folders contain Cyton eight-channel, 250 Hz sessions. The accompanying `BrainFlow-RAW*.csv` files can be played through BrainFlow without converting the GUI text export. These files are local inputs, not repository assets.

- **React connection lab:** source/file/serial selection; connect, disconnect, restart and recalibrate; sample count, packet age, baseline progress, channel standard deviation and errors.
- **BrainFlow acquisition:** replay uses `PLAYBACK_FILE_BOARD` with Cyton as master board; live uses `CYTON_BOARD` and the selected USB serial port. One backend owns the board and broadcasts one shared stream. UI reconnects do not restart acquisition.
- **Statistical processing:** rolling 500-sample windows; mean subtraction and Hann-window FFT; relative alpha = 8–<12 Hz power / 4–30 Hz power; median across channels passing the prototype gates. No trained ML model.
- **Calibration:** 30 separate valid windows of about two seconds; median and MAD baseline. Minimum scale 0.0001 rejects effectively flat baselines. Invalid windows extend calibration. Score = clip(0.5 + (feature − median)/(6 × 1.4826 × MAD), 0, 1); EMA uses 0.8 previous + 0.2 new. Larger relative alpha increases assistance by convention, not a validated calmness mapping.
- **Quality prototype:** finite samples, standard deviation >0.5 µV and peak-to-peak <500 µV on at least one channel; fewer than 500 samples or no passing channels means poor. These thresholds need hardware validation. They can miss artifacts; one surviving channel may not be useful EEG.
- **Game:** score affects disturbances in automated balancing. It does not infer left/right intentions. Missing samples for two seconds pauses stream gameplay. Source changes made through the panel pause the round and require Resume/start.

The 250 Hz value shown is the board’s expected rate. Packet age and sample count diagnose delivery, not RF packet-loss percentage or measured sampling rate. Channel deviation is not electrode impedance. The first iteration pools passing channels; selecting verified O1/O2 channels and comparing features is a next task.

## Weekend recipe

1. Start both servers using README commands.
2. In Connection lab choose Recorded Cyton EEG, select a BrainFlow file, and Connect / restart.
3. Check that received samples increase and packet age stays low. Initial quality is poor until two seconds of samples arrive.
4. Wait for baseline Ready. Progress counts valid EEG windows, so a noisy recording can take longer than one minute.
5. Select Local backend stream, start a round, and inspect the changing assistance percentage.
6. Disconnect during play. Input must become poor and pause the game. Reconnect/recalibrate and explicitly resume or start anew.
7. Try more than one recording. Record a short UI video showing **replay** prominently. Do not describe replay as a live brain-control demo.

Replay ends rather than silently looping. The board session may still say open at EOF, but packet age grows, receiving status becomes stalled, and quality becomes poor. Session open does not prove streaming. Restart the recording via Connect / restart. Calibration errors stop the board session; reconnect to retry, with another recording if necessary.

## Tomorrow’s short hardware session (15–25 minutes)

1. Use the existing OpenBCI GUI to establish a known-working live stream. Note the dongle serial port, sample rate, actual channel-to-electrode wiring and board configuration. Save a short recording as a fallback.
2. Stop and close its board session. Two programs cannot directly own the same serial connection. Keep the GUI installed as the diagnostic reference.
3. Start our two servers, refresh ports, select Live Cyton and the same serial port. On Mac choose `/dev/cu…`, following BrainFlow documentation.
4. Connect and confirm samples arrive. If not, copy the error and check board power, radio/dongle, port and whether the GUI still owns the session. Do not spend the entire fair debugging; confirm the original GUI still works and keep the recording.
5. Sit relatively still for the baseline; confirm Ready and try a game round. This verifies acquisition and mapping, not intentional mental control.
6. Disconnect/reconnect once, then verify the GUI can reconnect after our board is released. Record the result and configuration in a local note; no raw EEG in Git.

If direct connection fails but the GUI works, the next fallback is GUI Networking → LSL → Python. That adapter is **not implemented** yet; adding it now would give us two acquisition routes to debug. Finish the direct Cyton check first.

## Focused weekend tracks / estimates

These are person-hours, assuming the current prototype and recorded data:

| Track | Task | Estimate | Done when |
|---|---|---:|---|
| Data / you | Run several recordings, select verified electrodes, inspect artifacts, compare relative alpha to other candidate features | 3–5 h | Reproducible replay calibration and a documented channel choice |
| UI / Porter | Improve diagnostics layout, calibration instructions and distinct source/status states | 3–5 h | A teammate can connect and diagnose a missing backend without help |
| Game | Tune score-to-disturbance mapping and disable keyboard steering for scored EEG rounds | 2–4 h | Replay visibly changes assistance; fair scoring remains understandable |
| Integration | Add source-session IDs, explicit stale recovery, recorded-session tests and a demo checklist | 3–5 h | Switching inputs never mixes rounds or old calibration |
| Hardware | Tomorrow’s smoke test; next week’s proper participant setup | 0.5 h tomorrow + 1–2 h later | Live samples, baseline, game and clean reconnect verified |

No trained model is required for this milestone. Simulation/replay success is not a promise that physiological control will work next week. The remaining uncertainty is much smaller if tomorrow confirms the serial acquisition route.

## References

- [BrainFlow playback and Cyton API](https://brainflow.readthedocs.io/en/stable/SupportedBoards.html): native playback, Cyton master metadata, EOF behavior and serial selection.
- [OpenBCI GUI documentation](https://docs.openbci.com/Software/OpenBCISoftware/GUIDocs/): GUI recording formats.
- [OpenBCI GUI Networking widget](https://docs.openbci.com/Software/OpenBCISoftware/GUIWidgets/): optional later LSL route.

## Connection reliability changes

The backend starts disconnected; the UI starts with live Cyton selected and requires explicit port selection. Replay and synthetic simulation display an explicit no-live-headset message. `session_open` describes SDK ownership, `receiving_samples` describes sample receipt within two seconds, and `live_verified` requires both fresh samples and live Cyton source. `connected` now describes fresh sample receipt, never merely an open session. It does not validate electrode contact.

Opening a live board starts a waiting state. If no samples arrive within five seconds after acquisition starts, the service releases the board and reports an error. A previously working stream becomes stalled after two seconds without new samples. Frames fail closed on stale or disconnected input even between worker ticks. Disconnect clears calibration; calibration requests without incoming samples return HTTP 409.
