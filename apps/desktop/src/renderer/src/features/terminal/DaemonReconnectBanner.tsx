// MIT Copyright (c) 2026 Lovecast Inc. Ported from the Orca reference
// (read-only)
// src/renderer/src/components/terminal-pane/TerminalRemoteRuntimeReconnectBanner.tsx.
// Adapted: only the retrying phase exists — Drogon's monitor never stops
// retrying (a later service restart must still reconnect on its own), so the
// fork's stopped-retries phase with its Reconnect button has no equivalent;
// the manual affordance lives in the app banner, the toast and the status
// segment. Copy names the Drogon service; translate() is plain strings.
// Structure, classes, icons, copy shape and ARIA are otherwise unchanged.
import { Loader2 } from "lucide-react";
import {
  DAEMON_RECONNECTING_TITLE,
  daemonReconnectingBody,
} from "../shell/daemon-connection";

export function DaemonReconnectBanner(): React.JSX.Element {
  return (
    <div
      className="pointer-events-none absolute inset-x-3 bottom-3 z-30 flex justify-center"
      data-daemon-reconnect-banner="reconnecting"
    >
      <div
        className="pointer-events-auto flex w-full max-w-xl items-center gap-3 rounded-md border border-border bg-card/95 px-3 py-3 text-card-foreground shadow-xs backdrop-blur-[1px]"
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
            {daemonReconnectingBody("terminal")}
          </div>
        </div>
      </div>
    </div>
  );
}
