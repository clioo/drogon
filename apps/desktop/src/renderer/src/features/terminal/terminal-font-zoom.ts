// MIT Copyright (c) 2026 Lovecast Inc. Ported from
// src/renderer/src/components/terminal-pane/useTerminalFontZoom.ts.
// Adapted: the source reacts to menu-accelerator events through a PaneManager;
// Drogon handles the ⌘= / ⌘- / ⌘0 chords directly in the terminal container's
// keydown handler (the global keybinding registry is owned by another task).
// Step and bounds below are the source's values, kept in one pure module so
// the zoom math is testable without a terminal.

export const TERMINAL_FONT_ZOOM_MIN = 8;
export const TERMINAL_FONT_ZOOM_MAX = 32;
export const TERMINAL_FONT_ZOOM_STEP = 1;

export type TerminalFontZoomDirection = "in" | "out" | "reset";

export function nextFontZoomSize(input: {
  /** Current effective size (per-pane override or the settings size). */
  current: number;
  /** Settings-wide terminal font size; reset returns to this. */
  base: number;
  direction: TerminalFontZoomDirection;
}): { size: number; override: number | null } {
  if (input.direction === "reset") {
    return { size: input.base, override: null };
  }
  if (input.direction === "in") {
    const size = Math.min(
      TERMINAL_FONT_ZOOM_MAX,
      input.current + TERMINAL_FONT_ZOOM_STEP,
    );
    return { size, override: size };
  }
  const size = Math.max(
    TERMINAL_FONT_ZOOM_MIN,
    input.current - TERMINAL_FONT_ZOOM_STEP,
  );
  return { size, override: size };
}

/** Zoom level as a percentage of the settings size (for toasts/labels). */
export function fontZoomPercent(size: number, base: number): number {
  if (base <= 0) return 100;
  return Math.round((size / base) * 100);
}

type ZoomChordEvent = Pick<
  KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "shiftKey"
>;

/**
 * Matches the source's zoom chords: ⌘= / ⌘- / ⌘0 (Ctrl outside macOS).
 * Returns the zoom direction, or null when the keypress is not a zoom chord.
 */
export function matchFontZoomChord(
  event: ZoomChordEvent,
  isMac: boolean,
): TerminalFontZoomDirection | null {
  const mod = isMac ? event.metaKey : event.ctrlKey;
  if (!mod || event.shiftKey) return null;
  if (event.key === "=" || event.key === "+") return "in";
  if (event.key === "-" || event.key === "_") return "out";
  if (event.key === "0") return "reset";
  return null;
}

/** Matches the source's search chord: ⌘F (Ctrl outside macOS). */
export function isTerminalSearchChord(
  event: ZoomChordEvent,
  isMac: boolean,
): boolean {
  const mod = isMac ? event.metaKey : event.ctrlKey;
  if (!mod || event.shiftKey) return false;
  return event.key === "f" || event.key === "F";
}
