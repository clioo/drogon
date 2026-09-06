#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { snapshotTransportPackage } from "../../../../../../scripts/transport-capsule-runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const sourceRoot = "/Users/carlos/Documents/Drogon-mentu-session";
const revision = "c97906287bb7a390b25e2025b600d9fb3c25d9c3";
const digest = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

const admitted = [
  {
    id: "claim",
    manifest: "agent-session-claim-identity.manifest.json",
    stage: "eng-identity-claim-20260906-a1-vkr7Zn",
    tests: 3,
  },
  {
    id: "lease",
    manifest: "agent-session-lease-renewal.manifest.json",
    stage: "eng-identity-lease-20260906-a2-wBfJh5",
    tests: 2,
  },
  {
    id: "provider-transition",
    manifest: "agent-session-provider-handle-transition.manifest.json",
    stage: "eng-identity-provider-20260906-a1-p6nXh6",
    tests: 2,
  },
];

const baselineRoot = path.dirname(fileURLToPath(import.meta.url));
const stageParent = path.join(root, ".preflight/parity-baseline");

function verifyReceipt(stageRoot, manifestPath) {
  const receipt = JSON.parse(readFileSync(path.join(stageRoot, "stage-receipt.json"), "utf8"));
  assert.equal(receipt.sourceRevision, revision);
  assert.equal(receipt.manifestSha256, digest(manifestPath));
  for (const entry of [...receipt.staged, receipt.license]) {
    assert.equal(digest(entry.target), entry.sha256);
  }
  return receipt;
}

for (const run of admitted) {
  const manifestPath = path.join(baselineRoot, run.manifest);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const stageRoot = path.join(stageParent, run.stage);
  const receipt = verifyReceipt(stageRoot, manifestPath);
  assert.equal(receipt.entryTestFile, manifest.entryTestFile);
  assert.deepEqual(receipt.expectedTestCounts, manifest.expectedTestCounts);
  const results = JSON.parse(readFileSync(path.join(stageRoot, "vitest-results.json"), "utf8"));
  assert.equal(results.success, true);
  assert.equal(results.numTotalTests, run.tests);
  assert.equal(results.numPassedTests, run.tests);
  assert.equal(results.numFailedTests, 0);
  assert.equal(results.numPendingTests, 0);
  assert.equal(results.numTodoTests, 0);
  assert.equal(results.numFailedTestSuites, 0);
}

const rejectedStage = path.join(stageParent, "eng-identity-lease-20260906-a1-Jx9Z01");
verifyReceipt(rejectedStage, path.join(baselineRoot, "agent-session-lease-renewal.manifest.json"));
const rejected = JSON.parse(readFileSync(path.join(rejectedStage, "vitest-results.json"), "utf8"));
assert.equal(rejected.success, false);
assert.equal(rejected.numTotalTests, 0);
assert.equal(rejected.numFailedTestSuites, 1);
assert.match(rejected.testResults[0].message, /Cannot find package 'proper-lockfile'/);

const dependencyLock = JSON.parse(
  readFileSync(path.join(baselineRoot, "dependency-lock.json"), "utf8"),
);
const require = createRequire(path.join(sourceRoot, "package.json"));
for (const expected of dependencyLock.packages) {
  const packageFile = realpathSync(require.resolve(`${expected.name}/package.json`));
  assert.equal(packageFile, expected.packageJsonPath);
  assert.deepEqual(
    snapshotTransportPackage(path.dirname(packageFile)),
    expected.snapshot,
  );
  assert.equal(
    realpathSync(
      path.join(
        stageParent,
        "eng-identity-lease-20260906-a2-wBfJh5/node_modules",
        expected.name,
        "package.json",
      ),
    ),
    packageFile,
  );
}

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    admittedSuites: 3,
    admittedTests: 7,
    admittedAssertionEvaluations: 18,
    rejectedSetupAttempts: 1,
    rejectedCollectedTests: 0,
    sourceRevision: revision,
  })}\n`,
);
