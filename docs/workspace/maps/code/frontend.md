# Frontend components and function paths

[Open PDF atlas](../visual-maps.pdf#page=11) | [Open in browser](../visual-maps.html#diagram-10)
[Map index](../README.md) · [Player journey](../flows/player-journey.md) · [Recording](../data/recording-and-review.md)

## Entry points and component ownership

![Entry points and component ownership](code-visuals/frontend-entry-points-and-component-ownership.svg)

[Open full-size SVG](code-visuals/frontend-entry-points-and-component-ownership.svg)

<details>
<summary>Editable Mermaid source</summary>

```mermaid
flowchart TD
    entry["main.tsx: createRoot + StrictMode"] --> dev{"Development preview query?"}
    dev -->|"garden-preview"| gp["GardenPreview"]
    dev -->|"cairn-preview"| cp["CairnPreview"]
    dev -->|"Neither"| app["App: page, source, telemetry, shared sessions"]
    app --> setup["Connect / Calibrate: SignalPanel, ContactCheck, ScoringChannels, GateSlider"]
    app --> picker["GamePicker + games/catalog"]
    app --> garden["Garden"]
    app --> cairn["Cairn"]
    app --> balance["Game: Balance Beam"]
    app --> experiments["BilateralExperiment / SsvepExperiment / SsvepCircle"]
    app --> visualizer["Visualizer"]
    app --> research["ResearchBar + useResearch"]
    research --> review["Review overlay"]
    garden --> svg["GardenScene: SVG + gardenAudio"]
    cairn --> phaser["CairnStage: Phaser"]
    balance --> scene["BalanceScene: Phaser"]
    gp --> svg
    cp --> phaser
```

</details>

The normal page state is `setup`, `calibrate`, `choose`, `play` or `visualizer`. The initial `#visualizer` hash opens Visualizer directly. Research controls and Review are overlays around this flow, rather than separate acquisition sessions. Dev preview queries are enabled only when `import.meta.env.DEV` is true.

## From a network frame to a rendered game

![From a network frame to a rendered game](code-visuals/frontend-from-a-network-frame-to-a-rendered-game.svg)

[Open full-size SVG](code-visuals/frontend-from-a-network-frame-to-a-rendered-game.svg)

<details>
<summary>Editable Mermaid source</summary>

```mermaid
flowchart LR
    ws["App WebSocket onmessage"] --> parse["parseFrame + increasing sequence"]
    parse --> state["setFrame, setTelemetry, receipt time"]
    parse --> input["research.input: acquisition + sequence"]
    state --> usable["isUsable"]
    state --> reference["observeReference"]
    reference -->|"New session or recalibration"| invalidate["invalidateGames"]
    usable --> gate["canTick / tickBlocker"]
    gate --> controls["Current game controls / refs"]
    controls --> loop["Animation loop"]
    loop --> model["Pure model step"]
    model --> draw["Render scene + publish UI state"]
    model --> trace["CairnTrace / GardenTrace"]
    input --> trace
    trace --> log["ResearchLog event / state queue"]
```

</details>

React owns navigation and controls. Mutable refs hold the latest controls/model for animation callbacks. A missing telemetry update is treated as an outage; an observed new session or transition into calibration invalidates rounds tied to the old comparison reference.

## Game update loops

![Game update loops](code-visuals/frontend-game-update-loops.svg)

[Open full-size SVG](code-visuals/frontend-game-update-loops.svg)

<details>
<summary>Editable Mermaid source</summary>

```mermaid
flowchart TD
    frame["Display update"] --> game{"Selected game"}
    game -->|"Balance Beam"| balance["BalanceScene.update: bounded frame delta, 120 Hz accumulator"]
    balance --> bmodel["simulation.step: assistance, disturbance, ball, fall"]
    bmodel --> bview["Phaser graphics; onStats about every 100 ms"]
    game -->|"Cairn"| cairn["CairnStage.update: bounded chunks while running"]
    cairn --> cmodel["stepCairn: internal steps up to 1/120 second"]
    cmodel --> cview["Place stones / collapse / camera / sprites"]
    cmodel --> ctrace["CairnTrace.step and snapshots"]
    game -->|"Garden"| garden["requestAnimationFrame: dt capped at 0.1 second"]
    garden --> gmodel["stepGarden: response, monotonic growth, stats"]
    gmodel --> gview["GardenScene SVG, audio and breathing guide"]
    gmodel --> gtrace["GardenTrace.step and snapshots"]
```

</details>

Paused game progress does not catch up after a background-tab delay. Presentation can still finish a fall animation or settle an ambient visual; those animations do not imply gameplay time is advancing. Research state snapshots for Cairn/Garden target 20 Hz rather than copying every display frame. Balance Beam consumes the shared score but has no equivalent dedicated game-state trace class in this implementation.

| Source | Functions or behavior to follow |
| --- | --- |
| [main.tsx](../../../../apps/web/src/main.tsx) | `createRoot`; choose App or a dev preview. |
| [App.tsx](../../../../apps/web/src/App.tsx) | `refresh`, `command`, `setGate`, `invalidateGames`, `start`, `startGarden`, `requestGarden`, `startCairn`, `openGame`, `navigate`. |
| [input.ts](../../../../apps/web/src/input.ts), [lifecycle.ts](../../../../apps/web/src/games/lifecycle.ts) | `parseFrame`, `isUsable`, `observeReference`, `canTick`, `tickBlocker`. |
| [Game.tsx](../../../../apps/web/src/Game.tsx), [simulation.ts](../../../../apps/web/src/simulation.ts) | `BalanceScene.update`, `initialState`, `step`. |
| [Cairn.tsx](../../../../apps/web/src/Cairn.tsx), [CairnStage.tsx](../../../../apps/web/src/CairnStage.tsx), [cairnSimulation.ts](../../../../apps/web/src/cairnSimulation.ts) | Round UI/history, Phaser renderer, `initialCairn`, `stepCairn`, events and fall thresholds. |
| [Garden.tsx](../../../../apps/web/src/Garden.tsx), [gardenSimulation.ts](../../../../apps/web/src/gardenSimulation.ts), [GardenScene.tsx](../../../../apps/web/src/GardenScene.tsx) | Settle-in/plant lifecycle, `stepGarden`, `drive`, `stageOf`, `visuals`, SVG presentation. |
| [cairnTrace.ts](../../../../apps/web/src/research/cairnTrace.ts), [gardenTrace.ts](../../../../apps/web/src/research/gardenTrace.ts) | Model transitions, pause/resume, settings, state snapshots and partial recording starts. |
| [cairnScores.ts](../../../../apps/web/src/cairnScores.ts), [gardenPrefs.ts](../../../../apps/web/src/gardenPrefs.ts) | Browser-local records/preferences; separate from backend research files. |
| [visualizer/model.ts](../../../../apps/web/src/visualizer/model.ts), [Visualizer.tsx](../../../../apps/web/src/visualizer/Visualizer.tsx) | `useLiveData`, live/recorded/compare/table views. |

Experiment presentation and its owner-side session hook have a separate [experiment map](../flows/experiments.md).
