import type {
  Harness,
  HarnessId,
  HarnessLaunchInput,
  Project,
  Workspace,
} from "../../../../shared/session-contract";
import {
  resolveHarnessAgentDefault,
  splitPiProviderModel,
  type HarnessAgentDefaultFields,
} from "../../../../shared/agent-defaults";
import {
  normalizeHarnessLaunchInput,
  type HarnessLaunchFormValues,
} from "../../harness-launch-form";
import type { ProjectGroup } from "../shell/project-adapter";
import { normalizeBaseRef, validateWorktreeName } from "../shell/project-forms";

/**
 * Pure submit decisions for the new-workspace composer (journey J1): both
 * a git project and a folder project create a new section through
 * `worktree.create`. A git project gets a real git worktree (with a base
 * ref); a folder project gets an additional named Workspace sharing its
 * folder path, its own sidebar section grouping its own sessions (issue
 * #579). The daemon stays authoritative (it creates the git worktree or
 * the folder Workspace and resolves the base ref), so this module only
 * routes and pre-checks what the form can. `folderWorkspace` marks the
 * folder path so the caller drops the git-only Advanced fields the daemon
 * would reject.
 */
export type ComposerSubmitTarget = {
  kind: "worktree";
  project: Project;
  name: string;
  baseRef?: string;
  folderWorkspace?: boolean;
  agent: ComposerAgentSelection;
};

/**
 * Agent the composer starts in the new workspace (journey J1): the
 * fork's `NewWorkspaceComposerAgentSection` quick-agent picker, adapted to
 * this repo's harness ids. `null` creates the workspace without a session
 * (today's behavior); a harness id chains `harness.start` after the
 * worktree exists, carrying the free-local-model provider/model
 * (`normalizeHarnessLaunchInput` keeps the provider Pi-only, so a stale
 * value can never leak to another harness).
 */
export type ComposerAgentSelection = {
  harnessId: HarnessId | null;
  model: string;
  provider: string;
};

/**
 * The fork's quick-composer agent preselection (`pickQuickWorkspaceAgent`
 * over TUI_AGENT_AUTO_PICK_ORDER): the stored default harness when it is
 * actually available; otherwise the first available harness in the source's
 * auto-pick order (claude, opencode, pi, antigravity — the subset Drogon
 * ships), then any remaining listed harness; null (the source's "Blank
 * Terminal") only when nothing is available. Never invents a harness the
 * service did not list.
 */
const COMPOSER_AGENT_AUTO_PICK_ORDER: HarnessId[] = [
  "claude",
  "opencode",
  "pi",
  "antigravity",
];

export function initialComposerAgentId(
  harnesses: Harness[],
  defaultHarnessId: string,
): HarnessId | null {
  const available = harnesses.filter(
    (harness) => harness.availability === "available",
  );
  if (
    defaultHarnessId !== "" &&
    available.some((harness) => harness.harnessId === defaultHarnessId)
  )
    return defaultHarnessId as HarnessId;
  for (const candidate of COMPOSER_AGENT_AUTO_PICK_ORDER) {
    if (available.some((harness) => harness.harnessId === candidate))
      return candidate;
  }
  return available[0]?.harnessId ?? null;
}

/**
 * Builds the `harness.start` input for a composer selection, or null when
 * the composer creates the workspace without a session. `requestId` is
 * attempt-tracking metadata the caller attaches (see `TabCreateMenu`).
 * The Settings → Agents defaults drive the launch like every other path:
 * the stored (or fork-default) permission mode and effort always apply,
 * and a blank composer Model falls back to the stored default model. An
 * explicitly picked model/provider always wins over the stored default.
 */
export function composerAgentLaunchInput(
  workspaceId: string,
  selection: ComposerAgentSelection,
  requestId: string,
  defaults: Record<string, HarnessAgentDefaultFields> = {},
): HarnessLaunchInput | null {
  if (!selection.harnessId) return null;
  const stored = resolveHarnessAgentDefault(selection.harnessId, defaults);
  const pickedModel =
    selection.model.trim() !== "" ? selection.model : stored.model;
  // A Pi `provider/model-id` shorthand (typed or from the stored default)
  // splits when no explicit provider wins — Pi rejects the combined flag.
  const split =
    selection.harnessId === "pi" && selection.provider.trim() === ""
      ? splitPiProviderModel(pickedModel)
      : null;
  const values: HarnessLaunchFormValues = {
    model: split ? (split.model ?? "") : pickedModel,
    provider: split?.provider ?? selection.provider,
    effort: stored.effort,
    prompt: "",
    unattended: stored.permissionMode === "unattended",
  };
  return {
    ...normalizeHarnessLaunchInput(
      workspaceId,
      selection.harnessId,
      values,
    ),
    requestId,
  };
}

/** Error string, or the resolved submit target. */
export function resolveComposerSubmit(
  groups: ProjectGroup[],
  workspaces: Workspace[],
  input: {
    projectId: string | null;
    name: string;
    baseRef: string;
    agent: ComposerAgentSelection;
  },
): { target: ComposerSubmitTarget } | { error: string } {
  const project =
    groups.find((group) => group.project.id === input.projectId)?.project ??
    null;
  if (!project) return { error: "Choose a project to continue." };
  if (project.kind !== "git") {
    // A folder project creates an additional named Workspace sharing its
    // folder path (issue #579): its own section with its own sessions. The
    // daemon has no branch/base ref to resolve here, so only the name is
    // validated; the caller drops the git-only Advanced fields.
    const nameError = validateWorktreeName(input.name);
    if (nameError) return { error: nameError };
    return {
      target: {
        kind: "worktree",
        project,
        name: input.name.trim(),
        folderWorkspace: true,
        agent: input.agent,
      },
    };
  }
  const nameError = validateWorktreeName(input.name);
  if (nameError) return { error: nameError };
  // The launch input needs the new workspace id, known only after
  // `worktree.create` succeeds — the caller builds it with
  // `composerAgentLaunchInput` once the daemon returns it.
  return {
    target: {
      kind: "worktree",
      project,
      name: input.name.trim(),
      baseRef: normalizeBaseRef(input.baseRef),
      agent: input.agent,
    },
  };
}

/** Primary action copy: the source's per-kind composer labels. */
export function composerPrimaryActionLabel(
  project: Project | null,
): "Create worktree" | "Create workspace" {
  return project?.kind === "git" ? "Create worktree" : "Create workspace";
}

/**
 * Initial project for a fresh composer: the requested project when it is
 * still listed, otherwise the first listed project, otherwise null (the
 * card then shows the source's "add a project first" message).
 */
export function initialComposerProjectId(
  groups: ProjectGroup[],
  preferred: string | null,
): string | null {
  if (preferred && groups.some((group) => group.project.id === preferred))
    return preferred;
  return groups[0]?.project.id ?? null;
}
