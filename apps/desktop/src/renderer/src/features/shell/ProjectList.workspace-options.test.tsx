// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc.
   User-feature-closure item 4: proves the "Workspace options" menu's new
   sections act on real, rendered data -- not inert mock UI. Each test
   opens the real menu (Radix pointerDown+click, same gesture
   TabCreateMenu.test.tsx uses), flips one real control, and asserts the
   sidebar's actual rendered cards changed accordingly. */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type {
  Project,
  Session,
  Worktree,
  Workspace,
} from "../../../../shared/session-contract";
import type { ProjectGroup } from "./project-adapter";
import { ProjectList } from "./ProjectList";
import { EMPTY_TAB_STRIP_STATE } from "./tab-order";
import { TooltipProvider } from "../../components/ui/tooltip";

afterEach(() => {
  cleanup();
  localStorage.clear();
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

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "s-1",
    workspaceId: "ws-1",
    hostId: "host-1",
    incarnation: "1",
    command: "/bin/zsh",
    args: [],
    cols: 80,
    rows: 24,
    verdict: "live",
    exitCode: null,
    createdAt: "2026-09-08T10:00:00.000Z",
    ...overrides,
  };
}

function baseProps(overrides: {
  groups?: ProjectGroup[];
  sessions?: Session[];
  workspaces?: Workspace[];
}) {
  return {
    groups: overrides.groups ?? [],
    workspaces: overrides.workspaces ?? [],
    sessions: overrides.sessions ?? [],
    selectedWorkspaceId: "",
    activeSessionId: "",
    tabStrip: EMPTY_TAB_STRIP_STATE,
    onSelectSession: () => {},
    disabled: false,
    addDisabled: false,
    // >= SIDEBAR_HEADER_COMPACT_MIN_WIDTH so the "wide" header (and its
    // OptionsMenuContent) mounts instead of the compact overflow menu.
    sidebarWidth: 300,
    worktreesAvailable: true,
    action: null,
    onSelectWorkspace: () => {},
    onAddProject: () => {},
    onCreateWorkspace: () => {},
    onOpenAction: () => {},
    onCloseAction: () => {},
    onOpenProjectSettings: () => {},
    onBrowse: async () => null,
    onSubmitAdd: async () => null,
    onSubmitRemove: async () => null,
    onSubmitRemoveProject: async () => null,
    onSubmitRename: async () => null,
  };
}

function mount(overrides: {
  groups?: ProjectGroup[];
  sessions?: Session[];
  workspaces?: Workspace[];
}) {
  (window as unknown as { drogon?: unknown }).drogon ??= {};
  return render(
    <TooltipProvider>
      <ProjectList {...baseProps(overrides)} />
    </TooltipProvider>,
  );
}

function openWorkspaceOptionsMenu() {
  const trigger = screen.getByRole("button", { name: /^Workspace options/ });
  fireEvent.pointerDown(trigger, { pointerType: "mouse", button: 0 });
  fireEvent.click(trigger);
}

function projectHeaders(): string[] {
  return screen
    .queryAllByText((_, el) => el?.className === "shell-project-name")
    .map((el) => el.textContent ?? "");
}

/** The card's accessible name is "Select <title>" (WorktreeCard.tsx); the
 *  title itself can collide as plain text with its own branch badge when a
 *  worktree has no explicit title (the display name then falls back to the
 *  branch name), so tests key off this accessible name instead of text. */
function cardTitlesInOrder(): string[] {
  return screen
    .getAllByRole("button", { name: /^Select /})
    .map((el) => (el.getAttribute("aria-label") ?? "").replace(/^Select /, ""));
}

describe("Workspace options: Hide", () => {
  test("hiding sleeping worktrees removes only the sleeping card, live", () => {
    const groups: ProjectGroup[] = [
      {
        project: project(),
        worktrees: [
          worktree({ id: "wt-awake", workspaceId: "ws-awake", title: "Awake" }),
          worktree({ id: "wt-asleep", workspaceId: "ws-asleep", title: "Asleep" }),
        ],
      },
    ];
    const sessions: Session[] = [
      session({ workspaceId: "ws-awake", verdict: "live" }),
    ];
    mount({ groups, sessions });
    expect(screen.getByText("Awake")).toBeTruthy();
    expect(screen.getByText("Asleep")).toBeTruthy();

    openWorkspaceOptionsMenu();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Sleeping" }));

    expect(screen.getByText("Awake")).toBeTruthy();
    expect(screen.queryByText("Asleep")).toBeNull();
  });

  test("hiding default-branch worktrees removes only the main-branch card", () => {
    const groups: ProjectGroup[] = [
      {
        project: project({ defaultBaseRef: "main" }),
        worktrees: [
          worktree({ id: "wt-main", branch: "main", title: "OnMain" }),
          worktree({ id: "wt-feat", branch: "feature", title: "OnFeature" }),
        ],
      },
    ];
    mount({ groups });
    openWorkspaceOptionsMenu();
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "Default branch" }),
    );
    expect(screen.queryByText("OnMain")).toBeNull();
    expect(screen.getByText("OnFeature")).toBeTruthy();
  });

  test("hiding detached HEAD removes only the branchless card", () => {
    const groups: ProjectGroup[] = [
      {
        project: project(),
        worktrees: [
          worktree({ id: "wt-detached", branch: "", title: "Detached" }),
          worktree({ id: "wt-feat", branch: "feature", title: "OnFeature" }),
        ],
      },
    ];
    mount({ groups });
    openWorkspaceOptionsMenu();
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "Detached HEAD" }),
    );
    expect(screen.queryByText("Detached")).toBeNull();
    expect(screen.getByText("OnFeature")).toBeTruthy();
  });

  test("the not-yet-tracked Automation-created / CLI-created rows are disabled, not silently fake", () => {
    mount({ groups: [{ project: project(), worktrees: [worktree()] }] });
    openWorkspaceOptionsMenu();
    const automationRow = screen.getByRole("menuitemcheckbox", {
      name: "Automation-created",
    });
    const cliRow = screen.getByRole("menuitemcheckbox", { name: "CLI-created" });
    expect(automationRow.getAttribute("aria-disabled")).toBe("true");
    expect(cliRow.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("Workspace options: Sort by", () => {
  test("Sort by Name reorders cards alphabetically by title", () => {
    const groups: ProjectGroup[] = [
      {
        project: project(),
        worktrees: [
          worktree({ id: "wt-b", title: "Bravo" }),
          worktree({ id: "wt-a", title: "Alpha" }),
        ],
      },
    ];
    mount({ groups });
    expect(cardTitlesInOrder()).toEqual(["Bravo", "Alpha"]);
    openWorkspaceOptionsMenu();
    fireEvent.click(within(screen.getByRole("menu")).getByText("Name"));
    expect(cardTitlesInOrder()).toEqual(["Alpha", "Bravo"]);
  });
});

describe("Workspace options: Group by", () => {
  test("Group by None hides every project header while keeping the cards", () => {
    const groups: ProjectGroup[] = [
      { project: project({ id: "a", name: "Alpha Repo" }), worktrees: [worktree({ id: "wt-a", projectId: "a", title: "Card A" })] },
      { project: project({ id: "b", name: "Bravo Repo" }), worktrees: [worktree({ id: "wt-b", projectId: "b", title: "Card B" })] },
    ];
    mount({ groups });
    expect(projectHeaders()).toEqual(["Alpha Repo", "Bravo Repo"]);

    openWorkspaceOptionsMenu();
    fireEvent.click(within(screen.getByRole("menu")).getByText("None"));

    expect(projectHeaders()).toEqual([]);
    expect(screen.getByText("Card A")).toBeTruthy();
    expect(screen.getByText("Card B")).toBeTruthy();
  });
});

describe("Workspace options: Show properties", () => {
  test("unchecking Branch hides the branch badge on every card", () => {
    const groups: ProjectGroup[] = [
      {
        project: project(),
        // An explicit title distinct from the branch name so the badge
        // text ("feature-x") can't collide with the card's own title.
        worktrees: [worktree({ branch: "feature-x", title: "My Worktree" })],
      },
    ];
    const { container } = mount({ groups });
    expect(container.querySelector(".shell-worktree-card-branch")).toBeTruthy();

    openWorkspaceOptionsMenu();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Branch" }));

    expect(container.querySelector(".shell-worktree-card-branch")).toBeNull();
    // The card itself, and its title, are untouched -- only the badge is gone.
    expect(screen.getByText("My Worktree")).toBeTruthy();
  });
});

describe("Workspace options: persistence", () => {
  test("a chosen option survives remount (localStorage, drogon:shell:workspace-options)", () => {
    const groups: ProjectGroup[] = [
      {
        project: project({ id: "a", name: "Alpha Repo" }),
        worktrees: [worktree({ projectId: "a" })],
      },
    ];
    const { unmount } = mount({ groups });
    openWorkspaceOptionsMenu();
    fireEvent.click(within(screen.getByRole("menu")).getByText("None"));
    expect(projectHeaders()).toEqual([]);
    unmount();
    cleanup();

    mount({ groups });
    expect(projectHeaders()).toEqual([]);
  });
});
