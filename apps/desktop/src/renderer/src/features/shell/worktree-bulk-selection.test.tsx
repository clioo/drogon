// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc.
   Multi-selecting worktree cards in the real sidebar and acting on the
   whole selection: Cmd/Ctrl+click and Shift+click build it, a plain click
   collapses it and still opens the workspace, and the card context menu
   switches to the bulk row set whose Delete / Pin / Move to Status act on
   every selected card through the same commits the single-card menu uses
   (`onSubmitRemove`, `window.drogon.project.worktreeUpdate`). */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Tooltip } from "radix-ui";
import type {
  Project,
  Worktree,
  Workspace,
} from "../../../../shared/session-contract";
import { ProjectList } from "./ProjectList";
import type { ProjectGroup } from "./project-adapter";
import { EMPTY_TAB_STRIP_STATE } from "./tab-order";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";

beforeEach(installRadixJsdomStubs);
afterEach(() => {
  cleanup();
  localStorage.clear();
  delete (window as unknown as { drogon?: unknown }).drogon;
});

const project: Project = {
  id: "p1",
  hostId: "h1",
  path: "/work/drogon",
  name: "drogon",
  kind: "git",
  defaultBaseRef: "main",
};

function worktree(id: string, overrides: Partial<Worktree> = {}): Worktree {
  return {
    id,
    projectId: "p1",
    workspaceId: `ws-${id}`,
    path: `/work/drogon-${id}`,
    branch: id,
    head: "abc",
    baseRef: null,
    createdAt: "2026-09-08T10:00:00.000Z",
    ...overrides,
  };
}

function workspace(id: string): Workspace {
  return {
    id: `ws-${id}`,
    path: `/work/drogon-${id}`,
    name: id,
    kind: "git",
    hostId: "h1",
  };
}

const ids = ["alpha", "beta", "gamma", "delta"];
const worktrees = ids.map((id) => worktree(id));
const workspaces = ids.map((id) => workspace(id));

function mount({
  groups = [{ project, worktrees }] as ProjectGroup[],
  onSelectWorkspace = vi.fn(),
  onSubmitRemove = vi.fn(async (_worktree: Worktree, _force: boolean) => null),
  worktreeUpdate,
}: {
  groups?: ProjectGroup[];
  onSelectWorkspace?: (workspaceId: string) => void;
  onSubmitRemove?: (worktree: Worktree, force: boolean) => Promise<string | null>;
  worktreeUpdate?: ReturnType<typeof vi.fn>;
} = {}) {
  (window as unknown as { drogon: Record<string, unknown> }).drogon =
    worktreeUpdate ? { project: { worktreeUpdate } } : {};
  const utils = render(
    <Tooltip.Provider>
      <ProjectList
        groups={groups}
        workspaces={workspaces}
        sessions={[]}
        selectedWorkspaceId=""
        activeSessionId=""
        tabStrip={EMPTY_TAB_STRIP_STATE}
        onSelectSession={() => {}}
        disabled={false}
        addDisabled={false}
        sidebarWidth={300}
        worktreesAvailable
        action={null}
        onSelectWorkspace={onSelectWorkspace}
        onAddProject={() => {}}
        onCreateWorkspace={() => {}}
        onOpenAction={() => {}}
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
  return { ...utils, onSelectWorkspace, onSubmitRemove };
}

function card(id: string): HTMLElement {
  const element = document.querySelector(`[data-worktree-card-id="${id}"]`);
  expect(element, `card ${id}`).toBeTruthy();
  return element as HTMLElement;
}

/** The card's own primary control (WorktreeCard's "Select <title>"). */
function selectButton(id: string): HTMLElement {
  return card(id).querySelector(
    ".shell-worktree-card-select",
  ) as HTMLElement;
}

function clickCard(
  id: string,
  modifiers: { metaKey?: boolean; shiftKey?: boolean; ctrlKey?: boolean } = {},
): void {
  fireEvent.click(selectButton(id), modifiers);
}

function selectedCardIds(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-multi-selected="true"]'),
  ).map((element) => element.getAttribute("data-worktree-card-id") ?? "");
}

/** Opens a card's context menu the way a right-click does. */
function openCardMenu(id: string): void {
  const scope = card(id).closest(
    '[data-worktree-context-menu-scope="worktree"]',
  ) as HTMLElement;
  fireEvent.contextMenu(scope, { clientX: 40, clientY: 40 });
}

function menuItem(text: string | RegExp): HTMLElement {
  const match = Array.from(
    document.querySelectorAll<HTMLElement>(".shell-worktree-context-menu-item"),
  ).find((element) =>
    typeof text === "string"
      ? element.textContent?.includes(text)
      : text.test(element.textContent ?? ""),
  );
  expect(match, `menu item ${String(text)}`).toBeTruthy();
  return match as HTMLElement;
}

/** Radix selects on the full pointer gesture, not a bare click. */
function chooseMenuItem(element: HTMLElement): void {
  fireEvent.pointerDown(element, { pointerType: "mouse", button: 0 });
  fireEvent.pointerUp(element, { pointerType: "mouse", button: 0 });
  fireEvent.click(element);
}

describe("building a selection", () => {
  test("Cmd+click selects cards instead of opening their workspaces", () => {
    const { onSelectWorkspace } = mount();
    clickCard("alpha", { metaKey: true });
    clickCard("gamma", { metaKey: true });
    expect(selectedCardIds()).toEqual(["alpha", "gamma"]);
    expect(onSelectWorkspace).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe(
      "2 workspaces selected",
    );
  });

  test("Ctrl+click works the same for non-macOS keyboards", () => {
    mount();
    clickCard("alpha", { ctrlKey: true });
    clickCard("beta", { ctrlKey: true });
    expect(selectedCardIds()).toEqual(["alpha", "beta"]);
  });

  test("Cmd+click on a selected card deselects only that card", () => {
    mount();
    clickCard("alpha", { metaKey: true });
    clickCard("beta", { metaKey: true });
    clickCard("alpha", { metaKey: true });
    expect(selectedCardIds()).toEqual(["beta"]);
  });

  test("Shift+click selects the rendered span between anchor and target", () => {
    mount();
    clickCard("alpha", { metaKey: true });
    clickCard("delta", { shiftKey: true });
    expect(selectedCardIds()).toEqual(["alpha", "beta", "gamma", "delta"]);
  });

  test("a plain click clears the selection and opens that workspace", () => {
    const { onSelectWorkspace } = mount();
    clickCard("alpha", { metaKey: true });
    clickCard("beta", { metaKey: true });
    clickCard("gamma");
    expect(selectedCardIds()).toEqual([]);
    expect(onSelectWorkspace).toHaveBeenCalledWith("ws-gamma");
  });

  test("Escape clears a live selection", () => {
    mount();
    clickCard("alpha", { metaKey: true });
    clickCard("beta", { metaKey: true });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(selectedCardIds()).toEqual([]);
  });

  test("Cmd+Enter and Shift+Enter give the keyboard the same gestures", () => {
    const { onSelectWorkspace } = mount();
    fireEvent.keyDown(selectButton("alpha"), { key: "Enter", metaKey: true });
    fireEvent.keyDown(selectButton("gamma"), { key: "Enter", shiftKey: true });
    expect(selectedCardIds()).toEqual(["alpha", "beta", "gamma"]);
    // A modified key press must never also open the workspace.
    expect(onSelectWorkspace).not.toHaveBeenCalled();
  });

  test("an unmodified Enter is left to the button's own activation", () => {
    const { onSelectWorkspace } = mount();
    fireEvent.keyDown(selectButton("alpha"), { key: "Enter" });
    expect(selectedCardIds()).toEqual([]);
    expect(onSelectWorkspace).not.toHaveBeenCalled();
  });

  test("selected cards expose their pressed state to assistive tech", () => {
    mount();
    clickCard("alpha", { metaKey: true });
    clickCard("beta", { metaKey: true });
    expect(selectButton("alpha").getAttribute("aria-pressed")).toBe("true");
    expect(selectButton("gamma").getAttribute("aria-pressed")).toBe("false");
  });

  test("a worktree that disappears leaves the selection", async () => {
    const { rerender } = mount();
    clickCard("alpha", { metaKey: true });
    clickCard("beta", { metaKey: true });
    expect(selectedCardIds()).toEqual(["alpha", "beta"]);
    rerender(
      <Tooltip.Provider>
        <ProjectList
          groups={[
            {
              project,
              worktrees: worktrees.filter((item) => item.id !== "alpha"),
            },
          ]}
          workspaces={workspaces}
          sessions={[]}
          selectedWorkspaceId=""
          activeSessionId=""
          tabStrip={EMPTY_TAB_STRIP_STATE}
          onSelectSession={() => {}}
          disabled={false}
          addDisabled={false}
          sidebarWidth={300}
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
    await waitFor(() => expect(selectedCardIds()).toEqual(["beta"]));
    expect(screen.getByRole("status").textContent).toBe("1 workspace selected");
  });
});

describe("the bulk context menu", () => {
  test("right-clicking inside the selection opens the counted bulk menu", () => {
    mount();
    clickCard("alpha", { metaKey: true });
    clickCard("beta", { metaKey: true });
    openCardMenu("beta");
    const menu = document.querySelector(
      ".shell-worktree-context-menu",
    ) as HTMLElement;
    expect(menu.getAttribute("aria-label")).toBe("Actions for 2 workspaces");
    expect(menu.textContent).toContain("2 workspaces selected");
    expect(menuItem("Delete 2 workspaces")).toBeTruthy();
    expect(menuItem("Pin 2 workspaces")).toBeTruthy();
    expect(menuItem("Move 2 to Status")).toBeTruthy();
    // The single-card rows that cannot answer for a group are gone.
    expect(menu.textContent).not.toContain("Copy Path\u00a0");
    expect(menu.textContent).not.toContain("Update");
  });

  test("right-clicking outside the selection collapses it to the single-card menu", () => {
    mount();
    clickCard("alpha", { metaKey: true });
    clickCard("beta", { metaKey: true });
    openCardMenu("delta");
    const menu = document.querySelector(
      ".shell-worktree-context-menu",
    ) as HTMLElement;
    expect(menu.getAttribute("aria-label")).toBe(
      "Worktree actions for delta",
    );
    expect(selectedCardIds()).toEqual([]);
  });

  test("Pin N pins every selected workspace through worktree.update", () => {
    const worktreeUpdate = vi.fn(async () => ({ ok: true, result: {} }));
    mount({ worktreeUpdate });
    clickCard("alpha", { metaKey: true });
    clickCard("gamma", { metaKey: true });
    openCardMenu("gamma");
    chooseMenuItem(menuItem("Pin 2 workspaces"));
    expect(worktreeUpdate).toHaveBeenCalledTimes(2);
    expect(worktreeUpdate).toHaveBeenCalledWith({
      worktreeId: "alpha",
      isPinned: true,
    });
    expect(worktreeUpdate).toHaveBeenCalledWith({
      worktreeId: "gamma",
      isPinned: true,
    });
  });

  test("an all-pinned selection offers Unpin and clears the flag on each", () => {
    const worktreeUpdate = vi.fn(async () => ({ ok: true, result: {} }));
    mount({
      groups: [
        {
          project,
          worktrees: worktrees.map((item) => ({ ...item, isPinned: true })),
        },
      ],
      worktreeUpdate,
    });
    clickCard("alpha", { metaKey: true });
    clickCard("beta", { metaKey: true });
    openCardMenu("beta");
    chooseMenuItem(menuItem("Unpin 2 workspaces"));
    expect(worktreeUpdate).toHaveBeenCalledWith({
      worktreeId: "alpha",
      isPinned: false,
    });
    expect(worktreeUpdate).toHaveBeenCalledWith({
      worktreeId: "beta",
      isPinned: false,
    });
  });

  test("Clear Selection leaves every card unselected", () => {
    mount();
    clickCard("alpha", { metaKey: true });
    clickCard("beta", { metaKey: true });
    openCardMenu("beta");
    chooseMenuItem(menuItem("Clear Selection"));
    expect(selectedCardIds()).toEqual([]);
  });
});

describe("bulk delete", () => {
  function openBulkDelete(select: string[] = ["alpha", "beta"]) {
    const onSubmitRemove = vi.fn(
      async (_worktree: Worktree, _force: boolean) => null,
    );
    mount({ onSubmitRemove });
    for (const id of select) clickCard(id, { metaKey: true });
    openCardMenu(select[select.length - 1]!);
    chooseMenuItem(menuItem(/^Delete \d+ workspaces?$/));
    return onSubmitRemove;
  }

  test("confirming deletes every selected workspace through the single-card submit", async () => {
    const onSubmitRemove = openBulkDelete(["alpha", "gamma"]);
    const dialog = screen.getByRole("form", { name: "Delete 2 workspaces" });
    expect(dialog.textContent).toContain("/work/drogon-alpha");
    expect(dialog.textContent).toContain("/work/drogon-gamma");
    fireEvent.click(
      screen.getByRole("button", { name: "Delete 2 workspaces" }),
    );
    await waitFor(() => expect(onSubmitRemove).toHaveBeenCalledTimes(2));
    expect(onSubmitRemove.mock.calls.map((call) => call[0].id)).toEqual([
      "alpha",
      "gamma",
    ]);
    expect(onSubmitRemove.mock.calls.every((call) => call[1] === false)).toBe(
      true,
    );
    await waitFor(() =>
      expect(screen.queryByRole("form", { name: /Delete 2/ })).toBeNull(),
    );
  });

  test("the force option is carried to every removal", async () => {
    const onSubmitRemove = openBulkDelete();
    fireEvent.click(screen.getByLabelText(/^Force:/));
    fireEvent.click(
      screen.getByRole("button", { name: "Delete 2 workspaces" }),
    );
    await waitFor(() => expect(onSubmitRemove).toHaveBeenCalledTimes(2));
    expect(onSubmitRemove.mock.calls.every((call) => call[1] === true)).toBe(
      true,
    );
  });

  test("a partial failure names the workspace that refused and offers a retry of only that one", async () => {
    const onSubmitRemove = vi.fn(async (item: Worktree, _force: boolean) =>
      item.id === "beta" ? "worktree contains modified files" : null,
    );
    mount({ onSubmitRemove });
    clickCard("alpha", { metaKey: true });
    clickCard("beta", { metaKey: true });
    openCardMenu("beta");
    chooseMenuItem(menuItem("Delete 2 workspaces"));
    fireEvent.click(
      screen.getByRole("button", { name: "Delete 2 workspaces" }),
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("beta");
    expect(alert.textContent).toContain("worktree contains modified files");
    // The workspace that really went is dropped from the selection, so a
    // retry cannot ask the daemon to delete it twice.
    await waitFor(() => expect(selectedCardIds()).toEqual(["beta"]));
    onSubmitRemove.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Retry 1" }));
    await waitFor(() => expect(onSubmitRemove).toHaveBeenCalledTimes(1));
    expect(onSubmitRemove.mock.calls[0]![0].id).toBe("beta");
  });

  test("a project's main checkout is kept out of a bulk delete and said so", async () => {
    const onSubmitRemove = vi.fn(
      async (_worktree: Worktree, _force: boolean) => null,
    );
    const mainCheckout = worktree("main-checkout", { path: project.path });
    mount({
      groups: [
        { project, worktrees: [mainCheckout, worktree("alpha")] },
      ],
      onSubmitRemove,
    });
    clickCard("main-checkout", { metaKey: true });
    clickCard("alpha", { metaKey: true });
    openCardMenu("alpha");
    expect(menuItem("Delete 1 workspace")).toBeTruthy();
    chooseMenuItem(menuItem("Delete 1 workspace"));
    const dialog = screen.getByRole("form", { name: "Delete 1 workspace" });
    expect(dialog.textContent).toContain(
      "1 workspace in this selection is a project's main checkout and will be kept.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete 1 workspace" }));
    await waitFor(() => expect(onSubmitRemove).toHaveBeenCalledTimes(1));
    expect(onSubmitRemove.mock.calls[0]![0].id).toBe("alpha");
  });

  test("the bulk confirm shows even when the single-card 'don't ask again' preference is set", () => {
    localStorage.setItem("drogon.skipDeleteWorktreeConfirm", "1");
    const onSubmitRemove = vi.fn(
      async (_worktree: Worktree, _force: boolean) => null,
    );
    mount({ onSubmitRemove });
    clickCard("alpha", { metaKey: true });
    clickCard("beta", { metaKey: true });
    openCardMenu("beta");
    chooseMenuItem(menuItem("Delete 2 workspaces"));
    expect(
      screen.getByRole("form", { name: "Delete 2 workspaces" }),
    ).toBeTruthy();
    expect(onSubmitRemove).not.toHaveBeenCalled();
  });
});
