// MIT Copyright (c) 2026 Lovecast Inc. Step and bounds mirror the source's
// useTerminalFontZoom.ts (MIN 8, MAX 32, STEP 1); the chord layer is
// Drogon-new (container keydown instead of menu-accelerator events).
import { describe, expect, it } from "vitest";
import {
  fontZoomPercent,
  isTerminalSearchChord,
  matchFontZoomChord,
  nextFontZoomSize,
  TERMINAL_FONT_ZOOM_MAX,
  TERMINAL_FONT_ZOOM_MIN,
} from "./terminal-font-zoom";

describe("nextFontZoomSize", () => {
  it("steps in and out by one", () => {
    expect(
      nextFontZoomSize({ current: 14, base: 14, direction: "in" }),
    ).toEqual({ size: 15, override: 15 });
    expect(
      nextFontZoomSize({ current: 15, base: 14, direction: "out" }),
    ).toEqual({ size: 14, override: 14 });
  });

  it("clamps at the source's bounds", () => {
    expect(
      nextFontZoomSize({
        current: TERMINAL_FONT_ZOOM_MAX,
        base: 14,
        direction: "in",
      }).size,
    ).toBe(TERMINAL_FONT_ZOOM_MAX);
    expect(
      nextFontZoomSize({
        current: TERMINAL_FONT_ZOOM_MIN,
        base: 14,
        direction: "out",
      }).size,
    ).toBe(TERMINAL_FONT_ZOOM_MIN);
  });

  it("resets to the settings size and clears the override", () => {
    expect(
      nextFontZoomSize({ current: 20, base: 14, direction: "reset" }),
    ).toEqual({ size: 14, override: null });
  });
});

describe("fontZoomPercent", () => {
  it("reports the zoom level against the settings size", () => {
    expect(fontZoomPercent(15, 14)).toBe(107);
    expect(fontZoomPercent(14, 14)).toBe(100);
  });
});

describe("matchFontZoomChord", () => {
  it("matches ⌘= / ⌘- / ⌘0 on macOS", () => {
    const mod = { metaKey: true, ctrlKey: false, shiftKey: false };
    expect(matchFontZoomChord({ ...mod, key: "=" }, true)).toBe("in");
    expect(matchFontZoomChord({ ...mod, key: "+" }, true)).toBe("in");
    expect(matchFontZoomChord({ ...mod, key: "-" }, true)).toBe("out");
    expect(matchFontZoomChord({ ...mod, key: "0" }, true)).toBe("reset");
  });

  it("uses Ctrl outside macOS and ignores shifted chords", () => {
    expect(
      matchFontZoomChord(
        { key: "=", metaKey: false, ctrlKey: true, shiftKey: false },
        false,
      ),
    ).toBe("in");
    expect(
      matchFontZoomChord(
        { key: "=", metaKey: false, ctrlKey: false, shiftKey: false },
        false,
      ),
    ).toBeNull();
    expect(
      matchFontZoomChord(
        { key: "=", metaKey: true, ctrlKey: false, shiftKey: true },
        true,
      ),
    ).toBeNull();
    expect(
      matchFontZoomChord(
        { key: "a", metaKey: true, ctrlKey: false, shiftKey: false },
        true,
      ),
    ).toBeNull();
  });
});

describe("isTerminalSearchChord", () => {
  it("matches ⌘F / Ctrl+F", () => {
    expect(
      isTerminalSearchChord(
        { key: "f", metaKey: true, ctrlKey: false, shiftKey: false },
        true,
      ),
    ).toBe(true);
    expect(
      isTerminalSearchChord(
        { key: "f", metaKey: false, ctrlKey: true, shiftKey: false },
        false,
      ),
    ).toBe(true);
    expect(
      isTerminalSearchChord(
        { key: "f", metaKey: false, ctrlKey: false, shiftKey: false },
        false,
      ),
    ).toBe(false);
  });
});
