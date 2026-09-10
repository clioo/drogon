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
import { Fragment, useState, useSyncExternalStore } from "react";
import { MoreHorizontal, StickyNote } from "lucide-react";
import { cn } from "../../lib/utils";
import type { Session, Worktree } from "../../../../shared/session-contract";
import { AgentStateIcon } from "./AgentStateIcon";
import { HarnessMenuIcon } from "./TabCreateMenuIcons";
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
import { WorktreeTitleInlineRename } from "./WorktreeTitleInlineRename";
import { WorktreeCardMetaBadges } from "./WorktreeCardMetaBadges";
import { WorktreeCardLinkedMetadata } from "./WorktreeCardLinkedMetadata";
import {
  cardIdentitySession,
  formatWorktreeCardSummaryLine,
  summarizeCardAgentStates,
} from "./worktree-card-agent-summary";
import { useWorktreeAgentExpansionState } from "./worktree-card-agents-expansion-state";
import {
  CompactAgentExpansion,
  CompactAgentSummaryButton,
} from "./worktree-card-compact-agents";
import type { WorktreeCardPrDisplay } from "./worktree-card-pr-display";
import { useWorktreeGitStatus } from "./use-worktree-git-status";
import {
  buildWorktreeAgentRows,
  formatRowHarnessLabel,
} from "./worktree-agent-rows";
import type { WorktreeAgentRow as WorktreeAgentRowData } from "./worktree-agent-rows";
import { WorktreeAgentRow } from "./WorktreeAgentRow";
import { useGeneratedAgentTitles } from "../settings/agent-generated-titles";
import { buildWorktreeAgentRowTree } from "./worktree-agent-lineage";
import type { TabStripState } from "./tab-order";
import type { CardProperty } from "./workspace-options-state";
import type { WorktreeIssueLink } from "../../../../shared/worktree-issue-contract";

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
  // disagree with the tree (same source the fork summarizes). Disclosure
  // state (collapsed lineage parents + the compact summary panel) lives in
  // the source's remount-durable expansion-state hook.
  const { rootRows, childrenByParentSessionId } =
    buildWorktreeAgentRowTree(rows);
  const {
    collapsedLineageParents,
    compactRootListExpanded,
    toggleLineageParent,
    toggleCompactRootList,
  } = useWorktreeAgentExpansionState(worktree.id);
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
  // The agent identity drawn beside the status dot (the fork's summary-pill
  // pairing of an AgentStateDot with the AgentIcon of the agents in that
  // same state group); null when no session reported a harness.
  const identitySession = cardIdentitySession(rowSessions);
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
        aria-label={`${name}${summary.unread ? ", needs input" : ""}${summaryLine ? `, ${summaryLine}` : ""}${note ? `, Note: ${note}` : ""}`}
      >
        {/* Status lane (the source's WorktreeCardStatusSlot column): the
            activity glyph lives left of the content, its tooltip names the
            state; unread (needs_input) shows the amber bell glyph like the
            source's filled bell. */}
        <div
          className="shell-worktree-card-status-lane"
          data-worktree-card-status-slot=""
        >
          {/* The card lane's own glyph set (the fork's StatusIndicator plus
              the unread bell): an emerald filled dot for a live-but-quiet
              worktree, the amber bell while the agent needs the user. */}
          <AgentStateIcon state={summary.state} size={12} variant="card" />
          {identitySession?.harnessId ? (
            <span
              className="shell-worktree-card-agent-avatar"
              data-worktree-card-agent-avatar=""
              title={formatRowHarnessLabel(identitySession.harnessId)}
            >
              <HarnessMenuIcon
                harnessId={identitySession.harnessId}
                displayName={formatRowHarnessLabel(identitySession.harnessId)}
                size={13}
              />
            </span>
          ) : null}
        </div>
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
              <WorktreeTitleInlineRename
                displayName={name}
                disabled={disabled || onRename === null}
                beginEditing={beginEditing}
                onBeginEditingConsumed={() => setBeginEditing(false)}
                onRename={(next) => onRename?.(next) ?? Promise.resolve(null)}
                showUnreadEmphasis={summary.unread}
                className="text-[13px] leading-5"
              />
            </span>
            <WorktreeCardMetaBadges
              // The fork's classic meta row shows the branch identity
              // whenever the worktree has one (worktree-card-presentation's
              // showBranch); only the ahead/behind chips stay tied to this
              // repo's Branch property.
              branch={branchLabel}
              ahead={showBranch ? (gitStatus?.branch.ahead ?? null) : null}
              behind={showBranch ? (gitStatus?.branch.behind ?? null) : null}
              upstream={showBranch ? (gitStatus?.branch.upstream ?? null) : null}
              issueNumber={showProperties.issue === false ? null : issueNumber}
              pr={showPr ? pr : null}
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
          {/* Nested session rows (the fork's WorktreeCardAgents inline list):
            one row per session, outside the select button so rows stay real
            buttons. Issue #359: rows with a recorded parent session render
            as a fork lineage branch — a disclosure chevron on the parent
            row and a boxed, indented children group beneath it. Compact
            mode (the default) folds multiple root rows into the source's
            "N agents" summary pill (CompactAgentSummaryButton). */}
          {showProperties["inline-agents"] !== false && rows.length > 0 ? (
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
              {agentActivityDisplayMode === "compact" &&
              (childrenByParentSessionId.size > 0
                ? rootRows.length
                : rows.length) > 1 ? (
                <div
                  className={cn(
                    "compact-agent-summary-panel",
                    compactRootListExpanded && "compact-agent-summary-panel-expanded",
                  )}
                >
                  <CompactAgentSummaryButton
                    sessions={rowSessions}
                    labelFor={(session) => formatRowHarnessLabel(session.harnessId ?? null)}
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
                        onToggleParent: toggleLineageParent,
                        anyRootHasChildren,
                        disabled,
                        onSelect: handleSelectSession,
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
                    onToggleParent: toggleLineageParent,
                    anyRootHasChildren,
                    disabled,
                    onSelect: handleSelectSession,
                  }),
                )
              )}
            </div>
          ) : null}
        </div>
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
