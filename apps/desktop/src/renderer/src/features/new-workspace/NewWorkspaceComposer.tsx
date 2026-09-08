/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/NewWorkspaceComposerCard.tsx with
   components/new-workspace/{NewWorkspaceComposerProjectSection,
   NewWorkspaceComposerNameSection,NewWorkspaceComposerFooter,
   NewWorkspaceComposerAgentSection}.tsx
   (adapter: MVP subset — project selector, name, base ref, agent picker
   with model/provider, create — over this repo's Project/Worktree RPC
   contract and `harness.start`; no remote hosts, smart-name sources,
   setup, sparse-checkout, effort/prompt/unattended sections — effort and
   permission mode come from Settings → Agents). */
import { useEffect, useRef, useState } from "react";
import { CornerDownLeft, FolderPlus } from "lucide-react";
import type {
  Harness,
  HarnessLaunchInput,
  Project,
  Workspace,
} from "../../../../shared/session-contract";
import type { HarnessAgentDefault } from "../../settings-store";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import type { ProjectGroup } from "../shell/project-adapter";
import {
  composerAgentLaunchInput,
  composerPrimaryActionLabel,
  emptyComposerAgentSelection,
  initialComposerAgentId,
  resolveComposerAgentModel,
  resolveComposerSubmit,
  type ComposerAgentSelection,
} from "./composer-submit";
import { PI_MODEL_HELPER } from "../shell/pi-model-mapping";

function submitModifierLabel(): string {
  return typeof navigator !== "undefined" &&
    navigator.userAgent.includes("Mac")
    ? "\u2318"
    : "Ctrl";
}

/**
 * New-workspace composer card (MVP): project selector with the source's
 * "Add project" affordance, name, base ref for git projects, an agent
 * picker with model/provider, and a primary action that creates a
 * worktree (`worktree.create`) or opens a folder project's implicit
 * workspace, then starts the picked agent (`harness.start`) in it.
 * Daemon errors surface verbatim; client pre-checks come from the shared
 * project form rules. Mod+Enter submits, matching the source's
 * screen-submit shortcut.
 */
export function NewWorkspaceComposer({
  groups,
  workspaces,
  projectId,
  disabled,
  nameInputRef,
  harnesses,
  defaultHarnessId,
  harnessDefaults,
  onProjectChange,
  onSubmitWorktree,
  onLaunchAgent,
  onSelectWorkspace,
  onAddProject,
  onClose,
}: {
  groups: ProjectGroup[];
  workspaces: Workspace[];
  projectId: string | null;
  disabled: boolean;
  nameInputRef: React.RefObject<HTMLInputElement | null>;
  /** Listed harnesses for the Agent picker; empty hides the section. */
  harnesses: Harness[];
  /** Stored default harness, preselected when actually available. */
  defaultHarnessId: string;
  /** Stored per-harness defaults driving the chained agent launch. */
  harnessDefaults: Record<string, HarnessAgentDefault>;
  onProjectChange: (projectId: string | null) => void;
  /** Resolves a verbatim daemon error, or null on success (then closes). */
  onSubmitWorktree: (input: {
    projectId: string;
    name: string;
    baseRef?: string;
    agent: ComposerAgentSelection;
  }) => Promise<string | null>;
  /**
   * Starts the picked agent in a folder project's implicit workspace.
   * Resolves a verbatim daemon error, or null on success (then closes).
   */
  onLaunchAgent: (launch: HarnessLaunchInput) => Promise<string | null>;
  onSelectWorkspace: (workspaceId: string) => void;
  /** Closes the composer and opens the add-project dialog. */
  onAddProject: () => void;
  onClose: () => void;
}) {
  const project: Project | null =
    groups.find((group) => group.project.id === projectId)?.project ?? null;
  const [name, setName] = useState("");
  const [baseRef, setBaseRef] = useState(project?.defaultBaseRef ?? "");
  const [agent, setAgent] = useState<ComposerAgentSelection>(() => ({
    ...emptyComposerAgentSelection(),
    harnessId: initialComposerAgentId(harnesses, defaultHarnessId),
  }));
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
      agent,
    });
    if ("error" in resolved) {
      setError(resolved.error);
      return;
    }
    // #221: the model maps through the fork's Pi semantics before any RPC,
    // so a flags string or a bare id can never reach the daemon as an
    // "Invalid model" refusal after the worktree already exists. A failure
    // keeps every field, so the primary action retries with the same
    // inputs.
    const mapped = resolveComposerAgentModel(agent);
    if ("error" in mapped) {
      setError(mapped.error);
      return;
    }
    const mappedAgent: ComposerAgentSelection = {
      ...agent,
      model: mapped.model ?? "",
      provider: mapped.provider ?? "",
    };
    setSending(true);
    setError("");
    try {
      if (resolved.target.kind === "implicit") {
        onSelectWorkspace(resolved.target.workspaceId);
        if (!mappedAgent.harnessId) {
          onClose();
          return;
        }
        const launch = composerAgentLaunchInput(
          resolved.target.workspaceId,
          mappedAgent,
          crypto.randomUUID(),
          harnessDefaults,
        );
        if (!launch) {
          onClose();
          return;
        }
        const failure = await onLaunchAgent(launch);
        if (failure) setError(failure);
        else onClose();
        return;
      }
      const failure = await onSubmitWorktree({
        projectId: resolved.target.project.id,
        name: resolved.target.name,
        baseRef: resolved.target.baseRef,
        agent: mappedAgent,
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
        {harnesses.length > 0 && (
          <div className="composer-section">
            <label className="composer-label" htmlFor="composer-agent">
              Agent
            </label>
            <select
              id="composer-agent"
              className="composer-select"
              value={agent.harnessId ?? ""}
              disabled={busy}
              onChange={(event) =>
                setAgent((prev) => ({
                  ...prev,
                  harnessId:
                    (event.target.value || null) as ComposerAgentSelection["harnessId"],
                }))
              }
            >
              <option value="">None</option>
              {harnesses.map((harness) => (
                <option
                  key={harness.harnessId}
                  value={harness.harnessId}
                  disabled={harness.availability !== "available"}
                >
                  {harness.displayName}
                  {harness.availability !== "available"
                    ? " (unavailable)"
                    : ""}
                </option>
              ))}
            </select>
          </div>
        )}
        {agent.harnessId && (
          <div className="composer-section">
            <label className="composer-label" htmlFor="composer-model">
              Model <span className="shell-optional">(optional)</span>
            </label>
            <Input
              id="composer-model"
              value={agent.model}
              onChange={(event) =>
                setAgent((prev) => ({ ...prev, model: event.target.value }))
              }
              disabled={busy}
              placeholder="Harness default"
            />
            {agent.harnessId === "pi" && (
              <p className="composer-hint">{PI_MODEL_HELPER}</p>
            )}
          </div>
        )}
        {agent.harnessId === "pi" && (
          <div className="composer-section">
            <label className="composer-label" htmlFor="composer-provider">
              Provider <span className="shell-optional">(optional)</span>
            </label>
            <Input
              id="composer-provider"
              value={agent.provider}
              onChange={(event) =>
                setAgent((prev) => ({
                  ...prev,
                  provider: event.target.value,
                }))
              }
              disabled={busy}
              placeholder="Pi default"
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
