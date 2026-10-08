# Starter validation — October 8, 2026

- TypeScript checking and Vite production build: passed.
- Two automated tests: round duration/ball bounds/input extremes; invalid, uncalibrated, poor and stale input rejection: passed.
- Python compile check: passed.
- Local backend health and WebSocket smoke check: passed; three increasing synthetic frames in [0,1].
- Browser: manual round starts, timer and time-in-zone advance, pause works, synthetic source is explicit, streamed round starts, backend disconnect visibly pauses round and disables start.
- Deterministic 60-second comparison without keyboard: score 0 → 30.29 seconds in center zone; score 1 → 59.57 seconds. This validates the chosen game mapping only, not EEG usefulness or human performance. GAME-01 still owns tuning for fun.
- Local verification environment: Node 20.20.1; Vite 6.3.7; Phaser 3.90.0; React 19.0.0; Python 3.14; FastAPI 0.143.0; Uvicorn 0.54.0. Frontend dependency versions are locked in package-lock.json.
- Build limitation: Phaser contributes a large JS bundle (approximately 403 KB gzip total). Acceptable for local prototype; optimize only if measured loading warrants it.
- No headset, actual calibration, EEG quality detector, participant evaluation, or model training has been verified. These remain explicit workstream tasks.

## Recorded EEG and connection lab — October 8, 2026

- Native BrainFlow playback successfully read a local Cyton recording (eight channels, expected 250 Hz). Raw EEG was not added to the repository.
- A replay run collected the 30-window baseline in approximately 73 seconds. Five further seconds of processing brought the total to 17,269 samples and produced assistance scores from 0.484 to 0.880; baseline median 0.167, robust scale 0.0561. This verifies a changing processing output, not stress measurement or deliberate control.
- Disconnect invalidated quality; unit checks cover EOF/stale input and ensure replay disconnect does not become synthetic.
- Four backend tests passed: spectral discrimination, flat/artifact rejection, calibration behavior, and disconnected/stale source handling. Existing two frontend tests passed; frontend production build and Python compilation passed. The existing Phaser bundle-size warning remains.
- Physical Cyton/USB connectivity remains untested. Expected board rate is not a measured packet-loss test. EEG quality gates and channel selection require participant validation.
- Browser verification: connection lab discovered four local BrainFlow recordings, replay calibration reached Ready, and a game round advanced using the replay WebSocket score. The preview was left paused after nine seconds of gameplay.
