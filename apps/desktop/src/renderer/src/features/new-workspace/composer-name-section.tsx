/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/new-workspace/NewWorkspaceComposerNameSection.tsx
   (the "Name or 'Create From' [Optional]" label, the SmartWorkspaceNameField,
   and the animated "Reuse branch" checkbox row with its hint). Adapter: the
   smart field's sources are this repo's GitHub (`gh`) and git-branch
   backends; the fork-push warning does not exist here. */
import React from "react";
import { AlertTriangle, Check } from "lucide-react";
import { SmartWorkspaceNameField } from "./SmartWorkspaceNameField";
import { cn } from "../../lib/utils";
import type { Result } from "../../../../shared/session-contract";
import type { TasksBridge } from "../../../../shared/tasks-contract";
import type {
  BranchSearchRow,
  GitHubWorkItem,
  SmartNameMode,
  SmartWorkspaceNameSelection,
} from "./smart-workspace-source-rows";

type NewWorkspaceComposerNameSectionProps = {
  nameInputRef: React.RefObject<HTMLInputElement | null>;
  name: string;
  onNameValueChange: (value: string) => void;
  selectedRepoIsGit: boolean;
  onNamePlainEnter: () => void;
  // Smart-source surface (the fork's props subset over this repo's bridges).
  projectId: string | null;
  repoSlug: { owner: string; repo: string } | null;
  tasks: Pick<TasksBridge, "tasksList" | "tasksShow"> | null;
  branchSearch:
    | ((input: {
        projectId: string;
        query?: string;
        limit?: number;
      }) => Promise<Result<{ branches: BranchSearchRow[] }>>)
    | null;
  smartNameSelection: SmartWorkspaceNameSelection | null;
  onClearSmartNameSelection: () => void;
  onSmartGitHubItemSelect: (item: GitHubWorkItem) => void;
  onSmartBranchSelect: (refName: string, localBranchName: string) => void;
  onSmartNameModeChange?: (mode: SmartNameMode) => void;
  branchesEnabled?: boolean;
  forkPushWarning?: string | null;
  canReuseSelectedBranch: boolean;
  reuseSelectedBranch: boolean;
  onReuseSelectedBranchChange: (next: boolean) => void;
};

export function NewWorkspaceComposerNameSection({
  nameInputRef,
  name,
  onNameValueChange,
  selectedRepoIsGit,
  onNamePlainEnter,
  projectId,
  repoSlug,
  tasks,
  branchSearch,
  smartNameSelection,
  onClearSmartNameSelection,
  onSmartGitHubItemSelect,
  onSmartBranchSelect,
  onSmartNameModeChange,
  branchesEnabled = true,
  forkPushWarning,
  canReuseSelectedBranch,
  reuseSelectedBranch,
  onReuseSelectedBranchChange,
}: NewWorkspaceComposerNameSectionProps): React.JSX.Element {
  return (
    <div
      className="min-w-0 space-y-1"
      data-contextual-tour-target="workspace-creation-name"
    >
      <label className="block min-w-0 truncate text-xs font-medium text-muted-foreground">
        {selectedRepoIsGit ? "Name or 'Create From'" : "Workspace name"}{" "}
        <span className="text-muted-foreground/70">[Optional]</span>
      </label>
      <SmartWorkspaceNameField
        inputRef={nameInputRef}
        value={name}
        onValueChange={onNameValueChange}
        onGitHubItemSelect={onSmartGitHubItemSelect}
        onBranchSelect={onSmartBranchSelect}
        selectedSource={smartNameSelection}
        onClearSelectedSource={onClearSmartNameSelection}
        onPlainEnter={onNamePlainEnter}
        onActiveSourceModeChange={onSmartNameModeChange}
        textOnly={!selectedRepoIsGit}
        branchesEnabled={branchesEnabled}
        disabled={false}
        projectId={projectId}
        repoSlug={repoSlug}
        tasks={tasks}
        branchSearch={branchSearch}
      />
      {forkPushWarning ? (
        <p className="flex items-start gap-1.5 text-[11px] text-yellow-600 dark:text-yellow-500">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          <span>{forkPushWarning}</span>
        </p>
      ) : null}
      <div
        className={cn(
          "grid overflow-hidden transition-[grid-template-rows] duration-200 ease-out",
          canReuseSelectedBranch ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
        aria-hidden={!canReuseSelectedBranch}
      >
        <div className="min-h-0">
          <div className="space-y-1 pt-1">
            <label className="group flex w-fit items-center gap-2 text-xs text-foreground">
              <span
                className={cn(
                  "flex size-4 items-center justify-center rounded-[3px] border shadow-sm transition",
                  reuseSelectedBranch
                    ? "border-emerald-500/60 bg-emerald-500 text-white"
                    : "border-foreground/20 bg-background dark:border-white/20 dark:bg-muted/10",
                )}
              >
                <Check
                  className={cn(
                    "size-3 transition-opacity",
                    reuseSelectedBranch ? "opacity-100" : "opacity-0",
                  )}
                />
              </span>
              <input
                type="checkbox"
                checked={reuseSelectedBranch}
                onChange={(event) =>
                  onReuseSelectedBranchChange(event.target.checked)
                }
                disabled={!canReuseSelectedBranch}
                className="sr-only"
              />
              <span>Reuse branch</span>
            </label>
            <p className="pl-6 text-[11px] text-muted-foreground">
              Check out the existing branch instead of creating a new one from
              it.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
