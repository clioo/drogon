import { describe, expect, test } from "vitest";
import { createElement, createRef } from "react";
import { renderToString } from "react-dom/server";
import type {
  Harness,
  Project,
  Workspace,
  Worktree,
} from "../../../../shared/session-contract";
import type { ProjectGroup } from "../shell/project-adapter";
import { NewWorkspaceComposer } from "./NewWorkspaceComposer";

function folderGroup(): ProjectGroup {
  const project: Project = {
    id: "folder:1",
    hostId: "host",
    path: "/tmp/demo",
    name: "demo",
    kind: "folder",
    defaultBaseRef: null,
  };
  const worktree: Worktree = {
    id: "implicit:ws-1",
    projectId: project.id,
    workspaceId: "ws-1",
    path: project.path,
    branch: "",
    head: "",
    baseRef: null,
    createdAt: "",
  };
  return { project, worktrees: [worktree] };
}

function gitGroup(): ProjectGroup {
  return {
    project: {
      id: "git:1",
      hostId: "host",
      path: "/tmp/repo",
      name: "repo",
      kind: "git",
      defaultBaseRef: "main",
    },
    worktrees: [],
  };
}

function workspace(): Workspace {
  return {
    id: "ws-1",
    hostId: "host",
    path: "/tmp/demo",
    name: "demo",
    kind: "folder",
  };
}

function piHarness(): Harness {
  return {
    harnessId: "pi",
    displayName: "Pi",
    availability: "available",
    executable: "/opt/pi",
  };
}

function render(
  groups: ProjectGroup[],
  workspaces: Workspace[],
  projectId: string | null,
  harnesses: Harness[] = [],
  defaultHarnessId = "",
): string {
  return renderToString(
    createElement(NewWorkspaceComposer, {
      groups,
      workspaces,
      projectId,
      disabled: false,
      nameInputRef: createRef<HTMLInputElement>(),
      harnesses,
      defaultHarnessId,
      onProjectChange: () => {},
      onSubmitWorktree: async () => null,
      onLaunchAgent: async () => null,
      onSelectWorkspace: () => {},
      onAddProject: () => {},
      onClose: () => {},
    }),
  );
}

describe("NewWorkspaceComposer chrome", () => {
  test("folder project: workspace name, optional marker, create workspace", () => {
    const html = render([folderGroup(), gitGroup()], [workspace()], "folder:1");
    expect(html).toContain("Project");
    expect(html).toContain("Choose project");
    expect(html).toContain("Add project");
    expect(html).toContain("Workspace name");
    expect(html).toContain("[Optional]");
    expect(html).toContain("Create workspace");
    expect(html).not.toContain("Base ref");
    expect(html).not.toContain("Create worktree");
  });

  test("git project: branch name, base ref, create worktree", () => {
    const html = render([folderGroup(), gitGroup()], [workspace()], "git:1");
    expect(html).toContain("Branch name");
    expect(html).toContain("Base ref");
    expect(html).toContain("(optional)");
    expect(html).toContain("Create worktree");
    expect(html).toContain('placeholder="main"');
  });

  test("no project: source empty message and a disabled primary action", () => {
    const html = render([], [], null);
    expect(html).toContain("Add a project before creating a workspace.");
    expect(html).toContain("Create workspace");
    expect(html).toContain("disabled");
  });

  test("no listed harnesses: the Agent picker stays hidden", () => {
    const html = render([folderGroup(), gitGroup()], [workspace()], "git:1");
    expect(html).not.toContain("composer-agent");
  });

  test("listed harnesses: Agent picker with a None default", () => {
    const html = render(
      [folderGroup(), gitGroup()],
      [workspace()],
      "git:1",
      [piHarness()],
    );
    expect(html).toContain("Agent");
    expect(html).toContain("None");
    expect(html).toContain("Pi");
    expect(html).not.toContain("Harness default");
  });

  test("stored default harness: model and Pi provider fields appear", () => {
    const html = render(
      [folderGroup(), gitGroup()],
      [workspace()],
      "git:1",
      [piHarness()],
      "pi",
    );
    expect(html).toContain("Harness default");
    expect(html).toContain("Provider");
    expect(html).toContain("Pi default");
  });
});
