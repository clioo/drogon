// Tests for the keybinding core: parser, platform labels, registry
// uniqueness (no duplicate chord in the same scope), and dispatcher scope
// rules. Source parity: parser/labels mirror
// src/shared/keybindings/{parser,formatting}.ts.
import { describe, expect, test } from "vitest";
import {
  bindingsForPlatform,
  KEYBINDING_DEFINITIONS,
  keybindingGroupOrder,
  resolveKeybindingPlatform,
} from "./definitions";
import { shouldDispatch } from "./dispatcher";
import {
  formatKeybinding,
  formatKeybindingList,
} from "./labels";
import {
  canonicalizeParsedKeybinding,
  normalizeChord,
  parseKeybinding,
} from "./parser";
import { createKeybindingRegistry } from "./registry";

function input(
  key: string,
  modifiers: {
    meta?: boolean;
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
  } = {},
) {
  return {
    key,
    metaKey: modifiers.meta ?? false,
    ctrlKey: modifiers.ctrl ?? false,
    shiftKey: modifiers.shift ?? false,
    altKey: modifiers.alt ?? false,
  };
}

describe("parser", () => {
  test("parses Mod+Shift+N into flags and an uppercase key", () => {
    expect(parseKeybinding("Mod+Shift+N")).toEqual({
      mod: true,
      meta: false,
      control: false,
      alt: false,
      shift: true,
      key: "N",
    });
  });

  test("accepts the legacy CmdOrCtrl spelling as Mod", () => {
    expect(parseKeybinding("CmdOrCtrl+K")).toEqual({
      mod: true,
      meta: false,
      control: false,
      alt: false,
      shift: false,
      key: "K",
    });
  });

  test("parses physical modifiers and punctuation aliases", () => {
    expect(parseKeybinding("Ctrl+1")).toMatchObject({
      control: true,
      key: "1",
    });
    expect(parseKeybinding("Mod+Comma")).toMatchObject({
      mod: true,
      key: "Comma",
    });
    expect(parseKeybinding("Mod+Shift+BracketRight")).toMatchObject({
      mod: true,
      shift: true,
      key: "BracketRight",
    });
    expect(parseKeybinding("Mod+Alt+ArrowLeft")).toMatchObject({
      mod: true,
      alt: true,
      key: "ArrowLeft",
    });
  });

  test("rejects empty, keyless, double-key and unknown chords", () => {
    expect(parseKeybinding("")).toBeNull();
    expect(parseKeybinding("Mod+Shift")).toBeNull();
    expect(parseKeybinding("Mod+A+B")).toBeNull();
    expect(parseKeybinding("Mod+Frobnicator")).toBeNull();
  });

  test("canonicalizes to Mod-first source order", () => {
    const parsed = parseKeybinding("Shift+CmdOrCtrl+N");
    expect(parsed && canonicalizeParsedKeybinding(parsed)).toBe("Mod+Shift+N");
  });

  test("normalizeChord rejects Mod mixed with a platform modifier", () => {
    expect(normalizeChord("Mod+Ctrl+N")).toBeNull();
    expect(normalizeChord("Mod+Shift+N")).toBe("Mod+Shift+N");
  });

  test("every stored table chord parses", () => {
    for (const definition of KEYBINDING_DEFINITIONS) {
      for (const platform of ["darwin", "linux", "win32"] as const) {
        for (const chord of bindingsForPlatform(definition, platform)) {
          expect(
            parseKeybinding(chord),
            `${definition.id} ${platform} ${chord}`,
          ).not.toBeNull();
        }
      }
    }
  });
});

describe("platform labels", () => {
  test("macOS uses symbols with no separator, others use words", () => {
    expect(formatKeybinding("Mod+Comma", "darwin")).toEqual(["⌘", ","]);
    expect(formatKeybinding("Mod+Comma", "linux")).toEqual(["Ctrl", ","]);
    expect(formatKeybinding("Mod+Shift+N", "darwin")).toEqual([
      "⌘",
      "⇧",
      "N",
    ]);
    expect(formatKeybinding("Mod+Shift+N", "win32")).toEqual([
      "Ctrl",
      "Shift",
      "N",
    ]);
  });

  test("physical modifiers and special keys render per platform", () => {
    expect(formatKeybinding("Ctrl+1", "darwin")).toEqual(["⌃", "1"]);
    expect(formatKeybinding("Alt+1", "linux")).toEqual(["Alt", "1"]);
    expect(formatKeybinding("Mod+Alt+ArrowLeft", "darwin")).toEqual([
      "⌘",
      "⌥",
      "←",
    ]);
    expect(formatKeybinding("Mod+Shift+BracketRight", "linux")).toEqual([
      "Ctrl",
      "Shift",
      "]",
    ]);
    expect(formatKeybinding("Mod+0", "darwin")).toEqual(["⌘", "0"]);
  });

  test("binding lists join and empty lists read Unassigned", () => {
    expect(
      formatKeybindingList(["Mod+Equal", "Mod+Shift+Plus"], "darwin"),
    ).toBe("⌘=, ⌘⇧+");
    expect(
      formatKeybindingList(["Mod+Equal", "Mod+Shift+Plus"], "linux"),
    ).toBe("Ctrl+=, Ctrl+Shift++");
    expect(formatKeybindingList([], "darwin")).toBe("Unassigned");
  });
});

describe("registry uniqueness", () => {
  test("no duplicate chord in the same scope on any platform", () => {
    const registry = createKeybindingRegistry();
    for (const platform of ["darwin", "linux", "win32"] as const) {
      expect(registry.findConflicts(platform)).toEqual([]);
    }
  });

  test("ids are unique across the table", () => {
    const ids = KEYBINDING_DEFINITIONS.map((definition) => definition.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("groups follow source first-appearance order", () => {
    expect(keybindingGroupOrder()).toEqual([
      "Global",
      "Tabs",
      "Tab Navigation",
      "Settings",
      "Terminal Panes",
    ]);
  });

  test("this MVP subset has no linux/win32 divergence", () => {
    for (const definition of KEYBINDING_DEFINITIONS) {
      expect(
        [...definition.defaultBindings.linux],
        `${definition.id} linux/win32`,
      ).toEqual([...definition.defaultBindings.win32]);
    }
    expect(resolveKeybindingPlatform("other")).toBe("linux");
    expect(resolveKeybindingPlatform("darwin")).toBe("darwin");
  });

  test("digit-index representatives fire for any of 1-9", () => {
    const registry = createKeybindingRegistry();
    // Mod+5 selects the 5th workspace (index 4).
    expect(
      registry.match(input("5", { meta: true }), "darwin", "app"),
    ).toEqual({ id: "workspace.selectByIndex", digitIndex: 4 });
    // Ctrl+3 on macOS selects the 3rd tab; Mod+3 stays the workspace chord.
    expect(
      registry.match(input("3", { ctrl: true }), "darwin", "app"),
    ).toEqual({ id: "tab.selectByIndex", digitIndex: 2 });
    expect(
      registry.match(input("3", { meta: true }), "darwin", "app")?.id,
    ).toBe("workspace.selectByIndex");
    // Alt+2 selects the 2nd tab off macOS.
    expect(registry.match(input("2", { alt: true }), "linux", "app")).toEqual({
      id: "tab.selectByIndex",
      digitIndex: 1,
    });
  });

  test("disabled rows never match but keep their chords reserved", () => {
    const registry = createKeybindingRegistry();
    // Mod+W (tab.close) matches nothing…
    expect(registry.match(input("w", { meta: true }), "darwin", "app")).toBeNull();
    // …while R16-N enables the fork's Mod+D splitRight chord in the
    // terminal scope (splitDown stays disabled with the rest of #129).
    expect(
      registry.match(input("d", { meta: true }), "darwin", "terminal")?.id,
    ).toBe("terminal.splitRight");
    expect(
      registry.match(input("d", { meta: true }), "darwin", "app"),
    ).toBeNull();
    // …yet the table still owns those chords, so a future registration
    // cannot silently claim them: the conflict scan stays empty only
    // because no second action claims them.
    const ids = KEYBINDING_DEFINITIONS.map((definition) => definition.id);
    expect(ids).toContain("tab.close");
    expect(ids).toContain("terminal.splitRight");
    expect(ids).toContain("terminal.splitDown");
    expect(ids).toContain("tab.newBrowser");
    expect(ids).toContain("tab.reopenClosed");
  });

  test("platform-specific palette chord resolves per platform", () => {
    const registry = createKeybindingRegistry();
    expect(registry.match(input("j", { meta: true }), "darwin", "app")?.id).toBe(
      "worktree.palette",
    );
    expect(
      registry.match(input("j", { ctrl: true, shift: true }), "linux", "app")
        ?.id,
    ).toBe("worktree.palette");
    expect(
      registry.match(input("j", { ctrl: true }), "linux", "app"),
    ).toBeNull();
  });

  test("exact modifier matching: extra modifiers do not match", () => {
    const registry = createKeybindingRegistry();
    expect(
      registry.match(input("p", { ctrl: true, shift: true }), "linux", "app"),
    ).toBeNull();
    expect(
      registry.match(input("p", { ctrl: true }), "linux", "app")?.id,
    ).toBe("worktree.quickOpen");
  });
});

describe("dispatcher scope rules", () => {
  test("terminal.clear runs only in terminal context", () => {
    expect(
      shouldDispatch({
        id: "terminal.clear",
        scope: "terminal",
        paletteOpen: false,
        context: "terminal",
        editableTarget: true,
      }),
    ).toBe(true);
    expect(
      shouldDispatch({
        id: "terminal.clear",
        scope: "terminal",
        paletteOpen: false,
        context: "app",
        editableTarget: false,
      }),
    ).toBe(false);
  });

  test("only app.settings tunnels through an open palette", () => {
    expect(
      shouldDispatch({
        id: "app.settings",
        scope: "global",
        paletteOpen: true,
        context: "app",
        editableTarget: false,
      }),
    ).toBe(true);
    expect(
      shouldDispatch({
        id: "workspace.create",
        scope: "global",
        paletteOpen: true,
        context: "app",
        editableTarget: false,
      }),
    ).toBe(false);
  });

  test("tabs chords and workspace index yield to editable targets", () => {
    expect(
      shouldDispatch({
        id: "tab.nextAllTypes",
        scope: "tabs",
        paletteOpen: false,
        context: "app",
        editableTarget: true,
      }),
    ).toBe(false);
    expect(
      shouldDispatch({
        id: "workspace.selectByIndex",
        scope: "global",
        paletteOpen: false,
        context: "app",
        editableTarget: true,
      }),
    ).toBe(false);
    expect(
      shouldDispatch({
        id: "tab.nextAllTypes",
        scope: "tabs",
        paletteOpen: false,
        context: "app",
        editableTarget: false,
      }),
    ).toBe(true);
  });

  test("global chords fire in the terminal (orca-first)", () => {
    expect(
      shouldDispatch({
        id: "sidebar.left.toggle",
        scope: "global",
        paletteOpen: false,
        context: "terminal",
        editableTarget: true,
      }),
    ).toBe(true);
  });

  test("registry match honors terminal scope end to end", () => {
    const registry = createKeybindingRegistry();
    const clear = input("k", { meta: true });
    expect(registry.match(clear, "darwin", "terminal")?.id).toBe(
      "terminal.clear",
    );
    expect(registry.match(clear, "darwin", "app")).toBeNull();
    const palette = input("j", { meta: true });
    expect(registry.match(palette, "darwin", "app")?.id).toBe(
      "worktree.palette",
    );
  });
});
