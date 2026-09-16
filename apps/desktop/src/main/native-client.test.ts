import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  callNative,
  getNativeConnectionStats,
  identityMismatch,
  resetNativeClientForTests,
  setNativeTransportForTests,
  validateEnvelope,
} from "./native-client";
import { bridgeSchemas } from "../shared/bridge-validation";
import { resultSchemas } from "../shared/result-validation";

describe("desktop trust boundary", () => {
  test("validates response identity, version and exclusive payload", () => {
    const valid = { protocol: 1, requestId: "a", ok: true, result: {} };
    expect(validateEnvelope({ ...valid, future: true }, "a").ok).toBe(true);
    for (const value of [
      { ...valid, requestId: "b" },
      { ...valid, protocol: 2 },
      { ...valid, error: null },
      { ...valid, ok: "true" },
    ]) {
      expect(() => validateEnvelope(value, "a")).toThrow();
    }
  });
  test("validates operation inputs before crossing native IPC", () => {
    expect(
      bridgeSchemas.resize.safeParse({
        sessionId: "a",
        incarnation: "b",
        cols: 80,
        rows: 24,
      }).success,
    ).toBe(true);
    expect(
      bridgeSchemas.resize.safeParse({
        sessionId: "a",
        incarnation: "b",
        cols: 0,
        rows: 24,
      }).success,
    ).toBe(false);
    expect(bridgeSchemas.stop.safeParse({ sessionId: "a" }).success).toBe(
      false,
    );
    expect(
      bridgeSchemas.write.safeParse({
        sessionId: "a",
        incarnation: "b",
        text: "x".repeat(65537),
      }).success,
    ).toBe(false);
    expect(bridgeSchemas.addWorkspace.safeParse("/tmp/\0").success).toBe(false);
  });
  test("rejects fabricated session verdicts and malformed successful payloads", () => {
    expect(
      resultSchemas["session.list"].safeParse({
        sessions: [{ verdict: "probably_dead" }],
      }).success,
    ).toBe(false);
    expect(resultSchemas.status.safeParse({}).success).toBe(false);
    const status = { hostId: "host-1", serviceInstanceId: "svc-1", protocol: 1, capabilities: [], version: "test" };
    for (const schedulerLastTickMs of [undefined, null, 1234]) {
      expect(resultSchemas.status.parse({ ...status, schedulerLastTickMs })).toEqual({ ...status, schedulerLastTickMs });
    }
    expect(resultSchemas.status.safeParse({ ...status, schedulerLastTickMs: -1 }).success).toBe(false);
    expect(
      resultSchemas["session.read"].safeParse({ dataBase64: "not-base64" })
        .success,
    ).toBe(false);
  });
  test("error envelopes require structured retryability", () => {
    expect(
      validateEnvelope(
        {
          protocol: 1,
          requestId: "a",
          ok: false,
          error: {
            code: "unverifiable",
            message: "Unavailable",
            retryable: true,
          },
        },
        "a",
      ).ok,
    ).toBe(false);
    expect(() =>
      validateEnvelope(
        {
          protocol: 1,
          requestId: "a",
          ok: false,
          error: { code: "unverifiable", message: "Unavailable" },
        },
        "a",
      ),
    ).toThrow();
  });
  test("a harness/session launch result must match the requested workspace", () => {
    const mismatch = identityMismatch(
      "harness.start",
      { workspaceId: "w1" },
      { workspaceId: "w2", hostId: "h1" },
      null,
    );
    expect(mismatch?.ok).toBe(false);
    expect(
      identityMismatch(
        "harness.start",
        { workspaceId: "w1" },
        { workspaceId: "w1", hostId: "h1" },
        null,
      ),
    ).toBeNull();
  });
  test("a launch result must match the execution host this client is connected to", () => {
    const mismatch = identityMismatch(
      "session.start",
      { workspaceId: "w1" },
      { workspaceId: "w1", hostId: "other-host" },
      "known-host",
    );
    expect(mismatch?.ok).toBe(false);
    expect(
      identityMismatch(
        "session.start",
        { workspaceId: "w1" },
        { workspaceId: "w1", hostId: "known-host" },
        "known-host",
      ),
    ).toBeNull();
    // No known host yet (e.g. before the first successful status call) —
    // decline to check rather than falsely flagging every result.
    expect(
      identityMismatch(
        "session.start",
        { workspaceId: "w1" },
        { workspaceId: "w1", hostId: "anything" },
        null,
      ),
    ).toBeNull();
  });
  test("identity is only checked for methods that actually return a session", () => {
    expect(
      identityMismatch(
        "workspace.list",
        { workspaceId: "w1" },
        { workspaceId: "different", hostId: "different" },
        "known-host",
      ),
    ).toBeNull();
  });
  test("session.read/resize/stop must match the requested session id and incarnation", () => {
    const params = { sessionId: "s1", incarnation: "inc-1" };
    expect(
      identityMismatch(
        "session.resize",
        params,
        { id: "s2", incarnation: "inc-1", hostId: "h1" },
        null,
      )?.ok,
    ).toBe(false);
    expect(
      identityMismatch(
        "session.stop",
        params,
        { id: "s1", incarnation: "stale-inc", hostId: "h1" },
        null,
      )?.ok,
    ).toBe(false);
    expect(
      identityMismatch(
        "session.read",
        params,
        { session: { id: "s1", incarnation: "inc-1", hostId: "h1" } },
        "h1",
      ),
    ).toBeNull();
    expect(
      identityMismatch(
        "session.read",
        params,
        { session: { id: "s1", incarnation: "inc-1", hostId: "other-host" } },
        "h1",
      )?.ok,
    ).toBe(false);
  });
  test("session.list rejects any returned session outside the requested workspace or known host", () => {
    expect(
      identityMismatch(
        "session.list",
        { workspaceId: "w1" },
        { sessions: [{ id: "s1", workspaceId: "w2", hostId: "h1" }] },
        null,
      )?.ok,
    ).toBe(false);
    expect(
      identityMismatch(
        "session.list",
        {},
        { sessions: [{ id: "s1", workspaceId: "w2", hostId: "other" }] },
        "h1",
      )?.ok,
    ).toBe(false);
    expect(
      identityMismatch(
        "session.list",
        { workspaceId: "w1" },
        { sessions: [{ id: "s1", workspaceId: "w1", hostId: "h1" }] },
        "h1",
      ),
    ).toBeNull();
  });
  test("harness.list must be for this client's known execution host", () => {
    expect(
      identityMismatch("harness.list", {}, { hostId: "other" }, "h1")?.ok,
    ).toBe(false);
    expect(
      identityMismatch("harness.list", {}, { hostId: "h1" }, "h1"),
    ).toBeNull();
    expect(
      identityMismatch("harness.list", {}, { hostId: "anything" }, null),
    ).toBeNull();
  });
});

describe("callNative abort handling", () => {
  let scratchDir: string;
  let originalDataDir: string | undefined;

  afterEach(async () => {
    if (originalDataDir === undefined) delete process.env.DROGON_DATA_DIR;
    else process.env.DROGON_DATA_DIR = originalDataDir;
    if (scratchDir) await rm(scratchDir, { recursive: true, force: true });
  });

  async function ownedDataDir(): Promise<string> {
    scratchDir = await mkdtemp(
      path.join(tmpdir(), "drogon-native-client-test-"),
    );
    await writeFile(
      path.join(scratchDir, "auth.token"),
      "test-token\n",
      "utf8",
    );
    originalDataDir = process.env.DROGON_DATA_DIR;
    process.env.DROGON_DATA_DIR = scratchDir;
    return scratchDir;
  }

  // Reproduces the reported gap: aborting during the async directory/token
  // read (before any socket exists) must reject as a cancellation, not
  // fall through to opening a socket and registering a listener on a
  // signal whose "abort" event already fired (which never replays). The
  // synchronous `controller.abort()` right after invocation lands while
  // `callNative` is suspended at its very first `await` (real disk I/O
  // always yields at least one tick), which is exactly the gap reported.
  test("aborting during the async directory/token read rejects, never opens a socket", async () => {
    await ownedDataDir();
    const controller = new AbortController();
    const promise = callNative("status", {}, "req-1", controller.signal);
    controller.abort();
    await expect(promise).rejects.toThrow("aborted");
  });

  test("an already-aborted signal is rejected immediately, before any filesystem work", async () => {
    await ownedDataDir();
    const controller = new AbortController();
    controller.abort();
    await expect(
      callNative("status", {}, "req-2", controller.signal),
    ).rejects.toThrow("aborted");
  });
});

describe("callNative multiplexed transport (PERF-02)", () => {
  let scratchDir = "";
  let originalDataDir: string | undefined;

  // Minimal in-memory daemon wire: one controllable socket per dial, frames
  // answered only when the test says so (out-of-order, never, or per-dial).
  class FakeSocket extends EventEmitter {
    written: string[] = [];
    destroyed = false;
    write(chunk: string | Buffer): boolean {
      this.written.push(chunk.toString());
      fakeDaemon.onWrite(this);
      return true;
    }
    destroy(): this {
      if (this.destroyed) return this;
      this.destroyed = true;
      this.emit("close");
      return this;
    }
    setTimeout(): this {
      return this;
    }
    unref(): this {
      return this;
    }
  }

  const statusResult = {
    hostId: "test-host",
    serviceInstanceId: "svc-1",
    protocol: 1,
    capabilities: [],
    version: "test",
  };

  const fakeDaemon = {
    dials: 0,
    sockets: [] as FakeSocket[],
    onWrite: (_socket: FakeSocket): void => {},
  };

  function answer(socket: FakeSocket, requestId: string): void {
    socket.emit(
      "data",
      Buffer.from(
        `${JSON.stringify({ protocol: 1, requestId, ok: true, result: statusResult })}\n`,
      ),
    );
  }

  function requestIdOf(line: string): string {
    return (JSON.parse(line) as { requestId: string }).requestId;
  }

  beforeEach(async () => {
    resetNativeClientForTests();
    fakeDaemon.dials = 0;
    fakeDaemon.sockets = [];
    fakeDaemon.onWrite = () => {};
    setNativeTransportForTests({
      createConnection: (_endpoint: string) => {
        fakeDaemon.dials += 1;
        const socket = new FakeSocket();
        fakeDaemon.sockets.push(socket);
        queueMicrotask(() => {
          if (!socket.destroyed) socket.emit("connect");
        });
        return socket as unknown as Socket;
      },
    });
    scratchDir = await mkdtemp(
      path.join(tmpdir(), "drogon-native-client-mux-test-"),
    );
    await writeFile(
      path.join(scratchDir, "auth.token"),
      "test-token\n",
      "utf8",
    );
    originalDataDir = process.env.DROGON_DATA_DIR;
    process.env.DROGON_DATA_DIR = scratchDir;
  });

  afterEach(async () => {
    resetNativeClientForTests();
    if (originalDataDir === undefined) delete process.env.DROGON_DATA_DIR;
    else process.env.DROGON_DATA_DIR = originalDataDir;
    if (scratchDir) await rm(scratchDir, { recursive: true, force: true });
  });

  test("interleaved concurrent calls share ONE connection and demux by requestId", async () => {
    const received: { socket: FakeSocket; requestId: string }[] = [];
    fakeDaemon.onWrite = (socket) => {
      for (const line of socket.written.splice(0))
        received.push({ socket, requestId: requestIdOf(line) });
      if (received.length === 2) {
        // Answer in reverse arrival order: routing must follow requestId,
        // never arrival order.
        for (const item of [...received].reverse())
          answer(item.socket, item.requestId);
      }
    };
    const [first, second] = await Promise.all([
      callNative("status", {}, "req-a"),
      callNative("status", {}, "req-b"),
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(fakeDaemon.dials).toBe(1);
    expect(getNativeConnectionStats().connections).toBe(1);
    expect(received.map((item) => item.requestId).sort()).toEqual([
      "req-a",
      "req-b",
    ]);
  });

  test("a mid-flight socket death replays once with the same requestId", async () => {
    const framesByDial: string[][] = [];
    fakeDaemon.onWrite = (socket) => {
      const dialIndex = fakeDaemon.sockets.indexOf(socket);
      const lines = socket.written.splice(0);
      (framesByDial[dialIndex] ??= []).push(...lines);
      if (dialIndex === 0) {
        // Die mid-flight: answer nothing, drop the connection.
        socket.destroy();
        return;
      }
      for (const line of lines) answer(socket, requestIdOf(line));
    };
    const result = await callNative("status", {}, "req-replay");
    expect(result.ok).toBe(true);
    // Original dial plus exactly one replay dial.
    expect(fakeDaemon.dials).toBe(2);
    expect(getNativeConnectionStats().connections).toBe(2);
    expect(framesByDial).toHaveLength(2);
    expect(framesByDial[0]).toHaveLength(1);
    expect(framesByDial[1]).toHaveLength(1);
    const first = JSON.parse(framesByDial[0]![0]!) as Record<string, unknown>;
    const second = JSON.parse(framesByDial[1]![0]!) as Record<string, unknown>;
    // Same identity (the daemon dedupes), re-authed on the new connection.
    expect(first.requestId).toBe("req-replay");
    expect(second.requestId).toBe("req-replay");
    expect(first.auth).toBe("test-token");
    expect(second.auth).toBe("test-token");
  });

  test("a second mid-flight death settles unverifiable, never as an exit", async () => {
    fakeDaemon.onWrite = (socket) => {
      socket.written.splice(0);
      socket.destroy();
    };
    const result = await callNative("status", {}, "req-doomed");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Loss of contact never proves exit: the verdict stays unverifiable.
      expect(result.error.code).toBe("unverifiable");
      expect(result.error.retryable).toBe(true);
    }
    // Replay-once means exactly two dials, never a retry storm.
    expect(fakeDaemon.dials).toBe(2);
  });
});
