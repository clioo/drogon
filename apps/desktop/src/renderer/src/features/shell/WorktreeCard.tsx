/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/worktree-card-surface.tsx and
   worktree-card-header.tsx (adapter: Orca's store-driven card becomes a
   pure props card over this repo's Worktree/Session contract; the title
   is the inline-rename editor, the meta row is the badges projection,
   and right-click / Menu-key / kebab open the worktree context menu.) */
import { useState, useSyncExternalStore } from "react";
import { MoreHorizontal } from "lucide-react";
import type { Session, Worktree } from "../../../../shared/session-contract";
import { AgentStateIcon } from "./AgentStateIcon";
import {
  getWorktreeIssueNumber,
  subscribeWorktreeIssueLinks,
  summarizeCardSessions,
  worktreeDisplayName,
} from "./project-adapter";
import type { Workspace } from "../../../../shared/session-contract";
import { WorktreeContextMenu } from "./WorktreeContextMenu";
import { WorktreeTitleInlineRename } from "./WorktreeTitleInlineRename";
import { WorktreeCardMetaBadges } from "./WorktreeCardMetaBadges";
import {
  formatWorktreeCardSummaryLine,
  summarizeCardAgentStates,
} from "./worktree-card-agent-summary";
import type { WorktreeCardPrDisplay } from "./worktree-card-pr-display";
import { useWorktreeGitStatus } from "./use-worktree-git-status";
import { buildWorktreeAgentRows } from "./worktree-agent-rows";
import { WorktreeAgentRow } from "./WorktreeAgentRow";
import type { TabStripState } from "./tab-order";

/**
 * One worktree card: inline-rename title, agent-state dot, unread marker
 * for needs_input sessions, meta badges (issue, branch, ahead/behind,
 * PR chip when known, agent summary) and relative activity time. The
 * main surface selects the workspace the worktree attaches to; the
 * context menu (right-click, Menu key, Shift+F10, or the kebab button)
 * holds Open in editor / Reveal in Finder / Copy path, Rename, Create
 * worktree from here and Delete worktree.
 */
export function WorktreeCard({
  worktree,
  workspaces,
  sessions,
  selected,
  disabled,
  projectKind,
  implicitFolderWorktree,
  primaryCheckout = false,
  pr = null,
  onSelect,
  cardIndex = 0,
  onCardPointerDown,
  onCardClickCapture,
  onRemove,
  onRename,
  onSelectSession = null,
  activeSessionId = "",
  tabStrip,
}: {
  worktree: Worktree;
  workspaces: Workspace[];
  sessions: Session[];
  selected: boolean;
  disabled: boolean;
  projectKind: "git" | "folder";
  implicitFolderWorktree: boolean;
  /** The card is the project's main checkout (path === project.path). */
  primaryCheckout?: boolean;
  /** Known PR for the chip; null hides it (no PR store yet). */
  pr?: WorktreeCardPrDisplay | null;
  onSelect: (workspaceId: string) => void;
  /** Selects a session tab; null hides row activation (rows still render). */
  onSelectSession?: ((sessionId: string) => void) | null;
  /** Active session tab id for the focused-row highlight. */
  activeSessionId?: string;
  /** Strip order/pins/renames so row titles read exactly like tab titles. */
  tabStrip?: TabStripState;
  /** Zero-based index among the project's visible cards (drag geometry). */
  cardIndex?: number;
  /** Arms the pointer drag session; absent disables card dragging. */
  onCardPointerDown?: (
    event: React.PointerEvent<HTMLElement>,
    worktreeId: string,
  ) => void;
  /** Capture-phase click guard that swallows the select click after a drag. */
  onCardClickCapture?: (event: React.MouseEvent<HTMLElement>) => void;
  /** Null only while the worktree bridge is unavailable. */
  onRemove: (() => void) | null;
  /**
   * Submits an inline-rename title; resolves an error message or null.
   * Null for implicit folder worktrees, whose title is the folder.
   */
  onRename: ((name: string) => Promise<string | null>) | null;
}) {
  const [beginEditing, setBeginEditing] = useState(false);
  const attached = sessions.filter(
    (session) => session.workspaceId === worktree.workspaceId,
  );
  // One nested row per session (the fork's useWorktreeAgentRows slot); the
  // summary counts below derive from these same rows so the two can never
  // disagree — a session that never reported still owns its fallback row.
  const rows = buildWorktreeAgentRows(attached, {
    stripOrder: tabStrip?.order,
    pinnedIds: tabStrip?.pinned,
    customTitles: tabStrip?.titles,
    activeSessionId,
  });
  const rowSessions = rows.map((row) => row.session);
  const summary = summarizeCardSessions(rowSessions);
  const agentSummary = summarizeCardAgentStates(rowSessions);
  // Row activation selects the workspace first, then the session tab: the
  // workspace switch clears the active tab, so the tab selection must win
  // last in the same batch (mirrors the notification focus handler).
  const handleSelectSession = (sessionId: string) => {
    onSelect(worktree.workspaceId);
    onSelectSession?.(sessionId);
  };
  // Linked GitHub issue from the tasks link store (journey J6); null when
  // the worktree was not started from a task — no badge then.
  const issueNumber = useSyncExternalStore(
    subscribeWorktreeIssueLinks,
    () => getWorktreeIssueNumber(worktree.id),
  );
  const name = worktreeDisplayName(worktree, workspaces);
  const hostId =
    workspaces.find((item) => item.id === worktree.workspaceId)?.hostId ??
    null;
  const gitStatus = useWorktreeGitStatus({
    hostId,
    workspaceId: worktree.workspaceId,
    enabled: projectKind === "git" && !implicitFolderWorktree,
  });
  return (
    <WorktreeContextMenu
      worktree={worktree}
      displayName={name}
      projectKind={projectKind}
      implicitFolderWorktree={implicitFolderWorktree}
      primaryCheckout={primaryCheckout}
      disabled={disabled}
      onRename={onRename ? () => setBeginEditing(true) : null}
      onDelete={onRemove}
    >
      <div
        className="shell-worktree-card"
        data-active={selected}
        data-worktree-card-id={worktree.id}
        data-worktree-card-project={worktree.projectId}
        data-worktree-card-index={cardIndex}
        onPointerDown={
          onCardPointerDown
            ? (event) => onCardPointerDown(event, worktree.id)
            : undefined
        }
        onClickCapture={onCardClickCapture}
        aria-label={`${name}${summary.unread ? ", needs input" : ""}`}
      >
        {/* Main column: the card is a flex row (select content beside the
            kebab), so the select button and the nested rows share one
            column wrapper instead of squeezing each other to zero width. */}
        <div className="shell-worktree-card-main">
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
            <WorktreeTitleInlineRename
              displayName={name}
              disabled={disabled || onRename === null}
              beginEditing={beginEditing}
              onBeginEditingConsumed={() => setBeginEditing(false)}
              onRename={(next) => onRename?.(next) ?? Promise.resolve(null)}
            />
            {summary.unread && (
              <span
                className="shell-unread-dot"
                aria-label="Unread agent request"
                title="An agent in this worktree is waiting for input"
              />
            )}
          </span>
          <WorktreeCardMetaBadges
            branch={worktree.branch}
            ahead={gitStatus?.branch.ahead ?? null}
            behind={gitStatus?.branch.behind ?? null}
            upstream={gitStatus?.branch.upstream ?? null}
            issueNumber={issueNumber}
            pr={pr}
          />
          {worktree.baseRef ? (
            <span
              className="shell-worktree-card-base"
              title={`Based on ${worktree.baseRef}`}
            >
              base {worktree.baseRef}
            </span>
          ) : null}
          {/* Why: the fork's card keeps the agent summary and the relative
              time on one compact line (no duplicated session count); the
              line truncates instead of wrapping the timestamp alone. */}
          {attached.length === 0 ? (
            <span className="shell-worktree-card-summary">
              No sessions yet
            </span>
          ) : (
            <span
              className="shell-worktree-card-summary"
              title={formatWorktreeCardSummaryLine(
                agentSummary,
                summary.activeRelative,
              )}
            >
              {formatWorktreeCardSummaryLine(
                agentSummary,
                summary.activeRelative,
              )}
            </span>
          )}
        </button>
        {/* Nested session rows (the fork's inline agent list): one row per
            session underneath the summary line, outside the select button
            so rows stay real buttons. */}
        {rows.length > 0 ? (
          <div
            className="shell-worktree-card-rows"
            role="group"
            aria-label={`${name} sessions`}
          >
            {rows.map((row) => (
              <WorktreeAgentRow
                key={row.session.id}
                row={row}
                disabled={disabled}
                onSelect={handleSelectSession}
              />
            ))}
          </div>
        ) : null}
        </div>
        <span className="shell-worktree-card-menu">
          <button
            type="button"
            className="shell-icon-button"
            aria-label={`Worktree actions for ${name}`}
            aria-haspopup="menu"
            disabled={disabled}
            onClick={(event) => {
              // The kebab opens the same Radix menu as right-click: route
              // through a contextmenu event at the button so there is one
              // menu implementation for pointer, touch and keyboard.
              const rect = event.currentTarget.getBoundingClientRect();
              event.currentTarget.dispatchEvent(
                new MouseEvent("contextmenu", {
                  bubbles: true,
                  cancelable: true,
                  clientX: rect.left + rect.width / 2,
                  clientY: rect.bottom,
                }),
              );
            }}
          >
            <MoreHorizontal size={15} />
          </button>
        </span>
      </div>
    </WorktreeContextMenu>
  );
}
