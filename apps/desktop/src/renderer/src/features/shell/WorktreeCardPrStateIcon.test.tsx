// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc.
   Direct DOM/color/aria coverage for the production
   WorktreeCardPrStateIcon: renders the real component and reads its actual
   output — state marker, tone class, accessible label and merged check
   overlay — so a tone or mapping regression goes red here, not just in the
   pure `resolveCardPrState` unit tests. */
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { WorktreeCardPrDisplay } from "./worktree-card-pr-display";
import { WorktreeCardPrStateIcon } from "./WorktreeCardPrStateIcon";

afterEach(() => {
  cleanup();
});

function base(overrides: Partial<WorktreeCardPrDisplay> = {}): WorktreeCardPrDisplay {
  return {
    provider: "github",
    number: 123,
    title: "Fix the sidebar",
    ...overrides,
  };
}

function icon(pr: WorktreeCardPrDisplay | null): HTMLElement | null {
  const { container } = render(<WorktreeCardPrStateIcon pr={pr} />);
  return container.querySelector("[data-worktree-card-pr-state]");
}

describe("WorktreeCardPrStateIcon", () => {
  test("merged draws the emerald marker with the check overlay", () => {
    const { container } = render(
      <WorktreeCardPrStateIcon pr={base({ state: "merged" })} />,
    );
    const marker = container.querySelector("[data-worktree-card-pr-state]");
    expect(marker?.getAttribute("data-worktree-card-pr-state")).toBe("merged");
    expect(marker?.className).toContain("text-emerald-500");
    expect(marker?.getAttribute("role")).toBe("img");
    expect(marker?.getAttribute("aria-label")).toBe("Linked PR #123: Merged");
    expect(marker?.getAttribute("title")).toBe("Fix the sidebar");
    // The merged marker draws a filled green check BESIDE the merge glyph
    // (owner's guideline), never overlaid on it: two sibling SVGs in a
    // flex row, the check not absolutely positioned.
    const svgs = marker?.querySelectorAll("svg") ?? [];
    expect(svgs).toHaveLength(2);
    expect(svgs[0]?.getAttribute("class") ?? "").toContain("lucide-git-merge");
    const check = marker?.querySelector("svg.lucide-check");
    expect(check?.getAttribute("class") ?? "").toContain("bg-emerald-500");
    expect(check?.getAttribute("class") ?? "").not.toContain("absolute");
    expect(marker?.className).not.toContain("relative");
  });

  test("ready draws the cyan marker only for a confirmed APPROVED review", () => {
    const marker = icon(
      base({
        state: "open",
        mergeable: "MERGEABLE",
        checks: "success",
        reviewDecision: "APPROVED",
      }),
    );
    expect(marker?.getAttribute("data-worktree-card-pr-state")).toBe("ready");
    expect(marker?.className).toContain("text-cyan-500");
    expect(marker?.className).toContain("dark:text-cyan-400");
    expect(marker?.getAttribute("aria-label")).toBe("Linked PR #123 checks: Passing");
    // Ready keeps the single merge glyph: no merged check overlay.
    expect(marker?.querySelectorAll("svg")).toHaveLength(1);
    expect(marker?.querySelector("svg.lucide-check")).toBeNull();
  });

  test("REVIEW_REQUIRED with green checks stays blue open, never cyan-ready", () => {
    const marker = icon(
      base({
        state: "open",
        mergeable: "MERGEABLE",
        checks: "success",
        reviewDecision: "REVIEW_REQUIRED",
      }),
    );
    expect(marker?.getAttribute("data-worktree-card-pr-state")).toBe("open");
    // Owner: an open review is blue, never the grey of "no PR".
    expect(marker?.className).toContain("text-blue-500");
    expect(marker?.className).not.toContain("text-muted-foreground");
    expect(marker?.className).not.toContain("text-cyan-500");
    expect(marker?.querySelector("svg.lucide-check")).toBeNull();
  });

  test("draft draws the muted marker with its own label", () => {
    const marker = icon(base({ state: "draft" }));
    expect(marker?.getAttribute("data-worktree-card-pr-state")).toBe("draft");
    expect(marker?.className).toContain("text-muted-foreground/70");
    expect(marker?.className).not.toContain("text-cyan-500");
    expect(marker?.className).not.toContain("text-rose-500");
    expect(marker?.getAttribute("aria-label")).toBe("Linked PR #123: Draft");
  });

  test("conflicts draw the red marker", () => {
    const marker = icon(base({ state: "open", mergeable: "CONFLICTING" }));
    expect(marker?.getAttribute("data-worktree-card-pr-state")).toBe("conflicts");
    expect(marker?.className).toContain("text-rose-500");
    expect(marker?.className).not.toContain("text-cyan-500");
    expect(marker?.getAttribute("aria-label")).toBe(
      "Linked PR #123: Conflicts with the base branch",
    );
  });

  test("pending checks and unknown mergeability stay blue open, never cyan", () => {
    const pending = icon(
      base({ state: "open", mergeable: "MERGEABLE", checks: "pending" }),
    );
    expect(pending?.getAttribute("data-worktree-card-pr-state")).toBe("open");
    // Owner: an open review is blue, never the grey of "no PR".
    expect(pending?.className).toContain("text-blue-500");
    expect(pending?.className).not.toContain("text-muted-foreground");
    expect(pending?.className).not.toContain("text-cyan-500");
    expect(pending?.getAttribute("aria-label")).toBe("Linked PR #123 checks: Pending");

    const unknown = icon(base({ state: "open", mergeable: "UNKNOWN" }));
    expect(unknown?.getAttribute("data-worktree-card-pr-state")).toBe("open");
    // Owner: an open review is blue, never the grey of "no PR".
    expect(unknown?.className).toContain("text-blue-500");
    expect(unknown?.className).not.toContain("text-muted-foreground");
    expect(unknown?.className).not.toContain("text-cyan-500");
    expect(unknown?.getAttribute("aria-label")).toBe("Linked PR #123: Open");
  });

  test("on a card, no PR draws the grey marker and an unknown listing says so", () => {
    const none = render(<WorktreeCardPrStateIcon pr={null} showNone />);
    const noneMarker = none.container.querySelector("[data-worktree-card-pr-none]");
    expect(noneMarker?.getAttribute("aria-label")).toBe("No pull request");
    expect(noneMarker?.className).toContain("text-muted-foreground");
    none.unmount();
    const unknown = render(<WorktreeCardPrStateIcon pr={null} showNone unknown />);
    const unknownMarker = unknown.container.querySelector("[data-worktree-card-pr-none]");
    expect(unknownMarker?.getAttribute("aria-label")).toBe(
      "Pull request status unavailable",
    );
    expect(unknownMarker?.getAttribute("data-worktree-card-pr-none")).toBe("unknown");
  });

  test("no linked review draws no icon at all", () => {
    const { container } = render(<WorktreeCardPrStateIcon pr={null} />);
    expect(container.querySelector("[data-worktree-card-pr-state]")).toBeNull();
    expect(container.innerHTML).not.toContain("<svg");
  });
});
