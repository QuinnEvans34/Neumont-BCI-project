import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync } from "node:fs";

// CI uses required checks. Source archives do not have a Git configuration.
if (!process.env.CI && spawnSync("git", ["rev-parse", "--git-dir"], { stdio: "ignore" }).status === 0) {
  const existing = spawnSync("git", ["config", "--get", "core.hooksPath"], { encoding: "utf8" }).stdout?.trim();
  if (existing && existing !== ".githooks") {
    console.error(`Existing hooksPath (${existing}) preserved. Add the pre-push guard to your hooks before pushing; see docs/archive/logs/releases.md.`);
  } else {
    chmodSync(".githooks/pre-push", 0o755);
    execFileSync("git", ["config", "--local", "core.hooksPath", ".githooks"], { stdio: "inherit" });
    console.log("Installed main/version pre-push guard.");
  }
}
