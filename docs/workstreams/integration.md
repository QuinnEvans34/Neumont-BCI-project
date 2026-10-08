# Integration / showcase brief

**Scope and estimates:** follow the [master blueprint](../blueprint.md) and [current task breakdown](../blueprint/work-breakdown.md). This brief supplies orientation; the numbered task cards control deliverables.

## Own

Runnable main branch, README setup, CI checks, rehearsal checklist, task coordination, poster/demo video. Never wait until showcase week to integrate.

## First task: QA-01

Follow README from a clean install. Run frontend manually, then synthetic backend. Verify start/pause/reset, backend disconnect and reconnect, stale/poor input using fixtures, source labeling, and resizing. Record OS and exact failure steps. Claim one small fix.

## Visitor script

Ask five people outside the team to read instructions and complete a round. Observe rather than coaching immediately. Record time to fit/calibrate, whether they understand their influence, completion, quality pauses and confusion. With permission, record voluntary anonymous feedback; do not publish participant EEG or faces by default.

## Release checklist

Build/tests pass; documented versions; ten consecutive rounds; source and automated assistance disclosed; live/stale/poor/reconnect/reset checked; font fallback/offline manual demo works; no raw data/secrets committed; dependency notices reviewed; school explanation poster; labeled replay/video backup.

## GitHub setup

Confirm owner/name and visibility with project lead. Recommended initial remote is private while the club chooses its license and reviews content. Create the chosen repo and push this existing local repo rather than creating a second nested checkout. Do not run commands against an invented organization.

GitHub authentication has been verified for `QuinnEvans34` with network access. The selected repository name is `Neumont-BCI-project`. For a future fresh setup, authenticate with `gh auth login` before creation/push. Example:

```sh
gh repo create OWNER/REPO --private --source=. --remote=origin --push
```

Requires at least one local commit. Open issues from the workstream task table, assign only confirmed owners, and set due dates. A GitHub Project board is optional; issue labels (`ui`, `game`, `data`, `ml`, `integration`, `good-first-task`) are enough to start.
