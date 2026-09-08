import { describe, expect, test } from "vitest";
import { bridgeSchemas } from "./bridge-validation";
import { resultSchemas } from "./result-validation";

const validSession = {
  id: "s1",
  workspaceId: "w1",
  hostId: "h1",
  incarnation: "i1",
  command: "/usr/local/bin/claude",
  args: [],
  cols: 80,
  rows: 24,
  verdict: "live",
  exitCode: null,
  createdAt: "2026-01-01T00:00:00Z",
};

describe("harness.list result validation", () => {
  test("accepts a trusted catalog with a nullable executable", () => {
    const result = resultSchemas["harness.list"].safeParse({
      hostId: "h1",
      harnesses: [
        {
          harnessId: "pi",
          displayName: "Pi",
          availability: "available",
          executable: "/usr/local/bin/pi",
        },
        {
          harnessId: "opencode",
          displayName: "OpenCode",
          availability: "missing",
          executable: null,
        },
        {
          harnessId: "codex",
          displayName: "Codex",
          availability: "available",
          executable: "/usr/local/bin/codex",
        },
      ],
    });
    expect(result.success).toBe(true);
  });
  test("rejects inconsistent availability and executable shape", () => {
    expect(
      resultSchemas["harness.list"].safeParse({
        hostId: "h1",
        harnesses: [
          {
            harnessId: "made-up-harness",
            displayName: "?",
            availability: "available",
            executable: null,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      resultSchemas["harness.list"].safeParse({
        hostId: "h1",
        harnesses: [
          {
            harnessId: "pi",
            displayName: "Pi",
            availability: "ready", // not a real availability value
            executable: null,
          },
        ],
      }).success,
    ).toBe(false);
  });
  test("a future adapter does not break known catalog entries", () => {
    const result = resultSchemas["harness.list"].parse({
      hostId: "h1",
      harnesses: [
        {
          harnessId: "future",
          displayName: "Future",
          availability: "available",
          executable: "/bin/future",
        },
        {
          harnessId: "pi",
          displayName: "Pi",
          availability: "available",
          executable: "/bin/pi",
        },
      ],
    });
    expect(result).toEqual({
      hostId: "h1",
      harnesses: [
        {
          harnessId: "pi",
          displayName: "Pi",
          availability: "available",
          executable: "/bin/pi",
        },
      ],
    });
  });
  test("rejects a fabricated executable path type", () => {
    expect(
      resultSchemas["harness.list"].safeParse({
        hostId: "h1",
        harnesses: [
          {
            harnessId: "claude",
            displayName: "Claude Code",
            availability: "available",
            executable: 12345,
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("harness.start result validation", () => {
  test("reuses the exact session schema — no separate, looser shape", () => {
    expect(resultSchemas["harness.start"].safeParse(validSession).success).toBe(
      true,
    );
    expect(
      resultSchemas["harness.start"].safeParse({
        ...validSession,
        verdict: "starting", // not a real verdict
      }).success,
    ).toBe(false);
  });
});

describe("startHarness bridge input validation (renderer -> main trust boundary)", () => {
  const base = {
    workspaceId: "w1",
    harnessId: "claude",
    permissionMode: "inherit",
    requestId: "11111111-1111-1111-1111-111111111111",
  };
  test("accepts a minimal request with every optional field omitted", () => {
    expect(bridgeSchemas.startHarness.safeParse(base).success).toBe(true);
  });
  test("accepts full advanced fields for pi", () => {
    expect(
      bridgeSchemas.startHarness.safeParse({
        workspaceId: "w1",
        harnessId: "pi",
        model: "claude-opus-4-6",
        provider: "anthropic",
        effort: "high",
        prompt: "Drogon task: fix the bug",
        permissionMode: "unattended",
        requestId: "22222222-2222-2222-2222-222222222222",
      }).success,
    ).toBe(true);
  });
  test("accepts Codex launch input", () => {
    expect(
      bridgeSchemas.startHarness.safeParse({
        ...base,
        harnessId: "codex",
        permissionMode: "unattended",
        prompt: "Inspect the fixture",
      }).success,
    ).toBe(true);
  });
  test("rejects a missing requestId", () => {
    const { requestId: _omit, ...withoutRequestId } = base;
    expect(bridgeSchemas.startHarness.safeParse(withoutRequestId).success).toBe(
      false,
    );
  });
  test("rejects an untrusted harnessId outside the adapter set", () => {
    expect(
      bridgeSchemas.startHarness.safeParse({
        ...base,
        harnessId: "rm -rf /",
      }).success,
    ).toBe(false);
  });
  test("rejects a permissionMode outside inherit/unattended", () => {
    expect(
      bridgeSchemas.startHarness.safeParse({
        ...base,
        permissionMode: "sudo",
      }).success,
    ).toBe(false);
  });
  test("rejects an empty-string optional field rather than treating it as absent", () => {
    expect(
      bridgeSchemas.startHarness.safeParse({ ...base, model: "" }).success,
    ).toBe(false);
  });
  test("rejects a NUL byte smuggled into an argv-bound field", () => {
    expect(
      bridgeSchemas.startHarness.safeParse({ ...base, prompt: "a\0b" }).success,
    ).toBe(false);
  });
  test("rejects a missing permissionMode and a missing harnessId", () => {
    expect(
      bridgeSchemas.startHarness.safeParse({
        workspaceId: "w1",
        harnessId: "claude",
      }).success,
    ).toBe(false);
    expect(
      bridgeSchemas.startHarness.safeParse({
        workspaceId: "w1",
        permissionMode: "inherit",
      }).success,
    ).toBe(false);
  });
});
