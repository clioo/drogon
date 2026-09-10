// C09 Jira kanban identity: stable keys for issues and status lanes,
// composed through the C02 kanban host-identity primitives (the exact seam
// requested from the pinned C02 source checkpoint) so a Jira site plays the
// host role and the issue id the workspace-id role. Jira issue ids, keys
// AND status display names repeat across instances, so every selection,
// pending overlay, drag payload and DOM key uses these identities — never
// the raw issue key or status name.
//
// MIT Copyright (c) 2026 Lovecast Inc.

import {
  composeWorktreeHostIdentity,
  parseWorktreeHostIdentity,
} from "../../../kanban/host-identity";

/** Stable key for one issue on one site: `percentEncoded(siteId)|issueId`. */
export function composeJiraIssueIdentity(
  siteId: string | null | undefined,
  issueId: string,
): string {
  return composeWorktreeHostIdentity(siteId, issueId);
}

/** Inverse of `composeJiraIssueIdentity`; `null` for malformed input. */
export function parseJiraIssueIdentity(identity: string): {
  siteId: string | null;
  issueId: string;
} | null {
  const parsed = parseWorktreeHostIdentity(identity);
  if (!parsed) {
    return null;
  }
  return { siteId: parsed.host, issueId: parsed.worktreeId };
}

/** Stable key for one status column on one site: two instances both have a
 *  status *named* "In Progress" with different ids — distinct lanes. */
export function composeJiraLaneIdentity(
  siteId: string | null | undefined,
  statusId: string,
): string {
  return composeWorktreeHostIdentity(siteId, statusId);
}

/** Inverse of `composeJiraLaneIdentity`; `null` for malformed input. */
export function parseJiraLaneIdentity(identity: string): {
  siteId: string | null;
  statusId: string;
} | null {
  const parsed = parseWorktreeHostIdentity(identity);
  if (!parsed) {
    return null;
  }
  return { siteId: parsed.host, statusId: parsed.worktreeId };
}

/** The identity of a loaded issue row; the issue's own `siteId` field is
 *  the authority (the same structural rule C02 encodes for hosts). */
export function getJiraIssueIdentity(issue: {
  id: string;
  siteId?: string | null;
}): string {
  return composeJiraIssueIdentity(issue.siteId ?? null, issue.id);
}
