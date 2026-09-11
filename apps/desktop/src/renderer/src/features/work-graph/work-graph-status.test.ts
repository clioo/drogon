// MIT Copyright (c) 2026 Lovecast Inc.
// Status-projection tests: every contract status has exactly one label and
// one tone, `unverifiable` is its OWN outcome (never error-red, never
// success-green), and a status this build does not know renders raw — the
// graph never maps an unknown onto a familiar word.

import { describe, expect, it } from "vitest";
import {
  workGraphStatusIsFailure,
  workGraphStatusLabel,
  workGraphStatusToneClass,
} from "./work-graph-status";

describe("workGraphStatusLabel", () => {
  it("spells every contract status", () => {
    expect(workGraphStatusLabel("idle")).toBe("Idle");
    expect(workGraphStatusLabel("running")).toBe("Running…");
    expect(workGraphStatusLabel("succeeded")).toBe("Succeeded");
    expect(workGraphStatusLabel("failed")).toBe("Failed");
    expect(workGraphStatusLabel("blocked")).toBe("Blocked");
    expect(workGraphStatusLabel("unverifiable")).toBe("Unverifiable");
  });

  it("renders an unknown status verbatim instead of guessing", () => {
    expect(workGraphStatusLabel("restarting")).toBe("restarting");
    expect(workGraphStatusLabel(undefined)).toBe("");
    expect(workGraphStatusLabel("")).toBe("");
  });
});

describe("workGraphStatusToneClass", () => {
  it("gives unverifiable its own caution tone", () => {
    const unverifiable = workGraphStatusToneClass("unverifiable");
    expect(unverifiable).not.toBe(workGraphStatusToneClass("failed"));
    expect(unverifiable).not.toBe(workGraphStatusToneClass("succeeded"));
    expect(unverifiable).toContain("amber");
  });

  it("keeps succeeded green, failed destructive, blocked muted", () => {
    expect(workGraphStatusToneClass("succeeded")).toContain("emerald");
    expect(workGraphStatusToneClass("failed")).toContain("destructive");
    expect(workGraphStatusToneClass("blocked")).toContain("muted");
  });
});

describe("workGraphStatusIsFailure", () => {
  it("only failed is a failure — loss of contact is not", () => {
    expect(workGraphStatusIsFailure("failed")).toBe(true);
    expect(workGraphStatusIsFailure("unverifiable")).toBe(false);
    expect(workGraphStatusIsFailure("blocked")).toBe(false);
  });
});
