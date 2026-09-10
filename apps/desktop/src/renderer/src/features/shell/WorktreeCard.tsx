/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/worktree-card-surface.tsx and
   worktree-card-header.tsx (adapter: Orca's store-driven card becomes a
   pure props card over this repo's Worktree/Session contract; the title
   is the inline-rename editor, the meta row is the badges projection,
   and right-click / Menu-key / kebab open the worktree context menu.) */
import { Fragment, useState, useSyncExternalStore } from "react";
import { MoreHorizontal, StickyNote } from "lucide-react";
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
import { WorktreeCardLinkedMetadata } from "./WorktreeCardLinkedMetadata";
import {
  formatWorktreeCardSummaryLine,
  summarizeCardAgentStates,
} from "./worktree-card-agent-summary";
import type { WorktreeCardPrDisplay } from "./worktree-card-pr-display";
import { useWorktreeGitStatus } from "./use-worktree-git-status";
import { buildWorktreeAgentRows } from "./worktree-agent-rows";
import type { WorktreeAgentRow as WorktreeAgentRowData } from "./worktree-agent-rows";
import { WorktreeAgentRow } from "./WorktreeAgentRow";
import { useGeneratedAgentTitles } from "../settings/agent-generated-titles";
import { buildWorktreeAgentRowTree } from "./worktree-agent-lineage";
import type { TabStripState } from "./tab-order";
import type { CardProperty } from "./workspace-options-state";
import type { WorktreeIssueLink } from "../../../../shared/worktree-issue-contract";

// Fork worktree-card-agents-expansion-state.ts adaptation (issue #359):
// disclosure state keyed by worktree id in a module map so a card remount
// (project collapse, sidebar rebuild) does not reset the user's collapsed
// parents — the source keeps it out of component state for the same reason.
const collapsedLineageParentsByWorktree = new Map<string, Set<string>>();

function readCollapsedParents(worktreeId: string): Set<string> {
  let collapsed = collapsedLineageParentsByWorktree.get(worktreeId);
  if (!collapsed) {
    collapsed = new Set();
    collapsedLineageParentsByWorktree.set(worktreeId, collapsed);
  }
  return collapsed;
}

type AgentBranchContext = {
  row: WorktreeAgentRowData;
  ancestorSessionIds: ReadonlySet<string>;
  childrenByParentSessionId: ReadonlyMap<string, WorktreeAgentRowData[]>;
  collapsedLineageParents: ReadonlySet<string>;
  onToggleParent: (sessionId: string) => void;
  anyRootHasChildren: boolean;
  disabled: boolean;
  onSelect: (sessionId: string) => void;
  depth?: number;
};

/**
 * One fork lineage branch (WorktreeCardAgents.renderAgentBranch): the row,
 * then — while expanded — its children inside the boxed
 * `worktree-agent-lineage-children` group. Cycles bail instead of
 * recursing forever (the fork's ancestor-set guard).
 */
function renderAgentBranch(
  context: AgentBranchContext,
): React.ReactNode {
  const { row } = context;
  if (context.ancestorSessionIds.has(row.session.id)) {
    return null;
  }
  const childRows =
    context.childrenByParentSessionId.get(row.session.id) ?? [];
  const hasChildAgents = childRows.length > 0;
  const depth = context.depth ?? 0;
  const isRootRow = depth === 0;
  // Why: the fork defaults branches to expanded; only an explicit user
  // collapse folds them ("spawned child agents are actionable work").
  const expanded = !context.collapsedLineageParents.has(row.session.id);
  const descendantAncestorSessionIds = new Set(context.ancestorSessionIds);
  descendantAncestorSessionIds.add(row.session.id);
  const childContext: AgentBranchContext = {
    ...context,
    ancestorSessionIds: descendantAncestorSessionIds,
    depth: depth + 1,
  };
  return (
    <Fragment key={row.session.id}>
      <WorktreeAgentRow
        row={row}
        disabled={context.disabled}
        onSelect={context.onSelect}
        childCount={hasChildAgents ? childRows.length : undefined}
        childrenExpanded={expanded}
        onToggleChildren={
          hasChildAgents
            ? () => context.onToggleParent(row.session.id)
            : undefined
        }
        reserveDisclosureGutter={
          isRootRow && context.anyRootHasChildren && !hasChildAgents
        }
        // Why: the fork's isLineageChild is depth === 1 exactly.
        isChildRow={depth === 1}
      />
      {hasChildAgents && expanded ? (
        <div className="worktree-agent-lineage-children">
          {childRows.map((childRow) =>
            renderAgentBranch({ ...childContext, row: childRow }),
          )}
        </div>
      ) : null}
    </Fragment>
  );
}

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
  showBranch = true,
  showPr = true,
  showProperties = {},
  ports = [],
  issueLinks = [],
  agentActivityDisplayMode = "full",
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
  /** Workspace options "Show properties" (workspace-options-state.ts):
   *  suppresses the branch name + ahead/behind badges, or the PR chip.
   *  Defaults preserve the card exactly as before this option existed. */
  showBranch?: boolean;
  showPr?: boolean;
  showProperties?: Partial<Record<CardProperty, boolean>>;
  agentActivityDisplayMode?: "compact" | "full";
  ports?: readonly number[];
  issueLinks?: readonly WorktreeIssueLink[];
}) {
  const [beginEditing, setBeginEditing] = useState(false);
  const [, forceCollapsedParentsBump] = useState(0);
  const [compactExpanded, setCompactExpanded] = useState(false);
  const attached = sessions.filter(
    (session) => session.workspaceId === worktree.workspaceId,
  );
  // One nested row per session (the fork's useWorktreeAgentRows slot); the
  // summary counts below derive from these same rows so the two can never
  // disagree — a session that never reported still owns its fallback row.
  const generatedTitles = useGeneratedAgentTitles(attached);
  const rows = buildWorktreeAgentRows(attached, {
    stripOrder: tabStrip?.order,
    pinnedIds: tabStrip?.pinned,
    customTitles: { ...generatedTitles, ...tabStrip?.titles },
    activeSessionId,
  });
  // Issue #359 (#359 parity): nest rows under the recorded parent session
  // like the fork's buildAgentRowLineageTree — children render inside a
  // boxed group under the parent row, with the fork's disclosure chrome.
  // The summary below still derives from every row, so counts can never
  // disagree with the tree (same source the fork summarizes).
  const { rootRows, childrenByParentSessionId } =
    buildWorktreeAgentRowTree(rows);
  const collapsedLineageParents = readCollapsedParents(worktree.id);
  const toggleLineageParent = (sessionId: string) => {
    if (collapsedLineageParents.has(sessionId)) {
      collapsedLineageParents.delete(sessionId);
    } else {
      collapsedLineageParents.add(sessionId);
    }
    forceCollapsedParentsBump((n) => n + 1);
  };
  // Why: root leaf siblings reserve a leading spacer when any root has a
  // chevron, keeping the state-dot column aligned (fork's
  // anyRootHasChildren rule).
  const anyRootHasChildren = rootRows.some(
    (row) =>
      (childrenByParentSessionId.get(row.session.id) ?? []).length > 0,
  );
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
  const issueNumber = useSyncExternalStore(subscribeWorktreeIssueLinks, () =>
    getWorktreeIssueNumber(worktree.id),
  );
  const name = worktreeDisplayName(worktree, workspaces);
  const note = showProperties.comment === false ? "" : worktree.note?.trim() ?? "";
  const hostId =
    workspaces.find((item) => item.id === worktree.workspaceId)?.hostId ?? null;
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
        aria-label={`${name}${summary.unread ? ", needs input" : ""}${note ? `, Note: ${note}` : ""}`}
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
              branch={showBranch ? worktree.branch : ""}
              ahead={showBranch ? (gitStatus?.branch.ahead ?? null) : null}
              behind={showBranch ? (gitStatus?.branch.behind ?? null) : null}
              upstream={showBranch ? (gitStatus?.branch.upstream ?? null) : null}
              issueNumber={showProperties.issue === false ? null : issueNumber}
              pr={showPr ? pr : null}
            />
            {showBranch && worktree.baseRef ? (
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
            {note ? (
              <span className="shell-worktree-card-note" title={note}>
                <StickyNote size={12} aria-hidden="true" />
                <span>{note}</span>
              </span>
            ) : null}
          </button>
          <WorktreeCardLinkedMetadata worktree={worktree} properties={showProperties} ports={ports} issueLinks={issueLinks} />
          {/* Nested session rows (the fork's inline agent list): one row per
            session underneath the summary line, outside the select button
            so rows stay real buttons. Issue #359: rows with a recorded
            parent session render as a fork lineage branch — a disclosure
            chevron on the parent row and a boxed, indented children group
            beneath it (worktree-card-compact-agent-row.tsx /
            WorktreeCardAgents.renderCompactAgentBranch). */}
          {showProperties["inline-agents"] !== false && rows.length > 0 ? (
            <div
              className="shell-worktree-card-rows"
              role="group"
              aria-label={`${name} sessions`}
            >
              {agentActivityDisplayMode === "compact" && rootRows.length > 1 ? (
                <button type="button" className="shell-worktree-card-summary"
                  aria-expanded={compactExpanded} disabled={disabled}
                  onClick={() => setCompactExpanded((expanded) => !expanded)}>
                  {rootRows.length} agents
                </button>
              ) : null}
              {(agentActivityDisplayMode === "full" || rootRows.length <= 1 || compactExpanded) && rootRows.map((row) =>
                renderAgentBranch({
                  row,
                  ancestorSessionIds: new Set(),
                  childrenByParentSessionId,
                  collapsedLineageParents,
                  onToggleParent: toggleLineageParent,
                  anyRootHasChildren,
                  disabled,
                  onSelect: handleSelectSession,
                }),
              )}
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
