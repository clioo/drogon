// Hunk pins for scripts/accept-orchestrator-modes.mjs: reverting the
// dispatch-isolation hunk must fail this file. (The journey itself needs
// a real pi harness, so it stays skipped where that prerequisite is
// missing; the pin only guards the isolation this lane added.)
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const journey = path.join(
  fileURLToPath(new URL(".", import.meta.url)),
  "accept-orchestrator-modes.mjs",
);

test("modes journey isolates its daemon from the parent dispatch", async () => {
  const source = await readFile(journey, "utf8");
  assert.ok(
    source.includes("scrubInheritedDispatchBindings();"),
    "the journey must scrub inherited dispatch bindings before spawning",
  );
});
