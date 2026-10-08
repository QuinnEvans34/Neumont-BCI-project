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

## Connection status regression fix — October 8, 2026

Previous status could call synthetic generation or an open SDK session connected. Startup now stays disconnected, ports require explicit selection, and live verification requires fresh Cyton samples. Replay and simulation explicitly say no live headset connection. No-sample live acquisition times out after five seconds; stale frames fail closed after two seconds. Disconnect clears calibration even when board cleanup fails.

Fourteen backend tests and two frontend tests passed, plus production build and diff checks. New regression tests cover missing devices, no-sample open sessions and timeout, fresh/stalled live samples, replay versus live verification, explicit simulation and disconnect, failed acquisition cleanup, failed release cleanup, missing-device HTTP errors and calibration rejection without EEG. Hardware states are simulated with mocked SDK input; actual Cyton hardware is still unverified.

Browser checks on this laptop without a headset verified disconnected startup, disabled Connect before selecting a port, explicit simulation labeling, disconnect disabling stream gameplay, and native replay labeling with no claim of live connection.

## Falling and simplified session controls

Removed manual score controls and keyboard steering. Three frontend tests pass, including losses at both beam ends, frozen scoring after loss, a fresh reset, low-assistance loss and high-assistance 60-second completion. Frontend build passes. Rendering animates an exiting ball in world coordinates under gravity.

## Synthetic start workflow

A fresh page could start synthetic input, but the selector did not enable the selected input, and initially displayed live Cyton even if simulation was already active. Selecting Synthetic now explicitly enables simulation, the selector initializes from backend status, and synthetic frames are valid immediately without waiting for a worker tick. Live and replay still require explicit connection. Fifteen backend tests, three frontend tests and the production build passed. Browser checks start with disconnected input, select Synthetic without pressing Connect, then start and restart a round.
