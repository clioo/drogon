/* The composer's source field reads the daemon's own pulls fields: a work
   item must carry the pull's lifecycle and its rolled-up check summary (and
   an issue row must carry neither, so the row cannot claim a verdict the
   listing never reported). */
import { describe, expect, test } from "vitest";
import {
  issueToWorkItem,
  pullToWorkItem,
} from "./smart-workspace-source-model";

describe("the field's GitHub work item", () => {
  test("a pulls row carries the state and the rolled-up checks; an issue row carries neither", () => {
    const pull = pullToWorkItem({
      number: 42,
      title: "Fix login",
      state: "merged",
      labels: [],
      assignees: [],
      updatedAt: "2026-09-20T00:00:00Z",
      url: "https://github.com/clioo/drogon/pull/42",
      isDraft: false,
      checks: {
        state: "failure",
        total: 3,
        passed: 1,
        failed: 2,
        pending: 0,
        neutral: 0,
      },
    });
    expect(pull).toMatchObject({
      type: "pr",
      number: 42,
      state: "merged",
      checks: { state: "failure", total: 3, failed: 2 },
    });

    const issue = issueToWorkItem({
      number: 7,
      title: "Bug",
      state: "closed",
      labels: [],
      assignees: [],
      updatedAt: "2026-09-20T00:00:00Z",
      url: "https://github.com/clioo/drogon/issues/7",
      body: null,
    });
    // Absent, not undefined-valued: the row reads presence to decide whether
    // it has a verdict to draw at all.
    expect("state" in issue).toBe(false);
    expect("checks" in issue).toBe(false);
  });
});
