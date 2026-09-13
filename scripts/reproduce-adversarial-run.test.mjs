// Unit coverage for the reproducible run's own rules: the cost buckets, the
// harness catalog it offers, the fixture shims it writes, and the scenario
// contract at both stages (3 failures without undo, green with it). The full
// chain is exercised by running it — `make repro` — not from here.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { priceUsage } from "./reproduce-adversarial-run.mjs";
import {
  HARNESS_CATALOG,
  harnessById,
  writeHarnessFixtures,
} from "./reproduce-harness-fixture.mjs";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const scenario = path.join(root, "scripts/scenarios/dog-tinder");

const card = JSON.parse(
  await readFile(path.join(root, "scripts/reproduce-model-rates.v1.json"), "utf8"),
);

test("an empty usage ledger is not reported, never zero", () => {
  const cost = priceUsage([], card);
  assert.equal(cost.bucket, "not_reported");
  assert.equal(cost.totalUsd, null);
  assert.equal(cost.inputTokens, null);
});

test("every measurement priced is an exact total, split by role", () => {
  const cost = priceUsage(
    [
      {
        role: "main",
        harness: "opencode",
        model: "fixture/dog-tinder",
        inputTokens: 1_000_000,
        outputTokens: 100_000,
      },
      {
        role: "test",
        harness: "opencode",
        model: "fixture/dog-tinder",
        inputTokens: 500_000,
      },
    ],
    card,
  );
  // 1M in at $3 + 100k out at $15 = $4.50; 500k in at $3 = $1.50.
  assert.equal(cost.bucket, "exact");
  assert.equal(cost.totalUsd, 6);
  assert.deepEqual(cost.byRole, { main: 4.5, test: 1.5 });
  assert.equal(cost.inputTokens, 1_500_000);
  assert.equal(cost.outputTokens, 100_000);
});

test("a model the rate card does not know is unpriced, and names itself", () => {
  const cost = priceUsage(
    [
      { role: "main", harness: "pi", model: "some-unknown-model", inputTokens: 10 },
      { role: "test", harness: "opencode", model: "fixture/dog-tinder", inputTokens: 10 },
    ],
    card,
  );
  assert.equal(cost.bucket, "partial");
  assert.equal(cost.pricedMeasurements, 1);
  assert.deepEqual(cost.unpriced, [{ harness: "pi", model: "some-unknown-model" }]);
});

test("a declared-free local model is reported as free, not as a bill", () => {
  const cost = priceUsage(
    [
      {
        role: "main",
        harness: "pi",
        model: "dgx-spark/qwen3.8-flash-next-nvidia-nvfp4",
        inputTokens: 2_000_000,
        outputTokens: 500_000,
      },
    ],
    card,
  );
  assert.equal(cost.bucket, "local_free");
  assert.equal(cost.totalUsd, 0);
});

test("the rate card prices the free local lane at zero and says why", () => {
  const lane = card.rates["dgx-spark/qwen3.8-flash-next-nvidia-nvfp4"];
  assert.equal(lane.kind, "local_free");
  assert.equal(lane.input, 0);
  assert.equal(lane.output, 0);
  assert.match(card.note, /never as zero/);
});

test("the catalog refuses the harness the compiler cannot run, with the reason", () => {
  const antigravity = harnessById("antigravity");
  assert.equal(antigravity.graphCapable, false);
  assert.match(antigravity.adapter, /no adapter in mentu-recipes/);
  assert.equal(
    HARNESS_CATALOG.filter((entry) => entry.graphCapable).map((entry) => entry.id).join(","),
    "claude,codex,opencode,pi",
  );
});

test("each fixture shim is executable, names its harness, and claims no inference", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "repro-fixture-"));
  try {
    const written = await writeHarnessFixtures(path.join(directory, "bin"), [
      "opencode",
      "pi",
    ]);
    assert.deepEqual(
      written.map((file) => path.basename(file)),
      ["opencode", "pi"],
    );
    for (const file of written) {
      const info = await stat(file);
      assert.ok(info.mode & 0o111, `${file} must be executable`);
      const text = await readFile(file, "utf8");
      assert.match(text, /reproduce-harness-agent\.mjs/);
      assert.match(text, /No inference/);
    }
    // `--version` is what harness discovery probes: the shim answers as the
    // harness it stands in for, and says it is a fixture.
    const { stdout } = await execFileAsync(path.join(directory, "bin", "opencode"), [
      "--version",
    ]);
    assert.match(stdout, /^opencode drogon-repro-fixture/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the scenario's own contract fails without undo and passes with it", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "repro-scenario-"));
  try {
    await cp(path.join(scenario, "seed"), directory, { recursive: true });
    await cp(path.join(scenario, "agent-stage-1"), directory, { recursive: true });
    const stage1 = await runTests(directory);
    assert.equal(stage1.pass, 3, "the deck without undo passes only the swipe tests");
    assert.equal(stage1.fail, 3, "the three undo-shaped tests must fail");

    await cp(path.join(scenario, "agent-stage-2"), directory, { recursive: true });
    const stage2 = await runTests(directory);
    assert.equal(stage2.pass, 6);
    assert.equal(stage2.fail, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the spec the run writes is not in the seed, so the watch sees a real change", async () => {
  const specs = await readdir(path.join(scenario, "seed/specs"));
  assert.deepEqual(specs, ["README.md"]);
  const spec = await readFile(path.join(scenario, "spec.md"), "utf8");
  assert.match(spec, /Undo of the last swipe/);
});

async function runTests(cwd) {
  // A test runner inside a test runner: the child must not inherit this run's
  // reporter context, or it answers over the parent's IPC instead of TAP.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  const result = await execFileAsync(
    process.execPath,
    ["--test", "--test-reporter", "tap"],
    { cwd, env, timeout: 120_000 },
  ).catch((error) => ({ stdout: error.stdout ?? "", stderr: error.stderr ?? "" }));
  const output = `${result.stdout}${result.stderr}`;
  const count = (label) => Number(output.match(new RegExp(`^# ${label} (\\d+)$`, "m"))?.[1] ?? NaN);
  return { pass: count("pass"), fail: count("fail") };
}
