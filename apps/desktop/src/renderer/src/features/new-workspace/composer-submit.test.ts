import { describe, expect, test } from "vitest";
import type {
  Project,
  Workspace,
  Worktree,
} from "../../../../shared/session-contract";
import type { ProjectGroup } from "../shell/project-adapter";
import {
  composerPrimaryActionLabel,
  initialComposerProjectId,
  resolveComposerSubmit,
} from "./composer-submit";

function folderProject(): Project {
  return {
    id: "folder:1",
    hostId: "host",
    path: "/tmp/demo",
    name: "demo",
    kind: "folder",
    defaultBaseRef: null,
  };
}

function gitProject(): Project {
  return {
    id: "git:1",
    hostId: "host",
    path: "/tmp/repo",
    name: "repo",
    kind: "git",
    defaultBaseRef: "main",
  };
}

function folderGroup(): ProjectGroup {
  const project = folderProject();
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
  return { project: gitProject(), worktrees: [] };
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

describe("resolveComposerSubmit", () => {
  test("a folder project opens its implicit workspace without a name", () => {
    const resolved = resolveComposerSubmit([folderGroup()], [workspace()], {
      projectId: "folder:1",
      name: "",
      baseRef: "",
    });
    expect(resolved).toEqual({
      target: {
        kind: "implicit",
        project: folderProject(),
        workspaceId: "ws-1",
      },
    });
  });

  test("a folder project without a registered workspace errors honestly", () => {
    const resolved = resolveComposerSubmit([folderGroup()], [], {
      projectId: "folder:1",
      name: "",
      baseRef: "",
    });
    expect(resolved).toEqual({
      error:
        "The folder workspace is missing. Refresh the connection and retry.",
    });
  });

  test("a missing project asks for a choice", () => {
    expect(
      resolveComposerSubmit([folderGroup()], [workspace()], {
        projectId: null,
        name: "",
        baseRef: "",
      }),
    ).toEqual({ error: "Choose a project to continue." });
    expect(
      resolveComposerSubmit([folderGroup()], [workspace()], {
        projectId: "nope",
        name: "",
        baseRef: "",
      }),
    ).toEqual({ error: "Choose a project to continue." });
  });

  test("a git project builds a worktree.create input with a normalized base", () => {
    const resolved = resolveComposerSubmit([gitGroup()], [], {
      projectId: "git:1",
      name: "  demo-a ",
      baseRef: "  main  ",
    });
    expect(resolved).toEqual({
      target: {
        kind: "worktree",
        project: gitProject(),
        name: "demo-a",
        baseRef: "main",
      },
    });
  });

  test("a blank base ref means the daemon default", () => {
    const resolved = resolveComposerSubmit([gitGroup()], [], {
      projectId: "git:1",
      name: "demo-a",
      baseRef: "   ",
    });
    expect(resolved).toEqual({
      target: {
        kind: "worktree",
        project: gitProject(),
        name: "demo-a",
        baseRef: undefined,
      },
    });
  });

  test("a git project with a bad branch name surfaces the form rule", () => {
    const resolved = resolveComposerSubmit([gitGroup()], [], {
      projectId: "git:1",
      name: "has space",
      baseRef: "",
    });
    expect(resolved).toEqual({
      error: "The name must not contain whitespace or control characters.",
    });
  });
});

describe("composerPrimaryActionLabel", () => {
  test("git projects create worktrees, everything else creates workspaces", () => {
    expect(composerPrimaryActionLabel(gitProject())).toBe("Create worktree");
    expect(composerPrimaryActionLabel(folderProject())).toBe(
      "Create workspace",
    );
    expect(composerPrimaryActionLabel(null)).toBe("Create workspace");
  });
});

describe("initialComposerProjectId", () => {
  test("keeps the requested project when listed, else first, else null", () => {
    expect(
      initialComposerProjectId([folderGroup(), gitGroup()], "git:1"),
    ).toBe("git:1");
    expect(
      initialComposerProjectId([folderGroup(), gitGroup()], "gone"),
    ).toBe("folder:1");
    expect(initialComposerProjectId([folderGroup()], null)).toBe("folder:1");
    expect(initialComposerProjectId([], null)).toBeNull();
  });
});
