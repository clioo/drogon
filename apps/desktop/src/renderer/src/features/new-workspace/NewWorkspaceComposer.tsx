/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/NewWorkspaceComposerCard.tsx with
   components/new-workspace/{NewWorkspaceComposerProjectSection,
   NewWorkspaceComposerNameSection,NewWorkspaceComposerAgentSection,
   NewWorkspaceComposerAdvancedSection,NewWorkspaceComposerFooter}.tsx
   (adapter: project list from the daemon's projects RPC, Run on = the
   source's control over the single local run target (no remote hosts exist
   in Drogon), the Agent combobox lists the daemon's harnesses with the
   fork's auto-pick/default semantics, and the Advanced section carries the
   one advanced control the daemon contract has — the base ref. The fork's
   model/provider text fields do not exist: agent model, effort and
   permission mode come from Settings → Agents, exactly as the fork's agent
   settings drive its quick create. Submit still routes through this repo's
   Project/Worktree RPC contract and `harness.start`; no remote hosts,
   smart-name sources, setup, sparse-checkout, parent-worktree nesting or
   note — those data layers do not exist here). */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Harness,
  HarnessId,
  HarnessLaunchInput,
  Project,
  Workspace,
} from "../../../../shared/session-contract";
import type { HarnessAgentDefault } from "../../settings-store";
import { cn } from "../../lib/utils";
import type { ProjectGroup } from "../shell/project-adapter";
import {
  composerAgentLaunchInput,
  composerPrimaryActionLabel,
  initialComposerAgentId,
  resolveComposerSubmit,
  type ComposerAgentSelection,
} from "./composer-submit";
import { getScreenSubmitModifierLabel } from "./composer-submit-shortcut";
import { buildComposerProjectOptions } from "./project-combobox-options";
import { buildLocalRunTargetOption, type ReadyRunTargetOption } from "./run-target-options";
import { NewWorkspaceComposerProjectSection } from "./composer-project-section";
import { NewWorkspaceComposerNameSection } from "./composer-name-section";
import { NewWorkspaceComposerAgentSection } from "./composer-agent-section";
import { NewWorkspaceComposerAdvancedSection } from "./composer-advanced-section";
import { NewWorkspaceComposerFooter } from "./composer-footer";

/**
 * New-workspace composer card: the fork's Create-worktree composer over
 * Drogon's data layer. Project combobox (type-ahead, "Browse projects",
 * pinned "Add a new project"), the Run on target field, the name field, the
 * agent combobox ("Blank Terminal" creates without a session), the Advanced
 * disclosure, and the footer with the source's ⌘↵ primary action.
 * A git project creates a worktree (`worktree.create`); a folder project
 * opens its implicit workspace, then starts the picked agent
 * (`harness.start`). Daemon errors surface verbatim in the footer's alert.
 */
export function NewWorkspaceComposer({
  groups,
  workspaces,
  projectId,
  disabled,
  nameInputRef,
  composerRef,
  containerClassName,
  submitHandleRef,
  harnesses,
  defaultHarnessId,
  harnessDefaults,
  onProjectChange,
  onSubmitWorktree,
  onLaunchAgent,
  onSelectWorkspace,
  onAddProject,
  onOpenAgentSettings,
  onSetDefaultAgent,
  onClose,
}: {
  groups: ProjectGroup[];
  workspaces: Workspace[];
  projectId: string | null;
  disabled: boolean;
  nameInputRef: React.RefObject<HTMLInputElement | null>;
  /** Root node handle for the modal's screen-submit Enter guard. */
  composerRef: React.RefObject<HTMLDivElement | null>;
  /** Extra classes on the card root (the modal passes its scroll recipe). */
  containerClassName?: string;
  /** The card publishes its submit + createDisabled for the modal's
   *  Cmd/Ctrl+Enter chord (the fork keeps both in one hook). */
  submitHandleRef?: React.MutableRefObject<{
    submit: () => void;
    createDisabled: boolean;
  } | null>;
  /** Listed harnesses for the Agent combobox; empty hides the picker rows. */
  harnesses: Harness[];
  /** Stored default harness, preselected when actually available. */
  defaultHarnessId: string;
  /** Stored per-harness defaults driving the chained agent launch. */
  harnessDefaults: Record<string, HarnessAgentDefault>;
  onProjectChange: (projectId: string | null) => void;
  /** Resolves a verbatim daemon error, or null on success. */
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
  /** The fork's gear/"Manage agents": closes the composer for Settings → Agents. */
  onOpenAgentSettings: () => void;
  /** Right-click "Set as default" on the agent picker; "blank" clears it. */
  onSetDefaultAgent: (next: HarnessId | "blank") => void;
  onClose: () => void;
}) {
  const project: Project | null =
    groups.find((group) => group.project.id === projectId)?.project ?? null;
  const [name, setName] = useState("");
  const [baseRef, setBaseRef] = useState(project?.defaultBaseRef ?? "");
  const [quickAgent, setQuickAgent] = useState<HarnessId | null>(() =>
    initialComposerAgentId(harnesses, defaultHarnessId),
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [createMultiple, setCreateMultiple] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const baseRefInputId = React.useId();
  const projectDescriptionId = React.useId();
  const nameInputFocusFrameRef = useRef<number | null>(null);

  const projectOptions = useMemo(() => buildComposerProjectOptions(groups), [groups]);
  const runTargetOptions = useMemo<readonly ReadyRunTargetOption[]>(
    () => (project ? [buildLocalRunTargetOption(project)] : []),
    [project],
  );
  // The fork shows the Run on picker whenever the selected project has at
  // least one ready target; local-only Drogon always has exactly one.
  const shouldShowRunTargetPicker = runTargetOptions.length > 0;
  const visibleQuickAgents = useMemo(
    () =>
      harnesses
        .filter((harness) => harness.availability === "available")
        .map((harness) => ({
          id: harness.harnessId,
          label: harness.displayName,
          cmd: harness.executable ?? harness.harnessId,
        })),
    [harnesses],
  );
  const isGit = project?.kind === "git";
  const createDisabled = disabled || sending || project === null;

  // A newly picked project brings its own default base ref and local run
  // target; the typed name survives the switch (the source preserves the
  // name field too).
  const prevProjectId = useRef(project?.id ?? "");
  useEffect(() => {
    const nextId = project?.id ?? "";
    if (prevProjectId.current !== nextId) {
      prevProjectId.current = nextId;
      setBaseRef(project?.defaultBaseRef ?? "");
      setError(null);
    }
  });

  const cancelNameInputFocusFrame = useCallback((): void => {
    if (nameInputFocusFrameRef.current !== null) {
      cancelAnimationFrame(nameInputFocusFrameRef.current);
      nameInputFocusFrameRef.current = null;
    }
  }, []);
  const focusNameInput = useCallback((): void => {
    cancelNameInputFocusFrame();
    nameInputFocusFrameRef.current = requestAnimationFrame(() => {
      nameInputFocusFrameRef.current = null;
      nameInputRef.current?.focus();
    });
  }, [cancelNameInputFocusFrame, nameInputRef]);
  const handleNamePlainEnter = useCallback((): void => {
    const agentTrigger = composerRef.current?.querySelector<HTMLElement>(
      '[data-agent-combobox-root="true"][role="combobox"]',
    );
    agentTrigger?.focus();
  }, [composerRef]);

  const submit = async () => {
    if (createDisabled) return;
    const agent: ComposerAgentSelection = {
      harnessId: quickAgent,
      model: "",
      provider: "",
    };
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
    setSending(true);
    setError(null);
    try {
      if (resolved.target.kind === "implicit") {
        onSelectWorkspace(resolved.target.workspaceId);
        if (!agent.harnessId) {
          onClose();
          return;
        }
        const launch = composerAgentLaunchInput(
          resolved.target.workspaceId,
          agent,
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
        agent,
      });
      if (failure) {
        setError(failure);
        return;
      }
      // The source's "Create more": keep the composer open on a fresh draft
      // instead of closing after a successful create.
      if (createMultiple) {
        setName("");
        setBaseRef(resolved.target.project.defaultBaseRef ?? "");
        focusNameInput();
        return;
      }
      onClose();
    } finally {
      setSending(false);
    }
  };

  const mod = getScreenSubmitModifierLabel();
  useEffect(() => {
    if (!submitHandleRef) return;
    submitHandleRef.current = { submit: () => void submit(), createDisabled };
  });
  return (
    <div
      ref={composerRef}
      data-workspace-composer-root="true"
      className={cn("grid min-w-0 gap-1 rounded-md transition", containerClassName)}
    >
      <div className="min-w-0 space-y-4 pt-3">
        <NewWorkspaceComposerProjectSection
          projectOptions={projectOptions}
          groups={groups}
          selectedProjectId={projectId}
          onProjectChange={(next) => onProjectChange(next)}
          showAddProjectButton
          projectDescriptionId={projectDescriptionId}
          onAddProject={onAddProject}
          focusNameInput={focusNameInput}
          shouldShowRunTargetPicker={shouldShowRunTargetPicker}
          runTargetOptions={runTargetOptions}
          selectedRunTargetId={runTargetOptions[0]?.id ?? null}
          onRunTargetChange={() => {}}
        />
        <NewWorkspaceComposerNameSection
          nameInputRef={nameInputRef}
          name={name}
          onNameValueChange={setName}
          selectedRepoIsGit={isGit}
          onNamePlainEnter={handleNamePlainEnter}
        />
        <NewWorkspaceComposerAgentSection
          quickAgent={quickAgent}
          onQuickAgentChange={setQuickAgent}
          onOpenAgentSettings={onOpenAgentSettings}
          createDisabled={createDisabled}
          onCreate={() => void submit()}
          advancedOpen={advancedOpen}
          onToggleAdvanced={() => setAdvancedOpen((open) => !open)}
          visibleQuickAgents={visibleQuickAgents}
          defaultTuiAgent={defaultHarnessId === "" ? null : (defaultHarnessId as HarnessId)}
          handleSetDefaultAgent={(next) => {
            if (next !== null) onSetDefaultAgent(next);
          }}
        />
        <NewWorkspaceComposerAdvancedSection
          advancedOpen={advancedOpen}
          selectedRepoIsGit={isGit}
          baseRefInputId={baseRefInputId}
          baseRef={baseRef}
          onBaseRefChange={setBaseRef}
          defaultBaseRef={project?.defaultBaseRef ?? null}
        />
      </div>
      <NewWorkspaceComposerFooter
        createError={error}
        showCreateMultiple={isGit}
        createMultiple={createMultiple}
        onCreateMultipleChange={setCreateMultiple}
        onCreate={() => void submit()}
        createDisabled={createDisabled}
        creating={sending}
        primaryActionLabel={composerPrimaryActionLabel(project)}
        submitShortcutModifierLabel={mod}
      />
    </div>
  );
}
