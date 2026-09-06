#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateExecution,
  executeCapsule,
  readManifestDigest,
  stageCapsule,
} from "../../../../../../scripts/run-parity-baseline-capsule.mjs";
import {
  stagePackageRuntime,
  verifyPackageRuntime,
} from "../../../../../../scripts/capsule-package-runtime.mjs";
import { snapshotTransportPackage } from "../../../../../../scripts/transport-capsule-runtime.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../..",
);
const SOURCE_ROOT = "/Users/carlos/Documents/Drogon-mentu-session";
const NODE_BIN =
  "/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node";
const VITEST_ENTRY = path.join(SOURCE_ROOT, "node_modules/vitest/vitest.mjs");
const MANIFEST_PATH = path.join(
  REPO_ROOT,
  "tests/parity/ports/WP-ENG-RUNTIME/identity-leases/source-baselines/agent-session-lease-renewal.manifest.json",
);
const DEPENDENCY_LOCK_PATH = path.join(
  REPO_ROOT,
  "tests/parity/ports/WP-ENG-RUNTIME/identity-leases/source-baselines/dependency-lock.json",
);

const digest = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

function resolveVerifiedPackageRuntime() {
  const lock = JSON.parse(readFileSync(DEPENDENCY_LOCK_PATH, "utf8"));
  const require = createRequire(path.join(SOURCE_ROOT, "package.json"));
  const runtime = lock.packages.map((expected) => {
    const packageFile = realpathSync(require.resolve(`${expected.name}/package.json`));
    const metadata = JSON.parse(readFileSync(packageFile, "utf8"));
    assert.equal(packageFile, expected.packageJsonPath);
    assert.equal(metadata.name, expected.name);
    assert.equal(metadata.version, expected.version);
    assert.deepEqual(
      snapshotTransportPackage(path.dirname(packageFile)),
      expected.snapshot,
    );
    return {
      name: expected.name,
      version: expected.version,
      packageFile,
      packageSha256: digest(packageFile),
    };
  });
  return { lock, runtime };
}

try {
  const { lock, runtime } = resolveVerifiedPackageRuntime();
  const receipt = stageCapsule({
    manifestPath: MANIFEST_PATH,
    sourceRoot: SOURCE_ROOT,
    repoRoot: REPO_ROOT,
    label: "eng-identity-lease-20260906-a2",
  });
  stagePackageRuntime(runtime, receipt.capsuleRoot);
  verifyPackageRuntime(runtime, receipt.capsuleRoot);
  const execution = executeCapsule({
    receipt,
    approvedManifestSha256: readManifestDigest(MANIFEST_PATH),
    nodeBin: NODE_BIN,
    vitestEntry: VITEST_ENTRY,
    timeoutMs: 30_000,
    repoRoot: REPO_ROOT,
  });
  const evaluation = evaluateExecution(execution, receipt.expectedTestCounts);
  verifyPackageRuntime(runtime, receipt.capsuleRoot);
  const after = resolveVerifiedPackageRuntime();
  assert.deepEqual(after.lock.packages, lock.packages);
  process.stdout.write(
    `${JSON.stringify(
      {
        scope: "Original source baseline only; not candidate parity.",
        capsuleId: receipt.capsuleId,
        sourceRevision: receipt.sourceRevision,
        capsuleRoot: receipt.capsuleRoot,
        manifestSha256: receipt.manifestSha256,
        dependencyLockSha256: digest(DEPENDENCY_LOCK_PATH),
        dependencyRuntime: runtime.map(({ name, version, packageFile, packageSha256 }) => ({
          name,
          version,
          packageFile,
          packageSha256,
          treeSha256: lock.packages.find((entry) => entry.name === name).snapshot.treeSha256,
        })),
        execution: {
          ...evaluation,
          nodeBin: NODE_BIN,
          nodeVersion: process.version,
          vitestEntry: VITEST_ENTRY,
          vitestVersion: execution.vitestVersion,
          exitCode: execution.exitCode,
          timedOut: execution.timedOut,
          signal: execution.signal,
        },
      },
      null,
      2,
    )}\n`,
  );
  if (!evaluation.ok) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
}
