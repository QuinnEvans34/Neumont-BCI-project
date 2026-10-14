# Neumont-BCI-project

Working game title: **Brain Balance**.

AI & Data Club's ten-week showcase project: a virtual ball-and-beam neurofeedback game.

**Meeting pitch:** Wear a BCI headset, calibrate your signal, and try to keep a ball in the center of a virtual wooden beam. EEG changes the game's balancing assistance. Our club builds the interface, game simulation, signal pipeline, and an optional machine-learning comparison.

## Start here

**Glowing Garden (first version implemented):** a second game where a central plant glows with your signal and grows with sustained above-baseline input. Both games share one connection, one session and one baseline through a new game chooser. See the [specification](docs/garden/spec.md), [implementation handoff](docs/garden/claude-handoff.md) and [verification notes](docs/garden/verification.md).

**Immediate weekend goal:** [Recorded EEG → calibration → game, plus tomorrow’s hardware check](docs/replay-and-connection.md). No headset needed for replay. See also the [live-demo plan](docs/weekend-live-demo.md).

**Primary implementation plan:** [Complete build blueprint](docs/blueprint.md), with [exact source/reuse matrix](docs/blueprint/reuse-matrix.md) and [34 estimated task cards](docs/blueprint/work-breakdown.md).

- [Pitch and meeting agenda](docs/pitch.md)
- [MVP and acceptance criteria](docs/mvp.md)
- [Workstreams and claimable tasks](docs/workstreams/README.md)
- [Weekend plan and ten-week roadmap](docs/roadmap.md)
- [Architecture and input contract](docs/architecture.md)
- [Research and reusable software](docs/research.md)
- [P300/SSVEP research: datasets, activities, apps and hexapod control](docs/p300-ssvep-research.md)
- [Starter validation report](docs/validation.md)
- [Decisions and open questions](docs/decisions.md)
- [Contributing](CONTRIBUTING.md)

## Run the frontend without a headset

Prerequisite: Node.js 20.19+ or a supported newer LTS.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173. Follow Connect → Calibrate → Choose a game → Play. Run the backend below, then choose a recorded session or explicitly labeled simulation to develop without hardware.

## Run the EEG backend

Prerequisite: Python 3.10+; recommended 3.11 or 3.12.

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Run the frontend in a second terminal. On **Connect**, choose a recording and click **Start playback & inspect**, or select the Cyton dongle port and click **Connect & inspect**. Close the OpenBCI GUI board session before connecting directly.

On **Calibrate**, inspect the waveform, recording playhead, delivery rate and channel gates. Click **Begin baseline** to collect 30 accepted, non-overlapping two-second windows. Then click **Choose a game** and pick **Glowing Garden** or **Balance Beam**: acquisition keeps running with the same session, file position and baseline, and switching games never reconnects or recalibrates. Simulation bypasses EEG calibration and is explicitly labeled.

**Glowing Garden.** The plant's glow, leaf opening, sun and fireflies follow the published score immediately (with extra visual smoothing). Scores above the 50% baseline score earn lasting growth through Sprout → Growing → Blooming; at the default pace that takes about 90 s at score 1 or 180 s at 0.75. Lower scores dim the light but never remove earned leaves. Pause, Change game, a hidden tab, stale or rejected input all freeze the garden until you click Resume; a new session or a recalibration (including one started by another viewer) resets both games.

- *Settle-in:* each new plant opens with a 34-second guided arrival (posture, relaxed jaw and still eyes, then two guided breaths). Nothing grows during it; **Begin now** skips it, and it can be switched off.
- *Breathing guide:* one shared breath clock (4 s in, 6 s out) drives the garden's sway, an optional ring of light around the plant with "Breathe in / Breathe out" cues, and the ambient wind sound. The guide is optional and is not part of the score.
- *Ambient sound* (off by default): a synthesized chord whose warmth and volume swell with the glow, airy high notes above baseline, breath-paced wind, and chimes as lights appear and stages are reached. Silent whenever the garden is paused. No audio files.
- *Facilitator panel* (bottom of the garden page): growth pace (full-signal seconds to bloom, 30–600 s, presets), live stats for the current plant, a suggested pace computed from logged EEG sessions for a target bloom time, per-plant notes, and a session log with CSV download. Preferences and the log stay in this browser only; no EEG is stored.

Art review without waiting for input: with `npm run dev`, open http://127.0.0.1:5173/?garden-preview (sliders), `?garden-preview&demo` (time-lapse) or `?garden-preview&demo&sound`. The preview exists only in development builds.

**Balance Beam.**

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
