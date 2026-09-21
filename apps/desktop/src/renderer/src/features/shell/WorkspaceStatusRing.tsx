/* MIT Copyright (c) 2026 Lovecast Inc.
   The worktree card's left lane glyph (owner's design, 2026-09-21): the
   workspace STATUS ring — the same icon and colour the status itself carries
   in `features/kanban/workspace-status.ts` (`getWorkspaceStatusVisualMeta`),
   so the sidebar, the board and the "Move to Status" menu can never draw the
   same status differently. Owner's decision (this file's design): the ring
   shows the status, and the live agent activity beside it
   (`worktree-card-activity.ts`) keeps its own slot; a worktree with no status
   set draws a dashed neutral ring — "no status" stays visually distinct from
   the solid `Todo` ring instead of claiming a status the owner never chose.
   The token vocabulary is Tailwind from the status visuals; this module only
   positions it. Passive by design: the tooltip carries the status label and
   the ring is not a control (setting the status stays in the card menu). */
import type { WorkspaceStatusDefinition } from "../../../../shared/persistence-contracts/worktree-types";
import { getWorkspaceStatusVisualMeta } from "../kanban/workspace-status";

/** Ring geometry: the size the owner's design draws next to the card title. */
export const WORKSPACE_STATUS_RING_SIZE = 20;

export function WorkspaceStatusRing({
  statuses,
  statusId,
  size = WORKSPACE_STATUS_RING_SIZE,
}: {
  /** The workspace's own status definitions (Workspace options). */
  statuses: readonly WorkspaceStatusDefinition[];
  /** `worktree.workspaceStatus`; null/absent means the owner set none. */
  statusId: string | null | undefined;
  size?: number;
}) {
  const definition =
    statusId == null
      ? null
      : (statuses.find((status) => status.id === statusId) ?? null);
  // A status id this profile no longer defines must not invent a colour:
  // it reads as "no status", exactly like an unset one.
  if (!definition) {
    return (
      <span
        className="shell-worktree-card-status-ring"
        role="img"
        aria-label="No status"
        title="No status"
        style={{ width: size, height: size }}
      >
        <span
          className="block size-full rounded-full border-[2.5px] border-dashed border-muted-foreground/45"
        />
      </span>
    );
  }
  const visual = getWorkspaceStatusVisualMeta(definition);
  const Icon = visual.icon;
  return (
    <span
      className={`shell-worktree-card-status-ring ${visual.tone}`}
      role="img"
      aria-label={`Status ${definition.label}`}
      title={definition.label}
      style={{ width: size, height: size }}
    >
      <Icon className="block size-full" />
    </span>
  );
}
