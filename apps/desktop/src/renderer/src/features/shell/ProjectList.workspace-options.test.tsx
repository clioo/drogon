// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc.
   User-feature-closure item 4: proves the "Workspace options" menu's new
   sections act on real, rendered data -- not inert mock UI. Each test
   opens the real menu (Radix pointerDown+click, same gesture
   TabCreateMenu.test.tsx uses), flips one real control, and asserts the
   sidebar's actual rendered cards changed accordingly. */
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  Project,
  Session,
  Worktree,
  Workspace,
} from "../../../../shared/session-contract";
import type { ProjectGroup } from "./project-adapter";
import { ProjectList } from "./ProjectList";
import { INITIAL_SHARED_UI_PREFERENCES } from "./workspace-options-state";
import type {
  WorkspaceUIPreferences,
  WorkspaceUIPreferencesBridge,
} from "../../../../shared/workspace-ui-preferences-contract";
import { EMPTY_TAB_STRIP_STATE } from "./tab-order";
import { TooltipProvider } from "../../components/ui/tooltip";

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete (window as unknown as { drogon?: unknown }).drogon;
});

/**
 * A real, stateful `window.drogon.ui` double: its closure variable plays
 * exactly the role `main/workspace-ui-preferences.ts`'s own JSON file
 * plays in production -- a value that outlives one renderer mount and is
 * read back unchanged by the next. Used only to prove ProjectList.tsx's
 * OWN hydration/persistence wiring (`toSharedUIPreferences`/
 * `fromSharedUIPreferences`/the migration effect); this is the "stub
 * external transport" allowance, not a stub of any grouping/product
 * logic -- the store applies the update exactly as given, same as the
 * main process would.
 */
function makeUiStore(
  seed: WorkspaceUIPreferences = INITIAL_SHARED_UI_PREFERENCES,
): {
  ui: WorkspaceUIPreferencesBridge;
  current: () => WorkspaceUIPreferences;
} {
  let current = seed;
  return {
    current: () => current,
    ui: {
      get: async () => current,
      set: async (partial) => {
        current = { ...current, ...partial };
        return current;
      },
    },
  };
}

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
  onOpenAction?: (action: {
    kind: string;
    worktreeId?: string;
    projectId?: string;
  }) => void;
  onSubmitRemove?: (
    worktree: Worktree,
    force: boolean,
  ) => Promise<string | null>;
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
    onOpenAction: overrides.onOpenAction ?? (() => {}),
    onCloseAction: () => {},
    onOpenProjectSettings: () => {},
    onBrowse: async () => null,
    onSubmitAdd: async () => null,
    onSubmitRemove: overrides.onSubmitRemove ?? (async () => null),
    onSubmitRemoveProject: async () => null,
    onSubmitRename: async () => null,
  };
}

function mount(overrides: {
  groups?: ProjectGroup[];
  sessions?: Session[];
  workspaces?: Workspace[];
  onOpenAction?: (action: {
    kind: string;
    worktreeId?: string;
    projectId?: string;
  }) => void;
  onSubmitRemove?: (
    worktree: Worktree,
    force: boolean,
  ) => Promise<string | null>;
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
    .getAllByRole("button", { name: /^Select / })
    .map((el) => (el.getAttribute("aria-label") ?? "").replace(/^Select /, ""));
}

describe("Workspace options: viewport/keyboard reachability (packaged acceptance regression)", () => {
  /** The real hidden desktop acceptance run failed a real Playwright
   *  locator.click() on "Add Project" -- "element is outside of the
   *  viewport" -- because the menu body (Group by/Sort by/Project
   *  order/Card layout/Show properties/Hide) had grown past the real
   *  600px-tall test window with no scroll affordance. jsdom does no
   *  real layout, so the pixel-geometry failure itself can't be
   *  reproduced here; these tests instead pin the two guarantees that
   *  together make it unreachable-by-pointer impossible in the real
   *  browser: (1) the live container Radix actually renders is the CSS
   *  class carrying the height bound + scroll (sidebar-menu-viewport.
   *  test.ts pins the rule itself), and (2) every trailing control,
   *  "Add Project" included, is still reachable by real keyboard
   *  navigation regardless of scroll position. */
  test("the real rendered menu container is the CSS-bounded, scrollable one (not an unbounded stand-in)", () => {
    const groups: ProjectGroup[] = [
      { project: project(), worktrees: [worktree()] },
    ];
    mount({ groups });
    openWorkspaceOptionsMenu();
    const menu = screen.getByRole("menu");
    expect(menu.className).toContain("sidebar-menu");
  });

  test("every option, Add Project, and the filter box are all real descendants of that one bounded/scrollable menu", () => {
    const groups: ProjectGroup[] = [
      { project: project(), worktrees: [worktree()] },
    ];
    mount({ groups });
    openWorkspaceOptionsMenu();
    const menu = screen.getByRole("menu");
    // Group by / Sort by / Project order / Card layout options (one
    // unambiguous label picked per section -- several labels repeat
    // verbatim across sections, e.g. "Project"/"Recent"/"Manual", so those
    // are covered via the count below instead).
    expect(
      within(menu).getByRole("menuitemradio", { name: "Status" }),
    ).toBeTruthy();
    expect(
      within(menu).getByRole("menuitemradio", { name: "Agent Activity" }),
    ).toBeTruthy();
    expect(
      within(menu).getByRole("menuitemradio", { name: "Compact" }),
    ).toBeTruthy();
    expect(
      within(menu).getAllByRole("menuitemradio", {
        name: "Manual",
      }),
    ).toHaveLength(2); // Sort by + Project order
    // Show properties / Hide checkboxes.
    expect(
      within(menu).getByRole("menuitemcheckbox", { name: "PR/MR link" }),
    ).toBeTruthy();
    expect(
      within(menu).getByRole("menuitemcheckbox", { name: "CLI-created" }),
    ).toBeTruthy();
    // The two controls the real acceptance run could not reach.
    expect(
      within(menu).getByRole("menuitem", { name: "Add Project" }),
    ).toBeTruthy();
    expect(
      within(menu).getByRole("textbox", {
        name: "Filter projects and worktrees",
      }),
    ).toBeTruthy();
  });

  test("keyboard End from inside the menu reaches Add Project without depending on scroll position or pointer geometry", () => {
    const groups: ProjectGroup[] = [
      { project: project(), worktrees: [worktree()] },
    ];
    mount({ groups });
    openWorkspaceOptionsMenu();
    const menu = screen.getByRole("menu");
    const addProject = within(menu).getByRole("menuitem", {
      name: "Add Project",
    });

    // Radix's roving-focus group auto-focuses the first real item on
    // open; jump to the end of that same real keyboard order.
    expect(menu.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "End" });

    expect(document.activeElement).toBe(addProject);
  });
});

describe("Workspace options: Hide", () => {
  test("hiding sleeping worktrees removes only the sleeping card, live", () => {
    const groups: ProjectGroup[] = [
      {
        project: project(),
        worktrees: [
          worktree({ id: "wt-awake", workspaceId: "ws-awake", title: "Awake" }),
          worktree({
            id: "wt-asleep",
            workspaceId: "ws-asleep",
            title: "Asleep",
          }),
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

  test("hiding CLI-created worktrees removes only the card the CLI created (real Worktree.creator, schema v5)", () => {
    const groups: ProjectGroup[] = [
      {
        project: project(),
        worktrees: [
          worktree({ id: "wt-cli", title: "FromCli", creator: "cli" }),
          worktree({ id: "wt-desktop", title: "FromDesktop", creator: null }),
        ],
      },
    ];
    mount({ groups });
    const cliRow = () =>
      screen.getByRole("menuitemcheckbox", { name: "CLI-created" });
    expect(screen.getByText("FromCli")).toBeTruthy();

    openWorkspaceOptionsMenu();
    expect(cliRow().getAttribute("aria-disabled")).not.toBe("true");
    fireEvent.click(cliRow());

    expect(screen.queryByText("FromCli")).toBeNull();
    expect(screen.getByText("FromDesktop")).toBeTruthy();
  });

  test("the Automation-created row is real (not disabled) even though no producer exists in this build yet", () => {
    // RunUnsupported::NewPerRunWorkspaceMode is unwired everywhere in the
    // automations subsystem today, so no worktree in this fixture can
    // ever carry creator: "automation" -- the control still must not be
    // presented as disabled/fake, since the filter itself is real.
    const groups: ProjectGroup[] = [
      { project: project(), worktrees: [worktree({ title: "Only" })] },
    ];
    mount({ groups });
    openWorkspaceOptionsMenu();
    const automationRow = screen.getByRole("menuitemcheckbox", {
      name: "Automation-created",
    });
    expect(automationRow.getAttribute("aria-disabled")).not.toBe("true");
    fireEvent.click(automationRow);
    // Nothing in this fixture is automation-created, so nothing is hidden.
    expect(screen.getByText("Only")).toBeTruthy();
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
      {
        project: project({ id: "a", name: "Alpha Repo" }),
        worktrees: [worktree({ id: "wt-a", projectId: "a", title: "Card A" })],
      },
      {
        project: project({ id: "b", name: "Bravo Repo" }),
        worktrees: [worktree({ id: "wt-b", projectId: "b", title: "Card B" })],
      },
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
  test("the branch identity shows on every card like the source's classic meta row", () => {
    const groups: ProjectGroup[] = [
      {
        project: project(),
        // An explicit title distinct from the branch name so the badge
        // text ("feature-x") can't collide with the card's own title.
        worktrees: [worktree({ branch: "feature-x", title: "My Worktree" })],
      },
    ];
    const { container } = mount({ groups });
    // The fork's classic meta row shows the branch identity whenever the
    // worktree has one, independent of the Branch display property (which
    // gates only the ahead/behind chips).
    const branch = container.querySelector(".shell-worktree-card-branch");
    expect(branch?.textContent).toBe("feature-x");
    openWorkspaceOptionsMenu();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Branch" }));
    expect(container.querySelector(".shell-worktree-card-branch")?.textContent).toBe(
      "feature-x",
    );
    // The card itself, and its title, are untouched.
    expect(screen.getByText("My Worktree")).toBeTruthy();
  });
});

describe("Workspace options: persistence", () => {
  test("a chosen option survives remount through the shared window.drogon.ui store, not a private localStorage authority", async () => {
    const groups: ProjectGroup[] = [
      {
        project: project({ id: "a", name: "Alpha Repo" }),
        worktrees: [worktree({ projectId: "a" })],
      },
    ];
    const store = makeUiStore();
    (window as unknown as { drogon: Record<string, unknown> }).drogon = {
      ui: store.ui,
    };
    const { unmount } = mount({ groups });
    await waitFor(() => expect(store.current().groupBy).toBe("repo"));
    openWorkspaceOptionsMenu();
    fireEvent.click(within(screen.getByRole("menu")).getByText("None"));
    await waitFor(() => expect(projectHeaders()).toEqual([]));
    // The write landed on the SHARED store (main/workspace-ui-preferences.ts's
    // real would-be persistence target), not a parallel localStorage key.
    expect(store.current().groupBy).toBe("none");
    expect(localStorage.getItem("drogon:shell:workspace-options")).toBeNull();
    unmount();
    cleanup();

    // "Reload": a fresh mount against the SAME store (its closure variable
    // outlived the unmount, exactly like the main process's own JSON file
    // outlives a renderer reload).
    mount({ groups });
    await waitFor(() => expect(projectHeaders()).toEqual([]));
  });

  test("a legacy localStorage profile migrates into the shared store exactly once", async () => {
    const groups: ProjectGroup[] = [
      {
        project: project({ id: "a", name: "Alpha Repo" }),
        worktrees: [worktree({ projectId: "a" })],
      },
    ];
    localStorage.setItem(
      "drogon:shell:workspace-options",
      JSON.stringify({
        groupBy: "none",
        sortBy: "name",
        projectOrderBy: "manual",
        cardLayout: "comfortable",
        showProperties: { branch: true, pr: true },
        hide: {
          sleeping: false,
          defaultBranch: false,
          detachedHead: false,
          automationCreated: false,
          cliCreated: false,
        },
      }),
    );
    const store = makeUiStore();
    (window as unknown as { drogon: Record<string, unknown> }).drogon = {
      ui: store.ui,
    };
    mount({ groups });
    await waitFor(() => expect(store.current().groupBy).toBe("none"));
    expect(store.current().sortBy).toBe("name");
  });
});

/** Finds the specific card by worktree id, right-clicks its own context
 *  menu scope (`.closest`, since every card renders the same generic
 *  `data-worktree-context-menu-scope="worktree"` marker -- there is one
 *  per card, not one for the whole list), and clicks "Delete". Mirrors
 *  worktree-delete-menu.test.tsx's own gesture. */
function clickDeleteForWorktree(worktreeId: string): void {
  const cardRoot = document.querySelector(
    `[data-worktree-card-id="${worktreeId}"]`,
  );
  expect(cardRoot).toBeTruthy();
  const scope = (cardRoot as HTMLElement).closest(
    '[data-worktree-context-menu-scope="worktree"]',
  ) as HTMLElement;
  expect(scope).toBeTruthy();
  fireEvent.contextMenu(scope, { clientX: 50, clientY: 50 });
  const item = Array.from(
    document.querySelectorAll<HTMLElement>(
      ".shell-worktree-context-menu-item-destructive",
    ),
  ).find((el) => el.textContent?.includes("Delete"));
  expect(item).toBeTruthy();
  fireEvent.pointerDown(item!, { pointerType: "mouse", button: 0 });
  fireEvent.pointerUp(item!, { pointerType: "mouse", button: 0 });
  fireEvent.click(item!);
}

describe("Workspace options: Group by (cross-project)", () => {
  test("Group by Status moves cards from two different projects under one real status label, and an action still targets the real owning worktree", () => {
    const groups: ProjectGroup[] = [
      {
        project: project({ id: "a", name: "Alpha Repo" }),
        worktrees: [
          worktree({
            id: "wa",
            projectId: "a",
            branch: "feature-a",
            workspaceStatus: "in-review",
            title: "Card A",
          }),
        ],
      },
      {
        project: project({ id: "b", name: "Bravo Repo" }),
        worktrees: [
          worktree({
            id: "wb",
            projectId: "b",
            branch: "feature-b",
            workspaceStatus: "in-review",
            title: "Card B",
          }),
        ],
      },
    ];
    const onOpenAction = vi.fn();
    mount({ groups, onOpenAction });

    // The real default (groupBy: "repo") shows two separate real project headers.
    expect(projectHeaders()).toEqual(["Alpha Repo", "Bravo Repo"]);

    openWorkspaceOptionsMenu();
    fireEvent.click(
      within(screen.getByRole("menu")).getByText("Status"),
    );

    // One real status label header; both projects' cards render under it.
    expect(projectHeaders()).toEqual(["In review"]);
    expect(cardTitlesInOrder()).toEqual(["Card A", "Card B"]);

    // Delete on project B's card must still target project B's real
    // worktree, never project A's or a synthetic bucket id, even though
    // both now render under the same "In review" header.
    clickDeleteForWorktree("wb");
    expect(onOpenAction).toHaveBeenCalledWith({
      kind: "remove",
      worktreeId: "wb",
    });
    expect(onOpenAction).not.toHaveBeenCalledWith({
      kind: "remove",
      worktreeId: "wa",
    });
  });

  test("Group by PR buckets by real fetched pull-request state per project; an unfetched/failed project's cards land under 'PR status unavailable', never a false 'no pull request'", async () => {
    const groups: ProjectGroup[] = [
      {
        project: project({ id: "a", name: "Alpha Repo" }),
        worktrees: [
          worktree({
            id: "wa",
            projectId: "a",
            branch: "feature-a",
            title: "Card A",
          }),
        ],
      },
      {
        project: project({ id: "b", name: "Bravo Repo" }),
        worktrees: [
          worktree({
            id: "wb",
            projectId: "b",
            branch: "feature-b",
            title: "Card B",
          }),
        ],
      },
    ];
    const tasksList = vi.fn(async ({ projectId }: { projectId: string }) => {
      if (projectId === "a") {
        return {
          ok: true,
          result: {
            repo: "example/alpha",
            issues: [],
            pulls: [
              {
                number: 1,
                title: "Add the feature",
                state: "open",
                labels: [],
                assignees: [],
                isDraft: false,
                headRefName: "feature-a",
                updatedAt: "2026-09-09T00:00:00Z",
                url: "https://github.com/example/alpha/pull/1",
              },
            ],
            page: 1,
            perPage: 36,
            hasNextPage: false,
          },
        };
      }
      // Project B's own fetch genuinely fails (gh missing/unauthenticated).
      return {
        ok: false,
        error: {
          code: "gh_unavailable",
          message: "gh is not installed",
          retryable: false,
        },
      };
    });
    (window as unknown as { drogon: Record<string, unknown> }).drogon = {
      tasks: { tasksList },
    };
    mount({ groups });

    openWorkspaceOptionsMenu();
    fireEvent.click(within(screen.getByRole("menu")).getByText("PR"));

    await waitFor(() => expect(tasksList).toHaveBeenCalled());
    await waitFor(() =>
      expect([...projectHeaders()].sort()).toEqual(
        ["Open", "PR status unavailable"].sort(),
      ),
    );
    const openHeader = screen
      .getByText("Open")
      .closest(".shell-project") as HTMLElement;
    expect(within(openHeader).getByText("Card A")).toBeTruthy();
    const unavailableHeader = screen
      .getByText("PR status unavailable")
      .closest(".shell-project") as HTMLElement;
    expect(within(unavailableHeader).getByText("Card B")).toBeTruthy();
  });
});

describe("Workspace options: manual reorder persists canonical ranks", () => {
  /** Gives an element a fixed `getBoundingClientRect` -- the standard
   *  jsdom technique for driving pixel-geometry-dependent code (jsdom
   *  itself always returns an all-zero rect). */
  function stubRect(
    element: Element,
    rect: { top: number; bottom: number; left?: number; right?: number },
  ): void {
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left ?? 0,
      right: rect.right ?? 200,
      width: (rect.right ?? 200) - (rect.left ?? 0),
      height: rect.bottom - rect.top,
      x: rect.left ?? 0,
      y: rect.top,
      toJSON: () => ({}),
    });
  }

  test("dragging the top card to the end of its project persists the canonical manualOrder ranks, surviving a reload", async () => {
    const groups: ProjectGroup[] = [
      {
        project: project({ id: "a", name: "Alpha Repo" }),
        worktrees: [
          worktree({ id: "w1", projectId: "a", title: "One" }),
          worktree({ id: "w2", projectId: "a", title: "Two" }),
          worktree({ id: "w3", projectId: "a", title: "Three" }),
        ],
      },
    ];
    const worktreeUpdate = vi.fn(
      async ({
        worktreeId,
        manualOrder,
      }: {
        worktreeId: string;
        manualOrder: number;
      }) => ({
        ok: true,
        result: { id: worktreeId, manualOrder },
      }),
    );
    (window as unknown as { drogon: Record<string, unknown> }).drogon = {
      project: { worktreeUpdate },
    };

    const { container } = render(
      <TooltipProvider>
        <div className="shell-sidebar-scroll">
          <ProjectList {...baseProps({ groups })} />
        </div>
      </TooltipProvider>,
    );
    const scrollContainer = container.querySelector(
      ".shell-sidebar-scroll",
    ) as HTMLElement;
    stubRect(scrollContainer, { top: 0, bottom: 400 });
    Object.defineProperty(scrollContainer, "scrollTop", {
      value: 0,
      configurable: true,
    });
    Object.defineProperty(scrollContainer, "scrollHeight", {
      value: 400,
      configurable: true,
    });
    Object.defineProperty(scrollContainer, "clientHeight", {
      value: 400,
      configurable: true,
    });

    // Three 40px-tall bands, top to bottom, in their initial render order.
    const cardBands: Record<string, { top: number; bottom: number }> = {
      w1: { top: 0, bottom: 40 },
      w2: { top: 40, bottom: 80 },
      w3: { top: 80, bottom: 120 },
    };
    for (const [id, band] of Object.entries(cardBands)) {
      const cardEl = container.querySelector(
        `[data-worktree-card-id="${id}"]`,
      ) as HTMLElement;
      stubRect(cardEl, band);
    }
    const sourceRow = container.querySelector(
      '[data-worktree-card-id="w1"]',
    ) as HTMLElement;

    // Drag card "w1" (top) from its own top edge down past every other
    // card's bottom -- an unambiguous "drop at the end" gesture.
    fireEvent.pointerDown(sourceRow, {
      pointerId: 1,
      button: 0,
      pointerType: "mouse",
      clientX: 10,
      clientY: 0,
    });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 10, clientY: 180 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 180 });

    await waitFor(() => expect(worktreeUpdate).toHaveBeenCalled());
    // The canonical stride-1000 ranks for the new order [w2, w3, w1]
    // (higher renders first): w2=3000, w3=2000, w1=1000.
    expect(worktreeUpdate).toHaveBeenCalledWith({
      worktreeId: "w2",
      manualOrder: 3000,
    });
    expect(worktreeUpdate).toHaveBeenCalledWith({
      worktreeId: "w3",
      manualOrder: 2000,
    });
    expect(worktreeUpdate).toHaveBeenCalledWith({
      worktreeId: "w1",
      manualOrder: 1000,
    });

    // The rendered order reflects the new arrangement immediately (the
    // optimistic overlay), before any reload.
    await waitFor(() =>
      expect(cardTitlesInOrder()).toEqual(["Two", "Three", "One"]),
    );

    cleanup();

    // "Reload": a fresh mount fed the worktrees with the EXACT
    // `manualOrder` values just persisted (what a real `groups` refresh
    // would carry back down) -- the canonical rank, read back from the
    // real Worktree fields, not the transient drag-session state.
    const reloaded: ProjectGroup[] = [
      {
        project: project({ id: "a", name: "Alpha Repo" }),
        worktrees: [
          worktree({
            id: "w1",
            projectId: "a",
            title: "One",
            manualOrder: 1000,
          }),
          worktree({
            id: "w2",
            projectId: "a",
            title: "Two",
            manualOrder: 3000,
          }),
          worktree({
            id: "w3",
            projectId: "a",
            title: "Three",
            manualOrder: 2000,
          }),
        ],
      },
    ];
    mount({ groups: reloaded });
    expect(cardTitlesInOrder()).toEqual(["Two", "Three", "One"]);
  });
});

test.each(["none", "repo", "workspace-status", "pr-status"] as const)(
  "known PR property reaches the real card in %s grouping and can be hidden",
  async (groupBy) => {
    const store = makeUiStore({ ...INITIAL_SHARED_UI_PREFERENCES, groupBy });
    (window as unknown as { drogon: Record<string, unknown> }).drogon = {
      ui: store.ui,
      tasks: {
        tasksList: async () => ({
          ok: true,
          result: {
            pulls: [
              {
                number: 7,
                title: "Review feature",
                state: "open",
                url: "https://github.com/example/repo/pull/7",
                headRefName: "feature",
              },
            ],
          },
        }),
      },
    };
    mount({ groups: [{ project: project(), worktrees: [worktree()] }] });
    await waitFor(() =>
      expect(screen.getByLabelText("Linked PR #7: Open")).toBeTruthy(),
    );
    openWorkspaceOptionsMenu();
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "PR/MR link" }),
    );
    await waitFor(() =>
      expect(screen.queryByLabelText("Linked PR #7: Open")).toBeNull(),
    );
    expect(store.current().worktreeCardProperties).not.toContain("pr");
  },
);

for (const provider of ["linear", "jira"] as const)
  test.each(["none", "repo", "workspace-status", "pr-status"] as const)(
    `${provider} associations reach the real card in %s grouping and retain independent visibility`,
    async (groupBy) => {
      const store = makeUiStore({ ...INITIAL_SHARED_UI_PREFERENCES, groupBy });
      const issueLinks = vi.fn(async () => ({
        ok: true,
        result: {
          links: [
            {
              worktreeId: "wt-1",
              provider: "linear",
              identifier: "ENG-123",
              title: "Linked Linear work",
              url: "https://linear.app/team/issue/ENG-123",
            },
            {
              worktreeId: "wt-1",
              provider: "jira",
              identifier: "KAN-1",
              title: "Linked Jira work",
              url: "https://example.atlassian.net/browse/KAN-1",
            },
          ],
        },
      }));
      (window as unknown as { drogon: Record<string, unknown> }).drogon = {
        ui: store.ui,
        project: { worktreeIssueLinks: issueLinks },
        status: async () => ({
          ok: true,
          result: {
            hostId: "host-1",
            capabilities: ["worktree.issue-links.v1"],
          },
        }),
      };
      mount({ groups: [{ project: project(), worktrees: [worktree()] }] });
      await waitFor(() => expect(screen.getByText("ENG-123")).toBeTruthy());
      expect(screen.getByText("KAN-1")).toBeTruthy();
      expect(issueLinks.mock.calls).toEqual([[{ projectId: "proj-1" }]]);
      openWorkspaceOptionsMenu();
      fireEvent.click(
        screen.getByRole("menuitemcheckbox", {
          name: provider === "linear" ? "Linear issue" : "Jira issue",
        }),
      );
      await waitFor(() =>
        expect(
          screen.queryByText(provider === "linear" ? "ENG-123" : "KAN-1"),
        ).toBeNull(),
      );
      expect(
        screen.getByText(provider === "linear" ? "KAN-1" : "ENG-123"),
      ).toBeTruthy();
      expect(store.current().worktreeCardProperties).not.toContain(
        `${provider}-issue`,
      );
    },
  );

test("Ports property stays off by default, renders this workspace's attributed listener once opted in, and persists the off choice", async () => {
  const store = makeUiStore();
  // The default preset no longer carries `ports` (owner directive: port
  // numbers on cards are unwanted), so the host scan is never requested.
  expect(store.current().worktreeCardProperties).not.toContain("ports");
  const list = vi.fn(async () => ({
    ok: true,
    result: {
      platform: "darwin",
      scannedAt: 1,
      unavailableReason: null,
      ports: [
        {
          id: "port",
          bindHost: "127.0.0.1",
          connectHost: "127.0.0.1",
          port: 4317,
          pid: 123,
          processName: "node",
          protocol: "http",
          kind: "workspace",
          owner: {
            workspaceId: "ws-1",
            displayName: "Workspace",
            confidence: "cwd",
          },
        },
      ],
    },
  }));
  (window as unknown as { drogon: Record<string, unknown> }).drogon = {
    ui: store.ui,
    status: async () => ({ ok: true, result: { hostId: "host-1" } }),
    workspacePorts: { list },
  };
  mount({
    groups: [{ project: project(), worktrees: [worktree()] }],
    workspaces: [
      {
        id: "ws-1",
        path: "/repo/wt-1",
        name: "Workspace",
        kind: "git",
        hostId: "host-1",
      },
    ],
  });
  await waitFor(() => expect(screen.getByText("Workspace")).toBeTruthy());
  expect(screen.queryByText(":4317")).toBeNull();
  expect(list).not.toHaveBeenCalled();
  // Opting in through the real menu renders the attributed listener and
  // starts the real host scan.
  openWorkspaceOptionsMenu();
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Ports" }));
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  await waitFor(() => expect(screen.getByText(":4317")).toBeTruthy());
  expect(list).toHaveBeenCalledTimes(1);
  // Toggling it back off hides the labels and persists the choice.
  openWorkspaceOptionsMenu();
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Ports" }));
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  await waitFor(() => expect(screen.queryByText(":4317")).toBeNull());
  expect(store.current().worktreeCardProperties).not.toContain("ports");
});
