// @vitest-environment jsdom
// #175/#176 panel wiring: the full ChangesPanel against a stub bridge.
// A no-remote status renders "No remote" (never "No upstream"), disables
// Create PR with the reason (never running `gh`), and the Untracked Files
// "Stage all" stages exactly that section's paths.

import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "../../components/ui/tooltip";
import { ChangesPanel } from "./ChangesPanel";
import { NO_REMOTE_SYNC_TITLE } from "./sync-row";
import type { GitBridge, GitStatusEntry } from "../../../../shared/git-contract";
import type { Result, Status, Workspace } from "../../../../shared/session-contract";

afterEach(cleanup);

const SCOPE = { hostId: "host-1", workspaceId: "workspace-1" };
const WORKSPACE: Workspace = {
  id: "workspace-1",
  path: "/tmp/r16r-verify",
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

const UNTRACKED_A = "<!-- qa edit r1 -->.html";
const UNTRACKED_B = "cli-created.txt";

function entries(): GitStatusEntry[] {
  return [
    { path: "index.html", staged: ".", unstaged: "D", kind: "ordinary" },
    { path: UNTRACKED_A, staged: "?", unstaged: "?", kind: "untracked" },
    { path: UNTRACKED_B, staged: "?", unstaged: "?", kind: "untracked" },
  ];
}

function stubBridge(remotes: string[] | undefined, calls: {
  staged: string[][];
  prCreates: number;
}): GitBridge {
  return {
    gitStatus: async () =>
      ({
        ok: true,
        result: {
          ...SCOPE,
          branch: {
            head: "wt1",
            oid: "abc123",
            upstream: null,
            ahead: null,
            behind: null,
            ...(remotes === undefined ? {} : { remotes }),
          },
          entries: entries(),
          truncated: false,
        },
      }) as Result<never> as never,
    gitDiff: async () =>
      ({ ok: true, result: { ...SCOPE, path: "", staged: false, diff: "", truncated: false } }) as never,
    gitStage: async (input: { paths: string[] }) => {
      calls.staged.push([...input.paths]);
      return { ok: true, result: { ...SCOPE, paths: input.paths } };
    },
    gitUnstage: async (input: { paths: string[] }) => ({
      ok: true,
      result: { ...SCOPE, paths: input.paths },
    }),
    gitCommit: async () => ({ ok: false, error: { code: "unsupported", message: "no" } }),
    gitPush: async () => ({ ok: false, error: { code: "unsupported", message: "no" } }),
    gitPrCreate: async () => {
      calls.prCreates += 1;
      return { ok: false, error: { code: "io_error", message: "no git remotes found" } };
    },
  } as unknown as GitBridge;
}

function renderPanel(remotes: string[] | undefined, calls: { staged: string[][]; prCreates: number }) {
  return render(
    <TooltipProvider>
      <ChangesPanel
        routeId="changes"
        session={null}
        workspace={WORKSPACE}
        status={STATUS}
        focusTarget={null}
        bridge={stubBridge(remotes, calls)}
      />
    </TooltipProvider>,
  );
}

describe("changes panel remote wiring (#175/#176)", () => {
  test("no remote: No remote state, disabled Create PR, scoped untracked stage-all", async () => {
    const calls = { staged: [] as string[][], prCreates: 0 };
    renderPanel([], calls);

    // The sync row distinguishes no-remote from no-upstream.
    expect(await screen.findByText("No remote")).toBeTruthy();
    expect(screen.queryByText("No upstream")).toBeNull();

    // Create PR (header toolbar) is disabled with the reason, so `gh`
    // never runs for a repo with no remote.
    const createPr = screen.getByRole("button", { name: "Create PR" });
    expect(createPr.getAttribute("disabled")).not.toBeNull();
    expect(createPr.getAttribute("title")).toBe(NO_REMOTE_SYNC_TITLE);
    fireEvent.click(createPr);
    expect(calls.prCreates).toBe(0);

    // The Untracked Files "Stage all" (second of the two) stages exactly
    // that section's paths — never the tracked deletion.
    const stageAll = screen.getAllByRole("button", { name: "Stage all" });
    expect(stageAll).toHaveLength(2);
    fireEvent.click(stageAll[1]);
    await vi.waitFor(() => expect(calls.staged).toHaveLength(1));
    expect(calls.staged[0]).toEqual([UNTRACKED_A, UNTRACKED_B]);
  });

  test("remote without upstream: No upstream, enabled fetch, scoped changes stage-all", async () => {
    const calls = { staged: [] as string[][], prCreates: 0 };
    renderPanel(["origin"], calls);

    expect(await screen.findByText("No upstream")).toBeTruthy();
    expect(screen.queryByText("No remote")).toBeNull();

    const stageAll = screen.getAllByRole("button", { name: "Stage all" });
    expect(stageAll).toHaveLength(2);
    fireEvent.click(stageAll[0]);
    await vi.waitFor(() => expect(calls.staged).toHaveLength(1));
    expect(calls.staged[0]).toEqual(["index.html"]);
  });
});
