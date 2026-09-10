import { readFileSync } from "node:fs";

// Stage payload, NOT a supervisor: runs UNDER the frozen outer. Extracts the
// terminal PACKAGED record exactly as scripts/build-main.sh does (findLast
// status==="PACKAGED", require .bundle). Argv contains no --bundle/--files
// ELEMENTS (frozen outer line 48 bans those elements), only a log path.
// Usage: <node> s10-extract-bundle.mjs <package.log>
const lines = readFileSync(process.argv[2], "utf8").trim().split("\n");
const records = lines.flatMap((line) => {
  try {
    return [JSON.parse(line)];
  } catch {
    return [];
  }
});
const result = records.findLast((record) => record.status === "PACKAGED");
if (!result?.bundle) throw new Error("Packager did not report a bundle");
process.stdout.write(result.bundle);
