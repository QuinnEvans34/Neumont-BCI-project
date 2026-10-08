# React UI / UX brief

**Scope and estimates:** follow the [master blueprint](../blueprint.md) and [current task breakdown](../blueprint/work-breakdown.md). This brief supplies orientation; the numbered task cards control deliverables.

## Own

`apps/web/src/App.tsx` and `style.css`. Coordinate Game props and stream state with game/data leads. Phaser renders the scene; React owns accessible controls and text.

## Deliver

A clean connection → calibration → play → results flow. Preserve the large game stage and sparse metrics. Show source, quality/pause reason, time, and score. Give an understandable instruction before starting. Mock each state before live integration.

## First task: UI-01

Sketch these four states, list transitions, and propose which info belongs on each. No backend required. Show synthetic, live-connected, disconnected, poor quality, and calibration-failed examples. Bring screenshots or a clickable mock to the next demo.

## Next tasks

Implement explicit session states; make mode changes reset a round; hide practice keys during EEG rounds; clear participant state on reset. Add keyboard focus indicators, sufficient contrast, responsive layouts and non-color quality cues. Avoid high-rate React updates; game stats already arrive about ten times a second.

## Acceptance

A first-time visitor knows where to start. Live/simulation labeling persists on every screen. Unusable stream freezes visibly; resume/reset behavior is unambiguous. Controls work with keyboard at laptop and narrow viewport sizes. Screenshot or video + short test notes accompany the PR.
