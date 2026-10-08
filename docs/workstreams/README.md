# Workstreams and claimable tasks

Confirm names rather than assigning people without their agreement. A lead is accountable for the next demo and helps distribute tasks.

| Path | Best fit | First deliverable | Brief |
| --- | --- | --- | --- |
| React UI / UX | Design, web development, beginners with guidance | Connection → calibration → play → results screens using mocks | [UI](ui.md) |
| Phaser gameplay | TypeScript, math, animation | Explainable, enjoyable disturbance/assistance tuning | [Game](game.md) |
| EEG / data flow | Python, hardware debugging, signal processing | Headset spike + InputFrame stream | [Data](data.md) |
| ML / evaluation | Python, statistics, data science | Baseline-versus-model evaluation with proper held-out sessions | [ML](ml.md) |
| Integration / showcase | Testing, documentation, coordination | Fresh-checkout demo and visitor test script | [Integration](integration.md) |

## Starter task board

Copy these rows into GitHub issues once the remote is created. Set one owner and an actual due date at the meeting.

| ID | Task | Size | Dependency | Done when |
| --- | --- | --- | --- | --- |
| UI-01 | Draw the four-screen session flow | 1–2 hours | None | Screens/state transitions shown; live vs synthetic visible |
| UI-02 | Implement calibration progress with fixture states | Half day | UI-01 | Good/poor/failed calibration can be demonstrated without headset |
| GAME-01 | Tune disturbance extremes | Half day | None | Same initial state demonstrates measured difference at scores 0 and 1 |
| GAME-02 | Separate practice controls from EEG rounds | Half day | UI coordination | Keyboard mode labeled; EEG scoring excludes keyboard steering |
| DATA-01 | Inventory and stream the headset | Half day–2 days | Physical access | Raw sample rate/channels shown, recording saved locally, reconnect tested |
| DATA-02 | Emit live InputFrame and quality states | 1–2 days | DATA-01 | Source live, invalid/calibration states pause frontend |
| DATA-03 | Replace synthetic calibration with actual baseline | 1–2 days | DATA-02 | Flat/poor baseline fails visibly; same person can repeat calibration |
| ML-01 | Write task-block collection protocol | Half day | Headset information | Rest/task labels, repetitions, holdout and artifact checks specified |
| ML-02 | Compare baseline to logistic regression | 1–2 days | Valid recordings | Held-out report and limitations; no overlapping-window leakage |
| QA-01 | Fresh-checkout setup and 3 failure scenarios | Half day | None | README followed; disconnect/poor quality/reset results recorded |
| QA-02 | Five visitor usability sessions | Half day | Week-4 live flow | Setup times, completion, confusion and bugs summarized |

Size estimates assume relevant familiarity. Split anything that can't produce a small demo in two days. Beginners can begin with copy, layout, source badges, instructions, fixtures, or test walkthroughs.
