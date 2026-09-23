// Hunk pins for scripts/accept-durable-orchestrator.mjs: reverting any of
// this lane's hunks must fail this file; the live desktop run proves the
// behaviour end to end.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const journey = path.join(
  fileURLToPath(new URL(".", import.meta.url)),
  "accept-durable-orchestrator.mjs",
);

test("durable journey isolates its daemon from the parent dispatch", async () => {
  const source = await readFile(journey, "utf8");
  assert.ok(
    source.includes("scrubInheritedDispatchBindings();"),
    "the journey must scrub inherited dispatch bindings before spawning",
  );
});

test("durable fixture speaks the interactive TUI argv, not only headless run", async () => {
  const source = await readFile(journey, "utf8");
  assert.ok(
    source.includes("a.startsWith('--prompt=')"),
    "the fixture must accept the interactive --prompt= argv roles now use",
  );
});

test("durable fixture resolves its files without daemon control-plane env", async () => {
  const source = await readFile(journey, "utf8");
  assert.ok(
    source.includes("fixtureDir('../scenario', 'scenario')"),
    "role sessions strip DROGON_* env, so the fixture must resolve files from the workspace",
  );
});

test("durable journey catches the live native session via the daemon", async () => {
  const source = await readFile(journey, "utf8");
  assert.ok(
    source.includes("main-step-runs-on-live-native-session"),
    "the mid-flight native-session proof must poll the daemon, not race the DOM",
  );
  assert.ok(
    source.includes("expanded finished row shows native sessions"),
    "the settled-row expand must retry past re-render-swallowed clicks",
  );
});
