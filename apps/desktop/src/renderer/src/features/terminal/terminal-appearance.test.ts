// MIT Copyright (c) 2026 Lovecast Inc. Appearance mapping is Drogon-new
// (the source's terminal-appearance.test.ts covers Orca's theme catalog);
// these tests pin this repo's token-derived theme contract.
import { describe, expect, it } from "vitest";
import {
  applyTerminalAppearance,
  composeActiveTerminalTheme,
  composedTerminalThemesEqual,
  hexToRgba,
  isHexColor,
  readEffectiveSchemeFromRoot,
  resolveTerminalScheme,
  terminalThemeForScheme,
} from "./terminal-appearance";

describe("resolveTerminalScheme", () => {
  it("follows the OS in system mode and honors explicit choices", () => {
    expect(resolveTerminalScheme("system", true)).toBe("dark");
    expect(resolveTerminalScheme("system", false)).toBe("light");
    expect(resolveTerminalScheme("dark", false)).toBe("dark");
    expect(resolveTerminalScheme("light", true)).toBe("light");
  });
});

describe("terminalThemeForScheme", () => {
  it("derives the dark theme from the repo tokens", () => {
    const theme = terminalThemeForScheme("dark");
    expect(theme.background).toBe("#0a0a0a");
    expect(theme.foreground).toBe("#fafafa");
    expect(theme.cursor).toBe("#fafafa");
  });

  it("derives the light theme from the repo tokens", () => {
    const theme = terminalThemeForScheme("light");
    expect(theme.background).toBe("#ffffff");
    expect(theme.foreground).toBe("#0a0a0a");
    expect(theme.cursor).toBe("#0a0a0a");
  });

  it("keeps the selection legible and the scrollbar visible per scheme", () => {
    for (const scheme of ["dark", "light"] as const) {
      const theme = terminalThemeForScheme(scheme);
      expect(theme.selectionBackground).toBeTruthy();
      expect(theme.selectionBackground).not.toBe(theme.background);
      expect(theme.overviewRulerBorder).toBe("transparent");
      expect(theme.scrollbarSliderBackground).toContain("0.4");
      expect(theme.scrollbarSliderHoverBackground).toContain("0.6");
      expect(theme.scrollbarSliderActiveBackground).toContain("0.8");
    }
  });

  it("ships a full 16-color ANSI ramp per scheme", () => {
    for (const scheme of ["dark", "light"] as const) {
      const theme = terminalThemeForScheme(scheme);
      for (const slot of [
        "black",
        "red",
        "green",
        "yellow",
        "blue",
        "magenta",
        "cyan",
        "white",
        "brightBlack",
        "brightRed",
        "brightGreen",
        "brightYellow",
        "brightBlue",
        "brightMagenta",
        "brightCyan",
        "brightWhite",
      ] as const) {
        expect(isHexColor(String(theme[slot]))).toBe(true);
      }
    }
  });
});

describe("hexToRgba", () => {
  it("expands short hex and applies alpha", () => {
    expect(hexToRgba("#0a0a0a", 0.5)).toBe("rgba(10, 10, 10, 0.5)");
    expect(hexToRgba("#fff", 1)).toBe("rgba(255, 255, 255, 1)");
  });
});

describe("composeActiveTerminalTheme", () => {
  it("returns null without a base theme", () => {
    expect(composeActiveTerminalTheme(null, {})).toBeNull();
  });

  it("keeps the base theme untouched without overrides", () => {
    const base = terminalThemeForScheme("dark");
    expect(composeActiveTerminalTheme(base, {})).toEqual({
      overviewRulerBorder: "transparent",
      scrollbarSliderBackground: "rgba(180, 180, 185, 0.4)",
      scrollbarSliderHoverBackground: "rgba(180, 180, 185, 0.6)",
      scrollbarSliderActiveBackground: "rgba(180, 180, 185, 0.8)",
      ...base,
    });
  });

  it("applies background and cursor opacity to hex colors only", () => {
    const composed = composeActiveTerminalTheme(terminalThemeForScheme("dark"), {
      terminalBackgroundOpacity: 0.9,
      terminalCursorOpacity: 0.8,
    });
    expect(composed?.background).toBe("rgba(10, 10, 10, 0.9)");
    expect(composed?.cursor).toBe("rgba(250, 250, 250, 0.8)");
    const named = composeActiveTerminalTheme(
      { background: "#000000", cursor: "red" },
      { terminalCursorOpacity: 0.5 },
    );
    expect(named?.cursor).toBe("red");
  });
});

describe("composedTerminalThemesEqual", () => {
  it("gates no-op theme writes", () => {
    const theme = terminalThemeForScheme("dark");
    expect(composedTerminalThemesEqual(undefined, theme)).toBe(false);
    expect(composedTerminalThemesEqual(theme, theme)).toBe(true);
    expect(
      composedTerminalThemesEqual({ ...theme }, { ...theme }),
    ).toBe(true);
    expect(
      composedTerminalThemesEqual(
        { ...theme },
        { ...theme, foreground: "#000000" },
      ),
    ).toBe(false);
  });
});

describe("applyTerminalAppearance", () => {
  it("writes theme and cursor options, skipping no-op rewrites", () => {
    const options: {
      theme?: ReturnType<typeof terminalThemeForScheme>;
      cursorStyle?: string;
      cursorBlink?: boolean;
      allowTransparency?: boolean;
    } = {};
    applyTerminalAppearance({ options }, "dark");
    const first = options.theme;
    expect(first?.background).toBe("#0a0a0a");
    expect(options.cursorStyle).toBe("block");
    expect(options.cursorBlink).toBe(true);
    expect(options.allowTransparency).toBe(false);
    applyTerminalAppearance({ options }, "dark");
    expect(options.theme).toBe(first);
    applyTerminalAppearance({ options }, "light");
    expect(options.theme?.background).toBe("#ffffff");
  });

  it("enables transparency only for sub-opaque backgrounds", () => {
    const options: { allowTransparency?: boolean } = {};
    applyTerminalAppearance({ options }, "dark", {
      terminalBackgroundOpacity: 0.85,
    });
    expect(options.allowTransparency).toBe(true);
  });
});

describe("readEffectiveSchemeFromRoot", () => {
  it("reads the .dark class App toggles", () => {
    expect(
      readEffectiveSchemeFromRoot({ classList: { contains: () => true } }),
    ).toBe("dark");
    expect(
      readEffectiveSchemeFromRoot({ classList: { contains: () => false } }),
    ).toBe("light");
    expect(readEffectiveSchemeFromRoot(null)).toBe("light");
  });
});
