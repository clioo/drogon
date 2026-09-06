#!/usr/bin/env node
// Stages a pinned, hash-verified slice of the read-only legacy source tree
// into a fresh, atomically-created fixture under this repo's canonical
// .preflight/parity-baseline location, and, only with an explicit opt-in
// flag plus a caller-supplied execution-approval digest, runs it with the
// vitest entry module already installed under apps/desktop.
//
// Not a general sandbox: a temp directory does not make arbitrary source
// safe to run. Only files pinned by exact relative path + sha256 against a
// pinned source git revision are staged. Execution is bound to a stage
// receipt produced (and written to disk) at staging time -- the approval
// digest is compared against the manifest bytes as they were when staged,
// never reread from a possibly-since-edited manifest file at execute time.
// See docs/migration/parity-baseline-capsule.md for what is and is not
// runtime-enforced.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRendererRuntime, stageRendererRuntime, verifyRendererRuntime } from './renderer-capsule-runtime.mjs';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const VITEST_ENTRY = path.join(
  REPO_ROOT,
  "apps/desktop/node_modules/vitest/vitest.mjs",
);
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const STAGE_RECEIPT_NAME = "stage-receipt.json";
const RESERVED_GENERATED_PATHS = [
  "vitest.config.mjs",
  "vitest-results.json",
  STAGE_RECEIPT_NAME,
];
const SAFE_SINGLE_COMPONENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

class CapsuleRefusal extends Error {}

function parseArgs(argv) {
  const args = {
    manifest: null,
    sourceRoot: null,
    execute: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    approvedManifestSha256: null,
    nodeBin: process.execPath,
    vitestEntry: VITEST_ENTRY,
    label: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--manifest":
        args.manifest = argv[++i];
        break;
      case "--source-root":
        args.sourceRoot = argv[++i];
        break;
      case "--execute":
        args.execute = true;
        break;
      case "--timeout-ms":
        args.timeoutMs = Number(argv[++i]);
        break;
      case "--approved-manifest-sha256":
        args.approvedManifestSha256 = argv[++i];
        break;
      case "--node-bin":
        args.nodeBin = argv[++i];
        break;
      case "--vitest-entry":
        args.vitestEntry = argv[++i];
        break;
      case "--label":
        args.label = argv[++i];
        break;
      default:
        throw new CapsuleRefusal(`Unrecognized argument: ${arg}`);
    }
  }
  if (!args.manifest || !args.sourceRoot) {
    throw new CapsuleRefusal(
      "Required: --manifest <path> --source-root <path>. This runner never " +
        "guesses a source location, and never accepts a caller-chosen capsule " +
        "location -- staging always lands under the canonical " +
        ".preflight/parity-baseline.",
    );
  }
  if (
    !Number.isFinite(args.timeoutMs) ||
    args.timeoutMs <= 0 ||
    args.timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new CapsuleRefusal(
      `--timeout-ms must be a positive number <= ${MAX_TIMEOUT_MS}.`,
    );
  }
  if (args.execute && !args.approvedManifestSha256) {
    throw new CapsuleRefusal(
      "--execute requires --approved-manifest-sha256 <hex>: the sha256 of " +
        "the exact manifest file bytes staged. This is a caller-supplied " +
        "binding, not independent proof of review.",
    );
  }
  return args;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Rejects anything but a single safe path component: no separators, no
 * '..'/'.' alias, no null byte, bounded length. Used for capsuleId/label,
 * which flow directly into an mkdtemp prefix -- validated before any
 * mkdir/mkdtemp call is made. */
function assertSafeSingleComponentId(id, fieldLabel) {
  if (
    typeof id !== "string" ||
    !SAFE_SINGLE_COMPONENT_ID.test(id) ||
    id.includes("/") ||
    id.includes("\\") ||
    id.includes("\0")
  ) {
    throw new CapsuleRefusal(
      `${fieldLabel} must be a single safe path component (letters/digits, ` +
        `then letters/digits/._- , max 64 chars, no separators): ${JSON.stringify(id)}`,
    );
  }
}

/** Rejects absolute paths, backslashes, alias forms ('.'/'..'), and null bytes. */
function assertSafeRelativePath(relPath) {
  if (typeof relPath !== "string" || relPath.length === 0) {
    throw new CapsuleRefusal("Manifest file path must be a non-empty string.");
  }
  if (relPath.includes("\0")) {
    throw new CapsuleRefusal(`Refusing path with a null byte: ${relPath}`);
  }
  if (relPath.includes("\\")) {
    throw new CapsuleRefusal(`Refusing path with a backslash: ${relPath}`);
  }
  if (path.isAbsolute(relPath)) {
    throw new CapsuleRefusal(`Refusing absolute manifest path: ${relPath}`);
  }
  const normalized = path.posix.normalize(relPath);
  if (normalized !== relPath || normalized.split("/").includes("..")) {
    throw new CapsuleRefusal(
      `Refusing manifest path that normalizes differently (an alias form) or escapes via '..': ${relPath}`,
    );
  }
}

/** Walks every existing path component under root; refuses on any symlink.
 * When tolerateMissing is true, stops at the first component that doesn't
 * exist yet (used for destination ancestry we intend to create). */
function assertNoSymlinkInPath(root, relPath, { tolerateMissing = false } = {}) {
  const segments = relPath.split("/").filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = lstatSync(current);
    } catch {
      if (tolerateMissing) return;
      throw new CapsuleRefusal(`Manifest path does not exist: ${relPath}`);
    }
    if (stat.isSymbolicLink()) {
      throw new CapsuleRefusal(
        `Refusing symlinked path component in ${relPath} (at ${current}).`,
      );
    }
  }
}

/** True if `inner` is equal to or nested inside `outer`. */
function isSameOrNested(outer, inner) {
  const rel = path.relative(path.resolve(outer), path.resolve(inner));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function assertNoOverlap(sourceRoot, repoRoot) {
  if (isSameOrNested(sourceRoot, repoRoot) || isSameOrNested(repoRoot, sourceRoot)) {
    throw new CapsuleRefusal(
      `Refusing overlapping source-root/repo-root: ${sourceRoot} vs ${repoRoot}.`,
    );
  }
}

function loadManifest(manifestPath) {
  let raw;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch (error) {
    throw new CapsuleRefusal(`Cannot read manifest: ${error.message}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    throw new CapsuleRefusal(`Manifest is not valid JSON: ${error.message}`);
  }
  if (typeof manifest.capsuleId !== "string" || manifest.capsuleId.length === 0) {
    throw new CapsuleRefusal("Manifest must declare a non-empty capsuleId.");
  }
  assertSafeSingleComponentId(manifest.capsuleId, "capsuleId");
  if (typeof manifest.sourceRevision !== "string" || !/^[0-9a-f]{40}$/.test(manifest.sourceRevision)) {
    throw new CapsuleRefusal(
      "Manifest sourceRevision must be a full 40-character lowercase git SHA.",
    );
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new CapsuleRefusal("Manifest must declare a non-empty files array.");
  }
  const seenRelPaths = new Set();
  for (const entry of manifest.files) {
    if (
      !entry ||
      typeof entry.path !== "string" ||
      typeof entry.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(entry.sha256) ||
      (entry.role !== "test" && entry.role !== "module")
    ) {
      throw new CapsuleRefusal(
        `Manifest file entry is malformed: ${JSON.stringify(entry)}`,
      );
    }
    assertSafeRelativePath(entry.path);
    const normalizedKey = path.posix.normalize(entry.path);
    if (seenRelPaths.has(normalizedKey)) {
      throw new CapsuleRefusal(
        `Manifest declares a duplicate file path: ${entry.path}`,
      );
    }
    seenRelPaths.add(normalizedKey);
  }
  if (!manifest.entryTestFile || !seenRelPaths.has(path.posix.normalize(manifest.entryTestFile))) {
    throw new CapsuleRefusal(
      "Manifest entryTestFile must be one of the declared files.",
    );
  }
  if (
    !manifest.license ||
    typeof manifest.license.path !== "string" ||
    typeof manifest.license.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(manifest.license.sha256)
  ) {
    throw new CapsuleRefusal(
      "Manifest must declare a license { path, sha256 } for provenance.",
    );
  }
  assertSafeRelativePath(manifest.license.path);
  return manifest;
}

function verifySourceRevision(sourceRoot, expectedRevision) {
  let actual;
  try {
    actual = execFileSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch (error) {
    throw new CapsuleRefusal(
      `Could not read source revision via git: ${error.message}`,
    );
  }
  if (actual !== expectedRevision) {
    throw new CapsuleRefusal(
      `Source revision mismatch: manifest pins ${expectedRevision}, source-root HEAD is ${actual}.`,
    );
  }
  return actual;
}

/** Reads bytes from source-root, verifying digest against both the working
 * tree and the pinned git revision, so a dirty edit to a pinned file (even
 * one that happens to still match on disk) cannot slip past unnoticed.
 * Read-only: never writes to sourceRoot. */
function readVerifiedFile(sourceRoot, revision, relPath, expectedSha256) {
  assertSafeRelativePath(relPath);
  assertNoSymlinkInPath(sourceRoot, relPath);
  const resolved = path.resolve(path.join(sourceRoot, relPath));
  if (!isSameOrNested(sourceRoot, resolved) || resolved === path.resolve(sourceRoot)) {
    throw new CapsuleRefusal(`Manifest path escapes source root: ${relPath}`);
  }
  const workingTreeBytes = readFileSync(resolved);
  const workingTreeDigest = sha256(workingTreeBytes);
  if (workingTreeDigest !== expectedSha256) {
    throw new CapsuleRefusal(
      `Digest mismatch for ${relPath}: manifest declares ${expectedSha256}, working tree has ${workingTreeDigest}.`,
    );
  }
  let revisionBytes;
  try {
    revisionBytes = execFileSync(
      "git",
      ["-C", sourceRoot, "show", `${revision}:${relPath}`],
      { maxBuffer: 16 * 1024 * 1024 },
    );
  } catch (error) {
    throw new CapsuleRefusal(
      `Could not read ${relPath} at pinned revision ${revision}: ${error.message}`,
    );
  }
  const revisionDigest = sha256(revisionBytes);
  if (revisionDigest !== expectedSha256) {
    throw new CapsuleRefusal(
      `Digest mismatch for ${relPath} at pinned revision: manifest declares ${expectedSha256}, revision blob has ${revisionDigest}.`,
    );
  }
  return workingTreeBytes;
}

/** Where every capsule must live: <repoRoot>/.preflight/parity-baseline.
 * Not overridable by a caller-supplied capsule path. */
export function resolveCanonicalCapsuleParent(repoRoot) {
  return path.join(path.resolve(repoRoot), ".preflight", "parity-baseline");
}

/** Verifies the canonical parent's existing ancestry has no symlinked
 * component, creates it if missing, then confirms the final directory
 * itself is a real (non-symlinked) directory. This is the first
 * filesystem-mutating call stageCapsule makes, and it only runs after the
 * capsule id/label has already been validated. */
function ensureCanonicalCapsuleParent(repoRoot) {
  const resolvedRepoRoot = path.resolve(repoRoot);
  const repoRootStat = lstatSync(resolvedRepoRoot);
  if (!repoRootStat.isDirectory() || repoRootStat.isSymbolicLink()) {
    throw new CapsuleRefusal(`repoRoot is not a plain directory: ${resolvedRepoRoot}`);
  }
  assertNoSymlinkInPath(resolvedRepoRoot, ".preflight/parity-baseline", {
    tolerateMissing: true,
  });
  const capsuleParent = resolveCanonicalCapsuleParent(resolvedRepoRoot);
  mkdirSync(capsuleParent, { recursive: true });
  const stat = lstatSync(capsuleParent);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new CapsuleRefusal(`Canonical capsule parent is not a plain directory: ${capsuleParent}`);
  }
  return capsuleParent;
}

/** Exclusive-creates target: refuses (does not follow or overwrite) if
 * anything already exists at that exact path, including a symlink. */
function stageFileExclusive(target, bytes) {
  mkdirSync(path.dirname(target), { recursive: true });
  try {
    writeFileSync(target, bytes, { flag: "wx" });
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new CapsuleRefusal(`Refusing to write over an existing/colliding path: ${target}`);
    }
    throw error;
  }
  return sha256(readFileSync(target));
}

const GENERATED_VITEST_CONFIG = `// Generated by scripts/run-parity-baseline-capsule.mjs. Not sourced from the
// legacy repository; intentionally minimal so the capsule's execution
// environment is not silently widened by any host project's own config.
export default { test: { include: ["**/*.test.ts"], environment: "node" } };
`;

function generatedVitestConfig(entryTestFile, rendererRuntime = null) {
  if (rendererRuntime) {
    const extension = entryTestFile.endsWith('.test.tsx') ? 'tsx' : 'ts';
    return `export default { esbuild: { jsx: "automatic" }, test: { include: ["**/*.test.${extension}"], environment: "node" } };\n`;
  }
  for (const extension of ['mjs', 'tsx']) {
    if (entryTestFile.endsWith(`.test.${extension}`)) {
      return GENERATED_VITEST_CONFIG.replace('**/*.test.ts', `**/*.test.${extension}`);
    }
  }
  return GENERATED_VITEST_CONFIG;
}

/**
 * Validates a manifest, verifies the pinned source revision and every file's
 * digest, then stages exact bytes into a freshly and atomically created
 * directory under the canonical .preflight/parity-baseline parent. Never
 * executes anything. All source reads and path/collision checks (phase A)
 * complete before any write (phase B) begins; the capsuleId/label is
 * validated as a safe single path component before the first mkdir.
 *
 * Returns a stage receipt (also written to <capsuleRoot>/stage-receipt.json)
 * that executeCapsule requires and cross-checks against that on-disk copy --
 * this is the binding between a capsuleRoot, its entry test file, and the
 * manifest digest that was actually staged.
 */
export function stageCapsule({ manifestPath, sourceRoot, repoRoot = REPO_ROOT, label }) {
  assertNoOverlap(sourceRoot, repoRoot);
  const manifest = loadManifest(manifestPath);
  if (label !== undefined && label !== null) {
    assertSafeSingleComponentId(label, "label");
  }
  const idForDirName = label ?? manifest.capsuleId;
  assertSafeSingleComponentId(idForDirName, "label/capsuleId");
  const manifestSha256 = sha256(readFileSync(manifestPath));
  const revision = verifySourceRevision(sourceRoot, manifest.sourceRevision);
  const rendererRuntime = resolveRendererRuntime(manifest.rendererRuntime, sourceRoot);
  if (rendererRuntime && [...manifest.files, manifest.license].some((entry) => entry.path.split('/').includes('node_modules'))) {
    throw new CapsuleRefusal('Renderer runtime reserves node_modules for explicit dependency links.');
  }

  // First filesystem-mutating call: only reached once the id above is safe.
  const capsuleParent = ensureCanonicalCapsuleParent(repoRoot);
  const capsuleRoot = mkdtempSync(path.join(capsuleParent, `${idForDirName}-`));

  // Phase A: validate every target path (including reserved generated
  // names) and every source byte before writing anything.
  const collisionKeys = new Set(RESERVED_GENERATED_PATHS);
  const planned = [];
  const planEntry = (relPath, role, expectedSha256) => {
    const key = path.posix.normalize(relPath);
    if (collisionKeys.has(key)) {
      throw new CapsuleRefusal(`Manifest path collides with a reserved or duplicate target: ${relPath}`);
    }
    collisionKeys.add(key);
    const target = path.resolve(path.join(capsuleRoot, relPath));
    if (!isSameOrNested(capsuleRoot, target) || target === path.resolve(capsuleRoot)) {
      throw new CapsuleRefusal(`Staging target escapes capsule root: ${relPath}`);
    }
    const bytes = readVerifiedFile(sourceRoot, revision, relPath, expectedSha256);
    planned.push({ path: relPath, role, sha256: expectedSha256, target, bytes });
  };
  for (const entry of manifest.files) {
    planEntry(entry.path, entry.role, entry.sha256);
  }
  planEntry(manifest.license.path, "license", manifest.license.sha256);

  // Phase B: write only after every plan entry above passed validation.
  const staged = [];
  for (const item of planned) {
    const stagedDigest = stageFileExclusive(item.target, item.bytes);
    if (stagedDigest !== item.sha256) {
      throw new CapsuleRefusal(
        `Post-write digest check failed for ${item.path}: expected ${item.sha256}, staged file has ${stagedDigest}.`,
      );
    }
    staged.push({ path: item.path, role: item.role, sha256: stagedDigest, target: item.target });
  }

  const configPath = path.join(capsuleRoot, "vitest.config.mjs");
  writeFileSync(configPath, generatedVitestConfig(manifest.entryTestFile, rendererRuntime), { flag: "wx" });
  stageRendererRuntime(rendererRuntime, capsuleRoot);

  const licenseStaged = staged.find((s) => s.role === "license");
  const license = {
    path: manifest.license.path,
    sha256: licenseStaged.sha256,
    target: licenseStaged.target,
    spdxId: manifest.license.spdxId ?? null,
    copyright: manifest.license.copyright ?? null,
  };
  const nonLicenseStaged = staged.filter((s) => s.role !== "license");

  const receipt = {
    capsuleId: manifest.capsuleId,
    sourceRevision: revision,
    manifestSha256,
    entryTestFile: manifest.entryTestFile,
    expectedTestCounts: manifest.expectedTestCounts ?? null,
    rendererRuntime,
    capsuleRoot,
    staged: nonLicenseStaged,
    license,
  };
  writeFileSync(
    path.join(capsuleRoot, STAGE_RECEIPT_NAME),
    JSON.stringify(receipt, null, 2),
    { flag: "wx" },
  );

  return {
    ...receipt,
    manifest,
    sourceVitestVersion: manifest.sourceVitestVersion,
    sourceVitestConfigFile: manifest.sourceVitestConfigFile,
    sourceVitestConfigDifferences: manifest.sourceVitestConfigDifferencesFromCapsule ?? [],
    configPath,
  };
}

/** Sha256 of the exact manifest file bytes, exposed for callers who want to
 * independently compute the value to pass as --approved-manifest-sha256
 * before staging (e.g. `shasum -a 256 <manifest>`). */
export function readManifestDigest(manifestPath) {
  return sha256(readFileSync(manifestPath));
}

/** Confirms `receipt` is the genuine record stageCapsule wrote for this
 * exact capsule: its capsuleRoot must sit under the canonical parent, and
 * the binding fields must match the stage-receipt.json found there. A
 * caller cannot hand executeCapsule an arbitrary root/manifest combination
 * unrelated to something stageCapsule actually produced. */
function assertOwnedStageReceipt(receipt, repoRoot) {
  if (!receipt || typeof receipt !== "object" || typeof receipt.capsuleRoot !== "string") {
    throw new CapsuleRefusal(
      "executeCapsule requires the stage receipt object returned by stageCapsule.",
    );
  }
  const canonicalParent = resolveCanonicalCapsuleParent(repoRoot);
  const resolvedCapsuleRoot = path.resolve(receipt.capsuleRoot);
  if (resolvedCapsuleRoot === canonicalParent || !isSameOrNested(canonicalParent, resolvedCapsuleRoot)) {
    throw new CapsuleRefusal(
      `Stage receipt's capsuleRoot is not a canonical staged capsule: ${receipt.capsuleRoot}`,
    );
  }
  const receiptPath = path.join(resolvedCapsuleRoot, STAGE_RECEIPT_NAME);
  let onDisk;
  try {
    onDisk = JSON.parse(readFileSync(receiptPath, "utf8"));
  } catch (error) {
    throw new CapsuleRefusal(
      `Cannot read the owned stage receipt for this capsule: ${error.message}`,
    );
  }
  for (const field of ["capsuleId", "sourceRevision", "manifestSha256", "entryTestFile", "capsuleRoot", "staged", "license", "expectedTestCounts", "rendererRuntime"]) {
    if (JSON.stringify(onDisk[field]) !== JSON.stringify(receipt[field])) {
      throw new CapsuleRefusal(
        `Stage receipt field "${field}" does not match the on-disk record for this capsule.`,
      );
    }
  }
  return resolvedCapsuleRoot;
}

/** Runs `node scriptPath ...args`, bounded by timeoutMs via spawnSync's own
 * single-child timeout. On expiry this signals only that one child process
 * -- it does not kill a process tree, and a child that ignores/traps the
 * signal or detaches its own descendants can still survive past the bound.
 * Never claim this bounds an uncooperative child universally. */
export function spawnNodeScript({ nodeBin, scriptPath, args, cwd, timeoutMs, env }) {
  return spawnSync(nodeBin, [scriptPath, ...args], {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    env: env ?? process.env,
  });
}

/**
 * Runs a staged capsule's entry test file via `nodeBin vitestEntry ...`,
 * never through the apps/desktop/node_modules/.bin/vitest shell shim.
 * Takes the stage receipt stageCapsule returned (not a bare root/manifest
 * path pair), so execution is structurally tied to what was actually
 * staged: the receipt is cross-checked against the on-disk
 * stage-receipt.json, the approval digest is compared to the manifest
 * digest captured at stage time (not reread from the manifest file now),
 * every staged file's bytes are re-verified, and an existing results file
 * refuses rather than being silently overwritten.
 */
export function executeCapsule({
  receipt,
  approvedManifestSha256,
  nodeBin,
  vitestEntry,
  timeoutMs,
  repoRoot = REPO_ROOT,
}) {
  const resolvedRoot = assertOwnedStageReceipt(receipt, repoRoot);
  if (typeof approvedManifestSha256 !== "string" || !/^[0-9a-f]{64}$/.test(approvedManifestSha256)) {
    throw new CapsuleRefusal(
      "Execution requires approvedManifestSha256: the sha256 of the exact manifest bytes staged.",
    );
  }
  if (receipt.manifestSha256 !== approvedManifestSha256) {
    throw new CapsuleRefusal(
      `Execution approval digest mismatch: staged manifest hashes to ${receipt.manifestSha256}, caller approved ${approvedManifestSha256}.`,
    );
  }
  if (!existsSync(nodeBin)) {
    throw new CapsuleRefusal(`node binary not found at ${nodeBin}.`);
  }
  if (!existsSync(vitestEntry)) {
    throw new CapsuleRefusal(
      `vitest entry not found at ${vitestEntry}. This runner reuses the ` +
        "already-installed apps/desktop vitest module and never installs one.",
    );
  }

  // Validate staged inputs/config are still exactly what was recorded,
  // before spawning anything.
  for (const file of [...receipt.staged, receipt.license]) {
    if (!existsSync(file.target)) {
      throw new CapsuleRefusal(`Staged file missing before execution: ${file.target}`);
    }
    const currentDigest = sha256(readFileSync(file.target));
    if (currentDigest !== file.sha256) {
      throw new CapsuleRefusal(`Staged file changed since staging: ${file.target}`);
    }
  }
  const configPath = path.join(resolvedRoot, "vitest.config.mjs");
  assertNoSymlinkInPath(resolvedRoot, "vitest.config.mjs");
  if (readFileSync(configPath, "utf8") !== generatedVitestConfig(receipt.entryTestFile, receipt.rendererRuntime)) {
    throw new CapsuleRefusal(`Generated vitest config changed since staging: ${configPath}`);
  }

  verifyRendererRuntime(receipt.rendererRuntime, resolvedRoot);

  const resultsPath = path.join(resolvedRoot, "vitest-results.json");
  if (lstatSync(resultsPath, { throwIfNoEntry: false })) {
    throw new CapsuleRefusal(
      `Refusing to reuse an existing results path (would overwrite prior evidence): ${resultsPath}`,
    );
  }

  const versionResult = spawnNodeScript({
    nodeBin,
    scriptPath: vitestEntry,
    args: ["--version"],
    cwd: resolvedRoot,
    timeoutMs,
  });
  const vitestVersion = (versionResult.stdout || "").trim();

  const runResult = spawnNodeScript({
    nodeBin,
    scriptPath: vitestEntry,
    args: [
      "run",
      receipt.entryTestFile,
      "--root",
      resolvedRoot,
      "--config",
      configPath,
      "--reporter=json",
      `--outputFile=${resultsPath}`,
    ],
    cwd: resolvedRoot,
    timeoutMs,
  });

  if (runResult.error) {
    throw new CapsuleRefusal(`Failed to launch vitest: ${runResult.error.message}`);
  }
  if (runResult.signal) {
    return { vitestVersion, timedOut: true, signal: runResult.signal, exitCode: null, results: null };
  }
  let results = null;
  if (existsSync(resultsPath)) {
    try {
      results = JSON.parse(readFileSync(resultsPath, "utf8"));
    } catch {
      results = null;
    }
  }
  return { vitestVersion, timedOut: false, signal: null, exitCode: runResult.status, results };
}

function isFiniteNonNegativeInt(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function summarizeResults(results) {
  if (!results) return null;
  return {
    numTotalTests: results.numTotalTests,
    numPassedTests: results.numPassedTests,
    numFailedTests: results.numFailedTests,
    numPendingTests: results.numPendingTests,
    numTodoTests: results.numTodoTests,
    numFailedTestSuites: results.numFailedTestSuites,
    success: results.success,
  };
}

/**
 * Turns a raw execution result into { ok, problems, counts }. Rejects: a
 * timeout or non-zero exit; a missing/unparseable results file; any of the
 * core count fields not being a finite non-negative integer; counts that
 * don't sum coherently to numTotalTests; any failed test or failed suite;
 * a reported success !== true; any pending/todo (skipped) test, unless the
 * caller passes allowPendingTests: true for a capsule with an explicit,
 * predeclared reviewed policy for that (this pilot has none, so the
 * default -- reject -- applies); and a mismatch against expectedTestCounts,
 * checked against both total and passed counts.
 */
export function evaluateExecution(execution, expectedTestCounts, { allowPendingTests = false } = {}) {
  const problems = [];
  if (execution.timedOut) {
    problems.push(`timed out (signal ${execution.signal})`);
    return { ok: false, problems, counts: null };
  }
  if (execution.exitCode !== 0) {
    problems.push(`vitest exited with status ${execution.exitCode}`);
  }
  if (!execution.results) {
    problems.push("no parseable vitest JSON results file was produced");
    return { ok: false, problems, counts: null };
  }
  const counts = summarizeResults(execution.results);
  const requiredFields = ["numTotalTests", "numPassedTests", "numFailedTests", "numPendingTests"];
  for (const field of requiredFields) {
    if (!isFiniteNonNegativeInt(counts[field])) {
      problems.push(`results.${field} is not a finite non-negative integer: ${JSON.stringify(counts[field])}`);
    }
  }
  if (problems.length === 0 || problems.every((p) => p.startsWith("vitest exited"))) {
    const todo = isFiniteNonNegativeInt(counts.numTodoTests) ? counts.numTodoTests : 0;
    const sum = counts.numPassedTests + counts.numFailedTests + counts.numPendingTests + todo;
    if (sum !== counts.numTotalTests) {
      problems.push(
        `test counts are not internally coherent: passed(${counts.numPassedTests}) + failed(${counts.numFailedTests}) + pending(${counts.numPendingTests}) + todo(${todo}) = ${sum}, but numTotalTests = ${counts.numTotalTests}`,
      );
    }
    if (counts.numTotalTests === 0) {
      problems.push("zero tests were reported");
    }
    if (counts.numFailedTests > 0) {
      problems.push(`${counts.numFailedTests} test(s) failed`);
    }
    if (typeof counts.numFailedTestSuites === "number" && counts.numFailedTestSuites > 0) {
      problems.push(`${counts.numFailedTestSuites} test suite(s) failed`);
    }
    if (!allowPendingTests && (counts.numPendingTests > 0 || todo > 0)) {
      problems.push(
        `${counts.numPendingTests} pending/skipped and ${todo} todo test(s) reported; no reviewed policy allows skipped/todo tests for this capsule`,
      );
    }
    if (counts.success !== true) {
      problems.push(`vitest reported success=${JSON.stringify(counts.success)}, expected true`);
    }
    if (expectedTestCounts && typeof expectedTestCounts.tests === "number") {
      if (counts.numTotalTests !== expectedTestCounts.tests) {
        problems.push(`expected ${expectedTestCounts.tests} total test(s), got ${counts.numTotalTests}`);
      }
      if (counts.numPassedTests !== expectedTestCounts.tests) {
        problems.push(`expected all ${expectedTestCounts.tests} test(s) to pass, only ${counts.numPassedTests} passed`);
      }
    }
  }
  return { ok: problems.length === 0, problems, counts };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const stageOutcome = stageCapsule({
    manifestPath: args.manifest,
    sourceRoot: args.sourceRoot,
    label: args.label,
  });

  const report = {
    disclaimer:
      "PILOT EVIDENCE ONLY. This is not a full-suite or full feature-parity " +
      "result. It validates a single, pinned test capsule in " +
      "isolation and does not establish that the source project's full test " +
      "suite passes, nor that this feature is at parity in the rewrite. " +
      "Execution approval below is a caller-supplied digest binding, not " +
      "independent proof that a human reviewed the manifest.",
    capsuleId: stageOutcome.capsuleId,
    sourceRevision: stageOutcome.sourceRevision,
    capsuleRoot: stageOutcome.capsuleRoot,
    stage: { ok: true, stagedFiles: stageOutcome.staged, license: stageOutcome.license },
    sourceVitestVersion: stageOutcome.sourceVitestVersion,
    sourceVitestConfigFile: stageOutcome.sourceVitestConfigFile,
    sourceVitestConfigDifferences: stageOutcome.sourceVitestConfigDifferences,
    execution: null,
  };

  if (args.execute) {
    const execution = executeCapsule({
      receipt: stageOutcome,
      approvedManifestSha256: args.approvedManifestSha256,
      nodeBin: args.nodeBin,
      vitestEntry: args.vitestEntry,
      timeoutMs: args.timeoutMs,
    });
    const evaluation = evaluateExecution(execution, stageOutcome.expectedTestCounts);
    report.execution = {
      mode: "execute",
      ok: evaluation.ok,
      problems: evaluation.problems,
      approvedManifestSha256: args.approvedManifestSha256,
      nodeBin: args.nodeBin,
      vitestEntry: args.vitestEntry,
      installedVitestVersion: execution.vitestVersion,
      timedOut: execution.timedOut,
      exitCode: execution.exitCode,
      signal: execution.signal,
      testCounts: evaluation.counts,
      expectedTestCounts: stageOutcome.expectedTestCounts,
    };
    if (!evaluation.ok) {
      process.exitCode = 1;
    }
  } else {
    report.execution = {
      mode: "stage-only",
      ok: true,
      note: "Staged only. Pass --execute plus --approved-manifest-sha256 to run.",
    };
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  main().catch((error) => {
    if (error instanceof CapsuleRefusal) {
      process.stderr.write(`Capsule refused: ${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    process.stderr.write(`Unexpected error: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

export {
  CapsuleRefusal,
  assertSafeRelativePath,
  assertSafeSingleComponentId,
  assertNoSymlinkInPath,
  assertNoOverlap,
  loadManifest,
  sha256,
  VITEST_ENTRY,
};
