// MIT Copyright (c) 2026 Lovecast Inc. Ported from
// src/renderer/src/components/terminal-pane/terminal-appearance.ts and
// src/renderer/src/lib/terminal-themes/defaults.ts.
// Adapted: Orca's PaneManager/GlobalSettings/theme-catalog stack does not
// exist in Drogon, so the per-scheme theme is the fork's default catalog
// entry for that scheme (Ghostty Default Style Dark / Builtin Tango Light),
// values copied literally. The pure core (hexToRgba,
// composeActiveTerminalTheme, value-gated theme equality) keeps the source
// semantics.

import type { ITheme } from "@xterm/xterm";

export type TerminalScheme = "dark" | "light";

export function hexToRgba(hex: string, alpha: number): string {
  let clean = hex.replace("#", "");
  if (clean.length === 3) {
    clean = clean
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isHexColor(value: string): boolean {
  return HEX_COLOR_RE.test(value);
}

/** Resolves the stored theme choice against the OS scheme. "system" follows the OS. */
export function resolveTerminalScheme(
  theme: "system" | TerminalScheme,
  systemPrefersDark: boolean,
): TerminalScheme {
  if (theme === "system") return systemPrefersDark ? "dark" : "light";
  return theme;
}

// Fork default catalog entries, copied literally from
// lib/terminal-themes/defaults.ts: most dark colors come from Ghostty (Orca
// raises the dark selection contrast because Ghostty's original #3e4451
// blends into gray instruction blocks); the light entry is Tango with
// readable ANSI accents (never Tango's near-white legacy values).
const DARK_ANSI: Record<string, string> = {
  black: "#1d1f21",
  red: "#cc6666",
  green: "#b5bd68",
  yellow: "#f0c674",
  blue: "#81a2be",
  magenta: "#b294bb",
  cyan: "#8abeb7",
  white: "#c5c8c6",
  brightBlack: "#666666",
  brightRed: "#d54e53",
  brightGreen: "#b9ca4a",
  brightYellow: "#e7c547",
  brightBlue: "#7aa6da",
  brightMagenta: "#c397d8",
  brightCyan: "#70c0b1",
  brightWhite: "#eaeaea",
};

const LIGHT_ANSI: Record<string, string> = {
  black: "#2e3436",
  red: "#cc0000",
  green: "#4e9a06",
  yellow: "#8e7700",
  blue: "#3465a4",
  magenta: "#75507b",
  cyan: "#05727e",
  white: "#6a6a6a",
  brightBlack: "#555753",
  brightRed: "#ef2929",
  brightGreen: "#1b7a1b",
  brightYellow: "#6d5a00",
  brightBlue: "#204a87",
  brightMagenta: "#ad7fa8",
  brightCyan: "#034b50",
  brightWhite: "#3d3d3d",
};

/**
 * Builds the xterm theme for one scheme from the fork's default catalog
 * entry, plus the transparent overview-ruler border and raised
 * scrollbar-slider alphas from the source (xterm's defaults are nearly
 * invisible on dark backgrounds).
 */
export function terminalThemeForScheme(scheme: TerminalScheme): ITheme {
  const dark = scheme === "dark";
  const ansi = dark ? DARK_ANSI : LIGHT_ANSI;
  return {
    background: dark ? "#282c34" : "#ffffff",
    foreground: dark ? "#ffffff" : "#2e3434",
    cursor: dark ? "#ffffff" : "#2e3434",
    cursorAccent: dark ? "#282c34" : "#ffffff",
    selectionBackground: dark ? "#5a7898" : "#accef7",
    selectionForeground: dark ? "#ffffff" : "#2e3434",
    selectionInactiveBackground: dark
      ? "rgba(90, 120, 152, 0.5)"
      : "rgba(172, 206, 247, 0.5)",
    // Why transparent ruler border: enabling the scrollbar shows xterm's
    // overview ruler, whose border would otherwise paint a bright line.
    overviewRulerBorder: "transparent",
    // Why raised slider alpha: xterm's default (~0.2) is nearly invisible.
    scrollbarSliderBackground: "rgba(180, 180, 185, 0.4)",
    scrollbarSliderHoverBackground: "rgba(180, 180, 185, 0.6)",
    scrollbarSliderActiveBackground: "rgba(180, 180, 185, 0.8)",
    ...ansi,
  };
}

export type TerminalOpacityOverrides = {
  terminalBackgroundOpacity?: number;
  terminalCursorOpacity?: number;
};

// Why extracted: lets tests and future settings previews compose the same
// theme without mounting a terminal. Keep pure.
export function composeActiveTerminalTheme(
  baseTheme: ITheme | null,
  settings: TerminalOpacityOverrides,
): ITheme | null {
  if (!baseTheme) return null;
  let theme: ITheme = {
    overviewRulerBorder: "transparent",
    scrollbarSliderBackground: "rgba(180, 180, 185, 0.4)",
    scrollbarSliderHoverBackground: "rgba(180, 180, 185, 0.6)",
    scrollbarSliderActiveBackground: "rgba(180, 180, 185, 0.8)",
    ...baseTheme,
  };
  // Why: convert the hex background to rgba so xterm honors the opacity when
  // allowTransparency is set.
  if (
    settings.terminalBackgroundOpacity !== undefined &&
    theme.background &&
    isHexColor(theme.background)
  ) {
    theme = {
      ...theme,
      background: hexToRgba(
        theme.background,
        settings.terminalBackgroundOpacity,
      ),
    };
  }
  // Why hex-only: hexToRgba expects a hex input, so named CSS cursor colors
  // are left untouched.
  if (
    settings.terminalCursorOpacity !== undefined &&
    theme.cursor &&
    isHexColor(theme.cursor)
  ) {
    theme = {
      ...theme,
      cursor: hexToRgba(theme.cursor, settings.terminalCursorOpacity),
    };
  }
  return theme;
}

// Value equality over composed ITheme objects (flat string slots plus the
// extendedAnsi array); gates the options.theme write, which rebuilds the
// palette and would discard TUI OSC 4/10/11/12 mutations on a no-op change.
export function composedTerminalThemesEqual(
  a: ITheme | undefined,
  b: ITheme,
): boolean {
  if (!a) return false;
  if (a === b) return true;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (key === "extendedAnsi") continue;
    if (a[key as keyof ITheme] !== b[key as keyof ITheme]) return false;
  }
  const extA = a.extendedAnsi;
  const extB = b.extendedAnsi;
  if (!extA || !extB) return extA === extB;
  return (
    extA.length === extB.length && extA.every((value, i) => value === extB[i])
  );
}

/** Applies theme + cursor options to a live terminal, skipping no-op writes. */
export function applyTerminalAppearance(
  terminal: {
    options: {
      theme?: ITheme;
      cursorStyle?: string;
      cursorBlink?: boolean;
      allowTransparency?: boolean;
    };
  },
  scheme: TerminalScheme,
  overrides: TerminalOpacityOverrides = {},
): void {
  const theme = composeActiveTerminalTheme(
    terminalThemeForScheme(scheme),
    overrides,
  );
  if (theme && !composedTerminalThemesEqual(terminal.options.theme, theme)) {
    terminal.options.theme = theme;
  }
  if (terminal.options.cursorStyle !== "block") {
    terminal.options.cursorStyle = "block";
  }
  if (terminal.options.cursorBlink !== true) {
    terminal.options.cursorBlink = true;
  }
  // Why clear explicitly: allowTransparency has rendering cost and a stale
  // `true` could bleed in from a prior opacity.
  const transparent =
    overrides.terminalBackgroundOpacity !== undefined &&
    overrides.terminalBackgroundOpacity < 1;
  if (terminal.options.allowTransparency !== transparent) {
    terminal.options.allowTransparency = transparent;
  }
}

/** Reads the effective scheme from the themed root (App toggles `.dark`). */
export function readEffectiveSchemeFromRoot(
  root: { classList: { contains(name: string): boolean } } | null | undefined,
): TerminalScheme {
  return root?.classList.contains("dark") ? "dark" : "light";
}
