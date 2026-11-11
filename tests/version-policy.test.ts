import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { checkVersion, git, parseVersion, validateBump, validateVersions } from "../tools/release/version-policy.mjs";

function writeVersion(cwd: string, version: string) {
  const packagePath = join(cwd, "package.json");
  if (existsSync(packagePath)) {
    const previous = JSON.parse(readFileSync(packagePath, "utf8")).version;
    if (previous !== version) {
      const archive = join(cwd, "docs/archive/versions", previous);
      mkdirSync(archive, { recursive: true });
      writeFileSync(join(archive, "README.md"), `# Version ${previous}\n\nVersion: ${previous}\n\n## Overview\n\nPrevious release scope.\n`);
    }
  }
  mkdirSync(join(cwd, "docs/workspace"), { recursive: true });
  writeFileSync(join(cwd, "docs/workspace/version.md"), `# Current version\n\nVersion: ${version}\n\n## Overview\n\nCurrent release scope.\n`);
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ version }));
  writeFileSync(join(cwd, "package-lock.json"), JSON.stringify({ version, packages: { "": { version } } }));
}

function repository(t: { after: (fn: () => void) => void }) {
  const cwd = mkdtempSync(join(tmpdir(), "bci-version-policy-"));
  t.after(() => {
    assert.ok(resolve(cwd).startsWith(resolve(tmpdir()) + "/") || resolve(cwd).startsWith(resolve(tmpdir()) + "\\"));
    rmSync(cwd, { recursive: true, force: true });
  });
  git(["init", "--initial-branch=main"], cwd);
  git(["config", "user.name", "Version policy test"], cwd);
  git(["config", "user.email", "test@example.invalid"], cwd);
  git(["config", "commit.gpgsign", "false"], cwd);
  git(["config", "core.hooksPath", ".unused-test-hooks"], cwd);
  writeVersion(cwd, "0.1.0");
  git(["add", "."], cwd);
  git(["commit", "-m", "Initial production version"], cwd);
  return cwd;
}

test("release versions reject malformed, prerelease and unsafe components", () => {
  for (const v of ["v1.0.0", "01.0.0", "1.2", "1.2.3-beta.1", "1.2.3+build", "-1.0.0", "1.2.9007199254740992", null]) {
    assert.throws(() => parseVersion(v));
  }
  assert.deepEqual(parseVersion("1.20.3"), [1, 20, 3]);
});

test("each release advances by exactly one patch, minor or major", () => {
  for (const v of ["1.2.4", "1.3.0", "2.0.0"]) assert.doesNotThrow(() => validateBump("1.2.3", v));
  for (const v of ["1.2.3", "1.2.2", "0.9.0", "1.2.5", "1.3.1", "2.0.1"]) {
    assert.throws(() => validateBump("1.2.3", v), /advance/);
  }
});

test("all three package version fields must agree", () => {
  const pkg = { version: "0.1.1" };
  assert.equal(validateVersions(pkg, { version: "0.1.1", packages: { "": pkg } }), "0.1.1");
  assert.throws(() => validateVersions(pkg, { version: "0.1.0", packages: { "": pkg } }), /must match/);
  assert.throws(() => validateVersions(pkg, { version: "0.1.1", packages: { "": { version: "0.1.0" } } }), /must match/);
  assert.throws(() => validateVersions(pkg, { version: "0.1.1" }), /must match/);
});

test("current documentation is required and must match the package version", (t) => {
  const cwd = repository(t);
  const path = join(cwd, "docs/workspace/version.md");
  rmSync(path);
  assert.throws(() => checkVersion({ cwd }), /Missing version document docs\/workspace\/version.md/);
  writeFileSync(path, "Version: 0.0.9\n\n## Overview\n\nOutdated overview.\n");
  assert.throws(() => checkVersion({ cwd }), /must declare exactly one "Version: 0.1.0"/);
  writeFileSync(path, "Version: 0.1.0\nVersion: 0.1.0\n\n## Overview\n\nRepeated declaration.\n");
  assert.throws(() => checkVersion({ cwd }), /exactly one/);
  writeFileSync(path, "Version: 0.1.0\n\n## Overview\n\n## Evidence\n\nNo overview.\n");
  assert.throws(() => checkVersion({ cwd }), /nonempty "## Overview"/);
});

test("documentation-only changes still require a version bump", (t) => {
  const cwd = repository(t);
  writeFileSync(join(cwd, "docs/README.md"), "Documentation-only edit.\n");
  assert.throws(() => checkVersion({ base: "main", cwd }), /advance/);
});

test("a release must archive the previous main version with matching metadata", (t) => {
  const cwd = repository(t);
  writeVersion(cwd, "0.1.1");
  const path = join(cwd, "docs/archive/versions/0.1.0/README.md");
  rmSync(path);
  assert.throws(() => checkVersion({ base: "main", cwd }), /Missing version document docs\/archive\/versions\/0.1.0\/README.md/);
  writeFileSync(path, "Version: 0.0.9\n\n## Overview\n\nWrong release.\n");
  assert.throws(() => checkVersion({ base: "main", cwd }), /must declare exactly one "Version: 0.1.0"/);
  writeFileSync(path, "Version: 0.1.0\n");
  assert.throws(() => checkVersion({ base: "main", cwd }), /nonempty "## Overview"/);
});

test("local checks reject current and future versions in the archive", (t) => {
  const cwd = repository(t);
  for (const version of ["0.1.0", "0.2.0", "1.0.0"]) {
    const path = join(cwd, "docs/archive/versions", version);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "README.md"), `Version: ${version}\n\n## Overview\n\nNot a past version.\n`);
    assert.throws(() => checkVersion({ cwd }), /must describe a past version/);
    rmSync(path, { recursive: true });
  }
});

test("later releases must retain all previously archived overviews", (t) => {
  const cwd = repository(t);
  writeVersion(cwd, "0.1.1");
  git(["add", "."], cwd);
  git(["commit", "-m", "First documented release"], cwd);
  writeVersion(cwd, "0.1.2");
  assert.equal(checkVersion({ base: "main", cwd }), "0.1.2");
  rmSync(join(cwd, "docs/archive/versions/0.1.0"), { recursive: true });
  assert.throws(() => checkVersion({ base: "main", cwd }), /Missing version document docs\/archive\/versions\/0.1.0\/README.md/);
});

test("committed-head checks ignore uncommitted documentation fixes", (t) => {
  const cwd = repository(t);
  writeVersion(cwd, "0.1.1");
  // Commit the package bump while leaving the old documentation in the commit.
  git(["add", "package.json", "package-lock.json"], cwd);
  git(["commit", "-m", "Incomplete version update"], cwd);
  assert.equal(checkVersion({ cwd }), "0.1.1");
  assert.throws(() => checkVersion({ head: "HEAD", cwd }), /must declare exactly one "Version: 0.1.1"/);
  git(["add", "docs/workspace/version.md"], cwd);
  git(["commit", "-m", "Update current overview only"], cwd);
  assert.throws(() => checkVersion({ base: "HEAD~2", head: "HEAD", cwd }), /Missing version document docs\/archive\/versions\/0.1.0\/README.md/);
  git(["add", "docs/archive"], cwd);
  git(["commit", "-m", "Archive previous version"], cwd);
  assert.equal(checkVersion({ base: "HEAD~3", head: "HEAD", cwd }), "0.1.1");
});

test("uncommitted version changes cannot make an old commit releasable", (t) => {
  const cwd = repository(t);
  writeVersion(cwd, "0.1.1");
  assert.equal(checkVersion({ base: "main", cwd }), "0.1.1");
  assert.throws(() => checkVersion({ base: "main", head: "HEAD", cwd }), /advance/);
});

test("a passing feature becomes stale when main advances, and passes after merging main", (t) => {
  const cwd = repository(t);
  git(["switch", "-c", "feature"], cwd);
  writeVersion(cwd, "0.1.1");
  git(["add", "."], cwd);
  git(["commit", "-m", "Feature release"], cwd);
  assert.equal(checkVersion({ base: "main", head: "feature", cwd }), "0.1.1");
  git(["switch", "main"], cwd);
  writeFileSync(join(cwd, "main-update.txt"), "Concurrent update\n");
  git(["add", "."], cwd);
  git(["commit", "-m", "Advance main"], cwd);
  assert.throws(() => checkVersion({ base: "main", head: "feature", cwd }), /latest main/);
  git(["switch", "feature"], cwd);
  git(["merge", "--no-edit", "main"], cwd);
  assert.equal(checkVersion({ base: "main", head: "HEAD", cwd }), "0.1.1");
});

test("push guard rejects updating or deleting main before any network request", () => {
  const script = fileURLToPath(new URL("../tools/release/pre-push.mjs", import.meta.url));
  for (const sha of ["a".repeat(40), "0".repeat(40)]) {
    const result = spawnSync(process.execPath, [script], {
      input: `refs/heads/main ${sha} refs/heads/main ${"b".repeat(40)}\n`, encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /main is production/);
  }
});

test("push guard fetches main and rejects a feature that passed before main advanced", (t) => {
  const cwd = repository(t);
  git(["remote", "add", "origin", cwd], cwd);
  git(["switch", "-c", "feature"], cwd);
  writeVersion(cwd, "0.1.1");
  git(["add", "."], cwd);
  git(["commit", "-m", "Feature version"], cwd);
  const head = git(["rev-parse", "HEAD"], cwd);
  const script = fileURLToPath(new URL("../tools/release/pre-push.mjs", import.meta.url));
  const push = () => spawnSync(process.execPath, [script], {
    cwd, input: `refs/heads/feature ${head} refs/heads/feature ${"0".repeat(40)}\n`, encoding: "utf8",
  });
  assert.equal(push().status, 0);
  git(["switch", "main"], cwd);
  writeFileSync(join(cwd, "concurrent.txt"), "main advanced\n");
  git(["add", "."], cwd);
  git(["commit", "-m", "New main commit"], cwd);
  const rejected = push();
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /latest main/);
  assert.equal(git(["rev-parse", "origin/main"], cwd), git(["rev-parse", "main"], cwd));
});

test("merging another release requires choosing a new version again", (t) => {
  const cwd = repository(t);
  git(["switch", "-c", "feature"], cwd);
  writeVersion(cwd, "0.1.1");
  git(["add", "."], cwd);
  git(["commit", "-m", "Proposed release"], cwd);
  git(["switch", "main"], cwd);
  writeVersion(cwd, "0.1.1");
  writeFileSync(join(cwd, "other-feature.txt"), "Another release landed\n");
  git(["add", "."], cwd);
  git(["commit", "-m", "Concurrent release"], cwd);
  git(["switch", "feature"], cwd);
  git(["merge", "--no-edit", "main"], cwd);
  assert.throws(() => checkVersion({ base: "main", head: "HEAD", cwd }), /advance/);
  writeVersion(cwd, "0.1.2");
  git(["add", "."], cwd);
  git(["commit", "-m", "Choose next available version"], cwd);
  assert.equal(checkVersion({ base: "main", head: "HEAD", cwd }), "0.1.2");
});
