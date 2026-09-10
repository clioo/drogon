/* MIT Copyright (c) 2026 Lovecast Inc.
   Ported from Orca's
   src/renderer/src/components/settings/RepositoryPane.tsx (Identity block
   and RepositoryHookScriptSetting). Adapter: Drogon's Project Settings
   stores one local setup script through project.update; daemon sessions run
   it after worktree creation in the composer's Setup terminal. */
import { useEffect, useState } from "react";
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
  onUpdateSetupScript,
}: {
  project: Project;
  /** Removes the registration (never files); the page closes on success. */
  onRemoveProject: (projectId: string) => void;
  /** Saves the local setup script; absent on old hosts hides the control. */
  onUpdateSetupScript?: (
    projectId: string,
    setupScript: string | null,
  ) => Promise<string | null>;
}): React.JSX.Element {
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [setupScript, setSetupScript] = useState(project.setupScript ?? "");
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const removeLabel = confirmingRemove
    ? "Confirm Remove Project"
    : "Remove Project";
  const isFolder = project.kind === "folder";

  useEffect(() => {
    setSetupScript(project.setupScript ?? "");
    setSaveState("idle");
    setSaveError(null);
  }, [project.id, project.setupScript]);

  const handleRemove = () => {
    if (confirmingRemove) {
      onRemoveProject(project.id);
      setConfirmingRemove(false);
      return;
    }
    setConfirmingRemove(true);
  };

  const saveSetupScript = async () => {
    if (!onUpdateSetupScript) return;
    setSaveState("saving");
    setSaveError(null);
    const failure = await onUpdateSetupScript(
      project.id,
      setupScript.trim() ? setupScript : null,
    );
    if (failure) {
      setSaveState("error");
      setSaveError(failure);
    } else {
      setSaveState("saved");
    }
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
              Type:{" "}
              <span className="text-foreground">
                {getProjectKindLabel(project.kind)}
              </span>
            </p>
            {isFolder ? (
              <p className="text-xs text-muted-foreground">
                Opened as folder. Git features are unavailable for this
                workspace.
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
                  onClick={handleRemove}
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
          <p className="break-all text-sm text-muted-foreground">
            {project.path}
          </p>
        </div>
      </section>

      {onUpdateSetupScript && !isFolder ? (
        <section className="space-y-3">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">Setup script</h3>
            <p className="text-xs text-muted-foreground">
              Runs in a new worktree's Setup terminal after creation. The
              command runs from the worktree directory.
            </p>
          </div>
          <textarea
            value={setupScript}
            onChange={(event) => {
              setSetupScript(event.target.value);
              setSaveState("idle");
            }}
            rows={6}
            placeholder="pnpm install"
            aria-label="Setup script"
            // Why (source SetupScriptPromptCardViews): shell commands are
            // identifiers, not prose — spellcheck underlines are noise.
            spellCheck={false}
            className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <div className="flex items-center justify-between gap-3">
            <span
              className="text-[11px] text-muted-foreground"
              aria-live="polite"
            >
              {saveState === "saving"
                ? "Saving..."
                : saveState === "saved"
                  ? "Saved"
                  : saveState === "error"
                    ? saveError
                    : ""}
            </span>
            <Button
              type="button"
              size="sm"
              onClick={() => void saveSetupScript()}
              disabled={saveState === "saving"}
            >
              Save setup script
            </Button>
          </div>
        </section>
      ) : null}
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
  const haystack =
    `${project.name} ${project.path} project remove delete setup script`.toLowerCase();
  return normalized.split(" ").every((token) => haystack.includes(token));
}
