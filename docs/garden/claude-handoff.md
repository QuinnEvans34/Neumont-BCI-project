# Claude implementation handoff

## Copy/paste this into Claude Code

```text
Work in /Users/quintonevans/Documents/ChatGPT/BCI.
Implement docs/garden/spec.md using the phased plan in docs/garden/claude-handoff.md.
This is an implementation request: build the Glowing Garden game and a shared game picker alongside the existing Balance Beam. Complete the UI, lifecycle integration, meaningful tests and documentation. Do not stop after making a plan.
Read applicable repository instructions and inspect git status before editing. Preserve existing uncommitted work, especially backend packet-continuity fixes and hardware-review docs. Keep the existing acquisition, calibration, score calculation and beam gameplay intact. Use React/TypeScript and original SVG for the garden, with no new runtime dependencies. Reuse the single existing connection and session.
Make routine implementation choices yourself within the spec. Test the feature with explicit simulation and recorded EEG if available; never claim hardware verification without a headset. Use available browser tooling to inspect desktop/mobile layouts and game-switching behavior. If browser tooling is unavailable, report that limitation and give the exact remaining manual checks.
Finish with files changed, checks actually run, known limitations and launch instructions. Do not push, deploy, upload recordings, or add cloud services. Do not overwrite or discard existing changes. Ask only if a real blocker prevents implementation.
```

This handoff is intended for Claude Code opened in the repository. Claude's web chat alone does not automatically have access to these local files. If using a desktop workflow, grant it access to this folder and ensure it can run the local development commands.

## Read first

1. Applicable AGENTS.md / CLAUDE.md if present, then `git status --short` and `git diff`.
2. `docs/garden/spec.md` — authoritative for this new feature.
3. `README.md`, `CONTRIBUTING.md`, `docs/replay-and-connection.md`.
4. `apps/web/src/App.tsx`, `Game.tsx`, `simulation.ts`, `SignalPanel.tsx`, `input.ts`, `style.css`.
5. `backend/signal.py` and session handling in `backend/main.py` for context only; existing `tests/core.test.ts` and backend tests.

Older blueprint documents describe earlier plans. For the existing working implementation use current code; for Garden use the new specification. Do not revive removed manual sliders or a 60-second beam win condition.

At handoff preparation, `backend/main.py`, `backend/test_sessions.py`, `backend/test_signal.py`, and `docs/replay-and-connection.md` already had uncommitted changes. `docs/hardware-readiness-2026-10-09.md` was untracked. These are legitimate earlier work, not cleanup targets. Inspect actual status rather than assuming it remains identical.

## Implementation plan

Estimates below are focused developer effort, including initial checks, not promises about Claude execution time. Expect roughly 10–17 hours for a complete first version; visual polish and unexpected integration problems can add time.

### 1. Establish a baseline and map state (0.5–1 hour)

Run existing tests/build, inspect navigation and acquisition ownership, and record existing failures before touching code. Use already installed dependencies when available. Identify which current App state is beam-specific (`stats`, `hasRound`, `reset`, round session) and which state must stay shared (WebSocket, frame, telemetry, source, calibration and freshness).

Exit: a short implementation checklist and a concrete state ownership decision. No backend redesign.

### 2. Add selection and safe lifecycle orchestration (2–3 hours)

Add a typed game catalog and chooser. Expand Page navigation with choose. Replace calibration's direct beam start with chooser navigation. Keep per-game progress/reset/session binding and a single active game. Route shared input to only the active visible game. Preserve beam mounting or deliberately persist/restore its state; do not silently reset when switching.

Implement pause/resume, session-change invalidation and recalibration invalidation before visuals. An unchanged session ID is not sufficient to prove an unchanged baseline: watch fresh telemetry's calibrating/calibrated transitions for other-viewer recalibration as well as local commands. Missing telemetry pauses but does not erase progress. Hook visibilitychange so returning from a background tab requires Resume.

Exit: picker can start beam; changing screens cannot reconnect, recalibrate or accidentally run a hidden game. A placeholder Garden panel is acceptable only for this milestone.

### 3. Implement deterministic garden behavior (1–2 hours)

Create pure garden model helpers using the exact initial mapping, smoothing and growth formulas from the spec. Define state for growth, visual response, active seconds and any derived stage/progress. Keep score history separate from render ticks. Reject or freeze on invalid controls through shared gating; defensively prevent nonfinite values from poisoning state.

Tests should verify outcomes, not mirror each line of implementation:

- Zero growth for scores <= 0.5; 0.75 reaches bloom after about 180 active seconds; 1 reaches it after about 90.
- Lower scores preserve earned growth; growth stays within [0,1].
- Pause freezes elapsed time, response and growth; reset restores initial state.
- Compare 30/60/120 Hz stepping at the same duration within reasonable numerical tolerance.
- Signal/visibility/session guards block advancement, including a future return from a long hidden-tab interval.
- Multiple stage thresholds produce correct next-stage progress and full-bloom state.

Exit: testable model independent of DOM/Phaser.

### 4. Build plant and feedback UI (3–5 hours)

Draw an original SVG sprout/stem/leaves/bud/flower with stable leaf attachment points. Implement display glow/openness and lasting stem/leaf/bloom growth separately. Add a restrained backdrop, accessible controls, score meter, baseline relation, active time, next-stage progress and bounded 60-second input chart. Reuse existing SignalPanel for inspectable evidence, preferably below or expandable from the main experience.

Publish a short explanation of why the plant can dim but keep earned leaves. Keep simulation text distinct. Implement reduced-motion styling and a readable disabled/paused state. Do not spend this milestone adding multiple species, elaborate particle systems or external art libraries.

Exit: a recognizable, attractive plant reacts to simulation, changes stages, and remains readable at 1280×800 and 390px width.

### 5. Integrate and exercise failure paths (2–4 hours)

Run both services, test with simulation first, then available recording playback. Capture browser evidence when tooling permits. Do not change the actual backend score generation just to make the garden look more active. For accelerated growth verification use model tests or test-only injected controls, not a hidden production override.

Perform the manual matrix below, then add targeted lifecycle regression tests for any fixes. Preserve existing beam tests and native SDK playback tests. Make sure inactive games/graphs do not create unbounded histories or animation loops.

Exit: every required matrix row is verified or explicitly listed as unverified with its reason; no known blocker is concealed behind a successful unit test.

### 6. Document and hand back (0.5–1 hour)

Update README with the new Connect → Calibrate → Choose → Play flow, Garden description and a link to the spec. Add a concise implementation/verification note in `docs/garden/verification.md`: date, commands/results, observed browser checks, unavailable checks and limitations. Clearly distinguish implementation facts from intended behavior.

Finish with exact launch commands and any known gaps. Keep changes local for review; no push/deployment was requested in this handoff.

## Manual verification matrix

| Scenario | Expected proof |
| --- | --- |
| Backend offline | Chooser can be browsed, starts disabled, useful message; no moving “live” plant |
| Simulation | Garden starts without EEG baseline, source labeled simulation; glow follows varying score |
| Replay calibration | Thirty valid windows complete; chooser and garden retain session ID/position/baseline |
| Garden → chooser → beam → garden | Session unchanged; source sample count grows; garden progress retained and paused until Resume; inactive beam/garden freezes |
| Local Pause and Resume | Active time and growth stay fixed while paused; no catch-up on resume |
| Browser tab hidden then restored | Paused; no jump in time/growth; explicit Resume |
| Poor input / backend stopped | Freeze after freshness/quality detection; no invented growth or loss; graph gap |
| Recovery in same session | Earned progress remains; Resume required |
| End of recording | Recording finished message, growth preserved, disabled Resume |
| Source reconnect/change | Previous games invalidated; no reuse of old baseline/progress |
| Recalibrate same session | Both games reset even though session ID stays the same |
| Second viewer changes/recalibrates session | First viewer pauses/resets appropriately from fresh telemetry |
| New plant | Only garden resets; acquisition ID and calibration remain unchanged |
| Full bloom | No win/end; visible score response continues; Start new plant works |
| Beam regression | Falls off, endless timing, stale pause and retry all still work |
| Desktop/mobile/accessibility | No chart/canvas overlap; readable primary feedback; keyboard controls and reduced motion work |

For disruption tests, do not interrupt a real participant session without coordination. A second local viewer and simulation/replay suffice for most checks. Physical EEG testing is optional and should be described only if actually performed.

## Commands

From the repository root, in separate terminals:

```sh
# Backend; reuse the existing virtual environment
source .venv/bin/activate
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

```sh
# Frontend
npm run dev -- --strictPort
```

Open http://127.0.0.1:5173/. Check for existing listeners before starting duplicate servers. If dependencies are missing, follow README installation steps; do not recreate a working environment unnecessarily.

```sh
npm test
npm run build
.venv/bin/python -m unittest discover -s backend -p 'test_*.py'
git diff --check
```

At the previous readiness review, 26 backend tests and 3 frontend tests passed; rerun rather than assuming that is still true. The production build had a known large Phaser chunk warning. No need to redesign bundling to complete Garden.

## Completion checklist

- [ ] Original beam and all three input sources preserved.
- [ ] Game chooser implemented; no second connection or per-game calibration.
- [ ] Garden model, SVG visuals and feedback implemented to spec.
- [ ] Switching, pausing, visibility, EOF, new session and same-session recalibration verified.
- [ ] Source labels, experimental claims and simulation treatment are accurate.
- [ ] Existing and new tests/build pass; actual browser results documented.
- [ ] README updated; verification note added; unrelated local work preserved.
