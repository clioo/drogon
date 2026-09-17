import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  MAX_FRAME_BYTES,
  MAX_SESSION_OUTPUT_HOLDS,
  NATIVE_POOL_MAX_CONNECTIONS,
  callNative,
  callNativeHold,
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

  function answerUnauthorized(socket: FakeSocket, requestId: string): void {
    socket.emit(
      "data",
      Buffer.from(
        `${JSON.stringify({ protocol: 1, requestId, ok: false, error: { code: "unauthorized", message: "unauthorized", retryable: true } })}\n`,
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

  test("concurrent calls land on different entries and demux by requestId", async () => {
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
    // Least-busy assignment: two concurrent calls never share an idle entry.
    expect(fakeDaemon.dials).toBe(2);
    expect(getNativeConnectionStats().connections).toBe(2);
    expect(received.map((item) => item.requestId).sort()).toEqual([
      "req-a",
      "req-b",
    ]);
    expect(received[0].socket).not.toBe(received[1].socket);
  });

  test("sequential calls reuse one pooled entry (the connection-count win)", async () => {
    fakeDaemon.onWrite = (socket) => {
      for (const line of socket.written.splice(0))
        answer(socket, requestIdOf(line));
    };
    for (let i = 0; i < 5; i++)
      expect((await callNative("status", {}, `req-seq-${i}`)).ok).toBe(true);
    expect(fakeDaemon.dials).toBe(1);
    expect(getNativeConnectionStats().connections).toBe(1);
  });

  test("a burst grows the pool lazily to the cap, never one-per-request", async () => {
    const arrived: { socket: FakeSocket; requestId: string }[] = [];
    const total = NATIVE_POOL_MAX_CONNECTIONS + 4;
    fakeDaemon.onWrite = (socket) => {
      for (const line of socket.written.splice(0))
        arrived.push({ socket, requestId: requestIdOf(line) });
      // Withhold every answer until all frames are in flight together: the
      // burst must overlap for the cap to mean anything.
      if (arrived.length === total)
        for (const item of arrived) answer(item.socket, item.requestId);
    };
    const burst = await Promise.all(
      Array.from({ length: total }, (_, i) =>
        callNative("status", {}, `req-burst-${i}`),
      ),
    );
    expect(burst.every((result) => result.ok)).toBe(true);
    expect(fakeDaemon.dials).toBe(NATIVE_POOL_MAX_CONNECTIONS);
    expect(getNativeConnectionStats().connections).toBe(
      NATIVE_POOL_MAX_CONNECTIONS,
    );
  });

  test("a slow call on one entry never delays a fast call on another (PERF-02b)", async () => {
    const held: { socket: FakeSocket; requestId: string }[] = [];
    // Warm the credential cache and the first entry first: cold concurrent
    // calls race through real filesystem reads, so overlap would be a
    // timing accident rather than a forced fact. Past the warm call every
    // registration is microtask-ordered and deterministic.
    fakeDaemon.onWrite = (socket) => {
      for (const line of socket.written.splice(0))
        answer(socket, requestIdOf(line));
    };
    expect((await callNative("status", {}, "req-warm")).ok).toBe(true);
    fakeDaemon.onWrite = (socket) => {
      for (const line of socket.written.splice(0)) {
        const requestId = requestIdOf(line);
        // The slow entry's daemon dispatch never finishes until the test
        // releases it; everything else answers immediately.
        if (requestId === "req-slow") held.push({ socket, requestId });
        else answer(socket, requestId);
      }
    };
    const slow = callNative("status", {}, "req-slow");
    // Causal head-of-line freedom, no timers: the fast call resolves while
    // the slow frame is still held. On a single shared connection this
    // `await` would hang until the release below (the test timeout would
    // fire instead of this passing).
    const fast = await callNative("status", {}, "req-fast");
    expect(fast.ok).toBe(true);
    expect(fakeDaemon.dials).toBe(2);
    expect(held).toHaveLength(1);
    for (const item of held) answer(item.socket, item.requestId);
    expect((await slow).ok).toBe(true);
  });

  test("one entry's death replays only its own flights (PERF-02b)", async () => {
    // Warm first (see the slow/fast test): past the warm call every
    // registration is microtask-ordered, so the doomed and safe flights
    // deterministically land on separate entries.
    fakeDaemon.onWrite = (socket) => {
      for (const line of socket.written.splice(0))
        answer(socket, requestIdOf(line));
    };
    expect((await callNative("status", {}, "req-warm")).ok).toBe(true);
    const frames: { socket: FakeSocket; requestId: string; auth: unknown }[] =
      [];
    const heldSafe: { socket: FakeSocket; requestId: string }[] = [];
    let killed = false;
    fakeDaemon.onWrite = (socket) => {
      for (const line of socket.written.splice(0)) {
        const body = JSON.parse(line) as {
          requestId: string;
          auth: unknown;
        };
        frames.push({ socket, requestId: body.requestId, auth: body.auth });
        // Kill the doomed entry mid-flight exactly once; its replay dial
        // answers normally. The safe frame stays held until the replay has
        // landed, so the replay cannot reuse the safe entry and the dial
        // count below is deterministic.
        if (body.requestId === "req-doomed-entry" && !killed) {
          killed = true;
          socket.destroy();
          return;
        }
        if (body.requestId === "req-safe") {
          heldSafe.push({ socket, requestId: body.requestId });
          return;
        }
        answer(socket, body.requestId);
      }
    };
    const doomed = callNative("status", {}, "req-doomed-entry");
    const safe = callNative("status", {}, "req-safe");
    // The replay answers independently of the held safe flight: no deadlock,
    // no timers.
    expect((await doomed).ok).toBe(true);
    expect(heldSafe).toHaveLength(1);
    // The survivor entry is untouched by the other entry's death and its
    // re-auth: still connected, never redialed, still carrying its flight.
    expect(heldSafe[0].socket.destroyed).toBe(false);
    for (const item of heldSafe) answer(item.socket, item.requestId);
    expect((await safe).ok).toBe(true);
    // Warm dial, the safe flight's own dial (the doomed flight reuses the
    // warm entry), plus exactly one replay dial for the doomed flight; the
    // safe flight never replayed.
    expect(fakeDaemon.dials).toBe(3);
    expect(
      frames.filter((item) => item.requestId === "req-safe"),
    ).toHaveLength(1);
    const doomedFrames = frames.filter(
      (item) => item.requestId === "req-doomed-entry",
    );
    expect(doomedFrames).toHaveLength(2);
    // Same identity (the daemon dedupes), re-authed, on a new entry.
    expect(doomedFrames[0].socket).not.toBe(doomedFrames[1].socket);
    expect(doomedFrames[0].auth).toBe("test-token");
    expect(doomedFrames[1].auth).toBe("test-token");
  });

  test("an over-limit stream fails only its own entry (PERF-02b)", async () => {
    // Same warm-up as the slow/fast test: cold concurrent calls race
    // through real filesystem reads, so without it the small call could
    // legitimately settle before the big call registers and shares nothing.
    fakeDaemon.onWrite = (socket) => {
      for (const line of socket.written.splice(0))
        answer(socket, requestIdOf(line));
    };
    expect((await callNative("status", {}, "req-warm")).ok).toBe(true);
    fakeDaemon.onWrite = (socket) => {
      for (const line of socket.written.splice(0)) {
        const requestId = requestIdOf(line);
        if (requestId === "req-big") {
          // The daemon's `write_response` fails on the oversized answer and
          // the connection just closes with no error frame. Feed enough
          // bytes client-side to trip the same bound, then close like the
          // daemon does.
          socket.emit("data", Buffer.alloc(MAX_FRAME_BYTES + 1, 7));
          socket.destroy();
        } else answer(socket, requestId);
      }
    };
    const big = callNative("session.list", {}, "req-big");
    const small = await callNative("status", {}, "req-small");
    expect(small.ok).toBe(true);
    const bigResult = await big;
    expect(bigResult.ok).toBe(false);
    if (!bigResult.ok) {
      // Contract failure, never replayed — and never an exit proof.
      expect(bigResult.error.code).toBe("internal_error");
      expect(bigResult.error.retryable).toBe(false);
    }
    // No replay for the oversized call: exactly the two original dials.
    expect(fakeDaemon.dials).toBe(2);
  });

  test("a silent idle entry retires itself; the next call redials (PERF-02b)", async () => {
    fakeDaemon.onWrite = (socket) => {
      for (const line of socket.written.splice(0))
        answer(socket, requestIdOf(line));
    };
    expect((await callNative("status", {}, "req-1")).ok).toBe(true);
    expect(fakeDaemon.dials).toBe(1);
    const first = fakeDaemon.sockets[0]!;
    expect(first.destroyed).toBe(false);
    first.emit("timeout");
    expect(first.destroyed).toBe(true);
    expect((await callNative("status", {}, "req-2")).ok).toBe(true);
    expect(fakeDaemon.dials).toBe(2);
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

  test("a pooled call answered unauthorized re-reads the rotated token and resends once", async () => {
    // Same wedge as the hold path, through the pool: the daemon restarted
    // and minted a fresh auth.token while this client cached the old
    // boot's. The first attempt is rejected; the file already moved.
    const attempts: { requestId: string; auth: string }[] = [];
    fakeDaemon.onWrite = (socket) => {
      for (const line of socket.written.splice(0))
        answer(socket, requestIdOf(line));
    };
    expect((await callNative("status", {}, "req-warm")).ok).toBe(true);
    fakeDaemon.onWrite = (socket) => {
      for (const line of socket.written.splice(0)) {
        const body = JSON.parse(line) as {
          requestId: string;
          auth: string;
        };
        attempts.push(body);
        if (body.auth === "test-token")
          answerUnauthorized(socket, body.requestId);
        else answer(socket, body.requestId);
      }
    };
    // The restart rotates the file AFTER the client cached the old token.
    await writeFile(
      path.join(scratchDir, "auth.token"),
      "rotated-token\n",
      "utf8",
    );
    const result = await callNative("status", {}, "req-rotated");
    expect(result.ok).toBe(true);
    const rotated = attempts.filter((item) => item.requestId === "req-rotated");
    expect(rotated).toHaveLength(2);
    expect(rotated[0]!.auth).toBe("test-token");
    expect(rotated[1]!.auth).toBe("rotated-token");
    // A later call uses the refreshed cache directly: no third attempt.
    attempts.length = 0;
    expect((await callNative("status", {}, "req-after")).ok).toBe(true);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      requestId: "req-after",
      auth: "rotated-token",
    });
  });

  test("a pooled call answered unauthorized with no rotation settles as observed", async () => {
    // The token file never moved: resending would fail identically, so the
    // call reports the daemon's own verdict — exactly once, no redial.
    fakeDaemon.onWrite = (socket) => {
      for (const line of socket.written.splice(0))
        answer(socket, requestIdOf(line));
    };
    expect((await callNative("status", {}, "req-warm")).ok).toBe(true);
    fakeDaemon.onWrite = (socket) => {
      for (const line of socket.written.splice(0))
        answerUnauthorized(socket, requestIdOf(line));
    };
    const dialsBefore = fakeDaemon.dials;
    const result = await callNative("status", {}, "req-denied");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unauthorized");
    expect(fakeDaemon.dials).toBe(dialsBefore);
  });
});

describe("callNativeHold dedicated long-holds (PERF-01)", () => {
  let scratchDir = "";
  let originalDataDir: string | undefined;

  // Same controllable wire as the pool tests: one socket per dial, frames
  // answered only when the test says so. A hold's socket is one-shot and
  // dedicated — never pooled, never shared.
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

  const fakeDaemon = {
    dials: 0,
    sockets: [] as FakeSocket[],
    onWrite: (_socket: FakeSocket): void => {},
  };

  function requestIdOf(line: string): string {
    return (JSON.parse(line) as { requestId: string }).requestId;
  }

  const statusResult = {
    hostId: "test-host",
    serviceInstanceId: "svc-1",
    protocol: 1,
    capabilities: [],
    version: "test",
  };

  function answerOk(socket: FakeSocket, requestId: string): void {
    socket.emit(
      "data",
      Buffer.from(
        `${JSON.stringify({ protocol: 1, requestId, ok: true, result: {} })}\n`,
      ),
    );
  }

  function answerStatus(socket: FakeSocket, requestId: string): void {
    socket.emit(
      "data",
      Buffer.from(
        `${JSON.stringify({ protocol: 1, requestId, ok: true, result: statusResult })}\n`,
      ),
    );
  }

  function answerError(
    socket: FakeSocket,
    requestId: string,
    code: string,
  ): void {
    socket.emit(
      "data",
      Buffer.from(
        `${JSON.stringify({
          protocol: 1,
          requestId,
          ok: false,
          error: { code, message: code, retryable: true },
        })}\n`,
      ),
    );
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
      path.join(tmpdir(), "drogon-native-client-hold-test-"),
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

  test("six simultaneous holds never delay a short pooled call", async () => {
    // Warm the credential cache and the pool first (see the pool tests):
    // past it every registration is microtask-ordered and deterministic.
    fakeDaemon.onWrite = (socket) => {
      for (const line of socket.written.splice(0))
        answerStatus(socket, requestIdOf(line));
    };
    expect((await callNative("status", {}, "req-warm")).ok).toBe(true);
    const held: { socket: FakeSocket; requestId: string }[] = [];
    const arrived: { socket: FakeSocket; requestId: string }[] = [];
    fakeDaemon.onWrite = (socket) => {
      for (const line of socket.written.splice(0)) {
        const requestId = requestIdOf(line);
        arrived.push({ socket, requestId });
        // Withhold every hold; the short call below must still answer at
        // once on its own connection. The daemon serves one frame at a
        // time per connection, so sharing would hang this `await` until
        // the releases at the end (the test timeout would fire instead).
        if (requestId.startsWith("req-hold-"))
          held.push({ socket, requestId });
        else answerStatus(socket, requestId);
      }
    };
    const holds = Array.from({ length: 6 }, (_, i) =>
      callNativeHold("session.output", { cursor: 0 }, 5_000, true, `req-hold-${i}`),
    );
    // Let every hold dial and register before the short call runs.
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const fast = await callNative("status", {}, "req-fast");
    expect(fast.ok).toBe(true);
    expect(held).toHaveLength(6);
    // Causal proof, no timers: six distinct dedicated sockets for the
    // holds, and the short call on a seventh that is none of them — it
    // never shared a connection with any hold.
    const holdSockets = new Set(held.map((item) => item.socket));
    expect(holdSockets.size).toBe(6);
    const fastArrival = arrived.find((item) => item.requestId === "req-fast");
    expect(fastArrival).toBeDefined();
    expect(holdSockets.has(fastArrival!.socket)).toBe(false);
    // One warm pool dial, six dedicated hold dials, and the fast call
    // reuses the idle warm entry — no eighth dial, no sharing with holds.
    expect(fakeDaemon.dials).toBe(1 + 6);
    for (const item of held) answerOk(item.socket, item.requestId);
    const settled = await Promise.all(holds);
    expect(settled.every((result) => result.ok)).toBe(true);
    // Reclamation is the settle: every dedicated socket destroyed.
    for (const socket of holdSockets) expect(socket.destroyed).toBe(true);
  });

  test("the cap refuses past the max and re-admits after settle", async () => {
    // Warm the credential cache first (see the pool tests): past it every
    // registration is microtask-ordered and the dial count below is exact.
    fakeDaemon.onWrite = (socket) => {
      for (const line of socket.written.splice(0))
        answerStatus(socket, requestIdOf(line));
    };
    expect((await callNative("status", {}, "req-warm")).ok).toBe(true);
    fakeDaemon.onWrite = () => {};
    const holds = Array.from({ length: MAX_SESSION_OUTPUT_HOLDS }, (_, i) =>
      callNativeHold("session.output", { cursor: 0 }, 5_000, true, `req-cap-${i}`),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Past the cap: a retryable refusal with no new dial — the pane
    // answers the round over the old poll instead of queuing behind holds.
    const refused = await callNativeHold(
      "session.output",
      { cursor: 0 },
      5_000,
      true,
      "req-cap-overflow",
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("hold_cap");
      expect(refused.error.retryable).toBe(true);
    }
    expect(fakeDaemon.dials).toBe(1 + MAX_SESSION_OUTPUT_HOLDS);
    // Release every hold: all settle, all sockets destroyed, and the next
    // hold is admitted — the cap counts outstanding holds, never history.
    const released: FakeSocket[] = [];
    for (const socket of fakeDaemon.sockets) {
      const lines = socket.written.splice(0);
      if (lines.length > 0) released.push(socket);
      for (const line of lines) answerOk(socket, requestIdOf(line));
    }
    // Exactly the 16 hold frames (the warm pooled entry wrote nothing new
    // and persists by design).
    expect(released).toHaveLength(MAX_SESSION_OUTPUT_HOLDS);
    const settled = await Promise.all(holds);
    expect(settled.every((result) => result.ok)).toBe(true);
    for (const socket of released) expect(socket.destroyed).toBe(true);
    fakeDaemon.onWrite = (socket) => {
      for (const line of socket.written.splice(0))
        answerOk(socket, requestIdOf(line));
    };
    expect(
      (await callNativeHold("session.output", { cursor: 0 }, 5_000, true, "req-cap-after")).ok,
    ).toBe(true);
    expect(fakeDaemon.dials).toBe(1 + MAX_SESSION_OUTPUT_HOLDS + 1);
  });

  test("the singleton events hold bypasses the output cap", async () => {
    fakeDaemon.onWrite = (socket) => {
      for (const line of socket.written.splice(0))
        answerStatus(socket, requestIdOf(line));
    };
    expect((await callNative("status", {}, "req-warm")).ok).toBe(true);
    fakeDaemon.onWrite = () => {};
    const holds = Array.from({ length: MAX_SESSION_OUTPUT_HOLDS }, (_, i) =>
      callNativeHold("session.output", { cursor: 0 }, 5_000, true, `req-fill-${i}`),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The state loop is grandfathered at exactly one: even with every
    // output slot taken it still dials its own dedicated connection.
    const events = callNativeHold(
      "session.events.poll",
      { afterSeq: 0 },
      5_000,
      false,
      "req-events",
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fakeDaemon.dials).toBe(1 + MAX_SESSION_OUTPUT_HOLDS + 1);
    const eventsSocket = fakeDaemon.sockets.find((socket) =>
      socket.written.some((line) => requestIdOf(line) === "req-events"),
    );
    expect(eventsSocket).toBeDefined();
    answerOk(eventsSocket!, "req-events");
    expect((await events).ok).toBe(true);
    for (const socket of fakeDaemon.sockets) {
      for (const line of socket.written.splice(0))
        answerOk(socket, requestIdOf(line));
    }
    await Promise.all(holds);
  });

  test("holds reuse the cached credential without re-reading the token", async () => {
    fakeDaemon.onWrite = (socket) => {
      for (const line of socket.written.splice(0))
        answerStatus(socket, requestIdOf(line));
    };
    expect((await callNative("status", {}, "req-warm")).ok).toBe(true);
    // The token file is gone; a cached hold still authenticates.
    await rm(path.join(scratchDir, "auth.token"), { force: true });
    const held = await callNativeHold(
      "session.output",
      { cursor: 0 },
      5_000,
      true,
      "req-cached",
    );
    expect(held.ok).toBe(true);
  });

  test("a hold answered unauthorized re-reads the rotated token and resends once", async () => {
    // A daemon restart mints a fresh auth.token while main still caches
    // the pre-restart token: the first attempt is rejected, the file has
    // already moved, so the hold must resend the SAME requestId with the
    // fresh token instead of wedging every later bridge call.
    const attempts: { requestId: string; auth: string }[] = [];
    fakeDaemon.onWrite = (socket) => {
      for (const line of socket.written.splice(0))
        answerStatus(socket, requestIdOf(line));
    };
    expect((await callNative("status", {}, "req-warm")).ok).toBe(true);
    fakeDaemon.onWrite = (socket) => {
      for (const line of socket.written.splice(0)) {
        const body = JSON.parse(line) as {
          requestId: string;
          auth: string;
        };
        attempts.push(body);
        if (body.auth === "test-token")
          answerError(socket, body.requestId, "unauthorized");
        else answerOk(socket, body.requestId);
      }
    };
    // The restart rotates the file AFTER main cached the old token.
    await writeFile(
      path.join(scratchDir, "auth.token"),
      "rotated-token\n",
      "utf8",
    );
    const dialsBefore = fakeDaemon.dials;
    const held = await callNativeHold(
      "session.output",
      { cursor: 0 },
      5_000,
      true,
      "req-rotated",
    );
    expect(held.ok).toBe(true);
    // The hold's own dial plus exactly one redial: stale attempt plus the
    // resent same-id frame with the rotated token (the daemon rejected the
    // first, accepted the second).
    expect(fakeDaemon.dials).toBe(dialsBefore + 2);
    const holdAttempts = attempts.filter(
      (item) => item.requestId === "req-rotated",
    );
    expect(holdAttempts).toHaveLength(2);
    expect(holdAttempts[0]).toEqual(
      expect.objectContaining({
        requestId: "req-rotated",
        auth: "test-token",
      }),
    );
    expect(holdAttempts[1]).toEqual(
      expect.objectContaining({
        requestId: "req-rotated",
        auth: "rotated-token",
      }),
    );
  });

  test("a hold answered unauthorized with no rotation settles as observed", async () => {
    // The token file never moved: resending would fail identically, so the
    // hold reports the daemon's own verdict with no redial.
    fakeDaemon.onWrite = (socket) => {
      for (const line of socket.written.splice(0))
        answerStatus(socket, requestIdOf(line));
    };
    expect((await callNative("status", {}, "req-warm")).ok).toBe(true);
    fakeDaemon.onWrite = (socket) => {
      for (const line of socket.written.splice(0))
        answerError(socket, requestIdOf(line), "unauthorized");
    };
    const dialsBefore = fakeDaemon.dials;
    const held = await callNativeHold(
      "session.output",
      { cursor: 0 },
      5_000,
      true,
      "req-denied",
    );
    expect(held.ok).toBe(false);
    if (!held.ok) expect(held.error.code).toBe("unauthorized");
    expect(fakeDaemon.dials).toBe(dialsBefore + 1);
  });

  test("a hold that outlives its deadline reports unverifiable, never exit", async () => {
    fakeDaemon.onWrite = () => {};
    const result = await callNativeHold(
      "session.output",
      { cursor: 0 },
      50,
      true,
      "req-deadline",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("unverifiable");
      expect(result.error.retryable).toBe(true);
    }
    expect(fakeDaemon.sockets[0]?.destroyed).toBe(true);
  });

  test("a method_not_found envelope passes through for the version latch", async () => {
    fakeDaemon.onWrite = (socket) => {
      for (const line of socket.written.splice(0))
        answerError(socket, requestIdOf(line), "method_not_found");
    };
    const result = await callNativeHold(
      "session.output",
      { cursor: 0 },
      5_000,
      true,
      "req-old-daemon",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("method_not_found");
  });
});
