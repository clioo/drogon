// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/renderer/src/components/browser-pane/describe-page/browser-page-url-display.ts
//   (toDisplayUrl, getBrowserDisplayTitle, getOpenableExternalUrl)
// Adapted: no Kagi token redaction (no Kagi session here), no notebook or
// runtime-environment helpers (no workspace-doc conversion in this build),
// and the shell bridge only opens https, so the external URL is https-only.

/** Blank-tab identity: nothing committed yet, so there is no URL to show. */
export function isBlankBrowserUrl(url: string): boolean {
  return url === "" || url === "about:blank";
}

/** What the address bar shows for a committed URL. Blank tabs show empty. */
export function toDisplayUrl(url: string): string {
  return isBlankBrowserUrl(url) ? "" : url;
}

/** Strip-tab and pane title: blank tabs read "New Tab". */
export function getBrowserDisplayTitle(
  title: string | null | undefined,
  url: string,
): string {
  if (isBlankBrowserUrl(url) || !title || title === "about:blank") {
    return "New Tab";
  }
  return title;
}

/**
 * The URL the toolbar menu and banners may hand to the OS browser. Only
 * https leaves the app (the shell bridge policy); blank and non-https
 * URLs are not openable.
 */
export function getOpenableExternalUrl(currentUrl: string): string | null {
  if (isBlankBrowserUrl(currentUrl)) return null;
  let parsed: URL;
  try {
    parsed = new URL(currentUrl);
  } catch {
    return null;
  }
  return parsed.protocol === "https:" ? parsed.toString() : null;
}

/** Host label for the "Can't reach {host}" failure copy. Null when unparseable. */
export function hostOfUrl(url: string): string | null {
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}
