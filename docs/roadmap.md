# Weekend delivery and ten-week roadmap

**Detailed implementation budgets and updated critical path:** see [master blueprint](blueprint.md) and [task breakdown](blueprint/work-breakdown.md). The detailed plan supersedes the earlier rough milestones below if they differ.

## This weekend: make next meeting actionable

**Friday / first session:** run this starter, play with assistance extremes, confirm headset model and raw access, assign provisional leads. List any installation failure as a task with the exact error.

**Saturday:** frontend/game contributors improve one screen and test gameplay; data contributor gets the actual headset streaming or documents the precise blocker. Everyone uses the same InputFrame contract. Capture a 30-second demo.

**Sunday:** merge small completed changes, rehearse setup from a fresh checkout, refine pitch, and turn the task table into assigned issues with dates. Prepare a labeled synthetic demo if hardware isn't ready. Bring three artifacts: playable prototype, the pitch/MVP, and a board of named first tasks.

Meeting-ready means each member can say what file to open, what to change first, who helps them, and how to show completion.

## Ten weeks (relative to project kickoff)

| Week | Demonstration / gate |
| --- | --- |
| 1 | Everyone runs manual game; headset and software access confirmed; owners assigned |
| 2 | Live recording spike and quality inspection; baseline candidate selected or blocker made explicit |
| 3 | Real calibration + live protocol; UI connection/calibration/play flow |
| 4 | End-to-end live 60-second round; freeze core mechanic |
| 5 | Collect repeated labeled task blocks; baseline and simple-model comparison |
| 6 | Select reliable input; recording/replay and results screen |
| 7 | Five outside-team visitors; usability and reliability report |
| 8 | Fix setup/disconnect/quality/reset failures; showcase machine rehearsal |
| 9 | Feature freeze; ten consecutive rounds; poster and backup video |
| 10 | Final rehearsal, small fixes, showcase |

## Decision gates

End of week 2: do we have accessible usable signals? End of week 4: can we complete a live round? End of week 6: does ML actually improve the baseline? If ML doesn't improve it, retain baseline and present the comparison. If hardware remains blocked, present software work honestly with labeled simulation; never imply live control.

## Weekly rhythm

One short demo per workstream, then blockers, then one next task per person. Prefer an imperfect working change to an unreviewed multiweek branch. Pair a newcomer on their first task. Make an integration lead responsible for a runnable main branch and the next full demonstration.
