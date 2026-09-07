import { describe, expect, test, vi } from "vitest";
import {
  createShortcutRegistry,
  guardHandler,
  matchesChord,
  PALETTE_SHORTCUTS,
  parseChord,
  resolveModifier,
  type ShortcutEventLike,
} from "./shortcuts";

function event(overrides: Partial<ShortcutEventLike>): ShortcutEventLike {
  return {
    key: "",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  };
}

describe("resolveModifier", () => {
  test("resolves darwin to meta", () => {
    expect(resolveModifier("darwin")).toBe("meta");
  });

  test("resolves linux to ctrl", () => {
    expect(resolveModifier("linux")).toBe("ctrl");
  });

  test("resolves win32 to ctrl", () => {
    expect(resolveModifier("win32")).toBe("ctrl");
  });

  test("resolves any non-darwin platform to ctrl", () => {
    expect(resolveModifier("freebsd")).toBe("ctrl");
  });
});

describe("parseChord", () => {
  test("parses CmdOrCtrl+Shift+N into flags and lowercase key", () => {
    expect(parseChord("CmdOrCtrl+Shift+N")).toEqual({
      cmdOrCtrl: true,
      shift: true,
      alt: false,
      key: "n",
    });
  });

  test("parses a bare key with no modifiers", () => {
    expect(parseChord("Escape")).toEqual({
      cmdOrCtrl: false,
      shift: false,
      alt: false,
      key: "escape",
    });
  });

  test("parses Alt modifier", () => {
    expect(parseChord("Alt+F4")).toEqual({
      cmdOrCtrl: false,
      shift: false,
      alt: true,
      key: "f4",
    });
  });
});

describe("matchesChord across platforms", () => {
  const parsed = parseChord("CmdOrCtrl+Shift+N");

  test("matches meta+shift+n on darwin", () => {
    const evt = event({ metaKey: true, shiftKey: true, key: "N" });
    expect(matchesChord(parsed, evt, "darwin")).toBe(true);
  });

  test("does not match ctrl+shift+n on darwin (wrong modifier)", () => {
    const evt = event({ ctrlKey: true, shiftKey: true, key: "n" });
    expect(matchesChord(parsed, evt, "darwin")).toBe(false);
  });

  test("matches ctrl+shift+n on win32", () => {
    const evt = event({ ctrlKey: true, shiftKey: true, key: "n" });
    expect(matchesChord(parsed, evt, "win32")).toBe(true);
  });

  test("matches ctrl+shift+n on linux", () => {
    const evt = event({ ctrlKey: true, shiftKey: true, key: "n" });
    expect(matchesChord(parsed, evt, "linux")).toBe(true);
  });

  test("does not match meta+shift+n on linux (wrong modifier)", () => {
    const evt = event({ metaKey: true, shiftKey: true, key: "n" });
    expect(matchesChord(parsed, evt, "linux")).toBe(false);
  });

  test("does not match without shift", () => {
    const evt = event({ metaKey: true, key: "n" });
    expect(matchesChord(parsed, evt, "darwin")).toBe(false);
  });

  test("does not match wrong key", () => {
    const evt = event({ metaKey: true, shiftKey: true, key: "m" });
    expect(matchesChord(parsed, evt, "darwin")).toBe(false);
  });

  test("ignores unspecified alt state (parity with legacy sniffing)", () => {
    const evt = event({ metaKey: true, shiftKey: true, altKey: true, key: "n" });
    expect(matchesChord(parsed, evt, "darwin")).toBe(true);
  });
});

describe("createShortcutRegistry", () => {
  test("registers an action and resolves it via matchKeyEvent", () => {
    const registry = createShortcutRegistry();
    const handler = vi.fn();
    const registered = registry.register({
      id: "workspace.newTerminal",
      chord: "CmdOrCtrl+Shift+N",
      handler,
    });
    expect(registered).toBe(true);

    const evt = event({ metaKey: true, shiftKey: true, key: "n" });
    const match = registry.matchKeyEvent(evt, "darwin");
    expect(match).not.toBeNull();
    expect(match?.id).toBe("workspace.newTerminal");
    expect(match?.handler).toBe(handler);
  });

  test("rejects a duplicate id and keeps the original registration", () => {
    const registry = createShortcutRegistry();
    const first = vi.fn();
    const second = vi.fn();
    expect(
      registry.register({ id: "dup", chord: "CmdOrCtrl+K", handler: first }),
    ).toBe(true);
    expect(
      registry.register({ id: "dup", chord: "CmdOrCtrl+J", handler: second }),
    ).toBe(false);

    const evt = event({ metaKey: true, key: "k" });
    const match = registry.matchKeyEvent(evt, "darwin");
    expect(match?.handler).toBe(first);
  });

  test("returns null for an event that matches no registered action", () => {
    const registry = createShortcutRegistry();
    registry.register({
      id: "workspace.newTerminal",
      chord: "CmdOrCtrl+Shift+N",
      handler: vi.fn(),
    });
    const evt = event({ key: "z" });
    expect(registry.matchKeyEvent(evt, "darwin")).toBeNull();
  });

  test("unregister removes an action so it no longer matches", () => {
    const registry = createShortcutRegistry();
    registry.register({
      id: "workspace.newTerminal",
      chord: "CmdOrCtrl+Shift+N",
      handler: vi.fn(),
    });
    registry.unregister("workspace.newTerminal");
    const evt = event({ metaKey: true, shiftKey: true, key: "n" });
    expect(registry.matchKeyEvent(evt, "darwin")).toBeNull();
  });

  test("after unregister, the same id can be registered again", () => {
    const registry = createShortcutRegistry();
    registry.register({ id: "dup", chord: "CmdOrCtrl+K", handler: vi.fn() });
    registry.unregister("dup");
    expect(
      registry.register({ id: "dup", chord: "CmdOrCtrl+J", handler: vi.fn() }),
    ).toBe(true);
  });
});

describe("PALETTE_SHORTCUTS", () => {
  function registeredIds(): string[] {
    const registry = createShortcutRegistry();
    for (const def of PALETTE_SHORTCUTS)
      registry.register({ ...def, handler: () => {} });
    return PALETTE_SHORTCUTS.map((def) => def.id);
  }

  test("declares the palette, quick open and tab chords", () => {
    expect(registeredIds()).toEqual([
      "palette.openCommands",
      "palette.openQuickOpen",
      "tabs.select1",
      "tabs.select2",
      "tabs.select3",
      "tabs.select4",
      "tabs.select5",
      "tabs.select6",
      "tabs.select7",
      "tabs.select8",
      "tabs.select9",
      "tabs.prev",
      "tabs.next",
    ]);
  });

  test("CmdOrCtrl+K opens the palette on darwin and ctrl+k elsewhere", () => {
    const parsed = parseChord("CmdOrCtrl+K");
    expect(
      matchesChord(parsed, event({ metaKey: true, key: "k" }), "darwin"),
    ).toBe(true);
    expect(
      matchesChord(parsed, event({ ctrlKey: true, key: "k" }), "linux"),
    ).toBe(true);
    expect(
      matchesChord(parsed, event({ ctrlKey: true, key: "k" }), "darwin"),
    ).toBe(false);
  });

  test("CmdOrCtrl+P opens quick open", () => {
    const parsed = parseChord("CmdOrCtrl+P");
    expect(
      matchesChord(parsed, event({ metaKey: true, key: "p" }), "darwin"),
    ).toBe(true);
  });

  test("CmdOrCtrl+1..9 select tabs by digit", () => {
    for (let digit = 1; digit <= 9; digit += 1) {
      const parsed = parseChord(`CmdOrCtrl+${digit}`);
      expect(
        matchesChord(
          parsed,
          event({ metaKey: true, key: String(digit) }),
          "darwin",
        ),
      ).toBe(true);
    }
    const first = parseChord("CmdOrCtrl+1");
    expect(
      matchesChord(first, event({ metaKey: true, key: "2" }), "darwin"),
    ).toBe(false);
  });

  test("CmdOrCtrl+Shift+[ and ] move across tabs", () => {
    const prev = parseChord("CmdOrCtrl+Shift+[");
    expect(
      matchesChord(
        prev,
        event({ metaKey: true, shiftKey: true, key: "[" }),
        "darwin",
      ),
    ).toBe(true);
    expect(
      matchesChord(
        prev,
        event({ metaKey: true, key: "[" }),
        "darwin",
      ),
    ).toBe(false);
    const next = parseChord("CmdOrCtrl+Shift+]");
    expect(
      matchesChord(
        next,
        event({ ctrlKey: true, shiftKey: true, key: "]" }),
        "win32",
      ),
    ).toBe(true);
  });

  test("every declared chord round-trips through the registry", () => {
    const registry = createShortcutRegistry();
    for (const def of PALETTE_SHORTCUTS)
      expect(registry.register({ ...def, handler: () => {} })).toBe(true);
    const match = registry.matchKeyEvent(
      event({ metaKey: true, key: "k" }),
      "darwin",
    );
    expect(match?.id).toBe("palette.openCommands");
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
