// MIT Copyright (c) 2026 Lovecast Inc. Adapted from Orca's persisted
// per-repo `issueSourcePreference` (src/shared/repo-types.ts plus the
// store's setIssueSourcePreference): the fork keeps it in its persisted
// store; this repo's renderer persistence seam is localStorage (same as
// workspace-selection.ts), keyed per project. Anything that is not
// exactly "upstream"/"origin" is treated as absent (`'auto'`), since this
// only steers which remote's repo the tasks RPCs read.

import type { IssueSourcePreference } from "./issue-source-selector";

const STORAGE_PREFIX = "drogon:tasks-issue-source:";

export function loadIssueSourcePreference(
  projectId: string,
  storage: Pick<Storage, "getItem"> = localStorage,
): IssueSourcePreference | undefined {
  try {
    const raw = storage.getItem(`${STORAGE_PREFIX}${projectId}`);
    return raw === "upstream" || raw === "origin" ? raw : undefined;
  } catch {
    return undefined;
  }
}

/** Best-effort persistence; a private-mode/quota write failure must not
 *  block the selection itself. */
export function saveIssueSourcePreference(
  projectId: string,
  preference: IssueSourcePreference,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  try {
    storage.setItem(`${STORAGE_PREFIX}${projectId}`, preference);
  } catch {
    // View-steering state only; losing it never corrupts anything.
  }
}
