// MIT Copyright (c) 2026 Lovecast Inc.
// Covers the source's ShortcutKeyCombo / useShortcutLabel projections as
// adapted in shortcut-labels.ts: macOS glyphs vs platform words, straight
// from the keybinding definitions table (single source).
import { describe, expect, test } from "vitest";
import {
  formatShortcutChordHint,
  formatShortcutKeyComboDetails,
} from "./shortcut-labels";

describe("shortcut keycap formatting", () => {
  test("macOS renders glyphs without separators", () => {
    expect(
      formatShortcutKeyComboDetails("worktree.navigateUp", "darwin"),
    ).toEqual([{ keys: ["⌘", "⇧", "↑"], doubleTap: false }]);
  });
  test("other platforms render words joined with +", () => {
    expect(
      formatShortcutKeyComboDetails("worktree.navigateUp", "other"),
    ).toEqual([{ keys: ["Ctrl", "Shift", "↑"], doubleTap: false }]);
  });
  test("the worktree palette reads ⌘J on macOS and Ctrl+Shift+J elsewhere", () => {
    expect(formatShortcutKeyComboDetails("worktree.palette", "darwin")).toEqual(
      [{ keys: ["⌘", "J"], doubleTap: false }],
    );
    expect(formatShortcutKeyComboDetails("worktree.palette", "other")).toEqual([
      { keys: ["Ctrl", "Shift", "J"], doubleTap: false },
    ]);
  });
  test("workspace.create exposes both chords in table order", () => {
    const details = formatShortcutKeyComboDetails("workspace.create", "darwin");
    expect(details).toHaveLength(2);
    expect(details[0]?.keys).toEqual(["⌘", "N"]);
    expect(details[1]?.keys).toEqual(["⌘", "⇧", "N"]);
  });
  test("source rows expose their default chips and hint", () => {
    expect(formatShortcutKeyComboDetails("tab.close", "darwin")).toEqual([
      { keys: ["⌘", "W"], doubleTap: false },
    ]);
    expect(formatShortcutChordHint("tab.close", "darwin")).toBe("⌘W");
  });
  test("unknown actions render nothing", () => {
    expect(formatShortcutKeyComboDetails("no.suchAction", "darwin")).toEqual(
      [],
    );
  });
  test("chord hints: primary binding only, platform-correct", () => {
    expect(formatShortcutChordHint("tab.newTerminal", "darwin")).toBe("⌘T");
    expect(formatShortcutChordHint("tab.newTerminal", "other")).toBe("Ctrl+T");
    expect(formatShortcutChordHint("app.settings", "darwin")).toBe("⌘,");
    expect(formatShortcutChordHint("worktree.palette", "other")).toBe(
      "Ctrl+Shift+J",
    );
  });
});
