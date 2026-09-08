/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/WorktreeTitleInlineRename.tsx
   (adapter: the reference editor adds an emoji-shortcode popover, IME
   composition guards, truncation tooltips and resize measurement; the MVP
   keeps the rename state machine, the Enter/Escape/blur lifecycle, the
   focus-and-select open, and the failure copy verbatim. The input is
   UNCONTROLLED (defaultValue, value read from the DOM at commit): the
   card renders this editor nested inside its select button, and in that
   position React never delivers onChange for typed input while
   keydown/blur handlers fire normally — so the commit reads the live DOM
   value instead of mirrored state. Plain input over this repo's theme.) */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type WorktreeTitleRenameCommit =
  | { kind: "cancel" }
  | { kind: "save"; displayName: string };

/** Trimmed text commits; empty or unchanged input cancels. */
export function getWorktreeTitleRenameCommit(
  currentDisplayName: string,
  nextDisplayName: string,
): WorktreeTitleRenameCommit {
  const trimmed = nextDisplayName.trim();
  if (!trimmed || trimmed === currentDisplayName) {
    return { kind: "cancel" };
  }
  return { kind: "save", displayName: trimmed };
}

/** Failure copy shown when the rename RPC rejects. */
export function worktreeRenameFailureCopy(): string {
  return "Failed to rename workspace.";
}

export function WorktreeTitleInlineRename({
  displayName,
  disabled = false,
  beginEditing = false,
  onBeginEditingConsumed,
  onEditingChange,
  onRename,
}: {
  displayName: string;
  disabled?: boolean;
  /**
   * Lets the parent (context-menu Rename, the rename shortcut) open the
   * editor imperatively. The parent clears its trigger in
   * onBeginEditingConsumed so the request fires exactly once.
   */
  beginEditing?: boolean;
  onBeginEditingConsumed?: () => void;
  onEditingChange?: (editing: boolean) => void;
  /** Resolves an error message to show, or null on success. */
  onRename: (displayName: string) => Promise<string | null>;
}) {
  const editingRef = useRef(false);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  const inputElementRef = useRef<HTMLInputElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const setEditingMode = useCallback(
    (nextEditing: boolean) => {
      if (editingRef.current === nextEditing) return;
      editingRef.current = nextEditing;
      setEditing(nextEditing);
      onEditingChange?.(nextEditing);
    },
    [onEditingChange],
  );

  // Double-click and the menu/shortcut both open here, so neither skips a step.
  const openRenameEditor = useCallback(() => {
    setError("");
    setEditingMode(true);
    // The input may already be mounted (double-click while open is
    // impossible, but the menu trigger can race a stale frame): sync the
    // live value, focus and selection whenever we open.
    const input = inputElementRef.current;
    if (input) {
      input.value = displayName;
      input.focus();
      input.select();
    }
  }, [displayName, setEditingMode]);

  const cancelRename = useCallback(() => {
    setError("");
    setEditingMode(false);
  }, [setEditingMode]);

  /**
   * Commits an explicit value — callers pass the live DOM value from the
   * event target, never the ref: the ref can already be detached when a
   * late keydown/blur arrives (unmount races a slow daemon round-trip),
   * while the event target is the node the user actually edited.
   */
  const commitRenameValue = useCallback(
    async (nextDisplayName: string) => {
      // No re-entrancy ref gate: a concurrent Enter+blur double-commit is
      // harmless (idempotent rename, last write wins) and a stuck gate
      // would silently swallow every commit. The input disables while a
      // save is in flight via the `saving` state below.
      const commit = getWorktreeTitleRenameCommit(displayName, nextDisplayName);
      if (commit.kind === "cancel") {
        cancelRename();
        return;
      }

      setSaving(true);
      try {
        const failure = await onRename(commit.displayName);
        if (!mountedRef.current) return;
        if (failure) {
          setError(failure || worktreeRenameFailureCopy());
          toast.error(failure || worktreeRenameFailureCopy());
          return;
        }
        setEditingMode(false);
      } catch {
        if (mountedRef.current) {
          setError(worktreeRenameFailureCopy());
          toast.error(worktreeRenameFailureCopy());
        }
      } finally {
        if (mountedRef.current) setSaving(false);
      }
    },
    [cancelRename, displayName, onRename, setEditingMode],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Open the editor when the parent requests it; always consume the
  // request so the trigger can't linger, and skip the open while
  // disabled or already editing.
  useEffect(() => {
    if (!beginEditing) return;
    onBeginEditingConsumed?.();
    if (disabled || editingRef.current) return;
    openRenameEditor();
  }, [beginEditing, disabled, onBeginEditingConsumed, openRenameEditor]);

  // Latest commit/cancel behind stable refs so the native listeners
  // below never call a stale closure.
  const commitRef = useRef(commitRenameValue);
  commitRef.current = commitRenameValue;
  const cancelRef = useRef(cancelRename);
  cancelRef.current = cancelRename;

  const handleInputRef = useCallback(
    (input: HTMLInputElement | null) => {
      inputElementRef.current = input;
      if (!input) return;
      // Fresh mount while opening: seed the live value (defaultValue
      // covers the first mount; this covers re-opens), focus and select
      // so replacing the title is a one-keystroke action.
      input.value = displayName;
      input.focus();
      // Why: double-click rename should make replacing the workspace title a one-keystroke action.
      input.select();
      // Native listeners: this editor renders nested inside the card's
      // select button, and in that position React never delivers this
      // node's keyboard/focus events to its synthetic handlers (verified
      // over CDP: trusted keydown/input events reach the React root
      // listener, siblings' handlers fire, this node's never do) while
      // native listeners fire normally — so the commit lifecycle listens
      // natively and React props stay declarative only.
      const onNativeKeyDown = (event: KeyboardEvent) => {
        event.stopPropagation();
        if (event.isComposing) return;
        if (event.key === "Enter") {
          event.preventDefault();
          const target = event.currentTarget as HTMLInputElement | null;
          void commitRef.current(target?.value ?? "");
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancelRef.current();
        }
      };
      const onNativeBlur = (event: FocusEvent) => {
        const target = event.currentTarget as HTMLInputElement | null;
        void commitRef.current(target?.value ?? "");
      };
      input.addEventListener("keydown", onNativeKeyDown);
      input.addEventListener("blur", onNativeBlur);
      return () => {
        input.removeEventListener("keydown", onNativeKeyDown);
        input.removeEventListener("blur", onNativeBlur);
        if (inputElementRef.current === input) inputElementRef.current = null;
      };
    },
    [displayName],
  );

  const stopCardEvent = useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
  }, []);

  if (editing) {
    return (
      <span
        className="shell-worktree-title-rename"
        data-worktree-title-inline-rename="editing"
        onClick={stopCardEvent}
        onDoubleClick={stopCardEvent}
        onPointerDown={stopCardEvent}
      >
        <input
          ref={handleInputRef}
          defaultValue={displayName}
          disabled={saving}
          spellCheck={false}
          aria-label="Rename workspace"
          data-worktree-title-rename-input="true"
          className="shell-worktree-title-rename-input"
        />
        {error && (
          <span className="shell-worktree-title-rename-error" role="alert">
            {error}
          </span>
        )}
      </span>
    );
  }

  // No tabIndex: the card renders this title inside its select button,
  // so a nested stop would trap keyboard users; the menu's Rename item
  // (and double-click) opens the editor instead.
  return (
    <span
      className="shell-worktree-card-name"
      data-worktree-title-inline-rename=""
      onDoubleClick={(event) => {
        if (disabled) return;
        event.preventDefault();
        event.stopPropagation();
        openRenameEditor();
      }}
    >
      {displayName}
    </span>
  );
}
