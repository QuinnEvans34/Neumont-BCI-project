# Component work breakdown and estimates

These are **remaining person-hours from the existing starter**, not calendar days or guarantees. Includes implementation, local debugging, targeted checks and a short review/demo. Add 25% project contingency separately. Earlier half-day task estimates were rough starters; this breakdown supersedes them. All owners remain unassigned until the meeting.

See [master blueprint](../blueprint.md) for behavior, reuse and dependencies. [CSV](tasks.csv) and [JSON](tasks.json) are machine-readable copies.

## UI — 26–42 person-hours

| ID / task | Hours | Prerequisites | Starting file or planned module | Completion check |
| --- | --- | --- | --- | --- |
| UI-01: Session flow and visual specification | 4–6 | None | `apps/web/src/App.tsx` | Four screens plus error, pause and source states; walkthrough with game/data leads |
| UI-02: Connection and calibration screens | 6–10 | UI-01, API-01 fixtures | `apps/web/src/components/ (new)` | Mocked ready/poor/failed/calibrating states and real command hooks; no headset required for UI development |
| UI-03: Play HUD and results | 6–10 | UI-01, GAME-02 | `apps/web/src/App.tsx` | Time, score, source, assistance and pause reason; result and next-visitor reset |
| UI-04: Explicit session state management | 4–6 | UI-02, UI-03, API-03 | `apps/web/src/session.ts (new)` | Transitions enforced; reconnect never silently restarts; input-mode changes reset round |
| UI-05: Accessibility and responsive polish | 3–5 | UI-03 | `apps/web/src/style.css` | Keyboard focus, non-color states, laptop/narrow layouts, offline font fallback |
| UI-06: Instructions and operator display | 3–5 | UI-04 | `apps/web/src/components/ (new)` | Visitor understands assisted mechanic; operator can inspect quality without cluttering game |

## Game — 18–30 person-hours

| ID / task | Hours | Prerequisites | Starting file or planned module | Completion check |
| --- | --- | --- | --- | --- |
| GAME-01: Tune and expose game configuration | 4–6 | None | `apps/web/src/simulation.ts` | Deterministic low/high input trials quantified; enjoyable disturbance and center-zone tuning |
| GAME-02: Round lifecycle and practice separation | 4–8 | API-01 fixtures | `apps/web/src/Game.tsx` | 60-second round; live/replay rounds ignore keyboard; pauses freeze time/score; reset is complete |
| GAME-03: Rendering and feedback polish | 3–5 | GAME-01 | `apps/web/src/Game.tsx` | Smooth beam/ball; assistance feedback and round-end presentation; no borrowed assets required |
| GAME-04: Input smoothing and latency tuning | 3–5 | DATA-05, API-03 | `apps/web/src/input.ts` | No abrupt jumps; one documented smoothing owner; measured score-to-game latency |
| GAME-05: Physics and score behavior checks | 4–6 | GAME-02 | `tests/core.test.ts` | Frame-rate invariance, boundaries, pause, reset, stale input and score bounds verified |

## Data — 40–70 person-hours

| ID / task | Hours | Prerequisites | Starting file or planned module | Completion check |
| --- | --- | --- | --- | --- |
| DATA-01: Headset inventory and feasibility spike | 4–8 | Physical headset access | `docs/blueprint/headset-spike.md` | Exact device/OS/access; continuous raw recording and reconnect, or precise blocker and alternate route |
| DATA-02: Live adapter and rolling buffer | 6–12 | DATA-01 | `backend/adapters/ (new)` | Single acquisition session; channel/rate/unit metadata; bounded buffer; clean stop/reconnect |
| DATA-03: Filtering and band-power extraction | 6–10 | DATA-02 | `backend/features/ (new)` | One documented pipeline with correct axes/sample rate; raw preserved; synthetic frequency check |
| DATA-04: Signal-quality gating | 8–14 | DATA-02, DATA-03 | `backend/quality.py (new)` | Flags missing/clipped/flat/contact/motion issues; invalid windows never advance calibration or score |
| DATA-05: Calibration and baseline input mapping | 6–10 | DATA-03, DATA-04 | `backend/calibration.py (new)` | Valid clean baseline; flat-baseline failure; normalized bounded output; repeated-person check |
| DATA-06: Raw recording, feature logs and replay | 6–10 | DATA-02, API-01 | `backend/recording.py (new)` | Raw+metadata+events saved locally; replay preserves source and timestamps; no recordings in Git |
| DATA-07: Live repeatability and controllability pilot | 4–6 | DATA-05, API-03 | `experiments/baseline/ (new)` | Repeated instructed blocks across at least 3 volunteers; usable-data fraction and artifact review; report no effect honestly |

## Backend — 22–36 person-hours

| ID / task | Hours | Prerequisites | Starting file or planned module | Completion check |
| --- | --- | --- | --- | --- |
| API-01: Protocol fixtures and schemas | 4–6 | None | `backend/models.py (new), apps/web/src/input.ts` | Input/control/status agreed; valid/poor/stale/malformed fixtures match Python and TypeScript |
| API-02: Shared acquisition service and bounded broadcast | 6–10 | API-01; DATA-02 for live | `backend/service.py (new)` | One producer for multiple clients; slow client cannot stall collection; queue sizes bounded |
| API-03: Session commands and status | 4–8 | API-01, DATA-05 for live | `backend/main.py` | Connect/calibrate/reset/stop commands acknowledged; status is truthfully synced with browser |
| API-04: Recovery and local configuration | 4–6 | API-02, API-03 | `backend/config.py (new)` | Explicit source selection; disconnect/reconnect/failure states; shutdown closes headset; backend URL configurable |
| API-05: Backend contract and lifecycle checks | 4–6 | API-02, API-03 | `backend/tests/ (new)` | WebSocket, calibration failure, duplicate sessions and disconnect checked with fixtures |

## QA — 26–42 person-hours

| ID / task | Hours | Prerequisites | Starting file or planned module | Completion check |
| --- | --- | --- | --- | --- |
| QA-01: Fresh-checkout setup and onboarding | 4–6 | None | `README.md, CONTRIBUTING.md` | Two members independently run manual and synthetic modes; supported runtime matrix documented |
| QA-02: Automated cross-component checks | 4–6 | GAME-02, API-03 | `tests/e2e/ (new), .github/workflows/checks.yml` | Playwright simulated round/source/quality/reset tests; CI backend behavioral checks |
| QA-03: Failure and performance rehearsal | 4–8 | UI-04, API-04 | `docs/blueprint/acceptance.md` | Stale/poor/reconnect/tab-hidden/input-change tested; sustained laptop FPS and packet lag recorded |
| QA-04: Visitor testing and coordinated fixes | 6–10 | Week-4 vertical slice | `docs/blueprint/acceptance.md` | Five new visitors; setup times/completion/confusion captured; UI/data owners address findings |
| QA-05: Local launch, attribution and backup demo | 4–6 | QA-01, DATA-06 | `README.md, docs/research.md` | Launch instructions/optional script; version pins and notices; labeled replay/video works offline |
| QA-06: Showcase poster and ten-round rehearsal | 4–6 | QA-03, QA-04, QA-05 | `docs/pitch.md` | Explain measurement and automation; ten consecutive rounds; reset and operator briefing |

## ML — 40–62 person-hours

| ID / task | Hours | Prerequisites | Starting file or planned module | Completion check |
| --- | --- | --- | --- | --- |
| ML-01: Collection and evaluation protocol | 4–6 | DATA-01 | `experiments/protocol.md (new)` | Repeated task blocks, counterbalancing, task markers, split plan, voluntary local recording |
| ML-02: Dataset collection and quality audit | 12–18 | ML-01, DATA-04, DATA-06 | `experiments/dataset_manifest.csv (new)` | Pilot participants/sessions collected; retained/rejected windows reported; no claimed generalization |
| ML-03: Feature baseline and classifier training | 8–14 | ML-02, DATA-03 | `experiments/train.py (new)` | Dummy + simple feature + StandardScaler/LogisticRegression; session/block-held-out evaluation |
| ML-04: Evaluation report and adoption gate | 8–12 | ML-03 | `experiments/evaluate.py (new)` | Per-session metrics, artifact/confound review, latency, balanced accuracy and live comparison |
| ML-05: Versioned inference adapter | 8–12 | ML-04 positive decision, API-03 | `backend/inference.py (new)` | Same feature order/preprocessing, local trusted artifact, fallback explicit, same input score contract |
