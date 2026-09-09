/* MIT Copyright (c) 2026 Lovecast Inc.
   User-feature-closure item 4: the remaining "Workspace options" sections
   sidebar-options-show.ts's doc comment lists as not-ported ("Sort by /
   Project order / card display / workspace filters ride sort/group/
   display stores the MVP lacks"). Every control here is wired to a real,
   persisted WorkspaceOptionsState (workspace-options-state.ts) and acts on
   real data:
   - Group by: None/Project only. Status/PR are omitted outright rather
     than rendered inert — no PR or workspace-status tracking exists
     anywhere in this renderer to group by (grep confirms it), and a
     picker option with no real effect is exactly the mock UI the task
     forbids.
   - Sort by: Manual (the existing drag order), Name, Recent activity.
   - Card layout: Comfortable/Compact (an additive CSS density class on
     each card's wrapper — ProjectList.tsx; WorktreeCard's own markup and
     tests are untouched).
   - Show properties: Branch (name + ahead/behind) and Pull request chip —
     the two real badge groups WorktreeCardMetaBadges already renders
     (worktree-card-pr-display.ts / WorktreeCardMetaBadges.tsx); toggling
     one off suppresses exactly that data, nothing invented.
   - Hide: Sleeping / Default branch / Detached HEAD are real, computed
     filters (workspace-options-state.ts). Automation-created and
     CLI-created are rendered disabled with an explanatory hint: the
     `worktrees` table has no creation-provenance column (verified by
     reading crates/drogon-core/src/db.rs and project.rs), so a working
     toggle here would need a daemon schema change out of this change's
     scope — listed explicitly in the PR rather than faked. */
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
  WorkspaceSortBy,
} from "./workspace-options-state";

const GROUP_BY_LABEL: Record<WorkspaceGroupBy, string> = {
  project: "Project",
  none: "None",
};
const SORT_BY_LABEL: Record<WorkspaceSortBy, string> = {
  manual: "Manual (drag order)",
  name: "Name",
  recent: "Recent activity",
};
const CARD_LAYOUT_LABEL: Record<WorkspaceCardLayout, string> = {
  comfortable: "Comfortable",
  compact: "Compact",
};

/** Not tracked by the daemon yet (no creation-provenance column on
 *  `worktrees` — see this file's header comment); shown disabled rather
 *  than omitted, since the task names them explicitly, or silently faked. */
const UNAVAILABLE_HIDE_HINT =
  "Not available yet: the service does not record how a workspace was created.";

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
        checked={false}
        disabled
        title={UNAVAILABLE_HIDE_HINT}
        onSelect={(event) => event.preventDefault()}
        onCheckedChange={() => {}}
      >
        Automation-created
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        checked={false}
        disabled
        title={UNAVAILABLE_HIDE_HINT}
        onSelect={(event) => event.preventDefault()}
        onCheckedChange={() => {}}
      >
        CLI-created
      </DropdownMenuCheckboxItem>
    </>
  );
}
