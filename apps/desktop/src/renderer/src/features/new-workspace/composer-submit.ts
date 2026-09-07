import type {
  Project,
  Workspace,
} from "../../../../shared/session-contract";
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
  | { kind: "implicit"; project: Project; workspaceId: string }
  | {
      kind: "worktree";
      project: Project;
      name: string;
      baseRef?: string;
    };

/** Error string, or the resolved submit target. */
export function resolveComposerSubmit(
  groups: ProjectGroup[],
  workspaces: Workspace[],
  input: { projectId: string | null; name: string; baseRef: string },
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
    return { target: { kind: "implicit", project, workspaceId: workspace.id } };
  }
  const nameError = validateWorktreeName(input.name);
  if (nameError) return { error: nameError };
  return {
    target: {
      kind: "worktree",
      project,
      name: input.name.trim(),
      baseRef: normalizeBaseRef(input.baseRef),
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
