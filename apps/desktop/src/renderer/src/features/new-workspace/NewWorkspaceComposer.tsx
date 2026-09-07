/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/NewWorkspaceComposerCard.tsx with
   components/new-workspace/{NewWorkspaceComposerProjectSection,
   NewWorkspaceComposerNameSection,NewWorkspaceComposerFooter}.tsx
   (adapter: MVP subset — project selector, name, base ref, create — over
   this repo's Project/Worktree RPC contract; no remote hosts, agents,
   smart-name sources, setup or sparse-checkout sections). */
import { useEffect, useRef, useState } from "react";
import { CornerDownLeft, FolderPlus } from "lucide-react";
import type {
  Project,
  Workspace,
} from "../../../../shared/session-contract";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import type { ProjectGroup } from "../shell/project-adapter";
import {
  composerPrimaryActionLabel,
  resolveComposerSubmit,
} from "./composer-submit";

function submitModifierLabel(): string {
  return typeof navigator !== "undefined" &&
    navigator.userAgent.includes("Mac")
    ? "\u2318"
    : "Ctrl";
}

/**
 * New-workspace composer card (MVP): project selector with the source's
 * "Add project" affordance, name, base ref for git projects, and a
 * primary action that creates a worktree (`worktree.create`) or opens a
 * folder project's implicit workspace. Daemon errors surface verbatim;
 * client pre-checks come from the shared project form rules. Mod+Enter
 * submits, matching the source's screen-submit shortcut.
 */
export function NewWorkspaceComposer({
  groups,
  workspaces,
  projectId,
  disabled,
  nameInputRef,
  onProjectChange,
  onSubmitWorktree,
  onSelectWorkspace,
  onAddProject,
  onClose,
}: {
  groups: ProjectGroup[];
  workspaces: Workspace[];
  projectId: string | null;
  disabled: boolean;
  nameInputRef: React.RefObject<HTMLInputElement | null>;
  onProjectChange: (projectId: string | null) => void;
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
  const project: Project | null =
    groups.find((group) => group.project.id === projectId)?.project ?? null;
  const [name, setName] = useState("");
  const [baseRef, setBaseRef] = useState(project?.defaultBaseRef ?? "");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const busy = disabled || sending;
  // A newly picked project brings its own default base ref; the typed
  // name survives the switch (the source preserves the name field too).
  const prevProjectId = useRef(project?.id ?? "");
  useEffect(() => {
    const nextId = project?.id ?? "";
    if (prevProjectId.current !== nextId) {
      prevProjectId.current = nextId;
      setBaseRef(project?.defaultBaseRef ?? "");
    }
  });
  const submit = async () => {
    if (busy) return;
    const resolved = resolveComposerSubmit(groups, workspaces, {
      projectId,
      name,
      baseRef,
    });
    if ("error" in resolved) {
      setError(resolved.error);
      return;
    }
    setSending(true);
    setError("");
    try {
      if (resolved.target.kind === "implicit") {
        onSelectWorkspace(resolved.target.workspaceId);
        onClose();
        return;
      }
      const failure = await onSubmitWorktree({
        projectId: resolved.target.project.id,
        name: resolved.target.name,
        baseRef: resolved.target.baseRef,
      });
      if (failure) setError(failure);
    } finally {
      setSending(false);
    }
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key === "Enter" &&
        !event.defaultPrevented
      ) {
        event.preventDefault();
        void submit();
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  });
  const mod = submitModifierLabel();
  const isGit = project?.kind === "git";
  const descriptionId = "composer-project-description";
  return (
    <div data-workspace-composer-root="true" className="composer-card">
      <form
        className="composer-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="composer-section">
          <div className="composer-label-row">
            <label
              className="composer-label"
              htmlFor="composer-project"
            >
              Project
            </label>
            <button
              type="button"
              className="shell-icon-button composer-add-project"
              aria-label="Add project"
              title="Add project"
              disabled={busy}
              onClick={onAddProject}
            >
              <FolderPlus size={12} />
            </button>
          </div>
          <select
            id="composer-project"
            className="composer-select"
            aria-describedby={descriptionId}
            value={projectId ?? ""}
            disabled={busy}
            onChange={(event) =>
              onProjectChange(event.target.value || null)
            }
          >
            <option value="">Choose project</option>
            {groups.map((group) => (
              <option key={group.project.id} value={group.project.id}>
                {group.project.name}
              </option>
            ))}
          </select>
          {project === null && (
            <p id={descriptionId} className="composer-hint">
              Add a project before creating a workspace.
            </p>
          )}
        </div>
        <div className="composer-section">
          <label className="composer-label" htmlFor="composer-name">
            {isGit ? "Branch name" : "Workspace name"}{" "}
            {!isGit && (
              <span className="shell-optional">[Optional]</span>
            )}
          </label>
          <Input
            id="composer-name"
            ref={nameInputRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
            placeholder={isGit ? "demo-a" : "Derived from the project when blank"}
          />
        </div>
        {isGit && (
          <div className="composer-section">
            <label className="composer-label" htmlFor="composer-base-ref">
              Base ref <span className="shell-optional">(optional)</span>
            </label>
            <Input
              id="composer-base-ref"
              value={baseRef}
              onChange={(event) => setBaseRef(event.target.value)}
              disabled={busy}
              placeholder={project?.defaultBaseRef ?? "repo default"}
            />
          </div>
        )}
        {error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {error}
          </div>
        )}
        <div className="composer-footer">
          <Button
            type="submit"
            size="sm"
            className="text-xs"
            disabled={busy || project === null}
            data-primary-action="workspace-session"
          >
            {composerPrimaryActionLabel(project)}
            <span className="ml-1 inline-flex items-center gap-0.5 rounded border border-white/20 px-1.5 py-0.5 text-[10px] font-medium leading-none text-current/80">
              <span>{mod}</span>
              <CornerDownLeft size={12} />
            </span>
          </Button>
        </div>
      </form>
    </div>
  );
}
