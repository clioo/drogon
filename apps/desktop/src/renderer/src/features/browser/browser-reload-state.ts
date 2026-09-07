// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/renderer/src/components/browser-pane/navigate/browser-reload-action.ts
//   (resolveBrowserReloadIntent, resolveBrowserReloadButtonLabelKind)
// Adapted: the source's guest-recovery retry (a webview-guest concept) folds
// into retry-load — this host's failed loads retry through navigate, and the
// toolbar button doubles as Stop only while loading.

/** Where the reload request came from: the toolbar button, or an explicit menu entry. */
export type BrowserReloadTrigger = "button" | "reload" | "hard-reload";

export type BrowserReloadIntent =
  | "stop"
  | "retry-load"
  | "reload"
  | "hard-reload";

export type BrowserReloadState = {
  loading: boolean;
  hasLoadError: boolean;
};

/**
 * Why: the guest's reload() only refreshes an error page, so a failed load
 * has to go through the retry path no matter which entry point asked for
 * it. Only the toolbar button doubles as Stop.
 */
export function resolveBrowserReloadIntent(
  trigger: BrowserReloadTrigger,
  state: BrowserReloadState,
): BrowserReloadIntent {
  if (trigger === "button" && state.loading) {
    return "stop";
  }
  if (state.hasLoadError) {
    return "retry-load";
  }
  return trigger === "hard-reload" ? "hard-reload" : "reload";
}

/** Accessible name for the toolbar button, which is Stop mid-load and Retry after a failure. */
export type BrowserReloadButtonLabelKind = "stop" | "retry" | "reload";

export function resolveBrowserReloadButtonLabelKind(
  state: BrowserReloadState,
): BrowserReloadButtonLabelKind {
  if (state.loading) {
    return "stop";
  }
  return state.hasLoadError ? "retry" : "reload";
}

export function browserReloadButtonLabel(kind: BrowserReloadButtonLabelKind): string {
  if (kind === "stop") return "Stop";
  if (kind === "retry") return "Retry";
  return "Reload";
}
