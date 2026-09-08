// MIT Copyright (c) 2026 Lovecast Inc. Ported from the Orca reference
// (read-only /Users/carlos/Documents/Drogon-mentu-session):
//   src/renderer/src/web/web-runtime-connection-transport.ts
//     (RECONNECT_DELAYS_MS ladder, infinite retry, attempt counting)
//   src/shared/reconnect-jitter.ts (withReconnectJitter, one-sided +20%)
//   src/renderer/src/runtime/runtime-host-connection-state.ts
//     (checking/connected/reconnecting vocabulary)
//   src/renderer/src/components/status-bar/RuntimeHostStatusRow.tsx
//     (status labels, dot colors, failure summary/explanation copy,
//     "Attempt N" diagnostics)
//   src/renderer/src/components/terminal-pane/TerminalRemoteRuntimeReconnectBanner.tsx
//     (retrying card: spinner, title/body, role=status)
//   src/renderer/src/store/slices/runtime-environment-disconnect-toast.ts
//     (disconnect warning toast with a Try-again action, dismissed on
//     reconnect; the fork raises no "reconnected" toast)
// Adapted: one local daemon instead of remote hosts, so the SSH-only states
// (runtime-unavailable, workspace-window-closed) and per-host rows are gone;
// translate() calls are plain English strings (Drogon has no i18n catalog).
// No zustand store and no main-process loop: the renderer monitor in
// daemon-connection-store.ts owns the ladder. Unlike the fork's SSH ladder
// the monitor never gives up — a local service restart minutes later must
// still reconnect on its own (web-transport semantics), so there is no
// "automatic retries stopped" phase; the manual affordances (banner, toast
// and segment actions) retry immediately instead of waiting out the backoff.

/** Connection states of the renderer toward the local `drogond` service. */
export type DaemonConnectionState = "checking" | "connected" | "reconnecting";

/**
 * Seconds-spaced retry ladder, fork values verbatim
 * (web-runtime-connection-transport.ts RECONNECT_DELAYS_MS). A local daemon
 * restart answers within a second, so the ladder starts sub-second and caps
 * at 15s; the monitor keeps waiting on the cap until the service returns.
 */
export const DAEMON_RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 15000];

/**
 * Steady-state health probe while connected (fork
 * web-runtime-connection-heartbeat.ts HEARTBEAT_INTERVAL_MS, verbatim).
 * The renderer has no daemon push channel, so a `status()` probe on this
 * cadence is what notices a dead service; the retry ladder then takes over.
 */
export const DAEMON_HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * One-sided jitter so a host-wide blip does not re-dial every waiter on the
 * same millisecond (fork withReconnectJitter, verbatim): a delay is never
 * shortened below its backoff floor.
 */
export function withDaemonReconnectJitter(
  delayMs: number,
  random: () => number = Math.random,
): number {
  return delayMs + Math.floor(delayMs * 0.2 * random());
}

/** Jittered wait before retry attempt `attempt` (0-based) on the ladder. */
export function daemonReconnectDelay(
  attempt: number,
  random: () => number = Math.random,
): number {
  const base =
    DAEMON_RECONNECT_DELAYS_MS[
      Math.min(attempt, DAEMON_RECONNECT_DELAYS_MS.length - 1)
    ];
  return withDaemonReconnectJitter(base, random);
}

/** Status-bar label per state (fork runtimeStatusLabel, SSH states dropped). */
export function daemonConnectionStatusLabel(
  state: DaemonConnectionState,
): string {
  switch (state) {
    case "connected":
      return "Connected";
    case "checking":
      return "Checking";
    case "reconnecting":
      return "Reconnecting";
  }
}

/** Status dot per state (fork runtimeDotColor, verbatim mapping). */
export function daemonConnectionDotClass(state: DaemonConnectionState): string {
  switch (state) {
    case "connected":
      return "bg-emerald-500";
    case "checking":
    case "reconnecting":
      return "bg-yellow-500";
  }
}

/** Label tone per state (fork runtimeStatusTone, verbatim mapping). */
export function daemonConnectionToneClass(
  state: DaemonConnectionState,
): string {
  if (state === "checking" || state === "reconnecting") {
    return "text-yellow-500";
  }
  return "text-muted-foreground";
}

/** App/terminal banner title while automatic retries are running. */
export const DAEMON_RECONNECTING_TITLE = "Reconnecting to Drogon service";

/** App/terminal banner body while automatic retries are running. */
export function daemonReconnectingBody(scope: "app" | "terminal"): string {
  return scope === "app"
    ? "Drogon is retrying automatically. Your sessions will resume if the connection returns."
    : "Drogon is retrying automatically. This terminal will resume if the connection returns.";
}

/**
 * Manual retry affordance (fork reconnectButton, verbatim): restarts the
 * ladder from the head step and probes immediately instead of waiting out
 * the backoff. Rendered persistently (the fork shows it only once its own
 * retries stop, but Drogon's retries never stop and its status bar hosts no
 * menus, so the toast action alone would be too easy to miss).
 */
export const DAEMON_RECONNECT_BUTTON_LABEL = "Reconnect";

/** Status detail summary (fork runtimeFailureSummary, adapted to local). */
export function daemonDisconnectSummary(state: DaemonConnectionState): string {
  switch (state) {
    case "connected":
      return "The previous connection closed";
    case "checking":
      return "Drogon is checking whether the service is reachable";
    case "reconnecting":
      return "Drogon is trying to restore the connection";
  }
}

/**
 * Canned explanation under the summary (fork runtimeFailureExplanation):
 * loss of contact says nothing about the sessions themselves.
 */
export function daemonDisconnectExplanation(
  state: DaemonConnectionState,
): string | null {
  if (state === "connected") return null;
  return "Your sessions may still be running; only the Drogon service connection is unavailable.";
}

/** "Attempt N" diagnostics while reconnecting (fork reconnectAttemptLabel). */
export function daemonReconnectAttemptLabel(attempt: number): string {
  return `Attempt ${attempt + 1}`;
}

/** Disconnect toast title (fork runtimeHostUnreachable, adapted). */
export const DAEMON_DISCONNECT_TOAST_TITLE = "Can't reach Drogon service";

/** Disconnect toast body (fork runtimeHostDisconnectedDescription, local). */
export const DAEMON_DISCONNECT_TOAST_DESCRIPTION =
  "Check that the Drogon service is running, then try again.";

/** Disconnect toast action (fork tryAgain, verbatim). */
export const DAEMON_DISCONNECT_TOAST_ACTION_LABEL = "Try again";
