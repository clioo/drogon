// Harness-side handle for packaged-fixture cleanup. Identity comes from the
// service's own authenticated `status` reply, never from PID inspection;
// `processId` only correlates the kernel exit observer and is never signalled.

import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { runAcceptanceProcess } from "./acceptance-process.mjs";
import { startExitObserver } from "./live-child-crash-fixture.mjs";

export const QUIESCENT_SHUTDOWN_CAPABILITY = "runtime.quiescent-shutdown.v1";

const OBSERVER_SCRIPT = fileURLToPath(
  new URL("./live-child-exit-observer.py", import.meta.url),
);

const DEFAULT_OBSERVER_DEADLINE_MS = 20_000;
const DEFAULT_EXIT_WAIT_MS = 15_000;
const DEFAULT_OBSERVER_STOP_MS = 3000;

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

// Single gate for every status read: missing capability or a non-safe
// processId fails closed with no PID-signal fallback.
function requireQuiescentIdentity(status) {
  assert.ok(status && typeof status === "object", "status must be an object");
  assert.ok(
    nonEmptyString(status.hostId),
    "status.hostId must be a nonempty string",
  );
  assert.ok(
    nonEmptyString(status.serviceInstanceId),
    "status.serviceInstanceId must be a nonempty string",
  );
  assert.ok(
    Array.isArray(status.capabilities) &&
      status.capabilities.includes(QUIESCENT_SHUTDOWN_CAPABILITY),
    `quiescent shutdown capability ${QUIESCENT_SHUTDOWN_CAPABILITY} missing; refusing PID-signal fallback`,
  );
  assert.ok(
    Number.isSafeInteger(status.processId) && status.processId > 0,
    "status.processId must be a positive safe integer (observer correlation only)",
  );
  return {
    hostId: status.hostId,
    serviceInstanceId: status.serviceInstanceId,
    processId: status.processId,
  };
}

function assertSameFixture(seen, owned, stage) {
  assert.deepEqual(
    seen,
    owned,
    `${stage}: fixture identity changed; refusing cleanup`,
  );
}

function requireAcceptedShutdown(reply, owned) {
  assert.ok(reply && typeof reply === "object", "runtime.shutdown must reply");
  assert.equal(reply.hostId, owned.hostId, "shutdown reply host mismatch");
  assert.equal(
    reply.serviceInstanceId,
    owned.serviceInstanceId,
    "shutdown reply service identity mismatch",
  );
  assert.equal(reply.accepted, true, "runtime.shutdown was not accepted");
}

// Seamed twin of `packagedFixtureDaemon` for deterministic unit flow evidence
// (injected rpc/observer). Unit-only: native proof needs the real service and
// the real kernel observer.
export function createFixtureDaemonWithSeams({
  binary,
  cli,
  dataDir,
  rpcImpl,
  observerImpl,
  observerScriptPath = OBSERVER_SCRIPT,
  observerDeadlineMs = DEFAULT_OBSERVER_DEADLINE_MS,
  exitWaitMs = DEFAULT_EXIT_WAIT_MS,
  observerStopMs = DEFAULT_OBSERVER_STOP_MS,
}) {
  void binary;
  void cli;
  void dataDir;
  let owned = null;

  async function statusIdentity() {
    return requireQuiescentIdentity(await rpcImpl("status"));
  }

  async function capture() {
    const next = await statusIdentity();
    // A second capture that observes a restart must not hand this handle to a
    // different service; same-identity recapture stays allowed.
    if (owned) assertSameFixture(next, owned, "Recapture refused");
    owned = next;
    return owned.processId;
  }

  function identity() {
    return owned ? { ...owned } : null;
  }

  async function stopOwnedSessions() {
    const { workspaces } = await rpcImpl("workspace.list");
    assert.ok(Array.isArray(workspaces), "workspace.list must return an array");
    for (const workspace of workspaces) {
      const { sessions } = await rpcImpl("session.list", {
        workspaceId: workspace.id,
      });
      assert.ok(Array.isArray(sessions), "session.list must return an array");
      for (const session of sessions) {
        if (session.verdict === "exited") continue;
        assert.equal(
          session.hostId,
          owned.hostId,
          "Refusing cleanup with a foreign-host session present",
        );
        assert.equal(
          session.verdict,
          "live",
          "Do not act on an unverifiable/recovered session; retaining fixture",
        );
        assert.ok(nonEmptyString(session.id), "session.id must be nonempty");
        assert.ok(
          nonEmptyString(session.incarnation),
          "session.incarnation must be nonempty",
        );
        const stopped = await rpcImpl("session.stop", {
          sessionId: session.id,
          incarnation: session.incarnation,
        });
        // The producer returns the full Session row, so the reply must echo
        // the requested host/incarnation/id — not just any exited session.
        assert.equal(stopped.id, session.id, "session.stop id mismatch");
        assert.equal(
          stopped.hostId,
          session.hostId,
          "session.stop host mismatch",
        );
        assert.equal(
          stopped.incarnation,
          session.incarnation,
          "session.stop incarnation mismatch",
        );
        assert.equal(
          stopped.verdict,
          "exited",
          "Do not shut down a fixture daemon with unverified sessions",
        );
      }
    }
  }

  async function stop() {
    if (!owned) await capture();
    assertSameFixture(
      await statusIdentity(),
      owned,
      "Fixture ownership changed before cleanup",
    );
    await stopOwnedSessions();
    // Observer readiness pins the process against pid reuse, so the post-ready
    // reconfirm below is what makes the shutdown fenced.
    let observer;
    try {
      observer = await observerImpl(owned.processId, {
        scriptPath: observerScriptPath,
        deadlineMs: observerDeadlineMs,
      });
    } catch (error) {
      throw new Error(
        `exit observer did not become ready: ${error.message}; retaining fixture`,
      );
    }
    assert.ok(
      observer && typeof observer.waitExit === "function",
      "exit observer must expose waitExit",
    );
    // Promise-cached so a throwing stop is still invoked exactly once.
    let cleanupPromise = null;
    const cleanObserver = () => {
      cleanupPromise ??= (async () => {
        const result = await observer.stop(observerStopMs);
        assert.ok(
          result && result.stopped === true && result.forced === false,
          `owned exit observer cleanup ${result?.via ?? "unknown"} cannot count as PASS; retaining fixture`,
        );
        return result;
      })();
      return cleanupPromise;
    };
    try {
      assertSameFixture(
        await statusIdentity(),
        owned,
        "Fixture identity changed after observer readiness",
      );
      const reply = await rpcImpl("runtime.shutdown", {
        hostId: owned.hostId,
        serviceInstanceId: owned.serviceInstanceId,
      });
      requireAcceptedShutdown(reply, owned);
      // The daemon self-exits after the reply, whose delivery is uncertain;
      // only a kernel `exit` proves it.
      const observed = await observer.waitExit(exitWaitMs);
      assert.equal(
        observed,
        "exit",
        `Fixture daemon exit unverifiable (kernel observer: ${observed}); retaining fixture`,
      );
      await cleanObserver();
    } catch (error) {
      try {
        await cleanObserver();
      } catch (cleanupError) {
        // cleanObserver replays the same cached failure without re-invoking
        // stop when the try block already attempted cleanup.
        if (cleanupError !== error)
          throw new Error(
            `${error.message}; owned observer cleanup also failed: ${cleanupError.message}`,
          );
      }
      throw error;
    }
  }

  return { rpc: rpcImpl, capture, stop, identity };
}

// Production entry point (signature used by accept-desktop): real CLI RPC plus
// the real kernel observer. `binary` stays for signature stability; ownership
// is the authenticated status identity, never argv/ps matching.
export function packagedFixtureDaemon(binary, cli, dataDir) {
  async function rpc(method, params = {}) {
    const response = JSON.parse(
      (
        await runAcceptanceProcess(cli, [
          "--data-dir",
          dataDir,
          "--json",
          "rpc",
          method,
          "--params",
          JSON.stringify(params),
        ])
      ).stdout,
    );
    assert.equal(response.ok, true);
    return response.result;
  }
  async function startObserver(pid, { scriptPath, deadlineMs }) {
    return startExitObserver(pid, {
      scriptPath,
      deadlineMs,
    });
  }
  const seamed = createFixtureDaemonWithSeams({
    binary,
    cli,
    dataDir,
    rpcImpl: rpc,
    observerImpl: startObserver,
  });
  return {
    rpc,
    capture: () => seamed.capture(),
    stop: () => seamed.stop(),
    identity: () => seamed.identity(),
  };
}
