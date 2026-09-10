import { mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";

// Stage payload, NOT a supervisor: runs UNDER the frozen outer. Creates the
// retained run dir (evidence; never deleted by the lane) and prints it for
// readback from the retained runner.log. Usage: <node> s3-make-rundir.mjs <execRoot>
const execRoot = path.resolve(process.argv[2]);
mkdirSync(path.join(execRoot, ".preflight", "build-main"), { recursive: true });
const run = mkdtempSync(
  path.join(execRoot, ".preflight", "build-main", "run-"),
);
console.log(run);
