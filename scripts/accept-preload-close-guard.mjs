// Genuine Electron + Playwright CDP acceptance harness for the production
// desktop main-world window.close guard boundary.
//
// Modes:
//   (no args)   print the acceptance plan (read-only, spawn-free)
//   --check     validate built entries and dependencies (read-only, spawn-free)
//   --execute   launch the actual product with CDP and probe the live guard
//
// Only --execute writes files or spawns processes. Importing this module is
// effect-free: no filesystem writes, no child processes, no Electron.

import assert from "node:assert/strict";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { startAcceptanceProcess } from "./acceptance-process.mjs";

/** The supplied base module revision these acceptance modules were written
 *  against; it is NOT the repository candidate revision. The candidate
 *  identity comes from resolveGitMetadata() plus the built-artifact digests. */
export const BASE_MODULE_REVISION = "bb85b83";
export const STAGE_TIMEOUT_MS = 30_000;
export const CLI_MODES = ["help", "check", "execute"];

/** Environment entries that must never leak from the parent into the product. */
export const UNSAFE_ENV_KEYS = [
  "ELECTRON_RUN_AS_NODE",
  "ELECTRON_NO_ASAR",
  "ELECTRON_EXTRA_LAUNCH_ARGS",
  "ELECTRON_RENDERER_URL",
  "NODE_OPTIONS",
  "NODE_PATH",
];

export class AcceptanceArgumentError extends Error {
  constructor(message) {
    super(message);
    this.name = "AcceptanceArgumentError";
    this.failureClass = "argument-error";
  }
}

/** Strict CLI parsing: unknown, duplicate, conflicting, and positional flags
 *  are rejected before any write or spawn can happen. */
export function parseCliArgs(argv) {
  const allowed = new Set(["--help", "--check", "--execute"]);
  const seen = new Set();
  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      throw new AcceptanceArgumentError(
        `positional argument is not accepted: ${JSON.stringify(arg)}`,
      );
    }
    if (!allowed.has(arg)) {
      throw new AcceptanceArgumentError(`unknown flag: ${arg}`);
    }
    if (seen.has(arg)) {
      throw new AcceptanceArgumentError(`duplicate flag: ${arg}`);
    }
    seen.add(arg);
  }
  if (seen.has("--help") && seen.size > 1) {
    throw new AcceptanceArgumentError(
      "conflicting flags: --help must be used alone",
    );
  }
  if (seen.has("--check") && seen.has("--execute")) {
    throw new AcceptanceArgumentError(
      "conflicting flags: --check and --execute are mutually exclusive",
    );
  }
  if (seen.has("--execute")) return { mode: "execute" };
  if (seen.has("--check")) return { mode: "check" };
  return { mode: "help" };
}

/** Read-only Git metadata resolver: reads .git/HEAD and its loose or packed
 *  ref directly as files. No Git command is ever executed. The reported HEAD
 *  is the committed tip only; working-tree changes may exist and are NOT
 *  asserted clean by this resolver. */
export async function resolveGitMetadata(root = repositoryRoot()) {
  const note =
    "candidateHeadRevision is the committed HEAD read directly from .git files (no Git command executed); working-tree changes may exist and are not asserted clean";
  try {
    const gitDir = path.join(root, ".git");
    const head = (await readFile(path.join(gitDir, "HEAD"), "utf8")).trim();
    const symbolic = head.match(/^ref: (.+)$/);
    if (!symbolic) {
      return {
        available: true,
        resolver: "direct .git file reads; no Git command executed",
        headRef: null,
        candidateHeadRevision: head,
        workingTreeNote: note,
      };
    }
    const headRef = symbolic[1];
    try {
      const loose = (await readFile(path.join(gitDir, headRef), "utf8")).trim();
      return {
        available: true,
        resolver: "direct .git file reads; no Git command executed",
        headRef,
        candidateHeadRevision: loose,
        workingTreeNote: note,
      };
    } catch {
      const packed = await readFile(path.join(gitDir, "packed-refs"), "utf8");
      for (const line of packed.split("\n")) {
        const entry = line.trim();
        if (!entry || entry.startsWith("#") || entry.startsWith("^")) continue;
        const [revision, ref] = entry.split(" ");
        if (ref === headRef) {
          return {
            available: true,
            resolver: "direct .git file reads; no Git command executed",
            headRef,
            candidateHeadRevision: revision,
            workingTreeNote: note,
          };
        }
      }
      throw new Error(`ref ${headRef} not found in loose refs or packed-refs`);
    }
  } catch (error) {
    return {
      available: false,
      resolver: "direct .git file reads; no Git command executed",
      headRef: null,
      candidateHeadRevision: null,
      workingTreeNote: note,
      unavailableReason: error.message,
    };
  }
}

/** Build the private product environment: inherited unsafe overrides and all
 *  inherited DROGON_* app overrides are dropped, then the nonce fixture paths
 *  are the only DROGON_* values the product can see. */
export function buildLaunchEnv(baseEnv, fixture) {
  const env = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (UNSAFE_ENV_KEYS.includes(key)) continue;
    if (key.startsWith("DROGON_")) continue;
    env[key] = value;
  }
  env.DROGON_DATA_DIR = fixture.dataDir;
  env.DROGON_ELECTRON_PROFILE = fixture.profileDir;
  env.DROGON_BACKGROUND_WINDOW = "1";
  if (process.platform !== "win32") env.SHELL = "/bin/sh";
  return env;
}

function summarizeDescriptor(descriptor) {
  if (!descriptor) return null;
  const source =
    typeof descriptor.value === "function" ? String(descriptor.value) : null;
  return {
    hasValue: "value" in descriptor,
    typeofValue: typeof descriptor.value,
    configurable: descriptor.configurable,
    writable: descriptor.writable,
    enumerable: descriptor.enumerable,
    get: descriptor.get ? String(descriptor.get) : null,
    set: descriptor.set ? String(descriptor.set) : null,
    isNative: source ? source.includes("[native code]") : false,
    sourcePreview: source ? source.slice(0, 300) : null,
  };
}

/** Main-world probe source. Inspects descriptors only; it never calls
 *  window.close and never executes anything privileged. */
export const closeGuardProbeScript = `() => {
  const own = Object.getOwnPropertyDescriptor(window, "close");
  const proto = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(window),
    "close",
  );
  const summarize = (descriptor) => {
    if (!descriptor) return null;
    const source =
      typeof descriptor.value === "function" ? String(descriptor.value) : null;
    return {
      typeofValue: typeof descriptor.value,
      configurable: descriptor.configurable,
      writable: descriptor.writable,
      enumerable: descriptor.enumerable,
      isNative: source ? source.includes("[native code]") : false,
      sourcePreview: source ? source.slice(0, 300) : null,
    };
  };
  return {
    own: summarize(own),
    prototype: summarize(proto),
    sameValueAsPrototype: Boolean(
      own && proto && own.value === proto.value,
    ),
  };
}`;

/** Pure classification of the live probe result into the typed verdict. The
 *  guard contract: window has an OWN close property that is a non-native
 *  no-op function, non-configurable, non-writable, non-enumerable. */
export function classifyCloseGuardDescriptor(probe) {
  if (!probe || !probe.own) {
    return {
      ok: false,
      failureClass: "guard-descriptor-absent",
      detail:
        "main-world window has no own 'close' property; the native close is inherited and the guard is not installed",
    };
  }
  const own = probe.own;
  if (own.isNative || probe.sameValueAsPrototype) {
    return {
      ok: false,
      failureClass: "guard-not-replaced-native",
      detail:
        "own window.close is the native close (or identical to the prototype close), so no guard replaced it",
    };
  }
  if (own.typeofValue !== "function") {
    return {
      ok: false,
      failureClass: "guard-not-a-function",
      detail: `own window.close is ${own.typeofValue}, not a function`,
    };
  }
  const flagProblems = [
    ["configurable", own.configurable, false],
    ["writable", own.writable, false],
    ["enumerable", own.enumerable, false],
  ].filter(([, actual, expected]) => actual !== expected);
  if (flagProblems.length > 0) {
    return {
      ok: false,
      failureClass: "guard-descriptor-flags",
      detail: `descriptor flag mismatch: ${flagProblems
        .map(([name, actual, expected]) => `${name}=${String(actual)} (expected ${String(expected)})`)
        .join(", ")}`,
      descriptor: own,
    };
  }
  return { ok: true, failureClass: null, descriptor: own };
}

/** Security-posture assertions evaluated in the live main world. Only safe
 *  typeof checks are used; nothing privileged is executed or exposed. */
export const postureProbeScript = `() => ({
  nodeGlobals: Object.fromEntries(
    ["require", "process", "module", "global", "Buffer"].map((name) => [
      name,
      typeof window[name],
    ]),
  ),
  bridgeExposed: typeof window.drogon,
  bridgeStatusFunction: typeof window.drogon?.status,
  electronUserAgent: navigator.userAgent,
})`;

export function classifySecurityPosture(posture) {
  const leaking = Object.entries(posture.nodeGlobals).filter(
    ([, kind]) => kind !== "undefined",
  );
  if (leaking.length > 0) {
    return {
      ok: false,
      failureClass: "insecure-renderer-posture",
      detail: `main world exposes privileged globals: ${leaking
        .map(([name]) => name)
        .join(", ")}`,
    };
  }
  if (posture.bridgeExposed !== "object" || posture.bridgeStatusFunction !== "function") {
    return {
      ok: false,
      failureClass: "context-isolation-bridge-absent",
      detail:
        "the isolated preload bridge (window.drogon) is not exposed, so contextIsolation behavior is not satisfied",
    };
  }
  const electronVersion =
    posture.electronUserAgent?.match(/Electron\/(\d+\.\d+\.\d+)/)?.[1] ?? null;
  return { ok: true, failureClass: null, electronVersion };
}

/** Playwright evaluates string arguments as expressions; wrap the probe
 *  source so the arrow function is actually invoked and returns its result. */
export function asIife(script) {
  return `(${script})()`;
}

function isMainModule() {
  return Boolean(process.argv[1]) &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

function repositoryRoot() {
  return fileURLToPath(new URL("..", import.meta.url));
}

export function acceptanceLayout(root = repositoryRoot()) {
  const appDir = path.join(root, "apps", "desktop");
  return {
    root,
    appDir,
    builtMain: path.join(appDir, "out", "main", "index.js"),
    builtPreload: path.join(appDir, "out", "preload", "index.js"),
    builtRendererIndex: path.join(appDir, "out", "renderer", "index.html"),
    evidenceDir: path.join(
      root,
      "tests",
      "parity",
      "ports",
      "WP-UI-PRELOAD",
      "electron-close-guard",
    ),
    fixtureParent: path.join(root, ".preflight", "acceptance"),
  };
}

async function sha256(file) {
  const { readFile } = await import("node:fs/promises");
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function assertReadable(file, label, problems) {
  try {
    const info = await stat(file);
    if (!info.isFile()) problems.push(`${label} is not a file: ${file}`);
    return info.size;
  } catch {
    problems.push(`${label} is missing: ${file}`);
    return null;
  }
}

async function resolvePlaywright() {
  const appRequire = createRequire(
    path.join(repositoryRoot(), "apps", "desktop", "package.json"),
  );
  return appRequire("playwright");
}

async function withStageTimeout(promise, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`stage exceeded ${STAGE_TIMEOUT_MS}ms: ${label}`)),
          STAGE_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Mode "help": the read-only plan. Writes nothing and spawns nothing. */
export function buildPlan() {
  const layout = acceptanceLayout();
  return {
    runner: "scripts/accept-preload-close-guard.mjs",
    baseModuleRevision: BASE_MODULE_REVISION,
    revisionSemantics: "bb85b83 is the base module revision; the repository candidate identity is resolveGitMetadata().candidateHeadRevision plus the built main/preload SHA256 digests (behavioral artifact identity)",
    modes: {
      help: "this plan; read-only and spawn-free",
      check: "validate built entries and dependencies; read-only and spawn-free",
      execute: "launch the actual product with CDP and probe the live guard; the only mode that writes or spawns",
    },
    builtEntries: {
      main: layout.builtMain,
      preload: layout.builtPreload,
      rendererIndex: layout.builtRendererIndex,
    },
    fixture: {
      policy: "mkdtemp nonce directory under .preflight/acceptance",
      parent: layout.fixtureParent,
    },
    evidence: {
      directory: layout.evidenceDir,
      files: ["report.json", "before.png", "after.png"],
    },
    boundaries: {
      stageTimeoutMs: STAGE_TIMEOUT_MS,
      remoteDebugging: "--remote-debugging-port=0 (loopback, random port)",
      closeCallPolicy:
        "window.close is only invoked after the descriptor proves the guard installed",
    },
  };
}

/** Mode "check": read-only validation. Writes nothing and spawns nothing. */
export async function runCheck(layout = acceptanceLayout()) {
  const problems = [];
  const sizes = {
    builtMain: await assertReadable(layout.builtMain, "built main entry", problems),
    builtPreload: await assertReadable(
      layout.builtPreload,
      "built preload entry",
      problems,
    ),
    builtRendererIndex: await assertReadable(
      layout.builtRendererIndex,
      "built renderer index",
      problems,
    ),
  };
  const electronBinary = createRequire(
    path.join(layout.appDir, "package.json"),
  )("electron");
  await assertReadable(electronBinary, "electron binary", problems);
  let playwrightVersion = null;
  try {
    playwrightVersion = createRequire(
      path.join(layout.appDir, "package.json"),
    )("playwright/package.json").version;
  } catch (error) {
    problems.push(`playwright is not resolvable: ${error.message}`);
  }
  const builtMainSha256 =
    sizes.builtMain === null ? null : await sha256(layout.builtMain);
  const builtPreloadSha256 =
    sizes.builtPreload === null ? null : await sha256(layout.builtPreload);
  return {
    mode: "check",
    ok: problems.length === 0,
    problems,
    builtEntries: sizes,
    baseModuleRevision: BASE_MODULE_REVISION,
    gitMetadata: await resolveGitMetadata(layout.root),
    behavioralArtifactIdentity: {
      note: "the built main/preload digests identify the artifacts whose live behavior was probed",
      builtMainSha256,
      builtPreloadSha256,
    },
    electronBinary,
    playwrightVersion,
    nodeVersion: process.version,
    nodePath: process.execPath,
  };
}

async function stopOwned(child, label, report) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) {
    report.cleanup.push(`${label}: ${child?.pid ? "exited" : "never-started"}`);
    return;
  }
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  if (
    !(await Promise.race([
      exited.then(() => true),
      delay(5000).then(() => false),
    ]))
  ) {
    child.kill("SIGKILL");
    await Promise.race([exited, delay(2000)]);
    report.cleanup.push(`${label}: required force after timeout`);
  }
  report.cleanup.push(
    `${label}: ${
      child.exitCode !== null || child.signalCode !== null ? "exited" : "unverifiable"
    }`,
  );
}

/** Overall status composition: the behavioral verdict stays independent, and
 *  overall success additionally requires complete evidence and clean cleanup.
 *  A descriptor-mismatch RED therefore remains RED even when the overall run
 *  fails, and incomplete evidence or unverifiable cleanup can never produce
 *  overall success. */
export function composeOverallStatus({
  behavioralVerdict,
  evidenceComplete,
  cleanupClean,
}) {
  return behavioralVerdict === "GREEN" && evidenceComplete && cleanupClean
    ? "SUCCESS"
    : "FAILED";
}

/** Derive the cleanup verdict from the recorded cleanup log; any force kill or
 *  unverifiable liveness makes the whole cleanup unverifiable. */
export function deriveCleanupVerdict(cleanupLog) {
  const unclean = (cleanupLog ?? []).some(
    (entry) => entry.includes("unverifiable") || entry.includes("required force"),
  );
  return unclean ? "unverifiable" : "clean";
}

/** Mode "execute": the only mode that writes or spawns. The layout is
 *  injectable so the actual execution seam can be exercised against owned
 *  fixtures; the default is the real repository layout. */
export async function runExecute(layout = acceptanceLayout()) {
  const problems = [];
  for (const [label, file] of [
    ["built main entry", layout.builtMain],
    ["built preload entry", layout.builtPreload],
    ["built renderer index", layout.builtRendererIndex],
  ]) {
    await assertReadable(file, label, problems);
  }
  if (problems.length > 0) {
    return {
      mode: "execute",
      status: "FAILED",
      behavioralVerdict: "NOT_OBSERVED",
      evidenceVerdict: {
        verdict: "incomplete",
        complete: false,
        missing: ["acceptance never ran: build artifacts missing"],
      },
      cleanupVerdict: "clean",
      failureClass: "missing-build-artifact",
      error: problems.join("; "),
      note: "no process was spawned and no fixture was created",
    };
  }
  const electronBinary = createRequire(
    path.join(layout.appDir, "package.json"),
  )("electron");

  const report = {
    kind: "preload-close-guard-acceptance",
    baseModuleRevision: BASE_MODULE_REVISION,
    gitMetadata: await resolveGitMetadata(layout.root),
    behavioralArtifactIdentity: {
      note: "the built main/preload digests identify the artifacts whose live behavior was probed",
      builtPreloadSha256: await sha256(layout.builtPreload),
      builtMainSha256: await sha256(layout.builtMain),
    },
    // Verdict separation: behavior, evidence, and cleanup are independent, and
    // overall status is composed from all three (SUCCESS only when the
    // behavioral verdict is GREEN AND evidence is complete AND cleanup is
    // clean). NOT_OBSERVED means no behavioral probe reached the product.
    behavioralVerdict: "NOT_OBSERVED",
    evidenceVerdict: {
      verdict: "incomplete",
      complete: false,
      missing: ["acceptance did not reach the evidence stage"],
    },
    cleanupVerdict: "unverifiable",
    status: "FAILED",
    failureClass: null,
    checks: [],
    assertions: {},
    cleanup: [],
    stages: {},
    startedAt: new Date().toISOString(),
    electronBinary,
    nodeVersion: process.version,
    nodePath: process.execPath,
  };

  let electron, browser, page;
  let endpoint = null;
  try {
    // Nonce fixture: everything the product writes stays inside it.
    await mkdir(layout.fixtureParent, { recursive: true });
    const fixtureRoot = await mkdtemp(
      path.join(layout.fixtureParent, "preload-close-guard-"),
    );
    const fixture = {
      root: fixtureRoot,
      dataDir: path.join(fixtureRoot, "data"),
      profileDir: path.join(fixtureRoot, "electron-profile"),
      artifactsDir: path.join(fixtureRoot, "artifacts"),
    };
    report.fixture = fixture.root;
    report.evidenceDir = layout.evidenceDir;
    await mkdir(fixture.dataDir, { recursive: true });
    await mkdir(fixture.profileDir, { recursive: true });
    await mkdir(fixture.artifactsDir, { recursive: true });
    report.checks.push("nonce-fixture-created-under-preflight-acceptance");

    const launchEnv = buildLaunchEnv(process.env, fixture);
    report.launch = {
      argv: [layout.appDir, "--remote-debugging-port=0"],
      shell: false,
      clearedUnsafeEnvKeys: UNSAFE_ENV_KEYS,
      clearedInheritedDrogonKeys: Object.keys(process.env).filter(
        (key) => key.startsWith("DROGON_") &&
          key !== "DROGON_DATA_DIR" &&
          key !== "DROGON_ELECTRON_PROFILE" &&
          key !== "DROGON_BACKGROUND_WINDOW",
      ),
    };

    // Stage: launch the actual product and wait (<=30s) for the CDP endpoint.
    electron = startAcceptanceProcess(
      electronBinary,
      [layout.appDir, "--remote-debugging-port=0"],
      {
        stdio: ["ignore", "ignore", "pipe"],
        env: launchEnv,
      },
    );
    report.cleanup.push("product electron instance: owned by this run");
    let stderrTail = "";
    const endpointPromise = new Promise((resolveEndpoint, rejectEndpoint) => {
      const timeout = setTimeout(
        () =>
          rejectEndpoint(
            Object.assign(
              new Error(`Electron did not publish a debugging endpoint: ${stderrTail}`),
              { failureClass: "endpoint-timeout" },
            ),
          ),
        STAGE_TIMEOUT_MS,
      );
      electron.once("error", (error) => {
        clearTimeout(timeout);
        rejectEndpoint(error);
      });
      electron.once("exit", () => {
        clearTimeout(timeout);
        rejectEndpoint(
          Object.assign(
            new Error(`Electron exited before connection: ${stderrTail}`),
            { failureClass: "electron-exited-early" },
          ),
        );
      });
      electron.stderr.on("data", (bytes) => {
        stderrTail = (stderrTail + bytes.toString()).slice(-8192);
        const match = stderrTail.match(
          /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/,
        );
        if (match) {
          clearTimeout(timeout);
          resolveEndpoint(match[1]);
        }
      });
    });
    endpoint = await withStageTimeout(endpointPromise, "cdp endpoint");
    report.endpoint = endpoint;
    report.checks.push("actual-product-launched-with-loopback-cdp-endpoint");

    // Stage: connect Playwright over CDP and find the product page (<=30s).
    const { chromium } = await resolvePlaywright();
    browser = await withStageTimeout(chromium.connectOverCDP(endpoint), "cdp connect");
    page = await withStageTimeout(
      (async () => {
        for (let i = 0; i < 150; i += 1) {
          const candidate = browser
            .contexts()
            .flatMap((context) => context.pages())
            .find((item) => item.url().startsWith("file:"));
          if (candidate) return candidate;
          await delay(200);
        }
        throw Object.assign(
          new Error("the product never produced a file: renderer page"),
          { failureClass: "page-timeout" },
        );
      })(),
      "product page",
    );
    page.setDefaultTimeout(STAGE_TIMEOUT_MS);
    report.pageUrl = page.url();
    report.checks.push("connected-to-production-window-over-cdp");

    // Stage: security posture from actual behavior (safe typeof probes only).
    const postureResult = await withStageTimeout(
      page.evaluate(asIife(postureProbeScript)),
      "posture probe",
    );
    if (postureResult == null || typeof postureResult !== "object") {
      throw Object.assign(
        new Error("the posture probe returned no result from the main world"),
        { failureClass: "posture-probe-unavailable" },
      );
    }
    const posture = classifySecurityPosture(postureResult);
    report.assertions.securityPosture = posture;
    report.electronVersion = posture.electronVersion;
    assert.ok(
      posture.ok,
      `renderer security posture violated: ${posture.failureClass} (${posture.detail})`,
    );
    report.checks.push(
      "main-world-has-no-node-privileged-globals-and-bridged-preload-ran",
    );

    // Stage: safe "before" screenshot.
    const beforeShot = path.join(fixture.artifactsDir, "before.png");
    await withStageTimeout(
      page.screenshot({ path: beforeShot, animations: "disabled" }),
      "before screenshot",
    );
    report.screenshots = { before: beforeShot };

    // Stage: main-world close-guard descriptor probe. window.close is NOT
    // called here; descriptor evidence alone decides the verdict.
    const probe = await withStageTimeout(
      page.evaluate(asIife(closeGuardProbeScript)),
      "close guard probe",
    );
    if (probe == null || typeof probe !== "object") {
      throw Object.assign(
        new Error(
          "the close-guard probe returned no result from the main world",
        ),
        { failureClass: "close-guard-probe-unavailable" },
      );
    }
    report.assertions.closeGuardDescriptor = probe;
    const verdict = classifyCloseGuardDescriptor(probe);
    report.assertions.closeGuardVerdict = verdict;

    if (!verdict.ok) {
      // Genuine behavioral RED: the live product's own descriptor contradicts
      // the guard contract. Fail on the assertion, never on plumbing.
      report.behavioralVerdict = "RED";
      report.failureClass = verdict.failureClass;
      report.failureDetail = verdict.detail;
      report.checks.push("behavioral-red-descriptor-mismatch");
    } else {
      // GREEN path: the descriptor proved the guard, so calling it is safe.
      report.checks.push("guard-descriptor-satisfies-contract");
      await withStageTimeout(page.evaluate(() => window.close()), "guarded close call");
      const stillUsable = await withStageTimeout(
        page.evaluate(() => ({ alive: true, sum: 1 + 1, url: location.href })),
        "post-close liveness",
      );
      report.assertions.postClose = stillUsable;
      assert.equal(stillUsable.alive, true, "page must survive the guarded close");
      const replacement = await withStageTimeout(
        page.evaluate(() => {
          const before = window.close;
          let assignmentChanged = false;
          let defineError = null;
          try {
            window.close = function replacement() {};
            assignmentChanged = window.close !== before;
          } catch (error) {
            assignmentChanged = window.close !== before;
          }
          try {
            Object.defineProperty(window, "close", { value: function replacement() {} });
          } catch (error) {
            defineError = error instanceof Error ? error.name : String(error);
          }
          return {
            assignmentFailed: !assignmentChanged,
            defineError,
            stillTheGuard: typeof window.close === "function" &&
              String(window.close) === String(before),
          };
        }),
        "replacement resistance",
      );
      report.assertions.replacementResistance = replacement;
      assert.equal(
        replacement.assignmentFailed,
        true,
        "assignment must not replace the guarded close",
      );
      assert.equal(
        replacement.defineError,
        "TypeError",
        "defineProperty must be rejected on the non-configurable guard",
      );
      report.behavioralVerdict = "GREEN";
      report.checks.push("guarded-close-is-noop-and-irreversible");
    }

    // Stage: safe "after" screenshot.
    const afterShot = path.join(fixture.artifactsDir, "after.png");
    await withStageTimeout(
      page.screenshot({ path: afterShot, animations: "disabled" }),
      "after screenshot",
    );
    report.screenshots.after = afterShot;
  } catch (error) {
    // The behavioral verdict is preserved independently: once behavior was
    // observed (RED/GREEN) a later stage failure does not rewrite it.
    if (report.behavioralVerdict === "NOT_OBSERVED") {
      report.failureClass =
        error.failureClass ?? "unclassified-execute-failure";
      report.failureDetail = error.message;
    }
  } finally {
    try {
      if (browser) {
        await withStageTimeout(browser.close(), "browser close");
        report.cleanup.push("cdp browser session: closed");
        browser = null;
      }
    } catch {
      report.cleanup.push("cdp browser session: unverifiable");
    }
    await stopOwned(electron, "product electron instance", report);
    await finalizeExecuteReport(report, { evidenceDir: layout.evidenceDir });
  }
  return report;
}

/** Evidence finalization: persist the screenshots self-contained, verify every
 *  artifact, compose the evidence/cleanup/overall verdicts, and only then
 *  perform the single definitive persisted report write. The persisted JSON
 *  therefore always contains the same verdict fields as the returned result
 *  and the CLI summary; a persistence failure can only degrade the verdicts,
 *  never leave a persisted SUCCESS behind. */
export async function finalizeExecuteReport(report, { evidenceDir }) {
  report.cleanupVerdict = deriveCleanupVerdict(report.cleanup);
  report.finishedAt = new Date().toISOString();
  const evidencePath = path.join(
    evidenceDir,
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  const missing = [];
  const selfContained = {};
  try {
    await mkdir(evidencePath, { recursive: true });
    const { copyFile } = await import("node:fs/promises");
    const staged = report.screenshots ?? {};
    for (const label of ["before", "after"]) {
      const source = staged[label];
      if (!source) {
        missing.push(`${label}.png was never captured`);
        continue;
      }
      const copy = path.join(evidencePath, `${label}.png`);
      await copyFile(source, copy);
      const info = await stat(copy).catch(() => null);
      if (!info || info.size === 0) {
        missing.push(`${label}.png did not persist`);
      } else {
        selfContained[label] = copy;
      }
    }
  } catch (error) {
    missing.push(`evidence staging failed: ${error.message}`);
  }
  report.screenshots = selfContained;
  report.evidencePath = evidencePath;
  report.evidenceVerdict = {
    verdict: missing.length === 0 ? "complete" : "incomplete",
    complete: missing.length === 0,
    missing: [...new Set(missing)],
  };
  // All verdicts exist at this point: compose the overall status BEFORE the
  // definitive persisted write so stored JSON and returned result agree.
  report.status = composeOverallStatus({
    behavioralVerdict: report.behavioralVerdict,
    evidenceComplete: report.evidenceVerdict.complete === true,
    cleanupClean: report.cleanupVerdict === "clean",
  });
  const reportPath = path.join(evidencePath, "report.json");
  try {
    const { readFile } = await import("node:fs/promises");
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    const persisted = JSON.parse(await readFile(reportPath, "utf8"));
    if (
      persisted.status !== report.status ||
      persisted.behavioralVerdict !== report.behavioralVerdict ||
      persisted.cleanupVerdict !== report.cleanupVerdict ||
      persisted.evidenceVerdict?.complete !== report.evidenceVerdict.complete
    ) {
      throw new Error(
        "persisted verdict fields diverge from the finalized result",
      );
    }
    for (const file of Object.values(selfContained)) {
      const info = await stat(file).catch(() => null);
      if (!info || info.size === 0) {
        throw new Error("screenshot evidence did not persist");
      }
    }
  } catch (error) {
    // Persistence verification failed: degrade the verdicts, recompose the
    // overall status, and rewrite once so the stored truth (if any) matches.
    report.cleanup.push(`report persistence: unverifiable (${error.message})`);
    report.cleanupVerdict = deriveCleanupVerdict(report.cleanup);
    report.evidenceVerdict = {
      verdict: "incomplete",
      complete: false,
      missing: [
        ...new Set([
          ...report.evidenceVerdict.missing,
          `report persistence failed: ${error.message}`,
        ]),
      ],
    };
    report.status = composeOverallStatus({
      behavioralVerdict: report.behavioralVerdict,
      evidenceComplete: false,
      cleanupClean: report.cleanupVerdict === "clean",
    });
    try {
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    } catch {
      // Nothing further can be persisted; the CLI summary stays authoritative.
    }
  }
  return report;
}

/** The CLI summary is derived from the finalized report so printed semantics
 *  and persisted semantics cannot diverge. */
export function buildCliSummary(report) {
  return {
    status: report.status,
    behavioralVerdict: report.behavioralVerdict,
    evidenceVerdict: report.evidenceVerdict,
    cleanupVerdict: report.cleanupVerdict,
    failureClass: report.failureClass,
    checks: report.checks,
    evidencePath: report.evidencePath,
    cleanup: report.cleanup,
  };
}

/** CLI entry point. Dependencies are injectable so the actual execution seams
 *  can be exercised against owned fixtures without any Electron launch. */
export async function main(argv, dependencies = {}) {
  const { mode } = parseCliArgs(argv);
  const layout = dependencies.layout ?? acceptanceLayout();
  if (mode === "help") {
    console.log(JSON.stringify(buildPlan(), null, 2));
    return null;
  }
  if (mode === "check") {
    const result = await runCheck(layout);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return result;
  }
  const result = await runExecute(layout);
  console.log(JSON.stringify(buildCliSummary(result), null, 2));
  // Every execute failure path — including missing build artifacts and any
  // behavioral RED — exits nonzero through this single seam.
  if (result.status !== "SUCCESS") process.exitCode = 1;
  return result;
}

export const __testOnly = { isMainModule, main };

if (isMainModule()) {
  await main(process.argv.slice(2));
}
