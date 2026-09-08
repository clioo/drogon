import type {
  Harness,
  HarnessId,
  HarnessLaunchInput,
  Project,
  Workspace,
} from "../../../../shared/session-contract";
import {
  normalizeHarnessLaunchInput,
  type HarnessLaunchFormValues,
} from "../../harness-launch-form";
import type { ProjectGroup } from "../shell/project-adapter";
import { normalizeBaseRef, validateWorktreeName } from "../shell/project-forms";

/**
 * Pure submit decisions for the new-workspace composer (journey J1): a
 * folder project opens its one implicit workspace, a git project creates
 * a worktree through `worktree.create`. The daemon stays authoritative
 * (it rejects `worktree.create` on folder projects and resolves the base
 * ref), so this module only routes and pre-checks what the form can.
 */
export type ComposerSubmitTarget =
  | {
      kind: "implicit";
      project: Project;
      workspaceId: string;
      agent: ComposerAgentSelection;
    }
  | {
      kind: "worktree";
      project: Project;
      name: string;
      baseRef?: string;
      agent: ComposerAgentSelection;
    };

/**
 * Agent the composer starts in the new workspace (journey J1): the
 * fork's `NewWorkspaceComposerAgentSection` quick-agent picker, adapted to
 * this repo's harness ids. `null` creates the workspace without a session
 * (today's behavior); a harness id chains `harness.start` after the
 * worktree exists, carrying the free-local-model provider/model the "+"
 * launch form already supports (`normalizeHarnessLaunchInput` keeps the
 * provider Pi-only, so a stale value can never leak to another harness).
 */
export type ComposerAgentSelection = {
  harnessId: HarnessId | null;
  model: string;
  provider: string;
};

export function emptyComposerAgentSelection(): ComposerAgentSelection {
  return { harnessId: null, model: "", provider: "" };
}

/**
 * Preselects the stored default harness when it is actually available;
 * otherwise null (create without a session). Never invents a harness the
 * service did not list.
 */
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
  return null;
}

/**
 * Builds the `harness.start` input for a composer selection, or null when
 * the composer creates the workspace without a session. `requestId` is
 * attempt-tracking metadata the caller attaches (see `TabCreateMenu`).
 */
export function composerAgentLaunchInput(
  workspaceId: string,
  selection: ComposerAgentSelection,
  requestId: string,
): HarnessLaunchInput | null {
  if (!selection.harnessId) return null;
  const values: HarnessLaunchFormValues = {
    model: selection.model,
    provider: selection.provider,
    effort: "",
    prompt: "",
    unattended: false,
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
    const group = groups.find((item) => item.project.id === project.id);
    const workspaceId = group?.worktrees[0]?.workspaceId ?? null;
    const workspace =
      workspaces.find((item) => item.id === workspaceId) ?? null;
    if (!workspace)
      return {
        error:
          "The folder workspace is missing. Refresh the connection and retry.",
      };
    return {
      target: {
        kind: "implicit",
        project,
        workspaceId: workspace.id,
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
