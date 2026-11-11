import { readFileSync } from "node:fs";
import { checkVersion, git } from "./version-policy.mjs";

try {
  const refs = readFileSync(0, "utf8").trim().split("\n").filter(Boolean).map((line) => line.trim().split(/\s+/));
  if (refs.some(([, , remoteRef]) => remoteRef === "refs/heads/main")) {
    throw Error("main is production. Direct pushes and deletion are blocked. Push a feature branch and merge a passing PR into main.");
  }
  const updates = refs.filter(([, sha, remoteRef]) => !/^0+$/.test(sha) && remoteRef.startsWith("refs/heads/"));
  if (updates.length) {
    // Fetch on every push so an old local origin/main cannot pass this check.
    git(["fetch", "origin", "+refs/heads/main:refs/remotes/origin/main"]);
    for (const [localRef, head] of updates) {
      checkVersion({ base: "origin/main", head });
      console.log(`Push guard passed: ${localRef}.`);
    }
  }
} catch (error) {
  console.error(`Push blocked: ${error.message}`);
  process.exitCode = 1;
}
