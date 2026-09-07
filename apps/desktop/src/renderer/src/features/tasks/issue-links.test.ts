import { describe, expect, test, vi } from "vitest";
import type { Result } from "../../../../shared/session-contract";
import {
  getWorktreeIssueNumber,
  setWorktreeIssueLinks,
} from "../shell/project-adapter";
import { refreshWorktreeIssueLinks } from "./issue-links";

describe("refreshWorktreeIssueLinks", () => {
  test("merges links across projects into the card store", async () => {
    setWorktreeIssueLinks([]);
    const bridge = {
      tasksLinks: async ({ projectId }: { projectId: string }) =>
        ({
          ok: true,
          result: {
            links:
              projectId === "p1"
                ? [
                    {
                      projectId: "p1",
                      issueNumber: 7,
                      worktreeId: "w1",
                      branch: "issue-7-x",
                      createdAt: "2026-09-06T12:00:00Z",
                    },
                  ]
                : [],
          },
        }) as Result<{ links: never[] }>,
    };
    await refreshWorktreeIssueLinks(
      bridge as never,
      ["p1", "p2"],
    );
    expect(getWorktreeIssueNumber("w1")).toBe(7);
    expect(getWorktreeIssueNumber("missing")).toBeNull();
  });

  test("keeps prior badges when a project fails", async () => {
    setWorktreeIssueLinks([{ worktreeId: "w1", issueNumber: 7 }]);
    const bridge = {
      tasksLinks: vi.fn(async () => ({
        ok: false,
        error: { code: "gh_unavailable", message: "no gh", retryable: false },
      })),
    };
    await refreshWorktreeIssueLinks(bridge as never, ["p1"]);
    expect(getWorktreeIssueNumber("w1")).toBe(7);
    setWorktreeIssueLinks([]);
  });
});
