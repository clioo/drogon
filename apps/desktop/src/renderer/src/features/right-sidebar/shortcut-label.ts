/* MIT Copyright (c) 2026 Lovecast Inc. Display labels for the registry
   chords the right sidebar and tab strip show (activity-bar tooltips and
   create-menu hints). Symbols on macOS joined without a separator, words
   joined with "+" elsewhere — the same convention as the Shortcuts
   section's formatChordForPlatform. */

export type ChordPlatform = "darwin" | "other";

export function resolveChordPlatform(userAgent: string): ChordPlatform {
  return userAgent.includes("Mac") ? "darwin" : "other";
}

function displayKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed === "") return key;
  if (trimmed.length === 1) return trimmed.toUpperCase();
  return trimmed[0].toUpperCase() + trimmed.slice(1).toLowerCase();
}

/** "CmdOrCtrl+Shift+E" -> "⌘⇧E" (darwin) or "Ctrl+Shift+E" (other). */
export function formatSidebarChord(
  chord: string,
  platform: ChordPlatform,
): string {
  const labels: string[] = [];
  for (const part of chord.split("+").map((item) => item.trim())) {
    const token = part.toLowerCase();
    if (token === "cmdorctrl")
      labels.push(platform === "darwin" ? "⌘" : "Ctrl");
    else if (token === "shift")
      labels.push(platform === "darwin" ? "⇧" : "Shift");
    else if (token === "alt") labels.push(platform === "darwin" ? "⌥" : "Alt");
    else if (part !== "") labels.push(displayKey(part));
  }
  return platform === "darwin" ? labels.join("") : labels.join("+");
}

/** Source chords for the right sidebar (definitions-core-1.ts). */
export const SIDEBAR_RIGHT_TOGGLE_CHORD = "CmdOrCtrl+L";
export const SIDEBAR_EXPLORER_TOGGLE_CHORD = "CmdOrCtrl+Shift+E";
export const SIDEBAR_SOURCE_CONTROL_TOGGLE_CHORD = "CmdOrCtrl+Shift+G";
/** Compatibility label; the tab strip resolves its chord from the shared table. */
export const TAB_NEW_TERMINAL_CHORD = "CmdOrCtrl+T";
