// MIT Copyright (c) 2026 Lovecast Inc.
// New for bug-bot-a836b4ebf8be65505: "A Bot session inspector panel on the
// right, which does not exist at all today" (owner's brief). Mounted in
// the right sidebar's existing `session` tab slot in place of the generic
// SessionDetailsPanel whenever the active terminal is a Bot-opened session.
// Every value below is read from the real dispatched session/bot identity
// (App.tsx's `meta`), the live Session record, and the periodic
// `bot.snapshot` pid projection -- never hardcoded per-bot; an unknown
// value renders an honest dash instead of a guess.
import type { Session } from "../../../../shared/session-contract";
import { agentIconKind, agentStateLabel } from "../shell/agent-state";
import {
  botHandleLabel,
  botInitials,
  botSessionState,
  formatBotSessionStarted,
  harnessProviderLabel,
  type BotSessionMeta,
} from "./bot-session-chrome";

const DOT_CLASS: Record<ReturnType<typeof agentIconKind>, string> = {
  working: "bg-emerald-500",
  idle: "bg-sky-500",
  "needs-input": "bg-amber-500",
  exited: "bg-destructive",
  unknown: "bg-muted-foreground",
};

function InspectorRow({
  label,
  children,
  testId,
}: {
  label: string;
  children: React.ReactNode;
  testId: string;
}): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5" data-testid={testId}>
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-xs text-foreground">
        {children}
      </span>
    </div>
  );
}

export function BotSessionInspector({
  meta,
  session,
  workspacePath,
  processId,
  nowMs,
}: {
  meta: BotSessionMeta;
  session: Session;
  /** The Bot's own home workspace path; `null` while `workspaces` has not
   *  yet caught up with the just-registered row. */
  workspacePath: string | null;
  /** Live OS pid from the daemon's own session registry (via
   *  `bot.snapshot`'s projection); `null` when unknown or not live. */
  processId: number | null;
  /** Caller-supplied clock tick so the Started row live-updates without
   *  this component owning its own timer. */
  nowMs: number;
}): React.JSX.Element {
  const state = botSessionState(session);
  const dotKind = agentIconKind(state);
  const handle = botHandleLabel(meta.handle);
  const startedAtMs = Date.parse(session.createdAt);

  return (
    <aside
      className="flex flex-col gap-4 p-4"
      aria-label="Bot session"
      data-testid="bot-session-inspector"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-sm font-semibold text-muted-foreground"
        >
          {botInitials(meta.displayName) || "?"}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">
            {meta.displayName}
          </p>
          {handle ? (
            <p className="truncate text-xs text-muted-foreground">{handle}</p>
          ) : null}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {meta.title ?? "Autonomous code operator"}
      </p>
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground">
        <span aria-hidden className={`size-1.5 rounded-full ${DOT_CLASS[dotKind]}`} />
        {agentStateLabel(state)}
      </span>
      <div className="divide-y divide-border/60 border-t border-border">
        <InspectorRow label="Harness" testId="bot-session-row-harness">
          {harnessProviderLabel(meta.harnessId)}
        </InspectorRow>
        <InspectorRow label="Model" testId="bot-session-row-model">
          {meta.model ? (
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
              {meta.model}
            </code>
          ) : (
            <span className="text-muted-foreground">Harness default</span>
          )}
        </InspectorRow>
        <InspectorRow label="Workspace" testId="bot-session-row-workspace">
          <span className="flex flex-col items-end">
            <span className="font-mono">{workspacePath ?? "…"}</span>
            <span className="text-[11px] text-muted-foreground">
              Isolated runtime
            </span>
          </span>
        </InspectorRow>
        <InspectorRow label="Session type" testId="bot-session-row-type">
          Child session
        </InspectorRow>
        <InspectorRow label="Started" testId="bot-session-row-started">
          {Number.isFinite(startedAtMs)
            ? formatBotSessionStarted(startedAtMs, nowMs)
            : "Unknown"}
        </InspectorRow>
        <InspectorRow label="Process ID" testId="bot-session-row-pid">
          {processId !== null ? (
            <code className="font-mono">pid: {processId}</code>
          ) : (
            <span className="text-muted-foreground">Unknown</span>
          )}
        </InspectorRow>
      </div>
      <div className="rounded-md border border-border bg-muted/30 p-3">
        <p className="text-xs font-medium text-foreground">Workspace isolation</p>
        <p className="mt-1 text-xs text-muted-foreground">
          The bot profile stays available in Bots while this terminal is
          open. Disk writes are constrained to sandbox directories.
        </p>
      </div>
    </aside>
  );
}

export default BotSessionInspector;
