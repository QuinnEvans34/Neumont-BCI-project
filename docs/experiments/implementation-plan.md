# Experiment implementation plan

Implement [spec.md](spec.md). Use the [Claude prompt](claude-prompt.md). Goal: both pages operational enough for next-class testing, with exported evidence and honest limitations.

## Establish the baseline

Inspect git status and applicable repository instructions. Read App.tsx, GamePicker.tsx, games/catalog.ts, games/lifecycle.ts, SignalPanel.tsx, input.ts, backend/main.py, backend/signal.py and existing tests. Preserve unrelated work.

Last local check on October 14: 18 frontend tests, 26 backend tests and production build passed, with the existing Phaser size warning. Rerun rather than assuming this remains true. No live SSVEP performance or physical display timing has been verified.

## Delivery phases

Estimated focused developer effort: 20–32 hours plus physical testing, not a promise about AI execution time. Prioritize recording and genuine diagnostic scores over decorative polish.

| Phase | Work | Exit condition | Estimate |
| --- | --- | --- | --- |
| 1. Shared shell | Two cards, setup screens, per-experience readiness, Stop/navigation/visibility handling | Experiments bypass alpha calibration; existing games retain it; no automatic stimulation | 2–3 h |
| 2. Recording and ownership | Full-rate acquisition fan-out, bounded writer, experiment/session/owner IDs, heartbeat, event API and clock alignment | Sample/event counts accounted for; interruptions and failed writes recorded; one BrainFlow reader | 4–6 h |
| 3. Bilateral page | Three phases, side-change settings, instruction condition, EEG/timeline/descriptive metrics | Run completes or stops cleanly and exports inspectable phase records | 2–3 h |
| 4. SSVEP presentation | Display preflight, frame-driven cards, timing logs, cued/neutral trials and breaks | Requested cycles verified; unsupported refresh/dropped frames fail visibly | 3–5 h |
| 5. Decoder and output | CCA, channel mapping, window quality, spectrum/correlations, separate threshold setup/evaluation | Genuine computed output, no cue leakage, diagnostic-only/abstain when appropriate | 4–7 h |
| 6. Integration | Browser checks, export inspection, failures/concurrent viewers, existing-game regression, documentation | Another member can operate both pages; unperformed checks clearly listed | 5–8 h |

Add tests alongside each phase. Use deterministic multichannel fixtures for numerical tests, and the actual backend for lifecycle/recording checks. Do not use a scripted UI prediction as decoder validation. Keep related trials together in evaluation splits. Verify no duplicate timers/listeners under React StrictMode.

## Next-class sequence

1. Confirm the known-working Cyton connection and give our app sole ownership. Record electrode map/reference and a participant pseudonym.
2. Run one bilateral protocol with a recorded instruction condition. Export and inspect sample counts and phase events; consider eye movement artifacts before interpreting changes.
3. Check posterior contacts and display timing for SSVEP on the actual display.
4. Run setup trials with breaks. If scores are indistinguishable, inspect contact, artifacts and timing rather than lowering thresholds until a command appears.
5. Freeze settings and run separate evaluation including neutral trials. Report correct/incorrect selections, abstentions, invalid trials and false activations per participant.
6. Test Stop, disconnect and restart; confirm partial recordings survive.
7. Return to Garden/Beam and confirm normal flow. Record checks that remain unfinished.

## Commands

From the repository root:

    npm test
    npm run build
    .venv/bin/python -m unittest discover -s backend -p 'test_*.py'
    git diff --check

Backend terminal:

    .venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000

Frontend terminal:

    npm run dev -- --strictPort

Open http://127.0.0.1:5173/. Reuse running services where appropriate. Avoid recreating the working environment unnecessarily. Isolate optional dataset tooling if dependencies conflict.

## Handover

Create docs/experiments/verification.md with what was built, exact commands/results, observed browser checks, export checks, limitations and operator instructions. Explicitly distinguish simulated, recorded and live evidence. No claim of headset or photodiode validation unless performed.

Suggested commits follow phases: shared shell; recorder/events; bilateral page; SSVEP timing; CCA/output; integration/tests/docs. Keep commits buildable where feasible. Do not commit recordings, identifiers, secrets or generated bundles. Do not push/deploy without request. Report incomplete requirements instead of concealing them behind success states.
