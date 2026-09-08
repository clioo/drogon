// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/renderer/src/components/browser-pane/navigate/browser-notices.ts
//   (formatPermissionNotice, formatPopupNotice, formatDownloadFinishedNotice,
//   formatByteCount, formatLoadFailureRecoveryHint)
//   src/renderer/src/components/browser-pane/browser-client-hosted-download-notices.ts
//   (download started/progress copy)
//   src/renderer/src/components/browser-pane/browser-download-destination-toast.ts
//   (remote-destination saved copy)
// Adapted: pure copy only — Drogon's guest denies permission requests,
// blocks downloads and routes popups into a new pane tab silently (see
// main/browser/browser-host.ts), so no event source feeds these yet; the
// pane shows them through the banner `notice` kind once wired. The fork's
// popup action 'opened-in-orca' reads 'opened-in-drogon' here. The fork's
// certificate and guest-recovery branches are not ported (no cert error
// codes or guest-recovery concept in this host), so the recovery hint is
// the degenerate localhost remainder.

// Unknown Chromium permissions keep their raw name instead of disappearing behind invented copy.
function humanizePermission(permission: string): string {
  switch (permission) {
    case "media":
      return "camera or microphone access";
    case "pointerLock":
      return "pointer lock";
    case "storage-access":
      return "access to its own cookies and storage while embedded on this page";
    case "top-level-storage-access":
      return "cookie access on behalf of an embedded site";
    case "geolocation":
      return "your location";
    case "idle-detection":
      return "permission to detect when you are idle";
    case "display-capture":
      return "permission to capture your screen";
    case "window-management":
      return "screen information and multi-screen window placement";
    case "keyboardLock":
      return "permission to capture keyboard input";
    case "openExternal":
      return "permission to open a link outside Drogon";
    case "fileSystem":
      return "access to your files or folders";
    case "hid":
      return "access to a connected human interface device";
    case "usb":
      return "access to a USB device";
    case "serial":
      return "access to a serial device";
    case "midi":
      return "access to your MIDI devices";
    case "midiSysex":
      return "access to system-exclusive MIDI messages";
    case "mediaKeySystem":
      return "access to protected media playback";
    case "speaker-selection":
      return "permission to choose an audio output device";
    default:
      return permission;
  }
}

export function formatPermissionNotice(event: {
  origin: string;
  permission: string;
}): string {
  const target = event.origin === "unknown" ? "this page" : event.origin;
  return `${target} asked for ${humanizePermission(event.permission)}, and Drogon denied it.`;
}

export function formatPopupNotice(event: { origin: string; action: string }): string {
  const target = event.origin === "unknown" ? "A site" : event.origin;
  if (event.action === "opened-in-drogon") {
    return `${target} opened a new page in Drogon.`;
  }
  if (event.action === "opened-external") {
    return `${target} opened a new window in your default browser.`;
  }
  return `${target} tried to open a popup Drogon does not support here.`;
}

export function formatDownloadFinishedNotice(event: {
  status: string;
  savePath: string | null;
  error: string | null;
}): string {
  if (event.status === "completed") {
    return event.savePath ? `Downloaded to ${event.savePath}.` : "Download complete.";
  }
  if (event.status === "failed") {
    return event.error ?? "Download failed.";
  }
  return event.error ?? "Download canceled.";
}

export function formatDownloadStartedNotice(filename: string): string {
  return `Downloading ${filename}…`;
}

/** "Downloading report.pdf… 2.1 MB / 8 MB", falling back to the plain line when size is unknown. */
export function formatDownloadProgressNotice(
  filename: string,
  receivedBytes: number | null,
  totalBytes: number | null,
): string {
  const started = formatDownloadStartedNotice(filename);
  const received = formatByteCount(receivedBytes);
  const total = formatByteCount(totalBytes);
  if (received && total) {
    return `${started} ${received} / ${total}`;
  }
  return received ? `${started} ${received}` : started;
}

// Why the remote path and host: a download that never lands in this
// desktop's Downloads folder must name where it went instead of implying
// a local save.
export function formatRemoteDownloadSavedMessage(
  workspaceRelativePath: string,
  hostLabel: string,
): string {
  return `Saved to ${workspaceRelativePath} on ${hostLabel}`;
}

export function formatByteCount(bytes: number | null): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) {
    return null;
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

// Degenerate remainder of the fork's formatLoadFailureRecoveryHint: the
// fork suppresses this for certificate and guest-recovery errors, but this
// host has neither concept, so only the localhost gate remains.
export function formatLoadFailureRecoveryHint(isLocalhostLike: boolean): string | null {
  if (!isLocalhostLike) {
    return null;
  }
  return "If this should be a local app, make sure the server is running and listening on the expected port.";
}
