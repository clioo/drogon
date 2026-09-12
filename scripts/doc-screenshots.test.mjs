import test from "node:test";
import assert from "node:assert/strict";

import {
  DESKTOP_VIEWPORT,
  MAX_SCREENSHOT_BYTES,
  NARROW_VIEWPORT,
  parseArgs,
  renderManifest,
} from "./doc-screenshots.mjs";

test("doc screenshot arguments resolve an output directory and bundle", () => {
  const options = parseArgs([
    "--bundle",
    "/tmp/Drogon.app",
    "--output",
    "docs/generated-screenshots",
  ]);
  assert.equal(options.bundle, "/tmp/Drogon.app");
  assert.match(options.output, /docs\/generated-screenshots$/u);
});

test("manifest records each capture and its exact fixture step", () => {
  const manifest = renderManifest([
    {
      filename: "orchestrator-off-light.png",
      note: "Ready to run with optional subagents off.",
      step: "seedGraph() with adversarial disabled.",
      bytes: 123,
    },
  ]);
  assert.match(manifest, /orchestrator-off-light\.png/u);
  assert.match(manifest, /Ready to run/u);
  assert.match(manifest, /seedGraph\(\) with adversarial disabled/u);
  assert.match(manifest, /authoring-canvas surface is not present/u);
});

test("capture constants preserve the documentation viewport and size budget", () => {
  assert.deepEqual(DESKTOP_VIEWPORT, { width: 1440, height: 1000 });
  assert.deepEqual(NARROW_VIEWPORT, { width: 760, height: 1000 });
  assert.equal(MAX_SCREENSHOT_BYTES, 400 * 1024);
});
