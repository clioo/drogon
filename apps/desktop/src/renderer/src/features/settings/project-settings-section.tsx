/* MIT Copyright (c) 2026 Lovecast Inc.
   Ported from Orca's
   src/renderer/src/components/settings/RepositoryPane.tsx (Identity block
   only) and settings-project-section-renderer.tsx (one
   "Project Settings > {name}" section per project, path as description).
   Adapter: props instead of the settings store; the MVP backs only the
   Identity fields, so Display Name is read-only (no project.rename RPC in
   the MVP — listed as a remainder in the PR) and the icon/hosts/hooks/MCP
   sections are absent (no backing stores — listed as not-ported in the
   PR). The Remove Project trash button with its two-step confirm
   ("Remove Project" → "Confirm Remove Project") is the source pane's. */
import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { Project } from "../../../../shared/session-contract";
import { Button } from "../../components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../components/ui/tooltip";
import { SettingsSection } from "./SettingsSection";

export function getProjectKindLabel(kind: Project["kind"]): string {
  return kind === "folder" ? "Folder" : "Git";
}

/** Section chrome for one project, like the source's per-project section:
   title "Project Settings > {name}", description the project path. */
export function ProjectSettingsSectionChrome({
  project,
  children,
}: {
  project: Project;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <SettingsSection
      id={`project-${project.id}`}
      title={`Project Settings > ${project.name}`}
      description={project.path}
    >
      {children}
    </SettingsSection>
  );
}

export function ProjectSettingsSection({
  project,
  onRemoveProject,
}: {
  project: Project;
  /** Removes the registration (never files); the page closes on success. */
  onRemoveProject: (projectId: string) => void;
}): React.JSX.Element {
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const removeLabel = confirmingRemove ? "Confirm Remove Project" : "Remove Project";
  const isFolder = project.kind === "folder";

  const handleRemoveProject = () => {
    if (confirmingRemove) {
      onRemoveProject(project.id);
      setConfirmingRemove(false);
      return;
    }
    setConfirmingRemove(true);
  };

  return (
    <div className="space-y-8">
      <section className="relative space-y-8">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1 pr-12">
            <h3 className="text-sm font-semibold">Identity</h3>
            <p className="text-xs text-muted-foreground">
              Project-specific display details for the sidebar and tabs.
            </p>
            <p className="text-xs text-muted-foreground">
              Type: <span className="text-foreground">{getProjectKindLabel(project.kind)}</span>
            </p>
            {isFolder ? (
              <p className="text-xs text-muted-foreground">
                Opened as folder. Git features are unavailable for this workspace.
              </p>
            ) : null}
          </div>
          <div className="absolute top-0 right-0 z-10 w-auto max-w-none">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant={confirmingRemove ? "destructive" : "outline"}
                  size="icon-sm"
                  onClick={handleRemoveProject}
                  onBlur={() => setConfirmingRemove(false)}
                  aria-label={removeLabel}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={4}>
                {removeLabel}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold">Display Name</p>
          <p className="text-sm">{project.name}</p>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold">Path</p>
          <p className="break-all text-sm text-muted-foreground">{project.path}</p>
        </div>
      </section>
    </div>
  );
}

/** The project section joins settings search on name and path, like the
   source matching identity rows by display name and path keywords. */
export function matchesProjectSettingsQuery(
  query: string,
  project: Project,
): boolean {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (normalized === "") return true;
  const haystack = `${project.name} ${project.path} project remove delete`.toLowerCase();
  return normalized.split(" ").every((token) => haystack.includes(token));
}
