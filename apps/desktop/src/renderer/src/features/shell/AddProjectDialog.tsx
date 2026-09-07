import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  validateProjectName,
  validateProjectPath,
} from "./project-forms";

/**
 * Add-project dialog (journey J1): path picker via the existing Electron
 * dialog bridge when available, else a validated path input. Submits to
 * `project.add`; daemon errors surface verbatim, client pre-checks first.
 */
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
    <form
      className="shell-dialog"
      aria-label="Add project"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label htmlFor="shell-add-project-path">Folder or repository path</label>
      <Input
        id="shell-add-project-path"
        autoFocus
        value={path}
        onChange={(event) => setPath(event.target.value)}
        disabled={busy}
        placeholder="/path/to/repo"
      />
      <label htmlFor="shell-add-project-name">
        Name <span className="shell-optional">(optional)</span>
      </label>
      <Input
        id="shell-add-project-name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        disabled={busy}
        placeholder="Derived from the folder when blank"
      />
      {error && (
        <p className="shell-form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
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
          Add
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
