/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/AddProjectFromFolderDialog.tsx
   (adapter: MVP subset — local folder or local repo path only, no
   clone/remote/SSH steps; the daemon classifies git vs folder by `.git`
   presence, so one path covers both. The path stays an editable input —
   not just the native picker — so keyboard entry and scripted
   acceptance can drive the same dialog. Submits to `project.add`;
   daemon errors surface verbatim, client pre-checks first.) */
import { useState } from "react";
import { FolderPlus, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  validateProjectName,
  validateProjectPath,
} from "./project-forms";

export function AddProjectDialog({
  disabled,
  onBrowse,
  onSubmit,
  onClose,
}: {
  disabled: boolean;
  onBrowse: () => Promise<string | null>;
  /** Resolves an error message to show verbatim, or null on success. */
  onSubmit: (input: {
    path: string;
    name?: string;
  }) => Promise<string | null>;
  onClose: () => void;
}) {
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const busy = disabled || sending;
  const submit = async () => {
    const pathError = validateProjectPath(path);
    if (pathError) {
      setError(pathError);
      return;
    }
    const nameError = validateProjectName(name);
    if (nameError) {
      setError(nameError);
      return;
    }
    setSending(true);
    setError("");
    try {
      const failure = await onSubmit({
        path: path.trim(),
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      if (failure) setError(failure);
    } finally {
      setSending(false);
    }
  };
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
            event.preventDefault();
            document
              .getElementById("shell-add-project-path")
              ?.focus({ preventScroll: true });
          }}
        >
          <div className="composer-header">
            <div className="composer-heading">
              <Dialog.Title className="composer-title">
                Add Project
              </Dialog.Title>
              <Dialog.Description className="composer-description">
                Add this folder as a project.
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="shell-icon-button"
              aria-label="Close"
            >
              <X size={15} />
            </Dialog.Close>
          </div>
          <form
            className="composer-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="composer-section">
              <label
                className="composer-label"
                htmlFor="shell-add-project-path"
              >
                Folder or repository path
              </label>
              <Input
                id="shell-add-project-path"
                value={path}
                onChange={(event) => setPath(event.target.value)}
                disabled={busy}
                placeholder="/path/to/repo"
              />
            </div>
            <div className="composer-section">
              <label
                className="composer-label"
                htmlFor="shell-add-project-name"
              >
                Name <span className="shell-optional">(optional)</span>
              </label>
              <Input
                id="shell-add-project-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={busy}
                placeholder="Derived from the folder when blank"
              />
            </div>
            {error && (
              <p className="shell-form-error" role="alert">
                {error}
              </p>
            )}
            <div className="form-actions composer-actions">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void onBrowse().then((value) => {
                    if (value) setPath(value);
                  })
                }
              >
                Browse
              </Button>
              <Button type="submit" size="sm" disabled={busy || !path.trim()}>
                <FolderPlus size={14} />
                Add Project
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={onClose}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
