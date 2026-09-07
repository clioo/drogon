/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/NewWorkspaceComposerModal.tsx (adapter: MVP
   subset over this repo's Project/Worktree RPC contract — no agents,
   remotes, setup or quick-session paths; the add-project affordance
   closes the composer and opens the add dialog instead of layering). */
import { useRef, useState } from "react";
import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import type { Workspace } from "../../../../shared/session-contract";
import type { ProjectGroup } from "../shell/project-adapter";
import { NewWorkspaceComposer } from "./NewWorkspaceComposer";
import { composerPrimaryActionLabel, initialComposerProjectId } from "./composer-submit";

/**
 * New-workspace composer modal: the source's quick-create surface for
 * the MVP subset. Opens from Landing, Cmd+N, the palette and the
 * Projects header "+"; a per-project "+" preselects that project.
 * Escape or the close button dismisses without creating anything.
 */
export function NewWorkspaceComposerModal({
  groups,
  workspaces,
  initialProjectId,
  disabled,
  onSubmitWorktree,
  onSelectWorkspace,
  onAddProject,
  onClose,
}: {
  groups: ProjectGroup[];
  workspaces: Workspace[];
  initialProjectId: string | null;
  disabled: boolean;
  /** Resolves a verbatim daemon error, or null on success (then closes). */
  onSubmitWorktree: (input: {
    projectId: string;
    name: string;
    baseRef?: string;
  }) => Promise<string | null>;
  onSelectWorkspace: (workspaceId: string) => void;
  /** Closes the composer and opens the add-project dialog. */
  onAddProject: () => void;
  onClose: () => void;
}) {
  const [projectId, setProjectId] = useState<string | null>(() =>
    initialComposerProjectId(groups, initialProjectId),
  );
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const selected =
    groups.find((group) => group.project.id === projectId)?.project ?? null;
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="composer-overlay" />
        <Dialog.Content
          className="composer-content"
          onOpenAutoFocus={(event) => {
            // Like the source: skip Radix's first-tabbable guess and
            // land in the name field so typing starts immediately.
            event.preventDefault();
            nameInputRef.current?.focus({ preventScroll: true });
          }}
        >
          <div className="composer-header">
            <div className="composer-heading">
              <Dialog.Title className="composer-title">
                {composerPrimaryActionLabel(selected)}
              </Dialog.Title>
              <Dialog.Description className="sr-only">
                Choose the project, workspace name, and base ref before
                creating the workspace.
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="shell-icon-button"
              aria-label="Close"
            >
              <X size={15} />
            </Dialog.Close>
          </div>
          <NewWorkspaceComposer
            groups={groups}
            workspaces={workspaces}
            projectId={projectId}
            disabled={disabled}
            nameInputRef={nameInputRef}
            onProjectChange={setProjectId}
            onSubmitWorktree={onSubmitWorktree}
            onSelectWorkspace={onSelectWorkspace}
            onAddProject={onAddProject}
            onClose={onClose}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
