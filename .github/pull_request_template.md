## Change and reason

## Demonstration / validation

- [ ] Branch includes the latest `origin/main` (fetch, then merge or rebase).
- [ ] Version advances from main by one patch, minor or major; package and lockfile versions match.
- [ ] `docs/workspace/version.md` declares the same version and summarizes this update, including documentation changes.
- [ ] The previous main version has an overview in `docs/archive/versions/<version>/README.md`; older overviews are retained and the archive index is updated.
- [ ] `npm run version:check-main`, `npm test` and `npm run build` pass.

## Known limitations
