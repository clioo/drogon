/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/worktree-card-surface.tsx and
   worktree-card-header.tsx (adapter: Orca's store-driven card becomes a
   pure props card over this repo's Worktree/Session contract). */
import { useState, useSyncExternalStore } from "react";
import { GitBranch, MoreHorizontal } from "lucide-react";
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
 * One worktree card: branch and base ref, display name, agent-state dot,
 * unread marker for needs_input sessions, and relative activity time.
 * The main surface selects the workspace the worktree attaches to; the
 * kebab menu holds worktree actions (remove). Agent markers are unchanged
 * by the menu addition.
 */
export function WorktreeCard({
  worktree,
  workspaces,
  sessions,
  selected,
  disabled,
  onSelect,
  onRemove,
}: {
  worktree: Worktree;
  workspaces: Workspace[];
  sessions: Session[];
  selected: boolean;
  disabled: boolean;
  onSelect: (workspaceId: string) => void;
  /** Null for implicit folder worktrees, which have nothing to remove. */
  onRemove: (() => void) | null;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
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
  const name = worktreeDisplayName(worktree, workspaces);
  return (
    <div
      className="shell-worktree-card"
      data-active={selected}
      aria-label={`${name}${summary.unread ? ", needs input" : ""}`}
    >
      <button
        type="button"
        className="shell-worktree-card-select"
        aria-current={selected ? "page" : undefined}
        aria-label={`Select ${name}`}
        disabled={disabled}
        onClick={() => onSelect(worktree.workspaceId)}
      >
        <span className="shell-worktree-card-top">
          <AgentStateIcon state={summary.state} size={14} />
          <span className="shell-worktree-card-name">{name}</span>
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
          {worktree.baseRef ? (
            <span
              className="shell-worktree-card-base"
              title={`Based on ${worktree.baseRef}`}
            >
              base {worktree.baseRef}
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
      {onRemove && (
        <span className="shell-worktree-card-menu">
          <button
            type="button"
            className="shell-icon-button"
            aria-label={`Worktree actions for ${name}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            disabled={disabled}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <MoreHorizontal size={15} />
          </button>
          {menuOpen && (
            <span
              role="menu"
              aria-label={`Worktree actions for ${name}`}
              className="shell-menu"
              onKeyDown={(event) => {
                if (event.key === "Escape") setMenuOpen(false);
              }}
            >
              <button
                type="button"
                role="menuitem"
                className="shell-menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  onRemove();
                }}
              >
                Remove worktree
              </button>
            </span>
          )}
        </span>
      )}
    </div>
  );
}
