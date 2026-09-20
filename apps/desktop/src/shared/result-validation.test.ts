import { describe, expect, test } from "vitest";
import { resultSchemas } from "./result-validation";

const validSession = {
  id: "s1",
  workspaceId: "w1",
  hostId: "h1",
  incarnation: "i1",
  command: "/bin/zsh",
  args: [],
  cols: 80,
  rows: 24,
  verdict: "live",
  exitCode: null,
  createdAt: "2026-01-01T00:00:00Z",
};

describe("session.list observed-harness validation (issue #622, C1)", () => {
  test("the observed harness id and stamp survive validation", () => {
    const parsed = resultSchemas["session.list"].parse({
      sessions: [
        {
          ...validSession,
          observedHarnessId: "claude",
          observedHarnessAt: "2026-09-20T00:00:00.000Z",
        },
      ],
    }) as { sessions: Array<{ observedHarnessId?: string | null; observedHarnessAt?: string | null }> };
    expect(parsed.sessions[0]?.observedHarnessId).toBe("claude");
    expect(parsed.sessions[0]?.observedHarnessAt).toBe(
      "2026-09-20T00:00:00.000Z",
    );
  });

  test("a cleared observation (nulls) survives validation", () => {
    const parsed = resultSchemas["session.list"].parse({
      sessions: [
        { ...validSession, observedHarnessId: null, observedHarnessAt: null },
      ],
    }) as { sessions: Array<{ observedHarnessId?: string | null; observedHarnessAt?: string | null }> };
    expect(parsed.sessions[0]?.observedHarnessId).toBeNull();
    expect(parsed.sessions[0]?.observedHarnessAt).toBeNull();
  });

  test("an older service reply without either key still validates", () => {
    const parsed = resultSchemas["session.list"].parse({
      sessions: [validSession],
    }) as { sessions: Array<{ observedHarnessId?: string | null; observedHarnessAt?: string | null }> };
    expect(parsed.sessions[0]?.observedHarnessId).toBeUndefined();
    expect(parsed.sessions[0]?.observedHarnessAt).toBeUndefined();
  });
});
