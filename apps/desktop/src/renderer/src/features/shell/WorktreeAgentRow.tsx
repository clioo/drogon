/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/worktree-card-compact-agent-row.tsx
   (CompactAgentRow: state dot, harness icon, primary/secondary text,
   relative time, focused-pane highlight, activation click with drag and
   key propagation guards).
   Adapter: Orca rows read hook-reported agent entries (model chip, tool
   preview, last assistant message, cache timer, subagent disclosure);
   this repo's contract carries none of those, so the row shows the tab
   title, the freshness/harness secondary from worktree-agent-rows.ts and
   the compact age. The fork's div becomes a button (valid nesting beside
   the card's select button, free keyboard support); the harness icon
   reuses this repo's HarnessMenuIcon and plain shells get the shell
   glyph. Not ported: model chip, cache timer, child-agent disclosure,
   send-target mode — no backing data in the session contract. */
import { memo, useCallback } from "react";
import { Terminal } from "lucide-react";
import { AgentStateIcon } from "./AgentStateIcon";
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
}: {
  row: WorktreeAgentRowData;
  disabled: boolean;
  /** Selects the row's session tab (workspace first, then the tab). */
  onSelect: (sessionId: string) => void;
}) {
  const handleActivate = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      onSelect(row.session.id);
    },
    [onSelect, row.session.id],
  );
  const primary = row.title || agentStateLabel(row.state);
  const rowTitle = row.secondary ? `${primary} - ${row.secondary}` : primary;
  const focused = row.focused;
  return (
    <button
      type="button"
      disabled={disabled}
      className={
        "compact-agent-row group/compact-agent-row flex h-6 w-full min-w-0 cursor-pointer items-center gap-1 overflow-hidden rounded-sm px-1 text-left text-[11px] leading-none text-muted-foreground worktree-agent-row-hover" +
        (focused ? " bg-worktree-sidebar-accent" : "")
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
      <AgentStateIcon state={row.state} size={13} />
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
    </button>
  );
});
