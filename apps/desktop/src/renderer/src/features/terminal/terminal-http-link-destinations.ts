// MIT Copyright (c) 2026 Lovecast Inc. Ported from
// src/renderer/src/components/terminal-pane/terminal-link-open-hints.ts
// (terminalHttpLinkActionDestinationsFor, getTerminalUrlOpenHint) and the
// Shift-resolution of src/renderer/src/lib/http-link-routing.ts
// (resolveModifierRouting): the persisted Link Routing preference decides
// the primary destination for terminal http(s) links; ⇧⌘/Shift+Ctrl is the
// system-browser escape hatch, stated outright by the modifier.
// Adapted: Orca's remote runtime source owners and the modifier-invert
// branch do not exist in Drogon, and "Orca Browser" reads "Drogon Browser".

export type TerminalHttpLinkDestination = "drogon" | "system";

export type TerminalHttpLinkActionDestinations = {
  primary: TerminalHttpLinkDestination;
  alternate?: TerminalHttpLinkDestination;
};

/**
 * The fork's action-destination split (terminal-link-open-hints.ts
 * `terminalHttpLinkActionDestinationsFor`): every local link can open in
 * Drogon, so the Link Routing preference only picks which destination the
 * popover's primary action names; the other destination is the alternate.
 */
export function terminalHttpLinkActionDestinationsFor(
  openLinksInApp: boolean,
): TerminalHttpLinkActionDestinations {
  return openLinksInApp
    ? { primary: "drogon", alternate: "system" }
    : { primary: "system", alternate: "drogon" };
}

/**
 * Owner-specified routing (2026-09-10), a deliberate divergence from the
 * fork: Shift+click opens inside Drogon's own browser, a plain click hands
 * the URL to the user's default browser. The gesture decides outright, so
 * the Link Routing preference no longer steers a terminal click.
 */
export function terminalHttpLinkClickDestination(
  shiftKey: boolean | undefined,
): TerminalHttpLinkDestination {
  return shiftKey ? "drogon" : "system";
}

/** Popover action labels, from the fork's TerminalLinkActionPopover copy. */
export function terminalHttpLinkDestinationLabel(
  destination: TerminalHttpLinkDestination,
): string {
  return destination === "drogon" ? "Drogon Browser" : "System Browser";
}

/** Hover hint stating the owner's gesture rule outright. */
export function getTerminalUrlOpenHint(platform: { isMac: boolean }): string {
  return platform.isMac
    ? "Click to open in your browser, or ⇧+click for Drogon Browser"
    : "Click to open in your browser, or Shift+click for Drogon Browser";
}
