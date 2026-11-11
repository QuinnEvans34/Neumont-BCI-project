# Player journey and game lifecycle

[Open PDF atlas](../visual-maps.pdf#page=16) | [Open in browser](../visual-maps.html#diagram-15)
[Map index](../README.md) · [Signal pipeline](../data/signal-pipeline.md) · [Experiment journeys](experiments.md)

## Connect to an experience

![Connect to an experience](flows-visuals/player-journey-connect-to-an-experience.svg)

[Open full-size SVG](flows-visuals/player-journey-connect-to-an-experience.svg)

<details>
<summary>Editable Mermaid source</summary>

```mermaid
flowchart TD
    open["Open app"] --> connect["Connect page: choose input"]
    connect --> command["command(connect): POST /api/connect"]
    command --> inspect["Calibrate page: inspect data and channel checks"]
    inspect --> source{"Input / intended experience"}
    source -->|"Score-only synthetic"| ready["Game input ready without collected EEG baseline"]
    source -->|"Raw EEG game"| channels["Confirm scoring channels for live EEG"]
    channels --> baseline["Explicit Begin baseline"]
    baseline --> accepted{"30 valid windows and varying baseline?"}
    accepted -->|"No / rejected windows"| retry["Inspect reasons; wait or retry baseline"]
    retry --> baseline
    accepted -->|"Yes"| ready
    ready --> choose["Choose experience"]
    source -->|"Raw EEG experiment"| choose
    choose -->|"Garden"| garden["Optional settle-in, then start plant"]
    choose -->|"Cairn"| cairn["Choose Calm / Go; Start stacking"]
    choose -->|"Balance Beam"| balance["Start round"]
    choose -->|"Experiment"| experiment["Open setup; explicit Start later"]
    open --> visualizer["Visualizer via navigation or initial #visualizer"]
```

</details>

The map shows a common journey, not a forced page wizard: navigation can open Choose or Visualizer independently. Experiment setup can open without ready input; its Start button has separate raw-EEG requirements. Calibrate is unnecessary for experiments. Opening a game never reconnects or rewinds acquisition.

## Per-game lifecycle

![Per-game lifecycle](flows-visuals/player-journey-per-game-lifecycle.svg)

[Open full-size SVG](flows-visuals/player-journey-per-game-lifecycle.svg)

<details>
<summary>Editable Mermaid source</summary>

```mermaid
stateDiagram-v2
    direction LR
    [*] --> NotStarted
    NotStarted --> Playing: Start with usable input
    Playing --> Paused: Pause or interruption
    Paused --> Paused: Input becomes usable
    Paused --> Playing: Resume same session
    Playing --> Ended: Cairn or Balance fall
    Playing --> Bloomed: Garden full bloom
    Bloomed --> Bloomed: Keep observing
    Ended --> Playing: Start new round
    Bloomed --> Playing: Start new plant
```

</details>

This is a conceptual lifecycle across the games, not a single enum in the code. A new acquisition or recalibration resets every state to NotStarted; that shared reset path is shown in the interruption map below. Full bloom is a Garden milestone rather than a fall/loss; growth caps at one. A new Garden plant may include the optional settle-in. Cairn and Balance rounds end on falls; a new round resets game state while retaining a valid current session baseline.

`canTick()` requires the selected game, play page, explicit running state, visible tab, usable frame and matching bound acquisition session. When a previously started game is reopened from Choose, `openGame()` preserves its same-session state and returns it paused. A fresh Cairn opens its start prompt; a fresh Garden enters its start/settle-in flow.

## What interrupts what

![What interrupts what](flows-visuals/player-journey-what-interrupts-what.svg)

[Open full-size SVG](flows-visuals/player-journey-what-interrupts-what.svg)

<details>
<summary>Editable Mermaid source</summary>

```mermaid
flowchart LR
    outage["Socket loss / stale or poor input"] --> pause["Pause game; retain same-session progress"]
    visibility["Hidden tab / navigation"] --> pause
    pause --> resume["Fresh input + explicit Resume"]
    reconnect["Connect or change source"] --> new["New acquisition ID; baseline reset"]
    new --> reset["invalidateGames: old rounds no longer bound"]
    calibrate["Begin calibration"] --> reset
    settings["Change acceptance gate or scoring channels"] --> invalid["Invalidate baseline; require recalibration"]
    invalid --> reset
    eof["Replay reaches EOF"] --> unusable["Input unusable; reconnect to replay again"]
    unusable --> pause
```

</details>

Research capture can remain active across these game and acquisition transitions. Experiments are more restrictive: source changes, recalibration, leaving the page and other interruption conditions terminate the trial and retain its partial files. See [recording](../data/recording-and-review.md) and [experiment flows](experiments.md).

Source: [App.tsx](../../../../apps/web/src/App.tsx), [games/catalog.ts](../../../../apps/web/src/games/catalog.ts), [games/lifecycle.ts](../../../../apps/web/src/games/lifecycle.ts), [input.ts](../../../../apps/web/src/input.ts), [Service](../../../../backend/main.py).
