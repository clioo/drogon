// MIT Copyright (c) 2026 Lovecast Inc. Ported from
// src/renderer/src/components/terminal-pane/terminal-appearance.ts.
// Adapted: Orca's PaneManager/GlobalSettings/theme-catalog stack does not
// exist in Drogon, so the theme is derived from this repo's own tokens
// (apps/desktop/src/renderer/src/assets/main.css) per effective scheme.
// The pure core (hexToRgba, composeActiveTerminalTheme, value-gated theme
// equality) keeps the source semantics.

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

// Fixed 16-color ramps per scheme, tuned against the repo's own
// --background/--foreground tokens (dark #0a0a0a/#fafafa, light #fff/#0a0a0a).
const DARK_ANSI: Record<string, string> = {
  black: "#0a0a0a",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#facc15",
  blue: "#60a5fa",
  magenta: "#e879f9",
  cyan: "#22d3ee",
  white: "#e5e5e5",
  brightBlack: "#525252",
  brightRed: "#fca5a5",
  brightGreen: "#86efac",
  brightYellow: "#fde047",
  brightBlue: "#93c5fd",
  brightMagenta: "#f0abfc",
  brightCyan: "#67e8f9",
  brightWhite: "#fafafa",
};

const LIGHT_ANSI: Record<string, string> = {
  black: "#0a0a0a",
  red: "#dc2626",
  green: "#16a34a",
  yellow: "#a16207",
  blue: "#2563eb",
  magenta: "#c026d3",
  cyan: "#0891b2",
  white: "#737373",
  brightBlack: "#525252",
  brightRed: "#ef4444",
  brightGreen: "#22c55e",
  brightYellow: "#ca8a04",
  brightBlue: "#3b82f6",
  brightMagenta: "#d946ef",
  brightCyan: "#06b6d4",
  brightWhite: "#0a0a0a",
};

/**
 * Builds the xterm theme from the repo tokens for one scheme: themed
 * background/foreground, a visible cursor, a legible selection, the
 * transparent overview-ruler border and raised scrollbar-slider alphas from
 * the source (xterm's defaults are nearly invisible on dark backgrounds).
 */
export function terminalThemeForScheme(scheme: TerminalScheme): ITheme {
  const dark = scheme === "dark";
  const ansi = dark ? DARK_ANSI : LIGHT_ANSI;
  return {
    background: dark ? "#0a0a0a" : "#ffffff",
    foreground: dark ? "#fafafa" : "#0a0a0a",
    cursor: dark ? "#fafafa" : "#0a0a0a",
    cursorAccent: dark ? "#0a0a0a" : "#ffffff",
    selectionBackground: dark ? "#404040" : "#d4d4d4",
    selectionForeground: dark ? "#fafafa" : "#0a0a0a",
    selectionInactiveBackground: dark
      ? "rgba(64, 64, 64, 0.5)"
      : "rgba(212, 212, 212, 0.5)",
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
