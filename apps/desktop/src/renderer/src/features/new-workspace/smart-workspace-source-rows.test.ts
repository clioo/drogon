import { describe, expect, test } from "vitest";
import {
  buildSmartWorkspaceSourceRows,
  getVisibleBranchResults,
  getVisibleHeldProviderResults,
  shouldHoldSourceResultsForQuery,
} from "./smart-workspace-source-rows";
import { parseGitHubIssueOrPRLink, parseGitHubIssueOrPRNumber } from "./smart-workspace-github-links";
import { slugifyForWorkspaceName } from "./smart-workspace-composer";

const branch = (refName: string) => ({
  refName,
  localBranchName: refName.replace(/^origin\//, ""),
});

const issue = (number: number, title: string) => ({
  type: "issue" as const,
  number,
  title,
  url: `https://github.com/clioo/drogon/issues/${number}`,
  updatedAt: "2026-09-09T00:00:00Z",
});

describe("smart workspace source rows (the fork's row model)", () => {
  test("smart mode pins a Use-as-workspace-name row ahead of sources", () => {
    const rows = buildSmartWorkspaceSourceRows({
      branches: [branch("origin/main")],
      githubItems: [issue(7, "Fix login")],
      mode: "smart",
      resultLimit: 12,
      value: "fix",
    });
    expect(rows[0]).toEqual({ kind: "use-name", value: "use-name", name: "fix" });
    expect(rows.slice(1)).toContainEqual({
      kind: "github",
      value: "github-issue-7",
      item: issue(7, "Fix login"),
    });
  });

  test("text mode renders no source rows at all", () => {
    // The fork: the typed-text row belongs to smart mode only; the plain
    // Name tab keeps the field source-free (its popover never opens).
    const rows = buildSmartWorkspaceSourceRows({
      branches: [branch("main")],
      githubItems: [issue(7, "Fix login")],
      mode: "text",
      resultLimit: 12,
      value: "whatever",
    });
    expect(rows).toEqual([]);
  });

  test("branches mode offers Create new branch when the typed name misses", () => {
    const rows = buildSmartWorkspaceSourceRows({
      branches: [branch("main")],
      githubItems: [],
      mode: "branches",
      resultLimit: 12,
      value: "feature/new-thing",
    });
    expect(rows[0]).toEqual({
      kind: "create-branch",
      value: "create-branch",
      name: "feature/new-thing",
    });
    expect(rows.some((row) => row.kind === "branch")).toBe(true);
  });

  test("branches mode skips Create new branch on an exact match", () => {
    const rows = buildSmartWorkspaceSourceRows({
      branches: [branch("main")],
      githubItems: [],
      mode: "branches",
      resultLimit: 12,
      value: "main",
    });
    expect(rows.some((row) => row.kind === "create-branch")).toBe(false);
  });

  test("a resolved GitHub URL collapses results to exactly that item", () => {
    const link = parseGitHubIssueOrPRLink(
      "https://github.com/clioo/drogon/pull/42",
    );
    expect(link).toEqual({
      slug: { owner: "clioo", repo: "drogon", host: "github.com" },
      type: "pr",
      number: 42,
    });
    const rows = buildSmartWorkspaceSourceRows({
      branches: [branch("main")],
      githubItems: [issue(7, "Other"), { ...issue(42, "The PR"), type: "pr" }],
      githubUrlIntent: link,
      mode: "smart",
      resultLimit: 12,
      value: "https://github.com/clioo/drogon/pull/42",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "github", item: { number: 42 } });
  });

  test("held provider results drop as soon as the field is cleared", () => {
    const items = [issue(7, "Fix login")];
    expect(
      getVisibleHeldProviderResults({ items, value: "", debouncedQuery: "fix" }),
    ).toEqual([]);
    expect(
      getVisibleHeldProviderResults({ items, value: "fix", debouncedQuery: "" }),
    ).toEqual(items);
  });

  test("branch results hold while the query extends by a few keystrokes", () => {
    expect(
      shouldHoldSourceResultsForQuery({ resultQuery: "f", value: "fix-a" }),
    ).toBe(true);
    expect(
      shouldHoldSourceResultsForQuery({ resultQuery: "f", value: "completely-different" }),
    ).toBe(false);
    expect(
      getVisibleBranchResults({
        branches: [branch("origin/main")],
        mode: "smart",
        resultQuery: "",
        selectedRepoId: "git:1",
        value: "",
      }),
    ).toHaveLength(1);
    expect(
      getVisibleBranchResults({
        branches: [branch("origin/main")],
        mode: "smart",
        resultQuery: "ma",
        selectedRepoId: "git:1",
        value: "",
      }),
    ).toEqual([]);
  });
});

describe("smart field input parsing (the fork's github-links subset)", () => {
  test("parses #N, bare numbers and URLs; rejects non-GitHub input", () => {
    expect(parseGitHubIssueOrPRNumber("#123")).toBe(123);
    expect(parseGitHubIssueOrPRNumber("123")).toBe(123);
    expect(parseGitHubIssueOrPRNumber("abc")).toBeNull();
    expect(
      parseGitHubIssueOrPRLink("https://github.com/o/r/issues/9")?.number,
    ).toBe(9);
    expect(parseGitHubIssueOrPRLink("https://gitlab.com/o/r/-/issues/9")).toBeNull();
  });

  test("slugifyForWorkspaceName produces branch-safe seeds", () => {
    expect(slugifyForWorkspaceName("Fix: the Login Flow!")).toBe("fix-the-login-flow");
    expect(slugifyForWorkspaceName("a/b\\c")).toBe("a-b-c");
    expect(slugifyForWorkspaceName("it's alive")).toBe("its-alive");
    expect(slugifyForWorkspaceName("..danger..")).toBe("danger");
    expect(slugifyForWorkspaceName("x".repeat(100))).toHaveLength(48);
  });
});
