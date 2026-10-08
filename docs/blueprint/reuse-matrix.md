# Open-source reuse matrix and source review

Research date: October 8, 2026. Findings use upstream repos, documentation and inspected example files. Selection and effort judgments are ours; upstream projects do not guarantee our hardware, feature quality or implementation schedule. Every selected dependency will be release-pinned and smoke-tested on the showcase OS. No third-party example source is copied in this planning update.

## Selected components

| Project / source | What it provides | Concrete reuse | Code we still write | Status / license |
| --- | --- | --- | --- | --- |
| [React](https://github.com/react/react) | Component-based application UI | Install `react`/`react-dom`; hooks and DOM controls | Session screens, state transitions, instructions, quality UI, results | Already installed; MIT |
| [Phaser](https://github.com/phaserjs/phaser) | Scene lifecycle, renderer, input and game objects | Install package; `Phaser.Game`, `Scene`, Graphics, Scale.FIT | Ball/beam simulation, scoring, assistance mapping, scene design | Already installed at 3.90.0; MIT |
| [Official React/TS template](https://github.com/phaserjs/template-react-ts) | Small React-to-Phaser integration example | Adapt lifecycle/event bridge only if our ref/callback bridge grows | Our component props/events and cleanup rules | Reference, not cloned; MIT |
| [Vite](https://github.com/vitejs/vite) | Development server and production bundling | Existing CLI/build pipeline | Local start workflow and config if needed | Already installed; MIT |
| [TypeScript](https://github.com/microsoft/TypeScript) | Static type checking | Existing `tsc` and strict config | Input/session/game types and runtime checks | Already installed; Apache-2.0 |
| [BrainFlow](https://github.com/brainflow-dev/brainflow) | Device acquisition and signal-processing primitives | BoardShim lifecycle, board metadata, filters, PSD/band powers, optional native recording/playback | Headset settings, acquisition worker, quality gate, buffer ownership, participant calibration | Planned, conditional on board/OS; MIT |
| [NumPy](https://github.com/numpy/numpy) | Arrays, numerical statistics and local array storage | Median/percentiles/clipping, channel/window operations and `savez` if selected | Our shapes/metadata/unit conventions and feature normalization | Planned with EEG pipeline; BSD-3-Clause |
| [FastAPI](https://github.com/fastapi/fastapi) | HTTP/WebSocket routing | `WebSocket`, send_json, lifespan hooks, documented test patterns | Shared producer, bounded client broadcast, commands/status, recovery | Already installed for synthetic server; MIT |
| [Uvicorn](https://github.com/encode/uvicorn) | ASGI server process | Existing local launch command | Shutdown/start configuration, operator launch instructions | Already installed; BSD-3-Clause |
| [Pydantic](https://github.com/pydantic/pydantic) | Typed data validation | Define backend packet/control models with constraints | Our protocol schema and cross-language fixtures | Available through FastAPI, model definitions planned; MIT |
| [scikit-learn](https://github.com/scikit-learn/scikit-learn) | Preprocessing, classifiers, grouped splitting and metrics | StandardScaler, LogisticRegression, DummyClassifier, Pipeline, GroupKFold/GroupShuffleSplit as appropriate | Dataset, labels, split design, experiment scripts/report, inference contract | Optional ML track; BSD-3-Clause |
| [pytest](https://github.com/pytest-dev/pytest) | Python test runner and fixtures | Test backend logic and FastAPI TestClient (with httpx) | Quality/calibration/lifecycle test cases | Planned dev dependency; MIT |
| [Playwright](https://github.com/microsoft/playwright) | Browser test automation | `@playwright/test` for deterministic fixture-driven flow | Our end-to-end scenarios and fixture server | Planned dev dependency; Apache-2.0 |

We are installing library packages, not copying their internal implementations. The custom code is integration and product behavior. Upstream imports do not provide a completed EEG game.

## Exact example files we can adapt

### BrainFlow

Reviewed the raw upstream Python files directly; the links below identify their source paths. Sample code uses demonstration parameters. Wrap it in our lifecycle/tests rather than pasting an entire CLI script into a WebSocket handler.

| Source file | Reusable pattern | Required adaptation | Task |
| --- | --- | --- | --- |
| [brainflow_get_data.py](https://github.com/brainflow-dev/brainflow/blob/master/python_package/examples/tests/brainflow_get_data.py) | Prepare/start/read/stop/release board; file streamer | Device config, try/finally cleanup, one producer, reconnect; avoid blocking server event loop | DATA-01/02 |
| [signal_filtering.py](https://github.com/brainflow-dev/brainflow/blob/master/python_package/examples/tests/signal_filtering.py) | DataFilter band/notch/filter calls | Sample-rate limits, region's mains frequency, channel selection, causal/window behavior, preserve raw data | DATA-03 |
| [band_power.py](https://github.com/brainflow-dev/brainflow/blob/master/python_package/examples/tests/band_power.py) | Detrending, Welch PSD, band integration | Multi-channel window extraction, log/relative powers, valid denominator and shape checks | DATA-03 |
| [serialization.py](https://github.com/brainflow-dev/brainflow/blob/master/python_package/examples/tests/serialization.py) | Read/write board arrays | Session metadata, task markers, sample/time integrity, feature/game event logs | DATA-06 |
| [markers.py](https://github.com/brainflow-dev/brainflow/blob/master/python_package/examples/tests/markers.py) | Marker insertion into board stream | Task events and browser/backend time alignment; fallback event log if adapter lacks markers | ML-01/02 |
| [eeg_metrics.py](https://github.com/brainflow-dev/brainflow/blob/master/python_package/examples/tests/eeg_metrics.py) | Band features → MLModel calls | Benchmark only; the metric name doesn't validate our participants/headset | Optional after baseline |

BrainFlow's [supported-board documentation](https://brainflow.readthedocs.io/en/stable/SupportedBoards.html) is the hardware gate. Its [API reference](https://brainflow.readthedocs.io/en/stable/UserAPI.html) is authoritative for parameter semantics. Do not guess feature values from sample code.

### React / Phaser

Reviewed [PhaserGame.tsx](https://github.com/phaserjs/template-react-ts/blob/main/src/PhaserGame.tsx) for game creation/destruction and React lifecycle; [EventBus.ts](https://github.com/phaserjs/template-react-ts/blob/main/src/game/EventBus.ts) for a Phaser event-emitter bridge. Our current starter already implements the smaller bridge with refs/callbacks, so copying these would not add useful behavior now.

The inspected [template package.json](https://github.com/phaserjs/template-react-ts/blob/main/package.json) currently selects Phaser 4 and includes `log.js` in default dev/build scripts. Our tested starter selects Phaser 3.90 and invokes Vite directly. If adopting template files, use a release-compatible revision and omit unrelated scripts. Do not replace the working scaffold with upstream main.

[Phaser physics documentation](https://docs.phaser.io/phaser/concepts/physics) explains Arcade and Matter. The proposed MVP uses our constrained rolling model, so neither engine is needed initially. Matter is conditional on a future free-falling ball/collision mechanic.

### Backend and ML

Use FastAPI's [WebSocket example](https://fastapi.tiangolo.com/advanced/websockets/) for communication mechanics and [WebSocket testing example](https://fastapi.tiangolo.com/advanced/testing-websockets/) for TestClient-based checks. We supply session commands, single-producer ownership, bounded queues and fault behavior ourselves; an example connection manager is not those policies.

For ML use the documented [Pipeline](https://scikit-learn.org/stable/modules/generated/sklearn.pipeline.Pipeline.html), [LogisticRegression](https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.LogisticRegression.html), [grouped evaluation](https://scikit-learn.org/stable/modules/cross_validation.html) and [leakage guidance](https://scikit-learn.org/stable/common_pitfalls.html). This reuses algorithms, not a pretrained classifier valid for our headset. Data collection and a defensible evaluation are the main ML work.

## Conditional acquisition alternatives

| Route | Source / coverage | Why conditional | Extra budget, if needed |
| --- | --- | --- | --- |
| Muse → muse-lsl → pylsl → our backend | [muse-lsl](https://github.com/alexandrebarachant/muse-lsl) (BSD-3-Clause); [pylsl](https://github.com/labstreaminglayer/pylsl) (MIT) | Exact Muse generation/OS/Bluetooth compatibility must be tested; two processes instead of direct acquisition | Add 6–12 hours for adapter and stream setup if it replaces BrainFlow route |
| Vendor app → LSL → our backend | [pylsl](https://github.com/labstreaminglayer/pylsl) | Only if vendor software can emit usable LSL; check channels/units/time metadata and reconnect | Add 6–12 hours; vendor app availability separate |
| EMOTIV → Cortex SDK → backend | [Official Cortex getting-started](https://emotiv.gitbook.io/cortex-api) | Official docs distinguish EEG streams and access/licenses; cannot assume raw EEG access | Add 8–20 hours for authorized adapter; license/application waiting is separate calendar risk |
| Neurosity → vendor SDK → adapter | [Brainwave API](https://docs.neurosity.co/docs/api/brainwaves/) and [SDK](https://docs.neurosity.co/docs/overview/) | May provide useful raw/processed streams; test login/network/offline expectations against showcase constraints | Add 8–16 hours if chosen instead of BrainFlow |

Alternative add-ons are provisional engineering estimates; replace overlapping DATA-02 work rather than adding two complete acquisition systems. Never promise a supported headset based on brand alone. Select one route.

## Evaluated but not selected for core runtime

| Repo | What exists | Our decision |
| --- | --- | --- |
| [MNE-Python](https://github.com/mne-tools/mne-python) (BSD-3-Clause) | EEG/MEG processing, inspection and analysis | Useful optional offline plots/artifact inspection; BrainFlow+NumPy suffice for core runtime. Use [preprocessing tutorials](https://mne.tools/stable/auto_tutorials/preprocessing/index.html) as reference |
| [Timeflux](https://github.com/timeflux/timeflux) (MIT) | Real-time biosignal processing framework | Viable alternative backend architecture, but adopting it now adds framework configuration alongside our existing service |
| [EEG-ExPy](https://github.com/NeuroTechX/EEG-ExPy) (BSD-3-Clause) | Classic EEG experimental protocols; former eeg-notebooks URL redirects here | Educational experiment references; its experiments do not supply our calibration/game interaction |
| [MOABB](https://github.com/NeuroTechX/moabb) (BSD-3-Clause) | BCI algorithm benchmarking on existing datasets | Good later for comparing research methods; public-dataset accuracy does not validate our device/task/population |
| [NeuroKit2](https://github.com/neuropsychology/NeuroKit) (MIT) | Broad physiological-signal processing | Adds overlapping analysis tools without a demonstrated MVP need |
| [OpenBCI game tutorial](https://openbci.com/community/build-your-own-neurofeedback-game-with-openbci/) | Prior neurofeedback-to-game architecture | Inspiration only; no dependence on its full software stack or health claims |

These are scope/fit judgments, not claims that the rejected projects are bad or unmaintained. We have not run all alternatives on the club headset.

## Reuse checklist at implementation time

Record upstream URL, release/commit, file path, license and adaptations for every copied example. Preserve notices for copied portions. Install published packages and retain lockfiles instead of vendoring large repositories. Sample art/audio requires separate asset-license checks. The club's own source license is a separate decision before public release.

Dependency plan: existing npm lockfile stays; add BrainFlow/NumPy after the hardware spike, pytest/httpx for backend behavior, and scikit-learn only for experiments. Pin Python versions after installing together on the chosen Python 3.12 environment and actual showcase OS; the current Python 3.14 smoke check does not establish BrainFlow compatibility.
