// MIT Copyright (c) 2026 Lovecast Inc. The fork's setTaskResumeState
// ({ jiraPreset, jiraQuery }) rides a settings RPC there; Drogon has no
// such RPC, so this module persists the same two fields in localStorage —
// reopening the Tasks page restores the Jira preset/query exactly like the
// fork's resume restoration. Corrupt or foreign-shaped entries are ignored
// and storage failures never throw (same discipline as
// tasks-page-seed-storage).

export type JiraTaskResumeState = {
  jiraPreset: string;
  jiraQuery: string;
};

const STORAGE_KEY = "drogon:tasks-jira-resume:v1";

const PRESET_IDS = new Set(["assigned", "reported", "all", "done"]);

function isResumeStateLike(value: unknown): value is JiraTaskResumeState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Record<string, unknown>;
  return (
    typeof state.jiraPreset === "string" &&
    typeof state.jiraQuery === "string" &&
    PRESET_IDS.has(state.jiraPreset)
  );
}

/** The fork's resume-restoration read: last session's Jira preset + query. */
export function readJiraTaskResumeState(
  storage: Pick<Storage, "getItem"> = localStorage,
): JiraTaskResumeState | undefined {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return isResumeStateLike(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** The fork's setTaskResumeState write, scoped to the Jira fields. */
export function writeJiraTaskResumeState(
  state: JiraTaskResumeState,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // A lost resume state only costs the next open its restored query.
  }
}

/** Test seam: drops the persisted Jira resume state. */
export function clearJiraTaskResumeState(
  storage: Pick<Storage, "removeItem"> = localStorage,
): void {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear through.
  }
}
