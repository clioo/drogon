// MIT Copyright (c) 2026 Lovecast Inc.
// C11 local Bot assignment — renderer-side contract and pure state logic for
// the one local Bot assignment a task can carry. The assignment is keyed by
// the stable task identity (provider + instance + immutable task id — for
// Jira the `getSiteId` site id and the issue's immutable `id`, never the
// display key) fenced to one Drogon host and project, and stored only in the
// daemon database; nothing here talks to Jira and an assignment never writes
// the remote Jira assignee nor starts inference. Open/Run stay separate
// explicit actions owned by the conversation/session layer.
//
// Transport status (C11 source checkpoint): the native RPC shapes below are
// the published contract for the held integration seams —
// `jira.taskAssignmentGet` / `jira.taskAssignmentSet` / `jira.taskAssignmentClear`
// / `jira.taskAssignmentHistory` on the daemon, wired through preload/shared
// by the integration writer. Components take their async callbacks as props,
// so this module stays transport-free and testable.

export type TaskAssignmentProvider = "jira" | "github";

/** Scope of one local assignment; mirrors native `AssignmentScope`. */
export type TaskAssignmentScope = {
  hostId: string;
  projectId: string;
  provider: TaskAssignmentProvider;
  /** Jira: the stable per-(site, account) site id. GitHub: `owner/repo`. */
  instance: string;
  /** The provider's immutable task id (Jira issue id, not the display key). */
  taskId: string;
};

/** Mirrors native `BotState`. */
export type TaskBotAssignmentBotState = "active" | "deleted";

/** Mirrors native `AssignmentRecord`. */
export type TaskBotAssignmentRecord = {
  scope: TaskAssignmentScope;
  botId: string;
  /** Bot storage folder at assignment time — display provenance. */
  botFolder: string;
  /** Assignment-time name snapshot; the read overlays the live name while
   * the Bot exists and keeps this one when it is deleted. */
  botName: string;
  /** CAS handle: starts at 1, +1 per applied mutation. */
  version: number;
  assignedAt: string;
  updatedAt: string;
};

/** Mirrors native `ResolvedAssignment`; `null` means unassigned. */
export type TaskBotAssignment = {
  record: TaskBotAssignmentRecord;
  botState: TaskBotAssignmentBotState;
};

/** One selectable Bot row for the picker (from `botSnapshot`'s panel list). */
export type BotAssignmentOption = {
  id: string;
  name: string;
  /** Honest disabled row: the Bot cannot take the task right now. */
  disabled?: boolean;
  disabledReason?: string;
};

// --- stable identity ---------------------------------------------------------

/**
 * The Jira adapter to the stable identity: instance is the site id, taskId is
 * the issue's immutable `id`. Deliberately NOT the display key (`DROG-1`
 * changes when an issue moves projects; the id never does) and never the
 * title — the uniqueness contract.
 */
export function jiraTaskScope(input: {
  hostId: string;
  projectId: string;
  siteId: string;
  issueId: string;
}): TaskAssignmentScope {
  return {
    hostId: input.hostId,
    projectId: input.projectId,
    provider: "jira",
    instance: input.siteId,
    taskId: input.issueId,
  };
}

/** Canonical map key so list/detail/Kanban decorate from one store. */
export function assignmentKeyOf(scope: TaskAssignmentScope): string {
  return [
    scope.hostId,
    scope.projectId,
    scope.provider,
    scope.instance,
    scope.taskId,
  ].join("\u241f"); // ␟ unit-separator-style join; fields cannot contain it
}

// --- derived surface state ---------------------------------------------------

/** What a surface (list row, detail header, Kanban card) renders. */
export type TaskBotAssignmentStatus =
  | { kind: "unassigned" }
  | { kind: "assigned"; botId: string; botName: string; version: number }
  /** Honest disabled/reassign state: the assigned Bot no longer exists.
   * History is preserved and the row stays until someone reassigns. */
  | { kind: "bot-deleted"; botId: string; botName: string; version: number };

export function assignmentStatus(
  assignment: TaskBotAssignment | null | undefined,
): TaskBotAssignmentStatus {
  if (!assignment) {
    return { kind: "unassigned" };
  }
  const { record, botState } = assignment;
  return botState === "deleted"
    ? {
        kind: "bot-deleted",
        botId: record.botId,
        botName: record.botName,
        version: record.version,
      }
    : {
        kind: "assigned",
        botId: record.botId,
        botName: record.botName,
        version: record.version,
      };
}

/**
 * Decorate a page of rows with their assignments from one map — the shared
 * read path for the Tasks list, the detail header and the C09 Kanban cards,
 * so all surfaces show the same assignment. Rows without a scope (e.g.
 * filter chrome) pass through untouched.
 */
export function withAssignments<Row>(
  rows: readonly Row[],
  scopeOf: (row: Row) => TaskAssignmentScope | null,
  assignments: ReadonlyMap<string, TaskBotAssignment>,
): Array<Row & { assignment: TaskBotAssignment | null }> {
  return rows.map((row) => {
    const scope = scopeOf(row);
    const assignment = scope
      ? (assignments.get(assignmentKeyOf(scope)) ?? null)
      : null;
    return { ...row, assignment };
  });
}

// --- request builders ----------------------------------------------------------

/**
 * `jira.taskAssignmentSet` params. `expectedVersion` is the CAS handle from
 * the last read (`null` asserts the task is unassigned); a stale writer is
 * rejected with `versionConflict` instead of silently overwriting.
 */
export function assignmentSetParams(input: {
  scope: TaskAssignmentScope;
  botId: string;
  expectedVersion: number | null;
  requestId: string;
}): Record<string, unknown> {
  return {
    hostId: input.scope.hostId,
    projectId: input.scope.projectId,
    provider: input.scope.provider,
    instance: input.scope.instance,
    taskId: input.scope.taskId,
    botId: input.botId,
    expectedVersion: input.expectedVersion,
    requestId: input.requestId,
  };
}

/** `jira.taskAssignmentClear` params (same CAS contract). */
export function assignmentClearParams(input: {
  scope: TaskAssignmentScope;
  expectedVersion: number | null;
  requestId: string;
}): Record<string, unknown> {
  return {
    hostId: input.scope.hostId,
    projectId: input.scope.projectId,
    provider: input.scope.provider,
    instance: input.scope.instance,
    taskId: input.scope.taskId,
    expectedVersion: input.expectedVersion,
    requestId: input.requestId,
  };
}

/** Caller-chosen envelope id so a retried request stays dedupe-safe. */
export function makeAssignmentRequestId(action: "set" | "clear"): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;
  return `task-assignment-${action}-${random}`;
}

/**
 * The losing-writer UX: after `versionConflict` the caller re-reads and
 * retries with the fresh version — never a blind overwrite.
 */
export function isVersionConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "versionConflict"
  );
}
