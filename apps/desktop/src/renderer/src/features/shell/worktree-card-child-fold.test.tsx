// @vitest-environment jsdom
/* The card chevron folds nested child worktrees as well as the card's own
   agents, and is only offered when there is something to fold. Drives the
   real ProjectList, not a mocked callback. */
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type {
  Project,
  Worktree,
  Workspace,
} from "../../../../shared/session-contract";
import type { ProjectGroup } from "./project-adapter";
import { ProjectList } from "./ProjectList";
import { EMPTY_TAB_STRIP_STATE } from "./tab-order";
import { TooltipProvider } from "../../components/ui/tooltip";
import {
  clearWorktreeAgentExpansionStateForTests,
  resetWorktreeAgentExpansionMemoryForTests,
} from "./worktree-card-agents-expansion-state";

afterEach(() => {
  cleanup();
  clearWorktreeAgentExpansionStateForTests();
  localStorage.clear();
  delete (window as unknown as { drogon?: unknown }).drogon;
});

const project: Project = {
  id: "proj-1",
  hostId: "host-1",
  path: "/repo",
  name: "repo",
  kind: "git",
  defaultBaseRef: "main",
};

function worktree(id: string, parentWorktreeId?: string): Worktree {
  return {
    id,
    projectId: "proj-1",
    workspaceId: `ws-${id}`,
    path: `/repo/${id}`,
    branch: id,
    head: "abc123",
    baseRef: null,
    createdAt: "2026-09-08T10:00:00.000Z",
    ...(parentWorktreeId ? { parentWorktreeId } : {}),
  };
}

const group: ProjectGroup = {
  project,
  worktrees: [
    worktree("parent"),
    worktree("child-a", "parent"),
    worktree("child-b", "parent"),
    worktree("loner"),
  ],
};

const workspaces: Workspace[] = group.worktrees.map((item) => ({
  id: item.workspaceId,
  path: item.path,
  name: item.id,
  kind: "git" as const,
  hostId: "host-1",
}));

function mount() {
  (window as unknown as { drogon?: unknown }).drogon ??= {};
  return render(
    <TooltipProvider>
      <ProjectList
        groups={[group]}
        workspaces={workspaces}
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

const card = (id: string) =>
  document.querySelector<HTMLElement>(`[data-worktree-card-id="${id}"]`);
const fold = (id: string) =>
  card(id)?.querySelector<HTMLButtonElement>(".shell-worktree-card-fold") ??
  null;

describe("card fold over nested worktrees", () => {
  test("folding a parent hides its child workspaces and unfolding restores them", () => {
    mount();
    expect(card("child-a")).not.toBeNull();
    expect(card("child-b")).not.toBeNull();
    const button = fold("parent")!;
    expect(button.getAttribute("aria-label")).toBe("Hide workspaces in parent");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(button);
    expect(card("parent")).not.toBeNull();
    expect(card("child-a")).toBeNull();
    expect(card("child-b")).toBeNull();
    expect(card("loner")).not.toBeNull();
    expect(fold("parent")!.getAttribute("aria-expanded")).toBe("false");
    expect(fold("parent")!.getAttribute("aria-label")).toBe(
      "Show workspaces in parent",
    );
    fireEvent.click(fold("parent")!);
    expect(card("child-a")).not.toBeNull();
    expect(card("child-b")).not.toBeNull();
  });

  test("every card keeps its chevron, as the guideline draws it", () => {
    mount();
    expect(fold("loner")?.getAttribute("aria-label")).toBe("Hide agents in loner");
    expect(fold("child-a")).not.toBeNull();
  });

  test("the child fold survives a renderer reload", () => {
    const first = mount();
    fireEvent.click(fold("parent")!);
    expect(card("child-a")).toBeNull();
    first.unmount();
    resetWorktreeAgentExpansionMemoryForTests();
    mount();
    expect(card("parent")).not.toBeNull();
    expect(card("child-a")).toBeNull();
  });
});
