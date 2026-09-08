// MIT Copyright (c) 2026 Lovecast Inc.
// Tests for the J10 keybinding overrides: envelope parsing, override
// normalization, effective bindings, key-event capture and the persisted
// round-trip (in-memory storage double; the live envelope is exercised
// through the Shortcuts section walkthrough).
import { describe, expect, test } from "vitest";
import {
  getKeybindingDefinition,
  type KeybindingPlatform,
} from "./definitions";
import { createKeybindingRegistry } from "./registry";
import {
  getEffectiveBindings,
  isModifierOnlyKey,
  keybindingFromKeyEvent,
  normalizeOverrideList,
  parseOverridesEnvelope,
  readPersistedKeybindingOverrides,
  writePersistedKeybindingOverrides,
  type KeybindingOverrideStorage,
  type KeybindingOverrides,
} from "./overrides";

const DARWIN: KeybindingPlatform = "darwin";

function memoryStorage(initial?: string): KeybindingOverrideStorage {
  let value: string | null = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
  };
}

describe("parseOverridesEnvelope", () => {
  test("rejects malformed and foreign envelopes", () => {
    expect(parseOverridesEnvelope(null)).toEqual({});
    expect(parseOverridesEnvelope("")).toEqual({});
    expect(parseOverridesEnvelope("not json")).toEqual({});
    expect(parseOverridesEnvelope("[]")).toEqual({});
    expect(parseOverridesEnvelope("{}")).toEqual({});
    expect(parseOverridesEnvelope('{"settings":{}}')).toEqual({});
  });
  test("keeps valid lists, drops unknown ids and invalid chords", () => {
    const parsed = parseOverridesEnvelope(
      JSON.stringify({
        version: 1,
        overrides: {
          "sidebar.left.toggle": ["Mod+Shift+B"],
          "bogus.action": ["Mod+X"],
          "app.settings": "Mod+Comma",
          "tab.newTerminal": ["bogus chord !!", "Mod+T"],
        },
      }),
    );
    expect(parsed).toEqual({
      "sidebar.left.toggle": ["Mod+Shift+B"],
      "tab.newTerminal": ["Mod+T"],
    });
  });
});

describe("normalizeOverrideList", () => {
  test("canonicalizes chords and dedupes", () => {
    const definition = getKeybindingDefinition("sidebar.left.toggle")!;
    expect(
      normalizeOverrideList(definition, ["Mod+Shift+B", "Mod+Shift+B"]),
    ).toEqual(["Mod+Shift+B"]);
    expect(normalizeOverrideList(definition, "Mod+B")).toBeNull();
    expect(normalizeOverrideList(definition, ["nope !!"])).toEqual([]);
  });
  test("canonicalizes digit-index rows to the …+1 representative", () => {
    const definition = getKeybindingDefinition("workspace.selectByIndex")!;
    expect(normalizeOverrideList(definition, ["Mod+5"])).toEqual(["Mod+1"]);
  });
});

describe("getEffectiveBindings", () => {
  test("override wins when present, defaults otherwise", () => {
    const definition = getKeybindingDefinition("sidebar.left.toggle")!;
    expect(getEffectiveBindings(definition, DARWIN, {})).toEqual(["Mod+B"]);
    const overrides: KeybindingOverrides = {
      "sidebar.left.toggle": ["Mod+Shift+B"],
    };
    expect(getEffectiveBindings(definition, DARWIN, overrides)).toEqual([
      "Mod+Shift+B",
    ]);
    expect(getEffectiveBindings(definition, DARWIN, null)).toEqual(["Mod+B"]);
  });
  test("empty override unassigns the action", () => {
    const definition = getKeybindingDefinition("sidebar.left.toggle")!;
    expect(
      getEffectiveBindings(definition, DARWIN, { "sidebar.left.toggle": [] }),
    ).toEqual([]);
  });
});

describe("registry honors overrides", () => {
  test("rebound chord matches, the old chord goes dead", () => {
    const registry = createKeybindingRegistry();
    const overrides: KeybindingOverrides = {
      "sidebar.left.toggle": ["Mod+Shift+B"],
    };
    expect(
      registry.match(
        { key: "B", metaKey: true, shiftKey: true },
        DARWIN,
        "app",
        { overrides },
      )?.id,
    ).toBe("sidebar.left.toggle");
    expect(
      registry.match({ key: "b", metaKey: true }, DARWIN, "app", { overrides }),
    )?.not.toBe("sidebar.left.toggle");
  });
  test("a conflicting override surfaces in findConflicts", () => {
    const registry = createKeybindingRegistry();
    expect(registry.findConflicts(DARWIN, {})).toEqual([]);
    const conflicts = registry.findConflicts(DARWIN, {
      "sidebar.left.toggle": ["Mod+Comma"],
    });
    const bucket = conflicts.find((claimed) =>
      claimed.some((entry) => entry.id === "sidebar.left.toggle"),
    );
    expect(bucket?.map((entry) => entry.id).sort()).toEqual(
      ["app.settings", "sidebar.left.toggle"].sort(),
    );
  });
  test("unassigned action never matches", () => {
    const registry = createKeybindingRegistry();
    expect(
      registry.match({ key: "b", metaKey: true }, DARWIN, "app", {
        overrides: { "sidebar.left.toggle": [] },
      }),
    ).toBeNull();
  });
});

describe("keybindingFromKeyEvent", () => {
  test("canonicalizes the platform primary modifier to Mod", () => {
    expect(
      keybindingFromKeyEvent(
        { key: "B", metaKey: true, shiftKey: true },
        DARWIN,
      ),
    ).toEqual({ ok: true, value: "Mod+Shift+B" });
    expect(
      keybindingFromKeyEvent({ key: "b", ctrlKey: true }, "linux"),
    ).toEqual({ ok: true, value: "Mod+B" });
  });
  test("keeps the secondary platform modifier", () => {
    // Ctrl without Cmd on macOS stores as a Ctrl chord.
    expect(
      keybindingFromKeyEvent({ key: "b", ctrlKey: true }, DARWIN),
    ).toEqual({ ok: true, value: "Ctrl+B" });
    // Cmd on Linux stores as a Cmd chord.
    expect(
      keybindingFromKeyEvent({ key: "b", metaKey: true }, "linux"),
    ).toEqual({ ok: true, value: "Cmd+B" });
    // The chord grammar cannot express primary+secondary together
    // (normalizeChord rejects Mod+Ctrl), and dispatch matches modifiers
    // exactly — so the capture refuses instead of storing a chord that
    // would never fire for the pressed keys.
    expect(
      keybindingFromKeyEvent({ key: "b", metaKey: true, ctrlKey: true }, DARWIN),
    ).toEqual({ ok: false, error: "Unable to parse shortcut." });
  });
  test("rejects modifier-only presses and bare typing keys", () => {
    expect(isModifierOnlyKey("Control")).toBe(true);
    expect(isModifierOnlyKey("b")).toBe(false);
    expect(
      keybindingFromKeyEvent({ key: "Control", ctrlKey: true }, DARWIN),
    ).toEqual({ ok: false, error: "Press a key, not only a modifier." });
    const bare = keybindingFromKeyEvent({ key: "b" }, DARWIN);
    expect(bare.ok).toBe(false);
    // Safe bare keys (function keys) are accepted.
    expect(keybindingFromKeyEvent({ key: "F5" }, DARWIN)).toEqual({
      ok: true,
      value: "F5",
    });
  });
  test("rejects unparseable keys", () => {
    expect(keybindingFromKeyEvent({ key: "?" }, DARWIN).ok).toBe(false);
  });
});

describe("persisted overrides round-trip", () => {
  test("write then read preserves the map", () => {
    const storage = memoryStorage();
    const overrides: KeybindingOverrides = {
      "sidebar.left.toggle": ["Mod+Shift+B"],
    };
    expect(writePersistedKeybindingOverrides(overrides, storage)).toBe(true);
    expect(readPersistedKeybindingOverrides(storage)).toEqual(overrides);
  });
  test("failing storage reads as empty", () => {
    expect(readPersistedKeybindingOverrides(null)).toEqual({});
    expect(readPersistedKeybindingOverrides(undefined)).toEqual({});
  });
});
