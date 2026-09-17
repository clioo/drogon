// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// #332 panel wiring: the chevron menu's Publish Branch and Force Push rows
// drive gitPush with the matching mode, Force Push stays behind its
// confirm dialog, and the shared gitPush schema pins the mode wire form.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TooltipProvider } from "../../components/ui/tooltip";
import { ChangesPanel } from "./ChangesPanel";
import { gitBridgeSchemas } from "../../../../shared/git-contract";
import type { GitBridge, GitStatusEntry } from "../../../../shared/git-contract";
import type { Result, Status, Workspace } from "../../../../shared/session-contract";

afterEach(cleanup);

const SCOPE = { hostId: "host-1", workspaceId: "workspace-1" };
const WORKSPACE: Workspace = {
  id: "workspace-1",
  path: "/tmp/issue-332-panel",
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
  branch: {
    head: string | null;
    upstream: string | null;
    ahead: number | null;
    behind: number | null;
    remotes: string[] | undefined;
  },
  pushCalls: unknown[],
): GitBridge {
  return {
    gitStatus: async () =>
      ({
        ok: true,
        result: {
          ...SCOPE,
          branch: { oid: "abc123", ...branch },
          entries: [
            { path: "index.html", staged: ".", unstaged: "D", kind: "ordinary" },
          ] as GitStatusEntry[],
          truncated: false,
        },
      }) as Result<never> as never,
    gitDiff: async () =>
      ({ ok: true, result: { ...SCOPE, path: "", staged: false, diff: "", truncated: false } }) as never,
    gitStage: async (input: { paths: string[] }) => ({
      ok: true,
      result: { ...SCOPE, paths: input.paths },
    }),
    gitUnstage: async (input: { paths: string[] }) => ({
      ok: true,
      result: { ...SCOPE, paths: input.paths },
    }),
    gitCommit: async () => ({ ok: false, error: { code: "unsupported", message: "no" } }),
    gitPush: async (input: unknown) => {
      pushCalls.push(input);
      return { ok: true, result: { ...SCOPE, pushed: true, detail: "ok" } };
    },
  } as unknown as GitBridge;
}

function renderPanel(
  branch: {
    head: string | null;
    upstream: string | null;
    ahead: number | null;
    behind: number | null;
    remotes: string[] | undefined;
  },
  pushCalls: unknown[],
) {
  return render(
    <TooltipProvider>
      <ChangesPanel
        routeId="changes"
        session={null}
        workspace={WORKSPACE}
        status={STATUS}
        focusTarget={null}
        bridge={stubBridge(branch, pushCalls)}
      />
    </TooltipProvider>,
  );
}

async function openChevronMenu() {
  const trigger = await screen.findByRole("button", { name: "More commit and remote actions" });
  // Radix opens the menu on the pointer gesture, not a bare click.
  fireEvent.pointerDown(trigger, { pointerType: "mouse", button: 0 });
  fireEvent.click(trigger);
  await screen.findByRole("menu");
}

describe("changes panel push modes (#332)", () => {
  test("publish row pushes with mode publish and no confirm", async () => {
    const pushCalls: unknown[] = [];
    renderPanel(
      { head: "feature", upstream: null, ahead: 1, behind: 0, remotes: ["origin"] },
      pushCalls,
    );
    await openChevronMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Publish Branch" }));
    await waitFor(() => expect(pushCalls).toHaveLength(1));
    expect(pushCalls[0]).toMatchObject({ ...SCOPE, mode: "publish" });
    // No confirm dialog for publish: the bridge call lands directly.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("force push row opens the confirm dialog; confirm pushes with lease mode", async () => {
    const pushCalls: unknown[] = [];
    renderPanel(
      { head: "main", upstream: "origin/main", ahead: 1, behind: 0, remotes: ["origin"] },
      pushCalls,
    );
    await openChevronMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Force Push" }));
    // The row arms the dialog instead of pushing.
    expect(pushCalls).toHaveLength(0);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Force push with lease?");
    expect(dialog.textContent).toContain("origin/main");
    fireEvent.click(screen.getByRole("button", { name: "Force Push" }));
    await waitFor(() => expect(pushCalls).toHaveLength(1));
    expect(pushCalls[0]).toMatchObject({ ...SCOPE, mode: "force-with-lease" });
  });

  test("cancelling the force push dialog pushes nothing", async () => {
    const pushCalls: unknown[] = [];
    renderPanel(
      { head: "main", upstream: "origin/main", ahead: 1, behind: 0, remotes: ["origin"] },
      pushCalls,
    );
    await openChevronMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Force Push" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(pushCalls).toHaveLength(0);
  });

  test("publish stays disabled without a remote and pushes nothing", async () => {
    const pushCalls: unknown[] = [];
    renderPanel(
      { head: "feature", upstream: null, ahead: 1, behind: 0, remotes: [] },
      pushCalls,
    );
    await openChevronMenu();
    const publish = screen.getByRole("menuitem", { name: "Publish Branch" });
    expect(publish.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(publish);
    // Radix blocks the disabled row: the bridge never fires.
    expect(pushCalls).toHaveLength(0);
  });

  test("gitPush schema accepts the modes and rejects unknown ones", () => {
    expect(
      gitBridgeSchemas.gitPush.safeParse({ ...SCOPE, mode: "publish" }).success,
    ).toBe(true);
    expect(
      gitBridgeSchemas.gitPush.safeParse({ ...SCOPE, mode: "force-with-lease" }).success,
    ).toBe(true);
    expect(gitBridgeSchemas.gitPush.safeParse({ ...SCOPE }).success).toBe(true);
    expect(
      gitBridgeSchemas.gitPush.safeParse({ ...SCOPE, mode: "force" }).success,
    ).toBe(false);
  });
});
