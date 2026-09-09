// Permission policy for the shared default session, which hosts both the
// app window's renderer and the browser pane guests (guests carry no
// partition). The fork never needed this: its terminal clipboard went
// through preload IPC (window.api.ui.readClipboardText), while its main
// window session allowed media/fullscreen/pointerLock and the guest
// sessions were locked down separately. This build has no clipboard IPC,
// so the app renderer reads/writes the clipboard through the async
// Clipboard API — which Chromium gates behind session permissions. The
// policy below keeps the fork's net posture: the trusted app renderer may
// use the clipboard exactly like the fork's preload channel allowed, and
// every other frame (browser pane guests above all) stays denied.

/** Clipboard permissions the trusted app renderer needs (fork preload parity). */
export const APP_WINDOW_CLIPBOARD_PERMISSIONS: ReadonlySet<string> = new Set([
  "clipboard-read",
  "clipboard-sanitized-write",
]);

/**
 * True only when the requesting frame IS the app window and the permission
 * is one of the clipboard permissions above. With no app-window id known
 * (unit tests, early boot) every request is denied, matching the previous
 * deny-all posture.
 */
export function isAppWindowClipboardPermissionAllowed(
  permission: string,
  requestingWebContents: { id: number } | null | undefined,
  appWindowWebContentsId: number | null | undefined,
): boolean {
  return (
    appWindowWebContentsId != null &&
    requestingWebContents != null &&
    requestingWebContents.id === appWindowWebContentsId &&
    APP_WINDOW_CLIPBOARD_PERMISSIONS.has(permission)
  );
}
