// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc. Issue-source selector (#246): the
   fork's null rules (no origin, no upstream, or same slug), upstream-first
   auto highlight, pin-on-click semantics, and the per-project preference
   storage that feeds it. */

import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  IssueSourceSelector,
  issueSourceChipClass,
  sameGitHubOwnerRepo,
} from "./issue-source-selector";
import {
  loadIssueSourcePreference,
  saveIssueSourcePreference,
} from "./issue-source-preference";
import { TooltipProvider } from "./ui/tooltip";

afterEach(cleanup);

const ORIGIN = { owner: "example", repo: "repo" };
const UPSTREAM = { owner: "upstream-org", repo: "repo" };

function renderSelector(props: Partial<Parameters<typeof IssueSourceSelector>[0]> = {}) {
  return render(
    <TooltipProvider>
      <IssueSourceSelector
        preference={undefined}
        origin={ORIGIN}
        upstream={UPSTREAM}
        onChange={() => {}}
        {...props}
      />
    </TooltipProvider>,
  );
}

describe("sameGitHubOwnerRepo", () => {
  test("compares slugs case-insensitively and never matches nulls", () => {
    expect(sameGitHubOwnerRepo(ORIGIN, { owner: "Example", repo: "Repo" })).toBe(true);
    expect(sameGitHubOwnerRepo(ORIGIN, UPSTREAM)).toBe(false);
    expect(sameGitHubOwnerRepo(null, ORIGIN)).toBe(false);
    expect(sameGitHubOwnerRepo(ORIGIN, null)).toBe(false);
    expect(sameGitHubOwnerRepo(null, null)).toBe(false);
  });
});

describe("IssueSourceSelector null rules", () => {
  test("renders nothing without an upstream remote or with same-slug remotes", () => {
    const { container: noUpstream } = renderSelector({ upstream: null });
    expect(noUpstream.querySelector("[role='group']")).toBeNull();
    const { container: noOrigin } = renderSelector({ origin: null });
    expect(noOrigin.querySelector("[role='group']")).toBeNull();
    const { container: sameSlug } = renderSelector({
      upstream: { owner: "Example", repo: "REPO" },
    });
    expect(sameSlug.querySelector("[role='group']")).toBeNull();
  });

  test("renders the two-pill group when origin and upstream diverge", () => {
    renderSelector();
    const group = screen.getByRole("group", { name: "Issue source" });
    expect(group).toBeDefined();
    // Auto (no persisted pin) highlights upstream, matching the daemon's
    // upstream-first resolution.
    expect(screen.getByRole("button", { name: "Upstream" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Origin" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });
});

describe("IssueSourceSelector pin-on-click", () => {
  test("clicking Origin pins it even though auto highlights upstream", () => {
    const onChange = vi.fn();
    renderSelector({ onChange });
    fireEvent.click(screen.getByRole("button", { name: "Origin" }));
    expect(onChange).toHaveBeenCalledWith("origin");
  });

  test("a persisted pin moves the highlight and short-circuits a repeat click", () => {
    const onChange = vi.fn();
    renderSelector({ preference: "origin", onChange });
    expect(screen.getByRole("button", { name: "Origin" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Origin" }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Upstream" }));
    expect(onChange).toHaveBeenCalledWith("upstream");
  });

  test("disabled pills never fire onChange", () => {
    const onChange = vi.fn();
    renderSelector({ disabled: true, onChange });
    fireEvent.click(screen.getByRole("button", { name: "Origin" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  test("compact density strips the pill text to U / O", () => {
    renderSelector({ density: "compact" });
    expect(screen.getByRole("button", { name: "U" })).toBeDefined();
    expect(screen.getByRole("button", { name: "O" })).toBeDefined();
  });
});

describe("issue source chip class", () => {
  test("matches the fork's outer chip shape", () => {
    expect(issueSourceChipClass).toContain("bg-muted/40");
    expect(issueSourceChipClass).toContain("border-border/50");
  });
});

describe("issue source preference storage", () => {
  test("round-trips a pin per project and rejects junk as auto", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    expect(loadIssueSourcePreference("p1", storage)).toBeUndefined();
    saveIssueSourcePreference("p1", "origin", storage);
    expect(loadIssueSourcePreference("p1", storage)).toBe("origin");
    // Per project: another repo keeps its own pin (or auto).
    expect(loadIssueSourcePreference("p2", storage)).toBeUndefined();
    saveIssueSourcePreference("p2", "upstream", storage);
    expect(loadIssueSourcePreference("p2", storage)).toBe("upstream");
    store.set("drogon:tasks-issue-source:p3", "garbage");
    expect(loadIssueSourcePreference("p3", storage)).toBeUndefined();
  });
});
