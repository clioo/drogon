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
import { filterSettingsSections } from "./settings-search";

describe("settings sections", () => {
  test("declares the seven J10 sections in reference sidebar order", () => {
    expect(SETTINGS_SECTIONS.map((s) => s.id)).toEqual([
      "agents",
      "general",
      "git",
      "terminal",
      "appearance",
      "notifications",
      "shortcuts",
    ]);
    expect(DEFAULT_SETTINGS_SECTION).toBe("general");
    expect(isSettingsSectionId("agents")).toBe(true);
    expect(isSettingsSectionId("general")).toBe(true);
    expect(isSettingsSectionId("bogus")).toBe(false);
  });

  test("groups follow the reference nav groups (capabilities, setup, workflows, interface)", () => {
    const byId = new Map(SETTINGS_SECTIONS.map((s) => [s.id, s.group]));
    expect(byId.get("agents")).toBe("capabilities");
    expect(byId.get("general")).toBe("setup");
    expect(byId.get("git")).toBe("workflows");
    expect(byId.get("terminal")).toBe("workflows");
    expect(byId.get("appearance")).toBe("interface");
    expect(byId.get("notifications")).toBe("interface");
    expect(byId.get("shortcuts")).toBe("interface");
  });

  test("every section carries the reference nav icon", () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(section.icon).toBeDefined();
    }
  });

  test("general search bucket matches the ported rows", () => {
    expect(filterSettingsSections("")).toEqual([
      "agents",
      "general",
      "git",
      "terminal",
      "appearance",
      "notifications",
      "shortcuts",
    ]);
    expect(filterSettingsSections("cli")).toEqual(["general"]);
    expect(filterSettingsSections("ask before deleting")).toEqual(["general"]);
    expect(filterSettingsSections("star")).toEqual(["general"]);
  });

  test("terminal search bucket matches the manage-sessions rows", () => {
    expect(filterSettingsSections("sessions")).toEqual(["terminal"]);
    expect(filterSettingsSections("kill")).toEqual(["terminal"]);
    expect(filterSettingsSections("shells")).toEqual(["terminal"]);
    expect(filterSettingsSections("terminal font")).toEqual(["appearance"]);
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
  test("the list covers the source-parity table in source order", () => {
    const entries = buildShortcutList("other");
    const ids = entries.map((e) => e.id);
    expect(ids).toContain("app.settings");
    expect(ids).toContain("tab.newTerminal");
    expect(ids).toContain("workspace.create");
    expect(ids).toContain("terminal.clear");
    expect(ids).toContain("worktree.palette");
    expect(ids).toContain("worktree.quickOpen");
    expect(ids).toContain("tab.selectByIndex");
    expect(ids).toContain("tab.previousAllTypes");
    // Source group order: Global rows precede Tabs, Tab Navigation,
    // Settings and Terminal Panes rows.
    expect(ids.indexOf("worktree.quickOpen")).toBeLessThan(
      ids.indexOf("tab.newTerminal"),
    );
    expect(ids.indexOf("tab.newTerminal")).toBeLessThan(
      ids.indexOf("tab.nextAllTypes"),
    );
    expect(ids.indexOf("tab.nextAllTypes")).toBeLessThan(
      ids.indexOf("settings.search"),
    );
    expect(ids.indexOf("settings.search")).toBeLessThan(
      ids.indexOf("terminal.clear"),
    );
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
  test("displayKey uppercases single chars and uses source key labels", () => {
    expect(displayKey("n")).toBe("N");
    expect(displayKey(",")).toBe(",");
    expect(displayKey("escape")).toBe("Esc");
  });
  test("filtering matches title, id, group or chord and ignores case", () => {
    const entries = buildShortcutList("other");
    expect(filterShortcuts(entries, "").length).toBe(entries.length);
    const terminal = filterShortcuts(entries, "terminal");
    expect(terminal.map((e) => e.id)).toContain("terminal.clear");
    expect(filterShortcuts(entries, "MOD+P")).toContainEqual(
      expect.objectContaining({ id: "worktree.quickOpen" }),
    );
    expect(filterShortcuts(entries, "no-such-shortcut")).toEqual([]);
  });
});
