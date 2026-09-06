import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  callNative,
  identityMismatch,
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
