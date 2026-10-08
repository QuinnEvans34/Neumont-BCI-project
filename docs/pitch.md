# Club pitch and next meeting

## 45-second pitch

“We're building Brain Balance, a software game that responds to a BCI headset. You try to keep a ball in the center of a wooden beam while your measured EEG changes the game's assistance. We have a playable simulation so everyone can contribute without needing the headset. There are clear paths for React interface design, Phaser gameplay, Python signal processing, and an ML experiment. By the school showcase we'll have a short interactive experience and explain what the signal actually controls.”

## Why this project

The interaction is understandable in seconds. A browser demo works on the showcase laptop. Synthetic inputs let multiple contributors work at once. The project's AI/data work has a measurable question: does a classifier improve the game input compared with a simple EEG-feature baseline?

## What we can claim

The game responds to an EEG-derived signal when live mode is implemented. Assistance is an explicit game mechanic. Band power and task classification are experimental inputs; we do not claim to read thoughts, diagnose stress, or prove the player became calmer. Synthetic/replay sources stay visibly labeled.

## 30-minute meeting

1. 0–5 minutes: pitch and play the manual/synthetic prototype.
2. 5–10: explain the two loops: game physics and slower EEG input.
3. 10–15: confirm headset access, team availability, and MVP.
4. 15–25: each person claims one small task, an owner, and a due date.
5. 25–30: agree on the next demo and pairing time for anyone who needs help.

Leave with a named lead for each active workstream and a scheduled demo. Leads coordinate a deliverable; nobody is expected to finish an entire subsystem alone.

## Example assignments (confirm with the people involved)

“Porter, would you own the React session interface? Your first deliverable is the connection/calibration/play/results flow using mocked data. You can start in `apps/web/src/App.tsx`; the UI brief has the acceptance checklist.”

“The data lead owns one validated InputFrame stream, initially synthetic and then from our headset. The ML lead owns a baseline-versus-model report, not a promise of a particular accuracy.”

## Showcase station

A laptop, headset, staff member, 60-second round, short explanation poster, and labeled replay/video backup. Estimate total visitor turnaround only after measuring actual fitting/calibration time on the headset.
