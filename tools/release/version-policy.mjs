import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

export function git(args, cwd = process.cwd()) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function parseVersion(value) {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) {
    throw Error(`Invalid release version ${JSON.stringify(value)}. Use MAJOR.MINOR.PATCH (no v, leading zeros or prerelease suffix).`);
  }
  const parts = value.split(".").map(Number);
  if (!parts.every(Number.isSafeInteger)) throw Error("Version components must be safe integers.");
  return parts;
}

export function validateVersions(pkg, lock) {
  parseVersion(pkg.version);
  if (pkg.version !== lock.version || pkg.version !== lock.packages?.[""]?.version) {
    throw Error("package.json and both root versions in package-lock.json must match. Use npm version <patch|minor|major> --no-git-tag-version.");
  }
  return pkg.version;
}

export function validateBump(previous, next) {
  const [major, minor, patch] = parseVersion(previous);
  parseVersion(next);
  const allowed = [`${major}.${minor}.${patch + 1}`, `${major}.${minor + 1}.0`, `${major + 1}.0.0`];
  if (!allowed.includes(next)) {
    throw Error(`Version must advance from main (${previous}) by one patch, minor or major: ${allowed.join(", ")}. Got ${next}.`);
  }
}

const currentVersionPath = "docs/workspace/version.md";
const archiveRoot = "docs/archive/versions";

function archivePaths(cwd, ref) {
  if (ref) {
    return [...new Set(git(["ls-tree", "-r", "--name-only", ref, "--", archiveRoot], cwd)
      .split("\n")
      .filter((path) => path.startsWith(`${archiveRoot}/`) && path.slice(archiveRoot.length + 1).includes("/"))
      .map((path) => `${archiveRoot}/${path.slice(archiveRoot.length + 1).split("/")[0]}/README.md`))];
  }
  const directory = resolve(cwd, archiveRoot);
  return existsSync(directory)
    ? readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory())
      .map((entry) => `${archiveRoot}/${entry.name}/README.md`)
    : [];
}

function validateVersionDocument(read, path, expected) {
  let contents;
  try {
    contents = read(path);
  } catch {
    throw Error(`Missing version document ${path}. Add an overview with a standalone "Version: ${expected}" line.`);
  }
  const declarations = [...contents.matchAll(/^Version: ([^\r\n]*)\r?$/gm)];
  if (declarations.length !== 1 || declarations[0][1] !== expected) {
    throw Error(`${path} must declare exactly one "Version: ${expected}" line matching its package version or archive folder.`);
  }
  const overview = contents.split(/^## Overview\r?$/m)[1]?.split(/^#{1,2} /m)[0].trim();
  if (!overview) {
    throw Error(`${path} must include a nonempty "## Overview" section.`);
  }
}

export function checkVersion({ base, head, cwd = process.cwd() } = {}) {
  const readText = (path) => head
    ? git(["show", `${head}:${path}`], cwd)
    : readFileSync(resolve(cwd, path), "utf8");
  const read = (path) => JSON.parse(readText(path));
  const version = validateVersions(read("package.json"), read("package-lock.json"));
  validateVersionDocument(readText, currentVersionPath, version);
  const archives = new Set(archivePaths(cwd, head));
  if (base) {
    try {
      // Check the actual branch tip, never GitHub's temporary test merge commit.
      git(["merge-base", "--is-ancestor", base, head || "HEAD"], cwd);
    } catch {
      throw Error("Your branch must include the latest main before releasing. Run git fetch origin main, then git merge origin/main (or rebase), resolve conflicts and recheck the version.");
    }
    const previous = JSON.parse(git(["show", `${base}:package.json`], cwd)).version;
    validateBump(previous, version);
    // Require the version being superseded, including the first release under this policy.
    archives.add(`${archiveRoot}/${previous}/README.md`);
    // Previously archived overviews must survive future releases.
    for (const path of archivePaths(cwd, base)) archives.add(path);
  }
  for (const path of archives) {
    const archivedVersion = path.split("/")[3];
    const parts = parseVersion(archivedVersion);
    const current = parseVersion(version);
    const difference = parts.map((part, index) => part - current[index]).find((part) => part !== 0) ?? 0;
    if (difference >= 0) throw Error(`${path} must describe a past version, earlier than ${version}.`);
    validateVersionDocument(readText, path, archivedVersion);
  }
  return version;
}
