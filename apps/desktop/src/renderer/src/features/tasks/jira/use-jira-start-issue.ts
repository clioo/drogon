// MIT Copyright (c) 2026 Lovecast Inc. The start-from-issue action ported
// from the fork's Tasks-page "Start workspace" flow
// (use-task-page-composer-actions.ts → openComposerForJiraItem): the daemon
// creates the worktree (jira.startIssue, the same shared creation path as
// the GitHub tasks.start), and the session launch is the caller's job
// through this repo's harness.start surface with the fork's initial
// prompt — this helper builds exactly that prompt.
import type { JiraBridge, JiraIssue } from "../../../../../shared/jira-contract";
import { getJiraIssueWorkspaceSeed } from "./jira-workspace-seed";

/**
 * The fork's default issue command when a repo defines no issueCommand
 * template (`DEFAULT_ISSUE_COMMAND_TEMPLATE = 'Complete {{artifact_url}}'`).
 */
export function buildJiraStartIssuePrompt(
  issue: Pick<JiraIssue, "url">,
): string {
  return `Complete ${issue.url}`;
}

/**
 * The fork's "Copy prompt" affordance — what the workspace card copies when
 * the user wants the full issue context in the initial prompt.
 */
export function buildJiraIssueContextPrompt(
  issue: Pick<JiraIssue, "key" | "title" | "url">,
): string {
  return `Complete Jira issue ${issue.key}: ${issue.title}\n\n${issue.url}`;
}

export type JiraStartIssueOutcome =
  | {
      ok: true;
      key: string;
      url: string;
      displayName: string;
      seedName: string;
      worktreeId: string;
      workspaceId: string;
    }
  | { ok: false; error: string };

/**
 * Turns a Jira issue into work through the shared daemon path. Idempotent
 * like `tasks.start`: a repeated call returns the same worktree. The
 * display title carries the issue identity (the badge/link back to the
 * issue) and `seedName` is the fork's workspace-name seed for callers that
 * open the new-workspace composer pre-filled.
 */
export async function startWorkspaceFromJiraIssue(
  bridge: JiraBridge,
  input: {
    projectId: string;
    issue: Pick<JiraIssue, "key" | "title"> & Partial<JiraIssue>;
  },
): Promise<JiraStartIssueOutcome> {
  const fallbackSeed = getJiraIssueWorkspaceSeed({
    key: input.issue.key,
    title: input.issue.title,
  });
  const result = await bridge.jiraStartIssue({
    projectId: input.projectId,
    key: input.issue.key,
    siteId: input.issue.siteId,
    title: input.issue.title,
  });
  if (!result.ok) {
    return { ok: false, error: result.error.message };
  }
  const started = result.result;
  if (!started.ok) {
    return { ok: false, error: "Could not start the Jira issue." };
  }
  return {
    ok: true,
    key: started.key,
    url: started.url || input.issue.url || "",
    displayName: started.displayName || input.issue.key,
    seedName: started.seedName || fallbackSeed,
    worktreeId: started.worktree.id,
    workspaceId: started.worktree.workspaceId,
  };
}
