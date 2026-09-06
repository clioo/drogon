// Tests for the authenticated quiescent-shutdown fixture cleanup contract.
//
// Harness-only unit evidence (no user daemon, no packaged install): a fake CLI
// rpc plus a fake kernel observer drive the seamed factory. These prove the
// control flow refuses every unsafe path and performs the exact fenced order.
// They are NOT native runtime proof of an actual daemon shutdown; root performs
// that after the native `status.processId` + `runtime.shutdown` merge.
//
// RED history, stated honestly: the first run against the pre-contract
// factory failed at import (missing named exports) — a preparation failure,
// not behavioral RED. Real assertion RED for each defect below was reproduced
// against the running contract implementation before fixing it.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  QUIESCENT_SHUTDOWN_CAPABILITY,
  createFixtureDaemonWithSeams,
  packagedFixtureDaemon,
} from "./packaged-fixture-daemon.mjs";

const SELF = fileURLToPath(
  new URL("./packaged-fixture-daemon.mjs", import.meta.url),
);

const OWNED = {
  hostId: "host-1",
  serviceInstanceId: "svc-1",
  protocol: 1,
  capabilities: [QUIESCENT_SHUTDOWN_CAPABILITY, "workspace.v1"],
  version: "0.1.0",
  processId: 4242,
};

function statusResult(overrides = {}) {
  return { ...OWNED, ...overrides };
}

// Fail the test if anything ever signals a discovered PID: the new contract
// has no process.kill path at all.
function guardNoPidSignal(t) {
  const kill = process.kill;
  process.kill = () => {
    throw new Error(
      "process.kill must never be used by the quiescent contract",
    );
  };
  t.after(() => {
    process.kill = kill;
  });
}

function fakeObserverScript({
  waitExitResult = "exit",
  stopResult = null,
} = {}) {
  const calls = [];
  return {
    calls,
    start: async (pid, options = {}) => {
      calls.push({ op: "start", pid, options });
      return {
        waitExit: async (timeoutMs) => {
          calls.push({ op: "waitExit", timeoutMs });
          return waitExitResult;
        },
        stop: async (timeoutMs) => {
          calls.push({ op: "stop", timeoutMs });
          return (
            stopResult ?? {
              stopped: true,
              forced: false,
              via: "exit-event",
              observerExit: { code: 0, signal: null },
            }
          );
        },
      };
    },
  };
}

function makeRpc(scenarios) {
  const calls = [];
  const rpc = async (method, params = {}) => {
    calls.push({ method, params });
    const handler = scenarios[method];
    if (typeof handler === "function") return handler(params, calls);
    if (handler !== undefined) return handler;
    throw Object.assign(new Error(`unexpected rpc ${method}`), {
      code: "method_not_found",
    });
  };
  return { calls, rpc };
}

function daemonWith({ rpc, observer, overrides = {} }) {
  return createFixtureDaemonWithSeams({
    binary: "/pkg/drogond",
    cli: "/pkg/drogon-cli",
    dataDir: "/tmp/dg-fixture-data",
    rpcImpl: rpc,
    observerImpl: observer.start,
    observerScriptPath: "/pkg/live-child-exit-observer.py",
    ...overrides,
  });
}

function liveSession(overrides = {}) {
  return {
    id: "sess-1",
    workspaceId: "ws-1",
    hostId: OWNED.hostId,
    incarnation: "inc-1",
    command: "sh",
    args: [],
    cols: 80,
    rows: 24,
    verdict: "live",
    exitCode: null,
    createdAt: "2026-09-06T12:00:00Z",
    ...overrides,
  };
}

test("contract identifiers: public signature preserved plus one narrow seam helper", () => {
  assert.equal(typeof packagedFixtureDaemon, "function");
  assert.equal(packagedFixtureDaemon.length, 3);
  assert.equal(QUIESCENT_SHUTDOWN_CAPABILITY, "runtime.quiescent-shutdown.v1");
  assert.equal(typeof createFixtureDaemonWithSeams, "function");
  const probe = createFixtureDaemonWithSeams({
    binary: "b",
    cli: "c",
    dataDir: "d",
    rpcImpl: async () => ({}),
    observerImpl: async () => ({}),
  });
  assert.equal(typeof probe.rpc, "function");
  assert.equal(typeof probe.capture, "function");
  assert.equal(typeof probe.stop, "function");
});

test("implementation contains no raw PID discovery or signalling path", async (t) => {
  guardNoPidSignal(t);
  const source = await readFile(SELF, "utf8");
  assert.ok(!source.includes("lsof"), "must not shell to lsof");
  assert.ok(!source.includes("/bin/ps"), "must not shell to ps");
  assert.ok(!source.includes("process.kill"), "must never signal a PID");
});

test("capture stores the exact authenticated host/service/process identity", async () => {
  const { rpc } = makeRpc({ status: statusResult() });
  const observer = fakeObserverScript();
  const daemon = daemonWith({ rpc, observer });
  const pid = await daemon.capture();
  assert.equal(pid, OWNED.processId);
  assert.deepEqual(daemon.identity(), {
    hostId: OWNED.hostId,
    serviceInstanceId: OWNED.serviceInstanceId,
    processId: OWNED.processId,
  });
});

test("capture fails closed when the quiescent capability is missing", async () => {
  const { rpc } = makeRpc({
    status: statusResult({ capabilities: ["workspace.v1"] }),
  });
  const observer = fakeObserverScript();
  const daemon = daemonWith({ rpc, observer });
  await assert.rejects(daemon.capture(), /capability/);
});

test("capture refuses a non-positive processId (correlation only, never a signal target)", async () => {
  for (const processId of [0, -7, 1.5, "4242", null, undefined]) {
    const { rpc } = makeRpc({ status: statusResult({ processId }) });
    const observer = fakeObserverScript();
    const daemon = daemonWith({ rpc, observer });
    await assert.rejects(
      daemon.capture(),
      /processId/,
      `pid ${String(processId)}`,
    );
  }
});

test("stop refuses a stale capture: pre-cleanup identity changed", async (t) => {
  guardNoPidSignal(t);
  let statusCalls = 0;
  let shutdownCalls = 0;
  const { rpc } = makeRpc({
    status: () =>
      ++statusCalls === 1
        ? statusResult()
        : statusResult({ serviceInstanceId: "svc-2", processId: 9999 }),
    "workspace.list": { workspaces: [] },
    "runtime.shutdown": () => {
      shutdownCalls += 1;
      return { ...OWNED, accepted: true };
    },
  });
  const observer = fakeObserverScript();
  const daemon = daemonWith({ rpc, observer });
  await daemon.capture();
  await assert.rejects(daemon.stop(), /changed|stale|identity/);
  assert.equal(shutdownCalls, 0, "no shutdown on stale identity");
  assert.equal(
    observer.calls.filter((c) => c.op === "start").length,
    0,
    "no observer before identity reconfirm",
  );
});

test("stop performs the exact fenced order on success (one unified log)", async (t) => {
  guardNoPidSignal(t);
  const events = [];
  const session = liveSession();
  const base = makeRpc({
    status: () => statusResult(),
    "workspace.list": () => ({ workspaces: [{ id: "ws-1" }] }),
    "session.list": () => ({ sessions: [session] }),
    "session.stop": (params) => {
      assert.deepEqual(params, { sessionId: "sess-1", incarnation: "inc-1" });
      return { ...session, verdict: "exited", exitCode: 0 };
    },
    "runtime.shutdown": (params) => {
      assert.deepEqual(params, {
        hostId: OWNED.hostId,
        serviceInstanceId: OWNED.serviceInstanceId,
      });
      return {
        hostId: OWNED.hostId,
        serviceInstanceId: OWNED.serviceInstanceId,
        accepted: true,
      };
    },
  });
  const rpc = async (method, params) => {
    events.push(`rpc:${method}`);
    return base.rpc(method, params);
  };
  const observer = {
    start: async (pid) => {
      // The seam resolves start only once the observer is ready, so this
      // event IS the readiness point in the unified order.
      events.push(`observer:ready:${pid}`);
      assert.equal(pid, OWNED.processId);
      return {
        waitExit: async () => {
          events.push("observer:waitExit");
          return "exit";
        },
        stop: async () => {
          events.push("observer:stop");
          return { stopped: true, forced: false, via: "exit-event" };
        },
      };
    },
  };
  const daemon = daemonWith({ rpc, observer });
  await daemon.capture();
  events.length = 0; // capture's status is outside stop(); order below is stop() only
  await daemon.stop();
  assert.deepEqual(events, [
    "rpc:status",
    "rpc:workspace.list",
    "rpc:session.list",
    "rpc:session.stop",
    `observer:ready:${OWNED.processId}`,
    "rpc:status",
    "rpc:runtime.shutdown",
    "observer:waitExit",
    "observer:stop",
  ]);
});

test("stop reconfirms identity AFTER observer readiness; late change refuses shutdown", async (t) => {
  guardNoPidSignal(t);
  let statusCalls = 0;
  const shutdownCalls = [];
  const { rpc } = makeRpc({
    status: () => {
      statusCalls += 1;
      // capture + pre-cleanup agree; post-observer reconfirm rotates.
      if (statusCalls >= 3)
        return statusResult({
          serviceInstanceId: "svc-rotated",
          processId: 7777,
        });
      return statusResult();
    },
    "workspace.list": { workspaces: [] },
    "runtime.shutdown": (params) => {
      shutdownCalls.push(params);
      return { ...OWNED, accepted: true };
    },
  });
  const observerEvents = [];
  const observer = {
    start: async (pid) => {
      observerEvents.push(`start:${pid}`);
      return {
        waitExit: async () => {
          observerEvents.push("waitExit");
          return "exit";
        },
        stop: async () => {
          observerEvents.push("stop");
          return { stopped: true, forced: false, via: "stopped" };
        },
      };
    },
  };
  const daemon = daemonWith({ rpc, observer });
  await daemon.capture();
  await assert.rejects(daemon.stop(), /changed|stale|identity/);
  assert.equal(shutdownCalls.length, 0);
  assert.ok(observerEvents.includes(`start:${OWNED.processId}`));
  assert.ok(observerEvents.includes("stop"), "owned observer must be cleaned");
  assert.ok(!observerEvents.includes("waitExit"), "no exit wait after refusal");
});

test("stop fails closed on unsupported capability at cleanup (no PID fallback)", async (t) => {
  guardNoPidSignal(t);
  let n = 0;
  const { rpc } = makeRpc({
    status: () =>
      ++n === 1 ? statusResult() : statusResult({ capabilities: [] }),
    "workspace.list": { workspaces: [] },
    "runtime.shutdown": { ...OWNED, accepted: true },
  });
  const observer = fakeObserverScript();
  const daemon = daemonWith({ rpc, observer });
  await daemon.capture();
  await assert.rejects(daemon.stop(), /capability/);
  assert.equal(observer.calls.filter((c) => c.op === "start").length, 0);
});

test("stop treats a busy/refused shutdown as failure and retains evidence", async (t) => {
  guardNoPidSignal(t);
  const { rpc } = makeRpc({
    status: statusResult(),
    "workspace.list": { workspaces: [] },
    "runtime.shutdown": () => {
      throw Object.assign(new Error("service busy; retry later"), {
        code: "request_conflict",
      });
    },
  });
  const observer = fakeObserverScript();
  const daemon = daemonWith({ rpc, observer });
  await daemon.capture();
  await assert.rejects(daemon.stop(), /busy|request_conflict|shutdown/);
  assert.equal(
    observer.calls.filter((c) => c.op === "stop").length,
    1,
    "owned observer must be cleaned even on shutdown refusal",
  );
  assert.equal(observer.calls.find((c) => c.op === "stop") && true, true);
});

test("stop rejects accepted:false and malformed accepted identity", async (t) => {
  guardNoPidSignal(t);
  for (const [label, reply] of [
    ["accepted-false", { ...OWNED, accepted: false }],
    [
      "wrong-service",
      { hostId: OWNED.hostId, serviceInstanceId: "svc-evil", accepted: true },
    ],
    [
      "wrong-host",
      {
        hostId: "host-evil",
        serviceInstanceId: OWNED.serviceInstanceId,
        accepted: true,
      },
    ],
    [
      "missing-accepted",
      { hostId: OWNED.hostId, serviceInstanceId: OWNED.serviceInstanceId },
    ],
  ]) {
    const { rpc } = makeRpc({
      status: statusResult(),
      "workspace.list": { workspaces: [] },
      "runtime.shutdown": reply,
    });
    const observer = fakeObserverScript();
    const daemon = daemonWith({ rpc, observer });
    await daemon.capture();
    await assert.rejects(
      daemon.stop(),
      /shutdown|accepted|identity|match/,
      label,
    );
  }
});

test("observer readiness failure aborts before shutdown", async (t) => {
  guardNoPidSignal(t);
  let shutdown = 0;
  const { rpc } = makeRpc({
    status: statusResult(),
    "workspace.list": { workspaces: [] },
    "runtime.shutdown": () => {
      shutdown += 1;
      return { ...OWNED, accepted: true };
    },
  });
  const failingObserver = {
    start: async () => {
      throw new Error("exit observer did not become ready");
    },
  };
  const daemon = daemonWith({ rpc, observer: failingObserver });
  await daemon.capture();
  await assert.rejects(daemon.stop(), /observer.*ready/);
  assert.equal(shutdown, 0);
});

test("observer exit timeout / non-exit observation stays failure/unverifiable", async (t) => {
  guardNoPidSignal(t);
  for (const waitExitResult of [
    "timeout",
    "pending",
    "unsupported",
    "stopped",
  ]) {
    const { rpc } = makeRpc({
      status: statusResult(),
      "workspace.list": { workspaces: [] },
      "runtime.shutdown": { ...OWNED, accepted: true },
    });
    const observer = fakeObserverScript({ waitExitResult });
    const daemon = daemonWith({ rpc, observer });
    await daemon.capture();
    await assert.rejects(
      daemon.stop(),
      /exit|unverifiable|observer/,
      String(waitExitResult),
    );
    const stopCall = observer.calls.find((c) => c.op === "stop");
    assert.ok(stopCall, `observer cleaned on ${waitExitResult}`);
  }
});

test("forced or unknown observer cleanup can never count as PASS", async (t) => {
  guardNoPidSignal(t);
  for (const [label, stopResult] of [
    ["forced-sigkill", { stopped: true, forced: true, via: "sigkill" }],
    ["unstopped", { stopped: false, forced: false, via: "unverifiable" }],
  ]) {
    const { rpc } = makeRpc({
      status: statusResult(),
      "workspace.list": { workspaces: [] },
      "runtime.shutdown": { ...OWNED, accepted: true },
    });
    const observer = fakeObserverScript({ stopResult });
    const daemon = daemonWith({ rpc, observer });
    await daemon.capture();
    await assert.rejects(daemon.stop(), /observer|forced|unverifiable/, label);
  }
});

test("an unverifiable/recovered session is never acted on; cleanup fails instead", async (t) => {
  guardNoPidSignal(t);
  const stoppedCalls = [];
  const { rpc } = makeRpc({
    status: statusResult(),
    "workspace.list": { workspaces: [{ id: "ws-1" }] },
    "session.list": { sessions: [liveSession({ verdict: "unverifiable" })] },
    "session.stop": (params) => {
      stoppedCalls.push(params);
      return { verdict: "exited" };
    },
    "runtime.shutdown": { ...OWNED, accepted: true },
  });
  const observer = fakeObserverScript();
  const daemon = daemonWith({ rpc, observer });
  await daemon.capture();
  await assert.rejects(daemon.stop(), /unverifiable/);
  assert.equal(
    stoppedCalls.length,
    0,
    "never call session.stop on unverifiable",
  );
  assert.equal(observer.calls.filter((c) => c.op === "start").length, 0);
});

test("a foreign-host session refuses cleanup without session.stop", async (t) => {
  guardNoPidSignal(t);
  const stoppedCalls = [];
  const { rpc } = makeRpc({
    status: statusResult(),
    "workspace.list": { workspaces: [{ id: "ws-1" }] },
    "session.list": { sessions: [liveSession({ hostId: "host-other" })] },
    "session.stop": (params) => {
      stoppedCalls.push(params);
      return { verdict: "exited" };
    },
    "runtime.shutdown": { ...OWNED, accepted: true },
  });
  const observer = fakeObserverScript();
  const daemon = daemonWith({ rpc, observer });
  await daemon.capture();
  await assert.rejects(daemon.stop(), /foreign|host|identity/);
  assert.equal(stoppedCalls.length, 0);
});

test("a session.stop that does not prove exited fails the run", async (t) => {
  guardNoPidSignal(t);
  const { rpc } = makeRpc({
    status: statusResult(),
    "workspace.list": { workspaces: [{ id: "ws-1" }] },
    "session.list": { sessions: [liveSession()] },
    "session.stop": { ...liveSession(), verdict: "unverifiable" },
    "runtime.shutdown": { ...OWNED, accepted: true },
  });
  const observer = fakeObserverScript();
  const daemon = daemonWith({ rpc, observer });
  await daemon.capture();
  await assert.rejects(daemon.stop(), /exited|unverifiable/);
});

test("recapture with the same identity is allowed", async (t) => {
  guardNoPidSignal(t);
  const { rpc } = makeRpc({ status: statusResult() });
  const observer = fakeObserverScript();
  const daemon = daemonWith({ rpc, observer });
  assert.equal(await daemon.capture(), OWNED.processId);
  assert.equal(await daemon.capture(), OWNED.processId);
  assert.deepEqual(daemon.identity(), {
    hostId: OWNED.hostId,
    serviceInstanceId: OWNED.serviceInstanceId,
    processId: OWNED.processId,
  });
});

test("recapture cannot silently transfer ownership to a restarted fixture", async (t) => {
  guardNoPidSignal(t);
  let statusCalls = 0;
  const { rpc } = makeRpc({
    status: () =>
      ++statusCalls === 1
        ? statusResult()
        : statusResult({ serviceInstanceId: "svc-2", processId: 9999 }),
    "workspace.list": { workspaces: [] },
    "runtime.shutdown": { ...OWNED, accepted: true },
  });
  const observer = fakeObserverScript();
  const daemon = daemonWith({ rpc, observer });
  await daemon.capture();
  await assert.rejects(daemon.capture(), /changed|transfer|identity/);
  assert.deepEqual(daemon.identity(), {
    hostId: OWNED.hostId,
    serviceInstanceId: OWNED.serviceInstanceId,
    processId: OWNED.processId,
  });
});

test("a session.stop reply with a foreign hostId is refused", async (t) => {
  guardNoPidSignal(t);
  let shutdownCalls = 0;
  const { rpc } = makeRpc({
    status: statusResult(),
    "workspace.list": { workspaces: [{ id: "ws-1" }] },
    "session.list": { sessions: [liveSession()] },
    "session.stop": {
      ...liveSession(),
      hostId: "host-other",
      verdict: "exited",
    },
    "runtime.shutdown": () => {
      shutdownCalls += 1;
      return { ...OWNED, accepted: true };
    },
  });
  const observer = fakeObserverScript();
  const daemon = daemonWith({ rpc, observer });
  await daemon.capture();
  await assert.rejects(daemon.stop(), /host|identity|mismatch/);
  assert.equal(shutdownCalls, 0);
});

test("a session.stop reply with a rotated incarnation is refused", async (t) => {
  guardNoPidSignal(t);
  let shutdownCalls = 0;
  const { rpc } = makeRpc({
    status: statusResult(),
    "workspace.list": { workspaces: [{ id: "ws-1" }] },
    "session.list": { sessions: [liveSession()] },
    "session.stop": {
      ...liveSession(),
      incarnation: "inc-rotated",
      verdict: "exited",
    },
    "runtime.shutdown": () => {
      shutdownCalls += 1;
      return { ...OWNED, accepted: true };
    },
  });
  const observer = fakeObserverScript();
  const daemon = daemonWith({ rpc, observer });
  await daemon.capture();
  await assert.rejects(daemon.stop(), /incarnation|identity|mismatch/);
  assert.equal(shutdownCalls, 0);
});

test("an observer.stop that throws is invoked exactly once and retains failure", async (t) => {
  guardNoPidSignal(t);
  let stopCalls = 0;
  const { rpc } = makeRpc({
    status: statusResult(),
    "workspace.list": { workspaces: [] },
    "runtime.shutdown": { ...OWNED, accepted: true },
  });
  const observer = {
    start: async () => ({
      waitExit: async () => "exit",
      stop: async () => {
        stopCalls += 1;
        throw new Error("observer teardown exploded");
      },
    }),
  };
  const daemon = daemonWith({ rpc, observer });
  await daemon.capture();
  await assert.rejects(daemon.stop(), /observer teardown exploded/);
  assert.equal(stopCalls, 1, "observer.stop must run exactly once");
});

test("malformed inventories fail instead of reading as empty", async (t) => {
  guardNoPidSignal(t);
  for (const [label, lists] of [
    ["missing-workspaces", { "workspace.list": {} }],
    [
      "non-array-sessions",
      {
        "workspace.list": { workspaces: [{ id: "ws-1" }] },
        "session.list": { sessions: null },
      },
    ],
  ]) {
    const { rpc } = makeRpc({
      status: statusResult(),
      "runtime.shutdown": { ...OWNED, accepted: true },
      ...lists,
    });
    const observer = fakeObserverScript();
    const daemon = daemonWith({ rpc, observer });
    await daemon.capture();
    await assert.rejects(daemon.stop(), /workspace|session|array|list/i, label);
  }
});

test("an unsafe-integer processId is refused", async (t) => {
  guardNoPidSignal(t);
  const { rpc } = makeRpc({
    status: statusResult({ processId: 2 ** 53 }),
  });
  const observer = fakeObserverScript();
  const daemon = daemonWith({ rpc, observer });
  await assert.rejects(daemon.capture(), /processId/);
});
