// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc.
   #316: the composer is the fork's "Create worktree" composer — Project
   type-ahead combobox ("Browse projects"), the Run on field ("Browse run
   targets") with the single local target, the fork's name-field copy, the
   Agent combobox, the Advanced disclosure with branch/parent/note/setup/
   sparse rows plus the base ref, and the ⌘↵ footer. */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import type {
  Harness,
  Project,
  Workspace,
  Worktree,
} from "../../../../shared/session-contract";
import type { ProjectGroup } from "../shell/project-adapter";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";
import { TooltipProvider } from "../../components/ui/tooltip";
import { NewWorkspaceComposer } from "./NewWorkspaceComposer";
import type { ComposerAgentSelection } from "./composer-submit";

installRadixJsdomStubs();
afterEach(cleanup);

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

function configuredGitGroup(): ProjectGroup {
  const parent: Worktree = {
    id: "wt-parent",
    projectId: "git:1",
    workspaceId: "ws-parent",
    path: "/tmp/repo-parent",
    branch: "main",
    head: "abc",
    baseRef: null,
    createdAt: "",
  };
  return {
    project: {
      ...gitGroup().project,
      setupScript: "pnpm install",
    },
    worktrees: [parent],
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

function claudeHarness(): Harness {
  return {
    harnessId: "claude",
    displayName: "Claude Code",
    availability: "available",
    executable: "/opt/claude",
  };
}

function mount({
  groups = [gitGroup()],
  workspaces = [],
  projectId = "git:1",
  harnesses = [] as Harness[],
  defaultHarnessId = "",
  onSubmitWorktree = vi.fn(
    async (_input: {
      projectId: string;
      name: string;
      baseRef?: string;
      agent: ComposerAgentSelection;
    }) => null,
  ),
  onLaunchAgent = vi.fn(async (_launch: unknown) => null),
  onCreateQuickSession = vi.fn(async (_input: unknown) => null),
  onSelectWorkspace = vi.fn(),
  onProjectChange = vi.fn(),
  onAddProject = vi.fn(),
  onClose = vi.fn(),
}: Partial<{
  groups: ProjectGroup[];
  workspaces: Workspace[];
  projectId: string | null;
  harnesses: Harness[];
  defaultHarnessId: string;
  onSubmitWorktree: (input: {
    projectId: string;
    name: string;
    baseRef?: string;
    agent: ComposerAgentSelection;
  }) => Promise<string | null>;
  onLaunchAgent: (launch: unknown) => Promise<string | null>;
  onCreateQuickSession: (input: unknown) => Promise<string | null>;
  onSelectWorkspace: (workspaceId: string) => void;
  onProjectChange: (projectId: string | null) => void;
  onAddProject: () => void;
  onClose: () => void;
}> = {}) {
  return render(
    <TooltipProvider>
      <NewWorkspaceComposer
        groups={groups}
        workspaces={workspaces}
        projectId={projectId}
        disabled={false}
        nameInputRef={createRef<HTMLInputElement>()}
        composerRef={createRef<HTMLDivElement>()}
        harnesses={harnesses}
        defaultHarnessId={defaultHarnessId}
        harnessDefaults={{}}
        onProjectChange={onProjectChange}
        onSubmitWorktree={onSubmitWorktree}
        onLaunchAgent={onLaunchAgent as never}
        onCreateQuickSession={onCreateQuickSession}
        onSelectWorkspace={onSelectWorkspace}
        onAddProject={onAddProject}
        onOpenAgentSettings={() => {}}
        onSetDefaultAgent={() => {}}
        onClose={onClose}
      />
    </TooltipProvider>,
  );
}

function fillName(value: string): void {
  fireEvent.change(
    screen.getByPlaceholderText(
      "Type a name, #1234, branch, GitHub, GitLab, or Jira URL",
    ),
    { target: { value } },
  );
}

describe("NewWorkspaceComposer chrome (#316 fork anatomy)", () => {
  test("git project: the fork's fields, in order, with its copy", () => {
    mount({});
    // Project combobox + its browse affordance.
    expect(screen.getByRole("combobox", { name: "Project" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Browse projects" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add project" })).toBeTruthy();
    // Run on, local-only, rendered as the fork's ready local host.
    expect(screen.getByRole("combobox", { name: "Run on" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Browse run targets" }),
    ).toBeTruthy();
    expect(document.body.textContent).toContain("Run on");
    // The fork's local-host label ("Local Mac" on macOS, "Local computer"
    // elsewhere — jsdom's UA carries no platform token).
    expect(document.body.textContent).toMatch(/Local (Mac|Windows|computer)/);
    // The fork's name-field label and smart-mode placeholder.
    expect(document.body.textContent).toContain("Name or 'Create From'");
    expect(document.body.textContent).toContain("[Optional]");
    const nameInput = screen.getByPlaceholderText(
      "Type a name, #1234, branch, GitHub, GitLab, or Jira URL",
    );
    expect(nameInput).toBeTruthy();
    // Agent + Advanced + the footer primary action.
    expect(document.body.textContent).toContain("Agent");
    expect(
      screen.getByRole("button", { name: "Open agent settings" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Advanced" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Create worktree/ }),
    ).toBeTruthy();
    // The fork's "Create more" switch shows for git projects.
    expect(screen.getByRole("switch", { name: /Create more/ })).toBeTruthy();
  });

  test("folder project: Workspace name label, Create workspace, no Create more", () => {
    mount({
      groups: [folderGroup(), gitGroup()],
      workspaces: [workspace()],
      projectId: "folder:1",
    });
    expect(document.body.textContent).toContain("Workspace name");
    expect(screen.getByPlaceholderText("Workspace name")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Create workspace/ }),
    ).toBeTruthy();
    expect(screen.queryByRole("switch", { name: /Create more/ })).toBeNull();
  });

  test("Advanced reveals the base ref with the project's default", () => {
    mount({});
    // The source keeps the panel mounted but inert while collapsed.
    expect(
      screen
        .getByLabelText(/Base ref/)
        .closest("[aria-hidden]")
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    const baseRef = screen.getByLabelText(/Base ref/) as HTMLInputElement;
    expect(baseRef.value).toBe("main");
  });

  test("Advanced ports branch, parent, note, setup, sparse and base-ref rows in fork order", () => {
    mount({ groups: [configuredGitGroup()], projectId: "git:1" });
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    expect(screen.getByLabelText("Branch name")).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: /Parent worktree/ }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Nests this workspace under another in the sidebar. Does not change the base branch.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Note")).toBeTruthy();
    expect(screen.getByText("Setup script")).toBeTruthy();
    expect(screen.getByText("pnpm install")).toBeTruthy();
    expect(
      screen.getByRole("switch", { name: "Run setup command" }),
    ).toBeTruthy();
    expect(screen.getByText("Sparse checkout")).toBeTruthy();
    expect(screen.getByLabelText(/Base ref/)).toBeTruthy();
  });

  test("Advanced values reach worktree.create and Quick Session reaches its consumer", async () => {
    const onSubmitWorktree = vi.fn(async (_input: unknown) => null);
    const onCreateQuickSession = vi.fn(async (_input: unknown) => null);
    mount({
      groups: [configuredGitGroup()],
      projectId: "git:1",
      harnesses: [piHarness()],
      onSubmitWorktree,
      onCreateQuickSession,
    });
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    fillName("workspace-name");
    fireEvent.change(screen.getByLabelText("Branch name"), {
      target: { value: "feature/custom" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Note" }), {
      target: { value: "remember this" },
    });
    fireEvent.click(screen.getByRole("combobox", { name: /Parent worktree/ }));
    fireEvent.click(screen.getByRole("option", { name: /main/ }));
    fireEvent.click(
      screen.getByRole("switch", {
        name: "Wait for setup to complete before starting agent",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Quick Session/ }));
    await vi.waitFor(() =>
      expect(onCreateQuickSession).toHaveBeenCalledTimes(1),
    );
    expect(onCreateQuickSession.mock.calls[0]?.[0]).toMatchObject({
      name: "workspace-name",
      agent: { harnessId: "pi" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Create worktree/ }));
    await vi.waitFor(() => expect(onSubmitWorktree).toHaveBeenCalledTimes(1));
    expect(onSubmitWorktree.mock.calls[0]?.[0]).toMatchObject({
      projectId: "git:1",
      name: "workspace-name",
      branch: "feature/custom",
      note: "remember this",
      parentWorktreeId: "wt-parent",
      setupScript: "pnpm install",
      waitForSetup: true,
      agent: { harnessId: "pi" },
    });
  });

  test("no projects: the fork's empty message and a disabled primary action", () => {
    mount({ groups: [], projectId: null });
    expect(
      document.body.textContent?.includes(
        "Add a project before creating a workspace.",
      ),
    ).toBe(true);
    const create = screen.getByRole("button", { name: /Create workspace/ });
    expect(create.hasAttribute("disabled")).toBe(true);
    // No project selected: the Run on picker stays hidden (fork behavior).
    expect(screen.queryByRole("combobox", { name: "Run on" })).toBeNull();
  });
});

describe("NewWorkspaceComposer submit (#316 unchanged daemon payload)", () => {
  test("git submit sends projectId, name, baseRef and the picked agent", async () => {
    const onSubmitWorktree = vi.fn(async () => null);
    const onClose = vi.fn();
    mount({ onSubmitWorktree, onClose, harnesses: [piHarness()] });
    fillName("demo-a");
    fireEvent.click(screen.getByRole("button", { name: /Create worktree/ }));
    await vi.waitFor(() => {
      expect(onSubmitWorktree).toHaveBeenCalledTimes(1);
    });
    expect(onSubmitWorktree).toHaveBeenCalledWith({
      projectId: "git:1",
      name: "demo-a",
      baseRef: "main",
      // Pi is auto-picked (the fork's auto-pick order); model/provider ride
      // the Settings → Agents defaults, never composer text fields.
      agent: { harnessId: "pi", model: "", provider: "" },
    });
    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  test("an edited base ref in Advanced reaches the submit", async () => {
    const onSubmitWorktree = vi.fn(
      async (input: { baseRef?: string }) => (void input, null),
    );
    mount({ onSubmitWorktree });
    fillName("demo-a");
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    fireEvent.change(screen.getByLabelText(/Base ref/), {
      target: { value: "release/1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create worktree/ }));
    await vi.waitFor(() => {
      expect(onSubmitWorktree).toHaveBeenCalledTimes(1);
    });
    expect(onSubmitWorktree.mock.calls[0]?.[0].baseRef).toBe("release/1");
  });

  test("Blank Terminal creates the worktree without an agent", async () => {
    const onSubmitWorktree = vi.fn(
      async (input: { agent: ComposerAgentSelection }) => (void input, null),
    );
    mount({ onSubmitWorktree, harnesses: [piHarness()] });
    // The picker lists the fork's no-agent row (role=combobox takes no name
    // from content, so the trigger is found by its root marker).
    const trigger = document.querySelector(
      '[data-agent-combobox-root="true"][role="combobox"]',
    ) as HTMLElement;
    fireEvent.click(trigger);
    const blank = await screen.findByText("Blank Terminal");
    fireEvent.click(blank);
    fillName("demo-a");
    fireEvent.click(screen.getByRole("button", { name: /Create worktree/ }));
    await vi.waitFor(() => {
      expect(onSubmitWorktree).toHaveBeenCalledTimes(1);
    });
    expect(onSubmitWorktree.mock.calls[0]?.[0].agent.harnessId).toBeNull();
  });

  test("folder submit opens the implicit workspace and starts the agent", async () => {
    const onLaunchAgent = vi.fn(async (_launch: unknown) => null);
    const onSelectWorkspace = vi.fn();
    const onClose = vi.fn();
    mount({
      groups: [folderGroup()],
      workspaces: [workspace()],
      projectId: "folder:1",
      harnesses: [claudeHarness()],
      onLaunchAgent,
      onSelectWorkspace,
      onClose,
    });
    fireEvent.click(screen.getByRole("button", { name: /Create workspace/ }));
    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(onSelectWorkspace).toHaveBeenCalledWith("ws-1");
    expect(onLaunchAgent).toHaveBeenCalledTimes(1);
    expect(
      (onLaunchAgent.mock.calls[0]?.[0] as { harnessId: string }).harnessId,
    ).toBe("claude");
  });

  test("a daemon error surfaces verbatim in the footer alert", async () => {
    const onSubmitWorktree = vi.fn(async () => "boom");
    mount({ onSubmitWorktree });
    fillName("demo-a");
    fireEvent.click(screen.getByRole("button", { name: /Create worktree/ }));
    await vi.waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("boom");
    });
  });

  test("an invalid name blocks with the shared validation copy, no RPC", () => {
    const onSubmitWorktree = vi.fn(async () => null);
    mount({ onSubmitWorktree });
    fillName("has spaces");
    fireEvent.click(screen.getByRole("button", { name: /Create worktree/ }));
    expect(onSubmitWorktree).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("whitespace");
  });

  test("Create more keeps the composer open on a fresh draft", async () => {
    const onSubmitWorktree = vi.fn(async () => null);
    const onClose = vi.fn();
    mount({ onSubmitWorktree, onClose });
    fireEvent.click(screen.getByRole("switch", { name: /Create more/ }));
    fillName("demo-a");
    fireEvent.click(screen.getByRole("button", { name: /Create worktree/ }));
    await vi.waitFor(() => {
      expect(
        (
          screen.getByPlaceholderText(
            "Type a name, #1234, branch, GitHub, GitLab, or Jira URL",
          ) as HTMLInputElement
        ).value,
      ).toBe("");
    });
    expect(onSubmitWorktree).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  test("plain Enter in the name field moves focus to the agent combobox", () => {
    const onSubmitWorktree = vi.fn(async () => null);
    mount({ onSubmitWorktree, harnesses: [piHarness()] });
    const nameInput = screen.getByPlaceholderText(
      "Type a name, #1234, branch, GitHub, GitLab, or Jira URL",
    );
    fireEvent.keyDown(nameInput, { key: "Enter" });
    const agentTrigger = document.querySelector(
      '[data-agent-combobox-root="true"][role="combobox"]',
    );
    expect(document.activeElement).toBe(agentTrigger);
    expect(onSubmitWorktree).not.toHaveBeenCalled();
  });
});
