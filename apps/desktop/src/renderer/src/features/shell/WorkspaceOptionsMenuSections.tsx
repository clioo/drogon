/* MIT Copyright (c) 2026 Lovecast Inc.
   User-feature-closure item 4: the full "Workspace options" menu. Every
   control here is wired to the ONE shared, persisted WorkspaceOptionsState
   (workspace-options-state.ts, backed end to end by
   `window.drogon.ui`/schema v5) and acts on real data, live-rendered in
   ProjectList.tsx:
   - Group by: None/Repo (ProjectRow's existing per-project rendering) and
     Workspace status/PR status (EntryGroupRow's cross-project rendering
     over `groupWorktreesByWorkspaceStatus`/`groupWorktreesByPrStatus` --
     PR status correlates the existing `tasks.list(mode: "pulls")`
     provider bridge by branch; an unfetched/failed project's worktrees
     bucket under "PR status unavailable", never a false "no pull
     request").
   - Sort by: Manual (the real `Worktree.manualOrder`, schema v5 -- the
     SAME field ProjectList.tsx's drag commit persists via
     `worktree.update` and the Kanban board's own column-drag will
     read/write), Name, Recent activity (`Worktree.lastActivityAt`), Smart
     (pinned first, then recent), Repo (by owning project name -- only
     visibly different from Name under the two cross-project groupings,
     where entries can carry different real projects).
   - Project order: Manual (the existing project-header drag order) or
     Recent (by each project's own most-recent real worktree activity).
   - Card layout: Comfortable/Compact.
   - Show properties: Branch (name + ahead/behind) and Pull request chip.
   - Hide: Sleeping / Default branch / Detached HEAD / Automation-created /
     CLI-created are all real, computed filters (schema v5's
     `Worktree.creator`, set by every `drogon-cli worktree create` call;
     "Automation-created" stays enabled even though no producer exists
     yet in this build -- see `WorkspaceHideFilters`'s own doc) -- no
     control here is disabled or inert. */
import {
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "../../components/ui/dropdown-menu";
import type {
  WorkspaceCardLayout,
  WorkspaceGroupBy,
  WorkspaceOptionsState,
  WorkspaceProjectOrderBy,
  WorkspaceSortBy,
} from "./workspace-options-state";

const GROUP_BY_LABEL: Record<WorkspaceGroupBy, string> = {
  repo: "Repo",
  none: "None",
  "workspace-status": "Workspace status",
  "pr-status": "PR status",
};
const SORT_BY_LABEL: Record<WorkspaceSortBy, string> = {
  manual: "Manual (drag order)",
  name: "Name",
  recent: "Recent activity",
  smart: "Smart",
  repo: "Repo",
};
const PROJECT_ORDER_BY_LABEL: Record<WorkspaceProjectOrderBy, string> = {
  manual: "Manual (drag order)",
  recent: "Recent activity",
};
const CARD_LAYOUT_LABEL: Record<WorkspaceCardLayout, string> = {
  comfortable: "Comfortable",
  compact: "Compact",
};

export function WorkspaceOptionsMenuSections({
  state,
  onChange,
}: {
  state: WorkspaceOptionsState;
  onChange: (next: WorkspaceOptionsState) => void;
}): React.JSX.Element {
  return (
    <>
      <DropdownMenuLabel>Group by</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={state.groupBy}
        onValueChange={(value) =>
          onChange({ ...state, groupBy: value as WorkspaceGroupBy })
        }
      >
        {(Object.keys(GROUP_BY_LABEL) as WorkspaceGroupBy[]).map((value) => (
          <DropdownMenuRadioItem key={value} value={value}>
            {GROUP_BY_LABEL[value]}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />

      <DropdownMenuLabel>Sort by</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={state.sortBy}
        onValueChange={(value) =>
          onChange({ ...state, sortBy: value as WorkspaceSortBy })
        }
      >
        {(Object.keys(SORT_BY_LABEL) as WorkspaceSortBy[]).map((value) => (
          <DropdownMenuRadioItem key={value} value={value}>
            {SORT_BY_LABEL[value]}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />

      <DropdownMenuLabel>Project order</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={state.projectOrderBy}
        onValueChange={(value) =>
          onChange({ ...state, projectOrderBy: value as WorkspaceProjectOrderBy })
        }
      >
        {(Object.keys(PROJECT_ORDER_BY_LABEL) as WorkspaceProjectOrderBy[]).map(
          (value) => (
            <DropdownMenuRadioItem key={value} value={value}>
              {PROJECT_ORDER_BY_LABEL[value]}
            </DropdownMenuRadioItem>
          ),
        )}
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />

      <DropdownMenuLabel>Card layout</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={state.cardLayout}
        onValueChange={(value) =>
          onChange({ ...state, cardLayout: value as WorkspaceCardLayout })
        }
      >
        {(Object.keys(CARD_LAYOUT_LABEL) as WorkspaceCardLayout[]).map(
          (value) => (
            <DropdownMenuRadioItem key={value} value={value}>
              {CARD_LAYOUT_LABEL[value]}
            </DropdownMenuRadioItem>
          ),
        )}
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />

      <DropdownMenuLabel>Show properties</DropdownMenuLabel>
      <DropdownMenuCheckboxItem
        checked={state.showProperties.branch}
        onSelect={(event) => event.preventDefault()}
        onCheckedChange={(checked) =>
          onChange({
            ...state,
            showProperties: { ...state.showProperties, branch: checked },
          })
        }
      >
        Branch
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        checked={state.showProperties.pr}
        onSelect={(event) => event.preventDefault()}
        onCheckedChange={(checked) =>
          onChange({
            ...state,
            showProperties: { ...state.showProperties, pr: checked },
          })
        }
      >
        Pull request
      </DropdownMenuCheckboxItem>
      <DropdownMenuSeparator />

      <DropdownMenuLabel>Hide</DropdownMenuLabel>
      <DropdownMenuCheckboxItem
        checked={state.hide.sleeping}
        onSelect={(event) => event.preventDefault()}
        onCheckedChange={(checked) =>
          onChange({ ...state, hide: { ...state.hide, sleeping: checked } })
        }
      >
        Sleeping
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        checked={state.hide.defaultBranch}
        onSelect={(event) => event.preventDefault()}
        onCheckedChange={(checked) =>
          onChange({
            ...state,
            hide: { ...state.hide, defaultBranch: checked },
          })
        }
      >
        Default branch
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        checked={state.hide.detachedHead}
        onSelect={(event) => event.preventDefault()}
        onCheckedChange={(checked) =>
          onChange({
            ...state,
            hide: { ...state.hide, detachedHead: checked },
          })
        }
      >
        Detached HEAD
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        checked={state.hide.automationCreated}
        onSelect={(event) => event.preventDefault()}
        onCheckedChange={(checked) =>
          onChange({
            ...state,
            hide: { ...state.hide, automationCreated: checked },
          })
        }
      >
        Automation-created
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        checked={state.hide.cliCreated}
        onSelect={(event) => event.preventDefault()}
        onCheckedChange={(checked) =>
          onChange({ ...state, hide: { ...state.hide, cliCreated: checked } })
        }
      >
        CLI-created
      </DropdownMenuCheckboxItem>
    </>
  );
}
