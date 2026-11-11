# P300 and SSVEP: datasets, activities, and project options

**AI & Data Club · Neumont-BCI-project · October 14, 2026**

This document consolidates the club's research into two ways to turn EEG into discrete commands. It covers four priority eight-channel datasets, three larger alternatives, participant activities, collection and evaluation requirements, and possible applications. **Controlling the club's Freenove Big Hexapod is the leading application candidate.**

Status: research and proposed experiments, not an implemented P300/SSVEP controller. Dataset documentation and loaders have been reviewed; recording files have not yet been downloaded and independently validated. Proposed trial counts and design choices below are starting points, not established performance guarantees.

## 1. What P300 and SSVEP would let us do

Our current relative-alpha calculation produces a continuous game score. P300 and SSVEP instead let us estimate which presented option a participant intends to select. They require different analysis and task-specific recordings; our existing resting calibration does not calibrate these methods.

### SSVEP: attend to a repeating visual pattern

**Steady-state visual evoked potentials** are EEG responses to periodic visual stimulation. Buttons can flicker at different known frequencies. When a participant looks at one button, the software compares their EEG with the expected frequencies and harmonics to estimate the attended target. A starting method is **canonical correlation analysis (CCA)**, which compares multichannel EEG with reference sine/cosine signals. Basic CCA does not require training a personalized classifier, but local data are still needed to evaluate performance and choose decision thresholds. [1]

### P300: attend to a target event

P300 is an event-related EEG response that can occur roughly 300 milliseconds after a relevant, relatively rare event. A visual interface highlights choices in a randomized sequence. The participant attends to one choice, and a classifier combines EEG evidence following repeated highlights to identify it. We do not look for a guaranteed peak at exactly 300 ms or infer a command from a single unexplained spike. [2]

| Question | SSVEP | Visual P300 |
| --- | --- | --- |
| What is on screen? | Choices flickering at distinct frequencies | Choices highlighting in a sequence |
| What does the participant do? | Look steadily at the desired choice during a selection interval | Attend to the desired choice and notice/count its highlights |
| What does analysis compare? | EEG against expected frequency patterns | EEG after target versus non-target events |
| What is the output? | A selected target or no reliable selection | A selected target or no reliable selection |
| Initial design fit | A few recurring commands | A menu of actions/items |

Both proposed visual versions use a screen. Neither recognizes the free-form thought “walk forward,” and neither is camera-based eye tracking. The menu design determines which command a detected selection represents. These design fits are recommendations, not hard limits on either method.

## 2. Data shortlist

### Four priority datasets: exactly eight EEG channels

| Dataset and access | Approach | EEG channels | Sampling rate | Participants | Activity / labels | Recommended role |
| --- | --- | --- | --- | --- | --- | --- |
| [Nakanishi 2015 / 12JFPM](https://github.com/mnakanishi/12JFPM_SSVEP) · [MOABB loader](https://moabb.neurotechx.com/docs/generated/moabb.datasets.Nakanishi2015.html) | SSVEP | 8 | 256 Hz | 10 | Twelve frequency/phase-coded visual targets; 15 trials per target per participant | First SSVEP decoder benchmark |
| [Kalunga 2016 / SSVEP Exoskeleton](https://github.com/sylvchev/dataset-ssvep-exoskeleton) · [MOABB loader](https://moabb.neurotechx.com/docs/generated/moabb.datasets.Kalunga2016.html) | SSVEP | 8 | 256 Hz | 12 | Three targets at 13, 17 and 21 Hz, plus a neutral/no-selection condition | Test commands and unwanted-command rejection |
| [BNCI2015-003](https://moabb.neurotechx.com/docs/generated/moabb.datasets.BNCI2015_003.html) | P300 | 8 | 256 Hz | 10 | Visual speller; target/non-target and flash information; training and test runs | First P300 classification pipeline |
| [BNCI2014-008](https://moabb.neurotechx.com/docs/generated/moabb.datasets.BNCI2014_008.html) | P300 | 8 | 256 Hz | 8 participants with ALS | Visual speller with target/non-target events | Independent P300 evaluation dataset |

**Nakanishi details.** The author's MATLAB release has one file per participant, organized by target × channel × sample × trial. There are 180 trials per participant, or 1,800 total. The release documents the frequency order and stimulus onset. Electrode locations are PO7, PO3, POz, PO4, PO8, O1, Oz and O2. It is a useful starting point for CCA, initially with a clearly reported three-target subset if desired. Earlier MOABB versions exposed only nine participants; the author release contains ten. MOABB currently lists the license as unknown: public download access does not establish unrestricted redistribution. [3, 4]

**Kalunga details.** The eight electrode locations are the same posterior set as Nakanishi, in a different listed order. The authors provide event-marked GDF recordings from multiple sessions, with three LED targets and a neutral fixation/reject condition. This supports testing whether a controller can avoid issuing commands when the participant is not choosing. It used physical LEDs, so it does not establish laptop-flicker performance. The repository identifies sessions excluded for acquisition/protocol problems, and the 17/21 Hz label mapping has a documented correction. Follow those exclusions and corrected labels. MOABB lists CC BY 4.0. [5, 6]

**BNCI2015-003 details.** Eight channels: Fz, Cz, P3, Pz, P4, PO7, Oz and PO8. Participant `.mat` files include target and flash channels and separate training/test runs. This supports a reproducible first P300 experiment. MOABB lists CC BY-NC-ND 4.0. [7]

**BNCI2014-008 details.** Eight-channel labeled P300 speller recordings from participants with ALS. Useful for independent analysis, but performance in this population should not be treated as predicted performance for club members. MOABB lists CC BY-NC-ND 4.0. Verify detailed channel/reference metadata against the files and original protocol before integration; the documentation contains inconsistent reference descriptions. [8]

### Three secondary datasets: select an appropriate channel subset

| Dataset and access | Approach | EEG channels / rate | What it adds | Limits / terms reported by source |
| --- | --- | --- | --- | --- |
| [MAMEM Experiment 3, PhysioNet](https://www.physionet.org/content/mssvepdb/1.0.0/) | SSVEP | 14 / 128 Hz | Emotiv EPOC recordings, five target frequencies and labeled stimulation windows | Use **dataset3**; experiments 1 and 2 have 256 channels. Open Data Commons Attribution v1.0. |
| [Brain Invaders 2013a](https://moabb.neurotechx.com/docs/generated/moabb.datasets.BI2013a.html) | P300 | 16 / 512 Hz | Twenty-four participants in a game-based selection experiment, with adaptive/non-adaptive conditions | Seven participants have eight sessions; the others have one. MOABB lists CC BY 1.0. |
| [BNCI2014-009](https://www.nemar.org/dataset/nm000188?v=v1.0.2) | P300 | 16 / 256 Hz | Ten participants using two visual interfaces, useful for interface comparisons | This is **16**, not eight, EEG channels. CC BY-NC-ND 4.0. |

MAMEM's overall collection reports 11 participants across experiments; confirm the actual available experiment-3 subjects/runs when loading rather than assuming identical coverage in every experiment. [9–11]

### What “compatible with our headset” means

Eight channels is a useful scope match, not proof of direct transfer to Cyton. Match electrode locations and order, reference, units, preprocessing and stimulus protocol. The priority datasets use **256 Hz**, while our standard Cyton uses **250 Hz**: process at the actual rate or explicitly resample with appropriate filtering; never just change a rate label.

These are separate datasets with different tasks and distributions. Develop/evaluate them separately first rather than pooling all samples. Public-dataset accuracy does not establish performance on our dry-electrode setup or new participants.

Use a separate offline loader/analysis environment, such as MOABB/MNE, rather than forcing these files into our existing BrainFlow CSV replay path. Preserve the original events and labels. Keep downloaded EEG outside Git, record source/version/license and cite the dataset. Confirm applicable terms before redistributing recordings or derived datasets; this document does not grant permission to redistribute them.

**Recommended starting set:** Nakanishi + Kalunga for SSVEP, BNCI2015-003 + BNCI2014-008 for P300. Brain Invaders is the strongest game-oriented extension.

## 3. What we need to record locally

| Information | Purpose |
| --- | --- |
| Raw per-channel EEG and units | Preserve the responses; the current relative-alpha score is insufficient |
| EEG timestamps, sample rate and packet continuity | Align activity to samples and reject interrupted data |
| Electrode names, reference and hardware settings | Make the recording interpretable and reproducible |
| Stimulus events and timestamps | Identify each highlight or stimulation interval |
| Frequency/phase and display configuration | Describe SSVEP stimuli, refresh rate and rendering behavior |
| Instructed target | Ground-truth answer during collection/evaluation |
| Participant pseudonym, session, run and trial IDs | Group data correctly and prevent train/test leakage |
| Rest/no-selection intervals | Evaluate false activations |
| Decoder scores, selected command and decision time | Measure accuracy, speed and abstention |
| Rejections, frame drops and interruptions | Explain failures rather than silently discarding them |

The intended target is an **answer key**, not an input to the decoder. Use pseudonymous IDs; keep raw participant data outside the public repository. Our old resting recordings are useful for acquisition testing but cannot substitute for labeled stimulus-task data unless the relevant events were recorded and synchronized.

## 4. Participant activities

### SSVEP pilot

1. Present three visual targets with distinct, validated stimulus frequencies.
2. Cue one target, then have the participant attend to it for a short interval.
3. Record EEG, target label, stimulus start/end, and display timing.
4. Stop stimulation and provide rest/feedback.
5. Repeat in randomized order, including neutral fixation trials.

**Proposed first collection:** ten four-second trials for each of three targets, plus ten neutral trials. That is 40 trials / 160 seconds of test intervals, plus cues, rest and breaks. Treat this as a feasibility pilot, not guaranteed sufficient training data. Frequencies should be chosen after checking monitor refresh and stimulus implementation; do not blindly copy LED frequencies to a laptop display.

Start analysis with CCA. Compare shorter/longer decision windows and add a no-reliable-selection outcome. The largest class score by itself is not calibrated confidence and should not automatically authorize a robot movement. [1, 5]

### P300 pilot

1. Present six command cards and cue one as the target.
2. Highlight cards in a randomized sequence while the participant attends to the target, optionally silently counting its highlights.
3. Record the onset and identity of every highlight.
4. Label events target/non-target from the cue.
5. Combine evidence across repeated highlights to make a selection.

**Proposed first collection:** 24 selections, with each card targeted four times, and ten passes through the six cards per selection. This yields **1,440 events: 240 target and 1,200 non-target events**. Include breaks. Reserve whole selections/runs for testing; do not randomly scatter highly related flashes from a selection into both train and test sets.

First inspect averaged target/non-target responses, then evaluate a simple linear classifier. Analyze event-aligned windows rather than a fixed “300 ms peak detector.” These counts are an initial design proposal, not a validated protocol. [2]

### Timing and participant considerations

Both tasks depend on the stimulus actually presented, not merely the requested animation time. Log frame timing and align stimulus and EEG clocks. Browser `performance.now()` and EEG timestamps cannot simply be treated as the same clock; account for offsets, drift and buffering. Photodiode measurements offer stronger evidence of actual display onset than software markers alone. PsychoPy provides timing tools and guidance for dedicated stimulus experiments. [12]

Visual flicker can cause discomfort and trigger seizures in susceptible people. Use a reviewed, opt-in procedure with clear stop controls and breaks; do not project active flicker at unsuspecting viewers. A different frequency or reduced brightness is not a guarantee of safety. Stop for discomfort, and provide a non-flickering demonstration alternative. [13]

## 5. Applications and games

The following are design proposals. Both methods can support many of the same applications; the listed preference is a starting implementation choice, not a restriction.

### Priority application: control the Freenove Big Hexapod

The participant uses an on-screen selection interface to issue high-level commands such as **forward, turn left, turn right**, or a tested pose. They do not need to control individual legs.

**With SSVEP:** look at the desired frequency-coded command during a selection interval. The decoder selects it or abstains.

**With P300:** attend to the desired command while cards highlight repeatedly. The decoder accumulates target-response evidence and selects it or abstains.

The proposed interaction is:

**Robot waits → user selects on screen → UI confirms command → robot executes a short action → robot stops and waits.**

Stop the stimulation during execution so the participant can watch the robot. Begin with short movements, not continuous joystick-like steering or autonomous navigation.

If the club's robot is the **Raspberry Pi Big Hexapod FNK0052**, Freenove provides Python client/server control over TCP/IP on a local network, camera streaming and ultrasonic data. Reuse its existing walking/control software. Confirm the exact model, Pi/software version, and that it already walks through the vendor client before estimating integration work. [14, 15]

Proposed architecture:

```text
Cyton raw EEG + stimulus events
              ↓
       P300 / SSVEP decoder
              ↓
   Selected command OR abstain
              ↓
   Command controller / robot adapter
              ↓
      Freenove robot server
              ↓
       Short action, then stop
```

Required behavior: independent operator/keyboard stop, robot-side movement timeout, low-speed bounded actions, no accumulating command queue, and no command on weak/stale input. Test on the floor with supervision. A timeout must remain effective if the laptop or network fails. Use a simulated robot display first to decouple decoder development from hardware availability.

We can reuse our acquisition and diagnostics, but must build the stimulus interface, decoder, command-validation layer, and Freenove adapter. Existing network control makes this plausible; it does not mean the EEG integration is already implemented.

### Software games

| Idea | Interaction | Initial approach / fit |
| --- | --- | --- |
| Spellcaster arena | Choose a spell, then watch its effects resolve | SSVEP for a few spells; clear feedback between selections |
| Heist / safecracker | Select symbols, tools or routes through a puzzle | P300 for menus of options |
| Escape room | Inspect objects and select how to use them | P300; deliberate pacing |
| Spaceship captain | Allocate shields, weapons or repairs during decision phases | Either; strategic choices |
| Tower defense commander | Choose a tower/upgrade, then a placement zone | Either; divide choices into small menus |
| Creature battler | Choose an attack, defense or ability each turn | Either; turn-based feedback |
| Branching adventure | Select dialogue, paths and story decisions | P300; achievable technically, content-heavy |
| Brain-controlled pinball | Select a launcher or gate before releasing the ball | SSVEP; avoid real-time flipper requirements |
| Puzzle factory | Operate switches routing a marble/package through machinery | Either; clear cause and effect |
| Cooperative mission control | EEG player selects strategy while a keyboard player executes actions | Either; complementary player roles |
| Garden architect | Select plants, decorations and placement zones | P300; discrete creative choices rather than alpha-based growth |
| Alien selector | Attend to an alien among highlighted groups to remove it | P300; closely matches a selection experiment |
| Tile maze | Choose a direction and move one tile per selection | SSVEP; straightforward evaluation |

For a first version, avoid mechanics requiring reflex-speed precision: racing, continuous platforming, rhythm timing or fighting-game combinations. Selection latency should be measured before designing around it.

### Apps and creative experiences

| Idea | Interaction |
| --- | --- |
| Music conductor | Select loops/instruments; apply changes at the next musical measure |
| Visual art composer | Select colors, patterns and effects to build an animated scene |
| Communication board | Select phrases or symbols and speak them aloud; treat as a prototype pending intended-user testing |
| Presentation controller | Select next/previous slide or an animation |
| Virtual room controller | Choose simulated lighting, music and scene changes |
| Photo booth director | Select filters, backgrounds and a capture command |
| Quiz interface | Choose an answer through EEG, reveal it and score the round |

## 6. Evaluation and next decisions

Success means reliable selections, not just a plot that appears to change. Measure:

- **Selection accuracy:** target chosen correctly on held-out complete trials/selections.
- **Selection time:** time from selection opportunity to accepted command.
- **False commands:** activations during no-selection intervals, including rate per minute.
- **Abstention rate:** how often the decoder cannot make a reliable selection.
- **Per-participant performance:** avoid hiding unusable results behind an overall average.
- **P300 event metrics:** balanced accuracy or ROC-AUC alongside final selection accuracy; raw event accuracy can be misleading because non-target flashes dominate.
- **Robot behavior:** bounded action execution, duplicate prevention, stale-input rejection and independent stop.

Fit preprocessing and tune thresholds only on training data. Keep related events/windows from the same trial together. Separate within-person, held-out-session and held-out-person claims: they answer different questions.

Recommended sequence:

1. Confirm the hexapod model and vendor control work.
2. Load one participant from each priority dataset; verify channels, units, rate and event mapping.
3. Build independent offline SSVEP and P300 baselines; keep public-data EEG outside Git.
4. Demonstrate selection → simulated command with held-out data.
5. Choose one method for the first local experiment. SSVEP with a few commands is our initial engineering recommendation, subject to measured results and participant suitability.
6. Collect labeled Cyton data with validated timing; evaluate before connecting movement.
7. Integrate short hexapod actions and test failure handling.

Possible team tracks: **data/loading and evaluation**, **stimulus timing and participant UI**, **decoder development**, **robot integration**, and **application visuals/testing**. A shared command contract should include session/trial identity, chosen action or abstain, decision time and validity; it should not replace the existing continuous-alpha game score globally.

## Sources

1. [Lin et al., CCA for SSVEP frequency recognition](https://pubmed.ncbi.nlm.nih.gov/17152442/).
2. [Adaptive stimulus selection in ERP-based BCI](https://arxiv.org/abs/1707.00375) and [Krusienski et al., P300 classification comparison](https://pubmed.ncbi.nlm.nih.gov/17124334/).
3. [Nakanishi author dataset README](https://raw.githubusercontent.com/mnakanishi/12JFPM_SSVEP/master/README.md).
4. [MOABB Nakanishi documentation](https://moabb.neurotechx.com/docs/generated/moabb.datasets.Nakanishi2015.html) and [channel/loader source](https://raw.githubusercontent.com/NeuroTechX/moabb/develop/moabb/datasets/ssvep_nakanishi.py).
5. [Kalunga author dataset documentation, event codes and exclusions](https://github.com/sylvchev/dataset-ssvep-exoskeleton).
6. [MOABB Kalunga documentation and correction](https://moabb.neurotechx.com/docs/generated/moabb.datasets.Kalunga2016.html).
7. [BNCI2015-003 documentation](https://moabb.neurotechx.com/docs/generated/moabb.datasets.BNCI2015_003.html).
8. [BNCI2014-008 documentation](https://moabb.neurotechx.com/docs/generated/moabb.datasets.BNCI2014_008.html).
9. [MAMEM SSVEP database, PhysioNet](https://www.physionet.org/content/mssvepdb/1.0.0/).
10. [Brain Invaders 2013a documentation](https://moabb.neurotechx.com/docs/generated/moabb.datasets.BI2013a.html).
11. [BNCI2014-009 NEMAR record](https://www.nemar.org/dataset/nm000188?v=v1.0.2).
12. [PsychoPy timing and synchronization guidance](https://devdocs.psychopy.org/general/timing/index.html).
13. [Epilepsy Foundation: photosensitivity and seizures](https://www.epilepsy.com/what-is-epilepsy/seizure-triggers/photosensitivity-and-seizures).
14. [Freenove FNK0052 control documentation](https://docs.freenove.com/projects/fnk0052/en/latest/fnk0052/codes/tutorial/4_Hexapod_Robot.html).
15. [Official Freenove Big Hexapod Raspberry Pi repository](https://github.com/Freenove/Freenove_Big_Hexapod_Robot_Kit_for_Raspberry_Pi).

Sources were consulted during the club's October 14 research discussion. Availability and license information reflect those pages; dataset downloads and live P300/SSVEP experiments remain to be verified.
