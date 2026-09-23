// Hunk pins for scripts/accept-cli-worktree-lineage.mjs: reverting the
// dispatch-isolation hunk must fail this file.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const journey = path.join(
  fileURLToPath(new URL(".", import.meta.url)),
  "accept-cli-worktree-lineage.mjs",
);

test("lineage journey isolates its daemon from the parent dispatch", async () => {
  const source = await readFile(journey, "utf8");
  assert.ok(
    source.includes("scrubInheritedDispatchBindings();"),
    "the journey must scrub inherited dispatch bindings before spawning",
  );
});
