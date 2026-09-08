/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/DeleteWorktreeDialog.tsx and its
   DeleteWorktreeDialog{Description,Footer,TargetPreview,WarningPanels,
   SkipConfirmOption,DirtyChangeHint} siblings (adapter: MVP subset — one
   worktree, no lineage/batch/hosts; the dirty hint reads live
   `git.status` entry counts through this repo's git bridge; the
   skip-confirm preference persists to localStorage, the analogue of the
   source's `skipDeleteWorktreeConfirm` setting. Replaces
   RemoveWorktreeDialog with the same submit contract.) */
import { useRef, useState } from "react";
import type { Worktree, Workspace } from "../../../../shared/session-contract";
import { DeleteWorktreeDialogDescription } from "./DeleteWorktreeDialogDescription";
import { DeleteWorktreeDialogFooter } from "./DeleteWorktreeDialogFooter";
import { DeleteWorktreeTargetPreview } from "./DeleteWorktreeTargetPreview";
import { DeleteWorktreeWarningPanels } from "./DeleteWorktreeWarningPanels";
import {
  DeleteWorktreeSkipConfirmOption,
  writeSkipDeleteWorktreeConfirm,
} from "./DeleteWorktreeSkipConfirmOption";
import { getDeleteWorktreeDialogCopy } from "./delete-worktree-dialog-copy";
import { getDeleteWorktreeDirtyChangeCount } from "./delete-worktree-dirty-change-counts";
import { useWorktreeGitStatus } from "./use-worktree-git-status";
import { worktreeDisplayName } from "./project-adapter";

export function DeleteWorktreeDialog({
  worktree,
  workspaces,
  disabled,
  isFolderWorkspaceDelete,
  onSubmit,
  onClose,
}: {
  worktree: Worktree;
  workspaces: Workspace[];
  disabled: boolean;
  /** Folder/implicit rows remove only the registration; disk is untouched. */
  isFolderWorkspaceDelete: boolean;
  /** Resolves an error message to show verbatim, or null on success. */
  onSubmit: (force: boolean) => Promise<string | null>;
  onClose: () => void;
}) {
  const [force, setForce] = useState(false);
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const busy = disabled || sending;
  const name = worktreeDisplayName(worktree, workspaces);
  const copy = getDeleteWorktreeDialogCopy({
    displayName: name,
    isFolderWorkspaceDelete,
  });

  const hostId =
    workspaces.find((item) => item.id === worktree.workspaceId)?.hostId ??
    null;
  const status = useWorktreeGitStatus({
    hostId,
    workspaceId: worktree.workspaceId,
    enabled: !isFolderWorkspaceDelete,
  });
  const dirtyChangeCount = getDeleteWorktreeDirtyChangeCount({
    isFolderWorkspaceDelete,
    entryCount: status ? status.entries.length : null,
  });

  const submit = async () => {
    setSending(true);
    setError("");
    try {
      // The preference is a one-shot dialog intent for the primary
      // confirmation only — a force recovery never persists it.
      if (dontAskAgain && !force) writeSkipDeleteWorktreeConfirm(true);
      const failure = await onSubmit(force);
      if (failure) setError(failure);
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      className="shell-dialog shell-delete-dialog"
      aria-label={`Delete workspace ${name}`}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <p className="shell-dialog-title">Delete Workspace</p>
      <DeleteWorktreeDialogDescription
        targetClassName={copy.targetClassName}
        targetLabel={copy.targetLabel}
        descriptionSuffix={copy.descriptionSuffix}
      />
      <DeleteWorktreeTargetPreview
        displayName={name}
        path={worktree.path}
        dirtyChangeCount={dirtyChangeCount}
      />
      <DeleteWorktreeWarningPanels
        isFolderWorkspaceDelete={isFolderWorkspaceDelete}
      />
      {!isFolderWorkspaceDelete && (
        <label className="shell-check-row" htmlFor="shell-delete-force">
          <input
            id="shell-delete-force"
            type="checkbox"
            checked={force}
            disabled={busy}
            onChange={(event) => setForce(event.target.checked)}
          />
          Force: remove even with uncommitted changes
        </label>
      )}
      {error && (
        <p className="shell-form-error" role="alert">
          {error}
        </p>
      )}
      <DeleteWorktreeSkipConfirmOption
        showDontAskAgain={!isFolderWorkspaceDelete}
        dontAskAgain={dontAskAgain}
        onToggleDontAskAgain={() => setDontAskAgain((prev) => !prev)}
      />
      <div className="form-actions">
        <DeleteWorktreeDialogFooter
          isDeleting={sending}
          onCancel={onClose}
          onDelete={() => void submit()}
          confirmButtonRef={confirmButtonRef}
        />
      </div>
    </form>
  );
}
