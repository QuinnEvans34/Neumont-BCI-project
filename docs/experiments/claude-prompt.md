# Copy/paste prompt for Claude Code

Copy everything below the divider into Claude Code opened in this repository.

---

Work in /Users/quintonevans/Documents/ChatGPT/BCI (Neumont-BCI-project).

Implement two new experiences alongside Glowing Garden and Balance Beam:

1. Bilateral Visual Stimulation: alternating left/right visual cues, live EEG observation and local raw-data/event recording.
2. SSVEP Cards: three stationary cards changing brightness at known frequencies, with genuine raw-EEG decoding and visible correlation scores, candidate and accepted-selection-or-abstain output.

Read docs/experiments/spec.md and docs/experiments/implementation-plan.md in full. These define the requirements. Also read applicable AGENTS.md/CLAUDE.md, README.md, docs/p300-ssvep-research.md and relevant existing code. Inspect git status and preserve unrelated work.

This is an implementation request: build both usable pages, backend integration, exports, meaningful tests and verification documentation. Do not stop after writing another plan. Make routine implementation decisions within the spec; ask only if a real blocker or unresolved conflict prevents progress.

Important boundaries:

- Bilateral means alternating visual cues, not a P300 classifier or therapeutic EMDR feature. Do not invent relaxation or left/right brain-activation scores.
- Add experiment cards to the shared chooser. Opening a card never starts stimulation. Experiments bypass the alpha baseline and have separate prerequisites; preserve the existing games' requirements.
- Use full-rate samples from the existing single acquisition producer. Do not decode the alpha score or downsampled chart data. Never add a second reader draining BrainFlow.
- Preserve software versus optical timing distinctions. Use the specified preflight and frame-based schedule, log failures, and never claim a browser callback proves emitted-light timing.
- Implement actual CCA, not scripted predictions. Instructed targets are evaluation labels, never decoder inputs. Similarity scores are not probabilities. Without usable thresholds, remain diagnostic-only and abstain.
- Provide explicit Start, flicker notice and Stop/Escape. Stop on navigation, hidden tabs, stale data, ownership loss and timing failure. Never automatically resume.
- Record full-rate EEG, events, timing/configuration and predictions locally outside Git. Clearly label live, simulated and replay modes. Existing resting recordings cannot verify a new stimulus trial.
- No robot control, clinical claims, cloud services or major redesign. Keep dependencies minimal and document additions.

Follow the phased plan. Add deterministic timing/decoder tests and failure-path coverage, run existing and new tests plus the production build, and inspect the pages with available browser tooling. Verify saved sample/event counts and interruption behavior. Preserve Garden/Beam calibration, switching, audio isolation and playback behavior.

If hardware, optical-timing, public-data or browser checks cannot be performed, mark them unverified. Do not fabricate successful results or present a placeholder as live analysis.

Create docs/experiments/verification.md covering implementation, actual checks/results, limitations and next-class operating instructions. Update README. Organize work into clear commits if available, but do not push/deploy or upload recordings without the user's request.

Finish with implemented features, files changed, checks run, remaining limitations and exact launch/test instructions. The goal is a trustworthy prototype for investigation with the Cyton next class, not a promise of classifiable responses from every participant.
