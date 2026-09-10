import { describe, expect, test } from "vitest";
import {
  ALLOWED_EFFORT_LEVELS,
  assessLaunchSelection,
  emptyHarnessLaunchForm,
  isEffortSupported,
  isLaunchSelectionSupported,
  isProviderSupported,
  normalizeHarnessLaunchInput,
} from "./harness-launch-form";

describe("harness launch form normalization", () => {
  test("blank optional fields are omitted, never sent as empty strings", () => {
    const input = normalizeHarnessLaunchInput(
      "ws-1",
      "claude",
      emptyHarnessLaunchForm(),
    );
    expect(input).toEqual({
      workspaceId: "ws-1",
      harnessId: "claude",
      model: undefined,
      provider: undefined,
      effort: undefined,
      prompt: undefined,
      permissionMode: "inherit",
    });
  });
  test("whitespace-only fields count as blank", () => {
    const input = normalizeHarnessLaunchInput("ws-1", "claude", {
      ...emptyHarnessLaunchForm(),
      model: "   ",
      prompt: "\t\n",
    });
    expect(input.model).toBeUndefined();
    expect(input.prompt).toBeUndefined();
  });
  test("preserves the user's exact opaque values without alteration", () => {
    const input = normalizeHarnessLaunchInput("ws-1", "pi", {
      model: "  claude-opus-4-6  ",
      provider: " anthropic ",
      effort: "high",
      prompt: "fix the bug",
      unattended: false,
    });
    // Trimmed of surrounding whitespace only — the opaque ID itself is
    // never reshaped, cased, or matched against any local catalog.
    expect(input.model).toBe("claude-opus-4-6");
    expect(input.provider).toBe("anthropic");
    expect(input.effort).toBe("high");
    expect(input.prompt).toBe("fix the bug");
  });
  test("provider is dropped for every harness except pi", () => {
    const input = normalizeHarnessLaunchInput("ws-1", "claude", {
      ...emptyHarnessLaunchForm(),
      provider: "anthropic",
    });
    expect(input.provider).toBeUndefined();
  });
  test("nonblank prompt whitespace remains literal", () => {
    const input = normalizeHarnessLaunchInput("ws-1", "pi", {
      ...emptyHarnessLaunchForm(),
      prompt: "  @file\nkeep trailing whitespace  ",
    });
    expect(input.prompt).toBe("  @file\nkeep trailing whitespace  ");
  });
  test("unattended maps to the exact adapter-facing permission mode", () => {
    expect(
      normalizeHarnessLaunchInput("ws-1", "claude", {
        ...emptyHarnessLaunchForm(),
        unattended: true,
      }).permissionMode,
    ).toBe("unattended");
    expect(
      normalizeHarnessLaunchInput("ws-1", "claude", emptyHarnessLaunchForm())
        .permissionMode,
    ).toBe("inherit");
  });
});

describe("harness launch selection assessment (C01 consumer adapter)", () => {
  test("effort allow-list mirrors the daemon selection table", () => {
    expect(ALLOWED_EFFORT_LEVELS.claude).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(ALLOWED_EFFORT_LEVELS.pi).toContain("off");
    expect(ALLOWED_EFFORT_LEVELS.opencode).toEqual([]);
    expect(ALLOWED_EFFORT_LEVELS.codex).toContain("ultra");
    expect(isEffortSupported("opencode", "high")).toBe(false);
    expect(isEffortSupported("claude", "max")).toBe(true);
    // Blank effort means "harness default" and always passes.
    expect(isEffortSupported("opencode", "")).toBe(true);
    expect(isEffortSupported("pi", undefined)).toBe(true);
  });
  test("provider is Pi-only", () => {
    expect(isProviderSupported("pi")).toBe(true);
    for (const id of ["claude", "opencode", "antigravity", "codex"] as const)
      expect(isProviderSupported(id)).toBe(false);
  });
  test("shape-valid selections are manual-unverified, never confirmed", () => {
    // Unknown ids ride unverified: without a host catalog nothing here
    // refutes them, and nothing confirms them either.
    const verdict = assessLaunchSelection("pi", {
      model: "no-such-model",
      provider: "no-such-provider",
      effort: "high",
    });
    expect(verdict.kind).toBe("manual_unverified");
    expect(isLaunchSelectionSupported("pi", { model: "anything" })).toBe(true);
    expect(isLaunchSelectionSupported("claude", {})).toBe(true);
  });
  test("unsupported combinations refuse without substitution", () => {
    expect(
      assessLaunchSelection("claude", { provider: "anthropic" }),
    ).toMatchObject({ kind: "refused", field: "provider" });
    expect(assessLaunchSelection("opencode", { effort: "high" })).toMatchObject(
      { kind: "refused", field: "effort" },
    );
    expect(assessLaunchSelection("pi", { effort: "ultra" })).toMatchObject({
      kind: "refused",
      field: "effort",
    });
    expect(assessLaunchSelection("pi", { model: "-x" })).toMatchObject({
      kind: "refused",
      field: "model",
    });
    expect(assessLaunchSelection("pi", { model: "bad\nvalue" })).toMatchObject({
      kind: "refused",
      field: "model",
    });
    expect(isLaunchSelectionSupported("codex", { effort: "off" })).toBe(false);
  });
});
