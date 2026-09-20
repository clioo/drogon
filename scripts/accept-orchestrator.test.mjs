// Hunk pins for scripts/accept-orchestrator.mjs: reverting any of this
// lane's hunks must fail this file; the live desktop run proves the
// behaviour end to end.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const journey = path.join(
  fileURLToPath(new URL(".", import.meta.url)),
  "accept-orchestrator.mjs",
);

test("orchestrator journey isolates its daemon from the parent dispatch", async () => {
  const source = await readFile(journey, "utf8");
  assert.ok(
    source.includes("scrubInheritedDispatchBindings();"),
    "the journey must scrub inherited dispatch bindings before spawning",
  );
});

test("orchestrator journey follows the Agent telemetry rename", async () => {
  const source = await readFile(journey, "utf8");
  assert.ok(
    source.includes('name: /Agent telemetry/'),
    "the evidence tab ships as Agent telemetry now",
  );
});

test("orchestrator journey pins the current delegate brief verb", async () => {
  const source = await readFile(journey, "utf8");
  assert.ok(
    source.includes("drogon-cli graph read --workspace"),
    "the brief teaches the workspace-scoped read verb",
  );
});

test("orchestrator journey proves the run lifecycle, not the retired loop", async () => {
  const source = await readFile(journey, "utf8");
  for (const pin of [
    "empty-main-task-cannot-dispatch",
    "run-workflow-dispatches-a-real-durable-run",
    "run-workflow-stops-honestly-and-never-fabricates-success",
  ]) {
    assert.ok(source.includes(pin), `missing lifecycle proof: ${pin}`);
  }
  assert.ok(
    !source.includes("Waiting for the main agent's delegated turn to finish"),
    "the retired session-dispatch loop text must not gate the run",
  );
});
