// MIT Copyright (c) 2026 Lovecast Inc. The start-from-issue action ported
// from the fork's Tasks-page "Start workspace" flow
// (use-task-page-composer-actions.ts → openComposerForJiraItem): the daemon
// creates the worktree (jira.startIssue, the same shared creation path as
// the GitHub tasks.start), and the session launch is the caller's job
// through this repo's harness.start surface with the fork's initial
// prompt — this helper builds exactly that prompt.
//
// C06: every start carries a stable task identity (resolved from the
// instance site URL + the immutable issue id, never the credential) and a
// per-action intent id. The renderer coalesces concurrent starts for the
// same identity+project so a double click cannot issue two start
// operations; the daemon's intent registry (`jira/session_links.rs`) makes
// the same guarantee durable across processes.
import type { JiraBridge, JiraIssue } from "../../../../../shared/jira-contract";
import { getJiraIssueWorkspaceSeed } from "./jira-workspace-seed";
import {
  getJiraTaskIdentity,
  jiraTaskLinkId,
  type JiraTaskIdentity,
} from "./jira-task-identity";

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
      /** Stable identity when the instance URL + immutable id resolve. */
      identity: JiraTaskIdentity | null;
      /** The start operation id sent to the daemon (durable dedup key). */
      intentId: string;
    }
  | { ok: false; error: string };

function newIntentId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `intent-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

/** In-flight coalescing: identity+project → the one running start promise. */
const inFlightStarts = new Map<string, Promise<JiraStartIssueOutcome>>();

/**
 * Turns a Jira issue into work through the shared daemon path. Idempotent
 * like `tasks.start`: a repeated call returns the same worktree. The
 * display title carries the issue identity (the badge/link back to the
 * issue) and `seedName` is the fork's workspace-name seed for callers that
 * open the new-workspace composer pre-filled.
 *
 * `siteUrl` is the ACTUAL instance URL (e.g. the selected site's `siteUrl`
 * from `jira.status`); when absent the outcome reports
 * `identity: null` — unresolved — and never derives one from the account
 * email or the legacy per-account site id.
 */
export async function startWorkspaceFromJiraIssue(
  bridge: JiraBridge,
  input: {
    projectId: string;
    issue: Pick<JiraIssue, "key" | "title"> & Partial<JiraIssue>;
    /** The connected site's URL for the stable instance identity. */
    siteUrl?: string | null;
    /** Explicit start-operation id; defaults to a fresh UUID per call. */
    intentId?: string;
  },
): Promise<JiraStartIssueOutcome> {
  const identity = await getJiraTaskIdentity(
    {
      issueId: input.issue.id ?? "",
      key: input.issue.key,
    },
    input.siteUrl ?? null,
  );
  // Concurrent starts for the SAME task in the SAME project coalesce: the
  // second click awaits the first instead of issuing a second operation.
  const dedupKey = `${input.projectId}::${identity ? jiraTaskLinkId(identity) : `key:${input.issue.key}`}`;
  const running = inFlightStarts.get(dedupKey);
  if (running) {
    return running;
  }
  const intentId = input.intentId ?? newIntentId();
  const operation = (async (): Promise<JiraStartIssueOutcome> => {
    const fallbackSeed = getJiraIssueWorkspaceSeed({
      key: input.issue.key,
      title: input.issue.title,
    });
    const result = await bridge.jiraStartIssue({
      projectId: input.projectId,
      key: input.issue.key,
      siteId: input.issue.siteId,
      title: input.issue.title,
      // Additive over the current daemon contract: `jira.startIssue`
      // deserialization ignores unknown fields until the C06 handover
      // wires the durable intent registry through.
      intentId,
    } as Parameters<JiraBridge["jiraStartIssue"]>[0]);
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
      identity,
      intentId,
    };
  })();
  inFlightStarts.set(dedupKey, operation);
  try {
    return await operation;
  } finally {
    // Only clear while we still own the entry (a newer call never started
    // under the same key: coalescing returns the same promise object).
    if (inFlightStarts.get(dedupKey) === operation) {
      inFlightStarts.delete(dedupKey);
    }
  }
}
