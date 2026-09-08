import { z } from "zod";
import type { Result } from "./session-contract";

export const GIT_CAPABILITY = "git.v1";
export const MAX_GIT_DIFF_CHARS = 65_536;
export const MAX_GIT_PATHS = 1_000;

export type GitScope = {
  hostId: string;
  workspaceId: string;
};
export type GitStatusEntry = {
  path: string;
  staged: string;
  unstaged: string;
  kind: "ordinary" | "rename" | "copy" | "unmerged" | "untracked" | "ignored";
  origPath?: string;
};
export type GitBranch = {
  head?: string | null;
  oid?: string | null;
  upstream?: string | null;
  ahead?: number | null;
  behind?: number | null;
  // #176, additive: remote names from `git remote` (never URLs). Absent on
  // older daemons; empty means no remote configured (distinct from
  // no-upstream). The panel treats absent as unknown, never as no-remote.
  remotes?: string[] | null;
};
export type GitStatusResult = GitScope & {
  branch: GitBranch;
  entries: GitStatusEntry[];
  truncated: boolean;
};
export type GitDiffResult = GitScope & {
  path: string;
  staged: boolean;
  diff: string;
  truncated: boolean;
};
export type GitPathsResult = GitScope & { paths: string[] };
export type GitCommitResult = GitScope & { commit: string };
export type GitPushResult = GitScope & { pushed: boolean; detail: string };
export type GitPrCreateResult = GitScope & { url: string };
export type GitLineCount = {
  path: string;
  stagedAdded: number | null;
  stagedRemoved: number | null;
  unstagedAdded: number | null;
  unstagedRemoved: number | null;
};
export type GitLineCountsResult = GitScope & { counts: GitLineCount[] };
export type GitPullResult = GitScope & { detail: string };
export type GitFetchResult = GitScope & { detail: string };

export interface GitBridge {
  gitStatus(input: GitScope): Promise<Result<GitStatusResult>>;
  gitDiff(
    input: GitScope & { path: string; staged?: boolean },
  ): Promise<Result<GitDiffResult>>;
  gitStage(input: GitScope & { paths: string[] }): Promise<Result<GitPathsResult>>;
  gitUnstage(
    input: GitScope & { paths: string[] },
  ): Promise<Result<GitPathsResult>>;
  gitCommit(
    input: GitScope & { message: string; amend?: boolean },
  ): Promise<Result<GitCommitResult>>;
  gitPush(input: GitScope): Promise<Result<GitPushResult>>;
  gitPrCreate(
    input: GitScope & { title: string; body?: string },
  ): Promise<Result<GitPrCreateResult>>;
  // Additive R10-B surface: optional so older bridges and the gated
  // mount adapter keep typechecking; the panel probes availability
  // at runtime and hides the action when absent.
  gitDiscard?: (
    input: GitScope & { paths: string[]; untracked: boolean },
  ) => Promise<Result<GitPathsResult>>;
  gitLineCounts?: (
    input: GitScope & { paths: string[] },
  ) => Promise<Result<GitLineCountsResult>>;
  gitPull?: (input: GitScope) => Promise<Result<GitPullResult>>;
  gitFetch?: (input: GitScope) => Promise<Result<GitFetchResult>>;
}

const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[^\s\x00-\x1f\x7f]+$/u);
const scope = z.object({ hostId: id, workspaceId: id });
const gitPath = z
  .string()
  .min(1)
  .max(32_768)
  .refine(
    (value) =>
      !value.includes("\0") &&
      !value.startsWith("/") &&
      !/(^|\/)\.\.(\/|$)/.test(value),
  );
const paths = z.array(gitPath).min(1).max(MAX_GIT_PATHS);

export const gitBridgeSchemas = {
  gitStatus: scope,
  gitDiff: scope.extend({ path: gitPath, staged: z.boolean().optional() }),
  gitStage: scope.extend({ paths }),
  gitUnstage: scope.extend({ paths }),
  gitCommit: scope.extend({
    message: z
      .string()
      .min(1)
      .max(8_192)
      .refine((value) => !value.includes("\0")),
    amend: z.boolean().optional(),
  }),
  gitPush: scope,
  gitDiscard: scope.extend({ paths, untracked: z.boolean() }),
  gitLineCounts: scope.extend({ paths }),
  gitPull: scope,
  gitFetch: scope,
  gitPrCreate: scope.extend({
    title: z
      .string()
      .min(1)
      .max(512)
      .refine((value) => !value.includes("\0") && !value.includes("\n")),
    body: z
      .string()
      .max(32_768)
      .refine((value) => !value.includes("\0"))
      .optional(),
  }),
};

const statusEntry = z.object({
  path: z.string().min(1).max(32_768),
  staged: z.string().max(8),
  unstaged: z.string().max(8),
  kind: z.enum(["ordinary", "rename", "copy", "unmerged", "untracked", "ignored"]),
  origPath: z.string().min(1).max(32_768).optional(),
});

export const gitResultSchemas = {
  "git.status": scope.extend({
    // Nullish, not just optional: the service serializes absent branch
    // fields as explicit nulls, and a present-null must validate the same
    // as a missing key rather than failing the whole status response.
    branch: z.object({
      head: z.string().max(1_024).nullish(),
      oid: z.string().max(128).nullish(),
      upstream: z.string().max(1_024).nullish(),
      ahead: z.number().int().nullish(),
      behind: z.number().int().nullish(),
      // #176, additive: nullish so older daemons without the field still
      // validate; names only (the daemon never sends URLs).
      remotes: z.array(z.string().min(1).max(256)).max(32).nullish(),
    }),
    entries: z.array(statusEntry).max(50_000),
    truncated: z.boolean(),
  }),
  "git.diff": scope.extend({
    path: z.string().min(1).max(32_768),
    staged: z.boolean(),
    diff: z.string().max(MAX_GIT_DIFF_CHARS),
    truncated: z.boolean(),
  }),
  "git.stage": scope.extend({ paths: z.array(z.string()).max(MAX_GIT_PATHS) }),
  "git.unstage": scope.extend({ paths: z.array(z.string()).max(MAX_GIT_PATHS) }),
  "git.commit": scope.extend({ commit: z.string().min(1).max(128) }),
  "git.push": scope.extend({ pushed: z.boolean(), detail: z.string().max(2_048) }),
  "git.discard": scope.extend({ paths: z.array(z.string()).max(MAX_GIT_PATHS) }),
  "git.line_counts": scope.extend({
    counts: z
      .array(
        z.object({
          path: z.string().min(1).max(32_768),
          stagedAdded: z.number().int().min(0).nullable(),
          stagedRemoved: z.number().int().min(0).nullable(),
          unstagedAdded: z.number().int().min(0).nullable(),
          unstagedRemoved: z.number().int().min(0).nullable(),
        }),
      )
      .max(MAX_GIT_PATHS),
  }),
  "git.pull": scope.extend({ detail: z.string().max(2_048) }),
  "git.fetch": scope.extend({ detail: z.string().max(2_048) }),
  "git.pr_create": scope.extend({ url: z.string().min(1).max(2_048) }),
};
