/* MIT Copyright (c) 2026 Lovecast Inc.
   The Linear start/link producer: turns a Linear issue into work through
   the durable project RPCs every other surface already uses. Start creates
   the worktree (`worktreeCreate`) then links the issue (`worktreeLinkIssue`,
   the one durable Linear API); link attaches an issue to an existing
   worktree; unlink detaches it. All three verify the daemon echoed the
   same owner and issue back — a mismatched echo never reports success. */
import {
  issueDetailsSchema,
  parseLinearIssueInput,
  type IssueDetails,
  type WorktreeIssueLink,
} from "../../../../../shared/worktree-issue-contract";
import type { ProjectRpcBridge } from "../../shell/project-adapter";
import { getLinearIssueWorkspaceSeed } from "./linear-workspace-seed";

/** The fork's default issue command when no template applies. */
export function buildLinearStartIssuePrompt(
  issue: Pick<IssueDetails, "url" | "identifier">,
): string {
  return `Complete ${issue.url ?? issue.identifier}`;
}

/** The "Copy prompt" affordance: full issue context for the first turn. */
export function buildLinearIssueContextPrompt(
  issue: Pick<IssueDetails, "identifier" | "title" | "url">,
): string {
  return `Complete Linear issue ${issue.identifier}: ${issue.title}\n\n${issue.url ?? issue.identifier}`;
}

export type LinearStartIssueOutcome =
  | {
      ok: true;
      identifier: string;
      url: string | null;
      displayName: string;
      seedName: string;
      worktreeId: string;
      workspaceId: string;
      linked: boolean;
    }
  | { ok: false; error: string };

/** In-flight coalescing: project+identifier → the one running promise, so
 *  a double click cannot issue two creates for the same issue. */
const inFlightStarts = new Map<string, Promise<LinearStartIssueOutcome>>();

/** Test seam: drops every in-flight start between cases. */
export function clearLinearStartCoalescing(): void {
  inFlightStarts.clear();
}

function startKey(projectId: string, identifier: string): string {
  return `${projectId}::${identifier.trim().toUpperCase()}`;
}

function toLinkIssue(issue: IssueDetails): IssueDetails {
  return issueDetailsSchema.parse({
    provider: "linear",
    identifier: issue.identifier.trim().toUpperCase(),
    title: issue.title,
    siteId: issue.siteId ?? null,
    url: issue.url ?? null,
    stateName: issue.stateName ?? null,
    labels: issue.labels ?? [],
  });
}

/**
 * Starts work from a Linear issue: creates the worktree under `projectId`
 * with the issue seed name, then links the issue through the durable
 * `worktreeLinkIssue` API. Idempotent per project+identifier while in
 * flight; a repeated call awaits the first instead of creating twice.
 */
export function startWorkspaceFromLinearIssue(
  bridge: ProjectRpcBridge,
  input: { projectId: string; issue: IssueDetails },
): Promise<LinearStartIssueOutcome> {
  let linkIssue: IssueDetails;
  try {
    linkIssue = toLinkIssue(input.issue);
  } catch {
    return Promise.resolve({ ok: false, error: "That Linear issue is not valid." });
  }
  if (!parseLinearIssueInput(linkIssue.identifier)) {
    return Promise.resolve({ ok: false, error: "That Linear issue is not valid." });
  }
  const key = startKey(input.projectId, linkIssue.identifier);
  const running = inFlightStarts.get(key);
  if (running) return running;
  const operation = (async (): Promise<LinearStartIssueOutcome> => {
    if (typeof bridge.worktreeCreate !== "function") {
      return { ok: false, error: "Worktree creation is unavailable." };
    }
    const seedName = getLinearIssueWorkspaceSeed(linkIssue);
    if (!seedName) {
      return { ok: false, error: "That Linear issue has no usable title." };
    }
    let created: { id: string; workspaceId: string };
    try {
      const result = await bridge.worktreeCreate({
        projectId: input.projectId,
        name: seedName,
      });
      if (!result.ok) return { ok: false, error: result.error.message };
      created = { id: result.result.id, workspaceId: result.result.workspaceId };
    } catch {
      return { ok: false, error: "Could not create the worktree." };
    }
    const displayName = `${linkIssue.identifier} ${linkIssue.title}`.trim();
    if (typeof bridge.worktreeLinkIssue !== "function") {
      return {
        ok: true,
        identifier: linkIssue.identifier,
        url: linkIssue.url,
        displayName,
        seedName,
        worktreeId: created.id,
        workspaceId: created.workspaceId,
        linked: false,
      };
    }
    try {
      const linked = await bridge.worktreeLinkIssue({
        worktreeId: created.id,
        issue: linkIssue,
      });
      if (!linked.ok) {
        return { ok: false, error: linked.error.message };
      }
      const echo = linked.result;
      if (
        echo.worktreeId !== created.id ||
        echo.identifier.toUpperCase() !== linkIssue.identifier ||
        echo.provider !== "linear"
      ) {
        return { ok: false, error: "The link could not be verified." };
      }
      return {
        ok: true,
        identifier: linkIssue.identifier,
        url: linkIssue.url,
        displayName,
        seedName,
        worktreeId: created.id,
        workspaceId: created.workspaceId,
        linked: true,
      };
    } catch {
      return { ok: false, error: "Could not link the Linear issue." };
    }
  })();
  inFlightStarts.set(key, operation);
  return operation.finally(() => {
    if (inFlightStarts.get(key) === operation) inFlightStarts.delete(key);
  });
}

export type LinearLinkOutcome =
  | { ok: true; link: WorktreeIssueLink }
  | { ok: false; error: string };

/** Links a Linear issue to an existing worktree via the durable API. */
export async function linkLinearIssueToWorktree(
  bridge: ProjectRpcBridge,
  input: { worktreeId: string; issue: IssueDetails },
): Promise<LinearLinkOutcome> {
  let linkIssue: IssueDetails;
  try {
    linkIssue = toLinkIssue(input.issue);
  } catch {
    return { ok: false, error: "That Linear issue is not valid." };
  }
  if (typeof bridge.worktreeLinkIssue !== "function") {
    return { ok: false, error: "Issue linking is unavailable." };
  }
  try {
    const result = await bridge.worktreeLinkIssue({
      worktreeId: input.worktreeId,
      issue: linkIssue,
    });
    if (!result.ok) return { ok: false, error: result.error.message };
    if (
      result.result.worktreeId !== input.worktreeId ||
      result.result.identifier.toUpperCase() !== linkIssue.identifier ||
      result.result.provider !== "linear"
    ) {
      return { ok: false, error: "The link could not be verified." };
    }
    return { ok: true, link: result.result };
  } catch {
    return { ok: false, error: "Could not link the Linear issue." };
  }
}

export type LinearUnlinkOutcome =
  | { ok: true; removed: boolean }
  | { ok: false; error: string };

/** Detaches the Linear issue from a worktree via the durable API. */
export async function unlinkLinearIssueFromWorktree(
  bridge: ProjectRpcBridge,
  input: { worktreeId: string },
): Promise<LinearUnlinkOutcome> {
  if (typeof bridge.worktreeUnlinkIssue !== "function") {
    return { ok: false, error: "Issue unlinking is unavailable." };
  }
  try {
    const result = await bridge.worktreeUnlinkIssue({
      worktreeId: input.worktreeId,
      provider: "linear",
    });
    if (!result.ok) return { ok: false, error: result.error.message };
    if (
      result.result.worktreeId !== input.worktreeId ||
      result.result.provider !== "linear"
    ) {
      return { ok: false, error: "The unlink could not be verified." };
    }
    return { ok: true, removed: result.result.removed };
  } catch {
    return { ok: false, error: "Could not unlink the Linear issue." };
  }
}
