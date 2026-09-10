/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/worktree-card-compact-agent-row.tsx
   (CompactAgentRow: state dot, harness icon, primary/secondary text,
   relative time, focused-pane highlight, activation click with drag and
   key propagation guards; issue #359 adds the fork's child-agent
   disclosure from the same file: the chevron button with its
   Show/Hide-N-child-agents label, the +N count while collapsed, the
   reserved disclosure gutter on leaf root rows, and the
   worktree-agent-lineage-parent/child-row classes).
   Adapter: Orca rows read hook-reported agent entries (model chip, tool
   preview, last assistant message, cache timer, subagent disclosure);
   this repo's contract carries none of those, so the row shows the tab
   title, the freshness/harness secondary from worktree-agent-rows.ts and
   the compact age. The fork's div becomes a button for leaf rows (valid
   nesting beside the card's select button, free keyboard support); a row
   with children keeps the fork's div + nested disclosure-button shape —
   interactive content may not descend from a button, and the source row
   is exactly this div. The harness icon reuses this repo's
   HarnessMenuIcon and plain shells get the shell glyph. Not ported:
   model chip, cache timer, send-target mode — no backing data in the
   session contract. */
import { memo, useCallback } from "react";
import { ChevronRight, Terminal } from "lucide-react";
import { AgentStateIcon } from "./AgentStateIcon";
import { AgentCacheTimer } from "./AgentCacheTimer";
import { HarnessMenuIcon } from "./TabCreateMenuIcons";
import { agentStateLabel } from "./agent-state";
import {
  formatRowHarnessLabel,
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

export const WorktreeAgentRow = memo(function WorktreeAgentRow({
  row,
  disabled,
  onSelect,
  childCount,
  childrenExpanded = false,
  onToggleChildren,
  reserveDisclosureGutter = false,
  isChildRow = false,
}: {
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
}) {
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
  const rowTitle = row.secondary ? `${primary} - ${row.secondary}` : primary;
  const focused = row.focused;
  const childAgentLabel = childCount === 1 ? "agent" : "agents";
  const lineageClasses =
    // Why: the fork's lineage chrome — the parent reads as a tree node,
    // the child as a member of the boxed group below it.
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

  const identity = (
    <>
      {/* The source's inline rows pass stateDotSize="sm" (a 10px box) so
          the dot isn't mistaken for the adjacent identity glyph. */}
      <AgentStateIcon state={row.state} size={10} />
      <span
        className="inline-flex shrink-0"
        title={formatRowHarnessLabel(row.session.harnessId ?? null)}
      >
        {row.session.harnessId ? (
          <HarnessMenuIcon
            harnessId={row.session.harnessId}
            displayName={formatRowHarnessLabel(row.session.harnessId)}
            size={13}
          />
        ) : (
          <Terminal size={13} className="shrink-0" aria-hidden="true" />
        )}
      </span>
    </>
  );

  const text = (
    <span className="min-w-0 flex-1 truncate" aria-hidden="true">
      {/* Why: the selected-row fill washes out dimmed text, so both
          spans lift toward full foreground when focused (source). */}
      <span className={focused ? "text-foreground" : "text-muted-foreground/90"}>
        {primary}
      </span>
      {row.secondary && (
        <span
          className={focused ? "text-foreground/70" : "text-muted-foreground/65"}
        >
          {" "}
          - {row.secondary}
        </span>
      )}
    </span>
  );

  const tail = (
    <>
      {hasChildDisclosure && !childrenExpanded && (
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
          +{childCount}
        </span>
      )}
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
    // above keep this repo's button adapter).
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
});
