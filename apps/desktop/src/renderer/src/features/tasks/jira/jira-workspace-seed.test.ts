// R17-C: ports of the fork's workspace-name tests (src/shared/
// workspace-name.test.ts) narrowed to what the Jira seed path uses, plus
// the Jira seed hook expectations. The daemon port (start_issue.rs) runs
// the same cases so both sides agree on the strings.
import { describe, expect, it } from "vitest";
import {
  getJiraIssueWorkspaceSeed,
  getJiraLinkedWorkItemWorkspaceName,
  getLinkedWorkItemSuggestedName,
  slugifyForWorkspaceName,
} from "./jira-workspace-seed";

describe("slugifyForWorkspaceName", () => {
  it("keeps workspace seed slugs short, ascii-safe, and git-ref-safe", () => {
    expect(slugifyForWorkspaceName("../../Fix mobile Tasks 🚀")).toBe(
      "fix-mobile-tasks",
    );
    expect(slugifyForWorkspaceName("feature/add issue drawer")).toBe(
      "feature-add-issue-drawer",
    );
    expect(slugifyForWorkspaceName("a".repeat(80))).toBe("a".repeat(48));
  });

  it("removes apostrophes inside words instead of splitting them", () => {
    expect(slugifyForWorkspaceName("Can't enable browser notifications")).toBe(
      "cant-enable-browser-notifications",
    );
    expect(slugifyForWorkspaceName("Can’t enable browser notifications")).toBe(
      "cant-enable-browser-notifications",
    );
  });

  it("folds the full whitespace list into single hyphens", () => {
    expect(
      slugifyForWorkspaceName(["Fix", String.fromCharCode(160), "\nPasted\tWorkspace"].join("")),
    ).toBe("fix-pasted-workspace");
  });
});

describe("getLinkedWorkItemSuggestedName", () => {
  it("removes duplicated issue and PR number tokens from linked titles", () => {
    expect(
      getLinkedWorkItemSuggestedName({ title: "Issue #123: Fix mobile Tasks" }),
    ).toBe("fix-mobile-tasks");
    expect(
      getLinkedWorkItemSuggestedName({ title: "Add mobile drawer (#812)" }),
    ).toBe("add-mobile-drawer");
  });
});

describe("getJiraLinkedWorkItemWorkspaceName", () => {
  it("keeps the identifier and de-duplicated subject together", () => {
    expect(
      getJiraLinkedWorkItemWorkspaceName({
        key: "PROJ-7",
        title: "Fix flaky import",
      }),
    ).toEqual({
      displayName: "PROJ-7 Fix flaky import",
      seedName: "proj-7-fix-flaky-import",
    });
  });

  it("strips only one leading identifier prefix (fork-faithful)", () => {
    expect(
      getJiraLinkedWorkItemWorkspaceName({
        key: "PROJ-7",
        title: "PROJ-7 Fix flaky import",
      }),
    ).toEqual({
      displayName: "PROJ-7 PROJ-7 Fix flaky import",
      seedName: "proj-7-proj-7-fix-flaky-import",
    });
  });
});

describe("getJiraIssueWorkspaceSeed", () => {
  it("returns the seed slug for the issue", () => {
    expect(
      getJiraIssueWorkspaceSeed({ key: "drog-42", title: "Fix the flux capacitor" }),
    ).toBe("drog-42-fix-the-flux-capacitor");
  });

  it("keeps the key slug even when the summary slugifies away", () => {
    expect(getJiraIssueWorkspaceSeed({ key: "KEY-1", title: "日本語" })).toBe(
      "key-1",
    );
  });
});
