import { parentPort, workerData } from "node:worker_threads";
import {
  stageCapsule,
  executeCapsule,
  evaluateExecution,
  readManifestDigest,
} from "./run-parity-baseline-capsule.mjs";

if (!parentPort) throw new Error("This module only runs as a batch worker.");

const {
  capsuleId,
  manifestPath,
  approvedManifestSha256,
  sourceRoot,
  repoRoot,
  execute,
  nodeBin,
  vitestEntry,
  timeoutMs,
} = workerData;
let receipt;
try {
  if (readManifestDigest(manifestPath) !== approvedManifestSha256) {
    throw new Error("Manifest changed after batch preflight.");
  }
  receipt = stageCapsule({ manifestPath, sourceRoot, repoRoot });
  if (
    receipt.manifestSha256 !== approvedManifestSha256 ||
    receipt.capsuleId !== capsuleId
  ) {
    throw new Error("Staged manifest differs from the approved batch entry.");
  }
  const report = {
    capsuleId,
    ok: true,
    capsuleRoot: receipt.capsuleRoot,
    sourceRevision: receipt.sourceRevision,
    manifestSha256: receipt.manifestSha256,
    mode: execute ? "execute" : "stage-only",
    execution: null,
  };
  if (execute) {
    const result = executeCapsule({
      receipt,
      approvedManifestSha256,
      nodeBin,
      vitestEntry,
      timeoutMs,
      repoRoot,
    });
    const evaluation = evaluateExecution(result, receipt.expectedTestCounts);
    report.ok = evaluation.ok;
    report.execution = {
      ...evaluation,
      nodeBin,
      vitestEntry,
      vitestVersion: result.vitestVersion,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      signal: result.signal,
    };
  }
  parentPort.postMessage(report);
} catch (error) {
  parentPort.postMessage({
    capsuleId,
    ok: false,
    capsuleRoot: receipt?.capsuleRoot ?? null,
    error: error instanceof Error ? error.message : String(error),
  });
}
