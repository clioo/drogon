/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/NewWorkspaceComposerCard.tsx with
   components/new-workspace/{NewWorkspaceComposerProjectSection,
   NewWorkspaceComposerNameSection,NewWorkspaceComposerAgentSection,
   NewWorkspaceComposerAdvancedSection,NewWorkspaceComposerFooter}.tsx
   (adapter: project list from the daemon's projects RPC, Run on = the
   source's control over the single local run target (no remote hosts exist
   in Drogon), the Agent combobox lists the daemon's harnesses with the
   fork's auto-pick/default semantics, and the Advanced rows feed additive
   branch/note/parent/setup/sparse data layers. The fork's model/provider
   text fields do not exist: agent model, effort and permission mode come
   from Settings → Agents. Quick Session creates a daemon-owned scratch
   folder project before chaining `harness.start`; remote hosts and
   smart-name sources remain unported). */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  Harness,
  HarnessId,
  HarnessLaunchInput,
  Project,
  Workspace,
} from "../../../../shared/session-contract";
import type { TasksBridge } from "../../../../shared/tasks-contract";
import type { SparsePresetResult } from "../../../../shared/project-contract";
import type { HarnessAgentDefault } from "../../settings-store";
import { cn } from "../../lib/utils";
import {
  windowProjectBridge,
  type ProjectRpcBridge,
  type ProjectGroup,
} from "../shell/project-adapter";
import {
  composerAgentLaunchInput,
  composerPrimaryActionLabel,
  resolveComposerSubmit,
  type ComposerAgentSelection,
} from "./composer-submit";
import { getScreenSubmitModifierLabel } from "./composer-submit-shortcut";
import { buildComposerProjectOptions } from "./project-combobox-options";
import {
  buildLocalRunTargetOption,
  type ReadyRunTargetOption,
} from "./run-target-options";
import { NewWorkspaceComposerProjectSection } from "./composer-project-section";
import { NewWorkspaceComposerNameSection } from "./composer-name-section";
import { NewWorkspaceComposerAgentSection } from "./composer-agent-section";
import { NewWorkspaceComposerAdvancedSection } from "./composer-advanced-section";
import { NewWorkspaceComposerFooter } from "./composer-footer";
import { resolveComposerQuickAgent } from "./composer-quick-agent";
import { resolveComposerBranchPick } from "./composer-branch-pick";
import { getSuggestedCreatureName, shouldApplySuggestedName } from "./worktree-name-suggestion";
import {
  slugifyForWorkspaceName,
  type SmartNameMode,
  type SmartWorkspaceNameSelection,
  type GitHubWorkItem,
} from "./smart-workspace-composer";

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
  onCreateQuickSession,
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
    branch?: string;
    /** The fork's "Reuse branch": check out the existing branch. */
    reuseBranch?: boolean;
    note?: string;
    parentWorktreeId?: string;
    sparse?: string[];
    setupScript?: string;
    waitForSetup?: boolean;
    agent: ComposerAgentSelection;
  }) => Promise<string | null>;
  /** Creates the fork's daemon-owned scratch-folder Quick Session. */
  onCreateQuickSession?: (input: {
    name: string;
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
  const selectedGroup =
    groups.find((group) => group.project.id === projectId) ?? null;
  const [name, setName] = useState("");
  const [baseRef, setBaseRef] = useState(project?.defaultBaseRef ?? "");
  const [branchName, setBranchName] = useState("");
  // The fork's smart-source state (derived-composer-state + source actions):
  // the selected source pill, the auto-name watermark and the branch-reuse
  // eligibility behind the "Reuse branch" checkbox.
  const [smartNameSelection, setSmartNameSelection] =
    useState<SmartWorkspaceNameSelection | null>(null);
  const [reuseEligibleBranch, setReuseEligibleBranch] = useState<
    string | null
  >(null);
  const [reuseSelectedBranch, setReuseSelectedBranch] = useState(false);
  const lastAutoNameRef = useRef("");
  const [parentWorktreeId, setParentWorktreeId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [runSetup, setRunSetup] = useState(
    Boolean(project?.setupScript?.trim()),
  );
  const [waitForSetup, setWaitForSetup] = useState(false);
  const [sparsePresets, setSparsePresets] = useState<SparsePresetResult[]>([]);
  const [selectedSparsePresetId, setSelectedSparsePresetId] = useState<
    string | null
  >(null);
  // #355 fork parity (quick-workspace-agent-selection): the quick agent
  // derives from the live harness catalog with a user-pick override — a
  // composer mounted before the daemon's harnesses answer (landing →
  // Create workspace on a fresh boot) must adopt the auto-pick when the
  // catalog lands instead of staying stuck on Blank Terminal, which
  // disabled Quick Session as if the form were empty.
  const [quickAgentOverride, setQuickAgentOverride] = useState<
    HarnessId | null | undefined
  >(undefined);
  const resolvedQuickAgent = resolveComposerQuickAgent({
    quickAgentOverride,
    harnesses,
    defaultHarnessId,
  });
  if (resolvedQuickAgent.quickAgentOverride !== quickAgentOverride) {
    // Why: a pick the catalog later invalidated repairs before paint, the
    // fork's render-time adjustment — no effect, no extra commit.
    setQuickAgentOverride(resolvedQuickAgent.quickAgentOverride);
  }
  const quickAgent = resolvedQuickAgent.quickAgent;
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [createMultiple, setCreateMultiple] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [quickSessionCreating, setQuickSessionCreating] = useState(false);
  const baseRefInputId = React.useId();
  const branchNameInputId = React.useId();
  const projectDescriptionId = React.useId();
  const nameInputFocusFrameRef = useRef<number | null>(null);

  const projectOptions = useMemo(
    () => buildComposerProjectOptions(groups),
    [groups],
  );
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
  const selectedSparsePreset =
    sparsePresets.find((preset) => preset.id === selectedSparsePresetId) ??
    null;
  const createDisabled = disabled || sending || project === null;

  // The composer's data bridges for the smart name field (the fork wires
  // these through its app store; here they are the daemon's tasks and
  // worktree RPC namespaces).
  const tasksBridge = useMemo(() => {
    if (typeof window === "undefined" || !window.drogon) return null;
    const host = window.drogon as unknown as {
      tasks?: Pick<TasksBridge, "tasksList" | "tasksShow" | "tasksRemotes">;
    };
    return host.tasks ?? null;
  }, []);
  const branchSearchBridge = useMemo(() => {
    if (typeof window === "undefined" || !window.drogon) return null;
    const bridge = windowProjectBridge(window.drogon);
    return bridge.worktreeBranchSearch ?? null;
  }, []);
  const [repoSlug, setRepoSlug] = useState<{
    owner: string;
    repo: string;
  } | null>(null);
  useEffect(() => {
    if (!project || !isGit || !tasksBridge?.tasksRemotes) {
      setRepoSlug(null);
      return;
    }
    let cancelled = false;
    tasksBridge
      .tasksRemotes({ projectId: project.id })
      .then((result) => {
        if (cancelled) return;
        // The daemon serializes `owner/repo`; the smart field's URL
        // matching needs the split.
        const origin = result.ok ? result.result.origin : null;
        const [owner, repo] = origin?.split("/") ?? [];
        setRepoSlug(owner && repo ? { owner, repo } : null);
      })
      .catch(() => {
        if (!cancelled) setRepoSlug(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isGit, project?.id, tasksBridge]);

  // The fork's handleSmartBranchSelect (work-item-source-actions over
  // resolveComposerBranchPick): base = the picked ref, the worktree name
  // auto-derives from the local branch, and a local branch not already
  // checked out elsewhere is reuse-eligible (reuse defaults ON when the
  // selection produced the name).
  const handleSmartBranchSelect = useCallback(
    (refName: string, localBranchName: string) => {
      const pick = resolveComposerBranchPick({
        refName,
        localBranchName,
        currentName: name,
        lastAutoName: lastAutoNameRef.current,
        worktreeBranches: (selectedGroup?.worktrees ?? []).map(
          (worktree) => worktree.branch,
        ),
      });
      setBaseRef(pick.baseBranch);
      setBranchName(pick.branchNameOverride ?? "");
      if (pick.name !== undefined && pick.lastAutoName !== undefined) {
        setName(pick.name);
        lastAutoNameRef.current = pick.lastAutoName;
      }
      setReuseEligibleBranch(pick.reuseEligibleBranch);
      setReuseSelectedBranch(pick.defaultReuse);
      setSmartNameSelection({ kind: "branch", label: refName });
    },
    [name, selectedGroup],
  );

  // The fork's handleSmartGitHubItemSelect (github-provider-selection):
  // the pill carries `#N title`; the name auto-derives from the title slug
  // unless the user typed a custom name first.
  const handleSmartGitHubItemSelect = useCallback(
    (item: GitHubWorkItem) => {
      setSmartNameSelection({
        kind: item.type === "pr" ? "github-pr" : "github-issue",
        label: `#${item.number} ${item.title}`,
        url: item.url,
      });
      const nextName = slugifyForWorkspaceName(item.title);
      if (
        nextName &&
        shouldApplySuggestedName(name, lastAutoNameRef.current)
      ) {
        setName(nextName);
        lastAutoNameRef.current = nextName;
      }
    },
    [name],
  );

  // A newly picked project brings its own default base ref and local run
  // target; the typed name survives the switch (the source preserves the
  // name field too) but the smart-source state belongs to the old project.
  const prevProjectId = useRef(project?.id ?? "");
  useEffect(() => {
    const nextId = project?.id ?? "";
    if (prevProjectId.current !== nextId) {
      prevProjectId.current = nextId;
      setBaseRef(project?.defaultBaseRef ?? "");
      setBranchName("");
      setParentWorktreeId(null);
      setNote("");
      setRunSetup(Boolean(project?.setupScript?.trim()));
      setWaitForSetup(false);
      setSparsePresets([]);
      setSelectedSparsePresetId(null);
      setError(null);
      setSmartNameSelection(null);
      setReuseEligibleBranch(null);
      setReuseSelectedBranch(false);
      lastAutoNameRef.current = "";
    }
  });

  // Sparse presets are project-scoped daemon data. An older daemon simply
  // leaves the picker at Off; no renderer-only fake preset is invented.
  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      if (!project || !isGit) {
        setSparsePresets([]);
        setSelectedSparsePresetId(null);
        return;
      }
      const bridge: ProjectRpcBridge =
        typeof window === "undefined" ? {} : windowProjectBridge(window.drogon);
      if (typeof bridge.sparsePresets !== "function") return;
      try {
        const result = await bridge.sparsePresets({ projectId: project.id });
        if (!cancelled && result.ok) setSparsePresets(result.result.presets);
      } catch {
        if (!cancelled) setSparsePresets([]);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [isGit, project?.id]);

  const saveSparsePreset = useCallback(
    async (input: { id?: string; name: string; directories: string[] }) => {
      if (!project) return null;
      const bridge: ProjectRpcBridge =
        typeof window === "undefined" ? {} : windowProjectBridge(window.drogon);
      if (typeof bridge.saveSparsePreset !== "function") {
        setError(
          "Sparse checkout presets are unavailable: service does not advertise project.v1",
        );
        return null;
      }
      try {
        const result = await bridge.saveSparsePreset({
          projectId: project.id,
          ...input,
        });
        if (!result.ok) {
          setError(result.error.message);
          return null;
        }
        setSparsePresets((items) => {
          const existing = items.some((item) => item.id === result.result.id);
          return existing
            ? items.map((item) =>
                item.id === result.result.id ? result.result : item,
              )
            : [...items, result.result];
        });
        setError(null);
        return result.result;
      } catch {
        setError("Could not save the sparse preset. Retry the connection.");
        return null;
      }
    },
    [project],
  );

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
    // The fork's blank-name fallback (getWorkspaceSeedName →
    // getSuggestedCreatureName): an [Optional] name never blocks creation —
    // a globally-unique creature name seeds the worktree instead.
    const submitName =
      name.trim() ||
      (project?.kind === "git"
        ? getSuggestedCreatureName(
            groups.flatMap((group) => group.worktrees),
          )
        : "");
    const resolved = resolveComposerSubmit(groups, workspaces, {
      projectId,
      name: submitName,
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
        // Reuse (the fork's #5181) checks the existing branch out itself,
        // so the base ref is dropped with it (the daemon refuses both).
        ...(reuseSelectedBranch && reuseEligibleBranch
          ? {
              branch: reuseEligibleBranch,
              reuseBranch: true,
            }
          : {
              ...(baseRef.trim() ? { baseRef: baseRef.trim() } : {}),
              ...(branchName.trim() ? { branch: branchName.trim() } : {}),
            }),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(parentWorktreeId ? { parentWorktreeId } : {}),
        ...(selectedSparsePreset
          ? { sparse: selectedSparsePreset.directories }
          : {}),
        ...(runSetup && project?.setupScript?.trim()
          ? {
              setupScript: project.setupScript,
              ...(waitForSetup ? { waitForSetup: true } : {}),
            }
          : {}),
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
        setBranchName("");
        setParentWorktreeId(null);
        setNote("");
        setRunSetup(Boolean(resolved.target.project.setupScript?.trim()));
        setWaitForSetup(false);
        setSelectedSparsePresetId(null);
        focusNameInput();
        return;
      }
      onClose();
    } finally {
      setSending(false);
    }
  };

  const createQuickSession = async (): Promise<void> => {
    if (!quickAgent || quickSessionCreating || !onCreateQuickSession) return;
    setQuickSessionCreating(true);
    setError(null);
    const failure = await onCreateQuickSession({
      name: name.trim(),
      agent: { harnessId: quickAgent, model: "", provider: "" },
    });
    if (failure) setError(failure);
    else onClose();
    setQuickSessionCreating(false);
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
      className={cn(
        "grid min-w-0 gap-1 rounded-md transition",
        containerClassName,
      )}
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
          projectId={project?.id ?? null}
          repoSlug={repoSlug}
          tasks={tasksBridge ?? null}
          branchSearch={branchSearchBridge}
          smartNameSelection={smartNameSelection}
          onClearSmartNameSelection={() => setSmartNameSelection(null)}
          onSmartGitHubItemSelect={handleSmartGitHubItemSelect}
          onSmartBranchSelect={handleSmartBranchSelect}
          branchesEnabled
          canReuseSelectedBranch={reuseEligibleBranch !== null}
          reuseSelectedBranch={reuseSelectedBranch}
          onReuseSelectedBranchChange={setReuseSelectedBranch}
        />
        <NewWorkspaceComposerAgentSection
          quickAgent={quickAgent}
          onQuickAgentChange={(next) => setQuickAgentOverride(next)}
          onOpenAgentSettings={onOpenAgentSettings}
          createDisabled={createDisabled}
          onCreate={() => void submit()}
          advancedOpen={advancedOpen}
          onToggleAdvanced={() => setAdvancedOpen((open) => !open)}
          visibleQuickAgents={visibleQuickAgents}
          defaultTuiAgent={
            defaultHarnessId === "" ? null : (defaultHarnessId as HarnessId)
          }
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
          branchName={branchName}
          branchNameInputId={branchNameInputId}
          onBranchNameChange={setBranchName}
          parentWorktrees={selectedGroup?.worktrees ?? []}
          parentWorktreeId={parentWorktreeId}
          onParentWorktreeChange={setParentWorktreeId}
          note={note}
          onNoteChange={setNote}
          setupScript={project?.setupScript ?? null}
          runSetup={runSetup}
          onRunSetupChange={setRunSetup}
          waitForSetup={waitForSetup}
          onWaitForSetupChange={setWaitForSetup}
          sparsePresets={sparsePresets}
          selectedSparsePresetId={selectedSparsePresetId}
          onSparseSelectPreset={(preset) =>
            setSelectedSparsePresetId(preset?.id ?? null)
          }
          onSaveSparsePreset={saveSparsePreset}
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
        onCreateQuickSession={createQuickSession}
        quickSessionDisabled={disabled || !quickAgent || sending}
        quickSessionCreating={quickSessionCreating}
      />
    </div>
  );
}
