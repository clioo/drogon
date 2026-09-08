// MIT Copyright (c) 2026 Lovecast Inc.
// Issue #185: what the app reloads when the daemon connection becomes
// ready. The mount refresh is single-shot, so a transient failure left
// the sidebar empty forever: the daemon answered later probes, the
// digest never moved, and no retry ran. Worse, the retry used to live in
// the connection banner, which unmounts exactly when the workspace list
// is empty (Landing branch) — the state that needs the retry. So the
// monitor owner and the ready-transition watcher live here at App root,
// where no empty-state branch can unmount them; a boot pass with no confirmed status
// reloads everything (status, workspaces, sessions, projects), while
// later transitions keep the R16-M status-only reload that preserves
// terminal pane scrollback.

/** Monitor state the ready transition came from. */
export type ConnectionReadyPrevious = "checking" | "reconnecting";

/** What the App must reload on a connection-ready transition. */
export type ConnectionReadyReload = "skip" | "full" | "status-only";

/**
 * Pure decision so the boot race stays unit-tested without mounting App:
 * a boot pass (`checking`) with no confirmed status loads everything;
 * a boot pass after a good mount refresh loads nothing new; a return
 * from an outage (`reconnecting`) re-attaches sessions via status only.
 */
export function resolveConnectionReadyReload(
  hasConfirmedStatus: boolean,
  previous: ConnectionReadyPrevious,
): ConnectionReadyReload {
  if (previous === "checking") return hasConfirmedStatus ? "skip" : "full";
  return "status-only";
}

export type ConnectionReadyHandler = (
  previous: ConnectionReadyPrevious,
) => void;

import { useEffect, useRef } from "react";
import type { DaemonConnectionState } from "./daemon-connection";
import {
  ensureDaemonConnectionMonitor,
  useDaemonConnection,
} from "./daemon-connection-store";

/**
 * App-root watcher (issue #185): owns the daemon-connection monitor and
 * reports every ready transition. Mounted where no route or empty-state
 * branch can unmount it — unlike the banner owner, which unmounts exactly
 * when the workspace list is empty (Landing branch) and on full pages.
 * The handler identity is read
 * through a ref, so the effect only re-runs on connection-state changes.
 */
export function useConnectionReadyReload(onReady: ConnectionReadyHandler): void {
  useEffect(() => ensureDaemonConnectionMonitor(), []);
  const connection = useDaemonConnection();
  const previousRef = useRef<DaemonConnectionState>(connection.state);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = connection.state;
    if (
      connection.state === "connected" &&
      (previous === "checking" || previous === "reconnecting")
    ) {
      onReadyRef.current(previous);
    }
  }, [connection.state]);
}
