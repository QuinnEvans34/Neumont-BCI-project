# Experiment presentation and analysis

[Open PDF atlas](../visual-maps.pdf#page=19) | [Open in browser](../visual-maps.html#diagram-18)
[Map index](../README.md) · [Acquisition](../data/signal-pipeline.md) · [Recording](../data/recording-and-review.md)

## Shared start and ownership

![Shared start and ownership](../rendered/flows/experiments-shared-start-and-ownership.svg)

[Open full-size SVG](../rendered/flows/experiments-shared-start-and-ownership.svg)

<details>
<summary>Editable Mermaid source</summary>

```mermaid
sequenceDiagram
    actor Operator
    participant Page as Experiment page
    participant Hook as useExperimentSession
    participant API as FastAPI
    participant Manager as ExperimentManager
    participant Service as Acquisition Service
    Operator->>Page: Open setup and confirm settings
    Note over Page: Opening setup never starts stimulation
    Operator->>Page: Explicit Start
    Page->>Hook: start(config)
    Hook->>API: Clock ping/pongs
    Hook->>API: POST /api/experiments/start
    API->>Manager: Validate fresh raw EEG and capture availability
    Manager-->>Hook: Experiment ID + owner token
    Hook-->>Page: Owned session
    loop While running
        Service->>Manager: on_samples: full-rate EEG + continuity
        Page->>Hook: Timestamped events and frame logs
        Hook->>API: Ordered batches and 500 ms heartbeat
        API->>Manager: events / frames / heartbeat
        Manager-->>Page: Analysis through shared telemetry
    end
    Operator->>Page: Stop or Escape
    Page->>Hook: Flush queued evidence and stop
    Hook->>API: POST experiment stop
    API->>Manager: Finalize analysis and recording
    Manager-->>Page: Final status and ZIP availability after files close
```

</details>

Start requires raw input from `live`, `replay` or `simulated_eeg`, not score-only `synthetic`. Alpha calibration is not required. The UI and backend reject overlap with an active research recording or another experiment. SSVEP pages additionally require a passing display check and acknowledgement; Cards also validates its posterior-channel configuration.

The session hook resynchronizes clocks and serializes event/frame delivery. Failed delivery interrupts the run rather than declaring a complete trial. Leaving/unmounting the page, hidden tabs, input/source problems and owner loss stop or interrupt presentation/capture; a server heartbeat timeout is two seconds. Partial recordings remain available. Browser callback logs describe software scheduling, not measured emitted light.

## Three different protocols

![Three different protocols](../rendered/flows/experiments-three-different-protocols.svg)

[Open full-size SVG](../rendered/flows/experiments-three-different-protocols.svg)

<details>
<summary>Editable Mermaid source</summary>

```mermaid
flowchart TD
    choose["Choose experiment"] --> kind{"Experience"}
    kind -->|"Bilateral"| pre["Central fixation before"]
    pre --> alternating["Alternating left/right cues"]
    alternating --> post["Central fixation after"]
    post --> bilateral["Descriptive phase metrics + raw EEG export"]
    kind -->|"SSVEP Cards"| display["Display preflight + posterior channels"]
    display --> setup["Seeded setup trials: targets and neutral"]
    setup --> freeze["Select and freeze thresholds from setup"]
    freeze --> evaluation["Separate evaluation trials, with breaks"]
    evaluation --> results["Correct / incorrect / abstained / invalid / neutral activations"]
    kind -->|"SSVEP Circle"| circlecheck["Display preflight + color/frequency settings"]
    circlecheck --> circle["One flashing circle; editable settings create segments"]
    circle --> metrics["Per-channel spectrum / dominant Hz / alpha; total alpha"]
    metrics --> export["Stop: settings, segment/frame logs and EEG ZIP"]
```

</details>

Cards supports diagnostic evaluation that abstains when usable thresholds are unavailable; freezing does not guarantee acceptance. Circle is an observation/recording experiment, not a gaze classifier. Bilateral records the chosen follow/fixate instruction condition and descriptive metrics; it is not a P300 classifier or therapeutic assessment.

## Where decoding happens

![Where decoding happens](../rendered/flows/experiments-where-decoding-happens.svg)

[Open full-size SVG](../rendered/flows/experiments-where-decoding-happens.svg)

<details>
<summary>Editable Mermaid source</summary>

```mermaid
flowchart LR
    eeg["Service.ingest raw samples"] --> queue["ExperimentManager.on_samples"]
    queue --> writer["RecordingWriter: raw EEG"]
    queue --> analyzer["Analyzer queue: samples + events"]
    events["Browser trial, segment and phase events"] --> analyzer
    analyzer --> align["align: clock offset and uncertainty"]
    align --> cards["Cards: segment, continuity, decode_window"]
    cards --> cca["CCA correlations + TrialTracker stability"]
    cca --> accept["accept with frozen thresholds, else abstain"]
    align --> bands["Bilateral / Circle: bands.window_metrics"]
    accept --> outputs["Predictions / metrics / summaries"]
    bands --> outputs
    outputs --> writer
    outputs --> telemetry["Published experiment telemetry"]
```

</details>

In Cards, the instructed target is used for setup/evaluation labels. The decoder computes correlations from raw EEG and frequency references; it does not read the cue as its answer. Replayed resting EEG and generated signals can exercise this software path without validating a new participant response.

| Source | Follow these paths |
| --- | --- |
| [session.ts](../../../../apps/web/src/experiments/session.ts) | `syncClock`, `useExperimentSession`, `start`, `log`, `sendFrames`, `freezeThresholds`, `stop`. |
| [protocol.ts](../../../../apps/web/src/experiments/protocol.ts), [timing.ts](../../../../apps/web/src/experiments/timing.ts), [circle.ts](../../../../apps/web/src/experiments/circle.ts) | Seeded blocks, bilateral phases, frame timing and circle scheduling. |
| [BilateralExperiment.tsx](../../../../apps/web/src/experiments/BilateralExperiment.tsx), [SsvepExperiment.tsx](../../../../apps/web/src/experiments/SsvepExperiment.tsx), [SsvepCircle.tsx](../../../../apps/web/src/experiments/SsvepCircle.tsx) | Page-specific setup, animation loops and interruption handlers. |
| [main.py](../../../../backend/main.py), [experiments.py](../../../../backend/experiments.py) | `validate_start`, start endpoint, manager ownership, analyzer and watchdog. |
| [ssvep.py](../../../../backend/ssvep.py), [bands.py](../../../../backend/bands.py) | `decode_window`, `TrialTracker`, `accept`, `select_thresholds`, `window_metrics`. |

More operator detail: [experiment guides](../../dashboard/experiments/README.md).
