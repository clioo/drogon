// Hunk pins for scripts/accept-mentu-run-delegation.mjs: reverting any of
// this lane's hunks must fail this file; the live desktop run proves the
// behaviour end to end.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const journey = path.join(
  fileURLToPath(new URL(".", import.meta.url)),
  "accept-mentu-run-delegation.mjs",
);

test("mentu journey isolates its daemon from the parent dispatch", async () => {
  const source = await readFile(journey, "utf8");
  assert.ok(
    source.includes("scrubInheritedDispatchBindings();"),
    "the journey must scrub inherited dispatch bindings before spawning",
  );
});

test("mentu journey proves the hash-bound approval gate", async () => {
  const source = await readFile(journey, "utf8");
  for (const pin of [
    "mentu_approval_required",
    "wrong-bytes-approval-refused",
    "desktop-confirms-work-graph-tab-open-on-recipe",
    "second-run-delegated-in-dark-and-settled",
  ]) {
    assert.ok(source.includes(pin), `missing delegation proof: ${pin}`);
  }
});

test("mentu journey drives the surviving surface, not the removed panel", async () => {
  const source = await readFile(journey, "utf8");
  assert.ok(
    !source.includes('[data-testid="mentu-panel"]'),
    "the sidebar Mentu panel is unmounted; the journey must not drive it",
  );
});
