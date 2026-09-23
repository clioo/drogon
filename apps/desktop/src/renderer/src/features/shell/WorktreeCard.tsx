/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/worktree-card-surface.tsx,
   worktree-card-header.tsx, worktree-card-parent-content.tsx and
   worktree-card-secondary-rows.tsx (adapter: Orca's store-driven card
   becomes a pure props card over this repo's Worktree/Session contract;
   the title is the inline-rename editor, the meta row is the badges
   projection, and right-click / Menu-key / kebab open the worktree
   context menu). The card body follows the source's classic layout: a
   left status lane (WorktreeCardStatusSlot's StatusIndicator column),
   the identity column (title row + meta row at gap-1.5) and the inline
   agent rows (WorktreeCardAgents), with the compact "N agents" summary
   pill from worktree-card-compact-agents.tsx. The card's own extras the
   source does not render (base-ref line, note line, "No sessions yet")
   are folded into the accessible label instead of drawn. */
import { Fragment, useContext, useState, useSyncExternalStore } from "react";
import { ChevronRight, MoreHorizontal, StickyNote } from "lucide-react";
import { cn } from "../../lib/utils";
import type { GraphBridge } from "../../../../shared/graph-contract";
import type { Session, Worktree } from "../../../../shared/session-contract";
import { AgentStateIcon } from "./AgentStateIcon";
import { WorktreeCardAffordances } from "./WorktreeCardAffordances";
import { worktreeCardBranchLabel } from "./worktree-card-branch-identity";
import {
  getWorktreeIssueNumber,
  subscribeWorktreeIssueLinks,
  summarizeCardSessions,
  worktreeDisplayName,
} from "./project-adapter";
import type { Workspace } from "../../../../shared/session-contract";
import { WorktreeContextMenu } from "./WorktreeContextMenu";
import type { WorktreeBulkMenuTarget } from "./worktree-bulk-actions";
import { WorktreeTitleInlineRename } from "./WorktreeTitleInlineRename";
import { WorktreeCardMetaBadges } from "./WorktreeCardMetaBadges";
import { WorktreeCardLinkedMetadata } from "./WorktreeCardLinkedMetadata";
import { WorktreeCardPrStateIcon } from "./WorktreeCardPrStateIcon";
import { WorkspaceStatusRing } from "./WorkspaceStatusRing";
import { WorktreeWorkflow } from "./WorktreeWorkflow";
import {
  formatWorktreeCardSummaryLine,
  summarizeCardAgentStates,
} from "./worktree-card-agent-summary";
import {
  worktreeActivityGlyph,
  worktreeActivitySentence,
} from "./worktree-card-activity";
import { useWorktreeAgentExpansionState } from "./worktree-card-agents-expansion-state";
import {
  CompactAgentExpansion,
  CompactAgentSummaryButton,
} from "./worktree-card-compact-agents";
import type { WorktreeCardPrDisplay } from "./worktree-card-pr-display";
import { useWorktreeGitStatus } from "./use-worktree-git-status";
import { buildWorktreeAgentRows, defaultTitleBySession, formatRowHarnessLabel, resolveRowHarnessId } from "./worktree-agent-rows";
import type { WorktreeAgentRow as WorktreeAgentRowData } from "./worktree-agent-rows";
import { WorktreeAgentRow } from "./WorktreeAgentRow";
import { useGeneratedAgentTitles } from "../settings/agent-generated-titles";
import { buildWorktreeAgentRowTree } from "./worktree-agent-lineage";
import {
  isSessionOnCard,
  SidebarCardAttributionContext,
} from "./sidebar-card-attribution";
import type { TabStripState } from "./tab-order";
import { stripRedundantTitles } from "./tab-order";
import type { CardProperty } from "./workspace-options-state";
import type { WorktreeIssueLink } from "../../../../shared/worktree-issue-contract";
import type { WorkspaceStatusDefinition } from "../../../../shared/persistence-contracts/worktree-types";

/**
 * How many rows a card may show before the "N agents" pill takes over.
 * Owner's design (2026-09-21): the tree is what the card is for, so the
 * pill is no longer the default for a two-agent card — it only keeps a
 * genuinely long fan-out from eating the sidebar, and never when the user
 * chose the "full" display mode.
 */
export const COMPACT_AGENT_PILL_MIN_ROWS = 6;

/**
 * Why: the card surface arms pointer-drag reorder and selects on click —
 * the fold chevron must keep both local, like the nested rows do.
 */
function stopCardDragPropagation(event: React.SyntheticEvent): void {
  event.stopPropagation();
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
  /** Explicit user renames by session id (tab strip titles). */
  customTitles?: Record<string, string> | null;
  /** Auto-generated prompt titles by session id. */
  generatedTitles: Record<string, string>;
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
  // Issue #622: the tree node wraps the row instead of living inside it,
  // so the row keeps its exact shape (the div-with-nested-disclosure-button
  // for chevron rows, the button for leaves) while the wrapper carries the
  // treeitem semantics. Derived from the context — no new prop on the row.
  const inLineageTree = context.childrenByParentSessionId.size > 0;
  const branch = (
    <WorktreeAgentRow
      row={row}
      disabled={context.disabled}
      onSelect={context.onSelect}
      customTitle={context.customTitles?.[row.session.id] ?? null}
      generatedTitle={context.generatedTitles[row.session.id] ?? null}
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
      // Owner's design: a root row that owns subagents is the tree's parent
      // end — the one row that reads MAIN.
      isMainRow={isRootRow && hasChildAgents}
      // Issue #622: every descendant at depth >= 1 gets the lineage child
      // chrome, not only depth 1.
      isChildRow={depth >= 1}
    />
  );
  if (!inLineageTree) {
    return <Fragment key={row.session.id}>{branch}</Fragment>;
  }
  return (
    <Fragment key={row.session.id}>
      <div
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={hasChildAgents ? expanded : undefined}
        aria-label={`${row.title}${row.secondary ? ` - ${row.secondary}` : ""}`}
        data-lineage-depth={depth}
        className="min-w-0"
      >
        {branch}
      </div>
      {hasChildAgents && expanded ? (
        // Presentational wrapper only: the hierarchy rides the flat-tree
        // contract (`role="treeitem"` + 1-based `aria-level` +
        // `aria-expanded` on each node), so no `role="group"` — a group
        // sibling its parent treeitem does not own would misdescribe the
        // tree.
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
 * holds Open in editor / Reveal in Finder / Copy path, Rename, Pin/Unpin,
 * Move to Status, Create worktree from here and Delete worktree.
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
  onTogglePin = null,
  statuses = [],
  onMoveToStatus = null,
  onSelectSession = null,
  multiSelected = false,
  selectionActive = false,
  onSelectionClick = null,
  onContextMenuOpen = null,
  bulk = null,
  activeSessionId = "",
  tabStrip,
  showBranch = true,
  showPr = true,
  showProperties = {},
  ports = [],
  issueLinks = [],
  agentActivityDisplayMode = "full",
  graphBridge = null,
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
  /**
   * Toggles the daemon-stored pin flag for the context menu row.
   * Absent/null hides the row (direct test/fixture renders omit it).
   */
  onTogglePin?: (() => void) | null;
  /** Shared workspace statuses for the menu's Move to Status submenu. */
  statuses?: readonly WorkspaceStatusDefinition[];
  /**
   * Moves the worktree to a status (`null` clears the stored override).
   * Absent/null hides the submenu.
   */
  onMoveToStatus?: ((statusId: string | null) => void) | null;
  /** This card is part of the sidebar's current multi-selection. */
  multiSelected?: boolean;
  /** Any card is selected, so unselected cards read as "not chosen". */
  selectionActive?: boolean;
  /**
   * Offers a primary click to the selection model first. Returning true
   * means the click was a Cmd/Ctrl or Shift selection gesture and the card
   * must not switch workspace; false falls through to the normal select.
   */
  onSelectionClick?:
    | ((event: React.MouseEvent | React.KeyboardEvent) => boolean)
    | null;
  /** Lets the sidebar settle the selection before the menu opens. */
  onContextMenuOpen?: (() => void) | null;
  /** Non-null renders the multi-selection menu instead of the card's own. */
  bulk?: WorktreeBulkMenuTarget | null;
  /** Workspace options "Show properties" (workspace-options-state.ts):
   *  suppresses the branch name + ahead/behind badges, or the PR chip.
   *  Defaults preserve the card exactly as before this option existed. */
  showBranch?: boolean;
  showPr?: boolean;
  showProperties?: Partial<Record<CardProperty, boolean>>;
  agentActivityDisplayMode?: "compact" | "full";
  ports?: readonly number[];
  issueLinks?: readonly WorktreeIssueLink[];
  /** App-owned graph bridge, already gated by the live daemon capability. */
  graphBridge?: GraphBridge | null;
}) {
  const [beginEditing, setBeginEditing] = useState(false);
  const cardAttribution = useContext(SidebarCardAttributionContext);
  const attached = sessions.filter((session) =>
    isSessionOnCard(session, worktree.workspaceId, cardAttribution),
  );
  // One nested row per session (the fork's useWorktreeAgentRows slot); the
  // summary counts below derive from these same rows so the two can never
  // disagree — a session that never reported still owns its fallback row.
  const generatedTitles = useGeneratedAgentTitles(attached);
  // Frozen prefill copies (a rename dialog saved unchanged) carry no
  // information over the live default or generated title and would render
  // verbatim forever, defeating the concise provider fold. Heal them for
  // both the row merge and the verbatim path below; true renames survive.
  const healedTitles = stripRedundantTitles(
    tabStrip?.titles,
    defaultTitleBySession(attached, {
      stripOrder: tabStrip?.order,
      pinnedIds: tabStrip?.pinned,
    }),
    generatedTitles,
  );
  const rows = buildWorktreeAgentRows(attached, {
    stripOrder: tabStrip?.order,
    pinnedIds: tabStrip?.pinned,
    customTitles: { ...generatedTitles, ...healedTitles },
    activeSessionId,
  });
  // Issue #359 (#359 parity): nest rows under the recorded parent session
  // like the fork's buildAgentRowLineageTree — children render inside a
  // boxed group under the parent row, with the fork's disclosure chrome.
  // The summary below still derives from every row, so counts can never
  // disagree with the tree (same source the fork summarizes). Disclosure
  // state (collapsed lineage parents + the compact summary panel) lives in
  // the source's remount-durable expansion-state hook.
  const { rootRows, childrenByParentSessionId } =
    buildWorktreeAgentRowTree(rows);
  const {
    collapsedLineageParents,
    compactRootListExpanded,
    cardFolded,
    toggleLineageParent,
    toggleCompactRootList,
    toggleCardFolded,
  } = useWorktreeAgentExpansionState(worktree.id);
  // Why: root leaf siblings reserve a leading spacer when any root has a
  // chevron, keeping the state-dot column aligned (fork's
  // anyRootHasChildren rule).
  const anyRootHasChildren = rootRows.some(
    (row) =>
      (childrenByParentSessionId.get(row.session.id) ?? []).length > 0,
  );
  const rowSessions = rows.map((row) => row.session);
  // Live ids for prune-on-toggle: ids of sessions that no longer exist are
  // pruned when the user next folds, never eagerly on read — so a collapsed
  // parent whose children merely exited keeps its fold.
  const liveSessionIds = attached.map((session) => session.id);
  const handleToggleLineageParent = (sessionId: string) => {
    toggleLineageParent(sessionId, liveSessionIds);
  };
  const summary = summarizeCardSessions(rowSessions);
  const agentSummary = summarizeCardAgentStates(rowSessions);
  // Owner's design (2026-09-21): the card says in words what the lane and the
  // rows say in glyphs — one uppercase sentence under the title, plus the one
  // live glyph (spinner while working, bell while waiting) that must never be
  // hidden behind text. The ring beside them belongs to the workspace status.
  const activitySentence = worktreeActivitySentence(rowSessions);
  const activityGlyph = worktreeActivityGlyph(rowSessions);
  // The "N agents" pill is no longer the default for a small tree: the rows
  // are the card's point (see COMPACT_AGENT_PILL_MIN_ROWS)."
  const compactPillSubjectCount =
    childrenByParentSessionId.size > 0 ? rootRows.length : rows.length;
  const showCompactPill =
    agentActivityDisplayMode === "compact" &&
    compactPillSubjectCount >= COMPACT_AGENT_PILL_MIN_ROWS;
  // Row activation selects the workspace first, then the session tab: the
  // workspace switch clears the active tab, so the tab selection must win
  // last in the same batch (mirrors the notification focus handler).
  // A worker adopted from a checkout with no card of its own opens in that
  // checkout's workspace: its tab lives there, not in this card's strip.
  const handleSelectSession = (sessionId: string) => {
    onSelect(
      attached.find((session) => session.id === sessionId)?.workspaceId ??
        worktree.workspaceId,
    );
    onSelectSession?.(sessionId);
  };
  // Linked GitHub issue from the tasks link store (journey J6); null when
  // the worktree was not started from a task — no badge then.
  const issueNumber = useSyncExternalStore(subscribeWorktreeIssueLinks, () =>
    getWorktreeIssueNumber(worktree.id),
  );
  const name = worktreeDisplayName(worktree, workspaces);
  // The meta row's branch slot: the real branch, or "" when it would only
  // repeat the card title (the fork's `showBranch` de-dupe rule —
  // worktree-card-presentation.tsx).
  const branchLabel = worktreeCardBranchLabel(worktree.branch, name);
  const note = showProperties.comment === false ? "" : worktree.note?.trim() ?? "";
  // The card's one-line state sentence, folded into the accessible label
  // like the source's sr-only status announcement (the source draws no
  // summary text on the card; the lane dot + tooltip carry the state).
  const summaryLine = formatWorktreeCardSummaryLine(
    agentSummary,
    summary.activeRelative,
  );
  const hostId =
    workspaces.find((item) => item.id === worktree.workspaceId)?.hostId ?? null;
  const gitStatus = useWorktreeGitStatus({
    hostId,
    workspaceId: worktree.workspaceId,
    enabled: projectKind === "git" && !implicitFolderWorktree,
  });
  // The source's meta-row presence test (hasMetaRow): the branch identity
  // or any badge — the agent rows tighten up under the title when absent.
  const hasMetaRow = Boolean(
    branchLabel ||
      (showBranch && (gitStatus?.branch.ahead ?? 0) + (gitStatus?.branch.behind ?? 0) > 0) ||
      (showPr && pr) ||
      (showProperties.issue !== false && issueNumber !== null),
  );
  // The card's own fold (owner's design): the chevron beside the ring folds
  // the whole agent list; the sentence stays, so a folded card still says
  // what its agents are doing.
  const showAgentRows =
    showProperties["inline-agents"] !== false && rows.length > 0;
  const showAgentTree = showAgentRows && !cardFolded;
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
      onTogglePin={onTogglePin}
      statuses={statuses}
      onMoveToStatus={onMoveToStatus}
      bulk={bulk}
      onContextMenuOpen={onContextMenuOpen}
    >
      <div
        className="shell-worktree-card"
        data-active={selected}
        data-multi-selected={selectionActive ? multiSelected : undefined}
        data-worktree-card-id={worktree.id}
        data-worktree-card-project={worktree.projectId}
        data-worktree-card-index={cardIndex}
        onPointerDown={
          onCardPointerDown
            ? (event) => onCardPointerDown(event, worktree.id)
            : undefined
        }
        onClickCapture={onCardClickCapture}
        aria-label={`${name}${summary.unread ? ", needs input" : ""}${summaryLine ? `, ${summaryLine}` : ""}${note ? `, Note: ${note}` : ""}`}
      >
        {/* The card's own fold (owner's design, 2026-09-21): the leading
            chevron folds the whole agent list, mirroring the guide. The
            sentence stays visible, so a folded card still says what its
            agents are doing; folding a single agent's branch is the row's
            own chevron's job, never this one's. */}
        <button
          type="button"
          className="shell-worktree-card-fold"
          data-worktree-card-fold={cardFolded ? "folded" : "expanded"}
          aria-label={`${cardFolded ? "Show" : "Hide"} agents in ${name}`}
          aria-expanded={!cardFolded}
          disabled={disabled}
          onClick={(event) => {
            // The card surface selects on click: folding is not selecting.
            event.preventDefault();
            event.stopPropagation();
            toggleCardFolded();
          }}
          onMouseDown={stopCardDragPropagation}
          onPointerDown={stopCardDragPropagation}
        >
          <ChevronRight
            className={
              "size-3.5 transition-transform duration-150" +
              (!cardFolded ? " rotate-90" : "")
            }
            aria-hidden="true"
          />
        </button>
        {/* Status lane (the source's WorktreeCardStatusSlot column, owner's
            vocabulary): the workspace STATUS ring first — the same icon and
            colour the status carries in the board — then the one live
            activity glyph that must never be hidden behind text: the
            working spinner, or the amber bell while an agent waits for the
            user. */}
        <div
          className="shell-worktree-card-status-lane"
          data-worktree-card-status-slot=""
        >
          <WorkspaceStatusRing statuses={statuses} statusId={worktree.workspaceStatus} />
          {activityGlyph ? (
            <AgentStateIcon
              state={activityGlyph === "working" ? "working" : "needs_input"}
              size={13}
              variant="card"
            />
          ) : null}
        </div>
        {/* Header column: the card's first flex line (fold, status lane,
            this select content, affordances, kebab). The agent rows below
            are direct card children on their own full-width line, so the
            tree uses the whole card width the way the owner's guide draws
            it instead of squeezing into the header column. */}
        <div className="shell-worktree-card-main">
          <button
            type="button"
            className="shell-worktree-card-select"
            aria-current={selected ? "page" : undefined}
            // Why: while a multi-selection is live the card's primary
            // control really is a toggle, so screen readers get the
            // pressed state; with no selection it stays plain navigation.
            aria-pressed={selectionActive ? multiSelected : undefined}
            aria-label={`Select ${name}`}
            disabled={disabled}
            onClick={(event) => {
              // A Cmd/Ctrl or Shift click edits the selection instead of
              // switching workspace; a plain click clears it and navigates.
              if (onSelectionClick?.(event)) return;
              onSelect(worktree.workspaceId);
            }}
            onKeyDown={(event) => {
              // Keyboard parity for the same gestures: Chromium does not
              // turn a modified Enter/Space into a click, so the selection
              // would otherwise be mouse-only.
              if (event.key !== "Enter" && event.key !== " ") return;
              if (!event.metaKey && !event.ctrlKey && !event.shiftKey) return;
              if (!onSelectionClick) return;
              event.preventDefault();
              onSelectionClick(event);
            }}
          >
            <span className="shell-worktree-card-top">
              <WorktreeTitleInlineRename
                displayName={name}
                disabled={disabled || onRename === null}
                beginEditing={beginEditing}
                onBeginEditingConsumed={() => setBeginEditing(false)}
                onRename={(next) => onRename?.(next) ?? Promise.resolve(null)}
                showUnreadEmphasis={summary.unread}
                className="text-[13px] leading-5"
              />
              {/* Owner's design: the card's own review marker, ahead of the
                  kebab — one glyph whose colour is the review's state. It
                  replaces the old "PR #123" chip; the accessible label is
                  the chip's own string, so nothing the card announced
                  before is lost. */}
              {showPr ? <WorktreeCardPrStateIcon pr={pr} /> : null}
            </span>
            {/* The card's activity sentence (owner's design): the uppercase
                line under the title. It is aria-hidden because the card's
                aria-label already carries the same sentence through
                `formatWorktreeCardSummaryLine`. */}
            <span className="shell-worktree-card-sentence" aria-hidden="true">
              {activitySentence}
            </span>
            <WorktreeCardMetaBadges
              // The fork's classic meta row shows the branch identity
              // whenever the worktree has one (worktree-card-presentation's
              // showBranch); only the ahead/behind chips stay tied to this
              // repo's Branch property. The PR chip moved to the header's
              // state icon, so this row never repeats it.
              branch={branchLabel}
              ahead={showBranch ? (gitStatus?.branch.ahead ?? null) : null}
              behind={showBranch ? (gitStatus?.branch.behind ?? null) : null}
              upstream={showBranch ? (gitStatus?.branch.upstream ?? null) : null}
              issueNumber={showProperties.issue === false ? null : issueNumber}
              pr={null}
            />
            {/* The comment property's visible note line: this repo's own
                pinned property surface (probe-workspace-properties.mjs
                asserts the exact text on the card), kept as its own row. */}
            {note ? (
              <span className="shell-worktree-card-note" title={note}>
                <StickyNote size={12} aria-hidden="true" />
                <span>{note}</span>
              </span>
            ) : null}
          </button>
          <WorktreeCardLinkedMetadata worktree={worktree} properties={showProperties} ports={ports} issueLinks={issueLinks} />
          <WorktreeWorkflow
            workspaceId={worktree.workspaceId}
            bridge={graphBridge}
          />
        </div>
        {/* Nested session rows (the fork's WorktreeCardAgents inline list):
          direct card children on their own full-width flex line (order 6 in
          main.css), so the tree uses the whole card width the way the
          owner's guide draws it instead of squeezing into the header column
          beside the fold, lane, affordances and kebab. One row per session,
          outside the select button so rows stay real buttons. Issue #359:
          rows with a recorded parent session render as a fork lineage
          branch — a disclosure chevron on the parent row and an indented
          children group beneath it, joined by the tree's own connector
          lines. Owner's design (2026-09-21): the tree is what the card is
          for, so it renders inline; the "N agents" pill only takes over a
          genuinely long fan-out (COMPACT_AGENT_PILL_MIN_ROWS). */}
        {showAgentTree ? (
          <div
            className={cn(
              "shell-worktree-card-rows flex flex-col gap-0.5",
              // The fork's WorktreeCardAgents mt: the rows tighten up
              // under the title when the card has no meta row.
              !hasMetaRow && "-mt-1",
            )}
            data-compact-agent-list="true"
            role={childrenByParentSessionId.size > 0 ? "tree" : "group"}
            // The fork labels this group "Agents"; this repo's acceptance
            // oracle pins "<card> sessions", so the oracle-facing label
            // stays.
            aria-label={`${name} sessions`}
          >
            {showCompactPill ? (
              <div
                className={cn(
                  "compact-agent-summary-panel",
                  compactRootListExpanded && "compact-agent-summary-panel-expanded",
                )}
              >
                <CompactAgentSummaryButton
                  sessions={rowSessions}
                  // The pill summary keeps F1's shared harness labels
                  // (pinned by the lineage suite): sidebar "Claude Code"
                  // branding applies to the visible row primary only.
                  labelFor={(session) =>
                    formatRowHarnessLabel(resolveRowHarnessId(session))
                  }
                  subjectLabel={`${childrenByParentSessionId.size > 0 ? rootRows.length : rows.length} agents`}
                  expanded={compactRootListExpanded}
                  onToggle={toggleCompactRootList}
                />
                <CompactAgentExpansion expanded={compactRootListExpanded}>
                  {rootRows.map((row) =>
                    renderAgentBranch({
                      row,
                      ancestorSessionIds: new Set(),
                      childrenByParentSessionId,
                      collapsedLineageParents,
                      onToggleParent: handleToggleLineageParent,
                      anyRootHasChildren,
                      disabled,
                      onSelect: handleSelectSession,
                      customTitles: healedTitles,
                      generatedTitles,
                    }),
                  )}
                </CompactAgentExpansion>
              </div>
            ) : (
              rootRows.map((row) =>
                renderAgentBranch({
                  row,
                  ancestorSessionIds: new Set(),
                  childrenByParentSessionId,
                  collapsedLineageParents,
                  onToggleParent: handleToggleLineageParent,
                  anyRootHasChildren,
                  disabled,
                  onSelect: handleSelectSession,
                  customTitles: healedTitles,
                  generatedTitles,
                }),
              )
            )}
          </div>
        ) : null}
        {/* Right-side affordances (the fork's MetaIconBadge shell): the
            terminal marker for a workspace that owns sessions and the
            branch marker, ahead of the kebab. */}
        <WorktreeCardAffordances
          branch={worktree.branch}
          sessionCount={rows.length}
        />
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
