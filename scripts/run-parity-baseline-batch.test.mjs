import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseBatchArgs,
  runBatch,
  runBounded,
  validateBatch,
  validateConcurrency,
} from "./run-parity-baseline-batch.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
let fixture;
let repoRoot;
let sourceRoot;
let plan;
let vitestEntry;

beforeEach(() => {
  fixture = mkdtempSync(path.join(os.tmpdir(), "drogon-batch-test-"));
  repoRoot = path.join(fixture, "candidate");
  sourceRoot = path.join(fixture, "source");
  mkdirSync(repoRoot);
  mkdirSync(sourceRoot);
  writeFileSync(
    path.join(sourceRoot, "LICENSE"),
    "Fixture license, not upstream source.\n",
  );
  writeFileSync(
    path.join(sourceRoot, "one.test.ts"),
    "// inert fixture assertion file\n",
  );
  execFileSync("git", ["init", "--quiet", sourceRoot]);
  execFileSync("git", ["-C", sourceRoot, "add", "LICENSE", "one.test.ts"]);
  execFileSync("git", [
    "-C",
    sourceRoot,
    "-c",
    "user.name=Capsule Fixture",
    "-c",
    "user.email=capsule@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    "Fixture\n\nCo-authored-by: Codex <noreply@openai.com>",
  ]);
  const revision = execFileSync(
    "git",
    ["-C", sourceRoot, "rev-parse", "HEAD"],
    { encoding: "utf8" },
  ).trim();
  const manifest = {
    capsuleId: "one",
    sourceRevision: revision,
    files: [
      {
        path: "one.test.ts",
        role: "test",
        sha256: hash(readFileSync(path.join(sourceRoot, "one.test.ts"))),
      },
    ],
    entryTestFile: "one.test.ts",
    expectedTestCounts: { tests: 1 },
    license: {
      path: "LICENSE",
      sha256: hash(readFileSync(path.join(sourceRoot, "LICENSE"))),
    },
  };
  plan = {
    schemaVersion: 1,
    capsules: ["one", "two"].map((id) => {
      const bytes = JSON.stringify({ ...manifest, capsuleId: id });
      writeFileSync(path.join(repoRoot, `${id}.json`), bytes);
      return {
        manifestPath: `${id}.json`,
        approvedManifestSha256: hash(bytes),
      };
    }),
  };
  vitestEntry = path.join(fixture, "fixture-vitest.mjs");
  writeFileSync(
    vitestEntry,
    `import { writeFileSync } from 'node:fs';
if (process.argv.includes('--version')) console.log('fixture-vitest, not a real source run');
else {
  const output = process.argv.find(arg => arg.startsWith('--outputFile=')).slice(13);
  writeFileSync(output, JSON.stringify({ numTotalTests:1,numPassedTests:1,
    numFailedTests:0,numPendingTests:0,numTodoTests:0,numFailedTestSuites:0,success:true }));
}\n`,
  );
});

afterEach(() => {
  rmSync(fixture, { recursive: true, force: true });
});

test("requires explicit arguments and refuses duplicate/unknown/missing options", () => {
  assert.deepEqual(
    parseBatchArgs(["--batch", "x.json", "--source-root", sourceRoot]),
    { execute: false, batch: "x.json", sourceRoot },
  );
  for (const args of [
    [],
    ["--batch"],
    ["--random"],
    ["--batch", "--execute"],
    ["--batch", "x", "--batch", "y"],
    ["--execute", "--execute"],
  ]) {
    assert.throws(() => parseBatchArgs(args));
  }
});

test("rejects fractional, unbounded and nonnumeric concurrency", () => {
  for (const value of [0, -1, 5, 1.5, NaN, Infinity, "2"]) {
    assert.throws(() => validateConcurrency(value));
  }
  validateConcurrency(1);
  validateConcurrency(4);
});

test("validates all entries, rejects empty/oversized lists, aliases and stale approvals", () => {
  assert.equal(validateBatch(plan, repoRoot).length, 2);
  for (const malformed of [
    { schemaVersion: 2, capsules: plan.capsules },
    { schemaVersion: 1, capsules: [] },
    { schemaVersion: 1, capsules: Array(257).fill(plan.capsules[0]) },
  ]) {
    assert.throws(() => validateBatch(malformed, repoRoot));
  }
  for (const manifestPath of [
    "../one.json",
    "./one.json",
    path.join(fixture, "one.json"),
  ]) {
    assert.throws(() =>
      validateBatch(
        { ...plan, capsules: [{ ...plan.capsules[0], manifestPath }] },
        repoRoot,
      ),
    );
  }
  plan.capsules[1].approvedManifestSha256 = "0".repeat(64);
  assert.throws(() => validateBatch(plan, repoRoot), /digest mismatch/);
});

test("rejects duplicate paths, duplicate capsule IDs and missing expected counts", () => {
  assert.throws(
    () =>
      validateBatch(
        { ...plan, capsules: [plan.capsules[0], plan.capsules[0]] },
        repoRoot,
      ),
    /Duplicate/,
  );
  const manifest = JSON.parse(
    readFileSync(path.join(repoRoot, "one.json"), "utf8"),
  );
  let bytes = JSON.stringify(manifest);
  writeFileSync(path.join(repoRoot, "two.json"), bytes);
  plan.capsules[1].approvedManifestSha256 = hash(bytes);
  assert.throws(() => validateBatch(plan, repoRoot), /Duplicate capsuleId/);
  delete manifest.expectedTestCounts;
  bytes = JSON.stringify({ ...manifest, capsuleId: "two" });
  writeFileSync(path.join(repoRoot, "two.json"), bytes);
  plan.capsules[1].approvedManifestSha256 = hash(bytes);
  assert.throws(
    () => validateBatch(plan, repoRoot),
    /positive expected test count/,
  );
});

test("invalid later approval prevents even the first capsule from being staged", async () => {
  plan.capsules[1].approvedManifestSha256 = "0".repeat(64);
  await assert.rejects(
    runBatch({ plan, sourceRoot, repoRoot }),
    /digest mismatch/,
  );
  assert.equal(existsSync(path.join(repoRoot, ".preflight")), false);
});

test("bounded pool starts independent jobs, preserves order and continues after a rejection", async () => {
  let active = 0;
  let maximum = 0;
  const gates = [];
  const jobs = [0, 1, 2, 3].map((id) => ({ capsuleId: String(id) }));
  const pending = runBounded(jobs, 2, async (job) => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => gates.push(resolve));
    active--;
    if (job.capsuleId === "1") throw new Error("controlled failure");
    return { capsuleId: job.capsuleId, ok: true };
  });
  assert.equal(gates.length, 2);
  gates[1]();
  await new Promise(setImmediate);
  assert.equal(gates.length, 3);
  gates[0]();
  await new Promise(setImmediate);
  assert.equal(gates.length, 4);
  gates[2]();
  gates[3]();
  const outcomes = await pending;
  assert.equal(maximum, 2);
  assert.deepEqual(
    outcomes.map((item) => item.capsuleId),
    ["0", "1", "2", "3"],
  );
  assert.equal(outcomes[1].ok, false);
  assert.match(outcomes[1].error, /controlled failure/);
  assert.equal(outcomes[3].ok, true);
});

test("actual workers stage distinct immutable capsules without invoking Vitest by default", async () => {
  const report = await runBatch({ plan, sourceRoot, repoRoot });
  assert.equal(report.ok, true);
  assert.equal(report.mode, "stage-only");
  const roots = report.outcomes.map((outcome) => outcome.capsuleRoot);
  assert.equal(new Set(roots).size, 2);
  for (const root of roots) {
    assert.equal(existsSync(path.join(root, "vitest-results.json")), false);
    assert.deepEqual(
      readFileSync(path.join(root, "one.test.ts")),
      readFileSync(path.join(sourceRoot, "one.test.ts")),
    );
  }
});

test("actual workers reuse the capsule evaluator and retained results (fixture runner only)", async () => {
  const report = await runBatch({
    plan,
    sourceRoot,
    repoRoot,
    execute: true,
    vitestEntry,
  });
  assert.equal(report.ok, true);
  for (const outcome of report.outcomes) {
    assert.equal(outcome.execution.counts.numPassedTests, 1);
    assert.match(outcome.execution.vitestVersion, /fixture-vitest/);
    assert.equal(
      JSON.parse(
        readFileSync(path.join(outcome.capsuleRoot, "vitest-results.json")),
      ).success,
      true,
    );
  }
});

test("source drift is a failed staging outcome, never a passing test", async () => {
  writeFileSync(path.join(sourceRoot, "one.test.ts"), "// dirty fixture\n");
  const report = await runBatch({
    plan,
    sourceRoot,
    repoRoot,
    execute: true,
    vitestEntry,
  });
  assert.equal(report.ok, false);
  assert.ok(
    report.outcomes.every(
      (outcome) => !outcome.ok && /Digest mismatch/.test(outcome.error),
    ),
  );
});

test("failed child process remains failed and does not suppress the other job", async () => {
  writeFileSync(
    vitestEntry,
    `if (process.argv.includes('--version')) console.log('fixture');
else process.exit(7);\n`,
  );
  const report = await runBatch({
    plan,
    sourceRoot,
    repoRoot,
    execute: true,
    vitestEntry,
  });
  assert.equal(report.ok, false);
  assert.equal(report.outcomes.length, 2);
  assert.ok(
    report.outcomes.every(
      (outcome) => !outcome.ok && outcome.execution.exitCode === 7,
    ),
  );
});

test("rejects invalid timeout and implicit runtime paths before staging", async () => {
  for (const options of [
    { timeoutMs: 0 },
    { timeoutMs: 120001 },
    { timeoutMs: 0.5 },
    { execute: "yes" },
    { execute: true },
    { sourceRoot: "relative" },
    { execute: true, nodeBin: "node", vitestEntry },
  ]) {
    await assert.rejects(runBatch({ plan, sourceRoot, repoRoot, ...options }));
  }
  assert.equal(existsSync(path.join(repoRoot, ".preflight")), false);
});
