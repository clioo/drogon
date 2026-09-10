// C09: composed identity round-trips and lane grouping. Identities come
// from the C02 kanban host-identity seam (site plays the host role), so
// colliding issue keys/ids and same-named statuses on two Jira instances
// stay distinct everywhere the board keys anything.
//
// MIT Copyright (c) 2026 Lovecast Inc.

import { describe, expect, it } from "vitest";
import type { JiraIssue } from "../../../../../../shared/jira-contract";
import {
  composeJiraIssueIdentity,
  composeJiraLaneIdentity,
  getJiraIssueIdentity,
  parseJiraIssueIdentity,
  parseJiraLaneIdentity,
} from "./jira-issue-identity";
import {
  buildJiraBoardCoverage,
  buildJiraKanbanLanes,
  describeJiraBoardCoverage,
  findJiraLaneByIdentity,
  findJiraLaneForIssue,
} from "./jira-kanban-columns";

function issue(overrides: {
  id: string;
  key: string;
  siteId?: string;
  siteName?: string;
  statusId: string;
  statusName: string;
  title?: string;
}): JiraIssue {
  return {
    id: overrides.id,
    key: overrides.key,
    siteId: overrides.siteId,
    siteName: overrides.siteName,
    title: overrides.title ?? "A issue",
    url: `https://jira.example.com/browse/${overrides.key}`,
    project: { id: "10000", key: "DROG", name: "Drogon" },
    issueType: { id: "1", name: "Bug" },
    status: {
      id: overrides.statusId,
      name: overrides.statusName,
      categoryKey: "indeterminate",
      categoryName: "In Progress",
    },
    labels: [],
    updatedAt: "2026-09-01T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
  };
}

describe("jira issue identity", () => {
  it("keeps the same issue id on two instances distinct", () => {
    const a = composeJiraIssueIdentity("site-a", "10001");
    const b = composeJiraIssueIdentity("site-b", "10001");
    expect(a).not.toBe(b);
    expect(parseJiraIssueIdentity(a)).toEqual({
      siteId: "site-a",
      issueId: "10001",
    });
    expect(parseJiraIssueIdentity(b)).toEqual({
      siteId: "site-b",
      issueId: "10001",
    });
  });

  it("keeps the same status id on two instances in distinct lanes", () => {
    const a = composeJiraLaneIdentity("site-a", "3");
    const b = composeJiraLaneIdentity("site-b", "3");
    expect(a).not.toBe(b);
    expect(parseJiraLaneIdentity(a)).toEqual({
      siteId: "site-a",
      statusId: "3",
    });
  });

  it("rejects malformed identities instead of guessing a site", () => {
    expect(parseJiraIssueIdentity("no-separator")).toBeNull();
    expect(parseJiraIssueIdentity("site-a|")).toBeNull();
  });

  it("reads the issue's own siteId field as the authority", () => {
    expect(getJiraIssueIdentity({ id: "10001", siteId: "site-a" })).toBe(
      composeJiraIssueIdentity("site-a", "10001"),
    );
    expect(getJiraIssueIdentity({ id: "10001" })).toBe(
      composeJiraIssueIdentity(null, "10001"),
    );
  });
});

describe("buildJiraKanbanLanes", () => {
  it("groups by (site, status id), never by status name", () => {
    const lanes = buildJiraKanbanLanes([
      issue({
        id: "1",
        key: "DROG-1",
        siteId: "site-a",
        statusId: "3",
        statusName: "In Progress",
      }),
      issue({
        id: "2",
        key: "DROG-1",
        siteId: "site-b",
        statusId: "3",
        statusName: "In Progress",
      }),
      issue({
        id: "3",
        key: "DROG-2",
        siteId: "site-a",
        statusId: "3",
        statusName: "In Progress",
      }),
    ]);
    expect(lanes).toHaveLength(2);
    expect(lanes[0]!.siteId).toBe("site-a");
    expect(lanes[0]!.issues.map((row) => row.id)).toEqual(["1", "3"]);
    expect(lanes[1]!.siteId).toBe("site-b");
  });

  it("splits same-named statuses with different ids on one site", () => {
    const lanes = buildJiraKanbanLanes([
      issue({
        id: "1",
        key: "DROG-1",
        siteId: "site-a",
        statusId: "3",
        statusName: "In Progress",
      }),
      issue({
        id: "2",
        key: "DROG-2",
        siteId: "site-a",
        statusId: "30001",
        statusName: "In Progress",
      }),
    ]);
    expect(lanes).toHaveLength(2);
    expect(lanes.map((lane) => lane.statusId)).toEqual(["3", "30001"]);
  });

  it("finds lanes by composed identity only", () => {
    const lanes = buildJiraKanbanLanes([
      issue({
        id: "1",
        key: "DROG-1",
        siteId: "site-a",
        statusId: "3",
        statusName: "In Progress",
      }),
    ]);
    const laneIdentity = composeJiraLaneIdentity("site-a", "3");
    expect(findJiraLaneByIdentity(lanes, laneIdentity)?.statusId).toBe("3");
    expect(
      findJiraLaneByIdentity(lanes, composeJiraLaneIdentity("site-b", "3")),
    ).toBeNull();
    expect(
      findJiraLaneForIssue(
        lanes,
        getJiraIssueIdentity({ id: "1", siteId: "site-a" }),
      ),
    ).not.toBeNull();
    expect(
      findJiraLaneForIssue(
        lanes,
        getJiraIssueIdentity({ id: "1", siteId: "site-b" }),
      ),
    ).toBeNull();
  });
});

describe("board coverage labeling", () => {
  it("labels a partial page against the server total", () => {
    const coverage = buildJiraBoardCoverage({ loadedCount: 50, total: 120 });
    expect(coverage.complete).toBe(false);
    expect(describeJiraBoardCoverage(coverage)).toBe(
      "Showing 50 of 120 issues.",
    );
  });

  it("labels an unfinished page without a total as possibly incomplete", () => {
    const coverage = buildJiraBoardCoverage({ loadedCount: 50, isLast: false });
    expect(coverage.complete).toBe(false);
    expect(describeJiraBoardCoverage(coverage)).toContain("more may exist");
  });

  it("labels a complete set as complete", () => {
    expect(
      describeJiraBoardCoverage(
        buildJiraBoardCoverage({ loadedCount: 12, isLast: true }),
      ),
    ).toBe("Showing all 12 issues.");
    expect(
      describeJiraBoardCoverage(
        buildJiraBoardCoverage({ loadedCount: 120, total: 120 }),
      ),
    ).toBe("Showing all 120 issues.");
  });

  it("labels the empty board honestly", () => {
    expect(
      describeJiraBoardCoverage(buildJiraBoardCoverage({ loadedCount: 0 })),
    ).toBe("No issues loaded.");
  });
});
