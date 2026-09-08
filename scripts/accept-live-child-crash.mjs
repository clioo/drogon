// Real live-child service-crash acceptance. Closes the gap left by
// accept-core-cli.mjs (which stops every session before the daemon SIGKILL,
// proving only dead-service persistence): here a PTY child is provably alive
// on two independent channels while the owned daemon is SIGKILLed via its
// exact ChildProcess handle, and the restarted daemon must label the
// prior-live session unverifiable, renew instance/auth, refuse to respawn,
// and replay the whole historic receipt verbatim.
//
// Evidence layering (see live-child-crash-fixture.mjs): control close is
// control loss only; the kernel exit observer is the exit authority;
// ambiguous evidence classifies unverifiable with the fixture retained; the
// child pid is never signaled. Windows is refused outright (drogond is
// unsupported there); Linux shares the code paths but is unexecuted here.

import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  runAcceptanceProcess,
  startAcceptanceProcess,
} from "./acceptance-process.mjs";
import {
  buildFixtureProgram,
  classifyChildState,
  DEFAULT_FIXTURE_DEADLINE_MS,
  evaluateCleanupProof,
  probeExitObserver,
  startControlServer,
  startExitObserver,
} from "./live-child-crash-fixture.mjs";

if (process.platform === "win32") {
  console.error(
    "accept-live-child-crash: Windows is not accepted " +
      "(drogond does not support it); refusing instead of claiming a cross-platform PASS.",
  );
  process.exit(2);
}

const root = fileURLToPath(new URL("..", import.meta.url));
const observerScript = fileURLToPath(
  new URL("./live-child-exit-observer.py", import.meta.url),
);
const suffix = process.platform === "win32" ? ".exe" : "";
const daemonPath = path.join(root, "target", "debug", `drogond${suffix}`);
const cliPath = path.join(root, "target", "debug", `drogon-cli${suffix}`);
await Promise.all([access(daemonPath), access(cliPath)]);

const fixture = await mkdtemp(path.join(tmpdir(), "dg-live-crash-"));
const dataDir = path.join(fixture, "data");
const workspacePath = path.join(fixture, "folder");
const controlPath = path.join(fixture, "control.sock");
await mkdir(workspacePath);
// The nonce is handshake-only: it is embedded in the fixture argv (never in
// env, which drogond strips), and it is never written to the report.
const nonce = randomBytes(32).toString("hex");

const report = {
  startedAt: new Date().toISOString(),
  platform: process.platform,
  binarySha256: {
    daemon: createHash("sha256")
      .update(await readFile(daemonPath))
      .digest("hex"),
    cli: createHash("sha256")
      .update(await readFile(cliPath))
      .digest("hex"),
  },
  status: "FAILED",
  checks: [],
  cleanup: [],
  // Honest open item: no allowed fault seam can leave a request row pending
  // at kill time without fabricating journals, so pending-receipt recovery
  // is asserted nowhere here. See live-child-crash-admission.md.
  pendingReceiptRecovery: "not-closed-no-fault-seam",
};

let control;
let observer = null;
let daemon;
let daemonError;
let failure;
let fixtureInstanceId = null;
const reportDir = path.join(root, ".preflight", "acceptance");

function startDaemon() {
  daemonError = undefined;
  daemon = startAcceptanceProcess(daemonPath, ["--data-dir", dataDir], {
    cwd: root,
    stdio: ["ignore", "ignore", "ignore"],
    env: {
      ...process.env,
      // If session children ever inherit ORCA_* control context again, the
      // fixture child reports envLeaked > 0 through its hello.
      ORCA_ACCEPTANCE_SENTINEL: "must-not-reach-new-runtime-children",
    },
  });
  daemon.on("error", (error) => {
    daemonError = error;
  });
}

/** Authoritative exit observation for an owned ChildProcess handle. */
function waitExitEvent(child, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null)
      return resolve({ code: child.exitCode, signal: child.signalCode });
    const onExit = (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    };
    const timer = setTimeout(() => {
      child.removeListener("exit", onExit);
      reject(new Error(`${label} did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    child.once("exit", onExit);
  });
}

async function cli(args) {
  const { stdout } = await runAcceptanceProcess(
    cliPath,
    ["--data-dir", dataDir, "--json", ...args],
    { cwd: root },
  );
  return JSON.parse(stdout);
}

async function rpc(method, params = {}, requestId = randomUUID()) {
  const response = await cli([
    "rpc",
    method,
    "--params",
    JSON.stringify(params),
    "--request-id",
    requestId,
  ]);
  assert.equal(response.ok, true);
  assert.equal(response.requestId, requestId);
  return response.result;
}

async function eventually(action, predicate, label, timeout = 8000) {
  const until = Date.now() + timeout;
  let lastError;
  do {
    try {
      const result = await action();
      if (predicate(result)) return result;
    } catch (error) {
      lastError = error;
    }
    await delay(75);
  } while (Date.now() < until);
  throw new Error(
    `${label} did not settle${lastError ? `: ${lastError.message}` : ""}`,
  );
}

async function expectsRpcError(method, params, code, requestId = randomUUID()) {
  let response;
  try {
    await cli([
      "rpc",
      method,
      "--params",
      JSON.stringify(params),
      "--request-id",
      requestId,
    ]);
    assert.fail(`Expected ${code}`);
  } catch (error) {
    assert.equal(
      error.code,
      1,
      `Expected CLI operation exit code 1, received ${error.code}`,
    );
    response = JSON.parse(error.stdout);
  }
  assert.equal(response.ok, false);
  assert.equal(response.error.code, code);
}

try {
  control = await startControlServer({ controlPath, nonce });
  // Capability-probe the kernel exit observer up front. If unsupported, the
  // run continues but exit/cleanup claims degrade to unverifiable below.
  report.exitObservation = await probeExitObserver(observerScript);
  if (report.exitObservation.supported) {
    report.checks.push(
      `exit-observer-capability-probed (${report.exitObservation.mode})`,
    );
  } else {
    report.checks.push("exit-observer-capability-unavailable");
  }

  startDaemon();
  await eventually(
    () => cli(["status"]),
    (value) => value.ok === true,
    "Service startup",
  );
  if (daemonError) throw daemonError;
  const initialStatus = (await cli(["status"])).result;
  const initialToken = await readFile(path.join(dataDir, "auth.token"));
  report.checks.push("daemon-start-and-cli-status");

  const addResponse = await cli([
    "workspace",
    "add",
    workspacePath,
    "--name",
    "Live crash folder",
  ]);
  assert.equal(addResponse.ok, true);
  const workspace = addResponse.result;
  assert.equal(workspace.kind, "folder");
  assert.equal(workspace.path, await realpath(workspacePath));
  report.checks.push("folder-workspace-registration");

  // Live PTY fixture child: started once through drogond, observable forever
  // through the private control channel — no PID search or signal anywhere.
  const fixtureProgram = buildFixtureProgram({ controlPath, nonce });
  const startParams = {
    workspaceId: workspace.id,
    command: process.execPath,
    args: ["-e", fixtureProgram],
    cols: 80,
    rows: 24,
  };
  const startRequestId = randomUUID();
  const session = await rpc("session.start", startParams, startRequestId);
  assert.equal(session.verdict, "live");
  const identity = { sessionId: session.id, incarnation: session.incarnation };

  const hello = await control.waitForHello(8000);
  fixtureInstanceId = hello.instanceId;
  // R7-C sets four session-safe DROGON_* vars fresh on every session child
  // (DROGON_DATA_DIR/WORKSPACE_ID/SESSION_ID/TERMINAL -- see
  // session_env_assignments in crates/drogon-core/src/session_env.rs), so a
  // stripped grandchild still reports 4. The strip proof is that nothing
  // ELSE control-plane remains: no ORCA_* and not ORCA_ACCEPTANCE_SENTINEL.
  assert.equal(
    hello.envLeaked,
    4,
    "Daemon must strip control-plane env from the real grandchild (only the four session-safe DROGON_* may remain)",
  );
  assert.equal(
    control.children.size,
    1,
    "Exactly one fixture child must ever hold the control channel",
  );
  report.checks.push("fixture-nonce-handshake-and-env-strip");

  // Start evidence, channel 1: the daemon's own PTY read path saw READY.
  await eventually(
    () => rpc("session.read", { ...identity, cursor: 0 }),
    (value) =>
      Buffer.from(value.dataBase64, "base64").toString().includes("READY"),
    "Fixture READY through drogon session.read",
  );
  // Start evidence, channel 2 (independent of drogon): control ping/pong.
  assert.equal(await control.ping(fixtureInstanceId, 2000), true);

  // Acquire the kernel exit handle BEFORE the crash: the child must be
  // provably alive on the authenticated channel first, and a fresh pong
  // after registration pins the observed identity to this exact process.
  if (report.exitObservation.supported) {
    observer = await startExitObserver(hello.pid, {
      scriptPath: observerScript,
      // Outlive the fixture's own self-shutdown deadline with margin.
      deadlineMs: DEFAULT_FIXTURE_DEADLINE_MS + 90_000,
    });
    assert.equal(
      await control.ping(fixtureInstanceId, 2000),
      true,
      "Fixture must answer after kernel-observer registration (identity pin)",
    );
    report.checks.push("kernel-exit-handle-acquired-pre-crash");
  }
  report.checks.push("fixture-live-evidence-on-both-channels");

  // Pre-crash incarnation discipline plus cross-channel proof that writes and
  // resizes physically reach the child.
  const payload = `payload-${randomUUID()}`;
  const sent = await cli([
    "terminal",
    "send",
    "--session",
    session.id,
    "--incarnation",
    session.incarnation,
    "--text",
    payload + "\n",
  ]);
  assert.equal(sent.ok, true);
  const expectedAck = Buffer.from(payload + "\n").toString("base64");
  await eventually(
    async () =>
      (await control.ping(fixtureInstanceId, 500)) &&
      control.children.get(fixtureInstanceId).acks.includes(expectedAck),
    Boolean,
    "session.write bytes acknowledged by the fixture child",
  );
  const resized = await rpc("session.resize", {
    ...identity,
    cols: 100,
    rows: 32,
  });
  assert.equal(resized.cols, 100);
  assert.equal(resized.rows, 32);
  await eventually(
    () => {
      const record = control.children.get(fixtureInstanceId);
      return record.events.some(
        (event) =>
          event.name === "sigwinch" && event.cols === 100 && event.rows === 32,
      );
    },
    Boolean,
    "Resize delivered to the fixture child (SIGWINCH 100x32)",
  );
  await expectsRpcError(
    "session.read",
    {
      ...identity,
      incarnation: randomUUID(),
      cursor: 0,
    },
    "stale_incarnation",
  );
  assert.equal(
    (await rpc("session.read", { ...identity, cursor: 0 })).session.verdict,
    "live",
  );
  assert.equal(await control.ping(fixtureInstanceId, 2000), true);
  report.checks.push("pre-crash-write-resize-and-incarnation-discipline");

  // Crash the owned daemon through its exact handle; the exit event is the
  // authoritative death observation (the watchdog only bounds the wait).
  assert.equal(daemon.exitCode, null);
  assert.equal(daemon.signalCode, null);
  assert.equal(
    await control.ping(fixtureInstanceId, 2000),
    true,
    "Fixture provably live before daemon death",
  );
  assert.ok(
    daemon.kill("SIGKILL"),
    "SIGKILL must reach the owned daemon handle",
  );
  const daemonDeath = await waitExitEvent(daemon, 5000, "Crashed daemon");
  assert.equal(daemonDeath.signal, "SIGKILL");
  assert.equal(daemonDeath.code, null);
  report.cleanup.push({
    service: "exited",
    reason: "intentional-sigkill-fixture",
  });
  report.checks.push("daemon-death-authoritative-exit-observation");

  // Post-death child verdict: control pong proves liveness; the kernel
  // observer proves exit; control loss alone proves neither. A bare timer
  // never classifies anything.
  const classification = await classifyChildState({
    control,
    observer,
    instanceId: fixtureInstanceId,
    windowMs: 6000,
  });
  report.childObservation = {
    classification: classification.state,
    reason: classification.reason,
    kernelExitAt: classification.kernelExitAt,
    lastPongAt: classification.lastPongAt,
    controlLostAt: classification.controlLostAt,
    sighupDelivered:
      control.children
        .get(fixtureInstanceId)
        ?.events.some((event) => event.name === "sighup") ?? null,
    observerMode: report.exitObservation.supported
      ? report.exitObservation.mode
      : "unavailable",
    platform: process.platform,
    note:
      "Survival after daemon death is host behavior, not a product guarantee; " +
      "control close is control loss, never exit; the kernel observer (if " +
      "available) is the exit authority. The drogon assertions below hold " +
      "for every observed outcome.",
  };
  assert.notEqual(
    classification.state,
    "unverifiable",
    `Post-death child state must be observed: ${classification.reason}`,
  );
  report.checks.push("post-death-child-state-kernel-and-control");

  // Restart: same owned data directory, renewed service instance and auth.
  startDaemon();
  const restarted = await eventually(
    () => cli(["status"]),
    (value) => value.ok,
    "Service restart",
  );
  if (daemonError) throw daemonError;
  const restartedStatus = restarted.result;
  assert.equal(
    restartedStatus.hostId,
    initialStatus.hostId,
    "Host identity must be stable",
  );
  assert.notEqual(
    restartedStatus.serviceInstanceId,
    initialStatus.serviceInstanceId,
    "Service instance must be renewed",
  );
  const restartedToken = await readFile(path.join(dataDir, "auth.token"));
  assert.ok(
    !restartedToken.equals(initialToken),
    "Restart must rotate authentication",
  );
  report.checks.push("restart-stable-host-renewed-instance-and-auth");

  // The prior-live row: unverifiable, never invented exited, identity stable.
  const rows = (await rpc("session.list")).sessions;
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.id, session.id);
  assert.equal(row.incarnation, session.incarnation);
  assert.equal(row.hostId, initialStatus.hostId);
  assert.equal(row.verdict, "unverifiable");
  assert.equal(row.exitCode, null);
  report.currentRow = {
    sessionId: row.id,
    incarnation: row.incarnation,
    verdict: row.verdict,
    exitCode: row.exitCode,
    label: "current-row-after-restart",
  };
  report.checks.push("prior-live-row-unverifiable-never-exited");

  // Correct vs incorrect incarnation behavior against the recovered row.
  await expectsRpcError(
    "session.read",
    { ...identity, cursor: 0 },
    "unverifiable",
  );
  await expectsRpcError(
    "session.write",
    {
      ...identity,
      dataBase64: Buffer.from("late-write").toString("base64"),
    },
    "unverifiable",
  );
  await expectsRpcError(
    "session.resize",
    {
      ...identity,
      cols: 90,
      rows: 25,
    },
    "unverifiable",
  );
  const stopped = await rpc("session.stop", identity);
  assert.equal(stopped.verdict, "unverifiable");
  const wrongIncarnation = { ...identity, incarnation: randomUUID() };
  await expectsRpcError(
    "session.read",
    { ...wrongIncarnation, cursor: 0 },
    "stale_incarnation",
  );
  await expectsRpcError("session.stop", wrongIncarnation, "stale_incarnation");
  await expectsRpcError(
    "session.read",
    {
      sessionId: randomUUID(),
      incarnation: randomUUID(),
      cursor: 0,
    },
    "not_found",
  );
  report.checks.push("recovered-session-correct-and-incorrect-incarnation");

  // Replay the original start request. The WHOLE historic response must come
  // back verbatim (deep equality, not three sampled fields).
  const replay = await rpc("session.start", startParams, startRequestId);
  assert.deepEqual(
    replay,
    session,
    "Replay must return the whole historic admission response",
  );
  report.historicReceipt = {
    sessionId: replay.id,
    verdict: replay.verdict,
    wholeResponseDeepEqual: true,
    label: "historic-admission-receipt",
  };
  report.checks.push("historic-receipt-replay-whole-response");

  // No-respawn proof, separated by authority:
  //  - product-side (deterministic): the daemon answered the replay from its
  //    durable ledger and created no second session row;
  //  - fixture-side (bounded settle): a respawned child would have to
  //    complete the nonce handshake on the control channel; give that async
  //    connect a bounded window and then require exactly one child ever.
  assert.equal((await rpc("session.list")).sessions.length, 1);
  const handshakesBeforeSettle = control.children.size;
  await delay(500);
  report.noRespawn = {
    productSessionRows: 1,
    fixtureChildHandshakes: control.children.size,
    settleWindowMs: 500,
    fixtureProof: "bounded-settle-corroboration",
  };
  assert.equal(
    control.children.size,
    handshakesBeforeSettle,
    "No additional fixture handshake during the post-replay settle window",
  );
  assert.equal(
    control.children.size,
    1,
    "Replaying the cached start receipt must not spawn another child",
  );
  report.checks.push("no-respawn-rows-and-single-fixture-child");

  // The restarted daemon must be a fully functional owner of the directory.
  const fast = await rpc("session.start", {
    workspaceId: workspace.id,
    command: process.execPath,
    args: ["-e", "process.exitCode=7"],
    cols: 80,
    rows: 24,
  });
  await eventually(
    () => rpc("session.list", { workspaceId: workspace.id }),
    ({ sessions: items }) =>
      items.some(
        (item) =>
          item.id === fast.id &&
          item.verdict === "exited" &&
          item.exitCode === 7,
      ),
    "Restarted daemon observes and persists a real child exit",
  );
  assert.equal(
    (
      await rpc("session.stop", {
        sessionId: fast.id,
        incarnation: fast.incarnation,
      })
    ).verdict,
    "exited",
  );
  report.checks.push("restarted-daemon-owns-directory");

  report.status = "PASSED";
} catch (error) {
  failure = error;
  report.error = error.message;
} finally {
  // Fixture child cleanup. The child pid is NEVER signaled; exit proof comes
  // from the kernel observer (authoritative) combined with the control
  // channel (orderly shutdown), or the run degrades to unverifiable and the
  // fixture is retained.
  const record = fixtureInstanceId
    ? control?.children.get(fixtureInstanceId)
    : null;
  if (control && fixtureInstanceId) {
    if (!record) {
      report.cleanup.push({
        fixtureChild: "unverifiable",
        reason: "no-authenticated-record",
      });
      report.status = "FAILED";
    } else if (record.closed) {
      // Control already lost pre-cleanup: only the kernel observer can
      // prove the eventual exit (within its deadline margin).
      report.cleanup.push({ fixtureChildControl: "already-lost" });
    } else {
      control.requestShutdown(fixtureInstanceId, 0);
      const closed = await control.waitClosed(fixtureInstanceId, 5000);
      report.cleanup.push({
        fixtureChildControl: closed.closed
          ? `closed (${record.bye?.reason ?? "control-close-observed"})`
          : "unverifiable",
      });
    }
  }
  if (observer) {
    if (observer.result?.type === "exit") {
      report.cleanup.push({
        fixtureChildKernel: "exited (kernel-observed)",
        kernelExitAt: observer.result.at,
      });
    } else if (record && !record.closed && observer.result?.type !== "exit") {
      // The child was still manageable (or control-lost) and no kernel exit
      // has been seen yet: the child's own self-shutdown deadline bounds the
      // rest; wait for the kernel observation within that margin.
      const kernel = await observer.waitExit(20_000);
      report.cleanup.push({
        fixtureChildKernel:
          kernel === "exit"
            ? "exited (kernel-observed)"
            : `unverifiable (kernel: ${kernel})`,
      });
      if (kernel !== "exit") report.status = "FAILED";
    } else if (record && record.closed) {
      // Control was already lost pre-cleanup: the child still lives (its own
      // self-shutdown deadline bounds it) — wait out that deadline so the
      // kernel observer, not a timer or a signal, proves the eventual exit.
      const kernel = await observer.waitExit(
        DEFAULT_FIXTURE_DEADLINE_MS + 10_000,
      );
      report.cleanup.push({
        fixtureChildKernel:
          kernel === "exit"
            ? "exited (kernel-observed)"
            : `unverifiable (kernel: ${kernel})`,
      });
      if (kernel !== "exit") report.status = "FAILED";
    }
    const stopped = await observer.stop(3000);
    report.cleanup.push({
      observerStop: stopped.via,
      observerStopped: stopped.stopped,
      observerForced: stopped.forced,
    });
    if (!stopped.stopped) report.status = "FAILED";
  } else {
    report.cleanup.push({
      fixtureChildKernel: "unverifiable (no kernel observer on this host)",
    });
    report.status = "FAILED";
  }
  if (
    daemon &&
    daemon.pid &&
    daemon.exitCode === null &&
    daemon.signalCode === null
  ) {
    try {
      daemon.kill("SIGTERM");
      const death = await waitExitEvent(daemon, 5000, "Final daemon");
      report.cleanup.push({
        service: `exited (${death.signal ?? `code ${death.code}`})`,
      });
    } catch {
      try {
        daemon.kill("SIGKILL");
        await waitExitEvent(daemon, 2000, "Final daemon SIGKILL");
      } catch {
        report.status = "FAILED";
      }
      report.cleanup.push({ service: "forced-exit-after-timeout" });
    }
  }
  const serviceExited =
    !daemon?.pid || daemon.exitCode !== null || daemon.signalCode !== null;
  if (!serviceExited) report.status = "FAILED";
  if (control) {
    const proof = await control.close(3000);
    report.cleanup.push({ controlCloseProof: proof });
  }
  // Pure verdict (unit-tested): forced observer/daemon cleanup, unverifiable
  // proofs, or untracked sockets fail the run — never PASSED-with-retained.
  const verdict = evaluateCleanupProof(report.cleanup);
  if (!verdict.proven) report.status = "FAILED";
  if (verdict.proven && report.status === "PASSED") {
    await rm(fixture, { recursive: true });
    report.cleanup.push({ fixture: "removed" });
  } else {
    report.cleanup.push({ fixture: "retained", path: fixture });
  }
  report.finishedAt = new Date().toISOString();
  await mkdir(reportDir, { recursive: true });
  const output = path.join(
    reportDir,
    `live-child-crash-${Date.now()}-${randomUUID()}.json`,
  );
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify({
      status: report.status,
      checks: report.checks,
      childObservation: report.childObservation ?? null,
      cleanup: report.cleanup,
      report: output,
    }),
  );
}
if (failure) console.error(failure.message);
if (report.status !== "PASSED") process.exitCode = 1;
