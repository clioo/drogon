/* MIT Copyright (c) 2026 Lovecast Inc.
   The full "Workspace options" menu over the one shared, persisted
   WorkspaceOptionsState (workspace-options-state.ts, `window.drogon.ui` /
   schema v5), live-rendered in ProjectList.tsx. Option order, copy and
   descriptions follow the reference menu; the persisted ids are unchanged. */
import {
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "../../components/ui/dropdown-menu";
import {
  CARD_PROPERTY_OPTIONS,
  WORKSPACE_CARD_LAYOUT_OPTIONS,
  WORKSPACE_GROUP_BY_OPTIONS,
  WORKSPACE_PROJECT_ORDER_OPTIONS,
  WORKSPACE_SHOW_PROPERTIES_DISPLAY_ORDER,
  WORKSPACE_SHOW_PROPERTY_LABEL_OVERRIDES,
  WORKSPACE_SORT_OPTIONS,
  cardPropertiesToFlags,
} from "./workspace-options-state";
import { getWorktreeCardModeProperties } from "../../../../shared/worktree/card-properties";
import type {
  WorkspaceCardLayout,
  WorkspaceGroupBy,
  WorkspaceOptionsState,
  WorkspaceProjectOrderBy,
  WorkspaceSortBy,
} from "./workspace-options-state";

const GROUP_BY_LABEL: Record<WorkspaceGroupBy, string> = Object.fromEntries(
  WORKSPACE_GROUP_BY_OPTIONS.map(({ id, label }) => [id, label]),
) as Record<WorkspaceGroupBy, string>;
const GROUP_BY_ORDER: readonly WorkspaceGroupBy[] =
  WORKSPACE_GROUP_BY_OPTIONS.map(({ id }) => id);

const SORT_BY_LABEL: Record<WorkspaceSortBy, string> = Object.fromEntries(
  WORKSPACE_SORT_OPTIONS.map(({ id, label }) => [id, label]),
) as Record<WorkspaceSortBy, string>;
const SORT_BY_DESCRIPTION: Record<WorkspaceSortBy, string | null> =
  Object.fromEntries(
    WORKSPACE_SORT_OPTIONS.map(({ id, description }) => [id, description]),
  ) as Record<WorkspaceSortBy, string | null>;
const SORT_BY_ORDER: readonly WorkspaceSortBy[] = WORKSPACE_SORT_OPTIONS.map(
  ({ id }) => id,
);

const PROJECT_ORDER_BY_LABEL: Record<WorkspaceProjectOrderBy, string> =
  Object.fromEntries(
    WORKSPACE_PROJECT_ORDER_OPTIONS.map(({ id, label }) => [id, label]),
  ) as Record<WorkspaceProjectOrderBy, string>;
const PROJECT_ORDER_BY_DESCRIPTION: Record<WorkspaceProjectOrderBy, string> =
  Object.fromEntries(
    WORKSPACE_PROJECT_ORDER_OPTIONS.map(({ id, description }) => [
      id,
      description,
    ]),
  ) as Record<WorkspaceProjectOrderBy, string>;
const PROJECT_ORDER_BY_ORDER: readonly WorkspaceProjectOrderBy[] =
  WORKSPACE_PROJECT_ORDER_OPTIONS.map(({ id }) => id);

const CARD_LAYOUT_LABEL: Record<WorkspaceCardLayout, string> =
  Object.fromEntries(
    WORKSPACE_CARD_LAYOUT_OPTIONS.map(({ id, label }) => [id, label]),
  ) as Record<WorkspaceCardLayout, string>;
const CARD_LAYOUT_ORDER: readonly WorkspaceCardLayout[] =
  WORKSPACE_CARD_LAYOUT_OPTIONS.map(({ id }) => id);

const CARD_PROPERTY_LABEL: Readonly<Record<string, string>> = Object.fromEntries(
  CARD_PROPERTY_OPTIONS.map(({ id, label }) => [
    id,
    WORKSPACE_SHOW_PROPERTY_LABEL_OVERRIDES[
      id as keyof typeof WORKSPACE_SHOW_PROPERTY_LABEL_OVERRIDES
    ] ?? label,
  ]),
);

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
        aria-label="Group by"
        value={state.groupBy}
        onValueChange={(value) =>
          onChange({ ...state, groupBy: value as WorkspaceGroupBy })
        }
      >
        {GROUP_BY_ORDER.map((value) => (
          <DropdownMenuRadioItem key={value} value={value}>
            {GROUP_BY_LABEL[value]}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />

      <DropdownMenuLabel>Sort by</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        aria-label="Sort by"
        value={state.sortBy}
        onValueChange={(value) =>
          onChange({ ...state, sortBy: value as WorkspaceSortBy })
        }
      >
        {SORT_BY_ORDER.map((value) => (
          <DropdownMenuRadioItem
            key={value}
            value={value}
            title={SORT_BY_DESCRIPTION[value] ?? undefined}
          >
            {SORT_BY_LABEL[value]}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />

      <DropdownMenuLabel>Project order</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        aria-label="Project order"
        value={state.projectOrderBy}
        onValueChange={(value) =>
          onChange({ ...state, projectOrderBy: value as WorkspaceProjectOrderBy })
        }
      >
        {PROJECT_ORDER_BY_ORDER.map((value) => (
          <DropdownMenuRadioItem
            key={value}
            value={value}
            title={PROJECT_ORDER_BY_DESCRIPTION[value]}
          >
            {PROJECT_ORDER_BY_LABEL[value]}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />

      <DropdownMenuLabel>Card layout</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={state.cardLayout}
        onValueChange={(value) =>
          onChange({ ...state, cardLayout: value as WorkspaceCardLayout,
            showProperties: cardPropertiesToFlags(getWorktreeCardModeProperties(value === "compact" ? "Compact" : "Default")),
          })
        }
      >
        {CARD_LAYOUT_ORDER.map((value) => (
          <DropdownMenuRadioItem key={value} value={value}>
            {CARD_LAYOUT_LABEL[value]}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />

      <DropdownMenuLabel>Show properties</DropdownMenuLabel>
      {WORKSPACE_SHOW_PROPERTIES_DISPLAY_ORDER.map((id) => (
        <DropdownMenuCheckboxItem key={id}
          checked={state.showProperties[id] === true}
          onSelect={(event) => event.preventDefault()}
          onCheckedChange={(checked) => onChange({ ...state,
            showProperties: { ...state.showProperties, [id]: checked },
          })}
        >{CARD_PROPERTY_LABEL[id] ?? id}</DropdownMenuCheckboxItem>
      ))}
      <DropdownMenuLabel>Agent activity display</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={state.agentActivityDisplayMode ?? "full"}
        onValueChange={(value) => onChange({ ...state, agentActivityDisplayMode: value as "compact" | "full" })}>
        <DropdownMenuRadioItem value="compact">Compact activity</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="full">Full list</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
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
