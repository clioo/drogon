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

export interface GitBridge {
  gitStatus(input: GitScope): Promise<Result<GitStatusResult>>;
  gitDiff(
    input: GitScope & { path: string; staged?: boolean },
  ): Promise<Result<GitDiffResult>>;
  gitStage(input: GitScope & { paths: string[] }): Promise<Result<GitPathsResult>>;
  gitUnstage(
    input: GitScope & { paths: string[] },
  ): Promise<Result<GitPathsResult>>;
  gitCommit(input: GitScope & { message: string }): Promise<Result<GitCommitResult>>;
  gitPush(input: GitScope): Promise<Result<GitPushResult>>;
  gitPrCreate(
    input: GitScope & { title: string; body?: string },
  ): Promise<Result<GitPrCreateResult>>;
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
  }),
  gitPush: scope,
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
  "git.pr_create": scope.extend({ url: z.string().min(1).max(2_048) }),
};
