// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { describeJumpSelection, JumpPalette } from "./JumpPalette";
import type {
  JumpBrowserTab,
  JumpEditorTab,
  JumpQuickAction,
  JumpTab,
  JumpWorktree,
} from "./jump-palette-model";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";

beforeEach(installRadixJsdomStubs);
afterEach(cleanup);

const tabs: JumpTab[] = [
  { id: "s-1", workspaceId: "ws-1", title: "claude", agentState: "working", isActive: true },
  { id: "s-2", workspaceId: "ws-2", title: "pi", agentState: "idle", isActive: false },
];
const worktrees: JumpWorktree[] = [
  {
    id: "w-1",
    workspaceId: "ws-1",
    projectId: "p-1",
    projectName: "alpha",
    projectKind: "git",
    branch: "feat",
    name: "feat",
    agentState: "working",
    sessionCount: 1,
    isCurrent: true,
  },
];
const browserTabs: JumpBrowserTab[] = [
  {
    tabId: "b-1",
    workspaceId: "ws-1",
    title: "Example",
    url: "https://example.com",
    loading: false,
    isActive: false,
  },
];
const editorTabs: JumpEditorTab[] = [
  {
    tabId: "ws-1::src/notes.md",
    workspaceId: "ws-1",
    path: "src/notes.md",
    name: "notes.md",
    dirty: false,
    isActive: false,
  },
];
const quickActions: JumpQuickAction[] = [
  { id: "settings.open", title: "Open settings", description: "Preferences and shortcuts" },
];

function props(overrides: Partial<React.ComponentProps<typeof JumpPalette>> = {}) {
  return {
    query: "",
    onQueryChange: vi.fn(),
    onClose: vi.fn(),
    tabs,
    editorTabs,
    worktrees,
    browserTabs,
    quickActions,
    canCreateWorktree: true,
    onSelectSession: vi.fn(),
    onSelectEditorTab: vi.fn(),
    onSelectWorkspace: vi.fn(),
    onSelectBrowserTab: vi.fn(),
    onQuickAction: vi.fn(),
    onCreateWorktree: vi.fn(),
    ...overrides,
  };
}

function headings(): string[] {
  return Array.from(
    document.querySelectorAll("[cmdk-group-heading]"),
  ).map((node) => node.textContent ?? "");
}

describe("JumpPalette", () => {
  test("renders sections in source order with agent status", () => {
    render(<JumpPalette {...props()} />);
    expect(headings()).toEqual([
      "Recent Chats & Terminals",
      "Recent Worktrees",
      "Open Tabs",
      "Actions & Settings",
    ]);
    expect(screen.getAllByRole("img", { name: "Agent working" })).toHaveLength(2);
    expect(screen.getByRole("img", { name: "Agent idle" })).toBeTruthy();
    expect(screen.getByText("feat")).toBeTruthy();
    expect(screen.getByText("alpha")).toBeTruthy();
    expect(screen.getByText("Current")).toBeTruthy();
    expect(screen.getByText("https://example.com")).toBeTruthy();
  });

  test("typing filters through onQueryChange and narrows sections", () => {
    const p = props();
    const { rerender } = render(<JumpPalette {...p} />);
    fireEvent.change(screen.getByPlaceholderText(/Search chats/), {
      target: { value: "alp" },
    });
    expect(p.onQueryChange).toHaveBeenCalledWith("alp");
    rerender(<JumpPalette {...p} query="alp" />);
    expect(headings()).toEqual(["Worktrees"]);
  });

  test("Escape closes the palette", () => {
    const p = props();
    render(<JumpPalette {...p} />);
    fireEvent.keyDown(screen.getByPlaceholderText(/Search chats/), {
      key: "Escape",
    });
    expect(p.onClose).toHaveBeenCalled();
  });

  test("clicking outside closes the palette", () => {
    const p = props();
    const { container } = render(<JumpPalette {...p} />);
    const overlay = container.querySelector(".command-palette-overlay");
    expect(overlay).toBeTruthy();
    fireEvent.mouseDown(overlay as Element);
    expect(p.onClose).toHaveBeenCalled();
  });

  test("open files render beside sessions with their path", () => {
    render(<JumpPalette {...props()} />);
    expect(screen.getByText("notes.md")).toBeTruthy();
    expect(screen.getByText("src/notes.md")).toBeTruthy();
  });

  test("empty query with nothing to show renders the empty state", () => {
    render(
      <JumpPalette
        {...props({
          tabs: [],
          editorTabs: [],
          worktrees: [],
          browserTabs: [],
          quickActions: [],
        })}
      />,
    );
    expect(
      screen.getByText("No active worktrees, settings, actions, or open tabs"),
    ).toBeTruthy();
  });

  test("typed query with no match offers create-worktree", () => {
    render(<JumpPalette {...props({ query: "brand-new" })} />);
    expect(screen.queryByText("No results match your search")).toBeNull();
    expect(screen.getByText(/Create worktree/)).toBeTruthy();
    expect(screen.getByText(/create worktree action available/i)).toBeTruthy();
  });

  test("typed query with no match and no create target shows empty state", () => {
    render(
      <JumpPalette {...props({ query: "brand-new", canCreateWorktree: false })} />,
    );
    expect(screen.getByText("No results match your search")).toBeTruthy();
  });

  test("result count is announced to screen readers", () => {
    render(<JumpPalette {...props()} />);
    expect(screen.getByText("6 items available")).toBeTruthy();
  });
});

describe("describeJumpSelection", () => {
  test("maps every row kind to its owner callback", () => {
    expect(describeJumpSelection({ kind: "tab", tab: tabs[0] })).toEqual({
      type: "select-session",
      id: "s-1",
    });
    expect(
      describeJumpSelection({ kind: "worktree", worktree: worktrees[0] }),
    ).toEqual({ type: "select-workspace", id: "ws-1" });
    expect(
      describeJumpSelection({ kind: "browser-tab", tab: browserTabs[0] }),
    ).toEqual({ type: "select-browser-tab", tabId: "b-1" });
    expect(
      describeJumpSelection({ kind: "editor-tab", tab: editorTabs[0] }),
    ).toEqual({ type: "select-editor-tab", tabId: "ws-1::src/notes.md" });
    expect(
      describeJumpSelection({ kind: "quick-action", action: quickActions[0] }),
    ).toEqual({ type: "quick-action", id: "settings.open" });
    expect(
      describeJumpSelection({ kind: "create-worktree", name: "fresh" }),
    ).toEqual({ type: "create-worktree", name: "fresh" });
  });
});
