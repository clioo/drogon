import { z } from "zod";
import type { Result } from "./session-contract";

export const TASKS_CAPABILITY = "tasks.v1";
export const MAX_TASKS_QUERY_CHARS = 256;

export type TaskIssueState = "open" | "closed" | "all";
export type TasksListMode = "issues" | "pulls";
/** Which git remote's GitHub repo a tasks query reads; absent is `auto`
 *  (the daemon resolves upstream-first, like the reference client). */
export type TasksRemoteSource = "origin" | "upstream";
export type TaskPullRequestState = "open" | "closed" | "merged" | "draft";
export type PRReviewDecision = "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED";
export type CheckState = "success" | "failure" | "pending" | "neutral" | "none";
export type ProviderCheckSummary = {
  state: CheckState;
  total: number;
  passed: number;
  failed: number;
  pending: number;
  neutral: number;
};
export type PRMergeableState = "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
export type TaskPullRequest = {
  number: number;
  title: string;
  state: TaskPullRequestState;
  labels: TaskIssueLabel[];
  assignees: string[];
  author?: string;
  updatedAt: string;
  url: string;
  reviewDecision?: PRReviewDecision;
  checks?: ProviderCheckSummary;
  mergeable?: PRMergeableState;
  isDraft: boolean;
  headRefName?: string;
  baseRefName?: string;
};
export type TaskIssueLabel = { name: string; color: string | null };
export type TaskIssue = {
  number: number;
  title: string;
  state: "open" | "closed";
  labels: TaskIssueLabel[];
  assignees: string[];
  /** Author login, when the upstream returned one. */
  author?: string;
  updatedAt: string;
  url: string;
  body: string | null;
};
export type TaskLink = {
  projectId: string;
  issueNumber: number;
  worktreeId: string;
  branch: string;
  createdAt: string;
};
export type TasksListResult = {
  repo: string;
  issues: TaskIssue[];
  /** Pull requests for `mode: "pulls"`; absent on the issues path. */
  pulls?: TaskPullRequest[];
  /** Echoed 1-based page and effective page size of this window. */
  page: number;
  perPage: number;
  /** True when at least one more row exists past this page. */
  hasNextPage: boolean;
  /** Total matching issues, only when the upstream exposes one. */
  total?: number;
};
export type TasksShowResult = { issue: TaskIssue };
/** `tasks.remotes` result: GitHub `owner/repo` slug per remote name; a key
 *  is absent (never null) when that remote is missing or non-GitHub. */
export type TasksRemotesResult = { origin?: string; upstream?: string };
export type TasksStartResult = {
  issueNumber: number;
  worktree: {
    id: string;
    projectId: string;
    workspaceId: string;
    path: string;
    branch: string;
    head: string;
    baseRef: string | null;
    // Optional: the daemon omits the key when never renamed (unlike
    // `worktree.list`, which serializes an explicit null).
    title?: string | null;
    createdAt: string;
  };
  link: TaskLink;
  /** The PR head branch a pulls-mode start checked out; absent for issues. */
  headBranch?: string;
};
export type TasksLinksResult = { links: TaskLink[] };

export interface TasksBridge {
  tasksList(input: {
    projectId: string;
    state?: TaskIssueState;
    query?: string;
    /** 1-based page; the daemon defaults to the source page size. */
    page?: number;
    perPage?: number;
    /** "issues" (default) or "pulls"; the daemon fetches `gh pr list` for pulls. */
    mode?: TasksListMode;
    /** Remote pin from the issue-source selector; absent is `auto`. */
    source?: TasksRemoteSource;
  }): Promise<Result<TasksListResult>>;
  tasksShow(input: {
    projectId: string;
    number: number;
    source?: TasksRemoteSource;
  }): Promise<Result<TasksShowResult>>;
  tasksStart(input: {
    projectId: string;
    number: number;
    /** pulls mode checks out the PR head branch into the worktree. */
    mode?: TasksListMode;
    source?: TasksRemoteSource;
  }): Promise<Result<TasksStartResult>>;
  tasksLinks(input: { projectId: string }): Promise<Result<TasksLinksResult>>;
  /** Local git-config remote topology for the issue-source selector. */
  tasksRemotes(input: { projectId: string }): Promise<Result<TasksRemotesResult>>;
  /**
   * Interim project/worktree passthroughs (journey J6): the daemon's
   * `project.list`/`worktree.list` have no first-class desktop bridge yet,
   * and the Tasks page plus the sidebar badge need them. These call the
   * real RPCs with contract validation and no invented data; delete them
   * when the coordinator lands the project bridge.
   */
  tasksProjects(): Promise<Result<TasksProjectsResult>>;
  tasksWorktrees(input: {
    projectId?: string;
  }): Promise<Result<TasksWorktreesResult>>;
}

export type TasksProjectRef = {
  id: string;
  hostId: string;
  path: string;
  name: string;
  kind: "git" | "folder";
  defaultBaseRef: string | null;
};
export type TasksWorktreeRef = {
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
export type TasksProjectsResult = { projects: TasksProjectRef[] };
export type TasksWorktreesResult = { worktrees: TasksWorktreeRef[] };

const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[^\s\x00-\x1f\x7f]+$/u);
const projectId = z.object({ projectId: id });
const source = z.enum(["origin", "upstream"]).optional();
const repoSlug = z.string().min(1).max(256);

export const TASKS_PAGE_SIZE = 36;

export const tasksBridgeSchemas = {
  tasksList: projectId.extend({
    state: z.enum(["open", "closed", "all"]).optional(),
    query: z
      .string()
      .max(MAX_TASKS_QUERY_CHARS)
      .refine((value) => !value.includes("\0"))
      .optional(),
    page: z.number().int().min(1).max(10).optional(),
    perPage: z.number().int().min(1).max(100).optional(),
    mode: z.enum(["issues", "pulls"]).optional(),
    source,
  }),
  tasksShow: projectId.extend({ number: z.number().int().positive(), source }),
  tasksStart: projectId.extend({
    number: z.number().int().positive(),
    mode: z.enum(["issues", "pulls"]).optional(),
    source,
  }),
  tasksLinks: projectId,
  tasksRemotes: projectId,
  tasksProjects: z.object({}),
  tasksWorktrees: z.object({ projectId: id.optional() }),
};

const label = z.object({
  name: z.string().min(1).max(256),
  color: z.string().max(64).nullable().optional(),
});
const issue = z.object({
  number: z.number().int().positive(),
  title: z.string().min(1).max(4096),
  state: z.enum(["open", "closed"]),
  labels: z.array(label).max(100),
  assignees: z.array(z.string().min(1).max(128)).max(100),
  author: z.string().min(1).max(128).optional(),
  updatedAt: z.string().max(128),
  url: z.string().min(1).max(2048),
  body: z.string().max(1_048_576).nullable().optional(),
});
const checksSummary = z.object({
  state: z.enum(["success", "failure", "pending", "neutral", "none"]),
  total: z.number().int().min(0),
  passed: z.number().int().min(0),
  failed: z.number().int().min(0),
  pending: z.number().int().min(0),
  neutral: z.number().int().min(0),
});
const pull = z.object({
  number: z.number().int().positive(),
  title: z.string().min(1).max(4096),
  state: z.enum(["open", "closed", "merged", "draft"]),
  labels: z.array(label).max(100),
  assignees: z.array(z.string().min(1).max(128)).max(100),
  author: z.string().min(1).max(128).optional(),
  updatedAt: z.string().max(128),
  url: z.string().min(1).max(2048),
  reviewDecision: z.enum(["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"]).optional(),
  checks: checksSummary.optional(),
  mergeable: z.enum(["MERGEABLE", "CONFLICTING", "UNKNOWN"]).optional(),
  isDraft: z.boolean(),
  headRefName: z.string().min(1).max(512).optional(),
  baseRefName: z.string().min(1).max(512).optional(),
});
const worktree = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  workspaceId: z.string().min(1),
  path: z.string().min(1),
  branch: z.string(),
  head: z.string(),
  baseRef: z.string().nullable(),
  // The daemon serializes the rename title here too (absent when never
  // renamed); keep it so the strip does not silently drop it.
  title: z.string().nullable().nullish(),
  createdAt: z.string(),
});
const link = z.object({
  projectId: z.string().min(1),
  issueNumber: z.number().int().positive(),
  worktreeId: z.string().min(1),
  branch: z.string(),
  createdAt: z.string(),
});

const projectRef = z.object({
  id: z.string().min(1).max(128),
  hostId: z.string().min(1).max(128),
  path: z.string().min(1).max(32768),
  name: z.string().min(1).max(1024),
  kind: z.enum(["git", "folder"]),
  defaultBaseRef: z.string().max(1024).nullable(),
});
const worktreeRef = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  workspaceId: z.string().min(1),
  path: z.string().min(1),
  branch: z.string(),
  head: z.string(),
  baseRef: z.string().nullable(),
  // Nullish like the project bridge: the daemon serializes an unset title
  // as explicit null, and zod strips unknown keys — without this the
  // shared native registry entry silently drops the rename title.
  title: z.string().nullable().nullish(),
  createdAt: z.string(),
});

export const tasksResultSchemas = {
  "tasks.list": z.object({
    repo: z.string().min(1).max(256),
    issues: z.array(issue).max(100),
    pulls: z.array(pull).max(100).optional(),
    page: z.number().int().min(1),
    perPage: z.number().int().min(1).max(100),
    hasNextPage: z.boolean(),
    total: z.number().int().min(0).optional(),
  }),
  "tasks.show": z.object({ issue }),
  "tasks.start": z.object({
    issueNumber: z.number().int().positive(),
    worktree,
    link,
    headBranch: z.string().min(1).max(512).optional(),
  }),
  "tasks.links": z.object({ links: z.array(link).max(1000) }),
  "tasks.remotes": z.object({
    origin: repoSlug.optional(),
    upstream: repoSlug.optional(),
  }),
  "project.list": z.object({ projects: z.array(projectRef).max(10000) }),
  "worktree.list": z.object({ worktrees: z.array(worktreeRef).max(10000) }),
  // Interim only (see TasksBridge): the workspace rows merged as synthetic
  // folder projects until the project bridge lands.
  "workspace.list": z.object({
    workspaces: z
      .array(
        z.object({
          id: z.string().min(1).max(128),
          path: z.string().min(1).max(32768),
          name: z.string().min(1).max(1024),
          kind: z.enum(["folder", "git"]),
          hostId: z.string().min(1).max(128),
        }),
      )
      .max(10000),
  }),
};
