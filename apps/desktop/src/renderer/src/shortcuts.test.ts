import { describe, expect, test, vi } from "vitest";
import {
  chordsForPlatform,
  guardHandler,
  PALETTE_SHORTCUT_IDS,
  PALETTE_SHORTCUTS,
  paletteChordFor,
} from "./shortcuts";
import { getKeybindingDefinition } from "./keybindings/definitions";

describe("PALETTE_SHORTCUTS", () => {
  test("declares the source palette, quick open and tab-travel ids", () => {
    expect(PALETTE_SHORTCUT_IDS).toEqual([
      "worktree.quickOpen",
      "worktree.palette",
      "tab.nextSameType",
      "tab.previousSameType",
      "tab.nextAllTypes",
      "tab.previousAllTypes",
      "tab.selectByIndex",
    ]);
    expect(PALETTE_SHORTCUTS.map((def) => def.id)).toEqual(
      PALETTE_SHORTCUT_IDS,
    );
  });

  test("every palette row resolves to its source definition", () => {
    for (const def of PALETTE_SHORTCUTS) {
      expect(getKeybindingDefinition(def.id)?.title).toBe(def.title);
    }
  });

  test("palette chord is platform-correct (Mod+J mac, Mod+Shift+J away)", () => {
    expect(paletteChordFor("worktree.palette", "darwin")).toBe("Mod+J");
    expect(paletteChordFor("worktree.palette", "other")).toBe("Mod+Shift+J");
    expect(paletteChordFor("worktree.quickOpen", "darwin")).toBe("Mod+P");
    expect(paletteChordFor("worktree.quickOpen", "other")).toBe("Mod+P");
  });

  test("tab-travel chords match the source", () => {
    expect(paletteChordFor("tab.nextAllTypes", "other")).toBe(
      "Mod+Shift+BracketRight",
    );
    expect(paletteChordFor("tab.previousAllTypes", "other")).toBe(
      "Mod+Shift+BracketLeft",
    );
    expect(paletteChordFor("tab.nextSameType", "darwin")).toBe(
      "Mod+Alt+BracketRight",
    );
    // Tab index uses the source per-platform representative chord.
    expect(paletteChordFor("tab.selectByIndex", "darwin")).toBe("Ctrl+1");
    expect(paletteChordFor("tab.selectByIndex", "other")).toBe("Alt+1");
  });

  test("non-palette ids have no palette chord", () => {
    expect(paletteChordFor("workspace.create", "darwin")).toBeNull();
    expect(paletteChordFor("no.such.id", "darwin")).toBeNull();
  });

  test("chordsForPlatform exposes every binding of a row", () => {
    const create = getKeybindingDefinition("workspace.create");
    expect(create && chordsForPlatform(create, "other")).toEqual([
      "Mod+N",
      "Mod+Shift+N",
    ]);
  });
});

describe("guardHandler", () => {
  test("does not invoke the handler when disabled", () => {
    const handler = vi.fn();
    const wrapped = guardHandler(handler, () => true);
    wrapped();
    expect(handler).not.toHaveBeenCalled();
  });

  test("invokes the handler when not disabled", () => {
    const handler = vi.fn();
    const wrapped = guardHandler(handler, () => false);
    wrapped();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("re-evaluates the guard predicate on each call", () => {
    let busy = true;
    const handler = vi.fn();
    const wrapped = guardHandler(handler, () => busy);
    wrapped();
    expect(handler).not.toHaveBeenCalled();
    busy = false;
    wrapped();
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
