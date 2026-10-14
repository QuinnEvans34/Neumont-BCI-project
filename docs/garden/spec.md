# Glowing Garden + multiple-game selection

Status: approved concept, implementation specification; not yet implemented.
Owner: AI & Data Club. Prepared October 14, 2026 for implementation by Claude.
Read [the implementation handoff](claude-handoff.md) after this specification.

## Purpose and scope

Add a playful, visually clear garden experience alongside the existing Balance Beam game. A single plant responds immediately to the existing calibrated EEG score, and sustained above-baseline scores earn lasting growth. Users choose either game without reconnecting the headset or repeating calibration.

Deliver a working local feature, not a mockup. Preserve the existing live, recorded and simulation paths. No backend feature changes, new classifier, cloud service, accounts, medical claims, external asset downloads or new runtime dependencies are needed. Multiple selectable games are in scope; a whole landscape, many plant species, saved gardens, sound and leaderboards are future work.

The user reports that the physical-headset demo worked well. This is encouraging user feedback, not a formal validation of relaxation detection. The local workspace also contains uncommitted hardware-readiness fixes: preserve them.

## Existing input: use it unchanged

`backend/signal.py` analyzes the latest two seconds of EEG. Per included channel it computes power at 8 <= frequency < 12 Hz divided by power at 4 <= frequency <= 30 Hz, then takes the median across channels. Calibration collects 30 accepted non-overlapping two-second values:

- center = median(values)
- scale = 1.4826 × median(abs(values - center))
- target = clamp(0.5 + (relative_alpha - center) / (6 × scale), 0, 1)
- published score = 0.8 × previous score + 0.2 × target

This is an experimental relative-alpha mapping, not a stress, health or intent classifier. The baseline stays fixed until explicit recalibration. Higher published scores correspond to more relative alpha compared with calibration, with smoothing lag. Do not invert the formula or adapt the baseline during the garden.

Garden consumes the existing frame `score` in [0,1], quality and calibration flags, plus existing telemetry for session identity and evidence. It must never fetch EEG independently or create a second acquisition/WebSocket client. Simulation already generates a score and bypasses calibration; it must remain clearly labeled as having no headset/EEG.

## User flow and navigation

Use four top-level steps: **Connect → Calibrate → Choose a game → Play**. Rename beam-specific shared copy such as “Ready to balance” to “Ready to play.” Keep the project identity; no wholesale rebrand is required.

1. Connect and calibrate exactly as today. Replace the calibration page's “Start balancing” action with “Choose a game.” This navigation does not start either game.
2. The chooser shows two attractive, keyboard-accessible cards:
   - **Glowing Garden**: “Watch your signal bring a plant to life.” CTA: “Grow a garden.”
   - **Balance Beam**: “Keep the ball balanced as your signal changes assistance.” CTA: “Play Balance Beam.”
3. Garden appears first, with a small original plant illustration. Beam retains a beam-and-ball illustration. Both cards show the shared input source and readiness through the surrounding shell.
4. Allow browsing cards without usable input. Their start actions are disabled with an explanation and a link to Connect or Calibrate. Simulation is ready without a baseline, exactly as today. Do not require EEG relative-alpha values for simulation.
5. On a first game start, bind its local state to the current acquisition session ID and start it. On returning to an existing game in that session, open it paused and show **Resume garden** or the existing beam resume/replay controls. Merely navigating never starts/resumes anything.
6. Each play screen has **Change game**, **Pause / Resume**, and **Inspect baseline & signal**. Garden also has **Start new plant**. Beam retains its existing new-round behavior.
7. Change game pauses the active game and returns to the chooser. The source, sample position and baseline continue unchanged. Inactive games cannot advance their simulation or counters.
8. Recalibration resets both games because the comparison reference changes, even though the acquisition session ID stays the same. Reconnecting or switching input creates a new session and likewise invalidates both games.

## Garden screen

Use the existing dark teal/mint visual language, with warmer green leaves and a restrained gold bloom. A large central plant should dominate the scene and read clearly on a classroom projector. Draw original SVG shapes in React; this simple scene does not need Phaser or image assets. Preserve Phaser for the beam.

Desktop layout:

    Shared header: club identity                         source badge
    Connect / Calibrate / Choose a game / Play
    Glowing Garden                  Change game
    [ Large plant and soft background glow ] [ Signal level       ]
    [                                      ] [ Next growth stage  ]
    [                                      ] [ Active time        ]
    [                                      ] [ Pause / New plant  ]
    [ Last 60 seconds of game input, baseline-score marker at 50%  ]
    [ Inspect baseline & signal / expandable existing diagnostics ]

On narrow screens, stack the plant first, controls second, graph third. At 1280×800, plant and primary feedback should be visible without scrolling through raw telemetry. Test narrow 390px layout without horizontal overflow. Canvas sizing fixes already made for the beam must remain intact.

### Immediate response (reversible)

Use a single display response `v`, initialized to 0.5, distinct from accumulated growth:

    v += (score - v) × (1 - exp(-dt / 0.8))
    glowOpacity = 0.10 + 0.65 × v
    leafScale = 0.85 + 0.30 × v
    leafOpenDegrees = 12 + 28 × v

These are initial art parameters, not physiological quantities. Use leaf-local transforms so growing/opening leaves stay attached to the stem. Higher score opens leaves, strengthens the halo and lifts color brightness; lower score gently settles the leaves and softens the light. A change from score 0.25 to 0.75 should be clearly visible within about two seconds after the published score changes. The backend already analyzes two-second windows and smooths its output, so do not promise immediate response to mental changes.

At baseline the plant remains visible with a modest glow. Below baseline it does not die, brown, shrink its earned stem or lose earned leaves. No red failure colors, alarm, shame, wilt mechanic, countdown or loss condition. Decorative sway is subtle and optional; no flashing or screen-wide particle storms.

### Lasting growth (monotonic)

Track `growth` in [0,1], starting at zero. While the garden is actively running with usable input from its bound session:

    drive = clamp((score - 0.5) / 0.5, 0, 1)
    growth = min(1, growth + dt × drive / 90)

Growth uses the published score, not the extra display smoothing. This means 90 seconds at score 1, or 180 seconds at score 0.75, reaches full bloom. At or below 0.5, growth pauses but is never subtracted. These are deliberate game-tuning defaults; not health thresholds or a relaxation percentage. The demo simulation varies and will take longer than constant-high test input.

Three stages:

| Growth | Stage | Appearance |
| --- | --- | --- |
| 0 to < 0.33 | Sprout | Small visible stem with a pair of leaves; immediate glow works from the start |
| 0.33 to < 0.67 | Growing | Taller stem and another leaf pair, unfolding gently |
| 0.67 to 1 | Blooming | Bud opens progressively into a warm flower; full bloom at 1 |

Interpolate stem height and leaf/bloom reveal through growth; avoid jarring swaps at thresholds. All earned structures remain present at lower scores. At full bloom, keep responding indefinitely and display “Fully bloomed.” Do not stop the session or auto-reset. Offer Start new plant explicitly.

Show progress toward the next milestone (0.33, 0.67, 1), with stage-specific labels. For each interval compute `(growth - intervalStart)/(intervalEnd - intervalStart)`. At full bloom, show completion rather than a nonexistent next stage.

### Feedback and copy

- **Signal level:** published score as 0–100%, explicitly a game input. The numeric meter and graph use the same score; the plant has additional visual smoothing. Never label it “calm percentage.”
- **Relative to baseline:** for live/replay, label the actual current relative-alpha value against telemetry baseline center ± 0.25 × baseline scale: Below / Near / Above baseline. This describes the current feature; it can briefly differ from the smoothed score. If those values are unavailable or input is invalid, show an em dash. For synthetic input, show “Simulation input — no EEG baseline.”
- **Growth:** stage and next-stage progress; distinct from Signal level so users understand why a dimmer plant retains its leaves.
- **Active time:** only advances while this garden is running with valid input. No countdown.
- **Recent signal:** timestamped score history for the last 60 seconds of wall time, bounded to about 240 points at 4 Hz. Show a 50% score guide (label “Baseline score” for EEG, “Demo midpoint” for simulation). Gap invalid/paused intervals rather than drawing fabricated measurements or a continuous line across an outage. Do not repeat a single stale score to create apparent live evidence. Keep raw feature/waveform graphs in existing diagnostics; those are different quantities.
- **Source and quality:** always distinguish Live Cyton / Recorded EEG / Simulation. Reuse playback position and connection evidence from SignalPanel; do not hide or replace its verification with plant animation.
- Suggested help: “Higher relative alpha compared with your baseline increases the glow. Sustained higher input grows the plant. Growth is yours to keep during this session.”
- Footer: “Experimental signal-driven experience. This is not a validated measurement of stress or health.”

## Session and failure behavior — required

Shared acquisition stays owned by App (or a single extracted shared hook). A garden tick is permitted only when: selected game is garden, page is play, user has started/resumed, tab is visible, connection is fresh, `isUsable(...)` is true, and the game session ID matches fresh telemetry. Preserve the beam's equivalent guards.

| Event | Required result |
| --- | --- |
| Manual Pause / navigation away / Change game | Freeze active time, growth and response; retain local state; explicit resume |
| Poor quality / stale samples / WebSocket loss | Freeze immediately on detection; show a reason; retain earned growth; no automatic resume |
| Valid data returns, same session | Resume becomes enabled; wait for click |
| Recording EOF | “Recording finished”; frozen garden, no loss; reconnecting playback requires new calibration |
| New session ID, including another viewer changing source | Pause and invalidate both games' progress; cannot resume a garden using the old baseline |
| Explicit recalibration within same session | Pause and reset both games; wait for successful calibration; also handle recalibration initiated by another viewer, detected via telemetry transition |
| New plant | Reset garden state/history only; preserve stream and baseline; start immediately only if input is usable and not busy, otherwise disable the action |
| Tab hidden / laptop sleeps | Pause; never accumulate catch-up growth; explicit resume on return |
| Full bloom | Keep running/responding, growth capped at 1; no auto-win |
| Reload browser | Garden/beam progress resets; existing backend acquisition can be discovered as today |

Transient missing telemetry must not be mistaken for a new session and erase progress. Only act on an observed changed non-null session ID or explicit/detected recalibration. Distinguish a temporary outage from a deliberate new source. While paused, freeze plant response too; a paused badge must not leave animated signal feedback looking live. Reduced-motion mode removes decorative sway/pulsing and uses gentle or immediate state changes while retaining visible feedback.

No localStorage/database persistence in v1. Keep both games' state in the app's in-memory session. The beam can remain mounted, as today, to preserve its Phaser state. Never feed the beam's `stats.assistance` into the garden: that value includes beam-specific settling/physics.

## Architecture and boundaries

Existing files to reuse:

| File | Responsibility |
| --- | --- |
| `apps/web/src/App.tsx` | One connection, navigation, commands, freshness/session checks and current beam controls |
| `apps/web/src/input.ts` | InputFrame, parseFrame and isUsable; preserve malformed/stale rejection |
| `apps/web/src/SignalPanel.tsx` | Telemetry, source labels, recording evidence, EEG and feature views |
| `apps/web/src/Game.tsx` | Existing Phaser beam, Controls `{ running, score, reset }`, stats callback |
| `apps/web/src/simulation.ts` | Existing beam simulation; do not change its tuning |
| `apps/web/src/style.css` | Shared visual system and beam canvas containment |
| `backend/main.py`, `backend/signal.py` | Shared stream, session identity, calibration and score; no planned changes |

Suggested additions (names may change for a clearly better fit):

- `games/catalog.ts`: typed `GameId = 'garden' | 'balance'` and labels/descriptions. A small registry, not a plugin framework.
- `GamePicker.tsx`: two accessible game cards, disabled/start/continue states.
- `Garden.tsx`: SVG scene plus its presentation; start/stop animation loop cleanly.
- `gardenSimulation.ts`: pure initial-state and timestep functions, constants and milestone progress calculation.
- `GardenFeedback.tsx`: score, stage, graph and status; split only if it keeps Garden readable.
- `tests/garden.test.ts`: deterministic model tests.
- A small pure game-session transition helper and tests if extracting orchestration makes lifecycle behavior testable.

Keep render timing separate from signal arrival timing. Read current controls through refs or a safe equivalent so a scheduled animation cannot keep using an old valid score after pause. Cancel requestAnimationFrame on cleanup; avoid duplicate loops under React StrictMode. Bound per-tick dt to at most 0.1 seconds, reset timing on resume, and pause on visibilitychange to avoid background catch-up. Model state must be time-based, not frame-count-based. Retain a single owner for each game's state; do not mount/unmount a stateful game in a way that loses progress unintentionally.

## Acceptance criteria

- Existing Connect/Calibrate/recording evidence still work; both game cards are reachable and visually distinct.
- No backend connect/calibrate request is triggered by choosing or switching games.
- Same acquisition session ID and increasing sample counter persist across beam → garden → beam.
- Garden visible in simulation without headset or calibration; source stays explicitly labeled.
- Score 0.75 visibly opens/brightens the plant compared with 0.25; animation is smooth and the scene fits desktop/mobile layouts.
- Fixed-score deterministic tests demonstrate the growth rates and permanent earned growth specified above.
- Every failure/navigation event follows the table, including cross-viewer session changes and recalibration.
- Graph, numerical score and baseline label are honestly labeled and do not fabricate EEG for simulation or outages.
- Beam still falls from either end, has no 60-second win, preserves its existing input mapping and pauses on signal failure.
- Controls support keyboard focus; charts have text equivalents; reduced-motion preference is respected; plant is not the sole indicator of connection state.
- All existing and new tests pass; production build succeeds. No recordings or generated build output are committed.

## Later ideas — explicitly not v1

Multiple plants/species, a whole landscape, saved gardens, ambient audio, guided breathing, challenges, alternative EEG features and validated models. First ship one polished responsive plant and a safe shared game-selection flow.
