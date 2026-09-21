/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/worktree-card-compact-agent-row.tsx
   (CompactAgentRow: identity glyph, primary/secondary text, relative time,
   focused-pane highlight, activation click with drag and key propagation
   guards; issue #359 adds the fork's child-agent disclosure from the same
   file: the chevron button with its Show/Hide-N-child-agents label, the +N
   count while collapsed, the reserved disclosure gutter on leaf root rows,
   and the worktree-agent-lineage-parent/child-row classes).
   Owner's sidebar design (2026-09-21) reorders the row to read like the
   owner's guide: `[chevron] [harness glyph] [name] [MAIN] … [state dot +
   label] [age]`. The state text is always present — the owner's decision is
   that a main row's state matters as much as a subagent's — and it is the
   freshness report ("No update in 34m") while the session is not reporting,
   so the row never states a condition the daemon did not report. The MAIN
   badge marks a root row that actually owns subagents (the nesting's parent
   end), never a lone session.
   Adapter: Orca rows read hook-reported agent entries (model chip, tool
   preview, last assistant message, cache timer, subagent disclosure); this
   repo's contract carries none of those, so the row shows the tab title
   (which reads the resolved harness, issue #622), the freshness/harness
   secondary from worktree-agent-rows.ts and the compact age. The fork's
   div becomes a button for leaf rows (valid nesting beside the card's
   select button, free keyboard support); a row with children keeps the
   fork's div + nested disclosure-button shape — interactive content may
   not descend from a button, and the source row is exactly this div. Not
   ported: model chip, cache timer, send-target mode — no backing data in
   the session contract. The visible texts are aria-hidden on purpose: the
   row's own aria-label (and each state glyph's label) is the announcement,
   so a screen reader never hears the state twice. */
import { memo, useCallback } from "react";
import { ChevronRight, Terminal } from "lucide-react";
import { AgentStateIcon } from "./AgentStateIcon";
import { AgentCacheTimer } from "./AgentCacheTimer";
import { HarnessMenuIcon } from "./TabCreateMenuIcons";
import { agentStateLabel } from "./agent-state";
import {
  formatRowHarnessLabel,
  resolveRowHarnessId,
  type WorktreeAgentRow as WorktreeAgentRowData,
} from "./worktree-agent-rows";

function stopCardDragPropagation(event: React.SyntheticEvent): void {
  // Why: the card surface arms pointer-drag reorder and the surrounding
  // list activates on click — a nested row must keep both local, like the
  // source's stopPropagation on mouse/pointer/drag start.
  event.stopPropagation();
}

function stopActivationKeyPropagation(event: React.KeyboardEvent): void {
  // Why: the surrounding worktree list handles Enter/Space as row
  // activation. Focused nested buttons need those keys to stay local.
  if (event.key === "Enter" || event.key === " ") event.stopPropagation();
}

export type WorktreeAgentRowProps = {
  row: WorktreeAgentRowData;
  disabled: boolean;
  /** Selects the row's session tab (workspace first, then the tab). */
  onSelect: (sessionId: string) => void;
  /** Issue #359: fork child-agent disclosure props (see header). */
  childCount?: number;
  childrenExpanded?: boolean;
  onToggleChildren?: () => void;
  reserveDisclosureGutter?: boolean;
  isChildRow?: boolean;
  /** Owner's design: the badge a root row that owns subagents carries. */
  isMainRow?: boolean;
};

/**
 * PERF-03: the card rebuilds every row object on each App render (and the
 * card's own select handler is re-created with it), so the default shallow
 * memo never hits. Compare by rendered content instead: the row's display
 * fields plus the session facts the row actually reads (dot/harness/timer).
 * Callback identity is deliberately ignored — both callbacks are behaviorally
 * stable per session (workspace-first activation; lineage toggle), so a fresh
 * closure with the same target must not re-render the row.
 */
export function areWorktreeAgentRowPropsEqual(
  previous: WorktreeAgentRowProps,
  next: WorktreeAgentRowProps,
): boolean {
  if (previous === next) return true;
  return (
    previous.disabled === next.disabled &&
    previous.childCount === next.childCount &&
    previous.childrenExpanded === next.childrenExpanded &&
    previous.reserveDisclosureGutter === next.reserveDisclosureGutter &&
    previous.isChildRow === next.isChildRow &&
    previous.isMainRow === next.isMainRow &&
    previous.row.state === next.row.state &&
    previous.row.title === next.row.title &&
    previous.row.secondary === next.row.secondary &&
    previous.row.stateLabel === next.row.stateLabel &&
    previous.row.relativeTime === next.row.relativeTime &&
    previous.row.focused === next.row.focused &&
    previous.row.session.id === next.row.session.id &&
    previous.row.session.harnessId === next.row.session.harnessId &&
    previous.row.session.observedHarnessId ===
      next.row.session.observedHarnessId &&
    previous.row.session.verdict === next.row.session.verdict &&
    previous.row.session.agentState === next.row.session.agentState &&
    previous.row.session.agentStateAt === next.row.session.agentStateAt &&
    previous.row.session.cacheIdleAt === next.row.session.cacheIdleAt
  );
}

export const WorktreeAgentRow = memo(function WorktreeAgentRow({
  row,
  disabled,
  onSelect,
  childCount,
  childrenExpanded = false,
  onToggleChildren,
  reserveDisclosureGutter = false,
  isChildRow = false,
  isMainRow = false,
}: WorktreeAgentRowProps) {
  const handleActivate = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      onSelect(row.session.id);
    },
    [onSelect, row.session.id],
  );
  const hasChildDisclosure =
    typeof childCount === "number" &&
    childCount > 0 &&
    typeof onToggleChildren === "function";
  const handleToggleChildren = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onToggleChildren?.();
    },
    [onToggleChildren],
  );
  const primary = row.title || agentStateLabel(row.state);
  // Why: while a session is not reporting, its secondary slot repeats the
  // freshness report the trailing state text already carries — one honest
  // line, not two.
  const secondary =
    row.state === "unknown" && row.secondary === row.stateLabel
      ? ""
      : row.secondary;
  const rowTitle = [primary, secondary, row.stateLabel]
    .filter(Boolean)
    .join(" - ");
  const focused = row.focused;
  const childAgentLabel = childCount === 1 ? "agent" : "agents";
  const lineageClasses =
    // Why: the fork's lineage chrome — the parent reads as a tree node,
    // the child as a member of the group below it.
    (hasChildDisclosure ? " worktree-agent-lineage-parent-row" : "") +
    (isChildRow ? " worktree-agent-lineage-child-row" : "");

  const disclosure = hasChildDisclosure ? (
    <button
      type="button"
      className="compact-agent-child-disclosure-button flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-worktree-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-worktree-sidebar-ring"
      aria-label={`${childrenExpanded ? "Hide" : "Show"} ${childCount} child ${childAgentLabel}`}
      aria-expanded={childrenExpanded}
      disabled={disabled}
      onClick={handleToggleChildren}
      onKeyDown={stopActivationKeyPropagation}
    >
      <ChevronRight
        className={
          "size-3 transition-transform duration-150" +
          (childrenExpanded ? " rotate-90" : "")
        }
        aria-hidden="true"
      />
    </button>
  ) : reserveDisclosureGutter ? (
    // Why: keep leaf rows aligned with parent rows whose leading chevron
    // takes this slot (the fork's reserveDisclosureGutter).
    <span className="size-4 shrink-0" aria-hidden="true" />
  ) : null;

  // The resolved harness (launch or observed, issue #622): the harness
  // icon for a session running an agent, the Terminal glyph only when
  // nothing is resolved.
  const resolvedHarnessId = resolveRowHarnessId(row.session);
  const identity = (
    <span
      className="shell-worktree-agent-glyph inline-flex shrink-0"
      title={formatRowHarnessLabel(resolvedHarnessId)}
    >
      {resolvedHarnessId ? (
        <HarnessMenuIcon
          harnessId={resolvedHarnessId}
          displayName={formatRowHarnessLabel(resolvedHarnessId)}
          size={13}
        />
      ) : (
        <Terminal size={13} className="shrink-0" aria-hidden="true" />
      )}
    </span>
  );

  const text = (
    <span className="min-w-0 flex-1 truncate" aria-hidden="true">
      {/* Why: the selected-row fill washes out dimmed text, so both
          spans lift toward full foreground when focused (source). */}
      <span className={focused ? "text-foreground" : "text-muted-foreground/90"}>
        {primary}
      </span>
      {secondary && (
        <span
          className={focused ? "text-foreground/70" : "text-muted-foreground/65"}
        >
          {" "}
          - {secondary}
        </span>
      )}
    </span>
  );

  const tail = (
    <>
      {/* Why: the badge sits OUTSIDE the truncating name column — a long
          title truncates, the fact that this row is the tree's main agent
          must not disappear with it. */}
      {isMainRow && (
        <span className="shell-worktree-agent-main-badge" aria-hidden="true">
          MAIN
        </span>
      )}
      {hasChildDisclosure && !childrenExpanded && (
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
          +{childCount}
        </span>
      )}
      {/* Owner's design: every row states what its session is doing. The
          glyph carries the state's accessible label (the same one the tab
          badge uses); the text beside it is aria-hidden, so the state is
          announced once. */}
      <span
        className="shell-worktree-agent-state shrink-0"
        data-worktree-agent-state={row.state}
      >
        <AgentStateIcon state={row.state} size={10} variant="row" />
        <span className="shell-worktree-agent-state-label" aria-hidden="true">
          {row.stateLabel}
        </span>
      </span>
      <AgentCacheTimer session={row.session} />
      {row.relativeTime && (
        <span
          className={
            "shrink-0 text-[10px] tabular-nums " +
            // Why: the muted timestamp drops out against the
            // selected-row fill (source).
            (focused ? "text-foreground/70" : "text-muted-foreground/60")
          }
        >
          {row.relativeTime}
        </span>
      )}
    </>
  );

  if (hasChildDisclosure) {
    // Why: the fork's row with children is a div carrying a real nested
    // disclosure button; a <button> may not contain interactive content,
    // so the parent-row shape follows the source verbatim (leaf rows
    // below keep this repo's button adapter).
    return (
      <div
        className={
          "compact-agent-row group/compact-agent-row flex h-6 min-w-0 cursor-pointer items-center gap-1 overflow-hidden rounded-sm px-1 text-[11px] leading-none text-muted-foreground worktree-agent-row-hover" +
          (focused ? " bg-worktree-sidebar-accent" : "") +
          lineageClasses
        }
        onClick={handleActivate}
        onMouseDown={stopCardDragPropagation}
        onPointerDown={stopCardDragPropagation}
        onDragStart={stopCardDragPropagation}
        data-focused-agent-pane={focused ? "true" : undefined}
        data-worktree-agent-row={row.session.id}
        title={rowTitle}
      >
        {disclosure}
        {identity}
        {text}
        {tail}
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      className={
        "compact-agent-row group/compact-agent-row flex h-6 w-full min-w-0 cursor-pointer items-center gap-1 overflow-hidden rounded-sm px-1 text-left text-[11px] leading-none text-muted-foreground worktree-agent-row-hover" +
        (focused ? " bg-worktree-sidebar-accent" : "") +
        lineageClasses
      }
      onClick={handleActivate}
      onMouseDown={stopCardDragPropagation}
      onPointerDown={stopCardDragPropagation}
      onDragStart={stopCardDragPropagation}
      onKeyDown={stopActivationKeyPropagation}
      data-focused-agent-pane={focused ? "true" : undefined}
      data-worktree-agent-row={row.session.id}
      aria-label={rowTitle}
      aria-current={focused ? "true" : undefined}
      title={rowTitle}
    >
      {disclosure}
      {identity}
      {text}
      {tail}
    </button>
  );
}, areWorktreeAgentRowPropsEqual);
