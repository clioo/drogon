// MIT Copyright (c) 2026 Lovecast Inc. C06: renderer-side storage for the
// Tasks page's Jira resume state and issue→session resume hints.
//
// Two different kinds of state, two different rules:
//
// 1. The fork's list resume state (jiraPreset + jiraQuery,
//    `use-task-page-resume-restoration.ts`) is view-steering UI state —
//    fork-faithfully persisted in localStorage under a `drogon:tasks-`
//    key, exactly like `issue-source-preference.ts`. Best-effort: losing
//    it never corrupts anything.
// 2. The stable issue→session resume hints are IN-MEMORY ONLY: the durable
//    link registry lives in the daemon (crates/drogon-core/src/jira/
//    session_links.rs) — a renderer-persistent link registry would fork
//    the truth. This module only caches, for the current renderer session,
//    which session a task last resumed, and provides the conservative
//    liveness classification shared by the issue workspace and the
//    session-links panel.

// --- 1. The fork's list resume state (localStorage, fork-faithful) --------

const RESUME_STATE_KEY = "drogon:tasks-jira-resume-state";

/** The fork's persisted Jira list state: the active preset and the last
 * applied JQL query, restored before the first list fetch. */
export type JiraTaskResumeState = {
  jiraPreset?: string;
  jiraQuery?: string;
};

/** Sync read for the list state's `useState` initializer; absent or corrupt
 * storage reads as `null` (the fork's first-open shape). */
export function readJiraTaskResumeState(
  storage: Pick<Storage, "getItem"> = localStorage,
): JiraTaskResumeState | null {
  try {
    const raw = storage.getItem(RESUME_STATE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const state: JiraTaskResumeState = {};
    const preset = (parsed as Record<string, unknown>).jiraPreset;
    const query = (parsed as Record<string, unknown>).jiraQuery;
    if (typeof preset === "string" && preset.length <= 64) state.jiraPreset = preset;
    if (typeof query === "string" && query.length <= 512) state.jiraQuery = query;
    return state.jiraPreset === undefined && state.jiraQuery === undefined ? null : state;
  } catch {
    return null;
  }
}

/** Best-effort persistence; a private-mode/quota write failure must not
 *  block the list itself. */
export function writeJiraTaskResumeState(
  state: JiraTaskResumeState,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  try {
    const payload: JiraTaskResumeState = {};
    if (state.jiraPreset !== undefined) payload.jiraPreset = state.jiraPreset;
    if (state.jiraQuery !== undefined) payload.jiraQuery = state.jiraQuery;
    if (payload.jiraPreset === undefined && payload.jiraQuery === undefined) return;
    storage.setItem(RESUME_STATE_KEY, JSON.stringify(payload));
  } catch {
    // View-steering state only; losing it never corrupts anything.
  }
}

// --- 2. Stable-link resume hints (in-memory, daemon owns the truth) -------

export type JiraSessionState = "live" | "unverifiable" | "exited" | "no-session";

export type JiraResumeHint = {
  linkKey: string;
  sessionId: string;
  workspaceId: string | null;
  decidedAt: string;
};

/** Module-level, renderer-lifetime cache — never persisted anywhere. */
const resumeHints = new Map<string, JiraResumeHint>();

/** Remember which session a task last resumed (current renderer session). */
export function rememberJiraResume(hint: {
  linkKey: string;
  sessionId: string;
  workspaceId: string | null;
}): JiraResumeHint {
  const full: JiraResumeHint = { ...hint, decidedAt: new Date().toISOString() };
  resumeHints.set(hint.linkKey, full);
  return full;
}

/** The cached resume hint, or null (including after a renderer reload — by
 * design: the daemon's link is re-read, never approximated from cache). */
export function peekJiraResume(linkKey: string): JiraResumeHint | null {
  return resumeHints.get(linkKey) ?? null;
}

export function clearJiraResume(linkKey: string): void {
  resumeHints.delete(linkKey);
}

/**
 * The daemon-verdict → actionable-state mapping, conservative exactly like
 * `resolve_session_state`: loss of contact (missing row, unknown verdict)
 * is `unverifiable`, never `exited`.
 */
export function classifyJiraSessionState(
  verdict: string | null | undefined,
): JiraSessionState {
  switch (verdict) {
    case "live":
      return "live";
    case "exited":
      return "exited";
    case "unverifiable":
      return "unverifiable";
    case null:
    case undefined:
      return "no-session";
    default:
      return "unverifiable";
  }
}
