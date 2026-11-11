# Recording, joins and review

[Open PDF atlas](../visual-maps.pdf#page=8) | [Open in browser](../visual-maps.html#diagram-7)
[Map index](../README.md) · [Signal pipeline](signal-pipeline.md) · [Experiment flow](../flows/experiments.md)

## Research / Dev Mode capture

![Research / Dev Mode capture](data-visuals/recording-and-review-research-dev-mode-capture.svg)

[Open full-size SVG](data-visuals/recording-and-review-research-dev-mode-capture.svg)

<details>
<summary>Editable Mermaid source</summary>

```mermaid
flowchart TD
    bar["ResearchBar + useResearch.start"] --> start["POST /api/research/recordings: owner ID + token"]
    start --> recorder["ResearchRecorder"]
    service["Service acquisition hooks"] --> raw["on_acquisition_start/end + on_batch"]
    service --> derived["on_window + on_calibration + on_frame"]
    raw --> recorder
    derived --> recorder
    games["CairnTrace / GardenTrace + App events"] --> logger["ResearchLog: ordered items and input references"]
    logger --> items["POST recordings/{rid}/items"]
    items --> recorder
    recorder --> writer["Bounded Writer queue"]
    schema["schema.py: v2 logical tables"] -.-> writer
    writer --> csv["CsvSink"]
    writer --> sqlite["SqliteSink"]
    csv --> folder["Chosen destination / recording UUID"]
    sqlite --> folder
    folder --> metadata["metadata.json + manifest.json"]
```

</details>

The selected format creates CSV, SQLite, or both. The default destination is `data/research/`; `BCI_RESEARCH_DIR` and configured destinations can change it. Recording may begin before connection or partway through a session and can span reconnects, recalibration and game switches. Beginning mid-session is marked as partial rather than inventing earlier data.

Game snapshots target about 20 Hz; transitions and events carry their own times. The browser retains research items until acknowledged and the backend deduplicates their sequences. A worker-backed timer drives flushing and heartbeats, with a normal timer fallback. This does not guarantee delivery if the browser or computer terminates.

## Trace one event back to EEG

![Trace one event back to EEG](data-visuals/recording-and-review-trace-one-event-back-to-eeg.svg)

[Open full-size SVG](data-visuals/recording-and-review-trace-one-event-back-to-eeg.svg)

<details>
<summary>Editable Mermaid source</summary>

```mermaid
flowchart LR
    recording["recording_id: one captured visit"] --> acquisition["acquisition_id: one connection segment"]
    recording --> round["round_id: a Cairn round or Garden plant"]
    round --> event["events: observed browser time"]
    round --> state["game_state: round snapshots and input references"]
    event -->|"input_acquisition_id + input_sequence"| frame["input_frames: sequence within acquisition"]
    frame -->|"window_id"| window["signal_windows: feature and mapping"]
    window -->|"sample_start inclusive / sample_end exclusive"| eeg["eeg: acquisition_id + sample_index"]
    window --> metrics["channel_metrics: inclusion and rejection reasons"]
    window -->|"calibration_id"| baseline["calibrations: reference center and scale"]
    event -.->|"Clock estimate + uncertainty"| estimate["Estimated sample position near the event"]
    acquisition --> eeg
```

</details>

These are logical joins in the recorded schema, not a claim that every storage format enforces foreign keys. The input-frame reference identifies the score the game consumed. Clock-aligned sample estimates identify nearby raw data with uncertainty; browser event times are not exact hardware sample triggers. Score-only synthetic frames have no raw EEG window.

## Save, recover and inspect

![Save, recover and inspect](data-visuals/recording-and-review-save-recover-and-inspect.svg)

[Open full-size SVG](data-visuals/recording-and-review-save-recover-and-inspect.svg)

<details>
<summary>Editable Mermaid source</summary>

```mermaid
flowchart TD
    active["Active research recording"] --> stop["Stop: drain browser queue within a bound"]
    stop --> finalize["ResearchRecorder._finalize: close open records and writer"]
    finalize --> result{"Final state"}
    result --> saved["saved"]
    result --> incomplete["incomplete: losses / unsent items / timeout"]
    result --> failed["failed: storage or finalization error"]
    crash["Backend restart with unfinished files"] --> recover["Store.recover at lifespan startup"]
    recover --> history["Store history and Reader"]
    saved --> history
    incomplete --> history
    failed --> history
    history --> review["Research Review: detail + bounded time window"]
    history --> export["Store.export_zip: portable CSV ZIP"]
    history --> visualizer["Visualizer: research analysis and tables"]
    other["Raw replay files + experiment recordings"] --> visualizer
    local["Browser-only Cairn / Garden summaries"] --> browserhistory["Visualizer BrowserHistory view"]
```

</details>

Stop does not stop acquisition or automatically end ordinary gameplay. A recording finalizes asynchronously; file completion and losses determine its final state. Owner loss after five seconds or a full storage queue ends capture with an explicit incomplete/failed outcome. Export reads persisted files; SQLite-only research recordings can still export CSV ZIPs. Inspect active capture in Live rather than treating it as a finalized recording.

Experiment recording uses a separate `RecordingWriter` and schema: `eeg.csv`, event/frame/prediction/metric JSONL files, metadata and a summary under `data/experiments/` by default (`BCI_EXPERIMENTS_DIR` overrides it). Experiments and research capture share the acquisition producer but cannot record concurrently.

| Implementation | Role |
| --- | --- |
| [logger.ts](../../../../apps/web/src/research/logger.ts), [useResearch.ts](../../../../apps/web/src/research/useResearch.ts) | Browser queue, ownership, clock sync, heartbeat, start and stop. |
| [recorder.py](../../../../backend/research/recorder.py), [schema.py](../../../../backend/research/schema.py), [sinks.py](../../../../backend/research/sinks.py) | Sample/feature/frame capture, tables and durable writes. |
| [store.py](../../../../backend/research/store.py), [destinations.py](../../../../backend/research/destinations.py) | Recovery, recorded data access, exports and locations. |
| [Review.tsx](../../../../apps/web/src/research/Review.tsx) | Research recording detail and Cairn/Garden inspectors. |
| [visualizer.py](../../../../backend/visualizer.py), [Visualizer.tsx](../../../../apps/web/src/visualizer/Visualizer.tsx) | Unified raw/research/experiment analysis, tables and comparisons. |
| [experiments.py](../../../../backend/experiments.py), [experiment_recording.py](../../../../backend/experiment_recording.py) | Experiment ownership, analysis and recording files. |

Operator details: [Research / Dev Mode](../../dashboard/devtools/operating.md) and [Visualizer](../../dashboard/visualizer.md).
