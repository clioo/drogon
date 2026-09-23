// @vitest-environment jsdom
/* The owner's run_4573e2eb (2026-09-21), mounted through the real Sidebar:
   a Pi coordinator in the `collapsable-widgets` worktree dispatched workers
   into clones under its own `.preflight/`, which no project lists as a
   worktree. The coordinator's card showed only the coordinator, and the
   live workers were drawn nowhere. They now render in the coordinator's
   card, nested under the row that started them, and activating one opens
   it in its own workspace. */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type {
  Project,
  Session,
  Worktree,
  Workspace,
} from "../../../../shared/session-contract";
import type { ProjectGroup } from "./project-adapter";
import { Sidebar } from "./Sidebar";
import { WorktreeCard } from "./WorktreeCard";
import { SidebarCardAttributionContext } from "./sidebar-card-attribution";
import { EMPTY_TAB_STRIP_STATE } from "./tab-order";
import { clearWorktreeAgentExpansionStateForTests } from "./worktree-card-agents-expansion-state";
import { TooltipProvider } from "../../components/ui/tooltip";

afterEach(() => {
  cleanup();
  localStorage.clear();
  clearWorktreeAgentExpansionStateForTests();
});

const REPO = "/Users/owner/Documents/Drogon";
const WORKTREES = "/Users/owner/Drogon/workspaces/Drogon";
const COORD_PATH = `${WORKTREES}/collapsable-widgets`;
const CLONE_PATH = `${COORD_PATH}/.preflight/sidebar-recovery/workspaces/sidebar-agent-truth`;

const project: Project = {
  id: "proj-drogon",
  hostId: "host-1",
  path: REPO,
  name: "Drogon",
  kind: "git",
  defaultBaseRef: "main",
};

function worktree(id: string, workspaceId: string, path: string): Worktree {
  return {
    id,
    projectId: project.id,
    workspaceId,
    path,
    branch: id,
    head: "abc123",
    baseRef: null,
    createdAt: "2026-09-20T22:56:00.000Z",
  };
}

const groups: ProjectGroup[] = [
  {
    project,
    worktrees: [
      worktree("wt-coord", "ws-coord", COORD_PATH),
      worktree("wt-bug-bot", "ws-bug-bot", `${WORKTREES}/bug-bot`),
    ],
  },
];

const workspaces: Workspace[] = [
  { id: "ws-coord", path: COORD_PATH, name: "collapsable-widgets", kind: "git", hostId: "host-1" },
  { id: "ws-bug-bot", path: `${WORKTREES}/bug-bot`, name: "bug-bot", kind: "git", hostId: "host-1" },
  // Registered with `drogon-cli workspace add` for `worker-start`: a
  // workspace, but not a worktree of any project, so it has no card.
  { id: "ws-clone", path: CLONE_PATH, name: "sidebar-agent-truth", kind: "git", hostId: "host-1" },
];

function session(
  id: string,
  workspaceId: string,
  overrides: Partial<Session> = {},
): Session {
  return {
    id,
    workspaceId,
    hostId: "host-1",
    incarnation: "1",
    command: "/bin/zsh",
    args: [],
    cols: 80,
    rows: 24,
    verdict: "live",
    exitCode: null,
    createdAt: "2026-09-21T20:00:00.000Z",
    agentState: "working",
    agentStateAt: "2026-09-21T20:59:00.000Z",
    // A live run on a current daemon: hook turn states carry the hook
    // proof (R1) — the coordinator shell, the owner's idle Pi tab and
    // the worker are all hook-proven, so the card reads them as
    // working/idle instead of unknown.
    agentStateAuthority: "hook",
    harnessId: null,
    parentSessionId: null,
    ...overrides,
  };
}

function mount(sessions: Session[]) {
  (window as unknown as { drogon?: unknown }).drogon ??= {};
  const onSelectWorkspace = vi.fn();
  const onSelectSession = vi.fn();
  const view = render(
    <TooltipProvider>
      <Sidebar
        open
        width={300}
        onWidthChange={() => {}}
        route={null}
        onSelectRoute={() => {}}
        onOpenPalette={() => {}}
        groups={groups}
        workspaces={workspaces}
        sessions={sessions}
        selectedWorkspaceId="ws-coord"
        activeSessionId=""
        tabStrip={EMPTY_TAB_STRIP_STATE}
        onSelectSession={onSelectSession}
        workspaceDisabled={false}
        addDisabled={false}
        onSelectWorkspace={onSelectWorkspace}
        onAddProject={() => {}}
        onCreateWorkspace={() => {}}
        worktreesAvailable
        projectAction={null}
        onOpenProjectAction={() => {}}
        onCloseProjectAction={() => {}}
        onBrowseProject={async () => null}
        onSubmitAddProject={async () => null}
        onSubmitRemoveWorktree={async () => null}
        onSubmitRemoveProject={async () => null}
        onSubmitRenameWorktree={async () => null}
        onOpenProjectSettings={() => {}}
        onOpenSettings={() => {}}
      />
    </TooltipProvider>,
  );
  const card = (id: string) =>
    view.container.querySelector<HTMLElement>(`[data-worktree-card-id='${id}']`);
  const rowIds = (root: HTMLElement | null) =>
    [...(root?.querySelectorAll("[data-worktree-agent-row]") ?? [])].map((el) =>
      el.getAttribute("data-worktree-agent-row"),
    );
  return { view, card, rowIds, onSelectWorkspace, onSelectSession };
}

/** The coordinator shell (Pi runs inside `Terminal 1 - zsh`), the owner's
 *  idle Pi tab, and one live worker in the card-less clone. */
function runSessions(workerParent: string | null): Session[] {
  return [
    session("coord-shell", "ws-coord", { createdAt: "2026-09-20T22:56:28.000Z" }),
    session("pi-idle", "ws-coord", {
      harnessId: "pi",
      agentState: "idle",
      createdAt: "2026-09-22T02:37:47.000Z",
    }),
    session("worker-f1", "ws-clone", {
      harnessId: "pi",
      command: "pi",
      parentSessionId: workerParent,
      createdAt: "2026-09-22T02:40:02.000Z",
    }),
  ];
}

describe("Sidebar: orchestration workers in card-less checkouts", () => {
  test("a worker with a recorded parent nests under it in the coordinator's card", () => {
    const { card, rowIds } = mount(runSessions("coord-shell"));
    const coordinator = card("wt-coord");
    expect(rowIds(coordinator)).toContain("worker-f1");
    const children = coordinator!.querySelector(".worktree-agent-lineage-children");
    expect(children, "the worker must render in the parent's lineage box").not.toBeNull();
    expect(rowIds(children as HTMLElement)).toEqual(["worker-f1"]);
    // Drawn once: no other card lists it.
    expect(rowIds(card("wt-bug-bot"))).not.toContain("worker-f1");
    // The card's sentence counts the rows it draws: the coordinator shell
    // and the worker are working, the owner's Pi tab is idle.
    expect(coordinator!.textContent).toContain("2 AGENTS WORKING");
    expect(card("wt-bug-bot")!.textContent).toContain("NO SESSION");
  });

  test("a worker without a recorded parent still shows, as a root row of the card that holds its clone", () => {
    // What the owner's pre-#622 daemon produced: parentSessionId null.
    const { card, rowIds } = mount(runSessions(null));
    const coordinator = card("wt-coord");
    expect(rowIds(coordinator)).toContain("worker-f1");
    expect(coordinator!.querySelector(".worktree-agent-lineage-children")).toBeNull();
  });

  test("activating an adopted worker row opens it in its own workspace", () => {
    const { card, onSelectWorkspace, onSelectSession } = mount(
      runSessions("coord-shell"),
    );
    const row = card("wt-coord")!.querySelector<HTMLElement>(
      "[data-worktree-agent-row='worker-f1']",
    );
    fireEvent.click(row!);
    expect(onSelectWorkspace).toHaveBeenLastCalledWith("ws-clone");
    expect(onSelectSession).toHaveBeenLastCalledWith("worker-f1");
  });

  test("the coordinator's own rows still open in the coordinator's workspace", () => {
    const { card, onSelectWorkspace } = mount(runSessions("coord-shell"));
    const row = card("wt-coord")!.querySelector<HTMLElement>(
      "[data-worktree-agent-row='coord-shell']",
    );
    fireEvent.click(row!);
    expect(onSelectWorkspace).toHaveBeenLastCalledWith("ws-coord");
  });
});

describe("WorktreeCard: the Sidebar's card attribution", () => {
  function renderCoordinatorCard(attribution: Map<string, string> | null) {
    (window as unknown as { drogon?: unknown }).drogon ??= {};
    const onSelect = vi.fn();
    const card = (
      <WorktreeCard
        worktree={groups[0]!.worktrees[0]!}
        workspaces={workspaces}
        sessions={runSessions("coord-shell")}
        selected
        disabled={false}
        projectKind="git"
        implicitFolderWorktree={false}
        onSelect={onSelect}
        onSelectSession={() => {}}
        activeSessionId=""
        tabStrip={EMPTY_TAB_STRIP_STATE}
        onRemove={null}
        onRename={null}
      />
    );
    const view = render(
      <TooltipProvider>
        {attribution ? (
          <SidebarCardAttributionContext.Provider value={attribution}>
            {card}
          </SidebarCardAttributionContext.Provider>
        ) : (
          card
        )}
      </TooltipProvider>,
    );
    const rowIds = [
      ...view.container.querySelectorAll("[data-worktree-agent-row]"),
    ].map((el) => el.getAttribute("data-worktree-agent-row"));
    return { view, rowIds, onSelect };
  }

  test("rendered alone, a card lists only its own workspace's sessions", () => {
    const { rowIds } = renderCoordinatorCard(null);
    expect(rowIds.sort()).toEqual(["coord-shell", "pi-idle"]);
  });

  test("inside the attribution, the card draws the rows attributed to it", () => {
    const attribution = new Map([
      ["coord-shell", "ws-coord"],
      ["pi-idle", "ws-coord"],
      ["worker-f1", "ws-coord"],
    ]);
    const { view, rowIds, onSelect } = renderCoordinatorCard(attribution);
    expect(rowIds).toContain("worker-f1");
    fireEvent.click(
      view.container.querySelector<HTMLElement>(
        "[data-worktree-agent-row='worker-f1']",
      )!,
    );
    expect(onSelect).toHaveBeenLastCalledWith("ws-clone");
  });

  test("a row attributed to another card leaves this one", () => {
    const attribution = new Map([
      ["coord-shell", "ws-coord"],
      ["pi-idle", "ws-bug-bot"],
    ]);
    const { rowIds } = renderCoordinatorCard(attribution);
    expect(rowIds).toEqual(["coord-shell"]);
  });
});
