import { describe, expect, test } from "vitest";
import { identityMismatch, validateEnvelope } from "./native-client";
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
});
