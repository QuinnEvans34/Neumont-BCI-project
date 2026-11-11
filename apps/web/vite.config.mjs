import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { git, validateVersions } from "../../tools/release/version-policy.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"));
const gitOr = (args, fallback) => {
  try { return git(args, root); } catch { return fallback; }
};

export default defineConfig(({ command }) => {
  const version = validateVersions(read("package.json"), read("package-lock.json"));
  const commit = gitOr(["rev-parse", "HEAD"], "unknown");
  const branch = process.env.GITHUB_HEAD_REF || gitOr(["branch", "--show-current"], "") || "detached";
  const dirty = gitOr(["status", "--porcelain", "--untracked-files=normal"], "unknown") !== "";
  const main = gitOr(["rev-parse", "refs/remotes/origin/main"], "unavailable");
  const channel = command === "serve" ? "Development"
    : branch === "main" && commit === main && !dirty ? "Production" : "Preview";
  return {
    define: {
      __BUILD_INFO__: JSON.stringify({ version, commit: commit.slice(0, 7), branch, dirty, channel }),
    },
  };
});
