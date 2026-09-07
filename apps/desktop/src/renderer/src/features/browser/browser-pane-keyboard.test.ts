// Pane-scoped chords: Mod+L/R/F only, on the platform Mod, never shifted.
import { describe, expect, test } from "vitest";
import { matchBrowserPaneChord } from "./browser-pane-keyboard";

function key(
  overrides: Partial<KeyboardEvent> & { key: string },
  isMac = true,
): ReturnType<typeof matchBrowserPaneChord> {
  return matchBrowserPaneChord(
    { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...overrides },
    isMac,
  );
}

describe("browser pane chords", () => {
  test("macOS chords ride Cmd", () => {
    expect(key({ key: "l", metaKey: true })).toBe("focus-address-bar");
    expect(key({ key: "r", metaKey: true })).toBe("reload");
    expect(key({ key: "f", metaKey: true })).toBe("find");
    expect(key({ key: "L", metaKey: true })).toBe("focus-address-bar");
  });

  test("other platforms ride Ctrl", () => {
    expect(key({ key: "l", ctrlKey: true }, false)).toBe("focus-address-bar");
    expect(key({ key: "r", ctrlKey: true }, false)).toBe("reload");
    expect(key({ key: "f", ctrlKey: true }, false)).toBe("find");
    expect(key({ key: "l", metaKey: true }, false)).toBeNull();
  });

  test("bare keys and shifted/alt variants never match", () => {
    expect(key({ key: "l" })).toBeNull();
    expect(key({ key: "l", metaKey: true, shiftKey: true })).toBeNull();
    expect(key({ key: "l", metaKey: true, altKey: true })).toBeNull();
    expect(key({ key: "r", ctrlKey: true })).toBeNull();
    expect(key({ key: "x", metaKey: true })).toBeNull();
  });

  test("the wrong-platform mod never matches, even combined", () => {
    expect(key({ key: "l", ctrlKey: true })).toBeNull();
    expect(key({ key: "l", metaKey: true, ctrlKey: true })).toBeNull();
  });
});
