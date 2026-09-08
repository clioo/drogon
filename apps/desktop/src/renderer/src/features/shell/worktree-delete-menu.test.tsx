// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc.
   #220: clicking "Delete Worktree" in the worktree card context menu must
   open the DeleteWorktreeDialog confirm (a centered modal, like the fork),
   and confirming must submit the removal. Radix portals menu and dialog
   content to document.body, so these mount under jsdom (the repo's
   radix-jsdom-stubs pattern) instead of SSR. */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { Tooltip } from "radix-ui";
import type {
  Project,
  Workspace,
  Worktree,
} from "../../../../shared/session-contract";
import { ProjectList } from "./ProjectList";
import type { ProjectAction } from "./ProjectList";
import type { ProjectGroup } from "./project-adapter";
import { EMPTY_TAB_STRIP_STATE } from "./tab-order";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";

beforeEach(installRadixJsdomStubs);
beforeEach(() => {
  (window as unknown as { drogon: unknown }).drogon = {};
});
afterEach(cleanup);

const project: Project = {
  id: "p1",
  hostId: "h1",
  path: "/work/drogon",
  name: "drogon",
  kind: "git",
  defaultBaseRef: null,
};

const worktree: Worktree = {
  id: "wt1",
  projectId: "p1",
  workspaceId: "ws1",
  path: "/work/drogon-wt1",
  branch: "feature",
  head: "abc",
  baseRef: null,
  createdAt: "",
};

const workspace: Workspace = {
  id: "ws1",
  path: "/work/drogon-wt1",
  name: "wt1",
  kind: "git",
  hostId: "h1",
};

const groups: ProjectGroup[] = [{ project, worktrees: [worktree] }];

function mount({
  action = null,
  onOpenAction = () => {},
  onSubmitRemove = async () => null,
}: {
  action?: ProjectAction | null;
  onOpenAction?: (action: ProjectAction) => void;
  onSubmitRemove?: (worktree: Worktree, force: boolean) => Promise<string | null>;
}) {
  return render(
    <Tooltip.Provider>
      <ProjectList
        groups={groups}
        workspaces={[workspace]}
        sessions={[]}
        selectedWorkspaceId="ws1"
        activeSessionId=""
        tabStrip={EMPTY_TAB_STRIP_STATE}
        onSelectSession={() => {}}
        disabled={false}
        addDisabled={false}
        sidebarWidth={280}
        worktreesAvailable
        action={action}
        onSelectWorkspace={() => {}}
        onAddProject={() => {}}
        onCreateWorkspace={() => {}}
        onOpenAction={onOpenAction}
        onCloseAction={() => {}}
        onBrowse={async () => null}
        onSubmitAdd={async () => null}
        onSubmitRemove={onSubmitRemove}
        onSubmitRemoveProject={async () => null}
        onOpenProjectSettings={() => {}}
        onSubmitRename={async () => null}
      />
    </Tooltip.Provider>,
  );
}

function clickDeleteMenuItem(): void {
  const scope = document.querySelector(
    '[data-worktree-context-menu-scope="worktree"]',
  ) as HTMLElement;
  expect(scope).toBeTruthy();
  fireEvent.contextMenu(scope, { clientX: 50, clientY: 50 });
  const item = Array.from(
    document.querySelectorAll<HTMLElement>(
      ".shell-worktree-context-menu-item-destructive",
    ),
  ).find((el) => el.textContent?.includes("Delete Worktree"));
  expect(item?.textContent).toContain("Delete Worktree");
  // Radix selects on the full pointer gesture, not a bare click.
  fireEvent.pointerDown(item!, { pointerType: "mouse", button: 0 });
  fireEvent.pointerUp(item!, { pointerType: "mouse", button: 0 });
  fireEvent.click(item!);
}

describe("worktree Delete menu (#220)", () => {
  test("clicking Delete Worktree opens the remove action", () => {
    const onOpenAction = vi.fn();
    mount({ onOpenAction });
    clickDeleteMenuItem();
    expect(onOpenAction).toHaveBeenCalledWith({
      kind: "remove",
      worktreeId: "wt1",
    });
  });

  test("the remove action renders the fork-copy confirm as a modal", () => {
    mount({ action: { kind: "remove", worktreeId: "wt1" } });
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    const form = document.querySelector(
      'form[aria-label="Delete workspace wt1"]',
    );
    expect(form).toBeTruthy();
    const body = dialog?.textContent ?? "";
    expect(body).toContain("Delete Workspace");
    // Fork copy (delete-worktree-dialog-copy.ts, single git target).
    expect(body).toContain("from git and delete its workspace folder.");
    expect(body).toContain("Force: remove even with uncommitted changes");
    expect(body).toContain("Cancel");
  });

  test("confirming submits the removal unforced; a failure stays open to retry", async () => {
    const onSubmitRemove = vi.fn(async () => "dirty checkout");
    mount({
      action: { kind: "remove", worktreeId: "wt1" },
      onSubmitRemove,
    });
    const confirm = Array.from(
      document.querySelectorAll<HTMLElement>("button"),
    ).find((el) => el.textContent?.includes("Delete Workspace"));
    expect(confirm).toBeTruthy();
    fireEvent.click(confirm!);
    await vi.waitFor(() => {
      expect(onSubmitRemove).toHaveBeenCalledWith(
        expect.objectContaining({ id: "wt1" }),
        false,
      );
    });
    // The daemon refusal surfaces verbatim and the dialog stays open, so
    // the same Delete button retries with the same inputs.
    await vi.waitFor(() => {
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        "dirty checkout",
      );
    });
    expect(
      document.querySelector('form[aria-label="Delete workspace wt1"]'),
    ).toBeTruthy();
  });
});
