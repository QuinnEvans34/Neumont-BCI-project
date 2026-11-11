# EEG to game input

[Open PDF atlas](../visual-maps.pdf#page=5) | [Open in browser](../visual-maps.html#diagram-4)
[Map index](../README.md) · [Recording joins](recording-and-review.md) · [Game lifecycle](../flows/player-journey.md)

## Acquisition and fan-out

![Acquisition and fan-out](data-visuals/signal-pipeline-acquisition-and-fan-out.svg)

[Open full-size SVG](data-visuals/signal-pipeline-acquisition-and-fan-out.svg)

<details>
<summary>Editable Mermaid source</summary>

```mermaid
flowchart TD
    connect["Service.connect(request)"] --> source{"Requested source"}
    source -->|"live"| live["BrainFlow CYTON_BOARD: serial USB dongle"]
    source -->|"replay"| replay["inspect_recording + PLAYBACK_FILE_BOARD"]
    source -->|"simulated_eeg"| sim["SimulatedBoard: generated raw EEG"]
    source -->|"synthetic"| synthetic["synthetic_score: bounded sine score"]
    live --> read["Service._tick: get_board_data"]
    replay --> read
    sim --> read
    read --> ingest["Service.ingest: validate shape and timestamps"]
    ingest --> verify["Replay: compare EEG with original rows"]
    verify --> continuity["Track timestamp gaps and live packet counters"]
    continuity --> fan["Full-rate sample batch"]
    fan --> experiments["ExperimentManager.on_samples"]
    fan --> research["ResearchRecorder.on_batch"]
    fan --> buffer["Rolling buffer: up to 10 seconds"]
    buffer --> analyze["update_feature: analyze last 2 seconds"]
    analyze --> score["Calibrated game frame"]
    synthetic --> score
    experiments --> raw["Experiment metrics / CCA / recording"]
```

</details>

Cyton's configured layout is eight EEG channels at 250 Hz. SDK reads arrive in batches; their sizes are not assumed to equal a feature window. Full-rate recording and experiment analysis branch before the game amplitude gate. Chart telemetry is a reduced view of the rolling buffer, not the samples used for decoding or recording.

Replay uses the file's original timestamps for continuity and position. A mismatched EEG row stops acquisition. A receipt outage over two seconds clears rolling and pending baseline buffers so opposite sides of a gap are not joined into a window.

## Per-window processing and calibration

![Per-window processing and calibration](data-visuals/signal-pipeline-per-window-processing-and-calibration.svg)

[Open full-size SVG](data-visuals/signal-pipeline-per-window-processing-and-calibration.svg)

<details>
<summary>Editable Mermaid source</summary>

```mermaid
flowchart TD
    window["2-second EEG window"] --> channel["Process every channel independently"]
    channel --> finite{"Finite raw samples?"}
    finite -->|"No"| excluded["Exclude channel with reason"]
    finite -->|"Yes"| filter["Copy, mean-center and reflect-pad 1 second"]
    filter --> filters["Order-2 zero-phase Butterworth: 58-62 Hz stop, then 1-40 Hz pass"]
    filters --> gates{"Raw rail / filtered flatness / filtered peak-to-peak / selection"}
    gates -->|"Rejected"| excluded
    gates -->|"Included"| fft["Hann FFT: alpha power 8-12 Hz / power 4-30 Hz"]
    fft --> median["Median relative alpha across included channels"]
    median --> continuous{"Continuity accepted and at least one included channel?"}
    continuous -->|"No"| poor["No feature: poor quality"]
    continuous -->|"Yes"| purpose{"Baseline collection active?"}
    purpose -->|"Yes"| collect["30 accepted non-overlapping 2-second windows"]
    collect --> robust["Calibration.collect: median center + scaled MAD"]
    robust --> variation{"Sufficient variation?"}
    variation -->|"No"| fail["Fail baseline; operator must retry"]
    variation -->|"Yes"| baseline["Accepted calibration reference"]
    purpose -->|"Current rolling feature"| map["Calibration.map: clip target to 0-1; smooth score"]
    baseline -.-> map
    map --> frame["Service.frame: score, quality, calibrated, source, sequence"]
```

</details>

Baseline collection and the rolling play feature share `analyze()`; the diagram separates their consumers. Baseline time means **accepted data**: rejected windows do not advance the 60-second target. Live EEG requires an explicit scoring-channel selection before calibration. Raw mains-hum RMS is measured separately for diagnostics; the notch filter does not establish electrode contact.

Game continuity checks tolerate limited packet-counter noise: `CounterTracker` distinguishes confirmed loss from isolated corrupt counters, with per-window loss/corruption limits. Timestamp checks reject backward time or an excessive total window span rather than every bursty USB arrival. Experiments also receive stricter raw-counter break positions. See `continuity.py` and `Service.ingest()` for those separate policies.

The mapped target is `clip(0.5 + (value - center) / (6 * scale), 0, 1)` and smoothing is `0.8 * prior + 0.2 * target` per map call. Gate or scoring-channel changes invalidate the old baseline. These are experimental relative-alpha values, not validated attention or stress measurements.

## Browser acceptance

![Browser acceptance](data-visuals/signal-pipeline-browser-acceptance.svg)

[Open full-size SVG](data-visuals/signal-pipeline-browser-acceptance.svg)

<details>
<summary>Editable Mermaid source</summary>

```mermaid
flowchart LR
    socket["/ws/input JSON"] --> parse["parseFrame: shape, ranges and source"]
    parse --> sequence["App: require increasing sequence"]
    sequence --> usable["isUsable: good + calibrated + fresh receipt and producer timestamp"]
    usable --> tick["canTick: selected, on play page, running, visible, same session"]
    tick --> game["Advance model only when all gates pass"]
```

</details>

`isUsable()` checks both the monotonic receipt age and the producer's wall-clock timestamp against a two-second limit; it also rejects a producer timestamp over two seconds in the future. Acquisition freshness is checked separately by the backend. Recovery of usable input does not press Resume for the player.

| Code | Main functions |
| --- | --- |
| [main.py](../../../../backend/main.py) | `Service.connect`, `ingest`, `update_feature`, `begin_calibration`, `frame`, `receiving`. |
| [signal.py](../../../../backend/signal.py) | `filtered_window`, `hum_rms`, `analyze`, `Calibration.collect`, `Calibration.map`. |
| [continuity.py](../../../../backend/continuity.py) | `CounterTracker.feed`, `problem`, `timestamp_problem`. |
| [input.ts](../../../../apps/web/src/input.ts) and [lifecycle.ts](../../../../apps/web/src/games/lifecycle.ts) | Packet parsing, freshness and tick gates. |
