import { describe, expect, test } from "vitest";
import {
  emptyHarnessLaunchForm,
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
