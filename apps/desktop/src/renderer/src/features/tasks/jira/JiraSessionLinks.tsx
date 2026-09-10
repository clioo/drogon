// MIT Copyright (c) 2026 Lovecast Inc. C06: the stable issue→session links
// panel for a Jira issue. Presentational only — the durable registry is the
// daemon's (crates/drogon-core/src/jira/session_links.rs); this component
// renders the binding rows with DISTINCT actionable states (live,
// unverifiable, exited, no session) and the read-path notices (connection
// unavailable vs confirmed issue deletion are never conflated).
import React from "react";
import {
  CircleAlert,
  CircleHelp,
  Link2Off,
  CirclePlay,
  Square,
  ExternalLink,
} from "lucide-react";
import { Button } from "../../../components/ui/button";
import type { JiraSessionState } from "../jira-task-resume-storage";

/** One rendered binding. `identity` is null for an UNRESOLVED legacy row:
 * displayed for honesty, never relinked by account email or display key. */
export type JiraSessionLinkView = {
  linkKey: string;
  identity: {
    instanceId: string;
    instanceUrl: string;
    issueId: string;
    key: string;
  } | null;
  worktreeId: string;
  worktreeTitle: string;
  workspaceId: string | null;
  sessionId: string | null;
  sessionState: JiraSessionState;
};

/** Read-path notices. "connection-unavailable" (offline/403/read error)
 * and "issue-deleted" (confirmed 404 on the instance) are different
 * states with different actions. */
export type JiraLinkNotice = "connection-unavailable" | "issue-deleted" | null;

const SESSION_STATE_BADGE: Record<JiraSessionState, { label: string; tone: string }> = {
  live: {
    label: "Live",
    tone: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200",
  },
  unverifiable: {
    label: "Unverifiable",
    tone: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200",
  },
  exited: {
    label: "Exited",
    tone: "border-border/50 bg-muted/40 text-muted-foreground",
  },
  "no-session": {
    label: "No session",
    tone: "border-border/50 bg-muted/40 text-muted-foreground",
  },
};

function SessionStateBadge({ state }: { state: JiraSessionState }): React.JSX.Element {
  const badge = SESSION_STATE_BADGE[state];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${badge.tone}`}
    >
      {state === "live" ? (
        <CirclePlay className="size-3" />
      ) : state === "unverifiable" ? (
        <CircleHelp className="size-3" />
      ) : (
        <Square className="size-3" />
      )}
      {badge.label}
    </span>
  );
}

export function JiraSessionLinks({
  links,
  notice,
  onResume,
  onOpenIssue,
  onUnlink,
  busyLinkKey = null,
}: {
  links: JiraSessionLinkView[];
  notice: JiraLinkNotice;
  onResume: (view: JiraSessionLinkView) => void | Promise<void>;
  onOpenIssue: (view: JiraSessionLinkView) => void | Promise<void>;
  onUnlink: (view: JiraSessionLinkView) => void | Promise<void>;
  busyLinkKey?: string | null;
}): React.JSX.Element {
  return (
    <section aria-label="Session links" className="flex flex-col gap-2">
      {notice === "connection-unavailable" ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-200"
        >
          <CircleAlert className="mt-0.5 size-4 flex-none" />
          <span>
            The Jira connection is unavailable, so link states could not be
            verified. Existing links are kept.
          </span>
        </div>
      ) : null}
      {notice === "issue-deleted" ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <CircleAlert className="mt-0.5 size-4 flex-none" />
          <span>
            This issue was confirmed deleted on the Jira instance. You can
            unlink the remaining sessions.
          </span>
        </div>
      ) : null}
      {links.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">
          No linked sessions yet. Start the issue or link an existing
          workspace to bind it here.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {links.map((view) => {
            const busy = busyLinkKey === view.linkKey;
            return (
              <li
                key={view.linkKey}
                className="flex items-center gap-2 rounded-md border border-border/60 bg-background px-3 py-2 text-sm"
              >
                <SessionStateBadge state={view.sessionState} />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {view.worktreeTitle || view.worktreeId}
                </span>
                {view.identity ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => void onOpenIssue(view)}
                    title={`Open ${view.identity.key} in Jira`}
                  >
                    <ExternalLink className="size-3" />
                    {view.identity.key}
                  </Button>
                ) : (
                  <span
                    className="text-xs text-muted-foreground"
                    title="Linked before stable identities existed; the original connection cannot be proven"
                  >
                    Unresolved link
                  </span>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={busy}
                  onClick={() => void onResume(view)}
                >
                  {view.sessionState === "live"
                    ? "Open session"
                    : view.sessionState === "unverifiable"
                      ? "Reconnect to verify"
                      : view.sessionState === "exited"
                        ? "Reopen session"
                        : "New session"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={busy}
                  aria-label="Unlink session"
                  title="Unlink (keeps the workspace, sessions and history)"
                  onClick={() => void onUnlink(view)}
                >
                  <Link2Off className="size-3" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
