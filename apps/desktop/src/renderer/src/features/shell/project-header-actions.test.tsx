// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc.
   Regression tests for #278: the project header's hover-reveal actions
   ("New worktree in <project>", "Project actions for <project>") must stay
   above the row hit area — hit-testing an a11y/Playwright activation never
   establishes :hover first, so any pointer-events gate on the hidden
   container resolves the click to the drag-handle row beneath. Covers the
   committed project-card journey: the action click opens the composer, the
   row's plain click stays inert, and the header drag still arms from the row
   (never from the action). */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import type { Project, Worktree } from "../../../../shared/session-contract";
import type { ProjectGroup } from "./project-adapter";
import { ProjectList } from "./ProjectList";
import { PROJECT_HEADER_ACTIONS_CLASS_NAME } from "./project-actions-menu";
import { TooltipProvider } from "../../components/ui/tooltip";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";
import { EMPTY_TAB_STRIP_STATE } from "./tab-order";

beforeEach(installRadixJsdomStubs);
// WorktreeCard's context menu and git-status hook resolve the preload
// bridges defensively; jsdom has no window.drogon, so grant no-op ones.
beforeEach(() => {
  (window as unknown as Record<string, unknown>).drogon = {
    shell: {
      showItemInFolder: async () => ({
        ok: true as const,
        result: { shown: true },
      }),
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

function project(id: string, name: string): Project {
  return {
    id,
    hostId: "h1",
    path: `/work/${name}`,
    name,
    kind: "git",
    defaultBaseRef: null,
  };
}

function worktree(id: string, projectId: string): Worktree {
  return {
    id,
    projectId,
    workspaceId: `ws-${id}`,
    path: `/work/wt-${id}`,
    branch: "main",
    head: "head",
    baseRef: null,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

function group(id: string, name: string): ProjectGroup {
  return { project: project(id, name), worktrees: [worktree(`wt-${id}`, id)] };
}

function mountList(groups: ProjectGroup[]) {
  const onCreateWorkspace = vi.fn();
  const onSelectWorkspace = vi.fn();
  // The drag arming resolves the sidebar through `.shell-sidebar-scroll`.
  const scroll = document.createElement("div");
  scroll.className = "shell-sidebar-scroll";
  document.body.appendChild(scroll);
  const view = render(
    createElement(
      TooltipProvider,
      null,
      createElement(ProjectList, {
        groups,
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
        onSelectWorkspace: onSelectWorkspace,
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
      }),
    ),
    { container: scroll },
  );
  return { view, onCreateWorkspace, onSelectWorkspace };
}

function row(name: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    `[data-project-header-id] [aria-label="New worktree in ${name}"]`,
  )?.closest<HTMLElement>("[data-project-header-drag-handle]");
  if (!element) throw new Error(`no project row for ${name}`);
  return element;
}

describe("project header actions hit area (#278)", () => {
  test("hidden actions keep the hover reveal but never gate pointer events", () => {
    // The fork's reveal recipe minus any pointer-events gate: opacity-only.
    expect(PROJECT_HEADER_ACTIONS_CLASS_NAME).toContain("can-hover:absolute");
    expect(PROJECT_HEADER_ACTIONS_CLASS_NAME).toContain("can-hover:z-10");
    expect(PROJECT_HEADER_ACTIONS_CLASS_NAME).toContain("can-hover:opacity-0");
    expect(PROJECT_HEADER_ACTIONS_CLASS_NAME).toContain(
      "group-hover:opacity-100",
    );
    expect(PROJECT_HEADER_ACTIONS_CLASS_NAME).not.toContain("pointer-events");
  });

  test("clicking the New worktree action opens the composer for the project", () => {
    const { onCreateWorkspace } = mountList([group("p1", "drogon")]);
    const button = document.querySelector<HTMLElement>(
      '[aria-label="New worktree in drogon"]',
    );
    expect(button).toBeTruthy();
    fireEvent.click(button!);
    expect(onCreateWorkspace).toHaveBeenCalledTimes(1);
    expect(onCreateWorkspace).toHaveBeenCalledWith("p1");
  });

  test("a plain row click stays inert (no composer, no workspace select)", () => {
    const { onCreateWorkspace, onSelectWorkspace } = mountList([
      group("p1", "drogon"),
    ]);
    fireEvent.click(row("drogon"));
    expect(onCreateWorkspace).not.toHaveBeenCalled();
    expect(onSelectWorkspace).not.toHaveBeenCalled();
  });

  test("the drag handle still arms from the row, never from the action", () => {
    // Two projects: a single header has nowhere to land, so arming needs 2+.
    const { view } = mountList([group("p1", "drogon"), group("p2", "orchard")]);
    const pointer = (element: Element, x: number, y: number) =>
      fireEvent.pointerDown(element, {
        pointerType: "mouse",
        button: 0,
        pointerId: 7,
        clientX: x,
        clientY: y,
      });
    // A press on the action never arms the row drag…
    const button = document.querySelector<HTMLElement>(
      '[aria-label="New worktree in drogon"]',
    );
    pointer(button!, 10, 10);
    fireEvent.pointerMove(window, {
      pointerId: 7,
      clientX: 40,
      clientY: 40,
    });
    expect(document.body.style.cursor).toBe("");
    // …while the same press on the title surface promotes past the threshold.
    pointer(row("orchard"), 10, 10);
    fireEvent.pointerMove(window, {
      pointerId: 7,
      clientX: 40,
      clientY: 40,
    });
    expect(document.body.style.cursor).toBe("grabbing");
    view.unmount();
    expect(document.body.style.cursor).toBe("");
  });
});
