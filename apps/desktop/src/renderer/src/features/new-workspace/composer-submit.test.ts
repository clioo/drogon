import { describe, expect, test } from "vitest";
import type {
  Harness,
  Project,
  Workspace,
  Worktree,
} from "../../../../shared/session-contract";
import type { ProjectGroup } from "../shell/project-adapter";
import {
  composerAgentLaunchInput,
  composerPrimaryActionLabel,
  initialComposerAgentId,
  initialComposerProjectId,
  resolveComposerSubmit,
  type ComposerAgentSelection,
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

function noAgent(): ComposerAgentSelection {
  return { harnessId: null, model: "", provider: "" };
}

function piAgent(): ComposerAgentSelection {
  return {
    harnessId: "pi",
    model: "qwen3.8-flash-next-nvidia-nvfp4",
    provider: "dgx-spark",
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

function claudeHarness(): Harness {
  return {
    harnessId: "claude",
    displayName: "Claude Code",
    availability: "available",
    executable: "/opt/claude",
  };
}

describe("resolveComposerSubmit", () => {
  test("a folder project opens its implicit workspace without a name", () => {
    const resolved = resolveComposerSubmit([folderGroup()], [workspace()], {
      projectId: "folder:1",
      name: "",
      baseRef: "",
      agent: noAgent(),
    });
    expect(resolved).toEqual({
      target: {
        kind: "implicit",
        project: folderProject(),
        workspaceId: "ws-1",
        agent: noAgent(),
      },
    });
  });

  test("a folder project carries the picked agent for the implicit workspace", () => {
    const resolved = resolveComposerSubmit([folderGroup()], [workspace()], {
      projectId: "folder:1",
      name: "",
      baseRef: "",
      agent: piAgent(),
    });
    expect(resolved).toEqual({
      target: {
        kind: "implicit",
        project: folderProject(),
        workspaceId: "ws-1",
        agent: piAgent(),
      },
    });
  });

  test("a folder project without a registered workspace errors honestly", () => {
    const resolved = resolveComposerSubmit([folderGroup()], [], {
      projectId: "folder:1",
      name: "",
      baseRef: "",
      agent: noAgent(),
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
        agent: noAgent(),
      }),
    ).toEqual({ error: "Choose a project to continue." });
    expect(
      resolveComposerSubmit([folderGroup()], [workspace()], {
        projectId: "nope",
        name: "",
        baseRef: "",
        agent: noAgent(),
      }),
    ).toEqual({ error: "Choose a project to continue." });
  });

  test("a git project builds a worktree.create input with a normalized base", () => {
    const resolved = resolveComposerSubmit([gitGroup()], [], {
      projectId: "git:1",
      name: "  demo-a ",
      baseRef: "  main  ",
      agent: noAgent(),
    });
    expect(resolved).toEqual({
      target: {
        kind: "worktree",
        project: gitProject(),
        name: "demo-a",
        baseRef: "main",
        agent: noAgent(),
      },
    });
  });

  test("a git project carries the picked agent for the post-create launch", () => {
    const resolved = resolveComposerSubmit([gitGroup()], [], {
      projectId: "git:1",
      name: "demo-a",
      baseRef: "",
      agent: piAgent(),
    });
    expect(resolved).toEqual({
      target: {
        kind: "worktree",
        project: gitProject(),
        name: "demo-a",
        baseRef: undefined,
        agent: piAgent(),
      },
    });
  });

  test("a blank base ref means the daemon default", () => {
    const resolved = resolveComposerSubmit([gitGroup()], [], {
      projectId: "git:1",
      name: "demo-a",
      baseRef: "   ",
      agent: noAgent(),
    });
    expect(resolved).toEqual({
      target: {
        kind: "worktree",
        project: gitProject(),
        name: "demo-a",
        baseRef: undefined,
        agent: noAgent(),
      },
    });
  });

  test("a git project with a bad branch name surfaces the form rule", () => {
    const resolved = resolveComposerSubmit([gitGroup()], [], {
      projectId: "git:1",
      name: "has space",
      baseRef: "",
      agent: piAgent(),
    });
    expect(resolved).toEqual({
      error: "The name must not contain whitespace or control characters.",
    });
  });
});

describe("initialComposerAgentId", () => {
  test("preselects the stored default when it is available", () => {
    expect(initialComposerAgentId([piHarness(), claudeHarness()], "pi")).toBe(
      "pi",
    );
  });

  test("the fork's auto-pick order fills in when no default is stored", () => {
    // pickQuickWorkspaceAgent over TUI_AGENT_AUTO_PICK_ORDER: claude first.
    expect(initialComposerAgentId([piHarness(), claudeHarness()], "")).toBe(
      "claude",
    );
    expect(initialComposerAgentId([piHarness()], "")).toBe("pi");
    expect(initialComposerAgentId([piHarness()], "claude")).toBe("pi");
    expect(
      initialComposerAgentId(
        [
          {
            ...claudeHarness(),
            availability: "missing",
          },
        ],
        "claude",
      ),
    ).toBeNull();
    expect(initialComposerAgentId([], "")).toBeNull();
  });
});

describe("composerAgentLaunchInput", () => {
  test("no harness means no launch (today's create-without-session)", () => {
    expect(
      composerAgentLaunchInput("ws-1", noAgent(), "req-1"),
    ).toBeNull();
  });

  test("a Pi pick carries provider and model to harness.start", () => {
    expect(composerAgentLaunchInput("ws-1", piAgent(), "req-1")).toEqual({
      workspaceId: "ws-1",
      harnessId: "pi",
      model: "qwen3.8-flash-next-nvidia-nvfp4",
      provider: "dgx-spark",
      effort: undefined,
      prompt: undefined,
      permissionMode: "inherit",
      requestId: "req-1",
    });
  });

  test("blank model and provider reach the service as absent keys", () => {
    expect(
      composerAgentLaunchInput(
        "ws-1",
        { harnessId: "pi", model: "  ", provider: "" },
        "req-1",
      ),
    ).toEqual({
      workspaceId: "ws-1",
      harnessId: "pi",
      model: undefined,
      provider: undefined,
      effort: undefined,
      prompt: undefined,
      permissionMode: "inherit",
      requestId: "req-1",
    });
  });

  test("a provider picked for another harness never leaks through", () => {
    expect(
      composerAgentLaunchInput(
        "ws-1",
        { harnessId: "claude", model: "", provider: "dgx-spark" },
        "req-1",
      )?.provider,
    ).toBeUndefined();
  });

  test("the stored defaults drive permission mode and effort (#231)", () => {
    expect(
      composerAgentLaunchInput("ws-1", piAgent(), "req-1", {
        pi: { model: "", effort: "high", permissionMode: "unattended" },
      }),
    ).toEqual({
      workspaceId: "ws-1",
      harnessId: "pi",
      model: "qwen3.8-flash-next-nvidia-nvfp4",
      provider: "dgx-spark",
      effort: "high",
      prompt: undefined,
      permissionMode: "unattended",
      requestId: "req-1",
    });
  });

  test("a blank composer model falls back to the stored default model", () => {
    expect(
      composerAgentLaunchInput(
        "ws-1",
        { harnessId: "pi", model: "  ", provider: "" },
        "req-1",
        {
          pi: {
            model: "dgx-spark/qwen3.8-flash-next-nvidia-nvfp4",
            effort: "",
            permissionMode: "inherit",
          },
        },
      ),
    ).toMatchObject({
      model: "qwen3.8-flash-next-nvidia-nvfp4",
      provider: "dgx-spark",
      permissionMode: "inherit",
    });
  });

  test("Claude Code inherits the fork yolo default with no stored entry", () => {
    expect(
      composerAgentLaunchInput(
        "ws-1",
        { harnessId: "claude", model: "", provider: "" },
        "req-1",
      )?.permissionMode,
    ).toBe("unattended");
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
