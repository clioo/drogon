/* The composer's GitHub source rows state what the PR they offer is: the
   state word, the icon tone, the draft glyph and the check verdict. These
   assertions pin the presentation to the daemon's own pulls fields, so a row
   can never claim a state the listing did not report. */
import { describe, expect, test } from "vitest";
import type { ProviderCheckSummary } from "../../../../shared/tasks-contract";
import {
  getSmartWorkspaceChecksPresentation,
  getSmartWorkspaceGithubRowLabel,
  getSmartWorkspaceOpenLinkLabel,
  getSmartWorkspacePrIconTone,
  getSmartWorkspacePrStateLabel,
  getSmartWorkspacePrStateTone,
  isSmartWorkspaceDraftPr,
} from "./smart-workspace-source-row-status";

const checks = (
  state: ProviderCheckSummary["state"],
  overrides: Partial<ProviderCheckSummary> = {},
): ProviderCheckSummary => ({
  state,
  total: 4,
  passed: 4,
  failed: 0,
  pending: 0,
  neutral: 0,
  ...overrides,
});

const pr = (state: "open" | "draft" | "merged" | "closed", summary?: ProviderCheckSummary) => ({
  type: "pr" as const,
  number: 123,
  title: "Fix login",
  state,
  checks: summary,
});

describe("composer source rows: PR state presentation", () => {
  test("each state keeps the Tasks list's own PR tone", () => {
    expect(getSmartWorkspacePrStateTone("merged")).toContain("purple");
    expect(getSmartWorkspacePrStateTone("open")).toContain("emerald");
    expect(getSmartWorkspacePrStateTone("closed")).toContain("rose");
    expect(getSmartWorkspacePrStateTone("draft")).toContain("text-muted-foreground");
    // A row whose listing carried no state is the ordinary open PR.
    expect(getSmartWorkspacePrStateTone(undefined)).toContain("emerald");
    expect(getSmartWorkspacePrIconTone(pr("merged"))).toBe(
      getSmartWorkspacePrStateTone("merged"),
    );
  });

  test("only a draft is a draft", () => {
    expect(isSmartWorkspaceDraftPr(pr("draft"))).toBe(true);
    expect(isSmartWorkspaceDraftPr(pr("open"))).toBe(false);
    expect(isSmartWorkspaceDraftPr(pr("merged"))).toBe(false);
    // An issue row is never a draft PR, whatever its state carries.
    expect(
      isSmartWorkspaceDraftPr({ type: "issue", number: 7, title: "Bug", state: "draft" }),
    ).toBe(false);
  });

  test("the state word names the colour", () => {
    expect(getSmartWorkspacePrStateLabel(pr("merged"))).toBe("Merged");
    expect(getSmartWorkspacePrStateLabel(pr("draft"))).toBe("Draft");
    expect(getSmartWorkspacePrStateLabel(pr("closed"))).toBe("Closed");
    expect(getSmartWorkspacePrStateLabel(pr("open"))).toBe("Open");
  });
});

describe("composer source rows: check verdict", () => {
  test("failing, passing, pending and neutral read off the rollup", () => {
    expect(getSmartWorkspaceChecksPresentation(checks("failure", { passed: 2, failed: 2 }))).toEqual({
      icon: "failure",
      label: "2 failing",
      tone: expect.stringContaining("rose"),
    });
    expect(getSmartWorkspaceChecksPresentation(checks("success"))).toEqual({
      icon: "success",
      label: "4/4 passed",
      tone: expect.stringContaining("emerald"),
    });
    expect(getSmartWorkspaceChecksPresentation(checks("pending", { passed: 3, pending: 1 }))).toEqual({
      icon: "pending",
      label: "1 pending",
      tone: expect.stringContaining("amber"),
    });
    expect(getSmartWorkspaceChecksPresentation(checks("neutral", { passed: 3, neutral: 1 }))?.icon).toBe(
      "neutral",
    );
  });

  test("no summary and an empty rollup stay silent instead of claiming a verdict", () => {
    expect(getSmartWorkspaceChecksPresentation(undefined)).toBeNull();
    expect(
      getSmartWorkspaceChecksPresentation(checks("none", { total: 0, passed: 0 })),
    ).toBeNull();
  });
});

describe("composer source rows: accessible names", () => {
  test("a PR row names its state and verdict, an issue row stays an issue", () => {
    expect(
      getSmartWorkspaceGithubRowLabel(pr("merged", checks("failure", { passed: 2, failed: 2 }))),
    ).toBe("Pull request #123, Merged, checks 2 failing: Fix login");
    expect(getSmartWorkspaceGithubRowLabel(pr("open"))).toBe(
      "Pull request #123, Open: Fix login",
    );
    expect(
      getSmartWorkspaceGithubRowLabel({ type: "issue", number: 7, title: "Bug" }),
    ).toBe("Issue #7: Bug");
  });

  test("the hover affordance says what it opens", () => {
    expect(getSmartWorkspaceOpenLinkLabel(pr("open"))).toBe(
      "Open pull request #123 in browser",
    );
    expect(
      getSmartWorkspaceOpenLinkLabel({ type: "issue", number: 7, title: "Bug" }),
    ).toBe("Open issue #7 in browser");
  });
});
