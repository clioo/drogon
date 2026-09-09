// MIT Copyright (c) 2026 Lovecast Inc. Ported-logic tests (R17-B): the
// fork's Jira sort comparator (jira-issue-sorter.ts) and the status
// grouping (jira-issue-list.tsx) keep their semantics over this repo's
// contract shapes.
import { describe, expect, test } from "vitest";
import {
  getJiraPriorityWeight,
  sortJiraIssues,
  type JiraPrioritiesBySite,
} from "./jira-issue-sorter";
import { groupJiraIssuesByStatus } from "./jira-issue-list";
import type { JiraIssue } from "../../../../../shared/jira-contract";

function issue(overrides: Partial<JiraIssue> = {}): JiraIssue {
  return {
    id: "1",
    key: "DROG-1",
    title: "One",
    url: "https://example.atlassian.net/browse/DROG-1",
    project: { id: "10000", key: "DROG", name: "Drogon" },
    issueType: { id: "10001", name: "Task" },
    status: { id: "1", name: "Backlog", categoryKey: "new", categoryName: "To Do" },
    labels: [],
    updatedAt: "2026-09-01T12:00:00Z",
    createdAt: "2026-08-01T09:00:00Z",
    ...overrides,
  };
}

describe("sortJiraIssues (fork jira-issue-sorter.ts)", () => {
  test("key sort compares numerically (DROG-2 before DROG-10)", () => {
    const sorted = sortJiraIssues(
      [issue({ key: "DROG-10" }), issue({ key: "DROG-2" })],
      "key",
      "asc",
    );
    expect(sorted.map((i) => i.key)).toEqual(["DROG-2", "DROG-10"]);
  });

  test("updated sort honors the direction", () => {
    const older = issue({ key: "DROG-1", updatedAt: "2026-09-01T12:00:00Z" });
    const newer = issue({ key: "DROG-2", updatedAt: "2026-09-05T12:00:00Z" });
    expect(sortJiraIssues([older, newer], "updated", "desc")[0].key).toBe("DROG-2");
    expect(sortJiraIssues([older, newer], "updated", "asc")[0].key).toBe("DROG-1");
  });

  test("priority sort weights named tiers and puts unprioritized last", () => {
    const sorted = sortJiraIssues(
      [
        issue({ key: "DROG-1", priority: { id: "3", name: "Low" } }),
        issue({ key: "DROG-2" }),
        issue({ key: "DROG-3", priority: { id: "1", name: "Highest" } }),
      ],
      "priority",
      "desc",
    );
    expect(sorted.map((i) => i.key)).toEqual(["DROG-3", "DROG-1", "DROG-2"]);
  });

  test("per-site priority lists normalize across schemes", () => {
    const bySite: JiraPrioritiesBySite = new Map([
      [
        "site-1",
        [
          { id: "p1", name: "Blocker" },
          { id: "p2", name: "Major" },
          { id: "p3", name: "Minor" },
        ],
      ],
    ]);
    // Major sits mid-scheme on site-1, so it outranks a named Low while
    // remaining below Blocker.
    expect(getJiraPriorityWeight("Major", "p2", bySite.get("site-1"))).toBeGreaterThan(
      getJiraPriorityWeight("Low", undefined),
    );
    expect(getJiraPriorityWeight("Blocker", "p1", bySite.get("site-1"))).toBeGreaterThan(
      getJiraPriorityWeight("Major", "p2", bySite.get("site-1")),
    );
  });

  test("status column is a stable no-op (the section grouping orders)", () => {
    const a = issue({ key: "DROG-1" });
    const b = issue({ key: "DROG-2" });
    expect(sortJiraIssues([a, b], "status", "asc").map((i) => i.key)).toEqual([
      "DROG-1",
      "DROG-2",
    ]);
  });
});

describe("groupJiraIssuesByStatus (fork task-page-jira-issue-list.tsx)", () => {
  test("groups by status name and falls back to alphabetical without an order", () => {
    const sections = groupJiraIssuesByStatus(
      [
        issue({ key: "DROG-1", status: { id: "2", name: "In Progress", categoryKey: "indeterminate", categoryName: "In Progress" } }),
        issue({ key: "DROG-2", status: { id: "1", name: "Backlog", categoryKey: "new", categoryName: "To Do" } }),
        issue({ key: "DROG-3", status: { id: "2", name: "In Progress", categoryKey: "indeterminate", categoryName: "In Progress" } }),
      ],
      null,
    );
    expect(sections.map((section) => section.label)).toEqual(["Backlog", "In Progress"]);
    expect(sections[1].issues.map((i) => i.key)).toEqual(["DROG-1", "DROG-3"]);
  });

  test("a known column order ranks sections before the alphabetical fallback", () => {
    const sections = groupJiraIssuesByStatus(
      [
        issue({ key: "DROG-1", status: { id: "done-1", name: "Done", categoryKey: "done", categoryName: "Done" } }),
        issue({ key: "DROG-2", status: { id: "todo-1", name: "To Do", categoryKey: "new", categoryName: "To Do" } }),
      ],
      { statusIdsByColumn: [["todo-1"], ["done-1"]] },
    );
    expect(sections.map((section) => section.label)).toEqual(["To Do", "Done"]);
    // Descending flips the section order like the fork's status sort.
    const reversed = groupJiraIssuesByStatus(
      [
        issue({ key: "DROG-1", status: { id: "done-1", name: "Done", categoryKey: "done", categoryName: "Done" } }),
        issue({ key: "DROG-2", status: { id: "todo-1", name: "To Do", categoryKey: "new", categoryName: "To Do" } }),
      ],
      { statusIdsByColumn: [["todo-1"], ["done-1"]] },
      "desc",
    );
    expect(reversed.map((section) => section.label)).toEqual(["Done", "To Do"]);
  });
});
