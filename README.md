# Neumont-BCI-project

Working game title: **Brain Balance**.

AI & Data Club's ten-week showcase project: a virtual ball-and-beam neurofeedback game.

**Meeting pitch:** Wear a BCI headset, calibrate your signal, and try to keep a ball in the center of a virtual wooden beam. EEG changes the game's balancing assistance. Our club builds the interface, game simulation, signal pipeline, and an optional machine-learning comparison.

## Start here

**Immediate weekend goal:** [Live calibrated EEG → game demo](docs/weekend-live-demo.md) (8–14 focused hours plus contingency; headset access required).

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

Open http://127.0.0.1:5173. Click Start new round. The slider stands in for an EEG score. Arrow keys add practice steering. All of this is simulation, not recorded or live EEG.

## Run the optional synthetic backend

Prerequisite: Python 3.10+; recommended 3.11 or 3.12.

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Run the frontend in a second terminal. Select Local backend stream. It connects to `ws://127.0.0.1:8000/ws/input` and displays the synthetic source. No headset driver or model is included yet.

Windows: create the environment with `py -m venv .venv`, then activate `.venv\Scripts\Activate.ps1` in PowerShell.

## Checks

```sh
npm test
npm run build
```

Production assets are written to `apps/web/dist`. Development is local: this project does not need cloud hosting to demonstrate the headset. Font loading is optional and falls back to system fonts offline.

## Current status

Implemented: responsive React shell, Phaser renderer, fixed-step constrained simulation, 60-second round, time-in-zone score, manual score slider, synthetic Python WebSocket stream, input validation and stale-input pause.

Planned: headset integration, actual calibration, signal-quality assessment, recording/replay, formal input-mode switching, and model evaluation. The current `calibrated: true` synthetic flag is only a protocol fixture.

Repository: https://github.com/QuinnEvans34/Neumont-BCI-project (initially private). A local Git repo already exists. Dependencies are linked and attributed in the research document; no upstream template source or sample assets were copied. The club should choose its own source-code license before public release.
