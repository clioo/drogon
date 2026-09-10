// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DeleteWorktreeDialog } from "./DeleteWorktreeDialog";
import type { Workspace, Worktree } from "../../../../shared/session-contract";

afterEach(cleanup);

const worktree: Worktree = {
  id: "wt1",
  projectId: "p1",
  workspaceId: "ws1",
  path: "/tmp/folder-project",
  branch: "",
  head: "",
  baseRef: null,
  createdAt: new Date(0).toISOString(),
};
// Folder workspaces skip the git-status bridge, so no window.drogon mock
// is needed to render this variant.
const workspaces = [{ id: "ws1", name: "folder-proj" } as Workspace];

describe("Delete Workspace dialog focus", () => {
  it("autofocuses the destructive confirm so Enter confirms", async () => {
    render(
      <DeleteWorktreeDialog
        worktree={worktree}
        workspaces={workspaces}
        disabled={false}
        isFolderWorkspaceDelete
        onSubmit={async () => null}
        onClose={vi.fn()}
      />,
    );
    const confirm = await screen.findByRole("button", {
      name: "Delete Workspace",
    });
    expect(document.activeElement).toBe(confirm);
  });
});
