// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  applyTerminalSettings,
  classifyTerminalKeyboardLayout,
  readTerminalSettings,
  resolveTerminalMacOptionAsMeta,
  terminalSettingsDefaults,
  writeTerminalSettings,
} from "./terminal-settings";
import { resolveTerminalJisYenInput } from "./terminal-jis-yen-input";
import {
  createTerminalTuiMouseWheelDistanceState,
  normalizeTerminalTuiMouseWheelMultiplier,
  resolveTerminalTuiMouseWheelReportCount,
} from "./terminal-tui-wheel-reports";
import {
  resolveTerminalMacOptionKeyAction,
  updateTerminalOptionKeyLocation,
} from "./terminal-option-shortcut-policy";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  peek(key: string): string | null {
    return this.getItem(key);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("terminal settings persistence and xterm projection", () => {
  test("round-trips interaction and advanced settings while preserving unknown keys", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      "drogon:settings:ui",
      JSON.stringify({
        settings: { futureSetting: { enabled: true }, terminalFontSize: 15 },
      }),
    );

    const next = writeTerminalSettings(storage, {
      terminalScrollSensitivity: 2.25,
      terminalFastScrollSensitivity: 8,
      terminalTuiScrollSensitivity: 4,
      terminalRightClickToPaste: true,
      terminalFocusFollowsMouse: true,
      terminalClipboardOnSelect: true,
      terminalAllowOsc52Clipboard: false,
      terminalScrollbackRows: 25_000,
      terminalWordSeparator: " /",
      terminalMacOptionAsAlt: "right",
      terminalJISYenToBackslash: true,
    });

    expect(next).toMatchObject({
      terminalScrollSensitivity: 2.25,
      terminalFastScrollSensitivity: 8,
      terminalTuiScrollSensitivity: 4,
      terminalScrollbackRows: 25_000,
      terminalMacOptionAsAlt: "right",
    });
    const persisted = JSON.parse(storage.peek("drogon:settings:ui") as string);
    expect(persisted.settings.futureSetting).toEqual({ enabled: true });
    expect(readTerminalSettings(storage)).toMatchObject(next);
  });

  test("normalizes unsafe numeric values before they reach xterm", () => {
    const storage = new MemoryStorage();
    const next = writeTerminalSettings(storage, {
      terminalScrollSensitivity: -10,
      terminalFastScrollSensitivity: 100,
      terminalTuiScrollSensitivity: 2.4,
      terminalScrollbackRows: 999_999,
    });
    expect(next.terminalScrollSensitivity).toBe(0.1);
    expect(next.terminalFastScrollSensitivity).toBe(20);
    expect(next.terminalTuiScrollSensitivity).toBe(2);
    expect(next.terminalScrollbackRows).toBe(50_000);
  });

  test("applies mutable xterm options and conservative macOS auto mode", () => {
    const options: {
      scrollSensitivity?: number;
      fastScrollSensitivity?: number;
      scrollback?: number;
      wordSeparator?: string;
      macOptionIsMeta?: boolean;
    } = {};
    const settings = {
      ...terminalSettingsDefaults(),
      terminalScrollSensitivity: 2,
      terminalFastScrollSensitivity: 7,
      terminalScrollbackRows: 10_000,
      terminalWordSeparator: " /",
      terminalMacOptionAsAlt: "auto" as const,
    };
    applyTerminalSettings({ options }, settings, {
      isMac: true,
      detectedMacOption: "unknown",
    });
    expect(options).toEqual({
      scrollSensitivity: 2,
      fastScrollSensitivity: 7,
      scrollback: 10_000,
      wordSeparator: " /",
      macOptionIsMeta: false,
    });
    applyTerminalSettings({ options }, settings, {
      isMac: true,
      detectedMacOption: "us",
    });
    expect(options.macOptionIsMeta).toBe(true);
    expect(resolveTerminalMacOptionAsMeta("auto", "us")).toBe(true);
    expect(resolveTerminalMacOptionAsMeta("auto", "non-us")).toBe(false);
  });

  test("classifies complete US layouts but keeps incomplete maps unknown", () => {
    const values: Record<string, string> = {
      KeyQ: "q",
      KeyW: "w",
      KeyA: "a",
      KeyZ: "z",
      Semicolon: ";",
      Quote: "'",
      Backquote: "`",
      BracketLeft: "[",
      BracketRight: "]",
    };
    expect(
      classifyTerminalKeyboardLayout({
        get: (code) => values[code],
        size: 100,
      }),
    ).toBe("us");
    expect(
      classifyTerminalKeyboardLayout({ get: (code) => values[code], size: 1 }),
    ).toBe("us");
    expect(
      classifyTerminalKeyboardLayout({ get: () => undefined, size: 100 }),
    ).toBe("unknown");
  });

  test("emits a live settings event after a successful write", () => {
    const listener = vi.fn();
    window.addEventListener("drogon:terminal-settings-changed", listener);
    writeTerminalSettings(new MemoryStorage(), {
      terminalFocusFollowsMouse: true,
    });
    window.removeEventListener("drogon:terminal-settings-changed", listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({
      detail: { settings: { terminalFocusFollowsMouse: true } },
    });
  });
});

describe("terminal TUI wheel setting", () => {
  test("scales discrete mouse reports and preserves the default multiplier", () => {
    const state = createTerminalTuiMouseWheelDistanceState();
    expect(
      resolveTerminalTuiMouseWheelReportCount(
        { deltaY: 1, deltaMode: 1 },
        1,
        state,
      ),
    ).toBe(1);
    expect(normalizeTerminalTuiMouseWheelMultiplier(undefined)).toBe(1);
    expect(normalizeTerminalTuiMouseWheelMultiplier(4.4)).toBe(4);
  });

  test("turns trackpad distance into fractional-row reports", () => {
    const state = createTerminalTuiMouseWheelDistanceState();
    expect(
      resolveTerminalTuiMouseWheelReportCount(
        { deltaY: 8, deltaMode: 0 },
        2,
        state,
        { cellHeight: 16, rows: 24 },
      ),
    ).toBe(0);
    expect(state.pendingRows).toBe(0.5);
    expect(
      resolveTerminalTuiMouseWheelReportCount(
        { deltaY: 8, deltaMode: 0 },
        2,
        state,
        { cellHeight: 16, rows: 24 },
      ),
    ).toBe(1);
    expect(state.pendingRows).toBe(0);
  });
});

describe("terminal keyboard interaction settings", () => {
  test("rewrites only a plain physical JIS Yen key", () => {
    const event = {
      type: "keydown",
      key: "¥",
      code: "IntlYen",
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
    };
    expect(
      resolveTerminalJisYenInput(event, { enabled: true, isMac: true }),
    ).toEqual({ type: "input", data: "\\" });
    expect(
      resolveTerminalJisYenInput(
        { ...event, key: "¥", keyCode: 229 },
        { enabled: true, isMac: true },
      ),
    ).toBeNull();
  });

  test("supports one configured Option side without stealing the other", () => {
    let locations = updateTerminalOptionKeyLocation(0, {
      type: "keydown",
      key: "Alt",
      location: 1,
    });
    expect(
      resolveTerminalMacOptionKeyAction(
        {
          type: "keydown",
          key: "ƒ",
          code: "KeyF",
          metaKey: false,
          ctrlKey: false,
          altKey: true,
          shiftKey: false,
        },
        "left",
        locations,
      ),
    ).toEqual({ type: "sendInput", data: "\x1bf" });
    locations = updateTerminalOptionKeyLocation(locations, {
      type: "keyup",
      key: "Alt",
      location: 1,
    });
    expect(locations).toBe(0);
    locations = updateTerminalOptionKeyLocation(0, {
      type: "keydown",
      key: "Alt",
      location: 2,
    });
    expect(
      resolveTerminalMacOptionKeyAction(
        {
          type: "keydown",
          key: "ƒ",
          code: "KeyF",
          metaKey: false,
          ctrlKey: false,
          altKey: true,
          shiftKey: false,
        },
        "left",
        locations,
      ),
    ).toEqual({ type: "sendInput", data: "\x1bf" });
    expect(
      updateTerminalOptionKeyLocation(1, {
        type: "keyup",
        key: "Alt",
        location: 0,
      }),
    ).toBe(0);
  });
});
