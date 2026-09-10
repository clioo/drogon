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
  onCreate?: (() => void) | null;
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
        onCreate={
          overrides?.onCreate === undefined ? () => {} : overrides.onCreate
        }
      />
    </TooltipProvider>,
  );
}

describe("ChatsList", () => {
  // The header (and its "New chat" create entry point -- the sole
  // remaining trigger after RecentSessions was removed, see this file's
  // own header comment) must survive an empty list, or there would be no
  // way to create the first Chat.
  test("keeps the header (and create entry point) with zero chats, showing an empty state instead of nothing", () => {
    const onCreate = vi.fn();
    mount({ groups: [], onCreate });
    expect(screen.getByTestId("sidebar-chats-section")).toBeTruthy();
    expect(screen.getByText("Chats")).toBeTruthy();
    expect(screen.getByText("No chats yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  test("hides the create button when no onCreate handler is provided", () => {
    mount({ groups: [], onCreate: null });
    expect(screen.queryByRole("button", { name: "New chat" })).toBeNull();
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

/** Gap 3 (task_926fddc5e769): a Bot with a session appears in the Chats
 *  section, named like its tab, with its truthful daemon state, and opens
 *  that Bot's session on click. */
describe("ChatsList Bot sessions", () => {
  const botSessions = [
    {
      botId: "bot-1",
      sessionId: "sess-1",
      displayName: "Arya Stark",
      characterPreset: "arya",
      harnessId: "claude" as const,
      state: "working" as const,
      workspaceId: "ws-home",
      title: "Arya Stark · Claude",
    },
    {
      botId: "bot-2",
      sessionId: "sess-2",
      displayName: "Tyrion",
      characterPreset: "tyrion",
      harnessId: "pi" as const,
      state: "exited" as const,
      workspaceId: "ws-home-2",
      title: "Tyrion · Pi",
    },
  ];

  function mountWithBots(onOpenBotSession: (botId: string) => void) {
    (window as unknown as { drogon?: unknown }).drogon ??= {};
    return render(
      <TooltipProvider>
        <ChatsList
          groups={[]}
          botSessions={botSessions}
          workspaces={workspaces}
          sessions={[]}
          selectedWorkspaceId={null}
          activeSessionId="sess-1"
          tabStrip={EMPTY_TAB_STRIP_STATE}
          disabled={false}
          onSelectWorkspace={() => {}}
          onOpenBotSession={onOpenBotSession}
          onSubmitRemove={async () => null}
          onCreate={null}
        />
      </TooltipProvider>,
    );
  }

  test("lists each Bot session with its title and daemon state", () => {
    mountWithBots(() => {});
    expect(screen.getByTestId("sidebar-chats-section")).toBeTruthy();
    expect(screen.getByText("Arya Stark")).toBeTruthy();
    expect(screen.getByText("Tyrion")).toBeTruthy();
    expect(screen.getByText("Exited")).toBeTruthy();
    // Bot rows exist, so the empty state must not claim there are none.
    expect(screen.queryByText("No chats yet")).toBeNull();
    expect(
      screen.getByRole("group", { name: "Bot sessions" }),
    ).toBeTruthy();
  });

  test("renders the character avatar and name in the Chats row", () => {
    // Defect 3: the row must show the SAME character artwork the Bots page
    // renders (through DrogonBotAvatar), keyed off the record's preset.
    mountWithBots(() => {});
    const avatar = screen.getByRole("img", { name: "Arya Stark avatar" });
    const image = avatar.querySelector("img");
    expect(image).not.toBeNull();
    expect(image!.getAttribute("src")).toContain("arya");
    // P3: the owner asked for a slightly larger avatar (16px -> 20px) so the
    // character reads at a glance. The row height stays h-6.
    expect(avatar.className).toContain("size-5");
    expect(screen.getByRole("button", { name: "Arya Stark · Claude" }).className).toContain(
      "h-6",
    );
    // The harness stays identifiable by its suffix even with the avatar in
    // the row.
    expect(screen.getByText(/· Claude/)).toBeTruthy();
  });

  test("clicking a Bot row opens that Bot's session", () => {
    const onOpenBotSession = vi.fn();
    mountWithBots(onOpenBotSession);
    fireEvent.click(screen.getByRole("button", { name: "Arya Stark · Claude" }));
    expect(onOpenBotSession).toHaveBeenCalledWith("bot-1");
  });

  test("marks the focused Bot row with aria-current", () => {
    mountWithBots(() => {});
    const active = screen.getByRole("button", { name: "Arya Stark · Claude" });
    expect(active.getAttribute("aria-current")).toBe("true");
    const inactive = screen.getByRole("button", { name: "Tyrion · Pi" });
    expect(inactive.getAttribute("aria-current")).toBeNull();
  });
});
