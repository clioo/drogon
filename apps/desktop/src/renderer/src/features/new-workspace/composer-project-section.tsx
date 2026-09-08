/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/new-workspace/NewWorkspaceComposerProjectSection.tsx
   (adapter: project options come from the daemon's project list, the Run on
   picker is the source's control over the single local target — the SSH
   connect banner, needs-setup hosts, remote recipes and the Add-host flow are
   not ported because Drogon has no remote run targets; i18n keys inlined). */
import React from "react";
import { FolderPlus } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import ProjectCombobox from "./ProjectCombobox";
import RunTargetCombobox from "./RunTargetCombobox";
import type { ComposerProjectOption } from "./project-combobox-options";
import type { ReadyRunTargetOption } from "./run-target-options";
import type { ProjectGroup } from "../shell/project-adapter";

export function NewWorkspaceComposerProjectSection({
  projectOptions,
  groups,
  selectedProjectId = null,
  onProjectChange,
  projectError,
  showAddProjectButton = true,
  projectLabel,
  projectPlaceholder,
  emptyProjectMessage,
  projectDescriptionId,
  onAddProject,
  focusNameInput,
  shouldShowRunTargetPicker,
  runTargetOptions,
  selectedRunTargetId,
  onRunTargetChange,
}: {
  projectOptions: readonly ComposerProjectOption[];
  groups: readonly ProjectGroup[];
  selectedProjectId?: string | null;
  onProjectChange: (projectId: string) => void;
  projectError?: string | null;
  showAddProjectButton?: boolean;
  projectLabel?: string;
  projectPlaceholder?: string;
  emptyProjectMessage?: string;
  projectDescriptionId: string;
  onAddProject: () => void;
  focusNameInput: () => void;
  shouldShowRunTargetPicker: boolean;
  runTargetOptions: readonly ReadyRunTargetOption[];
  selectedRunTargetId: string | null;
  onRunTargetChange: (setupId: string) => void;
}): React.JSX.Element {
  return (
    <div className="space-y-1">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs font-medium text-muted-foreground">
            {projectLabel ?? "Project"}
          </label>
          {showAddProjectButton ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={onAddProject}
                  className="size-5 shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
                  aria-label="Add project"
                >
                  <FolderPlus className="size-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6}>
                Add project
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
        <div className="space-y-1" data-contextual-tour-target="workspace-creation-project">
          <ProjectCombobox
            options={projectOptions}
            groups={groups}
            value={selectedProjectId}
            onValueChange={onProjectChange}
            onValueSelected={focusNameInput}
            onAddProject={onAddProject}
            placeholder={projectPlaceholder ?? "Choose project"}
            triggerClassName="h-9 w-full border-input text-sm focus:border-ring focus:ring-[3px] focus:ring-ring/50"
            invalid={Boolean(projectError)}
            describedBy={projectDescriptionId}
          />
          {projectError ? (
            <p id={projectDescriptionId} className="text-[11px] text-destructive">
              {projectError}
            </p>
          ) : projectOptions.length === 0 ? (
            <p id={projectDescriptionId} className="text-[11px] text-muted-foreground">
              {emptyProjectMessage ?? "Add a project before creating a workspace."}
            </p>
          ) : null}
        </div>
      </div>
      {shouldShowRunTargetPicker ? (
        <div className="space-y-1 pt-3">
          <label className="block min-w-0 truncate text-xs font-medium text-muted-foreground">
            Run on
          </label>
          <RunTargetCombobox
            hostOptions={runTargetOptions}
            hostValue={selectedRunTargetId}
            onHostChange={onRunTargetChange}
          />
        </div>
      ) : null}
    </div>
  );
}
