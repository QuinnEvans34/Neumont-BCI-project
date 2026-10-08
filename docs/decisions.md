# Decisions and open questions

**Implementation and estimates:** [Master blueprint](blueprint.md) is authoritative; remaining core work is 132–220 person-hours before contingency, with optional ML 40–62 hours.

## Accepted for the starter

- Software game; no physical beam or motors.
- React + TypeScript interface and Phaser scene, Python signal service.
- Assistance mechanic for MVP; direct left/right EEG steering is conditional research.
- Fixed-step constrained ball model first; no need for Matter unless collisions/free flight become requirements.
- Manual and synthetic inputs first so work can proceed independently.
- ML judged against a simpler baseline; live quality/calibration must be real before claiming live play.
- Local operation for showcase; cloud accounts and deployment are unnecessary for MVP.

Repo name approved by project lead: `Neumont-BCI-project` (GitHub-compatible form). Initial owner: authenticated account `QuinnEvans34`. Initial visibility: private.

## Need answers

| Question | Impact | Resolve by |
| --- | --- | --- |
| Headset make/model, firmware, raw access, channel map | Acquisition SDK and feasible features | Weekend hardware spike |
| Team size, experience, weekly availability | Assignment sizes and lead pairing | Next meeting |
| GitHub owner/name and initial visibility | Remote creation and issue board | Weekend |
| Existing meditation repo | Possible reusable recording/UI code only | After core architecture agreed |
| School showcase date and demo restrictions | Final calendar and station setup | Next meeting |
| Club source license and recording expectations | Public release/data collection | Before public release/collection |

## Main risks and responses

Unavailable/locked EEG → document access early, use vendor adapter if viable. No reliable feature → evaluate honestly and retain labeled simulation. Weak member engagement → one owner, one small concrete task, one demo date, optional pairing. ML leakage → session/block holdout. UI/game/backend drift → shared contract and week-4 end-to-end gate. Overscope → no new mechanics after week 4 without removing equivalent work.
