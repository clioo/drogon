// V5 second-slot Windows named-pipe acceptance leaf.
//
// PROPOSED WIRING FOR ROOT (not wired by this file — this leaf never edits
// CI/Cargo/manifests): once drogond's Windows named-pipe listener lands, add
// a windows-2022 CI step that runs `cargo build --workspace --locked` then
// `node --test scripts/windows-named-pipe-acceptance.test.mjs`. windows-2022
// already carries rustup/cargo and a Node toolchain used by this repo's other
// `node --test scripts/*.test.mjs` jobs, so no extra runner provisioning is
// needed.
//
// This spawns the REAL BUILT `target/debug/drogond.exe` and
// `target/debug/drogon-cli.exe` (via `./acceptance-process.mjs`'s
// spawn/cleanup helpers, no shelling out to `powershell.exe` or any other
// shell, no EDR-relevant flags, Node APIs only) and drives them the way
// `scripts/accept-core-cli.mjs` already does on Unix.
// `scripts/windows-native-transport.mjs` (read-only input) only mirrors the
// wire protocol against a `node:net` fixture server it mints itself; it can
// never prove the real Rust binaries speak that protocol over a real win32
// named pipe, which is what this file is for.
//
// Header scope, re-verified against this exact checkout (not a general
// claim): `crates/drogond/src/lib.rs:107-115` still gates `serve()`'s
// `#[cfg(not(unix))]` fallback to unconditionally return
// `ServeError::UnsupportedPlatform`, and `crates/drogond/src/endpoint.rs:12`
// is still `#![cfg(unix)]`-only and binds no Windows listener. So every
// WIN32-gated case below is real RED today, real GREEN only once that
// admission path lands — never silently skipped or force-passed. The pipe
// *address* is not a guess: `crates/drogon-cli/src/paths.rs`'s
// `windows_pipe_name` is the frozen client-side contract (covered by
// `pipe_name_is_contract_stable`), and `resolveOwnedPipePath` in the
// read-only `windows-native-transport.mjs` mirrors it verbatim; only the
// server-side bind is still missing.
//
// Wrong-credential rejection is driven through the CLI's existing
// `DROGON_DISPATCH_CAPABILITY` env override (`crates/drogon-cli/src/
// credential.rs`): a syntactically well-formed but wrong value is sent
// verbatim as the wire `auth` field and judged by the server, never the CLI
// locally (credential.rs:6-9), producing `"unauthorized"`
// (`dispatch_authenticated` in drogon-core/src/lib.rs:220-241,
// `coordination_access::unauthorized()` in coordination_access.rs:35-39).
//
// Hard rules honored throughout: every WIN32 case is gated on
// `process.platform === "win32"`; a non-Windows (or unbuilt) run is reported
// NOT-RUN, never green and never silently skipped-as-pass (see
// `offWindowsReport` and the always-run test asserting it); every case has an
// explicit per-case `timeout`; every daemon/process this file starts is torn
// down through `./acceptance-process.mjs`'s `stopAcceptanceProcess`, asserted
// to reach a provable `"exited"` verdict, never left running or merely
// assumed dead. Fixture/dataDir removal additionally requires a passed test
// body and no live/unverifiable CLI/session child outcomes — daemon-exited
// alone never permits cleanup — and that removal contract carries its own
// platform-independent regression tests below (never win32-gated).

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  runAcceptanceProcess,
  startAcceptanceProcess,
  stopAcceptanceProcess,
  waitAcceptanceExit,
} from "./acceptance-process.mjs";
import { resolveOwnedPipePath } from "./windows-native-transport.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const exeSuffix = process.platform === "win32" ? ".exe" : "";
const daemonPath = path.join(
  repoRoot,
  "target",
  "debug",
  `drogond${exeSuffix}`,
);
const cliPath = path.join(
  repoRoot,
  "target",
  "debug",
  `drogon-cli${exeSuffix}`,
);

/** Honest off-Windows (or non-win32-build) status: never a fabricated pass. */
function offWindowsReport() {
  return {
    platform: process.platform,
    verdict: "not-run",
    reason:
      "windows-named-pipe-acceptance requires a real win32 host running a " +
      `real built drogond${exeSuffix} + drogon-cli${exeSuffix}; this run is on ` +
      `${process.platform}, so every case below is honestly reported NOT-RUN, ` +
      "never a fabricated pass and never silently skipped-as-pass.",
  };
}

const WIN32_ONLY = {
  skip:
    process.platform !== "win32"
      ? `windows-only: requires a real built win32 drogond.exe + drogon-cli.exe (this run is on ${process.platform}); see offWindowsReport()`
      : false,
};

test(
  "off-Windows (or non-win32 host) this suite honestly reports NOT-RUN, never a fabricated pass",
  {
    skip:
      process.platform === "win32"
        ? "covered on win32 by the dedicated cases below, not by re-asserting the NOT-RUN guard here"
        : false,
  },
  () => {
    const report = offWindowsReport();
    assert.equal(report.platform, process.platform);
    assert.equal(report.verdict, "not-run");
    assert.match(report.reason, /requires a real win32 host/);
  },
);

/** Windows env keys are case-insensitive; strip any casing of the name. */
function withoutDispatchCapabilityEnv(source) {
  const result = {};
  for (const [key, value] of Object.entries(source)) {
    if (key.toUpperCase() !== "DROGON_DISPATCH_CAPABILITY") result[key] = value;
  }
  return result;
}

/**
 * Classifies the test-body outcome for teardown. A cancelled body (node:test
 * aborts `context.signal` on timeout/cancel — observed on Node 24: the test
 * counts as `cancelled` with `signal.aborted === true`) counts as
 * "cancelled" even when its error surfaces later; any other body error
 * counts as "failed"; a clean return counts as "passed".
 */
function classifyBodyOutcome({ signalAborted = false, bodyError } = {}) {
  if (signalAborted) return "cancelled";
  if (bodyError !== undefined) return "failed";
  return "passed";
}

/**
 * Sole authority for fixture/dataDir removal. Daemon-exited alone never
 * permits cleanup: removal requires a passed body, a provable `"exited"`
 * daemon verdict, and every tracked CLI/session child outcome `"exited"`.
 * Pure and platform-independent so the regression tests below execute it on
 * any host instead of hiding behind the win32 gate.
 */
function decideFixtureDisposition({
  bodyOutcome,
  daemonVerdict,
  openChildren = [],
}) {
  const blockers = [];
  if (bodyOutcome !== "passed")
    blockers.push(`test body ${bodyOutcome}, evidence must be preserved`);
  for (const child of openChildren)
    if (child.verdict !== "exited")
      blockers.push(`${child.kind} ${child.id} is ${child.verdict}`);
  if (daemonVerdict !== "exited")
    blockers.push(
      `daemon stop verdict was ${JSON.stringify(daemonVerdict)}, not the provable "exited"`,
    );
  if (blockers.length > 0)
    return { remove: false, reason: `cleanup blocked: ${blockers.join("; ")}` };
  return {
    remove: true,
    reason: "body passed, daemon provably exited, every tracked child exited",
  };
}

/**
 * Applies a fixture disposition: removes on approval, otherwise logs the
 * preserved path and fails loudly — but only when the body itself passed. A
 * failed/cancelled body already fails the test with its own error, so the
 * teardown hook must not mask it with a second failure; preservation plus
 * the log carry the evidence either way.
 */
async function settleOwnedFixture({
  label,
  fixture,
  bodyOutcome,
  daemonResult,
  openChildren,
  teardownNote,
  deps = {},
}) {
  const {
    removeDir = (dir) => rm(dir, { recursive: true, force: true }),
    report = (message) => console.error(message),
  } = deps;
  const disposition = decideFixtureDisposition({
    bodyOutcome,
    daemonVerdict: daemonResult.verdict,
    openChildren,
  });
  if (disposition.remove) {
    await removeDir(fixture);
    return { removed: true };
  }
  report(
    `[${label}] preserving fixture ${fixture} (contains the dataDir ` +
      `workspace): ${disposition.reason}; ${teardownNote}.`,
  );
  if (bodyOutcome === "passed") {
    assert.fail(
      `[${label}] the owned daemon and every owned child must be provably ` +
        `stopped, never left running; ${disposition.reason}, ` +
        `so the fixture is preserved at ${fixture}; ${teardownNote}`,
    );
  }
  return { removed: false };
}

/**
 * Runs `runProcess(file, args, options)`, appending a ledger record classified
 * exactly the way `createFixtureCli`'s CLI calls are. `"exited"` requires
 * positive evidence the process ended under the execFile runner contract:
 * success, a numeric `error.code` exit status, or an `error.signal` string.
 * Anything else is `"unverifiable"`: a runner-side kill (`error.killed`,
 * e.g. an execFile `timeout`) never observed an exit, and a spawn failure
 * (`error.code` a string errno such as `"ENOENT"`) never ran a process at
 * all — a bare `killed === false` alone proves nothing, so the default is
 * fail-closed. Extracted to a standalone helper so this exact classification
 * logic can be exercised directly against a REAL child process (see the
 * regression test below) instead of only through a stubbed `runProcess`.
 */
async function runTrackedChild({
  ledger,
  kind,
  id,
  runProcess,
  file,
  args,
  options = {},
}) {
  const record = { kind, id, verdict: "live" };
  ledger.push(record);
  try {
    const result = await runProcess(file, args, options);
    record.verdict = "exited";
    return result;
  } catch (error) {
    record.verdict = classifyRunProcessError(error);
    throw error;
  }
}

/**
 * Fail-closed reading of an execFile-style rejection under the
 * `runAcceptanceProcess` contract. Only a numeric exit `code` or a `signal`
 * string proves the child ended; a runner-side kill or a spawn-shaped error
 * (string errno, no exit evidence) stays `"unverifiable"`.
 */
function classifyRunProcessError(error) {
  if (error?.killed) return "unverifiable";
  if (typeof error?.code === "number" || typeof error?.signal === "string")
    return "exited";
  return "unverifiable";
}

/**
 * CLI/RPC helpers with a child-outcome ledger. Every spawned CLI process is
 * tracked via `runTrackedChild`. `session.start` / `session.stop` RPCs
 * maintain the session-child record by exact session id + incarnation.
 * Ledger entries are `{ kind, id, verdict }`; only non-`"exited"` entries
 * block fixture removal.
 */
function createFixtureCli({
  runProcess,
  ledger,
  cliPath,
  dataDir,
  cwd,
  baseEnv,
  env,
}) {
  let cliSeq = 0;

  async function cli(args, options = {}) {
    const { stdout } = await runTrackedChild({
      ledger,
      kind: "cli",
      id: `cli-${++cliSeq}`,
      runProcess,
      file: cliPath,
      args: ["--data-dir", dataDir, "--json", ...args],
      options: {
        cwd,
        timeout: options.timeout ?? 10000,
        env: { ...baseEnv, ...env, ...options.env },
      },
    });
    return JSON.parse(stdout);
  }

  /** Runs a CLI call expected to fail; returns its parsed `--json` failure envelope. */
  async function cliExpectFailure(args, options = {}) {
    try {
      const unexpected = await cli(args, options);
      assert.fail(
        `expected the CLI call to fail, but it succeeded: ${JSON.stringify(unexpected)}`,
      );
    } catch (error) {
      if (typeof error.stdout !== "string" || error.stdout.length === 0)
        throw error;
      return JSON.parse(error.stdout);
    }
  }

  async function rpc(method, params, requestId = randomUUID()) {
    const response = await cli([
      "rpc",
      method,
      "--params",
      JSON.stringify(params),
      "--request-id",
      requestId,
    ]);
    assert.equal(
      response.ok,
      true,
      `expected ${method} to succeed: ${JSON.stringify(response)}`,
    );
    const result = response.result;
    if (method === "session.start" && result?.verdict === "live") {
      ledger.push({
        kind: "session",
        id: `${result.id}#${result.incarnation}`,
        sessionId: result.id,
        incarnation: result.incarnation,
        verdict: "live",
      });
    } else if (method === "session.stop" && params?.sessionId !== undefined) {
      const record = ledger.find(
        (entry) =>
          entry.kind === "session" &&
          entry.sessionId === params.sessionId &&
          entry.incarnation === params.incarnation,
      );
      if (record) record.verdict = result?.verdict ?? "unverifiable";
    }
    return result;
  }

  return { cli, cliExpectFailure, rpc };
}

/**
 * Spins up one owned, freshly minted `--data-dir` and a real `drogond`
 * against it, hands the caller CLI/RPC helpers scoped to that instance, and
 * guarantees explicit teardown: after an attempted (or admitted) graceful
 * `runtime.shutdown`, the daemon first gets a bounded exit observation via
 * `waitAcceptanceExit`, and `stopAcceptanceProcess` (SIGTERM-then-SIGKILL)
 * runs only if it has not exited by then.
 *
 * Removal contract: the fixture (which contains the owned data directory)
 * is removed ONLY when the test body passed AND the daemon stop verdict is
 * a provable `"exited"` AND every tracked CLI/session child outcome is
 * `"exited"`. A failed or cancelled body, or any live/unverifiable child,
 * preserves the fixture and its workspace for evidence — daemon-exited
 * alone never permits cleanup, so a still-running child or a failed body
 * can never race or destroy evidence.
 */
async function withDaemon(context, run, { env = {} } = {}) {
  await access(daemonPath);
  await access(cliPath);
  const fixture = await mkdtemp(path.join(tmpdir(), "wnpa-"));
  const dataDir = path.join(fixture, "data");
  // Ambient inherited env must never hand a real dispatch credential to a
  // fixture that expects the default per-run-token flow; only the
  // wrong-credential case below adds its own explicit override.
  const baseEnv = withoutDispatchCapabilityEnv(process.env);
  const daemon = startAcceptanceProcess(daemonPath, ["--data-dir", dataDir], {
    cwd: repoRoot,
    stdio: ["ignore", "ignore", "ignore"],
    env: {
      ...baseEnv,
      ...env,
      ORCA_ACCEPTANCE_SENTINEL: "must-not-reach-new-runtime-children",
    },
  });
  // Body-phase child-outcome ledger for the removal contract: every CLI
  // process and session child the body spawns is recorded here. Set by the
  // body via the helpers below; read (as a pre-probe snapshot) by teardown.
  const childLedger = [];
  // Set when the body throws; rethrown unchanged so the test still fails
  // with its original error while teardown preserves the evidence.
  let bodyError;
  const { cli, cliExpectFailure, rpc } = createFixtureCli({
    runProcess: runAcceptanceProcess,
    ledger: childLedger,
    cliPath,
    dataDir,
    cwd: repoRoot,
    baseEnv,
    env,
  });
  context.after(async () => {
    const bodyOutcome = classifyBodyOutcome({
      signalAborted: context.signal?.aborted === true,
      bodyError,
    });
    // Snapshot body-phase children BEFORE teardown's own status/shutdown
    // probes: probes run after the body and must never gate removal.
    const openChildren = childLedger.filter(
      (record) => record.verdict !== "exited",
    );
    // Prefer the admitted graceful path (`runtime.shutdown` over the named
    // pipe) while the daemon is still responsive; Node's child_process docs
    // state SIGTERM forcibly terminates on Windows, so `stopAcceptanceProcess`
    // (SIGTERM-then-SIGKILL) can only be a disclosed fallback, never the
    // primary teardown path. `admitted` records whether the shutdown RPC was
    // actually ADMITTED, not merely attempted.
    let admitted = false;
    // Bound to the error that prevented admission, distinct from
    // "unresponsive/gone": an explicit rejection of runtime.shutdown must
    // stay visible in the eventual failure message, never collapse into an
    // indistinguishable `admitted: false`.
    let shutdownAttemptError;
    try {
      const status = await cli(["status"], { timeout: 2000 });
      if (status.ok === true) {
        await rpc("runtime.shutdown", {
          hostId: status.result.hostId,
          serviceInstanceId: status.result.serviceInstanceId,
        });
        admitted = true;
      }
    } catch (error) {
      // Daemon unresponsive, already gone, or shutdown was rejected; the
      // bounded observation below still runs before any force.
      shutdownAttemptError = error;
    }
    // Graceful-first: give the admitted (or never-responsive) daemon a
    // bounded window to actually exit before any signal is sent.
    const observed = await waitAcceptanceExit(daemon, 8000);
    const actualPath =
      observed.verdict === "exited" ? "graceful-observed" : "force-fallback";
    const result =
      observed.verdict === "exited"
        ? { ...observed, forced: false }
        : await stopAcceptanceProcess(daemon, {
            graceMs: 5000,
            forceMs: 2000,
          });
    // Surface whichever diagnostic the failure actually produced: a
    // rejected/errored shutdown attempt, and/or stopAcceptanceProcess's own
    // `error` (set when its kill() itself threw) — neither may be dropped
    // from the preservation report below.
    const shutdownDetail = shutdownAttemptError
      ? `; shutdown attempt error: ${shutdownAttemptError.message}`
      : "";
    const stopDetail = result.error ? `; stop error: ${result.error}` : "";
    // Removal contract: daemon-exited alone never permits cleanup — the
    // body must have passed and every tracked CLI/session child must be
    // provably exited too, otherwise the fixture is preserved as evidence.
    await settleOwnedFixture({
      label: context.name,
      fixture,
      bodyOutcome,
      daemonResult: result,
      openChildren,
      teardownNote:
        `actual teardown path ${actualPath} (shutdown admitted: ${admitted}, ` +
        `forced: ${result.forced})${shutdownDetail}${stopDetail}`,
    });
  });

  async function eventually(action, predicate, label, timeout = 10000) {
    const until = Date.now() + timeout;
    let lastError;
    do {
      try {
        const result = await action();
        if (predicate(result)) return result;
      } catch (error) {
        lastError = error;
      }
      await delay(100);
    } while (Date.now() < until);
    throw new Error(
      `${label} did not settle within ${timeout}ms${lastError ? `: ${lastError.message}` : ""}`,
    );
  }

  try {
    return await run({
      dataDir,
      fixture,
      daemon,
      cli,
      cliExpectFailure,
      rpc,
      eventually,
    });
  } catch (error) {
    // Record the body failure for teardown (which preserves the fixture as
    // evidence), then rethrow unchanged so the test fails with its original
    // error instead of a teardown substitute.
    bodyError = error;
    throw error;
  }
}

// Platform-independent teardown-contract regression tests (critical
// acceptance correction): these run on EVERY host — never WIN32-gated — so a
// non-Windows run still executes the removal decision instead of skipping it.

test("teardown contract: removal requires passed body, exited daemon, and no open children", () => {
  const cases = [
    [
      "failed body blocks removal even when the daemon exited",
      { bodyOutcome: "failed", daemonVerdict: "exited", openChildren: [] },
      false,
      /test body failed/,
    ],
    [
      "cancelled body blocks removal even when the daemon exited",
      {
        bodyOutcome: "cancelled",
        daemonVerdict: "exited",
        openChildren: [],
      },
      false,
      /test body cancelled/,
    ],
    [
      "unverifiable session child blocks removal even when daemon exited",
      {
        bodyOutcome: "passed",
        daemonVerdict: "exited",
        openChildren: [
          { kind: "session", id: "sess-1#2", verdict: "unverifiable" },
        ],
      },
      false,
      /session sess-1#2 is unverifiable/,
    ],
    [
      "live CLI child blocks removal even when the daemon exited",
      {
        bodyOutcome: "passed",
        daemonVerdict: "exited",
        openChildren: [{ kind: "cli", id: "cli-1", verdict: "live" }],
      },
      false,
      /cli cli-1 is live/,
    ],
    [
      "unverifiable daemon blocks removal even with a passed body",
      {
        bodyOutcome: "passed",
        daemonVerdict: "unverifiable",
        openChildren: [],
      },
      false,
      /daemon stop verdict was "unverifiable"/,
    ],
    [
      "exited child records never block removal",
      {
        bodyOutcome: "passed",
        daemonVerdict: "exited",
        openChildren: [{ kind: "session", id: "sess-1#2", verdict: "exited" }],
      },
      true,
      /every tracked child exited/,
    ],
    [
      "clean passed run removes the fixture",
      { bodyOutcome: "passed", daemonVerdict: "exited", openChildren: [] },
      true,
      /provably exited/,
    ],
  ];
  for (const [name, input, wantRemove, wantReason] of cases) {
    const disposition = decideFixtureDisposition(input);
    assert.equal(disposition.remove, wantRemove, name);
    assert.match(disposition.reason, wantReason, name);
  }
});

test("teardown contract: aborted signal classifies the body as cancelled", () => {
  assert.equal(classifyBodyOutcome({ signalAborted: true }), "cancelled");
  assert.equal(
    classifyBodyOutcome({
      signalAborted: true,
      bodyError: new Error("late failure"),
    }),
    "cancelled",
  );
  assert.equal(classifyBodyOutcome({ bodyError: new Error("boom") }), "failed");
  assert.equal(classifyBodyOutcome({}), "passed");
});

test(
  "teardown contract: blocked dispositions preserve the fixture dir and name the blocker",
  { timeout: 15000 },
  async (t) => {
    const dirs = [];
    t.after(async () => {
      for (const dir of dirs) await rm(dir, { recursive: true, force: true });
    });
    const reports = [];
    const deps = { report: (message) => reports.push(message) };
    const teardownNote =
      "actual teardown path graceful-observed (shutdown admitted: true, forced: false)";
    async function freshDir() {
      const dir = await mkdtemp(path.join(tmpdir(), "wnpa-contract-"));
      dirs.push(dir);
      return dir;
    }

    // Failed body + exited daemon: preserved, logged, and no second failure
    // thrown (the body's own error already fails the test).
    {
      const fixture = await freshDir();
      const outcome = await settleOwnedFixture({
        label: "failed-body",
        fixture,
        bodyOutcome: "failed",
        daemonResult: { verdict: "exited", forced: false },
        openChildren: [],
        teardownNote,
        deps,
      });
      assert.equal(outcome.removed, false);
      await access(fixture);
      assert.match(reports.at(-1), /preserving fixture/);
      assert.match(reports.at(-1), /test body failed/);
    }

    // Cancelled body + exited daemon: same, naming the cancellation.
    {
      const fixture = await freshDir();
      const outcome = await settleOwnedFixture({
        label: "cancelled-body",
        fixture,
        bodyOutcome: "cancelled",
        daemonResult: { verdict: "exited", forced: false },
        openChildren: [],
        teardownNote,
        deps,
      });
      assert.equal(outcome.removed, false);
      await access(fixture);
      assert.match(reports.at(-1), /test body cancelled/);
    }

    // Passed body + exited daemon + unverifiable session child: preserved
    // AND loudly failed, naming the exact child.
    {
      const fixture = await freshDir();
      await assert.rejects(
        settleOwnedFixture({
          label: "open-child",
          fixture,
          bodyOutcome: "passed",
          daemonResult: { verdict: "exited", forced: false },
          openChildren: [
            { kind: "session", id: "sess-7#1", verdict: "unverifiable" },
          ],
          teardownNote,
          deps,
        }),
        /sess-7#1 is unverifiable/,
      );
      await access(fixture);
    }

    // Passed body + exited daemon + LIVE (not merely unverifiable) cli
    // child: preserved AND loudly failed, naming the exact live child.
    {
      const fixture = await freshDir();
      await assert.rejects(
        settleOwnedFixture({
          label: "live-child",
          fixture,
          bodyOutcome: "passed",
          daemonResult: { verdict: "exited", forced: false },
          openChildren: [{ kind: "cli", id: "cli-3", verdict: "live" }],
          teardownNote,
          deps,
        }),
        /cli cli-3 is live/,
      );
      await access(fixture);
    }

    // Passed body + unverifiable daemon: preserved AND loudly failed.
    {
      const fixture = await freshDir();
      await assert.rejects(
        settleOwnedFixture({
          label: "open-daemon",
          fixture,
          bodyOutcome: "passed",
          daemonResult: { verdict: "unverifiable", forced: false },
          openChildren: [],
          teardownNote,
          deps,
        }),
        /daemon stop verdict was "unverifiable"/,
      );
      await access(fixture);
    }
  },
);

test(
  "teardown contract: clean passed run removes the fixture dir",
  { timeout: 15000 },
  async () => {
    const reports = [];
    const fixture = await mkdtemp(path.join(tmpdir(), "wnpa-contract-"));
    const outcome = await settleOwnedFixture({
      label: "clean",
      fixture,
      bodyOutcome: "passed",
      daemonResult: { verdict: "exited", forced: false },
      openChildren: [],
      teardownNote:
        "actual teardown path graceful-observed (shutdown admitted: true, forced: false)",
      deps: { report: (message) => reports.push(message) },
    });
    assert.equal(outcome.removed, true);
    assert.equal(reports.length, 0);
    await assert.rejects(access(fixture), /ENOENT/);
  },
);

test(
  "teardown contract: CLI/session child outcomes are tracked by exact outcome",
  { timeout: 15000 },
  async () => {
    const ledger = [];
    const okEnvelope = (payload) => ({ stdout: JSON.stringify(payload) });
    const { cli, cliExpectFailure, rpc } = createFixtureCli({
      runProcess: async (file, args) => {
        void file;
        const sub = args[args.indexOf("--json") + 1];
        if (sub === "timeout-cli") {
          const error = new Error("timed out");
          error.killed = true;
          throw error;
        }
        if (sub === "gone-cli") {
          const error = new Error("exit 1");
          error.code = 1;
          error.stdout = "";
          throw error;
        }
        if (sub === "refused") {
          const error = new Error("exit 1");
          error.code = 1;
          error.stdout = JSON.stringify({
            ok: false,
            error: { code: "unauthorized" },
          });
          throw error;
        }
        if (sub === "rpc") {
          const method = args[args.indexOf("rpc") + 1];
          if (method === "session.start")
            return okEnvelope({
              ok: true,
              result: { id: "sess-9", incarnation: 4, verdict: "live" },
            });
          if (method === "session.stop")
            return okEnvelope({ ok: true, result: { verdict: "exited" } });
        }
        return okEnvelope({ ok: true, result: {} });
      },
      ledger,
      cliPath: "/stub/drogon-cli",
      dataDir: "/stub/data",
      cwd: "/stub",
      baseEnv: {},
      env: {},
    });

    const status = await cli(["status"]);
    assert.equal(status.ok, true);
    assert.equal(ledger.at(-1).verdict, "exited");

    await assert.rejects(cli(["timeout-cli"]), /timed out/);
    assert.equal(ledger.at(-1).verdict, "unverifiable");

    await assert.rejects(cli(["gone-cli"]));
    assert.equal(ledger.at(-1).verdict, "exited");

    const refused = await cliExpectFailure(["refused"]);
    assert.equal(refused.error.code, "unauthorized");
    assert.equal(ledger.at(-1).verdict, "exited");

    const started = await rpc("session.start", { workspaceId: "ws-1" });
    assert.equal(started.verdict, "live");
    const sessionRecord = ledger.find((entry) => entry.kind === "session");
    assert.equal(sessionRecord.verdict, "live");
    const stopped = await rpc("session.stop", {
      sessionId: "sess-9",
      incarnation: 4,
    });
    assert.equal(stopped.verdict, "exited");
    assert.equal(sessionRecord.verdict, "exited");
  },
);

test(
  "teardown contract: ledger classification is driven by REAL runAcceptanceProcess children, not a stub",
  { timeout: 15000 },
  async () => {
    const ledger = [];
    // Real exited child: a real `process.execPath` process run through the
    // REAL `runAcceptanceProcess` (execFileAsync), not a stub — proves the
    // "exited" branch against an actual OS process that ran to completion.
    await runTrackedChild({
      ledger,
      kind: "cli",
      id: "real-exit",
      runProcess: runAcceptanceProcess,
      file: process.execPath,
      args: ["-e", "process.exit(0)"],
    });
    assert.equal(
      ledger.find((entry) => entry.id === "real-exit").verdict,
      "exited",
    );

    // Real unverifiable child: a real process that outlives a bounded
    // execFile `timeout`, so `runAcceptanceProcess` itself kills it and
    // surfaces `error.killed` — proving the "unverifiable" branch against a
    // real, was-alive-until-killed child, not a fabricated error shape.
    await assert.rejects(
      runTrackedChild({
        ledger,
        kind: "cli",
        id: "real-timeout",
        runProcess: runAcceptanceProcess,
        file: process.execPath,
        args: ["-e", "setTimeout(() => process.exit(0), 5000)"],
        options: { timeout: 300 },
      }),
    );
    assert.equal(
      ledger.find((entry) => entry.id === "real-timeout").verdict,
      "unverifiable",
    );

    // Real nonzero exit: the child provably ran and ended (execFile rejects
    // with a numeric `error.code`), so the record is "exited" — this is the
    // positive-evidence branch, not a bare `killed === false` assumption.
    const exitError = await runTrackedChild({
      ledger,
      kind: "cli",
      id: "real-nonzero-exit",
      runProcess: runAcceptanceProcess,
      file: process.execPath,
      args: ["-e", "process.exit(3)"],
    }).then(
      () => assert.fail("a nonzero exit must reject under execFile"),
      (error) => error,
    );
    assert.equal(exitError.code, 3);
    assert.equal(
      ledger.find((entry) => entry.id === "real-nonzero-exit").verdict,
      "exited",
    );

    // Real spawn failure: no process ever ran (string errno, no exit
    // evidence), so the record stays "unverifiable" even though nothing was
    // killed — fail-closed instead of assuming an exit.
    await assert.rejects(
      runTrackedChild({
        ledger,
        kind: "cli",
        id: "real-spawn-failure",
        runProcess: runAcceptanceProcess,
        file: path.join(tmpdir(), `wnpa-no-such-binary-${randomUUID()}`),
        args: [],
      }),
    );
    assert.equal(
      ledger.find((entry) => entry.id === "real-spawn-failure").verdict,
      "unverifiable",
    );
  },
);

test(
  "named-pipe startup: drogond binds a real win32 named pipe that drogon-cli can reach",
  { ...WIN32_ONLY, timeout: 20000 },
  (t) =>
    withDaemon(t, async ({ cli, eventually }) => {
      const status = await eventually(
        () => cli(["status"]),
        (value) => value.ok === true,
        "named-pipe startup",
      );
      assert.equal(status.ok, true);
    }),
);

test(
  "status: reports real runtime identity over the named pipe",
  { ...WIN32_ONLY, timeout: 20000 },
  (t) =>
    withDaemon(t, async ({ cli, eventually }) => {
      const status = await eventually(
        () => cli(["status"]),
        (value) => value.ok === true,
        "status",
      );
      assert.equal(typeof status.result.hostId, "string");
      assert.ok(status.result.hostId.length > 0);
      assert.equal(typeof status.result.serviceInstanceId, "string");
      assert.ok(status.result.serviceInstanceId.length > 0);
      assert.ok(Array.isArray(status.result.capabilities));
    }),
);

test(
  "auth: the daemon's own freshly minted per-run token authenticates a request over the named pipe",
  { ...WIN32_ONLY, timeout: 20000 },
  (t) =>
    withDaemon(t, async ({ cli, eventually, dataDir }) => {
      const status = await eventually(
        () => cli(["status"]),
        (value) => value.ok === true,
        "auth handshake",
      );
      assert.equal(status.ok, true);
      const token = await readFile(path.join(dataDir, "auth.token"), "utf8");
      assert.ok(
        token.length > 0,
        "drogond must mint a real per-run token file",
      );
    }),
);

test(
  "wrong-credential rejection: a well-formed but wrong credential is refused, never accepted",
  { ...WIN32_ONLY, timeout: 20000 },
  (t) =>
    withDaemon(t, async ({ cli, cliExpectFailure, eventually }) => {
      await eventually(
        () => cli(["status"]),
        (value) => value.ok === true,
        "daemon ready before probing rejection",
      );
      const refused = await cliExpectFailure(["status"], {
        env: {
          DROGON_DISPATCH_CAPABILITY: `wrong-credential-${randomUUID()}`,
        },
      });
      assert.equal(refused.ok, false);
      assert.equal(refused.error.code, "unauthorized");
    }),
);

test(
  "idle-client shutdown: an idle raw connection does not block the daemon draining on an admitted runtime.shutdown",
  { ...WIN32_ONLY, timeout: 20000 },
  (t) =>
    withDaemon(t, async ({ cli, eventually, rpc, dataDir, daemon }) => {
      const status = await eventually(
        () => cli(["status"]),
        (value) => value.ok === true,
        "daemon ready before idle shutdown",
      );
      const pipePath = resolveOwnedPipePath(await realpath(dataDir));
      const idle = await new Promise((resolve, reject) => {
        const socket = net.createConnection(pipePath);
        socket.once("connect", () => resolve(socket));
        socket.once("error", reject);
      });
      t.after(() => idle.destroy());
      // Deliberately idle: connected to the real named pipe, nothing sent,
      // no reply awaited. `ConnectionRegistry::drain` (service_quiescence.rs)
      // must tear this down itself; an idle client must never be waited out
      // by the shutdown path, and forcefully killing the daemon (SIGTERM
      // forcibly terminates on Windows per the Node child_process docs, so
      // `forced:false` from that path never proves a real drain) is not
      // evidence of that.
      const shutdown = await rpc("runtime.shutdown", {
        hostId: status.result.hostId,
        serviceInstanceId: status.result.serviceInstanceId,
      });
      assert.equal(shutdown.accepted, true);
      const exit = await waitAcceptanceExit(daemon, 8000);
      assert.equal(
        exit.verdict,
        "exited",
        "the daemon must actually exit after an admitted runtime.shutdown, not merely acknowledge it",
      );
      assert.equal(
        exit.code,
        0,
        "an admitted shutdown must exit cleanly, not crash",
      );
    }),
);

test(
  "cancel-and-reap: session.stop over the named pipe reaps the real child before the daemon shuts down",
  { ...WIN32_ONLY, timeout: 25000 },
  (t) =>
    withDaemon(t, async ({ cli, eventually, rpc }) => {
      await eventually(
        () => cli(["status"]),
        (value) => value.ok === true,
        "daemon ready before cancel-and-reap",
      );
      const folder = await mkdtemp(path.join(tmpdir(), "wnpa-ws-"));
      // Verified only once a `session.stop` verdict for THIS exact session is
      // observed as "exited"; stays undefined otherwise, including if the
      // case fails before session.start ever runs.
      let sessionStopVerdict;
      t.after(async () => {
        if (sessionStopVerdict === "exited") {
          await rm(folder, { recursive: true, force: true });
        } else {
          // The real child may still be alive: deleting the workspace folder
          // here would race a possibly-live process and destroy evidence, so
          // it is preserved instead and its path is logged for follow-up.
          console.error(
            `[${t.name}] preserving workspace folder ${folder}: session stop verdict was ` +
              `${JSON.stringify(sessionStopVerdict)}, not the verified "exited"`,
          );
        }
      });
      const added = await cli([
        "workspace",
        "add",
        folder,
        "--name",
        "windows-named-pipe-acceptance",
      ]);
      assert.equal(added.ok, true);
      const started = await rpc("session.start", {
        workspaceId: added.result.id,
        command: process.execPath,
        // Bounded synthetic child: self-exits after 15s, well inside this
        // case's 25s timeout, so a failed reap can never leave an orphan
        // running forever; session.stop below runs immediately after start,
        // so the child is still provably live at stop time.
        args: ["-e", "setTimeout(() => process.exit(0), 15000)"],
        cols: 80,
        rows: 24,
      });
      try {
        assert.equal(started.verdict, "live");
        const stopped = await rpc("session.stop", {
          sessionId: started.id,
          incarnation: started.incarnation,
        });
        sessionStopVerdict = stopped.verdict;
        assert.equal(
          stopped.verdict,
          "exited",
          "cancellation must actually reap the real child process, not just mark it stopped",
        );
      } catch (error) {
        // Guarded failure-path cleanup: session.start already produced a
        // real child, so any assertion/RPC failure past that point must
        // still reap the EXACT started session id + incarnation (this RPC
        // shape carries no separate host field to include) rather than
        // leaking it. A cleanup failure is attached as suppressed detail,
        // never allowed to replace or mask the original failure.
        try {
          const cleanupStopped = await rpc("session.stop", {
            sessionId: started.id,
            incarnation: started.incarnation,
          });
          sessionStopVerdict = cleanupStopped.verdict;
        } catch (cleanupError) {
          error.cause = cleanupError;
        }
        throw error;
      }
    }),
);
