import { describe, expect, test } from "vitest";
import {
  buildHarnessAgentDefault,
  isPristineLaunchForm,
  resolveLaunchDefaults,
  validateAgentDefaultField,
} from "./agent-defaults";
import {
  buildShortcutList,
  displayKey,
  filterShortcuts,
  formatChordForPlatform,
  resolveShortcutPlatform,
} from "./shortcut-labels";
import {
  DEFAULT_SETTINGS_SECTION,
  isSettingsSectionId,
  SETTINGS_SECTIONS,
} from "./settings-sections";

describe("settings sections", () => {
  test("declares the five J10 sections in nav order", () => {
    expect(SETTINGS_SECTIONS.map((s) => s.id)).toEqual([
      "appearance",
      "agents",
      "shortcuts",
      "git",
      "notifications",
    ]);
    expect(DEFAULT_SETTINGS_SECTION).toBe("appearance");
    expect(isSettingsSectionId("agents")).toBe(true);
    expect(isSettingsSectionId("bogus")).toBe(false);
  });
});

describe("agent defaults resolution", () => {
  test("an absent harness entry resolves to empty values with prompts kept", () => {
    expect(resolveLaunchDefaults("pi", {})).toEqual({
      model: "",
      effort: "",
      unattended: false,
    });
  });
  test("a stored entry maps permissionMode to the unattended flag", () => {
    expect(
      resolveLaunchDefaults("pi", {
        pi: { model: "opus", effort: "high", permissionMode: "unattended" },
      }),
    ).toEqual({ model: "opus", effort: "high", unattended: true });
  });
  test("building a default maps the flag back to the permission mode", () => {
    expect(
      buildHarnessAgentDefault({ model: "", effort: "", unattended: false }),
    ).toEqual({ model: "", effort: "", permissionMode: "inherit" });
    expect(
      buildHarnessAgentDefault({ model: "m", effort: "e", unattended: true }),
    ).toEqual({ model: "m", effort: "e", permissionMode: "unattended" });
  });
  test("validation rejects control characters and overlong values", () => {
    expect(validateAgentDefaultField("model", "claude-opus")).toBeNull();
    expect(validateAgentDefaultField("effort", "")).toBeNull();
    expect(validateAgentDefaultField("model", "a\0b")).not.toBeNull();
    expect(validateAgentDefaultField("effort", "a\nb")).not.toBeNull();
    expect(validateAgentDefaultField("effort", "x".repeat(257))).not.toBeNull();
    expect(validateAgentDefaultField("model", "x".repeat(4097))).not.toBeNull();
  });
  test("pristine detection only matches untouched empty values", () => {
    expect(
      isPristineLaunchForm({ model: "", effort: "", unattended: false }),
    ).toBe(true);
    expect(
      isPristineLaunchForm({ model: "m", effort: "", unattended: false }),
    ).toBe(false);
    expect(
      isPristineLaunchForm({ model: "", effort: "", unattended: true }),
    ).toBe(false);
  });
});

describe("shortcut labels", () => {
  test("the list covers window actions plus every palette registry chord", () => {
    const entries = buildShortcutList();
    const ids = entries.map((e) => e.id);
    expect(ids).toContain("settings.open");
    expect(ids).toContain("workspace.newTerminal");
    expect(ids).toContain("palette.openCommands");
    expect(ids).toContain("palette.openQuickOpen");
    expect(ids).toContain("tabs.select1");
    expect(ids).toContain("tabs.prev");
    // No duplicate ids: the read-only list must not double-count.
    expect(new Set(ids).size).toBe(ids.length);
  });
  test("macOS uses symbols, other platforms use words", () => {
    expect(formatChordForPlatform("CmdOrCtrl+,", "darwin")).toEqual([
      "⌘",
      ",",
    ]);
    expect(formatChordForPlatform("CmdOrCtrl+,", "other")).toEqual([
      "Ctrl",
      ",",
    ]);
    expect(
      formatChordForPlatform("CmdOrCtrl+Shift+N", "darwin"),
    ).toEqual(["⌘", "⇧", "N"]);
    expect(formatChordForPlatform("CmdOrCtrl+Shift+N", "other")).toEqual([
      "Ctrl",
      "Shift",
      "N",
    ]);
  });
  test("platform resolves from the user agent like App does", () => {
    expect(resolveShortcutPlatform("Macintosh")).toBe("darwin");
    expect(resolveShortcutPlatform("Windows")).toBe("other");
  });
  test("displayKey uppercases single chars and capitalises names", () => {
    expect(displayKey("n")).toBe("N");
    expect(displayKey(",")).toBe(",");
    expect(displayKey("escape")).toBe("Escape");
  });
  test("filtering matches title, id or chord and ignores case", () => {
    const entries = buildShortcutList();
    expect(filterShortcuts(entries, "").length).toBe(entries.length);
    const terminal = filterShortcuts(entries, "terminal");
    expect(terminal.map((e) => e.id)).toContain("workspace.newTerminal");
    expect(filterShortcuts(entries, "CMDORCTRL+P")).toContainEqual(
      expect.objectContaining({ id: "palette.openQuickOpen" }),
    );
    expect(filterShortcuts(entries, "no-such-shortcut")).toEqual([]);
  });
});
