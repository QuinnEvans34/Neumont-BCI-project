# Neumont-BCI-project

Working game title: **Brain Balance**.

AI & Data Club's ten-week showcase project: a virtual ball-and-beam neurofeedback game.

**Meeting pitch:** Wear a BCI headset, calibrate your signal, and try to keep a ball in the center of a virtual wooden beam. EEG changes the game's balancing assistance. Our club builds the interface, game simulation, signal pipeline, and an optional machine-learning comparison.

## Start here

**Immediate weekend goal:** [Recorded EEG → calibration → game, plus tomorrow’s hardware check](docs/replay-and-connection.md). No headset needed for replay. See also the [live-demo plan](docs/weekend-live-demo.md).

**Primary implementation plan:** [Complete build blueprint](docs/blueprint.md), with [exact source/reuse matrix](docs/blueprint/reuse-matrix.md) and [34 estimated task cards](docs/blueprint/work-breakdown.md).

- [Pitch and meeting agenda](docs/pitch.md)
- [MVP and acceptance criteria](docs/mvp.md)
- [Workstreams and claimable tasks](docs/workstreams/README.md)
- [Weekend plan and ten-week roadmap](docs/roadmap.md)
- [Architecture and input contract](docs/architecture.md)
- [Research and reusable software](docs/research.md)
- [Starter validation report](docs/validation.md)
- [Decisions and open questions](docs/decisions.md)
- [Contributing](CONTRIBUTING.md)

## Run the frontend without a headset

Prerequisite: Node.js 20.19+ or a supported newer LTS.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173. Follow Connect → Calibrate → Balance. Run the backend below, then choose a recorded session or explicitly labeled simulation to develop without hardware.

## Run the EEG backend

Prerequisite: Python 3.10+; recommended 3.11 or 3.12.

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Run the frontend in a second terminal. On **Connect**, choose a recording and click **Start playback & inspect**, or select the Cyton dongle port and click **Connect & inspect**. Close the OpenBCI GUI board session before connecting directly.

On **Calibrate**, inspect the waveform, recording playhead, delivery rate and channel gates. Click **Begin baseline** to collect 30 accepted, non-overlapping two-second windows. Then click **Start balancing**: acquisition keeps running with the same session, file position and baseline. Simulation bypasses EEG calibration and is explicitly labeled.

The game has no countdown or automatic win. Falling ends the round; rejected/missing input and recording EOF pause it without a loss. Resume explicitly after a signal interruption. Rounds ease in over five seconds, and assistance changes smoothly.

The backend starts disconnected. Fresh samples are required to verify delivery; an open SDK session does not establish electrode contact. A live session without samples times out after five seconds.
Recordings default to `~/Documents/OpenBCI_GUI/Recordings`. Set `BCI_RECORDINGS_DIR` to another folder before starting the backend if needed. Raw recordings stay outside Git. Replay stops at the end; reconnect to restart. See [replay and debugging instructions](docs/replay-and-connection.md).

Windows: create the environment with `py -m venv .venv`, then activate `.venv\Scripts\Activate.ps1` in PowerShell.

## Checks

```sh
npm test
npm run build
python -m unittest discover -s backend -p 'test_*.py'
```

Production assets are written to `apps/web/dist`. Development is local: this project does not need cloud hosting to demonstrate the headset. Font loading is optional and falls back to system fonts offline.

## Current status

Implemented: responsive React shell, Phaser renderer, fixed-step rolling simulation with falling and round-ending losses, endless rounds with elapsed and time-in-center scores, Python WebSocket stream, Cyton BrainFlow replay and direct-live adapters, relative-alpha feature, explicit robust 60-second baseline, guided session UI, recording overview/playhead, recent waveform and feature charts, measured sample delivery rate, per-channel rejection reasons, native replay sample verification, input validation and stale-input pause.

Still to verify: physical Cyton connection, intentional EEG control, and feature/channel choices on club participants. Planned: stronger artifact assessment, session recording, formal input-mode switching, and model evaluation. The current quality gate is an experimental amplitude/flatness check; the synthetic baseline is bypassed and labeled.

Repository: https://github.com/QuinnEvans34/Neumont-BCI-project (initially private). A local Git repo already exists. Dependencies are linked and attributed in the research document; no upstream template source or sample assets were copied. The club should choose its own source-code license before public release.
