// Pane-scoped browser defaults use the shared registry and prefer browser scope.
import { describe, expect, test } from "vitest";
import { matchBrowserPaneChord } from "./browser-pane-keyboard";

function key(
  overrides: Partial<KeyboardEvent> & { key: string },
  isMac = true,
): ReturnType<typeof matchBrowserPaneChord> {
  return matchBrowserPaneChord(
    {
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      ...overrides,
    },
    isMac,
  );
}

describe("browser pane chords", () => {
  test("macOS chords ride Cmd", () => {
    expect(key({ key: "l", metaKey: true })).toBe("focus-address-bar");
    expect(key({ key: "r", metaKey: true })).toBe("reload");
    expect(key({ key: "f", metaKey: true })).toBe("find");
    expect(key({ key: "[", metaKey: true })).toBe("back");
    expect(key({ key: "]", metaKey: true })).toBe("forward");
    expect(key({ key: "L", metaKey: true })).toBe("focus-address-bar");
  });

  test("other platforms ride Ctrl", () => {
    expect(key({ key: "l", ctrlKey: true }, false)).toBe("focus-address-bar");
    expect(key({ key: "r", ctrlKey: true }, false)).toBe("reload");
    expect(key({ key: "f", ctrlKey: true }, false)).toBe("find");
    expect(key({ key: "ArrowLeft", altKey: true }, false)).toBe("back");
    expect(key({ key: "ArrowRight", altKey: true }, false)).toBe("forward");
    expect(key({ key: "l", metaKey: true }, false)).toBeNull();
  });

  test("bare keys and unrelated variants never match", () => {
    expect(key({ key: "l" })).toBeNull();
    expect(key({ key: "l", metaKey: true, shiftKey: true })).toBeNull();
    expect(key({ key: "l", metaKey: true, altKey: true })).toBeNull();
    expect(key({ key: "r", ctrlKey: true })).toBeNull();
    expect(key({ key: "x", metaKey: true })).toBeNull();
  });

  test("shifted reload is the source hard-reload chord", () => {
    expect(key({ key: "r", metaKey: true, shiftKey: true })).toBe(
      "hard-reload",
    );
  });

  test("the wrong-platform mod never matches, even combined", () => {
    expect(key({ key: "l", ctrlKey: true })).toBeNull();
    expect(key({ key: "l", metaKey: true, ctrlKey: true })).toBeNull();
  });
});
