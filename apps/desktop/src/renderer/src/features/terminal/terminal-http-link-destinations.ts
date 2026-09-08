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
 * Where a direct activation (⌘/Ctrl+click) opens: the Shift escape hatch
 * always states the system browser outright (the fork's
 * `resolveModifierRouting` without its not-ported invert branch); without
 * Shift the click follows the Link Routing preference.
 */
export function terminalHttpLinkClickDestination(
  shiftKey: boolean | undefined,
  openLinksInApp: boolean,
): TerminalHttpLinkDestination {
  if (shiftKey) return "system";
  return openLinksInApp ? "drogon" : "system";
}

/** Popover action labels, from the fork's TerminalLinkActionPopover copy. */
export function terminalHttpLinkDestinationLabel(
  destination: TerminalHttpLinkDestination,
): string {
  return destination === "drogon" ? "Drogon Browser" : "System Browser";
}

/** Hover hint, matching the source's non-inverting copy exactly. */
export function getTerminalUrlOpenHint(platform: { isMac: boolean }): string {
  return platform.isMac
    ? "Click for actions, ⌘+click to open, or ⇧⌘+click for system browser"
    : "Click for actions, Ctrl+click to open, or Shift+Ctrl+click for system browser";
}
