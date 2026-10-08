# ML / evaluation brief

**Scope and estimates:** follow the [master blueprint](../blueprint.md) and [current task breakdown](../blueprint/work-breakdown.md). This brief supplies orientation; the numbered task cards control deliverables.

## Question

Can a small model distinguish our instructed task conditions reliably enough to improve the game's input over a simple calibrated-feature baseline?

ML is valuable only if that comparison is credible. It is not required for animation, beam balance or a working showcase.

## First task: ML-01

Draft repeated rest and mental-arithmetic blocks, similar eyes-open posture/environment, task labels/timestamps, voluntary recording instructions and held-out-session strategy. Adjust after headset channel inspection. Task labels are instructions, not verified ground-truth calmness. Obtain agreement before recording people; no identifiable EEG goes into Git.

## Baseline and model

Baseline: selected band-power feature with participant normalization and smoothing. Candidate: logistic regression on a small set of log band powers (and quality summaries where justified). Use scikit-learn; put scaling and classification in a pipeline. Fit preprocessing only on training data. No deep learning or motor imagery promise in MVP.

## Evaluation

Hold out entire blocks/sessions with no overlapping windows crossing splits. For a participant-specific model, test a separate session on the same participant. Any cross-person claim requires held-out people and adequate data. Report balanced accuracy, confusion matrix, per-session results, usable-data fraction, latency and live stability. Compare to majority/chance and feature baselines.

Check whether blinks, jaw tension, movement or contact shifts explain separation. Inspect task-order confounding. High offline accuracy is insufficient if live predictions flicker or fail for a new visitor. Early club data is a feasibility pilot, not evidence for general population performance.

## Deliver

Reproducible experiment command/notebook, data manifest without personal identifiers, versioned preprocessing/model metadata, limitations, and a decision by week 6. Adopt ML only if held-out results and live behavior improve baseline. Otherwise present the experiment and keep the baseline.
