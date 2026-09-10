// MIT Copyright (c) 2026 Lovecast Inc.
// Gap 3 (task_926fddc5e769): one Bot-session row in the sidebar's "Chats"
// section. Composed from this repo's existing sidebar row primitives so it
// matches the worktree agent rows the section already renders — the same
// `compact-agent-row` recipe, the same state glyph, the same harness icon
// and focused-row fill, and real button semantics with an aria-label. The
// state text is the daemon-owned verdict's label (never a hook guess): the
// owner asked for truthful live/idle/exited state in this surface.
import { Terminal } from "lucide-react";
import { AgentStateIcon } from "./AgentStateIcon";
import { agentStateLabel } from "./agent-state";
import { HarnessMenuIcon } from "./TabCreateMenuIcons";
import type { SidebarBotSession } from "./sidebar-bot-sessions";
import { formatRowHarnessLabel } from "./worktree-agent-rows";

export function BotSessionRow({
  row,
  active,
  disabled,
  onSelect,
}: {
  row: SidebarBotSession;
  active: boolean;
  disabled: boolean;
  onSelect: (botId: string) => void;
}): React.JSX.Element {
  const harnessLabel = row.harnessId
    ? formatRowHarnessLabel(row.harnessId)
    : "Shell";
  return (
    <button
      type="button"
      disabled={disabled}
      className={
        "compact-agent-row group/compact-agent-row flex h-6 w-full min-w-0 cursor-pointer items-center gap-1 overflow-hidden rounded-sm px-1 text-left text-[11px] leading-none text-muted-foreground worktree-agent-row-hover" +
        (active ? " bg-worktree-sidebar-accent" : "")
      }
      onClick={(event) => {
        // Why: the row sits beside the worktree list whose cards activate
        // on click — keep the activation local, like the agent rows.
        event.stopPropagation();
        onSelect(row.botId);
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onDragStart={(event) => event.stopPropagation()}
      data-bot-session-row={row.botId}
      data-bot-session-state={row.state}
      aria-label={row.title}
      aria-current={active ? "true" : undefined}
      title={row.title}
    >
      <AgentStateIcon state={row.state} size={13} />
      <span className="inline-flex shrink-0" title={harnessLabel}>
        {row.harnessId ? (
          <HarnessMenuIcon
            harnessId={row.harnessId}
            displayName={harnessLabel}
            size={13}
          />
        ) : (
          <Terminal size={13} className="shrink-0" aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate" aria-hidden="true">
        <span
          className={active ? "text-foreground" : "text-muted-foreground/90"}
        >
          {row.displayName}
        </span>
        {row.harnessId ? (
          <span
            className={active ? "text-foreground/70" : "text-muted-foreground/65"}
          >
            {" "}
            · {harnessLabel}
          </span>
        ) : null}
      </span>
      <span
        className={
          "shrink-0 text-[10px] " +
          (active ? "text-foreground/70" : "text-muted-foreground/60")
        }
      >
        {agentStateLabel(row.state)}
      </span>
    </button>
  );
}
