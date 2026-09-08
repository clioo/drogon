// MIT Copyright (c) 2026 Lovecast Inc. Ported from the Orca reference
// (read-only):
//   src/renderer/src/components/status-bar/SshStatusSegment.tsx
//     (segment trigger form: icon + label + status dot)
//   src/renderer/src/components/status-bar/RuntimeHostStatusRow.tsx
//     (state labels, dot colors, failure summary/explanation and Attempt
//     diagnostics, Connect action)
// Adapted: one local daemon instead of remote-host rows, so there is no
// dropdown menu (Drogon's status bar has no popovers) — the detail lives in
// the title tooltip — and no Disconnect action (stopping the local service
// from the status bar makes no sense). Unlike the fork's rows the Reconnect
// action stays visible the whole outage: Drogon's retries never stop on
// their own, so there is no later stopped phase to attach it to.
import { useEffect } from "react";
import { Loader2, Server } from "lucide-react";
import {
  DAEMON_RECONNECT_BUTTON_LABEL,
  daemonConnectionDotClass,
  daemonConnectionStatusLabel,
  daemonConnectionToneClass,
  daemonDisconnectExplanation,
  daemonDisconnectSummary,
  daemonReconnectAttemptLabel,
  type DaemonConnectionState,
} from "../shell/daemon-connection";
import {
  ensureDaemonConnectionMonitor,
  retryDaemonConnectionNow,
  useDaemonConnection,
  type DaemonConnectionSnapshot,
} from "../shell/daemon-connection-store";
import { useDaemonDisconnectToast } from "../shell/daemon-disconnect-toast";

/** Tooltip detail for the segment (fork row diagnostics, muted inline). */
export function daemonSegmentTitle(snapshot: DaemonConnectionSnapshot): string {
  const lines = [daemonDisconnectSummary(snapshot.state)];
  const explanation = daemonDisconnectExplanation(snapshot.state);
  if (explanation) lines.push(explanation);
  if (snapshot.state === "reconnecting")
    lines.push(daemonReconnectAttemptLabel(snapshot.attempt));
  if (snapshot.lastError && snapshot.state !== "connected")
    lines.push(snapshot.lastError);
  if (snapshot.state === "connected") return "Drogon service: Connected";
  return lines.join("\n");
}

function segmentDown(snapshot: DaemonConnectionSnapshot): boolean {
  return snapshot.state === "checking" || snapshot.state === "reconnecting";
}

function SegmentIcon({ state }: { state: DaemonConnectionState }) {
  if (state === "checking" || state === "reconnecting")
    return (
      <Loader2
        size={12}
        className="daemon-connection-spinner animate-spin text-yellow-500"
      />
    );
  return <Server size={12} className="text-emerald-500" />;
}

export function DaemonConnectionSegment({
  compact = false,
  iconOnly = false,
}: {
  /** Narrow bar: hide the text label, keep icon + status dot (fork
      SshStatusSegment compact form); the tooltip keeps the full detail. */
  compact?: boolean;
  iconOnly?: boolean;
} = {}): React.JSX.Element {
  useEffect(() => ensureDaemonConnectionMonitor(), []);
  const connection = useDaemonConnection();
  useDaemonDisconnectToast(connection, () => retryDaemonConnectionNow());
  const showLabel = !compact && !iconOnly;

  return (
    <span
      className="status-bar-segment"
      data-daemon-connection-segment={connection.state}
      title={daemonSegmentTitle(connection)}
    >
      <SegmentIcon state={connection.state} />
      {showLabel ? (
        <span className={daemonConnectionToneClass(connection.state)}>
          {daemonConnectionStatusLabel(connection.state)}
        </span>
      ) : null}
      <span
        aria-hidden
        className={`inline-block size-1.5 rounded-full ${daemonConnectionDotClass(connection.state)}`}
      />
      {segmentDown(connection) ? (
        <button
          type="button"
          className="status-bar-toggle"
          onClick={() => retryDaemonConnectionNow()}
        >
          {DAEMON_RECONNECT_BUTTON_LABEL}
        </button>
      ) : null}
    </span>
  );
}
