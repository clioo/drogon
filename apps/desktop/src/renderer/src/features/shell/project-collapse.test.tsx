// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc. Card-level proof for the collapsible
   project sections (the fork's repo-header collapse affordance +
   collapsedGroups store, adapted to this repo's ProjectList): a header
   click or Enter/Space folds the worktree cards, the chevron rotates and
   carries aria-expanded, action clicks never toggle, and the folded
   sections survive a remount through localStorage. */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type {
  Project,
  Worktree,
  Workspace,
} from "../../../../shared/session-contract";
import type { ProjectGroup } from "./project-adapter";
import { ProjectList } from "./ProjectList";
import { INITIAL_SHARED_UI_PREFERENCES } from "./workspace-options-state";
import { EMPTY_TAB_STRIP_STATE } from "./tab-order";
import { TooltipProvider } from "../../components/ui/tooltip";

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete (window as unknown as { drogon?: unknown }).drogon;
});

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    hostId: "host-1",
    path: "/repo",
    name: "repo",
    kind: "git",
    defaultBaseRef: "main",
    ...overrides,
  };
}

function worktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    id: "wt-1",
    projectId: "proj-1",
    workspaceId: "ws-1",
    path: "/repo/wt-1",
    branch: "feature",
    head: "abc123",
    baseRef: null,
    createdAt: "2026-09-08T10:00:00.000Z",
    ...overrides,
  };
}

function groupWithCards(): ProjectGroup {
  return {
    project: project(),
    worktrees: [worktree(), worktree({ id: "wt-2", workspaceId: "ws-2" })],
  };
}

function workspacesFor(groups: ProjectGroup[]): Workspace[] {
  return groups.flatMap((group) =>
    group.worktrees.map((worktree) => ({
      id: worktree.workspaceId,
      path: worktree.path,
      name: worktree.id,
      kind: "git" as const,
      hostId: group.project.hostId,
    })),
  );
}

function mount(groups: ProjectGroup[]) {
  (window as unknown as { drogon?: unknown }).drogon ??= {};
  return render(
    <TooltipProvider>
      <ProjectList
        groups={groups}
        workspaces={workspacesFor(groups)}
        sessions={[]}
        selectedWorkspaceId=""
        activeSessionId=""
        tabStrip={EMPTY_TAB_STRIP_STATE}
        onSelectSession={() => {}}
        disabled={false}
        addDisabled={false}
        sidebarWidth={300}
        worktreesAvailable={true}
        action={null}
        onSelectWorkspace={() => {}}
        onAddProject={() => {}}
        onCreateWorkspace={() => {}}
        onOpenAction={() => {}}
        onCloseAction={() => {}}
        onOpenProjectSettings={() => {}}
        onBrowse={async () => null}
        onSubmitAdd={async () => null}
        onSubmitRemove={async () => null}
        onSubmitRemoveProject={async () => null}
        onSubmitRename={async () => null}
      />
    </TooltipProvider>,
  );
}

function headerRow(): HTMLElement {
  const row = document.querySelector<HTMLElement>(
    '[data-project-header-id="proj-1"]',
  );
  if (!row) throw new Error("project header row not rendered");
  return row;
}

describe("collapsible project sections", () => {
  test("header click folds the cards and flips aria-expanded", () => {
    mount([groupWithCards()]);
    const row = headerRow();
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByText(/wt-/).length).toBeGreaterThan(0);
    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("false");
    // The cards are hidden, not merely blanked.
    expect(screen.queryByText("feature")).toBeNull();
    // The chevron affordance rotated.
    const chevron = row.querySelector("[data-project-header-collapse-affordance] svg");
    expect(chevron?.classList.contains("-rotate-90")).toBe(true);
  });

  test("Enter and Space toggle from the keyboard; other keys do not", () => {
    mount([groupWithCards()]);
    const row = headerRow();
    fireEvent.keyDown(row, { key: "Enter" });
    expect(row.getAttribute("aria-expanded")).toBe("false");
    fireEvent.keyDown(row, { key: " " });
    expect(row.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(row, { key: "a" });
    expect(row.getAttribute("aria-expanded")).toBe("true");
  });

  test("a collapsed section re-mounts folded from localStorage", () => {
    const first = mount([groupWithCards()]);
    fireEvent.click(headerRow());
    first.unmount();
    mount([groupWithCards()]);
    expect(headerRow().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("feature")).toBeNull();
  });

  test("an empty project shows no collapse affordance and its header never folds cards away", () => {
    mount([{ project: project(), worktrees: [] }]);
    const row = headerRow();
    expect(row.getAttribute("aria-expanded")).toBeNull();
    expect(
      row.querySelector("[data-project-header-collapse-affordance]"),
    ).toBeNull();
  });

  test("clicking a header action does not toggle the section", () => {
    const onCreateWorkspace = vi.fn();
    const groups = [groupWithCards()];
    (window as unknown as { drogon?: unknown }).drogon ??= {};
    const view = render(
      <TooltipProvider>
        <ProjectList
          groups={groups}
          workspaces={workspacesFor(groups)}
          sessions={[]}
          selectedWorkspaceId=""
          activeSessionId=""
          tabStrip={EMPTY_TAB_STRIP_STATE}
          onSelectSession={() => {}}
          disabled={false}
          addDisabled={false}
          sidebarWidth={300}
          worktreesAvailable={true}
          action={null}
          onSelectWorkspace={() => {}}
          onAddProject={() => {}}
          onCreateWorkspace={onCreateWorkspace}
          onOpenAction={() => {}}
          onCloseAction={() => {}}
          onOpenProjectSettings={() => {}}
          onBrowse={async () => null}
          onSubmitAdd={async () => null}
          onSubmitRemove={async () => null}
          onSubmitRemoveProject={async () => null}
          onSubmitRename={async () => null}
        />
      </TooltipProvider>,
    );
    const row = headerRow();
    const plus = row.querySelector<HTMLButtonElement>(
      "[data-project-header-action]",
    )!;
    fireEvent.click(plus);
    expect(onCreateWorkspace).toHaveBeenCalledTimes(1);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    view.unmount();
  });
});
