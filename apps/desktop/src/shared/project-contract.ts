import { z } from "zod";
import type { Result } from "./session-contract";

export const PROJECT_CAPABILITY = "project.v1";
export const WORKTREE_CAPABILITY = "worktree.v1";
/**
 * Main-to-renderer push channel (issue #146): main polls the daemon's
 * `project.changes` revision digest and sends the new revision here
 * whenever the registry moved out from under the renderer (e.g. a
 * `drogon-cli project add` from another process). The renderer re-reads
 * the project view; the payload itself carries no rows.
 */
export const PROJECTS_CHANGED_CHANNEL = "drogon:projectsChanged";

export type ProjectBridge = {
  projectAdd(input: {
    path: string;
    name?: string;
  }): Promise<Result<ProjectResult>>;
  projectList(): Promise<Result<{ projects: ProjectResult[] }>>;
  projectRemove(input: { id: string }): Promise<Result<{ id: string; removed: boolean }>>;
  worktreeCreate(input: {
    projectId: string;
    name: string;
    baseRef?: string;
  }): Promise<Result<WorktreeResult>>;
  worktreeList(input: {
    projectId: string;
  }): Promise<Result<{ worktrees: WorktreeResult[] }>>;
  worktreeRemove(input: {
    id: string;
    force?: boolean;
  }): Promise<Result<{ id: string; removed: boolean }>>;
  /**
   * Display-title rename (`worktree.rename { worktreeId, name }`): renames
   * the card title only, never the git branch or directory (Orca's
   * `updateWorktreeMeta(displayName)` semantics).
   */
  worktreeRename(input: {
    worktreeId: string;
    name: string;
  }): Promise<Result<WorktreeResult>>;
  /**
   * Subscribes to registry pushes from main (issue #146). Every method
   * above stays optional; this one is too, so older preloads simply never
   * push and the sidebar keeps its current load-on-local-change behavior.
   */
  onProjectsChanged?: (
    listener: (revision: string) => void,
  ) => () => void;
};

/** Opaque registry revision from the daemon's `project.changes`. */
export type ProjectChangesResult = {
  revision: string;
};

export type ProjectResult = {
  id: string;
  hostId: string;
  path: string;
  name: string;
  kind: "git" | "folder";
  defaultBaseRef: string | null;
};

export type WorktreeResult = {
  id: string;
  projectId: string;
  workspaceId: string;
  path: string;
  branch: string;
  head: string;
  baseRef: string | null;
  /** Display title from `worktree.rename`; null when never renamed. */
  title: string | null;
  createdAt: string;
};

const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[^\s\x00-\x1f\x7f]+$/u);
const fsPath = z
  .string()
  .min(1)
  .max(32_768)
  .refine((value) => !value.includes("\0"));
const displayName = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => !value.includes("\0"));
const branchName = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => !value.includes("\0"));

export const projectBridgeSchemas = {
  projectAdd: z.object({ path: fsPath, name: displayName.optional() }),
  projectList: z.undefined(),
  projectRemove: z.object({ id }),
  worktreeCreate: z.object({
    projectId: id,
    name: branchName,
    baseRef: branchName.optional(),
  }),
  worktreeList: z.object({ projectId: id }),
  worktreeRemove: z.object({ id, force: z.boolean().optional() }),
  worktreeRename: z.object({
    worktreeId: id,
    name: z
      .string()
      .min(1)
      .max(256)
      .refine((value) => !value.includes("\0")),
  }),
};

const projectResult = z.object({
  id: z.string(),
  hostId: z.string(),
  path: z.string(),
  name: z.string(),
  kind: z.enum(["git", "folder"]),
  defaultBaseRef: z.string().nullable(),
});

const worktreeResult = z.object({
  id: z.string(),
  projectId: z.string(),
  workspaceId: z.string(),
  path: z.string(),
  branch: z.string(),
  head: z.string(),
  baseRef: z.string().nullable(),
  // Nullish, not just optional: the service serializes an unset title as
  // explicit null, and a present-null must validate the same as a missing
  // key rather than failing the whole worktree response.
  title: z.string().nullable().nullish(),
  createdAt: z.string(),
});

const projectChangesResult = z.object({ revision: z.string() });

export const projectResultSchemas = {
  "project.add": projectResult,
  "project.list": z.object({ projects: z.array(projectResult) }),
  "project.changes": projectChangesResult,
  "project.remove": z.object({ id: z.string(), removed: z.boolean() }),
  "worktree.create": worktreeResult,
  "worktree.list": z.object({ worktrees: z.array(worktreeResult) }),
  "worktree.remove": z.object({ id: z.string(), removed: z.boolean() }),
  "worktree.rename": worktreeResult,
};
