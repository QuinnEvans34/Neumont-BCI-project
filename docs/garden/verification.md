# Glowing Garden: implementation and verification notes

Date: October 14, 2026. Implemented by Claude from [spec.md](spec.md) and [claude-handoff.md](claude-handoff.md).

## What was built

| File | Purpose |
| --- | --- |
| `apps/web/src/gardenSimulation.ts` | Pure, time-based model: display response (τ = 0.8 s), monotonic growth (`drive / 90` per second), stages and milestones, baseline relation (center ± 0.25 × scale), bounded 60 s history |
| `apps/web/src/GardenScene.tsx` | Original SVG scene: dusk sky, sun that rises with the signal and earned growth, hills, ferns, grasses, lantern flowers and ground flowers that light up as growth is earned, fireflies, and the central plant (tapered stem that bends from the base, four leaf pairs on leaf-local transforms, an unfurling tip, a bud that opens into a two-ring gold flower) |
| `apps/web/src/Garden.tsx` | Play screen: render loop (rAF only while shown, dt ≤ 0.1 s, timing restarts after pause), feedback panel, 60 s signal chart with gaps, paused overlay, reduced-motion support |
| `apps/web/src/GamePicker.tsx` | Accessible chooser with a still frame of the real garden and the beam illustration; disabled start with explanation and links to Connect/Calibrate |
| `apps/web/src/games/catalog.ts` | Typed `GameId` registry |
| `apps/web/src/games/lifecycle.ts` | Pure helpers: detecting a new session or recalibration from fresh telemetry, and the tick gate used by both games |
| `apps/web/src/App.tsx` | Four-step flow, single shared connection, per-game session binding, pause on navigation, visibility, stale input, session change and recalibration |
| `apps/web/src/GardenPreview.tsx` | Development-only art preview (`?garden-preview`, `?garden-preview&demo`); excluded from production builds (checked by searching `dist/`) |
| `tests/garden.test.ts` | 11 deterministic model and lifecycle tests |

No backend, acquisition, calibration, score or beam-physics code was changed. No runtime dependencies were added. A `vite-env.d.ts` reference was added for `import.meta.env`.

## Design decisions beyond the spec

- **Lighting is the immediate feedback; structure is the earned feedback.** The response drives sky warmth, the sun's brightness, the plant halo, leaf brightness/opening and firefly brightness. Earned growth drives stem height, leaf pairs, bud/bloom, how many lantern and ground flowers are lit, how many fireflies exist, and part of the sun's height. A dip therefore dims the garden but never removes anything.
- **Breath-paced sway.** Decorative wind is a slow wave (about 7.5 s period) that travels across the garden. It eases to a stop when paused, so a paused garden never looks live, and it is disabled under `prefers-reduced-motion`.
- **Sun height** uses an extra-smoothed copy of the response (τ = 2.5 s) so it rises and sets calmly rather than tracking every frame.
- The garden starts paused with a **Start growing** call to action only if opened without starting. Starting from the chooser starts immediately; returning from the chooser opens paused.

## Round 2 additions (same day)

| File | Purpose |
| --- | --- |
| `apps/web/src/breath.ts` | Shared breath clock: 4 s in, 6 s out, eased lung level. Drives sway, the guide ring and the wind sound so they stay in step |
| `apps/web/src/gardenAudio.ts` | Web Audio synthesis: detuned D-major add9 pad (low-pass opens with the glow), shimmer above baseline, breath-paced filtered pink noise, bell chimes, convolution reverb, limiter. Fades to silence when not live |
| `apps/web/src/gardenPrefs.ts` | Validated per-browser preferences (sound, volume, guide, settle-in, pace, target minutes) and the plant log, with CSV export |
| `Garden.tsx` / `App.tsx` | Settle-in flow (`requestGarden` → intro → `startGarden`), breath cue, settings switches, facilitator panel |
| `gardenSimulation.ts` | `stepGarden` takes a pace (clamped 30–600 s, default 90) and accumulates stats (time above baseline, mean score, drive, stage times); `paceInsight` projects typical bloom time and suggests a pace |

Design notes:

- **Settle-in** is 34 s so it ends exactly after two guided breaths; the breath clock is re-aligned when it starts. No growth, history or log time accrues during it. The old plant is archived and cleared when it begins, and the new plant binds to the session only when growth starts. Change game cancels it.
- The jaw, eyes and stillness prompts are there because muscle and eye movement are common EEG artifacts, not as a relaxation claim.
- **Pace tuning:** with `driveRate` = average growth drive per active second over logged plants, typical bloom time = pace / driveRate, so the suggested pace for a target of *T* minutes = 60·T·driveRate. EEG plants are used when any exist; simulation-only data is labeled as such.
- Audio starts only after a user gesture, as browsers require. If sound was left on, the next click or key press resumes it.

## Checks actually run

Run in a Linux cloud workspace on a copy of the repository (the Mac's `node_modules` are macOS builds, so nothing was run against them):

| Command | Result |
| --- | --- |
| `npm test` | 18 pass (3 existing + 15 new), 0 fail |
| `npm run build` | Success; the existing large Phaser chunk warning remains |
| `python -m unittest discover -s backend -p 'test_*.py'` (Python 3.13) | 26 tests OK |
| `tsc --noEmit` | Clean |

Browser checks with headless Chromium (Playwright) against the real backend in **Simulation** mode at 1280×800 and 390×844:

| Scenario | Observed |
| --- | --- |
| Connect → Calibrate → Choose a game → Garden | Works; source labeled "Simulation · no headset" throughout |
| Choosing/switching games triggers backend commands | None: the only POSTs were the test's own connect/disconnect calls |
| Pause | Active time stayed at 0:12 over 3 s |
| Resume | Time advanced again with no jump |
| Garden → chooser → Balance Beam → garden | Garden time frozen while beam ran; garden returned paused, retaining progress |
| Hidden tab (simulated visibilitychange) | Paused; no catch-up; explicit Resume required |
| Start new plant | Growth and time reset to 0; stream untouched |
| Another viewer reconnects (new session via API) | Garden reset to "Plant a seed." |
| Backend disconnect | Garden froze with "Disconnected. No signal is streaming."; Resume disabled; growth kept |
| 390 px width | No horizontal overflow; scene, controls and chart stack |
| Console | No application errors (font loading is blocked in the sandbox) |
| Settle-in | Three steps shown in order; no active time accrued; ended into live growth; **Begin now** skips; Change game cancels; switching it off starts immediately |
| Breathing guide | Ring and cue appear with "Follow the light" and during play; fade out when switched off or paused |
| Sound | Enabled from the switch; recorded the mix from the dev preview (mean −24.5 dB, peak −8.1 dB at 80% volume); chimes and swells audible in the exported demo |
| Facilitator panel | Preset changed pace; plants archived on new plant (2 rows); note saved; CSV downloaded; insight labeled "simulation only" |
| Reduced motion | No sway or firefly drift; guide ring pulses in brightness at a fixed size |
| Preferences | Persisted across reload in localStorage |

## Not verified

- **Recorded EEG replay and real calibration.** No recordings were available in the test workspace, so replay calibration, the Near/Above/Below baseline labels against real telemetry, same-session recalibration in a browser, and recording EOF were not exercised end to end. The logic is covered by unit tests (`observeReference`, `baselineRelation`) and by the shared `streamMessage` path.
- **Live Cyton headset.** Not tested; no hardware.
- **Beam canvas in headless Chromium.** The Phaser canvas renders at 0×0 when the beam is opened in headless Chromium. The original, unmodified code does the same, so this is a headless-environment behavior, not a regression. Please confirm the beam still renders in a normal desktop browser.
- Real-device performance on a classroom projector, and keyboard-only navigation beyond focus styles.
- Sound on real speakers (Safari/Chrome on macOS). It was verified only by recording the mix in headless Chromium.
- Whether the breathing guide or sound changes participants' relative alpha. Treat sessions with and without them as different conditions when tuning, and use the plant note to record which was used.

## Remaining manual checks

1. Replay a recording, calibrate, play the garden for a few minutes, then **Recalibrate** on the Calibrate page. Both games should reset.
2. Open a second browser window and recalibrate there. The first window's garden should pause and reset.
3. Let a recording reach its end while the garden runs. It should show "Recording finished", keep growth, and disable Resume.
4. Confirm Balance Beam still falls off, has no win, and pauses on stale input in a desktop browser.
