import { useState } from "react";
import type { Project } from "../../../../shared/session-contract";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { normalizeBaseRef, validateWorktreeName } from "./project-forms";

/**
 * Inline "New worktree" form under a project row (journey J1): name plus
 * an optional base ref defaulting to the project's default. Submits to
 * `worktree.create`; daemon errors surface verbatim in the form.
 */
export function NewWorktreeForm({
  project,
  disabled,
  onSubmit,
  onClose,
}: {
  project: Project;
  disabled: boolean;
  /** Resolves an error message to show verbatim, or null on success. */
  onSubmit: (input: {
    projectId: string;
    name: string;
    baseRef?: string;
  }) => Promise<string | null>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [baseRef, setBaseRef] = useState(project.defaultBaseRef ?? "");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const busy = disabled || sending;
  const submit = async () => {
    const nameError = validateWorktreeName(name);
    if (nameError) {
      setError(nameError);
      return;
    }
    setSending(true);
    setError("");
    try {
      const failure = await onSubmit({
        projectId: project.id,
        name: name.trim(),
        baseRef: normalizeBaseRef(baseRef),
      });
      if (failure) setError(failure);
    } finally {
      setSending(false);
    }
  };
  return (
    <form
      className="shell-dialog shell-inline-form"
      aria-label={`New worktree in ${project.name}`}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label htmlFor={`shell-worktree-name-${project.id}`}>Branch name</label>
      <Input
        id={`shell-worktree-name-${project.id}`}
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        disabled={busy}
        placeholder="demo-a"
      />
      <label htmlFor={`shell-worktree-base-${project.id}`}>
        Base ref <span className="shell-optional">(optional)</span>
      </label>
      <Input
        id={`shell-worktree-base-${project.id}`}
        value={baseRef}
        onChange={(event) => setBaseRef(event.target.value)}
        disabled={busy}
        placeholder={project.defaultBaseRef ?? "repo default"}
      />
      {error && (
        <p className="shell-form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <Button type="submit" size="sm" disabled={busy || !name.trim()}>
          Create
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
