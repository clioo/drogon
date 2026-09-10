// C09: request validation, response classification and reconciliation for
// Jira board moves — the renderer's operative semantics (mirrors
// crates/drogon-core/src/jira/transitions.rs, asserted there too). Pure
// in-process computation: no bridge, no DOM, no timers.
//
// MIT Copyright (c) 2026 Lovecast Inc.

import { describe, expect, it } from "vitest";
import type {
  JiraIssue,
  JiraTransition,
} from "../../../../../../shared/jira-contract";
import {
  classifyJiraMoveResult,
  describeJiraBlockedReason,
  planJiraMove,
  reconcileJiraMove,
  type JiraPendingMove,
} from "./jira-kanban-moves";

const openStatus = {
  id: "1",
  name: "Open",
  categoryKey: "new",
  categoryName: "To Do",
};
const inProgressStatus = {
  id: "3",
  name: "In Progress",
  categoryKey: "indeterminate",
  categoryName: "In Progress",
};
const doneStatus = {
  id: "10002",
  name: "Done",
  categoryKey: "done",
  categoryName: "Done",
};

function issue(overrides: Partial<JiraIssue> = {}): JiraIssue {
  return {
    id: "10001",
    key: "DROG-1",
    siteId: "site-a",
    siteName: "Site A",
    title: "Fix the thing",
    url: "https://jira.example.com/browse/DROG-1",
    project: { id: "10000", key: "DROG", name: "Drogon" },
    issueType: { id: "1", name: "Bug" },
    status: openStatus,
    labels: [],
    updatedAt: "2026-09-01T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function transition(
  id: string,
  name: string,
  to: typeof doneStatus,
): JiraTransition {
  return { id, name, to };
}

// Two statuses share the display name "In Progress" on one instance's
// workflow (different projects); two transitions share the name "Done".
const workflow: JiraTransition[] = [
  transition("11", "Go to In Progress", inProgressStatus),
  transition("21", "Start Hack", { ...inProgressStatus, id: "30001" }),
  transition("31", "Done", doneStatus),
  transition("41", "Done", doneStatus),
];

describe("planJiraMove", () => {
  it("resolves a unique lane drop to the exact offered transition", () => {
    const plan = planJiraMove({
      issue: issue(),
      availableTransitions: workflow,
      target: { kind: "status", statusId: "3" },
    });
    expect(plan).toEqual({
      ok: true,
      plan: {
        transitionId: "11",
        transitionName: "Go to In Progress",
        targetStatus: inProgressStatus,
      },
    });
  });

  it("refuses an ambiguous lane drop instead of guessing a transition", () => {
    const plan = planJiraMove({
      issue: issue(),
      availableTransitions: workflow,
      target: { kind: "status", statusId: "10002" },
    });
    expect(plan).toEqual({
      ok: false,
      reason: {
        kind: "ambiguous-status",
        statusId: "10002",
        transitionIds: ["31", "41"],
      },
    });
  });

  it("refuses a status no offered transition reaches", () => {
    const plan = planJiraMove({
      issue: issue(),
      availableTransitions: workflow,
      target: { kind: "status", statusId: "99999" },
    });
    expect(plan).toEqual({
      ok: false,
      reason: { kind: "status-not-reachable", statusId: "99999" },
    });
  });

  it("accepts an exact transition id and never a display name", () => {
    // Both "Done" transitions share the target status; the id is the handle.
    const byId = planJiraMove({
      issue: issue(),
      availableTransitions: workflow,
      target: { kind: "transition", transitionId: "41" },
    });
    expect(byId).toEqual({
      ok: true,
      plan: {
        transitionId: "41",
        transitionName: "Done",
        targetStatus: doneStatus,
      },
    });
    // "Done" names two transitions; only ids are handles.
    const byName = planJiraMove({
      issue: issue(),
      availableTransitions: workflow,
      target: { kind: "transition", transitionId: "Done" } as never,
    });
    expect(byName.ok).toBe(false);
  });

  it("refuses a transition id the card's own site does not offer", () => {
    const plan = planJiraMove({
      issue: issue(),
      availableTransitions: workflow.slice(0, 2),
      target: { kind: "transition", transitionId: "31" },
    });
    expect(plan).toEqual({
      ok: false,
      reason: { kind: "transition-not-offered", transitionId: "31" },
    });
  });

  it("refuses a move onto the current status and an empty offer set", () => {
    expect(
      planJiraMove({
        issue: issue({ status: inProgressStatus }),
        availableTransitions: workflow,
        target: { kind: "status", statusId: "3" },
      }),
    ).toEqual({
      ok: false,
      reason: { kind: "already-in-status", statusId: "3" },
    });
    expect(
      planJiraMove({
        issue: issue(),
        availableTransitions: [],
        target: { kind: "transition", transitionId: "11" },
      }),
    ).toEqual({ ok: false, reason: { kind: "no-transitions" } });
  });
});

describe("classifyJiraMoveResult", () => {
  it("treats an ok envelope as applied", () => {
    expect(classifyJiraMoveResult({ ok: true, result: { ok: true } })).toEqual({
      kind: "applied",
    });
  });

  it("treats a business failure envelope as a definite rejection", () => {
    expect(
      classifyJiraMoveResult({
        ok: true,
        result: { ok: false, error: "Error 403: no permission" },
      }),
    ).toEqual({ kind: "rejected", reason: "Error 403: no permission" });
  });

  it("treats only jira_unreachable as uncertain (timeout after possible application)", () => {
    expect(
      classifyJiraMoveResult({
        ok: false,
        error: {
          code: "jira_unreachable",
          message: "Jira request timed out.",
          retryable: true,
        },
      }),
    ).toEqual({ kind: "uncertain" });
    // Any other answered error code is a definite refusal.
    expect(
      classifyJiraMoveResult({
        ok: false,
        error: {
          code: "jira_auth_required",
          message: "Error 401: bad token",
          retryable: false,
        },
      }).kind,
    ).toBe("rejected");
  });
});

describe("reconcileJiraMove", () => {
  const pending: JiraPendingMove = {
    identity: "site-a|10001",
    transitionId: "11",
    transitionName: "Go to In Progress",
    targetStatusId: "3",
    originStatusId: "1",
    state: "awaiting-reconciliation",
  };

  it("confirms only when the fresh server read shows the target status", () => {
    const fresh = issue({ status: inProgressStatus });
    expect(reconcileJiraMove(pending, fresh)).toEqual({
      kind: "applied",
      issue: fresh,
    });
  });

  it("reports not-applied when the server still shows the origin status", () => {
    const fresh = issue();
    expect(reconcileJiraMove(pending, fresh)).toEqual({
      kind: "not-applied",
      issue: fresh,
    });
  });

  it("adopts a concurrent remote mutation as superseded, never hides it", () => {
    const fresh = issue({ status: doneStatus });
    expect(reconcileJiraMove(pending, fresh)).toEqual({
      kind: "superseded",
      issue: fresh,
    });
  });
});

describe("describeJiraBlockedReason", () => {
  it("names the real transitions for an ambiguous drop", () => {
    expect(
      describeJiraBlockedReason(
        {
          kind: "ambiguous-status",
          statusId: "10002",
          transitionIds: ["31", "41"],
        },
        workflow,
      ),
    ).toContain("Done, Done");
  });

  it("explains required fields and unreachable statuses", () => {
    expect(
      describeJiraBlockedReason(
        { kind: "required-fields", transitionId: "31", fields: ["resolution"] },
        workflow,
      ),
    ).toBe("This transition needs fields first: resolution.");
    expect(
      describeJiraBlockedReason(
        { kind: "status-not-reachable", statusId: "99999" },
        workflow,
      ),
    ).toContain("no transition to that status");
  });
});
