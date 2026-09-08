// MIT Copyright (c) 2026 Lovecast Inc. Ported from the Orca reference
// (read-only):
//   src/renderer/src/components/terminal-pane/TerminalRemoteRuntimeReconnectBanner.tsx
//     (card structure, icon box, retrying vs disconnected copy split,
//     Reconnect button only once automatic retries stop, role=status)
// Adapted: app-level instead of pane-level, so the card renders in-flow in
// the session-header banner slot (not absolutely positioned); copy names
// the Drogon service; translate() is plain strings. While the connection
// is down the raw error text stays hidden — the banner covers it, like the
// fork's TerminalErrorToast suppression — and any unrelated error keeps the
// exact legacy error-banner markup below.
import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  DAEMON_RECONNECT_BUTTON_LABEL,
  DAEMON_RECONNECTING_TITLE,
  daemonReconnectingBody,
} from "./daemon-connection";
import {
  ensureDaemonConnectionMonitor,
  retryDaemonConnectionNow,
  useDaemonConnection,
} from "./daemon-connection-store";
import { useDaemonDisconnectToast } from "./daemon-disconnect-toast";

export function DaemonConnectionBanner({
  error,
  retryDisabled,
  onRetry,
  onReconnected,
}: {
  /** Raw action error; shown only while connected (unrelated failure). */
  error: string;
  retryDisabled: boolean;
  /** Manual refresh path (App `refresh`: status + workspaces + sessions). */
  onRetry: () => void;
  /** Runs once per down→up transition so sessions re-attach on return. */
  onReconnected: () => void;
}): React.JSX.Element | null {
  useEffect(() => ensureDaemonConnectionMonitor(), []);
  const connection = useDaemonConnection();
  const handleRetry = (): void => {
    retryDaemonConnectionNow();
    onRetry();
  };
  useDaemonDisconnectToast(connection, handleRetry);
  const previousState = useRef(connection.state);
  useEffect(() => {
    const previous = previousState.current;
    previousState.current = connection.state;
    // The initial checking→connected pass already loaded through the App
    // mount refresh; only a real down→up transition reloads.
    if (connection.state === "connected" && previous === "reconnecting") {
      onReconnected();
    }
  }, [connection.state, onReconnected]);

  if (connection.state === "connected") {
    if (!error) return null;
    return (
      <div className="error-banner" role="alert">
        <span>{error}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={retryDisabled}
          onClick={onRetry}
        >
          Retry
        </Button>
      </div>
    );
  }

  // Retries never stop (a later service restart must still reconnect on its
  // own), so the manual affordance stays visible next to the spinner — the
  // fork shows its Reconnect only once its own retries stop, but Drogon has
  // no such phase and its status bar hosts no menus.
  return (
    <div
      className="daemon-connection-banner"
      data-daemon-connection-banner={connection.state}
    >
      <div
        className="pointer-events-auto flex w-full items-center gap-3 rounded-md border border-border bg-card/95 px-3 py-3 text-card-foreground shadow-xs backdrop-blur-[1px]"
        role="status"
        aria-live="polite"
      >
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
          <Loader2 className="daemon-connection-spinner size-4 animate-spin" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">
            {DAEMON_RECONNECTING_TITLE}
          </div>
          <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
            {daemonReconnectingBody("app")}
          </div>
        </div>
        <Button size="sm" onClick={handleRetry}>
          {DAEMON_RECONNECT_BUTTON_LABEL}
        </Button>
      </div>
    </div>
  );
}
