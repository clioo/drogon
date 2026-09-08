// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc. R16-BJ (#294/#176 residual) panel
// wiring: a row click routes the file's diff to the main tab strip via
// the window row-open event (never an inline strip), unstaged markdown
// takes the fork's edit-tab-with-Changes-view branch, and the clean-state
// sentence names the repo's default base ref.

import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "../../components/ui/tooltip";
import { ChangesPanel } from "./ChangesPanel";
import {
  SOURCE_CONTROL_ROW_OPEN_EVENT,
  type SourceControlRowOpenDetail,
} from "./row-open-event";
import type {
  GitBridge,
  GitStatusEntry,
} from "../../../../shared/git-contract";
import type { Result, Status, Workspace } from "../../../../shared/session-contract";

afterEach(cleanup);

const SCOPE = { hostId: "host-1", workspaceId: "workspace-1" };
const WORKSPACE: Workspace = {
  id: "workspace-1",
  path: "/tmp/r16bj-verify",
  name: "wt1",
  kind: "git",
  hostId: "host-1",
};
const STATUS: Status = {
  hostId: "host-1",
  serviceInstanceId: "service-1",
  protocol: 1,
  capabilities: ["git.v1", "project.v1", "worktree.v1"],
  version: "test",
};

function stubBridge(
  entries: GitStatusEntry[],
  branch: Record<string, unknown> = {
    head: "wt1",
    oid: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    remotes: [],
    baseRef: "origin/main",
  },
): GitBridge {
  return {
    gitStatus: async () =>
      ({
        ok: true,
        result: { ...SCOPE, branch, entries, truncated: false },
      }) as never,
    gitDiff: async () =>
      ({
        ok: true,
        result: { ...SCOPE, path: "", staged: false, diff: "", truncated: false },
      }) as never,
    gitStage: async () => ({ ok: true, result: { ...SCOPE, paths: [] } }),
    gitUnstage: async () => ({ ok: true, result: { ...SCOPE, paths: [] } }),
    gitCommit: async () => ({ ok: true, result: { ...SCOPE, commit: "abc" } }),
    gitPush: async () => ({ ok: true, result: { ...SCOPE, pushed: true, detail: "" } }),
  } as unknown as GitBridge;
}

function renderPanel(bridge: GitBridge) {
  return render(
    <TooltipProvider>
      <ChangesPanel
        routeId="changes"
        session={null}
        workspace={WORKSPACE}
        status={STATUS}
        focusTarget={null}
        bridge={bridge}
      />
    </TooltipProvider>,
  );
}

function rowOpens(detail: unknown): SourceControlRowOpenDetail[] {
  const seen: SourceControlRowOpenDetail[] = [];
  const listener = (event: Event) => {
    seen.push((event as CustomEvent<SourceControlRowOpenDetail>).detail);
  };
  window.addEventListener(SOURCE_CONTROL_ROW_OPEN_EVENT, listener);
  return seen;
}

describe("source control row open (#294)", () => {
  test("a staged row opens a staged diff editor tab, not an inline strip", async () => {
    const seen: SourceControlRowOpenDetail[] = [];
    const listener = (event: Event) =>
      seen.push((event as CustomEvent<SourceControlRowOpenDetail>).detail);
    window.addEventListener(SOURCE_CONTROL_ROW_OPEN_EVENT, listener);
    try {
      renderPanel(
        stubBridge([
          { path: "index.html", staged: "M", unstaged: ".", kind: "ordinary" },
        ]),
      );
      const row = await screen.findByTestId("source-control-entry");
      fireEvent.click(row);
      expect(seen).toEqual([
        { kind: "diff", workspaceId: WORKSPACE.id, path: "index.html", area: "staged" },
      ]);
    } finally {
      window.removeEventListener(SOURCE_CONTROL_ROW_OPEN_EVENT, listener);
    }
    // The fork has no inline diff strip: nothing claims to be one.
    expect(screen.queryByLabelText("Unified diff")).toBeNull();
  });

  test("an unstaged row opens an unstaged diff tab", async () => {
    const seen: SourceControlRowOpenDetail[] = [];
    const listener = (event: Event) =>
      seen.push((event as CustomEvent<SourceControlRowOpenDetail>).detail);
    window.addEventListener(SOURCE_CONTROL_ROW_OPEN_EVENT, listener);
    try {
      renderPanel(
        stubBridge([
          { path: "src/app.js", staged: ".", unstaged: "M", kind: "ordinary" },
        ]),
      );
      const row = await screen.findByTestId("source-control-entry");
      fireEvent.click(row);
      expect(seen).toEqual([
        { kind: "diff", workspaceId: WORKSPACE.id, path: "src/app.js", area: "unstaged" },
      ]);
    } finally {
      window.removeEventListener(SOURCE_CONTROL_ROW_OPEN_EVENT, listener);
    }
  });

  test("unstaged markdown takes the fork's edit-tab-with-Changes branch", async () => {
    const seen: SourceControlRowOpenDetail[] = [];
    const listener = (event: Event) =>
      seen.push((event as CustomEvent<SourceControlRowOpenDetail>).detail);
    window.addEventListener(SOURCE_CONTROL_ROW_OPEN_EVENT, listener);
    try {
      renderPanel(
        stubBridge([
          { path: "README.md", staged: ".", unstaged: "M", kind: "ordinary" },
        ]),
      );
      const row = await screen.findByTestId("source-control-entry");
      fireEvent.click(row);
      expect(seen).toEqual([
        { kind: "edit-changes", workspaceId: WORKSPACE.id, path: "README.md" },
      ]);
    } finally {
      window.removeEventListener(SOURCE_CONTROL_ROW_OPEN_EVENT, listener);
    }
  });

  test("a second click re-fires the request; the tab strip reuses the tab", async () => {
    const seen: SourceControlRowOpenDetail[] = [];
    const listener = (event: Event) =>
      seen.push((event as CustomEvent<SourceControlRowOpenDetail>).detail);
    window.addEventListener(SOURCE_CONTROL_ROW_OPEN_EVENT, listener);
    try {
      renderPanel(
        stubBridge([
          { path: "src/app.js", staged: ".", unstaged: "M", kind: "ordinary" },
        ]),
      );
      const row = await screen.findByTestId("source-control-entry");
      fireEvent.click(row);
      fireEvent.click(row);
      // Same detail both times: App's tab id is (workspace, area, path),
      // so the second click focuses the existing tab, never a duplicate.
      expect(seen).toHaveLength(2);
      expect(seen[0]).toEqual(seen[1]);
    } finally {
      window.removeEventListener(SOURCE_CONTROL_ROW_OPEN_EVENT, listener);
    }
  });
});

describe("clean-state copy (#176 residual)", () => {
  test("the sentence names the daemon-resolved default base ref", async () => {
    renderPanel(stubBridge([], { head: "wt1", upstream: null, ahead: 0, behind: 0, baseRef: "origin/main" }));
    const state = await screen.findByText("No changes on this branch");
    expect(state.textContent).toBe("No changes on this branch");
    const supporting = screen.getByText(/This workspace is clean/);
    expect(supporting.textContent).toBe(
      "This workspace is clean and this branch has no changes ahead of origin/main",
    );
  });

  test("without any resolvable base it falls back to the literal base", async () => {
    renderPanel(stubBridge([], { head: "wt1", upstream: null, ahead: 0, behind: 0, baseRef: null }));
    const supporting = await screen.findByText(/This workspace is clean/);
    expect(supporting.textContent).toBe(
      "This workspace is clean and this branch has no changes ahead of base",
    );
  });

  test("an older daemon without the field also falls back to base", async () => {
    renderPanel(stubBridge([], { head: "wt1", upstream: null, ahead: 0, behind: 0 }));
    const supporting = await screen.findByText(/This workspace is clean/);
    expect(supporting.textContent).toBe(
      "This workspace is clean and this branch has no changes ahead of base",
    );
  });
});
