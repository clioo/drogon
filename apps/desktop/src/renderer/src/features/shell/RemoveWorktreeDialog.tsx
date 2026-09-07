import { useState } from "react";
import type { Worktree } from "../../../../shared/session-contract";
import { Button } from "../../components/ui/button";
import { worktreeDisplayName } from "./project-adapter";
import type { Workspace } from "../../../../shared/session-contract";

/**
 * "Remove worktree" confirm dialog (journey J1). The daemon refuses a
 * dirty worktree unless forced — the checkbox maps to `worktree.remove`'s
 * `force`, and the daemon's refusal text surfaces verbatim.
 */
export function RemoveWorktreeDialog({
  worktree,
  workspaces,
  disabled,
  onSubmit,
  onClose,
}: {
  worktree: Worktree;
  workspaces: Workspace[];
  disabled: boolean;
  /** Resolves an error message to show verbatim, or null on success. */
  onSubmit: (force: boolean) => Promise<string | null>;
  onClose: () => void;
}) {
  const [force, setForce] = useState(false);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const busy = disabled || sending;
  const name = worktreeDisplayName(worktree, workspaces);
  const submit = async () => {
    setSending(true);
    setError("");
    try {
      const failure = await onSubmit(force);
      if (failure) setError(failure);
    } finally {
      setSending(false);
    }
  };
  return (
    <form
      className="shell-dialog"
      aria-label={`Remove worktree ${name}`}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <p className="shell-confirm-text">
        Remove worktree <strong>{name}</strong>? Its registration is deleted;
        files on disk outside the worktree are untouched.
      </p>
      <label className="shell-check-row" htmlFor="shell-remove-force">
        <input
          id="shell-remove-force"
          type="checkbox"
          checked={force}
          disabled={busy}
          onChange={(event) => setForce(event.target.checked)}
        />
        Force: remove even with uncommitted changes
      </label>
      {error && (
        <p className="shell-form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <Button type="submit" size="sm" variant="outline" disabled={busy}>
          Remove
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
