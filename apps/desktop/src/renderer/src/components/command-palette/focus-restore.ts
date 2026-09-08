/* MIT Copyright (c) 2026 Lovecast Inc.
 * Ported from the read-only reference
 * the read-only Orca reference `src/renderer/src/components/cmd-j/palette-focus-restore-target.ts`
 * (Orca 1.4.197 + Drogon fork). Adapted: standalone module, no store imports.
 */

// When the palette closes it must hand focus back to whatever the user was
// doing. Prefer the exact element focused before the palette opened (e.g. the
// specific terminal textarea they were typing in); the querySelector fallbacks
// grab the first match in the DOM, which can be a background session's
// mounted-but-hidden terminal rather than the visible one.
export function resolvePaletteFocusRestoreTarget(
  preferredTarget: HTMLElement | null,
  doc: Document = document,
): HTMLElement | null {
  if (preferredTarget && preferredTarget.isConnected) {
    return preferredTarget;
  }
  const xterm = doc.querySelector(".xterm-helper-textarea");
  if (xterm instanceof HTMLElement) {
    return xterm;
  }
  const monaco = doc.querySelector(".monaco-editor textarea");
  return monaco instanceof HTMLElement ? monaco : null;
}
