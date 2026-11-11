# Versions and production

`main` is the production source of truth. Work on a feature branch, incorporate the latest `origin/main`, bump the version, then merge a passing pull request into `main`. Every merge, including documentation updates, needs a new version. Pushing a feature branch does not publish production.

The dashboard header displays the version from `package.json`, build channel, branch, short commit and whether local changes were present when Vite started. Restart the dev server after changing versions or branches. Development servers say **Development**. Built feature branches and modified working trees say **Preview**. Only a clean build from `main` matching the fetched `origin/main` says **Production**; this identifies the source of the build and does not deploy it.

## Release history

### 0.1.1 — 2026-11-11

Documentation and version-policy update, superseding `0.1.0`:

Release pull request: [#2](https://github.com/QuinnEvans34/Neumont-BCI-project/pull/2), `codex/version-rules` into `main`.

- Organized the documentation into workspace, project and archive homes, including dashboard guides, historical plans and dated verification records.
- Added code-traced system/data/flow/build maps, 26 SVG diagrams, an offline HTML viewer, a PDF atlas and reproducible export tools.
- Declared the shared source/documentation version in [workspace/version.md](../../workspace/version.md) and preserved the [0.1.0 overview](../versions/0.1.0/README.md).
- Added package/document version enforcement, archive retention checks, a push guard, CI validation, release guidance and the dashboard build/version badge.
- Repaired links for the final documentation layout and explicitly included the data-flow documentation in Git while keeping raw recordings ignored.

Local validation: the committed-head version check passed from `0.1.0` to `0.1.1`; all 92 frontend/version-policy tests and the frontend build passed; all local links resolved across 65 Markdown documents. The existing Windows backend environment ran 112 tests with four errors: a symlink privilege failure, two locked-file cleanup failures and a legacy CSV reader test failure. Backend source is unchanged. The release requires the Linux `backend` CI check to pass alongside `frontend` and `version-policy`; their final results are attached to the release pull request.

This source release follows the pull-request workflow below; merging it does not deploy the application or activate the example GitHub protection configuration.

## Make an update

```sh
git switch main
git pull --ff-only origin main
git switch -c feature/my-update
npm ci
# Make your changes. Before the final version bump and push:
git fetch origin main
git merge origin/main
npm version patch --no-git-tag-version
# Archive the outgoing overview in docs/archive/versions/<previous-version>/README.md.
# Update docs/archive/versions/README.md and docs/workspace/version.md for the new version.
npm run version:check-main
npm test
npm run build
git add <files-for-this-change>
git commit -m "Describe the update"
git push -u origin feature/my-update
```

Open a PR targeting `main`. If someone merges first, fetch and merge `origin/main` again, resolve conflicts, and choose the next version relative to the new main version. Use `npm version <explicit-version> --no-git-tag-version` if your branch already has a bumped version. The checker validates the result, not how many times the command was run. Rebase onto the latest main also satisfies the ancestry requirement.

On Windows PowerShell, use `npm.cmd` if execution policy prevents `npm.ps1` from running.

## Version rules

Use a stable `MAJOR.MINOR.PATCH` number. All three root version fields in `package.json` and `package-lock.json` must agree with the standalone `Version: MAJOR.MINOR.PATCH` declaration in [the current workspace version](../../workspace/version.md). No prefixes, leading zeroes, prerelease labels or build suffixes are accepted.

Documentation uses the same version as the code. On every release, including documentation-only changes, preserve the outgoing overview at `docs/archive/versions/<previous-version>/README.md`, update the [version archive index](../versions/README.md), then update the current declaration and overview. Each version document needs exactly one `Version: <version>` line and a nonempty `## Overview` section. Archived declarations must match their directory names and be older than the current version. Existing overviews must remain available in future releases.

| Change | Rule | From 0.1.0 |
| --- | --- | --- |
| Fix, tuning or documentation | Patch +1 | 0.1.1 |
| New compatible feature | Minor +1; reset patch | 0.2.0 |
| Incompatible change | Major +1; reset minor and patch | 1.0.0 |

The checker rejects reused numbers, downgrades and skipped versions. It enforces the numeric bump; reviewers decide whether the change warrants a patch, minor or major release. A rollback is a new PR with a higher version.

## Enforcement

`npm ci` / `npm install` installs `.githooks/pre-push` through `prepare`. For an existing install, run `npm run hooks:install`. If you have a custom `core.hooksPath`, the installer preserves it; have that hook invoke `node tools/release/pre-push.mjs "$@"` with Git's stdin intact. The guard blocks direct pushes/deletion of `main`, fetches current `origin/main` before any feature branch push, and checks the actual commits being pushed. Commit the version bump before pushing. A failed fetch blocks the push. Local hooks can be bypassed; GitHub protection is the authoritative merge barrier.

The `version-policy` CI job checks package/document version consistency and archive declarations on all runs. For PRs targeting main it checks the real PR head, fetches current main, requires it as an ancestor, requires one version increment and requires an archived overview for that previous main version. Previously archived overviews must also remain present. The temporary GitHub test merge is deliberately excluded from the ancestry check. Pushes to main are also audited against the previous main commit. The local checks and push guard enforce the same documentation requirements; uncommitted documentation cannot satisfy a committed-head check. `frontend` and `backend` run the project checks.

## Activate GitHub protection (repository admin)

The committed `.github/main-protection.json` is configuration to apply, not proof that protection is active. After this change reaches GitHub and the three checks have run, an authenticated repository admin must apply it from the repository root:

```sh
gh auth login
gh api --method PUT repos/QuinnEvans34/Neumont-BCI-project/branches/main/protection --input .github/main-protection.json
gh api repos/QuinnEvans34/Neumont-BCI-project/branches/main/protection
```

Review existing protection before applying: the PUT replaces the branch protection settings. The provided policy requires a PR and passing `version-policy`, `frontend` and `backend` checks, requires branches to be up to date, applies to administrators, blocks force pushes and deletion, and requires resolved conversations. It does not add a required reviewer count. The checks are bound to the GitHub Actions app. See [GitHub's branch protection API](https://docs.github.com/en/rest/branches/branch-protection).

Acceptance check: a direct push to main must fail; a PR with an unchanged version must fail `version-policy`; a branch missing the latest main must fail; an up-to-date branch with a valid bump and passing tests must be mergeable. If two PRs choose the same version, merging the first makes the second stale and it must integrate main and bump again.
