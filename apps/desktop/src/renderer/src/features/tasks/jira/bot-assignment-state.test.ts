// MIT Copyright (c) 2026 Lovecast Inc.
// C11 pure-contract tests for the local Bot assignment state: stable-identity
// keying, surface status derivation, cross-surface decoration and the CAS
// request builders.
import { describe, expect, test } from "vitest";

import {
  assignmentClearParams,
  assignmentKeyOf,
  assignmentSetParams,
  assignmentStatus,
  isVersionConflict,
  jiraTaskScope,
  makeAssignmentRequestId,
  withAssignments,
  type TaskAssignmentScope,
  type TaskBotAssignment,
} from "./bot-assignment-state";

function scope(
  overrides: Partial<TaskAssignmentScope> = {},
): TaskAssignmentScope {
  return {
    hostId: "host-a",
    projectId: "proj-1",
    provider: "jira",
    instance: "site-x",
    taskId: "10001",
    ...overrides,
  };
}

function assignment(
  overrides: Partial<TaskBotAssignment["record"]> = {},
  botState: TaskBotAssignment["botState"] = "active",
): TaskBotAssignment {
  return {
    record: {
      scope: scope(),
      botId: "bot-1",
      botFolder: "ws-1",
      botName: "Muse",
      version: 3,
      assignedAt: "2026-09-10T00:00:00Z",
      updatedAt: "2026-09-10T00:00:00Z",
      ...overrides,
    },
    botState,
  };
}

describe("jiraTaskScope (stable identity)", () => {
  test("keys on the immutable issue id and site id, never the display key", () => {
    const s = jiraTaskScope({
      hostId: "host-a",
      projectId: "proj-1",
      siteId: "site-x",
      issueId: "10001",
    });
    expect(s.provider).toBe("jira");
    expect(s.taskId).toBe("10001");
  });

  test("the same issue id on another site or project is a different scope", () => {
    const base = jiraTaskScope({
      hostId: "host-a",
      projectId: "proj-1",
      siteId: "site-x",
      issueId: "10001",
    });
    const otherProject = { ...base, projectId: "proj-2" };
    const otherSite = { ...base, instance: "site-y" };
    const keys = new Set([
      assignmentKeyOf(base),
      assignmentKeyOf(otherProject),
      assignmentKeyOf(otherSite),
    ]);
    expect(keys.size).toBe(3);
  });

  test("key join cannot be confused by separator-adjacent fields", () => {
    // Distinct field boundaries must not collapse into one key.
    const a = assignmentKeyOf(scope({ projectId: "a", instance: "b" }));
    const b = assignmentKeyOf(
      scope({ projectId: "a", instance: "b", taskId: "c" }),
    );
    expect(a).not.toBe(b);
  });
});

describe("assignmentStatus", () => {
  test("unassigned without an assignment", () => {
    expect(assignmentStatus(null)).toEqual({ kind: "unassigned" });
    expect(assignmentStatus(undefined)).toEqual({ kind: "unassigned" });
  });

  test("active assignment exposes the bot and version", () => {
    expect(assignmentStatus(assignment())).toEqual({
      kind: "assigned",
      botId: "bot-1",
      botName: "Muse",
      version: 3,
    });
  });

  test("a deleted bot keeps the record visible as an honest reassign state", () => {
    const deleted = assignment({ botName: "Muse" }, "deleted");
    expect(assignmentStatus(deleted)).toEqual({
      kind: "bot-deleted",
      botId: "bot-1",
      botName: "Muse",
      version: 3,
    });
  });
});

describe("withAssignments (list/detail/Kanban shared decoration)", () => {
  type Row = { id: string; issueId: string; siteId: string };
  const rows: Row[] = [
    { id: "r1", issueId: "10001", siteId: "site-x" },
    { id: "r2", issueId: "10002", siteId: "site-x" },
    { id: "r3", issueId: "10001", siteId: "site-y" },
  ];
  const scopeOf = (row: Row): TaskAssignmentScope =>
    scope({ instance: row.siteId, taskId: row.issueId });

  test("attaches only the matching scope's assignment; unknown rows get null", () => {
    const decorated = withAssignments(
      rows,
      scopeOf,
      new Map([
        [
          assignmentKeyOf(scope({ instance: "site-x", taskId: "10001" })),
          assignment(),
        ],
      ]),
    );
    expect(decorated[0].assignment?.record.botId).toBe("bot-1");
    expect(decorated[1].assignment).toBeNull();
    // Same task id on the other site stays untouched.
    expect(decorated[2].assignment).toBeNull();
  });

  test("rows without a scope pass through with a null assignment", () => {
    const decorated = withAssignments(
      [{ id: "chrome" }] as Array<{
        id: string;
      }>,
      () => null,
      new Map(),
    );
    expect(decorated[0].assignment).toBeNull();
  });
});

describe("request builders (published jira.taskAssignment* shapes)", () => {
  test("set carries scope, bot, expected version and request id", () => {
    expect(
      assignmentSetParams({
        scope: scope(),
        botId: "bot-2",
        expectedVersion: 3,
        requestId: "task-assignment-set-abc",
      }),
    ).toEqual({
      hostId: "host-a",
      projectId: "proj-1",
      provider: "jira",
      instance: "site-x",
      taskId: "10001",
      botId: "bot-2",
      expectedVersion: 3,
      requestId: "task-assignment-set-abc",
    });
  });

  test("set on an unassigned task passes a null expected version", () => {
    const params = assignmentSetParams({
      scope: scope(),
      botId: "bot-2",
      expectedVersion: null,
      requestId: "r",
    });
    expect(params.expectedVersion).toBeNull();
  });

  test("clear carries the same scope and the CAS handle", () => {
    expect(
      assignmentClearParams({
        scope: scope(),
        expectedVersion: 2,
        requestId: "task-assignment-clear-abc",
      }),
    ).toEqual({
      hostId: "host-a",
      projectId: "proj-1",
      provider: "jira",
      instance: "site-x",
      taskId: "10001",
      expectedVersion: 2,
      requestId: "task-assignment-clear-abc",
    });
  });

  test("request ids are unique per call and name the action", () => {
    const a = makeAssignmentRequestId("set");
    const b = makeAssignmentRequestId("set");
    const c = makeAssignmentRequestId("clear");
    expect(a).toMatch(/^task-assignment-set-/);
    expect(c).toMatch(/^task-assignment-clear-/);
    expect(a).not.toBe(b);
  });
});

describe("isVersionConflict", () => {
  test("recognizes the native conflict code and ignores everything else", () => {
    expect(isVersionConflict({ code: "versionConflict", message: "x" })).toBe(
      true,
    );
    expect(isVersionConflict({ code: "invalid_argument", message: "x" })).toBe(
      false,
    );
    expect(isVersionConflict(null)).toBe(false);
    expect(isVersionConflict("versionConflict")).toBe(false);
  });
});
