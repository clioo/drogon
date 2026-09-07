// Pane-scoped browser chords, handled in the pane container's keydown like
// the terminal does (the keybinding table is owned by another task, so the
// pane consumes these directly). Scope rule from the source: the chords only
// fire while a browser tab is active — the panel only mounts its chrome for
// the active page, so mounting is the scope.

export type BrowserPaneChord = "focus-address-bar" | "reload" | "find";

type ChordEvent = Pick<
  KeyboardEvent | React.KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
>;

/**
 * Matches the reference's browser chrome chords: Mod+L focuses the address
 * bar, Mod+R reloads, Mod+F opens find (Mod is Cmd on macOS, Ctrl elsewhere).
 * Shift/Alt variants never match, so shifted chords stay free.
 */
export function matchBrowserPaneChord(
  event: ChordEvent,
  isMac: boolean,
): BrowserPaneChord | null {
  const mod = isMac ? event.metaKey : event.ctrlKey;
  if (!mod || event.shiftKey || event.altKey) return null;
  // Why: on macOS Ctrl+key reaches the pane for Emacs-style caret moves;
  // only the platform Mod owns these chords.
  if (isMac ? event.ctrlKey : event.metaKey) return null;
  const key = event.key.toLowerCase();
  if (key === "l") return "focus-address-bar";
  if (key === "r") return "reload";
  if (key === "f") return "find";
  return null;
}
