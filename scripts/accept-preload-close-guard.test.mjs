// Unit tests for the preload close-guard acceptance runner. Every test uses
// owned fixtures or injected dependencies; none of them spawn Electron, a
// browser, or any child process.

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  AcceptanceArgumentError,
  acceptanceLayout,
  asIife,
  BASE_MODULE_REVISION,
  buildCliSummary,
  buildLaunchEnv,
  buildPlan,
  classifyCloseGuardDescriptor,
  classifySecurityPosture,
  closeGuardProbeScript,
  composeOverallStatus,
  deriveCleanupVerdict,
  finalizeExecuteReport,
  main,
  parseCliArgs,
  postureProbeScript,
  resolveGitMetadata,
  STAGE_TIMEOUT_MS,
  UNSAFE_ENV_KEYS,
} from "./accept-preload-close-guard.mjs";

test("importing the runner is effect-free and declares no CLI side state", async () => {
  // The import at the top of this file already happened; assert the runner
  // exposed no mutable CLI-run state and that the plan builder stays pure.
  const plan = buildPlan();
  assert.equal(plan.baseModuleRevision, BASE_MODULE_REVISION);
  assert.equal(plan.baseModuleRevision, "bb85b83");
  assert.match(plan.revisionSemantics, /base module revision/);
  assert.match(plan.revisionSemantics, /candidateHeadRevision/);
  assert.match(plan.revisionSemantics, /SHA256 digests/);
  assert.equal(plan.modes.help, "this plan; read-only and spawn-free");
  assert.equal(
    plan.modes.execute,
    "launch the actual product with CDP and probe the live guard; the only mode that writes or spawns",
  );
});

test("argument parsing accepts exactly the documented modes", () => {
  assert.deepEqual(parseCliArgs([]), { mode: "help" });
  assert.deepEqual(parseCliArgs(["--help"]), { mode: "help" });
  assert.deepEqual(parseCliArgs(["--check"]), { mode: "check" });
  assert.deepEqual(parseCliArgs(["--execute"]), { mode: "execute" });
});

test("--help combined with any other flag is rejected in either order", () => {
  for (const argv of [
    ["--help", "--check"],
    ["--check", "--help"],
    ["--help", "--execute"],
    ["--execute", "--help"],
  ]) {
    assert.throws(
      () => parseCliArgs(argv),
      (error) =>
        error instanceof AcceptanceArgumentError &&
        error.failureClass === "argument-error" &&
        /--help must be used alone/.test(error.message),
      `expected --help-alone rejection for ${JSON.stringify(argv)}`,
    );
  }
});

test("argument parsing rejects unknown, duplicate, conflicting, and positional flags", () => {
  for (const argv of [
    ["--verify"],
    ["execute"],
    ["--check", "extra"],
    ["--check", "--check"],
    ["--execute", "--execute"],
    ["--check", "--execute"],
    ["--execute", "--check"],
  ]) {
    assert.throws(
      () => parseCliArgs(argv),
      (error) =>
        error instanceof AcceptanceArgumentError &&
        error.failureClass === "argument-error",
      `expected rejection for ${JSON.stringify(argv)}`,
    );
  }
});

test("launch environment clears unsafe and inherited app overrides", () => {
  const fixture = {
    dataDir: "/fixture/data",
    profileDir: "/fixture/profile",
  };
  const env = buildLaunchEnv(
    {
      PATH: "/usr/bin:/bin",
      SHELL: "/bin/zsh",
      ELECTRON_RUN_AS_NODE: "1",
      NODE_OPTIONS: "--require /tmp/pwn.js",
      ELECTRON_RENDERER_URL: "http://127.0.0.1:5173",
      DROGON_DATA_DIR: "/real/user/data",
      DROGON_ELECTRON_PROFILE: "/real/user/profile",
      DROGON_DAEMON_URL: "http://169.254.1.1:9/override",
    },
    fixture,
  );
  assert.equal(env.DROGON_DATA_DIR, "/fixture/data");
  assert.equal(env.DROGON_ELECTRON_PROFILE, "/fixture/profile");
  assert.equal(env.PATH, "/usr/bin:/bin");
  assert.equal(env.SHELL, "/bin/sh");
  for (const key of UNSAFE_ENV_KEYS) {
    assert.equal(key in env, false, `${key} must be cleared`);
  }
  assert.equal("DROGON_DAEMON_URL" in env, false);
});

test("close guard probe script never invokes window.close", () => {
  assert.equal(/window\.close\s*\(/.test(closeGuardProbeScript), false);
  assert.equal(/getOwnPropertyDescriptor\(window, "close"\)/.test(closeGuardProbeScript), true);
  assert.equal(/getOwnPropertyDescriptor\(\s*Object\.getPrototypeOf\(window\),\s*"close"/.test(closeGuardProbeScript), true);
});

test("posture probe only reads typeofs and never executes privileged code", () => {
  assert.equal(/require\s*\(/.test(postureProbeScript.replace(/typeof window\[name\]/g, "")), false);
  assert.equal(/typeof window\["?require"?]|"require"/.test(postureProbeScript), true);
  assert.equal(/\bprocess\b\s*\./.test(postureProbeScript), false);
});

function ownDescriptor(overrides = {}) {
  return {
    typeofValue: "function",
    configurable: false,
    writable: false,
    enumerable: false,
    isNative: false,
    sourcePreview: "() => {}",
    ...overrides,
  };
}

test("descriptor classification expects the exact guard contract", () => {
  const good = classifyCloseGuardDescriptor({
    own: ownDescriptor(),
    prototype: { isNative: true },
    sameValueAsPrototype: false,
  });
  assert.equal(good.ok, true);
  assert.equal(good.failureClass, null);

  const absent = classifyCloseGuardDescriptor({ own: null, prototype: { isNative: true } });
  assert.equal(absent.ok, false);
  assert.equal(absent.failureClass, "guard-descriptor-absent");

  const missing = classifyCloseGuardDescriptor(null);
  assert.equal(missing.ok, false);
  assert.equal(missing.failureClass, "guard-descriptor-absent");

  const native = classifyCloseGuardDescriptor({
    own: ownDescriptor({ isNative: true }),
    prototype: { isNative: true },
    sameValueAsPrototype: false,
  });
  assert.equal(native.ok, false);
  assert.equal(native.failureClass, "guard-not-replaced-native");

  const sameAsPrototype = classifyCloseGuardDescriptor({
    own: ownDescriptor(),
    prototype: { isNative: true },
    sameValueAsPrototype: true,
  });
  assert.equal(sameAsPrototype.ok, false);
  assert.equal(sameAsPrototype.failureClass, "guard-not-replaced-native");

  const notAFunction = classifyCloseGuardDescriptor({
    own: ownDescriptor({ typeofValue: "number" }),
    prototype: null,
    sameValueAsPrototype: false,
  });
  assert.equal(notAFunction.ok, false);
  assert.equal(notAFunction.failureClass, "guard-not-a-function");

  const badFlags = classifyCloseGuardDescriptor({
    own: ownDescriptor({ configurable: true }),
    prototype: null,
    sameValueAsPrototype: false,
  });
  assert.equal(badFlags.ok, false);
  assert.equal(badFlags.failureClass, "guard-descriptor-flags");
  assert.match(badFlags.detail, /configurable=true/);
});

test("security posture classification accepts only isolated renderers", () => {
  const good = classifySecurityPosture({
    nodeGlobals: { require: "undefined", process: "undefined", module: "undefined", global: "undefined", Buffer: "undefined" },
    bridgeExposed: "object",
    bridgeStatusFunction: "function",
    electronUserAgent: "Mozilla/5.0 AppleWebKit/537.36 Electron/44.2.0 Safari/537.36",
  });
  assert.equal(good.ok, true);
  assert.equal(good.electronVersion, "44.2.0");

  const leaking = classifySecurityPosture({
    nodeGlobals: { require: "function", process: "undefined", module: "undefined", global: "undefined", Buffer: "undefined" },
    bridgeExposed: "object",
    bridgeStatusFunction: "function",
    electronUserAgent: "x",
  });
  assert.equal(leaking.ok, false);
  assert.equal(leaking.failureClass, "insecure-renderer-posture");

  const noBridge = classifySecurityPosture({
    nodeGlobals: { require: "undefined", process: "undefined", module: "undefined", global: "undefined", Buffer: "undefined" },
    bridgeExposed: "undefined",
    bridgeStatusFunction: "undefined",
    electronUserAgent: "x",
  });
  assert.equal(noBridge.ok, false);
  assert.equal(noBridge.failureClass, "context-isolation-bridge-absent");
});

test("probe strings are wrapped as self-invoking expressions for CDP evaluation", () => {
  for (const script of [postureProbeScript, closeGuardProbeScript]) {
    const wrapped = asIife(script);
    assert.match(wrapped, /^\(.+\)\(\)$/s);
    assert.equal(
      wrapped,
      `(${script})()`,
      "wrapping must not alter the probe source",
    );
  }
  // A function expression evaluates to a function; only the IIFE form makes
  // Playwright's string evaluation return the probe result itself.
  assert.notEqual(asIife(postureProbeScript), postureProbeScript);
});

test("git metadata resolver reads loose refs directly without any Git command", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "close-guard-gitmeta-"));
  context.after(() => import("node:fs/promises").then((fs) => fs.rm(root, { recursive: true, force: true })));
  const gitDir = path.join(root, ".git");
  await mkdir(gitDir, { recursive: true });
  await writeFile(path.join(gitDir, "HEAD"), "ref: refs/heads/codex/rewrite-foundation\n");
  await mkdir(path.join(gitDir, "refs", "heads", "codex"), { recursive: true });
  await writeFile(
    path.join(gitDir, "refs", "heads", "codex", "rewrite-foundation"),
    "81d3a34259e0e3d31701fd33344b2f9cd83f8854\n",
  );
  const meta = await resolveGitMetadata(root);
  assert.equal(meta.available, true);
  assert.equal(meta.headRef, "refs/heads/codex/rewrite-foundation");
  assert.equal(meta.candidateHeadRevision, "81d3a34259e0e3d31701fd33344b2f9cd83f8854");
  assert.match(meta.resolver, /no Git command executed/);
  assert.match(meta.workingTreeNote, /working-tree changes may exist/);
  assert.match(meta.workingTreeNote, /not asserted clean/);
});

test("git metadata resolver falls back to packed-refs", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "close-guard-gitmeta-"));
  context.after(() => import("node:fs/promises").then((fs) => fs.rm(root, { recursive: true, force: true })));
  const gitDir = path.join(root, ".git");
  await mkdir(gitDir, { recursive: true });
  await writeFile(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n");
  await writeFile(
    path.join(gitDir, "packed-refs"),
    "# pack-refs with: peeled fully-peeled sorted \n" +
      "1111111111111111111111111111111111111111 refs/heads/other\n" +
      "81d3a34259e0e3d31701fd33344b2f9cd83f8854 refs/heads/main\n",
  );
  const meta = await resolveGitMetadata(root);
  assert.equal(meta.available, true);
  assert.equal(meta.candidateHeadRevision, "81d3a34259e0e3d31701fd33344b2f9cd83f8854");
});

test("git metadata resolver handles detached HEAD and missing .git", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "close-guard-gitmeta-"));
  context.after(() => import("node:fs/promises").then((fs) => fs.rm(root, { recursive: true, force: true })));
  const gitDir = path.join(root, ".git");
  await mkdir(gitDir, { recursive: true });
  await writeFile(
    path.join(gitDir, "HEAD"),
    "81d3a34259e0e3d31701fd33344b2f9cd83f8854\n",
  );
  const detached = await resolveGitMetadata(root);
  assert.equal(detached.available, true);
  assert.equal(detached.headRef, null);
  assert.equal(detached.candidateHeadRevision, "81d3a34259e0e3d31701fd33344b2f9cd83f8854");

  const emptyRoot = await mkdtemp(path.join(tmpdir(), "close-guard-gitmeta-"));
  context.after(() => import("node:fs/promises").then((fs) => fs.rm(emptyRoot, { recursive: true, force: true })));
  const absent = await resolveGitMetadata(emptyRoot);
  assert.equal(absent.available, false);
  assert.equal(absent.candidateHeadRevision, null);
  assert.ok(absent.unavailableReason);
});

test("overall status composes behavior, evidence, and cleanup independently", () => {
  // GREEN with complete evidence and clean cleanup is the only success.
  assert.equal(
    composeOverallStatus({ behavioralVerdict: "GREEN", evidenceComplete: true, cleanupClean: true }),
    "SUCCESS",
  );
  // A behavioral RED stays independently recorded while the run fails overall.
  assert.equal(
    composeOverallStatus({ behavioralVerdict: "RED", evidenceComplete: true, cleanupClean: true }),
    "FAILED",
  );
  // Incomplete evidence or unverifiable cleanup can never produce success.
  assert.equal(
    composeOverallStatus({ behavioralVerdict: "GREEN", evidenceComplete: false, cleanupClean: true }),
    "FAILED",
  );
  assert.equal(
    composeOverallStatus({ behavioralVerdict: "GREEN", evidenceComplete: true, cleanupClean: false }),
    "FAILED",
  );
  assert.equal(
    composeOverallStatus({ behavioralVerdict: "NOT_OBSERVED", evidenceComplete: true, cleanupClean: true }),
    "FAILED",
  );
});

test("cleanup verdict treats any unverifiable or forced stop as unclean", () => {
  assert.equal(
    deriveCleanupVerdict([
      "product electron instance: owned by this run",
      "cdp browser session: closed",
      "product electron instance: exited",
    ]),
    "clean",
  );
  assert.equal(
    deriveCleanupVerdict(["product electron instance: exited", "cdp browser session: unverifiable"]),
    "unverifiable",
  );
  assert.equal(
    deriveCleanupVerdict(["daemon: required force after timeout", "daemon: unverifiable"]),
    "unverifiable",
  );
  assert.equal(deriveCleanupVerdict([]), "clean");
  assert.equal(deriveCleanupVerdict(undefined), "clean");
});

test("finalization composes verdicts before the persisted write, and stored JSON equals the result and summary", async (context) => {
  const fixture = await mkdtemp(path.join(tmpdir(), "close-guard-finalize-"));
  context.after(() => rm(fixture, { recursive: true, force: true }));
  const artifacts = path.join(fixture, "artifacts");
  await mkdir(artifacts, { recursive: true });
  const before = path.join(artifacts, "before.png");
  const after = path.join(artifacts, "after.png");
  await writeFile(before, "png-bytes-before");
  await writeFile(after, "png-bytes-after");
  const report = {
    kind: "preload-close-guard-acceptance",
    baseModuleRevision: BASE_MODULE_REVISION,
    behavioralVerdict: "RED",
    failureClass: "guard-not-replaced-native",
    checks: ["behavioral-red-descriptor-mismatch"],
    assertions: {},
    cleanup: ["product electron instance: exited", "cdp browser session: closed"],
    screenshots: { before, after },
    startedAt: new Date().toISOString(),
  };
  const evidenceDir = path.join(fixture, "evidence");
  const final = await finalizeExecuteReport(report, { evidenceDir });
  // All verdicts composed: RED preserved independently, evidence complete,
  // cleanup clean, overall FAILED because the behavior itself failed.
  assert.equal(final.behavioralVerdict, "RED");
  assert.equal(final.cleanupVerdict, "clean");
  assert.equal(final.evidenceVerdict.complete, true);
  assert.equal(final.status, "FAILED");
  // The persisted report carries exactly the finalized verdict fields.
  const persisted = JSON.parse(
    await readFile(path.join(final.evidencePath, "report.json"), "utf8"),
  );
  assert.equal(persisted.status, final.status);
  assert.equal(persisted.behavioralVerdict, final.behavioralVerdict);
  assert.equal(persisted.cleanupVerdict, final.cleanupVerdict);
  assert.deepEqual(persisted.evidenceVerdict, final.evidenceVerdict);
  // Screenshot paths in the persisted report are the self-contained copies.
  assert.equal(persisted.screenshots.before, path.join(final.evidencePath, "before.png"));
  assert.equal(persisted.screenshots.after, path.join(final.evidencePath, "after.png"));
  for (const file of Object.values(persisted.screenshots)) {
    const info = await stat(file);
    assert.ok(info.size > 0);
  }
  // The CLI summary is the same semantics as the persisted JSON.
  const summary = buildCliSummary(final);
  assert.equal(summary.status, persisted.status);
  assert.equal(summary.behavioralVerdict, persisted.behavioralVerdict);
  assert.equal(summary.cleanupVerdict, persisted.cleanupVerdict);
  assert.deepEqual(summary.evidenceVerdict, persisted.evidenceVerdict);
});

test("a GREEN behavioral verdict with missing evidence can never finalize as success", async (context) => {
  const fixture = await mkdtemp(path.join(tmpdir(), "close-guard-green-"));
  context.after(() => rm(fixture, { recursive: true, force: true }));
  const report = {
    kind: "preload-close-guard-acceptance",
    behavioralVerdict: "GREEN",
    failureClass: null,
    checks: ["guarded-close-is-noop-and-irreversible"],
    cleanup: ["product electron instance: exited"],
    screenshots: {},
    startedAt: new Date().toISOString(),
  };
  const final = await finalizeExecuteReport(report, {
    evidenceDir: path.join(fixture, "evidence"),
  });
  assert.equal(final.behavioralVerdict, "GREEN");
  assert.equal(final.evidenceVerdict.complete, false);
  assert.equal(final.status, "FAILED");
  const persisted = JSON.parse(
    await readFile(path.join(final.evidencePath, "report.json"), "utf8"),
  );
  assert.equal(persisted.status, "FAILED");
  assert.equal(persisted.behavioralVerdict, "GREEN");
});

test("missing build artifacts fail the actual CLI seam nonzero without any process launch", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "close-guard-missing-build-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    // The real main and real runExecute run against an owned empty layout:
    // the built main entry is missing, so execution must stop before any
    // spawn, report NOT_OBSERVED behavior, and exit nonzero.
    const result = await main(["--execute"], { layout: acceptanceLayout(root) });
    assert.equal(result.status, "FAILED");
    assert.equal(result.behavioralVerdict, "NOT_OBSERVED");
    assert.equal(result.failureClass, "missing-build-artifact");
    assert.equal(result.cleanupVerdict, "clean");
    assert.match(result.note, /no process was spawned and no fixture was created/);
    assert.equal(process.exitCode, 1);
    // Nothing was created under the fixture parent: no fixture, no artifacts,
    // and therefore no Electron launch could have occurred.
    const fixtureParent = await stat(
      path.join(root, ".preflight", "acceptance"),
    ).catch(() => null);
    assert.equal(fixtureParent, null);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test("stage timeouts are bounded to the thirty second cap", () => {
  assert.equal(STAGE_TIMEOUT_MS, 30_000);
});
