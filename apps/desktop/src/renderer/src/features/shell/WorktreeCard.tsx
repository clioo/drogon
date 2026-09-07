/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/worktree-card-surface.tsx and
   worktree-card-header.tsx (adapter: Orca's store-driven card becomes a
   pure props card over this repo's Worktree/Session contract). */
import { GitBranch } from "lucide-react";
import { useSyncExternalStore } from "react";
import type { Session, Worktree } from "../../../../shared/session-contract";
import { AgentStateIcon } from "./AgentStateIcon";
import {
  getWorktreeIssueNumber,
  subscribeWorktreeIssueLinks,
  summarizeCardSessions,
  worktreeDisplayName,
} from "./project-adapter";
import type { Workspace } from "../../../../shared/session-contract";

/**
 * One worktree card: branch name, display name, agent-state dot, unread
 * marker for needs_input sessions, and relative activity time. Selecting
 * the card selects the workspace the worktree attaches to.
 */
export function WorktreeCard({
  worktree,
  workspaces,
  sessions,
  selected,
  disabled,
  onSelect,
}: {
  worktree: Worktree;
  workspaces: Workspace[];
  sessions: Session[];
  selected: boolean;
  disabled: boolean;
  onSelect: (workspaceId: string) => void;
}) {
  const attached = sessions.filter(
    (session) => session.workspaceId === worktree.workspaceId,
  );
  const summary = summarizeCardSessions(attached);
  const liveCount = attached.filter(
    (session) => session.verdict === "live",
  ).length;
  // Linked GitHub issue from the tasks link store (journey J6); null when
  // the worktree was not started from a task — no badge then.
  const issueNumber = useSyncExternalStore(
    subscribeWorktreeIssueLinks,
    () => getWorktreeIssueNumber(worktree.id),
  );
  return (
    <button
      type="button"
      className="shell-worktree-card"
      data-active={selected}
      aria-current={selected ? "page" : undefined}
      aria-label={`${worktreeDisplayName(worktree, workspaces)}${summary.unread ? ", needs input" : ""}`}
      disabled={disabled}
      onClick={() => onSelect(worktree.workspaceId)}
    >
      <span className="shell-worktree-card-top">
        <AgentStateIcon state={summary.state} size={14} />
        <span className="shell-worktree-card-name">
          {worktreeDisplayName(worktree, workspaces)}
        </span>
        {summary.unread && (
          <span
            className="shell-unread-dot"
            aria-label="Unread agent request"
            title="An agent in this worktree is waiting for input"
          />
        )}
      </span>
      <span className="shell-worktree-card-meta">
        {issueNumber !== null && (
          <span
            className="shell-worktree-card-issue"
            title={`Started from issue #${issueNumber}`}
          >
            #{issueNumber}
          </span>
        )}
        {worktree.branch ? (
          <span className="shell-worktree-card-branch">
            <GitBranch size={12} aria-hidden="true" />
            <span>{worktree.branch}</span>
          </span>
        ) : null}
        {liveCount > 0 && (
          <span className="shell-worktree-card-sessions">
            {liveCount} live
          </span>
        )}
        {summary.activeRelative && (
          <span className="shell-worktree-card-time">
            {summary.activeRelative}
          </span>
        )}
      </span>
      <span className="shell-worktree-card-state">
        {attached.length > 0
          ? `${attached.length} session${attached.length === 1 ? "" : "s"}`
          : "No sessions yet"}
      </span>
    </button>
  );
}
