import { describe, expect, test } from "vitest";
import { verdictFor } from "./host-verdict";

describe("verdictFor", () => {
  test("a transport loss is unverifiable, never exited", () => {
    expect(verdictFor(new Error("ssh channel closed"))).toBe("unverifiable");
  });

  test("every failure shape maps to unverifiable — the helper cannot produce exited", () => {
    const losses: unknown[] = [
      new Error("read ETIMEDOUT"),
      { code: -32000, message: "relay unreachable" },
      "socket closed",
      new TypeError("cannot read properties of undefined"),
      undefined,
      null,
      { reason: "version-mismatch", exitCode: 42 },
    ];
    for (const loss of losses) {
      expect(verdictFor(loss)).toBe("unverifiable");
    }
    expect(losses.length).toBeGreaterThan(0);
  });
});
