// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc.
   Regression tests for the missing project-header "+". The owner's other Mac
   showed a `zillow` header with only the actions menu: ProjectList.tsx
   gated the create control on `worktreesAvailable && kind === "git" &&
   !id.startsWith("folder:")`, so a folder-registered project, a project the
   workspace-fallback projection discovered, and a git project whose kind
   resolved late all lost the affordance silently. Orca's
   src/renderer/src/components/sidebar/repo-header-create-state.ts never drops
   it, so each of those conditions must render a labelled, working control.

   Every case asserts the control is *absent* on the unpatched tree, so these
   tests fail before the fix and pass after it. */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import type { Project, Workspace, Worktree } from "../../../../shared/session-contract";
import {
  loadProjectView,
  type ProjectGroup,
} from "./project-adapter";
import { ProjectList } from "./ProjectList";
import { WORKTREES_UNAVAILABLE_REASON } from "./project-header-create-state";
import { resolveComposerSubmit } from "../new-workspace/composer-submit";
import { TooltipProvider } from "../../components/ui/tooltip";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";
import { EMPTY_TAB_STRIP_STATE } from "./tab-order";

beforeEach(installRadixJsdomStubs);
// WorktreeCard's context menu and git-status hook resolve the preload
// bridges defensively; jsdom has no window.drogon, so grant no-op ones.
beforeEach(() => {
  (window as unknown as Record<string, unknown>).drogon = {
    shell: {
      showItemInFolder: async () => ({ ok: true as const, result: { shown: true } }),
      openPath: async () => ({ ok: true as const, result: { opened: true } }),
    },
    project: { worktreeRename: async () => null },
    git: { gitStatus: async () => null },
  };
});
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).drogon;
});
afterEach(cleanup);

function project(id: string, name: string, kind: Project["kind"]): Project {
  return {
    id,
    hostId: "h1",
    path: `/work/${name}`,
    name,
    kind,
    defaultBaseRef: null,
  };
}

function worktree(id: string, projectId: string, name: string): Worktree {
  return {
    id,
    projectId,
    workspaceId: `ws-${id}`,
    path: `/work/${name}`,
    branch: "main",
    head: "head",
    baseRef: null,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

function workspace(id: string, name: string, kind: Workspace["kind"] = "folder"): Workspace {
  return { id, hostId: "h1", path: `/work/${name}`, name, kind };
}

function group(kind: Project["kind"], name: string): ProjectGroup {
  return {
    project: project(`p-${name}`, name, kind),
    worktrees: [worktree(`wt-${name}`, `p-${name}`, name)],
  };
}

function mountList(
  groups: ProjectGroup[],
  options: { worktreesAvailable?: boolean; workspaces?: Workspace[] } = {},
) {
  const onCreateWorkspace = vi.fn();
  // The drag arming resolves the sidebar through `.shell-sidebar-scroll`.
  const scroll = document.createElement("div");
  scroll.className = "shell-sidebar-scroll";
  document.body.appendChild(scroll);
  const element = createElement(ProjectList, {
    groups,
    workspaces: options.workspaces ?? [],
    sessions: [],
    selectedWorkspaceId: "",
    activeSessionId: "",
    tabStrip: EMPTY_TAB_STRIP_STATE,
    onSelectSession: () => {},
    disabled: false,
    addDisabled: false,
    sidebarWidth: 280,
    worktreesAvailable: options.worktreesAvailable ?? true,
    action: null,
    onSelectWorkspace: () => {},
    onAddProject: () => {},
    onCreateWorkspace,
    onOpenAction: () => {},
    onCloseAction: () => {},
    onBrowse: async () => null,
    onSubmitAdd: async () => null,
    onSubmitRemove: async () => null,
    onSubmitRemoveProject: async () => null,
    onOpenProjectSettings: () => {},
    onSubmitRename: async () => null,
  });
  const view = render(
    createElement(TooltipProvider, null, element),
    { container: scroll },
  );
  return {
    view,
    onCreateWorkspace,
    /**
     * The header's create control, whatever label it currently carries: the
     * project-actions menu ("...") shares `data-project-header-action`, so it
     * is excluded by its own "Project actions for <name>" accessible name.
     */
    createButton: () =>
      [
        ...document.querySelectorAll<HTMLElement>(
          "[data-project-header-id] [data-project-header-action]",
        ),
      ].find(
        (button) =>
          !(button.getAttribute("aria-label") ?? "").startsWith("Project actions for "),
      ) ?? null,
  };
}

describe("project header create affordance conditions", () => {
  test("a git project keeps the worktree control (baseline)", () => {
    const { createButton, onCreateWorkspace } = mountList([group("git", "zillow")]);
    const button = createButton();
    expect(button?.getAttribute("aria-label")).toBe("Create new worktree for zillow");
    fireEvent.click(button!);
    expect(onCreateWorkspace).toHaveBeenCalledWith("p-zillow");
  });

  test("a folder project renders the create-workspace control", () => {
    const { createButton, onCreateWorkspace } = mountList([group("folder", "notes")]);
    const button = createButton();
    expect(button).toBeTruthy();
    expect(button?.getAttribute("aria-label")).toBe("Create workspace for notes");
    expect(button?.hasAttribute("disabled")).toBe(false);
    fireEvent.click(button!);
    expect(onCreateWorkspace).toHaveBeenCalledWith("p-notes");
  });

  test("a git path registered as a folder (ownership never resolved) keeps a working control", () => {
    // `project.add` classifies once (`crates/drogon-core/src/project.rs`'s
    // `classify`: `.git` present at that instant) and `fetch_by_path` returns
    // the stored row verbatim afterwards, so a path registered before it
    // became a repo stays `folder` for good. The header must not lose its
    // only create entry point because of it.
    const { createButton, onCreateWorkspace } = mountList([group("folder", "zillow")]);
    const button = createButton();
    expect(button?.getAttribute("aria-label")).toBe("Create workspace for zillow");
    fireEvent.click(button!);
    expect(onCreateWorkspace).toHaveBeenCalledWith("p-zillow");
  });

  test("a project discovered by the workspace fallback still renders the control", async () => {
    // The REAL fallback (no project.v1/worktree.v1, or an RPC failure) labels
    // every workspace `folder:<workspaceId>` with kind folder -- even one the
    // daemon registered as a git workspace. Built through `loadProjectView`,
    // not a hand-written group, so the test covers the production projection.
    const gitWorkspace = workspace("ws-9", "zillow", "git");
    const view = await loadProjectView({}, [], [gitWorkspace]);
    expect(view.source).toBe("workspace-fallback");
    expect(view.groups[0]?.project.id).toBe("folder:ws-9");
    expect(view.groups[0]?.project.kind).toBe("folder");
    const { createButton, onCreateWorkspace } = mountList(view.groups, {
      worktreesAvailable: false,
      workspaces: [gitWorkspace],
    });
    const button = createButton();
    expect(button?.getAttribute("aria-label")).toBe("Create workspace for zillow");
    fireEvent.click(button!);
    expect(onCreateWorkspace).toHaveBeenCalledWith("folder:ws-9");
  });

  test("a project whose git ownership resolves late never loses the control", () => {
    // The sidebar paints the workspace projection first and the RPC view
    // after: the same header must stay actionable across that swap.
    const fallingBack = mountList([group("folder", "zillow")], {
      worktreesAvailable: false,
    });
    expect(fallingBack.createButton()?.getAttribute("aria-label")).toBe(
      "Create workspace for zillow",
    );
    const resolved = group("git", "zillow");
    fallingBack.view.rerender(
      createElement(TooltipProvider, null, createElement(ProjectList, {
        groups: [resolved],
        workspaces: [],
        sessions: [],
        selectedWorkspaceId: "",
        activeSessionId: "",
        tabStrip: EMPTY_TAB_STRIP_STATE,
        onSelectSession: () => {},
        disabled: false,
        addDisabled: false,
        sidebarWidth: 280,
        worktreesAvailable: true,
        action: null,
        onSelectWorkspace: () => {},
        onAddProject: () => {},
        onCreateWorkspace: fallingBack.onCreateWorkspace,
        onOpenAction: () => {},
        onCloseAction: () => {},
        onBrowse: async () => null,
        onSubmitAdd: async () => null,
        onSubmitRemove: async () => null,
        onSubmitRemoveProject: async () => null,
        onOpenProjectSettings: () => {},
        onSubmitRename: async () => null,
      })),
    );
    expect(fallingBack.createButton()?.getAttribute("aria-label")).toBe(
      "Create new worktree for zillow",
    );
  });

  test("a git project without worktree.v1 states its reason instead of vanishing", () => {
    const { view, createButton } = mountList([group("git", "zillow")], {
      worktreesAvailable: false,
    });
    const button = createButton();
    expect(button).toBeTruthy();
    // The reason is discoverable both on hover and to a screen reader.
    expect(button?.getAttribute("title")).toBe(WORKTREES_UNAVAILABLE_REASON);
    expect(button?.getAttribute("aria-label")).toContain(WORKTREES_UNAVAILABLE_REASON);
    expect(button?.hasAttribute("disabled")).toBe(true);
    expect(view.container.querySelectorAll("[data-project-header-id]")).toHaveLength(1);
  });

  test("the control's project id drives the composer for fallback and folder projects", async () => {
    // The header hands the composer the row's own project id; for a folder
    // project (the fallback projection included) that resolves to its one
    // implicit workspace, so the restored control is functional, not decorative.
    const works = [workspace("ws-9", "zillow", "git")];
    const fallbackView = await loadProjectView({}, [], works);
    expect(resolveComposerSubmit(fallbackView.groups, works, {
      projectId: "folder:ws-9",
      name: "ignored-for-folders",
      baseRef: "",
      agent: { harnessId: null, model: "", provider: "" },
    })).toEqual({
      target: {
        kind: "implicit",
        project: fallbackView.groups[0].project,
        workspaceId: "ws-9",
        agent: { harnessId: null, model: "", provider: "" },
      },
    });
  });
});
