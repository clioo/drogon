// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc.
   User-feature-closure item 3: standalone quick sessions ("Chats") had no
   sidebar surface at all -- Sidebar.tsx filtered every quickSession group
   out of ProjectList and nothing else rendered them. These tests pin: the
   section renders only when a Chat exists, each Chat is selectable and
   deletable through the same confirm-first flow as a regular project, and
   the deletion copy tells the truth about file loss (see
   remove-project-dialog-copy.test.ts for the copy's own unit coverage). */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Project, Workspace, Worktree } from "../../../../shared/session-contract";
import type { ProjectGroup } from "./project-adapter";
import { ChatsList } from "./ChatsList";
import { EMPTY_TAB_STRIP_STATE } from "./tab-order";
import { TooltipProvider } from "../../components/ui/tooltip";

afterEach(cleanup);

function chatProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-chat-1",
    hostId: "host-1",
    path: "/data/quick-sessions/session-1",
    name: "Chat",
    kind: "folder",
    defaultBaseRef: null,
    quickSession: true,
    ...overrides,
  };
}

function chatGroup(overrides: Partial<Project> = {}): ProjectGroup {
  const project = chatProject(overrides);
  const worktree: Worktree = {
    id: project.id,
    projectId: project.id,
    workspaceId: `ws-${project.id}`,
    path: project.path,
    branch: "",
    head: "",
    baseRef: null,
    createdAt: "2026-09-08T10:00:00.000Z",
  };
  return { project, worktrees: [worktree] };
}

const workspaces: Workspace[] = [
  {
    id: "ws-proj-chat-1",
    path: "/data/quick-sessions/session-1",
    name: "Chat",
    kind: "folder",
    hostId: "host-1",
  },
];

function mount(overrides?: {
  groups?: ProjectGroup[];
  onSelectWorkspace?: (id: string) => void;
  onSubmitRemove?: (project: Project) => Promise<string | null>;
}) {
  (window as unknown as { drogon?: unknown }).drogon ??= {};
  return render(
    <TooltipProvider>
      <ChatsList
        groups={overrides?.groups ?? [chatGroup()]}
        workspaces={workspaces}
        sessions={[]}
        selectedWorkspaceId={null}
        activeSessionId=""
        tabStrip={EMPTY_TAB_STRIP_STATE}
        disabled={false}
        onSelectWorkspace={overrides?.onSelectWorkspace ?? (() => {})}
        onSubmitRemove={overrides?.onSubmitRemove ?? (async () => null)}
      />
    </TooltipProvider>,
  );
}

describe("ChatsList", () => {
  test("renders nothing when there are no quick sessions (no empty header)", () => {
    const { container } = mount({ groups: [] });
    expect(container.firstChild).toBeNull();
  });

  test("renders a Chats section header above the Chat card", () => {
    mount();
    expect(screen.getByTestId("sidebar-chats-section")).toBeTruthy();
    expect(screen.getByText("Chats")).toBeTruthy();
  });

  test("selecting the card's worktree reports the workspace id", () => {
    const onSelectWorkspace = vi.fn();
    mount({ onSelectWorkspace });
    fireEvent.click(screen.getByText("Chat"));
    expect(onSelectWorkspace).toHaveBeenCalledWith("ws-proj-chat-1");
  });
});

/** The card's kebab menu is a Radix DropdownMenu: opening it needs the same
 *  pointerDown + click gesture TabCreateMenu.test.tsx uses (Radix opens on
 *  the pointer gesture, not a bare click), and the destructive row for a
 *  folder project's implicit worktree reads "Remove Workspace"
 *  (worktree-context-menu-policy.ts's worktreeDeleteRowKind), not
 *  "Remove"/"Delete" -- that label only names the confirm dialog's own
 *  button, opened next. */
function openCardMenuAndClickRemove(cardIndex = 0) {
  const trigger = screen.getAllByRole("button", { name: /actions for/i })[
    cardIndex
  ];
  fireEvent.pointerDown(trigger, { pointerType: "mouse", button: 0 });
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("menuitem", { name: "Remove Workspace" }));
}

describe("ChatsList deletion", () => {
  test("deleting a Chat requires confirmation and warns about permanent file loss", async () => {
    const onSubmitRemove = vi.fn(async () => null);
    mount({
      groups: [chatGroup({ id: "proj-chat-2", name: "Acceptance Chat" })],
      onSubmitRemove,
    });
    openCardMenuAndClickRemove();
    // The confirmation copy must tell the truth: a Chat's scratch folder is
    // actually deleted (cleanup_quick_session_scratch), unlike a regular
    // project's "still on your disk" registration-only removal.
    expect(screen.getByText("Delete Chat")).toBeTruthy();
    expect(screen.getByText(/permanently deletes/i)).toBeTruthy();
    expect(onSubmitRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await Promise.resolve();
    expect(onSubmitRemove).toHaveBeenCalledWith(
      expect.objectContaining({ id: "proj-chat-2", quickSession: true }),
    );
  });

  test("never touches a different Chat when one is deleted", () => {
    mount({
      groups: [
        chatGroup({ id: "proj-chat-1", name: "First Chat" }),
        chatGroup({ id: "proj-chat-2", name: "Second Chat" }),
      ],
    });
    openCardMenuAndClickRemove(0);
    expect(screen.getByText("First Chat")).toBeTruthy();
    // Only the targeted Chat's confirmation dialog opens.
    expect(screen.getAllByText("Delete Chat").length).toBe(1);
  });
});
