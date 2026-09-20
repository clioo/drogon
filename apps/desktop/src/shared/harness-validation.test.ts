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

describe("harness.models result validation", () => {
  const enumerated = {
    hostId: "h1",
    catalog: {
      harness: "pi",
      availability: "available",
      executable: "/usr/local/bin/pi",
      provenance: {
        executable: "/usr/local/bin/pi",
        argv: ["--list-models"],
        version: "0.85.1",
        probedAtEpochMs: 1_800_000_000_000,
        configScope: "private-isolated-root (credential-free)",
      },
      entries: [
        {
          provider: "kimi-coding",
          id: "kimi-for-coding",
          context: "262.1K",
          maxOutput: "32.8K",
          thinking: true,
          images: true,
        },
      ],
      status: "enumerated",
      note: "auth-gated enumeration",
      retainedRoots: [],
    },
  };
  test("accepts an enumerated catalog with provenance and entries", () => {
    expect(resultSchemas["harness.models"].safeParse(enumerated).success).toBe(
      true,
    );
  });
  test("accepts every honest non-enumerated status without entries", () => {
    for (const status of [
      "not_installed",
      "unsupported_surface",
      "unsupported_platform",
      "parse_failed",
      "timed_out",
      "probe_failed",
      "isolation_failed",
    ]) {
      expect(
        resultSchemas["harness.models"].safeParse({
          hostId: "h1",
          catalog: {
            harness: "claude",
            availability: "available",
            executable: "/usr/local/bin/claude",
            provenance: null,
            entries: [],
            status,
            note: "evidence",
            retainedRoots: [],
          },
        }).success,
      ).toBe(true);
    }
  });
  test("rejects an invented status, an unknown harness, or a fabricated count type", () => {
    expect(
      resultSchemas["harness.models"].safeParse({
        ...enumerated,
        catalog: { ...enumerated.catalog, status: "synced" },
      }).success,
    ).toBe(false);
    expect(
      resultSchemas["harness.models"].safeParse({
        ...enumerated,
        catalog: { ...enumerated.catalog, harness: "terminator" },
      }).success,
    ).toBe(false);
    expect(
      resultSchemas["harness.models"].safeParse({
        ...enumerated,
        catalog: { ...enumerated.catalog, entries: "3 models" },
      }).success,
    ).toBe(false);
  });
});

describe("harnessModels bridge input validation (renderer -> main trust boundary)", () => {
  test("accepts each registered harness id", () => {
    for (const harnessId of ["claude", "pi", "opencode", "antigravity", "codex"]) {
      expect(bridgeSchemas.harnessModels.safeParse({ harnessId }).success).toBe(
        true,
      );
    }
  });
  test("rejects an unknown harness id and a missing one", () => {
    expect(
      bridgeSchemas.harnessModels.safeParse({ harnessId: "not-a-harness" })
        .success,
    ).toBe(false);
    expect(bridgeSchemas.harnessModels.safeParse({}).success).toBe(false);
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

// #605: the pty's grid is only actionable with the ring offset it took
// effect at, so a terminal can switch grids at the byte the pty did.
describe("session gridCursor (#605)", () => {
  test("accepts the cut the daemon reports", () => {
    const parsed = resultSchemas["session.read"].safeParse({
      session: { ...validSession, cols: 120, gridCursor: 4096 },
      dataBase64: "",
      startCursor: 0,
      nextCursor: 0,
      truncated: false,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect((parsed.data as { session: { gridCursor?: number } }).session.gridCursor).toBe(4096);
    }
  });

  test("stays optional so a daemon without it still validates", () => {
    expect(resultSchemas["session.start"].safeParse(validSession).success).toBe(true);
  });

  test("rejects a cut that cannot be a ring offset", () => {
    for (const gridCursor of [-1, 1.5, "4096"]) {
      expect(
        resultSchemas["session.start"].safeParse({ ...validSession, gridCursor }).success,
      ).toBe(false);
    }
  });
});

// #605 finding F1: one cut per page cannot express two resizes inside it.
// The schema has to carry them all through, or the renderer silently sees
// only the newest and strands the frame composed at the middle grid.
describe("read page gridChanges (#605)", () => {
  const page = (extra: Record<string, unknown>) => ({
    session: validSession,
    dataBase64: "",
    startCursor: 0,
    nextCursor: 12,
    truncated: false,
    ...extra,
  });

  test("carries every grid a page spans, in order", () => {
    const changes = [
      { cursor: 0, cols: 80, rows: 24 },
      { cursor: 4, cols: 132, rows: 24 },
      { cursor: 8, cols: 96, rows: 30 },
    ];
    const parsed = resultSchemas["session.read"].safeParse(page({ gridChanges: changes }));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect((parsed.data as { gridChanges?: unknown }).gridChanges).toEqual(changes);
    }
  });

  test("stays optional so a daemon that reports only the newest cut still validates", () => {
    expect(resultSchemas["session.output"].safeParse(page({})).success).toBe(true);
  });

  test("refuses a change that is not a usable grid", () => {
    for (const bad of [
      { cursor: -1, cols: 80, rows: 24 },
      { cursor: 0, cols: 0, rows: 24 },
      { cursor: 0, cols: 80, rows: 1.5 },
      { cursor: 0, cols: 2000, rows: 24 },
    ]) {
      expect(
        resultSchemas["session.read"].safeParse(page({ gridChanges: [bad] })).success,
      ).toBe(false);
    }
  });
});
