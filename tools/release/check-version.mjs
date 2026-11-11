import { parseArgs } from "node:util";
import { checkVersion } from "./version-policy.mjs";

try {
  const { values } = parseArgs({ options: { base: { type: "string" }, head: { type: "string" } } });
  const version = checkVersion(values);
  console.log(`Version policy passed: v${version}${values.base ? ` (based on ${values.base})` : ""}.`);
} catch (error) {
  console.error(`Version policy failed: ${error.message}`);
  process.exitCode = 1;
}
