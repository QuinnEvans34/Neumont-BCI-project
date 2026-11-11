# Documentation

Documentation has three homes:

| Folder | What belongs here |
| --- | --- |
| [Workspace](workspace/README.md) | How this repository works: setup, architecture, dependencies, releases, app guides and implementation contracts. |
| [Project](project/README.md) | The club's goals, scope, roadmap, pitch, hardware configurations and BCI research, independent of the repository layout. |
| [Archive](archive/README.md) | Historical plans, task estimates, implementation prompts, handoffs and dated verification records. |

## Start here

- Run the app: [repository README](../README.md).
- Make a change: [contributing](../CONTRIBUTING.md) and [release rules](archive/logs/releases.md).
- Check the version: [current workspace version](workspace/version.md) and [past version overviews](archive/versions/README.md).
- Use the app: [dashboard guides](workspace/dashboard/README.md).
- See how it works: [visual map PDF](workspace/maps/visual-maps.pdf), [offline browser viewer](workspace/maps/visual-maps.html) or [editable map guides](workspace/maps/README.md).
- Understand the project: [MVP](project/marketing/mvp.md), [roadmap](project/marketing/timeline.md) and [pitch](project/marketing/pitch.md).
- Find earlier work: [archive index](archive/README.md).

## Where to put a document

Use `workspace/` when a document depends on this codebase, its commands, file paths, APIs or app behavior. Use `project/` for goals, research and physical hardware information that remains useful if the implementation changes. Keep a feature's current guides and contracts together under `workspace/dashboard/`.

Move completed one-time plans, prompts and dated evidence into `archive/`; use `sessions/YYYY-MM-DD/` for dated work, `plans/` for historical planning bundles and `versions/<version>/README.md` for past version overviews. An archived test result describes that run, not the current checkout. Link to archived evidence from the relevant guide instead of copying it.

Documentation shares the source version and follows the same release rules, including documentation-only updates. Declare the current version and overview in `workspace/version.md`, preserve the outgoing overview in `archive/versions/<version>/README.md`, and run the version checks before review.

Keep this folder limited to this index and the three main folders. Use lowercase names with hyphens, relative Markdown links and a single home for each document. Update incoming links when moving a file. Keep raw EEG, participant data and generated exports outside `docs/`; the repository's local `data/` folder is ignored by Git.
