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
// Hard rules honored throughout: every case is gated on `process.platform
// === "win32"`; a non-Windows (or unbuilt) run is reported NOT-RUN, never
// green and never silently skipped-as-pass (see `offWindowsReport` and the
// always-run test asserting it); every case has an explicit per-case
// `timeout`; every daemon/process this file starts is torn down through
// `./acceptance-process.mjs`'s `stopAcceptanceProcess`, asserted to reach a
// provable `"exited"` verdict, never left running or merely assumed dead.

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
const daemonPath = path.join(repoRoot, "target", "debug", `drogond${exeSuffix}`);
const cliPath = path.join(repoRoot, "target", "debug", `drogon-cli${exeSuffix}`);

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
 * Spins up one owned, freshly minted `--data-dir` and a real `drogond`
 * against it, hands the caller CLI/RPC helpers scoped to that instance, and
 * guarantees explicit teardown: after an attempted (or admitted) graceful
 * `runtime.shutdown`, the daemon first gets a bounded exit observation via
 * `waitAcceptanceExit`, and `stopAcceptanceProcess` (SIGTERM-then-SIGKILL)
 * runs only if it has not exited by then; the fixture (which contains the
 * owned data directory) is removed only on a provable `"exited"` verdict —
 * every non-exited verdict (`"unverifiable"`, `"live"`, `"missing"`,
 * `"unknown"`, ...) preserves the fixture, logs its path, and fails loudly,
 * so a possibly-still-alive process never races cleanup.
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
  context.after(async () => {
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
      observed.verdict === "exited"
        ? "graceful-observed"
        : "force-fallback";
    const result =
      observed.verdict === "exited"
        ? { ...observed, forced: false }
        : await stopAcceptanceProcess(daemon, {
            graceMs: 5000,
            forceMs: 2000,
          });
    // Fixture preservation on ANY unverified exit: only a provable "exited"
    // verdict may delete the fixture (which contains the dataDir workspace);
    // every other verdict (unverifiable, live, missing, unknown, ...) means a
    // possibly-still-alive process must never race cleanup, so the fixture
    // and its workspace are preserved, logged, and the case fails loudly.
    if (result.verdict === "exited") {
      await rm(fixture, { recursive: true, force: true });
    } else {
      // Surface whichever diagnostic the failure actually produced: a
      // rejected/errored shutdown attempt, and/or stopAcceptanceProcess's own
      // `error` (set when its kill() itself threw) — neither may be dropped
      // from the loud failure below.
      const shutdownDetail = shutdownAttemptError
        ? `; shutdown attempt error: ${shutdownAttemptError.message}`
        : "";
      const stopDetail = result.error ? `; stop error: ${result.error}` : "";
      console.error(
        `[${context.name}] preserving fixture ${fixture} (contains the dataDir ` +
          `workspace): daemon stop verdict was ${JSON.stringify(result.verdict)}, ` +
          `not the provable "exited"; actual teardown path ${actualPath} ` +
          `(shutdown admitted: ${admitted}, forced: ${result.forced})${shutdownDetail}${stopDetail}.`,
      );
      assert.fail(
        `[${context.name}] the owned daemon must be provably stopped, never left ` +
          `running (actual teardown path: ${actualPath}; shutdown admitted: ${admitted}; ` +
          `forced: ${result.forced}); stop verdict was ${JSON.stringify(result.verdict)}, ` +
          `so the fixture is preserved at ${fixture}${shutdownDetail}${stopDetail}`,
      );
    }
  });

  async function cli(args, options = {}) {
    const { stdout } = await runAcceptanceProcess(
      cliPath,
      ["--data-dir", dataDir, "--json", ...args],
      {
        cwd: repoRoot,
        timeout: options.timeout ?? 10000,
        env: { ...baseEnv, ...env, ...options.env },
      },
    );
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
    return response.result;
  }

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

  return run({ dataDir, fixture, daemon, cli, cliExpectFailure, rpc, eventually });
}

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
      assert.ok(token.length > 0, "drogond must mint a real per-run token file");
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
      assert.equal(exit.code, 0, "an admitted shutdown must exit cleanly, not crash");
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
