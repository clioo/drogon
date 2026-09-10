// MIT Copyright (c) 2026 Lovecast Inc.
// New for bug-bot-a836b4ebf8be65505: opening a Bot from the Bots page
// dropped the owner into a plain, unlabeled terminal tab with no bot
// identity anywhere on screen. This header renders above the terminal pane
// whenever the active tab is a Bot-opened session: a breadcrumb back to
// Bots, the session title, a live status pill, the Bot's own workspace
// path chip, and a working Stop control. No visual precedent in the
// read-only reference (the fork opens a plain agent tab too, see
// launch-drogon-bot-session.ts) -- built from the owner's own mockup,
// using this repo's existing Tailwind/shadcn tokens for consistency with
// the rest of the Bots feature.
import { Square } from "lucide-react";
import type { Session } from "../../../../shared/session-contract";
import { Button } from "../../components/ui/button";
import { agentIconKind, agentStateLabel } from "../shell/agent-state";
import {
  botHandleLabel,
  botSessionState,
  botSessionTitle,
  type BotSessionMeta,
} from "./bot-session-chrome";

const DOT_CLASS: Record<ReturnType<typeof agentIconKind>, string> = {
  working: "bg-emerald-500",
  idle: "bg-sky-500",
  "needs-input": "bg-amber-500",
  exited: "bg-destructive",
  unknown: "bg-muted-foreground",
};

export function BotSessionHeader({
  meta,
  session,
  workspacePath,
  onStop,
  stopping,
  onOpenBots,
}: {
  meta: BotSessionMeta;
  session: Session;
  /** The Bot's own home workspace path, once `workspaces` has caught up
   *  with the just-registered row; `null` renders an honest loading dash. */
  workspacePath: string | null;
  onStop: () => void;
  stopping: boolean;
  onOpenBots: () => void;
}): React.JSX.Element {
  const state = botSessionState(session);
  const dotKind = agentIconKind(state);
  const handle = botHandleLabel(meta.handle);
  const canStop = session.verdict !== "exited";

  return (
    <div
      className="flex flex-col gap-2 border-b border-border bg-card px-4 py-3"
      data-testid="bot-session-header"
    >
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-1.5 text-xs text-muted-foreground"
      >
        <button
          type="button"
          onClick={onOpenBots}
          className="cursor-pointer hover:text-foreground hover:underline"
        >
          Bots
        </button>
        <span aria-hidden>/</span>
        <span>{meta.displayName}</span>
        <span aria-hidden>/</span>
        <span className="text-foreground">Terminal</span>
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <h1
            className="truncate text-sm font-semibold text-foreground"
            data-testid="bot-session-title"
          >
            {botSessionTitle(meta.displayName, meta.harnessId)}
          </h1>
          {handle ? (
            <span className="truncate text-xs text-muted-foreground">
              {handle}
            </span>
          ) : null}
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground"
            data-testid="bot-session-status-pill"
          >
            <span
              aria-hidden
              className={`size-1.5 rounded-full ${DOT_CLASS[dotKind]}`}
            />
            {agentStateLabel(state)}
          </span>
          <span
            className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground"
            title={workspacePath ?? undefined}
          >
            <span className="shrink-0 font-medium text-foreground">
              Bot workspace
            </span>
            <span className="truncate font-mono">
              {workspacePath ?? "…"}
            </span>
          </span>
        </div>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={!canStop || stopping}
          onClick={onStop}
          data-testid="bot-session-stop"
        >
          <Square className="size-3.5" aria-hidden fill="currentColor" />
          {stopping ? "Stopping…" : "Stop"}
        </Button>
      </div>
    </div>
  );
}

export default BotSessionHeader;
