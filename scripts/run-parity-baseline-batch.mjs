#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import {
  assertNoSymlinkInPath,
  assertSafeRelativePath,
  loadManifest,
  readManifestDigest,
} from "./run-parity-baseline-capsule.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const WORKER_URL = new URL(
  "./run-parity-baseline-batch-worker.mjs",
  import.meta.url,
);

export function validateBatch(plan, repoRoot) {
  if (
    plan?.schemaVersion !== 1 ||
    !Array.isArray(plan.capsules) ||
    plan.capsules.length < 1 ||
    plan.capsules.length > 256
  ) {
    throw new Error(
      "Batch requires schemaVersion 1 and 1–256 explicitly reviewed capsules.",
    );
  }
  const paths = new Set();
  const ids = new Set();
  return plan.capsules.map((entry) => {
    assertSafeRelativePath(entry?.manifestPath);
    if (!/^[0-9a-f]{64}$/.test(entry.approvedManifestSha256 ?? "")) {
      throw new Error(
        "Every capsule requires its predeclared approvedManifestSha256.",
      );
    }
    assertNoSymlinkInPath(repoRoot, entry.manifestPath);
    const manifestPath = path.resolve(repoRoot, entry.manifestPath);
    if (paths.has(manifestPath))
      throw new Error("Duplicate manifest path in batch.");
    paths.add(manifestPath);
    const manifest = loadManifest(manifestPath);
    if (ids.has(manifest.capsuleId))
      throw new Error("Duplicate capsuleId in batch.");
    ids.add(manifest.capsuleId);
    if (readManifestDigest(manifestPath) !== entry.approvedManifestSha256) {
      throw new Error(`Approval digest mismatch: ${entry.manifestPath}`);
    }
    if (
      !Number.isSafeInteger(manifest.expectedTestCounts?.tests) ||
      manifest.expectedTestCounts.tests < 1
    ) {
      throw new Error(
        "Batch capsules must declare a positive expected test count.",
      );
    }
    return {
      manifestPath,
      approvedManifestSha256: entry.approvedManifestSha256,
      capsuleId: manifest.capsuleId,
    };
  });
}

export function validateConcurrency(value) {
  if (!Number.isInteger(value) || value < 1 || value > 4) {
    throw new Error("Concurrency must be an integer from 1 through 4.");
  }
}

export async function runBounded(jobs, concurrency, executeJob) {
  validateConcurrency(concurrency);
  const outcomes = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
      while (next < jobs.length) {
        const index = next++;
        try {
          outcomes[index] = await executeJob(jobs[index]);
        } catch (error) {
          outcomes[index] = {
            capsuleId: jobs[index].capsuleId,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
    }),
  );
  return outcomes;
}

function runWorker(options) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_URL, { workerData: options });
    let result;
    worker.on("message", (message) => {
      result = message;
    });
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0 || !result || typeof result.ok !== "boolean") {
        reject(
          new Error(`Capsule worker exited ${code} without a valid result.`),
        );
      } else resolve(result);
    });
  });
}

export async function runBatch({
  plan,
  sourceRoot,
  repoRoot = REPO_ROOT,
  concurrency = 2,
  execute = false,
  timeoutMs = 30000,
  nodeBin = process.execPath,
  vitestEntry,
}) {
  validateConcurrency(concurrency);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
    throw new Error("timeoutMs must be an integer from 1 through 120000.");
  }
  if (typeof sourceRoot !== "string" || !path.isAbsolute(sourceRoot)) {
    throw new Error("An explicit absolute sourceRoot is required.");
  }
  if (typeof execute !== "boolean") throw new Error("execute must be boolean.");
  if (
    execute &&
    (!path.isAbsolute(nodeBin) ||
      typeof vitestEntry !== "string" ||
      !path.isAbsolute(vitestEntry))
  ) {
    throw new Error(
      "Execution requires explicit absolute nodeBin and vitestEntry paths.",
    );
  }
  // Validate every approval before starting any worker; execution rechecks staged bindings.
  const jobs = validateBatch(plan, repoRoot);
  const outcomes = await runBounded(jobs, concurrency, (job) =>
    runWorker({
      ...job,
      sourceRoot,
      repoRoot,
      execute,
      timeoutMs,
      nodeBin,
      vitestEntry,
    }),
  );
  return {
    schemaVersion: 1,
    mode: execute ? "execute" : "stage-only",
    concurrency,
    ok: outcomes.every((outcome) => outcome.ok === true),
    outcomes,
    scope:
      "Reviewed source capsules only; neither a security sandbox nor candidate parity.",
  };
}

export function parseBatchArgs(argv) {
  const options = { execute: false };
  const fields = {
    "--batch": "batch",
    "--source-root": "sourceRoot",
    "--concurrency": "concurrency",
    "--timeout-ms": "timeoutMs",
    "--node-bin": "nodeBin",
    "--vitest-entry": "vitestEntry",
  };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (seen.has(flag)) throw new Error(`Duplicate option: ${flag}`);
    seen.add(flag);
    if (flag === "--execute") {
      options.execute = true;
      continue;
    }
    if (!fields[flag] || !argv[i + 1] || argv[i + 1].startsWith("--")) {
      throw new Error(`Unknown option or missing value: ${flag}`);
    }
    const value = argv[++i];
    options[fields[flag]] = ["concurrency", "timeoutMs"].includes(fields[flag])
      ? Number(value)
      : value;
  }
  if (!options.batch || !options.sourceRoot)
    throw new Error("Required: --batch and --source-root.");
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { batch, ...options } = parseBatchArgs(process.argv.slice(2));
    const report = await runBatch({
      ...options,
      plan: JSON.parse(readFileSync(batch, "utf8")),
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`Batch refused: ${error.message}\n`);
    process.exitCode = 1;
  }
}
