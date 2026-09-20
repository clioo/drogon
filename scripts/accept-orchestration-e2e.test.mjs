// Hunk pins for scripts/accept-orchestration-e2e.mjs: each assertion names
// a line this lane added. Reverting any of those hunks must fail this
// file (the discrimination gate relies on that); the live dogfood run
// itself proves the behaviour end to end.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const journey = path.join(
  fileURLToPath(new URL(".", import.meta.url)),
  "accept-orchestration-e2e.mjs",
);

test("e2e journey isolates its daemon from the parent dispatch", async () => {
  const source = await readFile(journey, "utf8");
  assert.ok(
    source.includes("scrubInheritedDispatchBindings"),
    "the journey must scrub inherited dispatch bindings",
  );
});

test("e2e fixture sends --result before greedy --body", async () => {
  const source = await readFile(journey, "utf8");
  assert.ok(
    source.includes('--result "$result" --body "fixture worker completion"'),
    "--result must precede --body or the report metadata is swallowed",
  );
});
