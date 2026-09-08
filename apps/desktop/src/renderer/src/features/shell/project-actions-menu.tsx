/* MIT Copyright (c) 2026 Lovecast Inc.
   Ported from Orca's
   src/renderer/src/components/sidebar/worktree-list/rows/repo-header-project-actions.tsx
   (RepoHeaderProjectActionsMenu only; the create-workspace button stays in
   ProjectList. Adapter: props instead of the repo/project-group stores, and
   English literals instead of translate(). Only the rows the MVP can back
   are ported: "Project Settings" opens the project settings section and
   "Remove Project" opens the remove confirm dialog. Not ported (no backing
   store in the MVP — listed in the PR): "Change Project Icon" (icon
   store/picker), "New group from project" / "Move to group" submenu /
   "Remove from group" (project-group store), and the git-only
   show/hide-worktrees row (visibility modal/store). Rendered through the
   ported ui primitives exactly as the source imports them. */
import { Ellipsis, SlidersHorizontal, Trash2 } from "lucide-react";
import type { Project } from "../../../../shared/session-contract";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../components/ui/tooltip";

/** Container recipe for the hover-reveal row actions, from the source's
   ProjectHeaderActions (components/sidebar/ProjectHeaderActions.tsx):
   desktop hover reveals absolutely over the title, touch keeps the flow.
   Why no `pointer-events-none` gating (unlike the source): hidden actions
   must stay above the row hit area (#278) — hit-testing an a11y or Playwright
   activation never establishes :hover first, so gating resolved every click
   to the drag-handle row beneath; the reveal stays opacity-only. */
export const PROJECT_HEADER_ACTIONS_CLASS_NAME =
  "flex shrink-0 cursor-pointer items-center gap-0.5 self-stretch can-hover:absolute can-hover:right-1 can-hover:top-1/2 can-hover:z-10 can-hover:-translate-y-1/2 can-hover:rounded-md can-hover:bg-worktree-sidebar can-hover:pl-1 can-hover:opacity-0 can-hover:transition-opacity group-hover:opacity-100 has-[:focus-visible]:opacity-100 has-[button[data-state=open]]:opacity-100";

/** Reveal recipe for one row action, verbatim from the source's
   repo-header-action-button-class.ts. */
export const PROJECT_HEADER_ACTION_BUTTON_CLASS_NAME =
  "size-5 shrink-0 min-w-0 max-w-0 -ml-1.5 overflow-hidden opacity-0 focus:ml-0 focus:max-w-5 focus:opacity-100 group-hover:ml-0 group-hover:max-w-5 group-hover:opacity-100 rounded-md text-muted-foreground transition-[margin,max-width,opacity,background-color,color] hover:bg-accent/70 hover:text-foreground data-[state=open]:ml-0 data-[state=open]:max-w-5 data-[state=open]:opacity-100";

export function ProjectActionsMenu({
  project,
  disabled,
  defaultOpen,
  onOpenSettings,
  onRemove,
}: {
  project: Project;
  disabled: boolean;
  /** Initial menu state (uncontrolled); set for tests and screenshots. */
  defaultOpen?: boolean;
  /** Opens the settings page on this project's section. */
  onOpenSettings: (project: Project) => void;
  /** Opens the remove-project confirm dialog for this project. */
  onRemove: (project: Project) => void;
}): React.JSX.Element {
  const label = project.name;
  return (
    <DropdownMenu modal={false} defaultOpen={defaultOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className={PROJECT_HEADER_ACTION_BUTTON_CLASS_NAME}
              data-project-header-action=""
              aria-label={`Project actions for ${label}`}
              disabled={disabled}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.stopPropagation();
                }
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Ellipsis className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          Project actions
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        side="bottom"
        sideOffset={6}
        // Why: block menu events from reaching the project row, like the
        // source blocks them from arming row drag/collapse.
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onMouseUp={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <DropdownMenuItem
          disabled={disabled}
          onSelect={() => onOpenSettings(project)}
        >
          <SlidersHorizontal className="size-3.5" />
          Project Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={disabled}
          onSelect={() => onRemove(project)}
        >
          <Trash2 className="size-3.5" />
          Remove Project
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
