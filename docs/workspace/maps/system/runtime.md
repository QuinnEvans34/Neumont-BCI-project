# Runtime and ownership

[Open PDF atlas](../visual-maps.pdf#page=3) | [Open in browser](../visual-maps.html#diagram-2)
[Map index](../README.md) · [Backend call paths](../code/backend.md) · [Frontend call paths](../code/frontend.md)

## Processes and connections

![Processes and connections](system-visuals/runtime-processes-and-connections.svg)

[Open full-size SVG](system-visuals/runtime-processes-and-connections.svg)

<details>
<summary>Editable Mermaid source</summary>

```mermaid
flowchart TB
    subgraph computer["Local computer"]
        vite["Vite dev server: 127.0.0.1:5173"]
        subgraph browser["Browser tab"]
            react["React App: screens and controls"]
            ws["WebSocket client: parseFrame + isUsable"]
            render["Phaser / SVG / animation-frame loops"]
            logger["Owner-side experiment or research logger"]
            local["localStorage: preferences and round summaries"]
        end
        subgraph python["Uvicorn / FastAPI: 127.0.0.1:8000"]
            api["HTTP control and review routes"]
            worker["One acquisition worker + Service"]
            socket["Per-viewer /ws/input sender"]
            analyze["Experiment analyzer thread"]
            writers["Background recording writers"]
        end
        disk["Local recordings and exports"]
    end
    cyton["Cyton USB dongle"] --> worker
    replay["BrainFlow playback file"] --> worker
    sim["SimulatedBoard"] --> worker
    vite --> react
    react -->|"HTTP commands"| api
    api --> worker
    worker --> socket
    socket -->|"Input frame + telemetry"| ws
    ws --> react
    react --> render
    render --> logger
    react --> local
    logger -->|"HTTP batches + heartbeats"| api
    worker --> analyze
    worker --> writers
    api --> writers
    analyze --> writers
    writers --> disk
    disk -->|"Review and export APIs"| api
    api --> react
```

</details>

Vite serves the frontend in development. The frontend build produces static assets; Python remains a separately started backend. Browser requests name port 8000 directly; this app does not use a Vite API proxy.

## One producer, multiple viewers

![One producer, multiple viewers](system-visuals/runtime-one-producer-multiple-viewers.svg)

[Open full-size SVG](system-visuals/runtime-one-producer-multiple-viewers.svg)

<details>
<summary>Editable Mermaid source</summary>

```mermaid
sequenceDiagram
    participant Worker as worker()
    participant Lock as service.lock
    participant Board as Board adapter
    participant Service as Service
    participant A as Viewer A stream()
    participant B as Viewer B stream()
    loop About every 250 ms plus processing time
        Worker->>Lock: Acquire
        Worker->>Service: asyncio.to_thread(service.tick)
        Service->>Board: get_board_data() for raw EEG sources
        Board-->>Service: All samples since prior read
        Service->>Service: ingest(), analyze, record
        Worker->>Lock: Release
    end
    A->>Lock: Acquire for frame() + status()
    A-->>A: Send snapshot to its tab
    B->>Lock: Acquire for frame() + status()
    B-->>B: Send snapshot to its tab
```

</details>

Each viewer polls snapshots at its own nominal 4 Hz cadence. A viewer never reads the board. Sequence numbers belong to the producer; the browser ignores repeated or out-of-order frames. An open WebSocket does not mean the headset is connected or the input is usable.

| Responsibility | Owner and implementation |
| --- | --- |
| Acquisition, baseline and shared settings | `Service`, `worker()`, `stream()` in [backend/main.py](../../../../backend/main.py). |
| Raw EEG simulation | [SimulatedBoard](../../../../backend/simulated.py); distinct from score-only synthetic input. |
| Experiment analysis and ownership | `ExperimentManager`, `Analyzer` in [experiments.py](../../../../backend/experiments.py). |
| Durable recording writes | [experiment writer](../../../../backend/experiment_recording.py) and [research writer](../../../../backend/research/recorder.py). |
| Navigation, round/session binding | [App.tsx](../../../../apps/web/src/App.tsx), [lifecycle.ts](../../../../apps/web/src/games/lifecycle.ts). |
| Game physics and stimulus display | Browser models and render loops; see [frontend map](../code/frontend.md). |

Only one experiment or one research recording may be active at a time; the start endpoints reject attempts to overlap the two. Ordinary viewers can observe telemetry, but recording mutations require the owning tab's token. Changing acquisition affects every viewer sharing this backend.
