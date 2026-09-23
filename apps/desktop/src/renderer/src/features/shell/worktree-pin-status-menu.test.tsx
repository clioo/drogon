// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc.
   Issue #331: the worktree card context menu's Pin/Unpin row and Move to
   Status submenu must reach the daemon's `worktree.update` store. Radix
   portals menu content to document.body, so these mount under jsdom (the
   repo's radix-jsdom-stubs pattern) instead of SSR. */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { Tooltip } from "radix-ui";
import type {
  Project,
  Workspace,
  Worktree,
} from "../../../../shared/session-contract";
import { DEFAULT_WORKSPACE_STATUSES } from "../../../../shared/workspace-statuses";
import { WorktreeContextMenu } from "./WorktreeContextMenu";
import { ProjectList } from "./ProjectList";
import type { ProjectGroup } from "./project-adapter";
import { EMPTY_TAB_STRIP_STATE } from "./tab-order";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";

beforeEach(installRadixJsdomStubs);
beforeEach(() => {
  (window as unknown as { drogon: unknown }).drogon = {};
});
afterEach(cleanup);

const baseWorktree: Worktree = {
  id: "wt1",
  projectId: "p1",
  workspaceId: "ws1",
  path: "/work/drogon-wt1",
  branch: "feature",
  head: "abc",
  baseRef: null,
  createdAt: "",
};

function mountMenu({
  worktree = baseWorktree,
  onTogglePin = null,
  onMoveToStatus = null,
}: {
  worktree?: Worktree;
  onTogglePin?: (() => void) | null;
  onMoveToStatus?: ((statusId: string | null) => void) | null;
}) {
  return render(
    <WorktreeContextMenu
      worktree={worktree}
      displayName="wt1"
      projectKind="git"
      implicitFolderWorktree={false}
      primaryCheckout={false}
      disabled={false}
      onRename={null}
      onDelete={null}
      onTogglePin={onTogglePin}
      statuses={[...DEFAULT_WORKSPACE_STATUSES]}
      onMoveToStatus={onMoveToStatus}
    >
      <div>card</div>
    </WorktreeContextMenu>,
  );
}

function openMenu(): void {
  const scope = document.querySelector(
    '[data-worktree-context-menu-scope="worktree"]',
  ) as HTMLElement;
  expect(scope).toBeTruthy();
  fireEvent.contextMenu(scope, { clientX: 50, clientY: 50 });
}

function findItem(text: string): HTMLElement {
  const item = Array.from(
    document.querySelectorAll<HTMLElement>(
      ".shell-worktree-context-menu-item",
    ),
  ).find((el) => el.textContent?.includes(text));
  expect(item?.textContent).toContain(text);
  return item!;
}

function activate(item: HTMLElement): void {
  // Radix selects on the full pointer gesture, not a bare click.
  fireEvent.pointerDown(item, { pointerType: "mouse", button: 0 });
  fireEvent.pointerUp(item, { pointerType: "mouse", button: 0 });
  fireEvent.click(item);
}

/** Keyboard-opens the submenu whose trigger carries `text`. */
function openSubmenu(text: string): void {
  const trigger = findItem(text);
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowRight" });
}

describe("worktree card menu pin row (#331)", () => {
  test("unpinned worktrees offer Pin and call the toggle", () => {
    const onTogglePin = vi.fn();
    mountMenu({ onTogglePin, onMoveToStatus: null });
    openMenu();
    activate(findItem("Pin"));
    expect(onTogglePin).toHaveBeenCalledTimes(1);
  });

  test("pinned worktrees offer Unpin", () => {
    const onTogglePin = vi.fn();
    mountMenu({
      worktree: { ...baseWorktree, isPinned: true },
      onTogglePin,
      onMoveToStatus: null,
    });
    openMenu();
    activate(findItem("Unpin"));
    expect(onTogglePin).toHaveBeenCalledTimes(1);
  });

  test("no pin row while the bridge is unavailable", () => {
    mountMenu({ onTogglePin: null, onMoveToStatus: null });
    openMenu();
    const labels = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".shell-worktree-context-menu-item",
      ),
    ).map((el) => el.textContent ?? "");
    expect(labels.some((text) => text === "Pin" || text === "Unpin")).toBe(
      false,
    );
  });
});

describe("worktree card menu status submenu (#331)", () => {
  test("lists every shared status and moves to the picked one", () => {
    const onMoveToStatus = vi.fn();
    mountMenu({ onTogglePin: null, onMoveToStatus });
    openMenu();
    openSubmenu("Move to Status");
    for (const status of DEFAULT_WORKSPACE_STATUSES) {
      expect(findItem(status.label).textContent).toContain(status.label);
    }
    activate(findItem("In review"));
    expect(onMoveToStatus).toHaveBeenCalledWith("in-review");
  });

  test("the effective status carries the check; Clear status clears", () => {
    const onMoveToStatus = vi.fn();
    mountMenu({
      worktree: { ...baseWorktree, workspaceStatus: "todo" },
      onTogglePin: null,
      onMoveToStatus,
    });
    openMenu();
    openSubmenu("Move to Status");
    // Stored "todo" is current: checked. "Done" is not: spacer, no icon.
    expect(findItem("Todo").querySelector("svg")).toBeTruthy();
    expect(findItem("Done").querySelector("svg")).toBeNull();
    activate(findItem("Clear status"));
    expect(onMoveToStatus).toHaveBeenCalledWith(null);
  });

  test("no Clear status row without a stored override", () => {
    mountMenu({ onTogglePin: null, onMoveToStatus: vi.fn() });
    openMenu();
    openSubmenu("Move to Status");
    const labels = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".shell-worktree-context-menu-item",
      ),
    ).map((el) => el.textContent ?? "");
    expect(labels.some((text) => text.includes("Clear status"))).toBe(false);
  });

  test("no status submenu while the bridge is unavailable", () => {
    mountMenu({ onTogglePin: null, onMoveToStatus: null });
    openMenu();
    const labels = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".shell-worktree-context-menu-item",
      ),
    ).map((el) => el.textContent ?? "");
    expect(labels.some((text) => text.includes("Move to Status"))).toBe(
      false,
    );
  });
});

describe("ProjectList wires pin to worktree.update (#331)", () => {
  const project: Project = {
    id: "p1",
    hostId: "h1",
    path: "/work/drogon",
    name: "drogon",
    kind: "git",
    defaultBaseRef: null,
  };
  const workspace: Workspace = {
    id: "ws1",
    path: "/work/drogon-wt1",
    name: "wt1",
    kind: "git",
    hostId: "h1",
  };

  test("Pin calls worktreeUpdate with isPinned:true; status submenu is present", async () => {
    const worktreeUpdate = vi.fn(async (input: unknown) => ({
      ok: true as const,
      result: { ...baseWorktree, isPinned: true },
    }));
    (window as unknown as { drogon: unknown }).drogon = {
      project: { worktreeUpdate },
    };
    const groups: ProjectGroup[] = [{ project, worktrees: [baseWorktree] }];
    render(
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
          action={null}
          onSelectWorkspace={() => {}}
          onAddProject={() => {}}
          onCreateWorkspace={() => {}}
          onOpenAction={() => {}}
          onCloseAction={() => {}}
          onBrowse={async () => null}
          onSubmitAdd={async () => null}
          onSubmitRemove={async () => null}
          onSubmitRemoveProject={async () => null}
          onOpenProjectSettings={() => {}}
          onSubmitRename={async () => null}
        />
      </Tooltip.Provider>,
    );
    openMenu();
    activate(findItem("Pin"));
    expect(worktreeUpdate).toHaveBeenCalledWith({
      worktreeId: "wt1",
      isPinned: true,
    });
    // The status submenu is threaded through the same path: its trigger
    // renders once the menu opens (the submenu items are covered above).
    openMenu();
    expect(findItem("Move to Status").textContent).toContain("Move to Status");
  });
});
